"use server";

import { createHash } from "node:crypto";

import { revalidatePath } from "next/cache";
import { log } from "@/lib/logger";
import { currentTenantId } from "@/lib/tenant-context";
import { canPublishForCurrentTenant } from "@/lib/auth/can-publish";
import { getRepository } from "@/lib/persistence/repositories";
import { actionableProposalFailures, componentIdOf, dangerousComponents, dismissChangeProposal, editLifecycleStatus,
  loadChangeProposal, markRecommendedEditsAsShipped, resolveCurrentBasis, sameComponentId, transitionProposalToImplemented,
  type ChangeProposal } from "@/domains/decision";
import { getTenant } from "@/domains/account";
import { captureChangeMeta, loadShippedChanges, recordShipment, type MeasurementState } from "@/domains/measurement";
import { invalidateCoreSurfaces } from "../surface-release";
import { readChangesPage, type ChangesPage } from "../changes-data";

/** changes/actions: the manual "Mark implemented" action. Publishing authority is MANUAL and server-enforced: the kernel never writes a
 *  live page and never flips this itself. THE SHIPMENT TRANSACTION: the press writes a Shipment FIRST and flips the proposal SECOND, never
 *  the other way, because a crash between the two leaves a Shipment nobody flipped (which the next press heals) where the reverse leaves a
 *  change marked done that nothing on earth is measuring. And nothing lands at all unless the ONE verdict passes at this moment. `note`
 *  says what is still theirs to do after a PARTIAL apply, in their own words. */
type MarkProposalImplementedResponse = { success: boolean; error?: string; note?: string };

/** What one press landed: whether every piece is now on file, how many this press wrote, how many are genuinely still theirs to do (the
 *  remainder came off THIS press before, so press two of three said "the other 2" with one left), AND THE RECORD THAT IS MEASURING IT. The
 *  flip that follows will not run without that id, so a press can never close a change no record stands behind. */
type Shipped = { ok: true; complete: boolean; recorded: number; remaining: number; shipmentId: string; measurement: MeasurementState };

/** The exact version applied: its copy, its components, the basis it was drafted under AND THE PIECES THIS PRESS ACTUALLY APPLIED.
 *  Deliberately EXCLUDES status, so the flip that follows cannot change the id and a retry lands on the same record. Applying a different
 *  subset later is a DIFFERENT thing to measure, so it gets its own record instead of being silently swallowed by the first one. */
function shippedVersionOf(p: ChangeProposal, appliedIds: readonly string[]): string {
  const material = {
    change: p.recommendedChange,
    components: (p.bundle?.components ?? []).map((c) => [c.kind, c.before, c.after]),
    basis: p.basis ?? null,
    applied: [...appliedIds].sort(),
  };
  return createHash("sha256").update(JSON.stringify(material)).digest("hex").slice(0, 16);
}

/** WHERE THE NEW PAGE ACTUALLY LIVES. A page that did not exist has no address until the operator publishes it, so a new-page change marked
 *  done with no address left verification fetching the page LABEL as if it were a website. The address is owed, and it has to be one I can
 *  keep reading: on their own site, secure, and one plain page address with no query, because a tracking link is not the page. */
