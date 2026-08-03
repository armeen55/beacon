"use server";

import { createHash } from "node:crypto";

import { revalidatePath } from "next/cache";
import { log } from "@/lib/logger";
import { currentTenantId } from "@/lib/tenant-context";
import { canPublishForCurrentTenant } from "@/lib/auth/can-publish";
import { getRepository } from "@/lib/persistence/repositories";
import {
  editLifecycleStatus,
  markRecommendedEditsAsShipped,
} from "@/domains/decision";
import { dismissChangeProposal, loadChangeProposal, markProposalImplemented, resolveCurrentBasis, type ChangeProposal } from "@/domains/decision";
import { getTenant } from "@/domains/account";
import { captureChangeMeta, loadShippedChanges, recordShippedChange, upsertShippedChange } from "@/domains/measurement";
import { invalidateCoreSurfaces } from "../surface-release";
import { readChangesPage, type ChangesPage } from "../changes-data";

/**
 * changes/actions (CORE 100K cutover, 2026-07-22): the manual "Mark implemented"
 * action. Publishing authority is MANUAL and server-enforced: the kernel never
 * writes a live page and never flips this itself. The operator confirms they
 * applied a Ready change; we record it as implemented pending verification, so the
 * pre-ship queue drops it and the reading lives in the proof ledger.
 *
 * THE SHIPMENT TRANSACTION (V1 Truth Convergence Phase 6). Pressing this used to do
 * one thing: flip a status. So a change the operator really made left no record of
 * WHAT was applied, WHEN, or where the page stood beforehand, and nothing could ever
 * verify or measure it honestly. Now the press writes a Shipment FIRST and flips the
 * proposal SECOND, in that order and never the other way: a crash between the two
 * leaves a Shipment nobody has flipped yet, which the next press heals, whereas the
 * reverse would leave a change marked done that nothing on earth is measuring.
 */
export type MarkProposalImplementedResponse = {
  success: boolean;
  error?: string;
};

/**
 * The exact version of this change the operator applied: its copy, its components and
 * the basis it was drafted under. Deliberately EXCLUDES status, so the flip that
 * follows the Shipment cannot change the id and a retry lands on the same record.
 */
function shippedVersionOf(p: ChangeProposal): string {
  const material = {
    change: p.recommendedChange,
    components: (p.bundle?.components ?? []).map((c) => [c.kind, c.before, c.after]),
    basis: p.basis ?? null,
  };
  return createHash("sha256").update(JSON.stringify(material)).digest("hex").slice(0, 16);
}

/**
 * WHERE THE NEW PAGE ACTUALLY LIVES. A page that did not exist has no address of its own until the
 * operator publishes it, so a new-page change marked done with no address left me checking nothing:
 * verification fetched the page LABEL as if it were a website. The address is now owed, and it has to
 * be one I can read and keep reading: on the account's own site, secure, and one plain page address
 * with no query attached, because a tracking link is not the page. Returns the exact address to record,
 * or the one sentence the operator reads instead.
 */
