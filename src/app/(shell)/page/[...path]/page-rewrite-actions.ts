"use server";

import { revalidatePath } from "next/cache";

import { isOperatorModeServer } from "@/lib/operator-mode";
import { currentTenantId } from "@/lib/tenant-context";
import { autoRecordShippedChangeForRec } from "@/domains/proof-gsc/auto-record-on-ship";
import { saveMoveDraft, getLatestMoveDrafts } from "@/domains/demand-graph/move-draft-store";
import {
  loadPageSurgeonContext,
  assemblePacketForUrl,
} from "@/domains/recommendation-intelligence/page-surgeon/assemble-packet";
import {
  rewritePageStructured,
  assembleRewrite,
  serializeRewriteDraft,
  deserializeRewriteDraft,
  type CurrentPageSection,
  type AssembledRewrite,
} from "@/domains/llm/rewrite-page";
import { stripBannedDashes } from "@/lib/copy/strip-dashes";
import { normalizeUrl } from "@/lib/url/normalize";

/**
 * page-rewrite-actions (BEACON 500 item 61, 2026-07-02; Core 100K manual-publish
 * transition 2026-07-22) — the operator actions behind the page dossier's
 * "Rewrite this page" review: generate a grounded, section-by-section rewrite of
 * the page's CURRENT headings (rewrite-page.ts), persist it so the side-by-side
 * review survives reload (move_drafts, kind=page_rewrite), and let the operator
 * mark the sections they applied as live so Beacon records the shipment and
 * starts measuring.
 *
 * Beacon no longer writes to the CMS itself. The operator pastes the approved
 * NEW section copy into their own CMS, then clicks "Mark implemented"; that is
 * the only publish action, and it is tracking-only:
 *   - grounding: the same page-surgeon EvidencePacket assembler item 55 uses
 *   - drafting: rewrite-page.ts (this item's walker, item-55 quality gates)
 *   - persistence: move_drafts (existing store, "page_rewrite" kind)
 *   - measurement: autoRecordShippedChangeForRec with actionType "full_rewrite"
 *     so the diff-in-diff ledger enrolls it under its own family (item 61's
 *     "learn separately from single-lever edits" requirement)
 */

export type GenerateRewriteResponse =
  | { ok: false; reason: string }
  | { ok: true; rewrite: AssembledRewrite; costUsd: number; persisted: boolean };

/** Draft id used for move_drafts persistence — one rewrite review per page path. */
function draftRecId(path: string): string {
  return `page-rewrite:${path}`;
}

/** Resolve a dossier path to its real page URL + h2 sections + best-effort old
 *  body text, from the SAME page-surgeon context every other surgeon surface
 *  reads. Fail-soft -> null when the page has no crawled snapshot at all. */
async function resolvePageForRewrite(
  tenantId: string,
  path: string,
): Promise<{ pageUrl: string; sections: CurrentPageSection[]; topQueries: string[]; evidenceFacts: string[] } | null> {
  const ctx = await loadPageSurgeonContext(tenantId);
  let canonUrl: string | null = null;
  for (const url of ctx.snapshotByCanon.keys()) {
    if ((normalizeUrl(url) ?? url) === path) {
      canonUrl = url;
      break;
    }
  }
  if (!canonUrl) return null;

  const packet = assemblePacketForUrl(ctx, canonUrl);
  const crawl = packet.crawl;
  if (!crawl || !crawl.h2List || crawl.h2List.length === 0) return null;

  // Best-effort "old body" for each heading: Beacon's snapshot does not store a
  // heading->body slice, so every section shares the same crawl-sample pool
  // (body_paragraph_sample equivalent = cardTexts here, the only sampled prose
  // the packet carries). This is deliberately honest, not a fabricated per-
  // section body: the walker's prompt says plainly when no body text is known,
  // and the REAL section boundary match happens live against Wix at push time
  // (body-merge.ts's replace_section), independent of this approximation.
  const sampleProse = (crawl.cardTexts ?? []).join(" ");
  const sections: CurrentPageSection[] = crawl.h2List.map((heading) => ({
    heading,
    oldBody: sampleProse,
  }));

  const topQueries = (packet.gsc?.topQueries ?? []).slice(0, 8).map((q) => q.query);
  const evidenceFacts = [
    packet.gsc ? `${packet.gsc.impressions} impressions and ${packet.gsc.clicks} clicks in the last 90 days` : null,
    crawl.faqs && crawl.faqs.length > 0 ? `Page already has ${crawl.faqs.length} FAQ entr${crawl.faqs.length === 1 ? "y" : "ies"}` : null,
  ].filter((s): s is string => !!s);

  return { pageUrl: packet.current.pageUrl, sections, topQueries, evidenceFacts };
}