function liveUrlFor(raw: string, domain: string): { url: string } | { error: string } {
  const site = domain.trim().toLowerCase().replace(/^www\./, "");
  const owed = `Add the address the new page is live at, on ${site}, so it can be read.`;
  const text = raw.trim();
  if (!text) return { error: owed };
  let parsed: URL;
  try { parsed = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`); } catch { return { error: owed }; }
  if (parsed.protocol !== "https:") return { error: `That address is not secure. Use the https address on ${site}.` };
  if (parsed.hostname.toLowerCase().replace(/^www\./, "") !== site) {
    return { error: `That address is on ${parsed.hostname}, not on ${site}. Only pages on your own site are recorded and read.` };
  }
  if (parsed.search || parsed.hash) return { error: "Use the plain page address, with nothing after a ? or a #, so the page itself is read." };
  return { url: `${parsed.origin}${parsed.pathname}` };
}

/** Write the Shipment for one proposal. Idempotent: the id is derived from the proposal and the version applied, so a retry keeps the stamp
 *  and the starting numbers already on file, and the caller flips nothing when it did not land. A SECOND PRESS DOES NOTHING AT ALL:
 *  rebuilding the record erased the live check back to null, moved the ship date to today and recomputed the starting numbers over a window
 *  that now included days AFTER the change, so pressing twice quietly flattered its own result. */
async function recordImplementation(tenantId: string, proposal: ChangeProposal,
  opts: { appliedIds: readonly string[]; operatorNote?: string | null; liveUrl?: string },
): Promise<Shipped | { ok: false; error: string }> {
  const bundleIds = (proposal.bundle?.components ?? []).map(componentIdOf);
  try {
    // FAIL CLOSED ON THE DUPLICATE CHECK. A ledger I could not read is not proof there is no prior record: writing blind resets the live
    // check and moves the ship date, the exact bug this lookup exists to stop.
    const ledger = await loadShippedChanges();
    // WHAT IS ALREADY ON FILE COMES OUT OF THIS PRESS: the picker offers every piece by default, so a partial press followed by the obvious
    // next one wrote a SECOND record measuring the same component twice, and no screen can cause that now whatever it sends. The same id
    // twice in one press is one piece too, so a repeated pick cannot mint a second version of one record.
    // NAMES ARE COMPARED ACROSS ERAS. A piece recorded before its exact copy was part of its name can only ever be compared at the precision
    // it was written with; two names of today's era compare whole, so a redrafted piece is genuinely new work and is measured.
    const already = new Set<string>();
    const mine = ledger.filter((r) => r.proposalId === proposal.id);
    for (const r of mine) for (const c of r.componentsApplied ?? []) if (c.id) already.add(c.id);
    const covers = (set: Iterable<string>, id: string) => [...set].some((a) => sameComponentId(a, id));
    const fresh = [...new Set(opts.appliedIds)].filter((id) => !covers(already, id));
    const state = (recorded: number, shipmentId: string | null, measurement: MeasurementState): Shipped | { ok: false; error: string } => {
      const covered = new Set([...already, ...(recorded > 0 ? fresh : [])]);
      const left = bundleIds.filter((id) => !covers(covered, id));
      if (!shipmentId) {
        log.error("markProposalImplemented: no record could be named for this press, so nothing was flipped", { proposalId: proposal.id });
        return { ok: false, error: "Measuring this change could not start, so it is not recorded as done. Press it again in a moment." };
      }
      return { ok: true, complete: left.length === 0, recorded, remaining: left.length, shipmentId, measurement };
    };
    // Nothing new to measure, so nothing is written and the record already on file keeps whatever it can be compared against.
    if (bundleIds.length > 0 && fresh.length === 0) return state(0, mine[0]?.id ?? null, mine[0]?.measurementState ?? "measuring");
    const version = shippedVersionOf(proposal, fresh);
    // Every component unless the operator named the ones they applied; an atomic change has no bundle, so the change itself is its one
    // component. THE EXACT COPY TRAVELS, because verifying is comparing what was proposed against what is on the page. THE RISK GRADE
    // TRAVELS TOO: measurement saw only the kind, so a dangerous grade on an ordinary kind lost its day-56 follow up.
    const all = proposal.bundle?.components.map((c, i) => ({ id: componentIdOf(c, i), kind: c.kind, label: c.label, after: c.after ?? null, risk: c.risk ?? null,
      // A renamed link is verified against the words that should now be ON it, so those words ride along.
      ...(c.anchorAfter ? { anchorAfter: c.anchorAfter } : {}),
      // AND A FORWARD RIDES WITH ITS DESTINATION. Without it the live check read the first address out of the sentence, which is the one
      // being MOVED, and graded a correct forward as a wrong one.
      ...(c.redirectTo ? { redirectTo: c.redirectTo } : {}) }))
      // An atomic change has no component to carry a grade, so it reads null rather than a guess.
      ?? [{ id: null, kind: proposal.changeFamily, label: proposal.opportunityType, after: proposal.recommendedChange?.kind === "existing_edit" ? proposal.recommendedChange.after : null, risk: null }];
    const componentsApplied = bundleIds.length > 0 ? all.filter((c) => c.id != null && covers(fresh, c.id)) : all;

    // The page as Beacon already holds it: canonical URL, path and the content hash from the last crawl, nothing fetched. THE OPERATOR'S
    // OWN ADDRESS WINS for a new page: it is the only one that exists.
    const pageRef = (opts.liveUrl ?? proposal.pageUrl ?? proposal.pagePath ?? "").trim();
    const meta = pageRef ? await captureChangeMeta(tenantId, pageRef).catch(() => null) : null;
    const change = proposal.recommendedChange;

    // THE ONE DOOR THAT WRITES A SHIPMENT. It always writes and always answers with the row's id, so an implementation the operator really
    // made is recorded whatever the search data can support; whether it can be fairly compared comes back beside it and is said out loud
    // rather than used to refuse the record. Idempotent on (proposal, version): a retry lands on the row already on file.
    const landed = await recordShipment({
      tenantId, proposalId: proposal.id, proposalVersion: version,
      page: opts.liveUrl ?? meta?.canonPage ?? proposal.pageUrl ?? proposal.pageLabel,
      path: opts.liveUrl ? new URL(opts.liveUrl).pathname : meta?.path ?? proposal.pagePath ?? proposal.pageLabel,
      actionType: proposal.changeFamily,
      before: change.kind === "existing_edit" ? change.before : null,
      after: change.kind === "existing_edit" ? change.after : change.proposedTitle,
      // THE AI QUESTIONS RIDE TOO: the shipment's AI outcome joins observations on the tracked question texts, and dropping scope.prompts
      // here left every future Result's AI half permanently dark.
      targetQueries: [proposal.primaryQuery, ...(proposal.bundle?.scope.queries ?? []), ...(proposal.bundle?.scope.prompts ?? [])]
        .filter((q, i, xs) => q && xs.indexOf(q) === i).slice(0, 10),
      basis: proposal.basis ?? null,
      // A new page answers a research case; an edit's subject is its own page.
      caseId: proposal.kind === "new_page" ? (proposal.id.split("::")[1]?.trim().toLowerCase() || null) : null,
      bundleHypothesis: proposal.bundle?.objective ?? proposal.whyItMatters,
      componentsApplied,
      preChangeContentHash: meta?.contentHash ?? null,
      // THE NOTE TRAVELS WITH THE PRESS, and nothing else does: their own words ride along BESIDE the reading, and Beacon still goes and
      // looks at the page itself before it says anything.
      operatorNote: opts.operatorNote ?? null,
    });
    return state(fresh.length, landed.shipmentId, landed.measurement);
  } catch (err) {
    log.error("markProposalImplemented: the shipment did not land, so nothing was flipped", {
      proposalId: proposal.id, error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, error: "Measuring this change could not start, so it is not recorded as done. Press it again in a moment." };
  }
}

/** What the press says about the reading it just started, and nothing when the reading is simply running. Recorded is recorded in every case. */
function measurementNote(state: MeasurementState): string | undefined {
  if (state === "insufficient_comparison") return "Recorded. Too few pages on your site can be fairly compared against this one yet, so the reading starts as soon as enough of them have search data.";
  if (state === "measurement_unavailable") return "Recorded. Your search data could not be read just now, so the reading starts as soon as it can be.";
  if (state === "verification_needed") return "Recorded. The page is checked next, and the reading starts from what is found there.";
  return undefined;
}

/** Record that the operator applied a change. THE CLAIM STARTS THE CHECK AND NEVER ENDS IT: whatever arrives here, the Shipment is written
 *  with no verification on it, so Beacon still reads the live page itself. */
export async function markProposalImplementedAction(args: {
  proposalId: string;
  /** WHICH PIECES THEY ACTUALLY APPLIED, by the stable id each piece carries inside its stored bundle. ABSENT means all of them; anything
   *  else is intersected against the bundle on file and refused when it selects nothing, so a hand-made list can no longer conjure an empty
   *  selection past the confirmation. */
  componentIds?: string[];
  /** What they actually put on the page, in their own words. A note beside the reading, never instead of it. */
  operatorNote?: string;
  /** RETIRED, and accepted only so an old page still open in a browser is not an error. It used to suppress the live check; it does nothing
   *  now, and the check runs either way. */
  operatorConfirmed?: boolean;
  /** THE ONE CONFIRMATION THAT IS REAL. Set only by an operator who ticked the box beside a piece that moves or hides a page. Enforced
   *  HERE, on the server: a stale screen or a hand-made request cannot merge or redirect a page merely because it reached this action. */
  destructiveConfirmed?: boolean;
  /** WHERE THE NEW PAGE IS LIVE. Required for a new page, which has no address until they publish it. */
  liveUrl?: string;
}): Promise<MarkProposalImplementedResponse> {
  const action = "markProposalImplemented";
  const t0 = Date.now();
  log.info("Action started", { action, params: { proposalId: args.proposalId } });

  // Same server-side publish authority the push path carries: a stale or hand-crafted client request cannot mark work live merely because
  // it reached the server action.
  if (!(await canPublishForCurrentTenant())) {
    return { success: false, error: "You do not have permission to mark this change implemented." };
  }
  if (!args.proposalId) return { success: false, error: "No change was specified." };

  const tenantId = await currentTenantId();
  try {
    const basis = await resolveCurrentBasis(tenantId).catch(() => null);
    const stored = await loadChangeProposal(tenantId, args.proposalId).catch(() => null);
    if (stored == null) {
      return { success: false, error: "That change could not be found, so it was not marked implemented." };
    }
    // THE VERDICT IS ASKED AT THE MOMENT OF THE MUTATION, not only where the screen was drawn. The button lives on a page that could have
    // been open since before the bar moved or before this change's own receipt stopped resolving, and recording it would push a change I no
    // longer stand behind into the proof ledger, where it would be measured and counted for weeks. No shipment lands unless this passes.
    if (stored.status !== "implemented_pending_verification"
      && actionableProposalFailures(stored, { tenantId, currentBasis: basis }).length > 0) {
      return { success: false, error: "This change was skipped, so it is not being recorded. Open Changes for the work that stands today." };
    }
    // WHAT THEY SAY THEY APPLIED IS CHECKED AGAINST WHAT I HOLD. The server used to take the caller's word for a list of KINDS, so a
    // hand-built list nobody could have ticked selected nothing, walked past the confirmation below and closed the whole change. Ids are
    // derived from the stored bundle HERE.
    const components = stored.bundle?.components ?? [];
    const ids = components.map(componentIdOf);
    let applied = components;
    if (args.componentIds !== undefined) {
      const wanted = new Set(args.componentIds);
      // Era-tolerant on purpose: a screen open since before the copy joined the name still ticks the piece it is looking at.
      applied = components.filter((_, i) => [...wanted].some((w) => sameComponentId(w, ids[i]!)));
      if (applied.length === 0 || applied.length !== wanted.size) {
        return { success: false, error: "The pieces you ticked are not recognized, so nothing was recorded. Open the change again and tick what you applied." };
      }
    }
    // A CHANGE THAT MOVES OR HIDES A PAGE OWES A DELIBERATE YES, and so does one graded dangerous on its own terms. The canonical rule is
    // the grade OR the kind OR a correction to a high-stakes fact; the four hardcoded kinds this used to check let every one of the others
    // through without a tick.
    if (dangerousComponents(applied).length > 0 && args.destructiveConfirmed !== true) {
      return { success: false, error: "This one moves or hides a page, so it needs your confirmation before it is recorded. Open the change, tick the confirmation, and press it again." };
    }
    // THE ADDRESS GATE RUNS BEFORE ANYTHING IS WRITTEN, because the shipment is written first and a shipment pointing at a page label is a
    // reading I can never take.
    let liveUrl: string | undefined;
    if (stored.kind === "new_page") {
      const domain = (await getTenant(tenantId).catch(() => null))?.domain?.trim();
      if (!domain) return { success: false, error: "Your website address could not be read just now, so this is not recorded yet. Press it again in a moment." };
      const checked = liveUrlFor(args.liveUrl ?? "", domain);
      if ("error" in checked) return { success: false, error: checked.error };
      liveUrl = checked.url;
    }
    // SHIPMENT FIRST, FLIP SECOND. Never the other way around.
    const appliedIds = args.componentIds !== undefined ? args.componentIds : ids;
    const shipment = await recordImplementation(tenantId, stored, { appliedIds, operatorNote: args.operatorNote, liveUrl });
    if (!shipment.ok) return { success: false, error: shipment.error };
    // A PARTIAL APPLY CLOSES NOTHING: applying one piece of five used to mark the whole change done, so the four they never touched
    // vanished. The change stays open carrying the rest, each subset measured alone, and the count is the TRUE remainder.
    const n = shipment.recorded, left = shipment.remaining;
    const one = (a: string, b: string) => (left === 1 ? a : b);
    if (!shipment.complete) {
      await invalidateCoreSurfaces().catch(() => {});
      revalidatePath("/changes");
      const landed = n > 0
        ? `Recorded the ${n} piece${n === 1 ? "" : "s"} you applied. ${n === 1 ? "It is" : "They are"} being measured.`
        : "Those pieces were already on file and are being measured.";
      return { success: true, note: `${landed} The other ${left} ${one("is", "are")} still on your list: tick ${one("it", "them")} here when you apply ${one("it", "them")}.` };
    }
    // THE LAST STEP, AND IT CARRIES THE RECORD'S OWN ID. A flip with nothing measuring behind it is refused by the store itself.
    const ok = await transitionProposalToImplemented(tenantId, args.proposalId, shipment.shipmentId, liveUrl);
    if (!ok) {
      return { success: false, error: "That change could not be found, so it was not marked implemented." };
    }
    await invalidateCoreSurfaces().catch(() => {});
    revalidatePath("/changes");
    revalidatePath("/", "layout");
    log.info("Action completed", { action, durationMs: Date.now() - t0, params: { proposalId: args.proposalId } });
    // A PRESS WITH NOTHING NEW IN IT IS NOT A SILENT SUCCESS: say plainly that it is already being measured.
    if (n === 0 && ids.length > 0) return { success: true, note: "Every piece of this change is already on file and being measured. There is nothing left for you to record here." };
    // AND A RECORD THAT CANNOT BE READ FAIRLY YET SAYS SO ON THE PRESS. The work is recorded either way, because what the operator applied is
    // a fact and whether Search data can compare it is a different fact; being quiet about the second one promises a reading nobody can take.
    return { success: true, note: measurementNote(shipment.measurement) };
  } catch (err) {
    // THE RAW MESSAGE GOES TO THE LOG AND NOWHERE ELSE: a table name is not an answer to a customer.
    log.error("markProposalImplemented: failed", { proposalId: args.proposalId, error: err instanceof Error ? err.message : String(err) });
    return { success: false, error: "That could not be recorded just now. Press it again in a moment." };
  }
}

/** THE NEXT PAGE OF THE RANKED QUEUE. Read-only, ONE page, cut at a rank offset inside the release the caller names. A release replaced
 *  since is answered with the fresh first page and the sentence saying so. */
export async function loadMoreChangesAction(args: {
  lane: "ready" | "todo"; cursor: number; releaseId?: string | null;
}): Promise<ChangesPage> {
  return readChangesPage(await currentTenantId(), args.lane, args.cursor, args.releaseId ?? null);
}

/** THE operator's "put this aside": the one terminal disposition that means exactly that, dismissed. Not a rejection by Beacon and not a
 *  lifecycle stage, so the change keeps its status, stops being the current answer, and the store refuses to re-draft that hypothesis until
 *  the evidence moves. ONLY WORK STILL WAITING ON THEM: a change already marked implemented is being measured, and is refused in their own
 *  words. */
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
    if (stored == null) return { success: false, error: "That change could not be found, so it was not skipped." };
    if (stored.status === "implemented_pending_verification") {
      return { success: false, error: "You already marked this one done, so it is being measured. It cannot be skipped while a reading is running." };
    }
    if (!(await dismissChangeProposal(tenantId, args.proposalId))) {
      return { success: false, error: "That one could not be skipped just now. Press it again in a moment." };
    }
    await invalidateCoreSurfaces().catch(() => {});
    revalidatePath("/changes");
    revalidatePath("/", "layout");
    log.info("Action completed", { action, params: { proposalId: args.proposalId } });
    return { success: true };
  } catch (err) {
    log.error("dismissProposal: failed", { proposalId: args.proposalId, error: err instanceof Error ? err.message : String(err) });
    return { success: false, error: "That one could not be skipped just now. Press it again in a moment." };
  }
}

/** Results-timeline "Mark shipped" confirms a previously-accepted recommended edit is live on the page, flipping its lifecycle to
 *  verified-live. Server-side publish authority is enforced (a stale UI cannot skip Accept). Distinct from the Changes-queue "Mark
 *  implemented" above: this operates on the persisted recommended_edits row linked to a changelog entry that Results renders. */
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
    return { success: false, error: "This change's history could not be read just now. Try it again in a moment." };
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
    return { success: false, error: "That could not be marked live just now. Try it again in a moment." };
  }
}