function liveUrlFor(raw: string, domain: string): { url: string } | { error: string } {
  const site = domain.trim().toLowerCase().replace(/^www\./, "");
  const owed = `Tell me the address the new page is live at, on ${site}, so I can go and read it.`;
  const text = raw.trim();
  if (!text) return { error: owed };
  let parsed: URL;
  try { parsed = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`); } catch { return { error: owed }; }
  if (parsed.protocol !== "https:") return { error: `That address is not secure. Give me the https address on ${site}.` };
  if (parsed.hostname.toLowerCase().replace(/^www\./, "") !== site) {
    return { error: `That address is on ${parsed.hostname}, not on ${site}. I only record and read pages on your own site.` };
  }
  if (parsed.search || parsed.hash) return { error: "Give me the plain page address, with nothing after a ? or a #, so I read the page itself." };
  return { url: `${parsed.origin}${parsed.pathname}` };
}

/**
 * Write the Shipment for one proposal. Idempotent: the id is derived from the proposal
 * and the version applied, so a retry upserts itself and the store keeps the stamp and
 * the starting numbers it already holds. Returns false when nothing durable landed, and
 * the caller then refuses to flip anything.
 *
 * A SECOND PRESS ON THE SAME CHANGE DOES NOTHING AT ALL. It used to rebuild the whole record:
 * the live check I had already made was erased back to null and re-owed, the ship date moved to
 * today, and the displayed starting numbers were recomputed over a window that now included days
 * AFTER the change, so pressing twice quietly flattered the result of the change itself. The
 * record on file is the record. Only a genuinely new version of the copy is a new Shipment, and
 * that is a different id, so it makes its own record without touching this one.
 */
async function recordShipment(
  tenantId: string, proposal: ChangeProposal,
  opts: { componentKinds?: readonly string[]; operatorNote?: string | null; liveUrl?: string } = {},
): Promise<boolean> {
  const componentKinds = opts.componentKinds;
  try {
    const version = shippedVersionOf(proposal);
    const held = (await loadShippedChanges().catch(() => []))
      .find((r) => r.proposalId === proposal.id && r.proposalVersion === version);
    if (held) {
      log.info("markProposalImplemented: this exact change is already recorded, so I left its record alone", {
        proposalId: proposal.id, shipment: held.id,
      });
      return true;
    }
    // Every component unless the operator named the ones they actually applied. An
    // atomic change has no bundle, so the change itself is its one component.
    // THE EXACT COPY TRAVELS WITH THE SHIPMENT. Without each component's own wording the live
    // verification can only say unknown for everything but the lone component, and the whole
    // point of verifying is comparing what was proposed against what is actually on the page.
    // THE RISK GRADE TRAVELS TOO. Decision calls a component dangerous on its kind OR on this
    // grade; measurement only ever saw the kind, so a component graded dangerous under an
    // ordinary kind lost the day-56 follow up that exists for exactly those changes.
    const all = proposal.bundle?.components.map((c) => ({ kind: c.kind, label: c.label, after: c.after ?? null, risk: c.risk ?? null,
      // A renamed link is verified against the words that should now be ON it, so those words ride along.
      ...(c.anchorAfter ? { anchorAfter: c.anchorAfter } : {}),
      // AND A FORWARD RIDES WITH ITS DESTINATION. Without it the live check read the first address out of
      // the sentence, which is the one being MOVED, and graded a correct forward as a wrong one.
      ...(c.redirectTo ? { redirectTo: c.redirectTo } : {}) }))
      // An atomic change has no component to carry a grade, so it reads null rather than a guess.
      ?? [{ kind: proposal.changeFamily, label: proposal.opportunityType, after: proposal.recommendedChange?.kind === "existing_edit" ? proposal.recommendedChange.after : null, risk: null }];
    const wanted = componentKinds && componentKinds.length > 0 ? new Set(componentKinds) : null;
    const componentsApplied = wanted ? all.filter((c) => wanted.has(c.kind)) : all;

    // The page as Beacon already holds it: canonical URL, path, and the content hash
    // from the last crawl. Nothing is fetched.
    // THE OPERATOR'S OWN ADDRESS WINS for a new page: it is the only one that exists.
    const pageRef = (opts.liveUrl ?? proposal.pageUrl ?? proposal.pagePath ?? "").trim();
    const meta = pageRef ? await captureChangeMeta(tenantId, pageRef).catch(() => null) : null;
    const change = proposal.recommendedChange;
    const now = new Date().toISOString();

    const record = await recordShippedChange({
      tenantId,
      page: opts.liveUrl ?? meta?.canonPage ?? proposal.pageUrl ?? proposal.pageLabel,
      path: opts.liveUrl ? new URL(opts.liveUrl).pathname : meta?.path ?? proposal.pagePath ?? proposal.pageLabel,
      actionType: proposal.changeFamily,
      before: change.kind === "existing_edit" ? change.before : null,
      after: change.kind === "existing_edit" ? change.after : change.proposedTitle,
      targetQueries: [proposal.primaryQuery, ...(proposal.bundle?.scope.queries ?? [])]
        .filter((q, i, xs) => q && xs.indexOf(q) === i).slice(0, 5),
      controlPages: [],
      shippedAt: now,
      notes: null,
      shipment: {
        proposalId: proposal.id,
        proposalVersion: version,
        basis: proposal.basis ?? null,
        // A new page answers a research case; an edit's subject is its own page.
        caseId: proposal.kind === "new_page" ? (proposal.id.split("::")[1]?.trim().toLowerCase() || null) : null,
        bundleHypothesis: proposal.bundle?.objective ?? proposal.whyItMatters,
        componentsApplied,
        implementedAt: now,
        preChangeContentHash: meta?.contentHash ?? null,
        // THE NOTE TRAVELS WITH THE PRESS, and nothing else does. If they changed the page differently from
        // the copy I handed them, their own words ride along beside the reading. The reading still happens:
        // Beacon goes and looks at the page itself before it says anything, every single time.
        operatorNote: opts.operatorNote?.trim() || null,
      },
    });
    await upsertShippedChange(record);
    return true;
  } catch (err) {
    log.error("markProposalImplemented: the shipment did not land, so nothing was flipped", {
      proposalId: proposal.id, error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/**
 * Record that the operator applied a change. Two controls ride with it: the component PICKER (tick the
 * pieces you actually applied, all ticked by default) and the NOTE (say what you put on the page if it
 * was not my wording). THE CLAIM STARTS THE CHECK AND NEVER ENDS IT: whatever arrives here, the Shipment
 * is written with no verification on it, so Beacon still goes and reads the live page before it says a
 * change is there.
 */
export async function markProposalImplementedAction(args: {
  proposalId: string;
  /** Which components the operator actually applied. Absent or empty means all of them. */
  componentKinds?: string[];
  /** What they actually put on the page, in their own words. A note beside the reading, never instead of it. */
  operatorNote?: string;
  /** RETIRED, and accepted only so an old page still open in a browser is not an error. It used to
   *  suppress the live check; it does nothing now, and the check runs either way. */
  operatorConfirmed?: boolean;
  /** WHERE THE NEW PAGE IS LIVE. Required for a new page, which has no address until they publish it. */
  liveUrl?: string;
}): Promise<MarkProposalImplementedResponse> {
  const action = "markProposalImplemented";
  const t0 = Date.now();
  log.info("Action started", { action, params: { proposalId: args.proposalId } });

  // Same server-side publish authority the actual push path carries: a stale or
  // hand-crafted client request cannot mark work live merely because it reached
  // the server action.
  if (!(await canPublishForCurrentTenant())) {
    return { success: false, error: "You do not have permission to mark this change implemented." };
  }
  if (!args.proposalId) {
    return { success: false, error: "No change was specified." };
  }

  const tenantId = await currentTenantId();
  try {
    // A SET-ASIDE CHANGE MAY NOT BE RECORDED AS WORK YOU DID. The button lives on a
    // page that could have been open since before the bar moved, and recording it
    // would push a change I no longer stand behind into the proof ledger, where it
    // would be measured and counted for weeks. Refuse in the operator's own words.
    const basis = await resolveCurrentBasis(tenantId).catch(() => null);
    const stored = await loadChangeProposal(tenantId, args.proposalId).catch(() => null);
    if (stored == null) {
      return { success: false, error: "I couldn't find that change to mark it implemented." };
    }
    if (stored.status !== "implemented_pending_verification" && (basis == null || stored.basis !== basis)) {
      return { success: false, error: "I set this change aside, so I am not recording it. Open Changes for the work I stand behind now." };
    }
    // THE ADDRESS GATE RUNS BEFORE ANYTHING IS WRITTEN, because the shipment is written first and a
    // shipment pointing at a page label is a reading I can never take.
    let liveUrl: string | undefined;
    if (stored.kind === "new_page") {
      const domain = (await getTenant(tenantId).catch(() => null))?.domain?.trim();
      if (!domain) return { success: false, error: "I could not read your website address just now, so I am not recording this yet. Press it again in a moment." };
      const checked = liveUrlFor(args.liveUrl ?? "", domain);
      if ("error" in checked) return { success: false, error: checked.error };
      liveUrl = checked.url;
    }
    // SHIPMENT FIRST, FLIP SECOND. Never the other way around.
    if (!(await recordShipment(tenantId, stored, {
      componentKinds: args.componentKinds, operatorNote: args.operatorNote, liveUrl,
    }))) {
      return { success: false, error: "I couldn't start measuring this change, so I haven't recorded it as done. Press it again in a moment." };
    }
    const ok = await markProposalImplemented(tenantId, args.proposalId, liveUrl);
    if (!ok) {
      return { success: false, error: "I couldn't find that change to mark it implemented." };
    }
    await invalidateCoreSurfaces().catch(() => {});
    revalidatePath("/changes");
    revalidatePath("/", "layout");
    log.info("Action completed", { action, durationMs: Date.now() - t0, params: { proposalId: args.proposalId } });
    return { success: true };
  } catch (err) {
    log.error("markProposalImplemented: failed", {
      proposalId: args.proposalId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { success: false, error: `Failed to mark implemented: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * THE NEXT PAGE OF THE RANKED QUEUE. Read-only, ONE page, cut at a rank offset inside the release the
 * caller names: hand back the id you were given and you keep reading the same order. If that release has
 * been replaced since, the answer is the fresh first page and the sentence saying so, never rows from an
 * order the operator never saw.
 */
export async function loadMoreChangesAction(args: {
  lane: "ready" | "todo"; cursor: number; releaseId?: string | null;
}): Promise<ChangesPage> {
  return readChangesPage(await currentTenantId(), args.lane, args.cursor, args.releaseId ?? null);
}

/**
 * THE operator's "put this aside". A Suggested change the operator does not want takes the one
 * terminal disposition that means exactly that: dismissed. It is not a rejection by Beacon and
 * not a lifecycle stage, so the change keeps its status and simply stops being the current
 * answer, and the store refuses to re-draft the same hypothesis until the evidence itself moves.
 *
 * ONLY WORK STILL WAITING ON THE OPERATOR. A change already marked implemented is being measured,
 * so it is refused here in the operator's own words rather than quietly ignored.
 */
export async function dismissProposalAction(args: {
  proposalId: string;
}): Promise<MarkProposalImplementedResponse> {
  const action = "dismissProposal";
  if (!(await canPublishForCurrentTenant())) {
    return { success: false, error: "You do not have permission to change this." };
  }
  if (!args.proposalId) return { success: false, error: "No change was specified." };
  const tenantId = await currentTenantId();
  try {
    const stored = await loadChangeProposal(tenantId, args.proposalId).catch(() => null);
    if (stored == null) return { success: false, error: "I couldn't find that change to put it aside." };
    if (stored.status === "implemented_pending_verification") {
      return { success: false, error: "You already marked this one done, so I am measuring it. I am not putting it away while a reading is running." };
    }
    if (!(await dismissChangeProposal(tenantId, args.proposalId))) {
      return { success: false, error: "I couldn't put that one aside just now. Press it again in a moment." };
    }
    await invalidateCoreSurfaces().catch(() => {});
    revalidatePath("/changes");
    revalidatePath("/", "layout");
    log.info("Action completed", { action, params: { proposalId: args.proposalId } });
    return { success: true };
  } catch (err) {
    log.error("dismissProposal: failed", { proposalId: args.proposalId, error: err instanceof Error ? err.message : String(err) });
    return { success: false, error: "I couldn't put that one aside just now. Press it again in a moment." };
  }
}

/**
 * Results-timeline "Mark shipped" confirms a previously-accepted recommended
 * edit is live on the page, flipping its lifecycle to verified-live. Server-side
 * publish authority is enforced (a stale UI cannot skip Accept). Distinct from
 * the Changes-queue "Mark implemented" above: this operates on the persisted
 * recommended_edits row linked to a changelog entry that Results renders.
 */
function changelogJoinKey(entry: {
  source_rec_id?: string | null;
  action_type?: string | null;
  target_element_key?: string | null;
}): string | null {
  if (!entry.source_rec_id || !entry.action_type || !entry.target_element_key) return null;
  return `${entry.source_rec_id}__${entry.action_type}__${entry.target_element_key}`;
}

function indexEditsByJoinKey<
  T extends { rec_id?: string | null; action_type?: string | null; target_element_key?: string | null },
>(edits: readonly T[]): Map<string, T> {
  const map = new Map<string, T>();
  for (const edit of edits) {
    if (!edit.rec_id || !edit.action_type || !edit.target_element_key) continue;
    map.set(`${edit.rec_id}__${edit.action_type}__${edit.target_element_key}`, edit);
  }
  return map;
}

type MarkChangelogEditShippedResponse = {
  success: boolean;
  error?: string;
  flipped?: number;
  skipped?: number;
};

export async function markChangelogEditShipped(args: {
  changelogId: string;
}): Promise<MarkChangelogEditShippedResponse> {
  const action = "markChangelogEditShipped";
  const t0 = Date.now();
  log.info("Action started", { action, params: { changelogId: args.changelogId } });

  if (!(await canPublishForCurrentTenant())) {
    return { success: false, error: "You do not have permission to mark this change live." };
  }

  const tenantId = await currentTenantId();
  const repo = getRepository().forTenant(tenantId);

  let changelogEntries;
  let recommendedEdits;
  try {
    [changelogEntries, recommendedEdits] = await Promise.all([
      repo.getChangelogEntries(),
      repo.getRecommendedEdits(),
    ]);
  } catch (err) {
    log.error("markChangelogEditShipped: read failed", {
      changelogId: args.changelogId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { success: false, error: `Failed to read lifecycle data: ${err instanceof Error ? err.message : String(err)}` };
  }

  const entry = changelogEntries.find((e) => e.id === args.changelogId);
  if (!entry) return { success: false, error: "Changelog entry not found." };

  const joinKey = changelogJoinKey(entry);
  if (!joinKey) {
    return {
      success: false,
      error: "This changelog entry has no linked recommended edit, so there's nothing to mark as shipped.",
    };
  }

  const edit = indexEditsByJoinKey(recommendedEdits).get(joinKey);
  if (!edit) {
    return { success: false, error: "No matching recommended edit row found for this changelog entry." };
  }

  const status = editLifecycleStatus(edit);
  if (status === "recommended") {
    return {
      success: false,
      error:
        "Accept the recommendation first. Mark Shipped only confirms an already-accepted change is live on the page; it doesn't accept the recommendation for you.",
    };
  }
  if (status !== "accepted") return { success: true, flipped: 0, skipped: 1 };

  try {
    const result = await markRecommendedEditsAsShipped({ editIds: [edit.id], tenantId });
    log.info("Action completed", { action, durationMs: Date.now() - t0, params: { changelogId: args.changelogId, flipped: result.flipped } });
    if (result.flipped > 0) await invalidateCoreSurfaces().catch(() => {});
    revalidatePath("/changes");
    revalidatePath("/", "layout");
    return { success: true, flipped: result.flipped, skipped: result.skipped };
  } catch (err) {
    log.error("markChangelogEditShipped: persistence flip failed", {
      changelogId: args.changelogId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { success: false, error: `Failed to mark edit shipped: ${err instanceof Error ? err.message : String(err)}` };
  }
}