/** Generate a fresh rewrite for this page's current sections. Operator only. */
export async function generateRewriteAction(path: string): Promise<GenerateRewriteResponse> {
  if (!isOperatorModeServer()) return { ok: false, reason: "Operator only." };
  const cleanPath = (path ?? "").trim();
  if (!cleanPath) return { ok: false, reason: "No page." };

  const tenantId = await currentTenantId();
  const resolved = await resolvePageForRewrite(tenantId, cleanPath);
  if (!resolved || resolved.sections.length === 0) {
    return { ok: false, reason: "I do not have crawled sections for this page yet. Run a scan first." };
  }

  const result = await rewritePageStructured(resolved.sections, {
    topic: resolved.pageUrl,
    fanoutQuestions: resolved.topQueries,
    evidenceFacts: resolved.evidenceFacts,
    tenantId,
  });
  if (result.status !== "rewritten") {
    return { ok: false, reason: result.status === "off" ? "AI drafting is off." : "Budget reached for this month." };
  }

  const rewrite = assembleRewrite(result);
  const content = serializeRewriteDraft(rewrite);
  let persisted = false;
  if (content) {
    persisted = await saveMoveDraft(tenantId, draftRecId(cleanPath), "page_rewrite", content).catch(() => false);
  }

  return { ok: true, rewrite, costUsd: result.totalCostUsd, persisted };
}

/** Load a previously-persisted rewrite review so it survives reload. Fail-soft -> null. */
export async function loadSavedRewriteAction(path: string): Promise<AssembledRewrite | null> {
  if (!isOperatorModeServer()) return null;
  const tenantId = await currentTenantId();
  const drafts = await getLatestMoveDrafts(tenantId).catch(() => new Map());
  const raw = drafts.get(`${draftRecId(path)}::page_rewrite`)?.content;
  const persisted = deserializeRewriteDraft(raw);
  if (!persisted) return null;
  return { sections: persisted.sections, stats: persisted.stats };
}

export type MarkRewriteImplementedResponse = {
  recorded: boolean;
  sections: number;
  receiptLine: string;
};

/**
 * Mark the sections the operator applied in their own CMS as live, so Beacon
 * records the shipment and starts measuring. Beacon does NOT write to the CMS
 * itself; the operator pastes the approved NEW section copy shown in the review,
 * then clicks this. Tracking-only and fail-soft: it enrolls the page into
 * diff-in-diff measurement under actionType "full_rewrite" (its own family) via
 * the shipment ledger, exactly like every other "Mark implemented" path.
 */
export async function markRewriteSectionsImplementedAction(args: {
  path: string;
  accepted: Array<{ heading: string; newBody: string }>;
}): Promise<MarkRewriteImplementedResponse> {
  if (!isOperatorModeServer()) {
    return { recorded: false, sections: 0, receiptLine: "Operator only." };
  }
  const path = (args.path ?? "").trim();
  const sections = (args.accepted ?? []).filter((s) => s.heading?.trim() && s.newBody?.trim());
  if (!path || sections.length === 0) {
    return { recorded: false, sections: 0, receiptLine: "Nothing was marked, so I recorded nothing." };
  }

  const tenantId = await currentTenantId();

  const resolved = await resolvePageForRewrite(tenantId, path);
  if (!resolved) {
    return {
      recorded: false,
      sections: 0,
      receiptLine: stripBannedDashes("I could not resolve this page's live URL, so I recorded nothing."),
    };
  }

  const count = sections.length;
  const outcome = await autoRecordShippedChangeForRec({
    tenantId,
    pageUrl: resolved.pageUrl,
    actionType: "full_rewrite",
    notes: `Operator marked ${count} rewritten section${count === 1 ? "" : "s"} as live on the page.`,
  }).catch(() => null);
  const recorded = Boolean(outcome?.recorded);

  if (recorded) {
    revalidatePath(`/page/${path.replace(/^\/+/, "")}`);
    revalidatePath("/results");
  }

  const receiptLine = recorded
    ? `Recorded. I marked ${count} section${count === 1 ? "" : "s"} as live and started measuring the next 7, 14, and 28 days.`
    : "I saved this change, but I could not start measurement yet. I will pick it up on the next reading.";

  return { recorded, sections: count, receiptLine: stripBannedDashes(receiptLine) };
}
