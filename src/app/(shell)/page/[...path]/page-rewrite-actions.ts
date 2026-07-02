"use server";

import { revalidatePath } from "next/cache";

import { isOperatorModeServer } from "@/lib/operator-mode";
import { currentTenantId } from "@/lib/tenant-context";
import { getTenant } from "@/domains/tenants/store";
import { canPublishForCurrentTenant } from "@/lib/auth/can-publish";
import { getPublishingMode } from "@/domains/push/publishing-mode-store";
import { RITZ_TENANT_ID, executePush } from "@/domains/push/push-service";
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
import type { RecommendedEditRow } from "@/domains/recommendations/recommended-edits-persistence";
import { normalizeUrl } from "@/lib/url/normalize";

/**
 * page-rewrite-actions (BEACON 500 item 61, 2026-07-02) — the operator actions
 * behind the page dossier's "Rewrite this page" review: generate a grounded,
 * section-by-section rewrite of the page's CURRENT headings (rewrite-page.ts),
 * persist it so the side-by-side review survives reload (move_drafts,
 * kind=page_rewrite), and stage ONLY the sections the operator accepts through
 * the EXISTING body-push rails (executePush's replace_section route) — never a
 * whole-page overwrite, never an unapproved section.
 *
 * Every write here is COMPOSITION over existing rails:
 *   - grounding: the same page-surgeon EvidencePacket assembler item 55 uses
 *   - drafting: rewrite-page.ts (this item's new walker, item-55 quality gates)
 *   - persistence: move_drafts (existing store, new "page_rewrite" kind)
 *   - publish: executePush's replace_section route (item 2's body-merge engine,
 *     the Ritz hard-block, daily cap, pre-push snapshot + revert, never-wipe)
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

export type StageAcceptedSectionsResponse = {
  staged: number;
  refused: Array<{ heading: string; reason: string }>;
  receiptLine: string;
};

/**
 * Stage ONLY the accepted sections through the existing armed-publish rails.
 * Every gate mirrors stage-change.ts's contract (tenant from server context,
 * Ritz hard-refuse, publish permission, explicit arm, wix_cms target) before
 * ANY push runs; each accepted section is an independent replace_section push
 * so one refusal never blocks the others. On any successful push, auto-enrolls
 * the ship into diff-in-diff measurement under actionType "full_rewrite".
 */
export async function stageAcceptedRewriteSectionsAction(args: {
  path: string;
  accepted: Array<{ heading: string; newBody: string }>;
}): Promise<StageAcceptedSectionsResponse> {
  if (!isOperatorModeServer()) {
    return { staged: 0, refused: [], receiptLine: "Operator only." };
  }
  const path = (args.path ?? "").trim();
  const sections = (args.accepted ?? []).filter((s) => s.heading?.trim() && s.newBody?.trim());
  if (!path || sections.length === 0) {
    return { staged: 0, refused: [], receiptLine: "Nothing was accepted, so I published nothing." };
  }

  const tenantId = await currentTenantId();

  // Gate: Ritz never stages, full stop (executePush would also refuse; refusing
  // here first means no cap slot, snapshot, or probe ever runs for Ritz).
  if (tenantId === RITZ_TENANT_ID) {
    return {
      staged: 0,
      refused: sections.map((s) => ({ heading: s.heading, reason: "this site is advise mode only" })),
      receiptLine: "This site is set to advise mode, so I never publish to it myself. I left every section for you to paste.",
    };
  }

  if (!(await canPublishForCurrentTenant().catch(() => false))) {
    return {
      staged: 0,
      refused: sections.map((s) => ({ heading: s.heading, reason: "no publishing permission" })),
      receiptLine: "You do not have publishing permission for this site.",
    };
  }

  const modeState = await getPublishingMode().catch(() => ({ mode: "staged" as const }));
  if (modeState.mode !== "armed") {
    return {
      staged: 0,
      refused: sections.map((s) => ({ heading: s.heading, reason: "one-click publishing is off" })),
      receiptLine: "One-click publishing is not turned on for this site yet. Turn it on in the publishing settings and this becomes one click.",
    };
  }

  let publishTarget: string | null = null;
  try {
    publishTarget = (await getTenant(tenantId))?.publish_target ?? null;
  } catch {
    publishTarget = null;
  }
  if (publishTarget !== "wix_cms") {
    return {
      staged: 0,
      refused: sections.map((s) => ({ heading: s.heading, reason: "no live Wix target" })),
      receiptLine: "This site is not connected for live Wix publishing.",
    };
  }

  const resolved = await resolvePageForRewrite(tenantId, path);
  if (!resolved) {
    return {
      staged: 0,
      refused: sections.map((s) => ({ heading: s.heading, reason: "page not found" })),
      receiptLine: "I could not resolve this page's live URL, so I published nothing.",
    };
  }

  const now = new Date();
  let staged = 0;
  const refused: Array<{ heading: string; reason: string }> = [];

  for (const section of sections) {
    const edit: RecommendedEditRow = {
      id: `rewrite-${Date.now()}-${section.heading.slice(0, 24)}`,
      tenant_id: tenantId,
      rec_id: draftRecId(path),
      action_type: "full_rewrite",
      target_url: resolved.pageUrl,
      target_element_key: `section:${section.heading}`,
      display_label: section.heading,
      current_text: "",
      proposed_text: section.newBody,
      why: "Operator-approved agentic rewrite of this section.",
      evidence: [],
      expected_impact: null,
      difficulty: "low",
      confidence: "medium",
      measurement_plan: null,
      risks: [],
      source: "openai",
      provider_name: "openai",
      evidence_hash: null,
      model: "gpt-5-mini",
      cost_usd: null,
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
      implementation_status: "accepted",
    } as RecommendedEditRow;

    const result = await executePush({ tenantId, edit }, { now });
    if (result.kind === "pushed") {
      staged += 1;
    } else if (result.kind === "refused") {
      refused.push({ heading: section.heading, reason: stripBannedDashes(result.reason) });
    } else if (result.kind === "dev_note") {
      refused.push({ heading: section.heading, reason: stripBannedDashes(result.reason) });
    } else {
      refused.push({ heading: section.heading, reason: "the publish path did not complete a live write" });
    }
  }

  if (staged > 0) {
    await autoRecordShippedChangeForRec({
      tenantId,
      pageUrl: resolved.pageUrl,
      actionType: "full_rewrite",
      notes: `Auto-recorded from an agentic full-page rewrite (${staged} section${staged === 1 ? "" : "s"} published).`,
    }).catch(() => null);
    revalidatePath(`/page/${path.replace(/^\/+/, "")}`);
    revalidatePath("/proof");
  }

  const receiptLine =
    staged === 0
      ? "I could not publish any accepted section, so I left them for you to paste."
      : refused.length === 0
        ? `Published ${staged} section${staged === 1 ? "" : "s"}. I saved the old version of each first; one click restores it.`
        : `Published ${staged} section${staged === 1 ? "" : "s"}; ${refused.length} could not go live and stayed paste-ready.`;

  return { staged, refused, receiptLine: stripBannedDashes(receiptLine) };
}
