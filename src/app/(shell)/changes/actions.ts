"use server";

import { createHash } from "node:crypto";

import { revalidatePath } from "next/cache";
import { log } from "@/lib/logger";
import { currentTenantId } from "@/lib/tenant-context";
import { canPublishForCurrentTenant } from "@/lib/auth/can-publish";
import { getRepository } from "@/lib/persistence/repositories";
import { actionableProposalFailures, answerReviewedProposal, componentIdOf, confirmedVersion, dangerousComponents, deliverableGaps, dismissChangeProposal, openHold, unsettledCause,
  loadChangeProposal, resolveCurrentBasis, sameComponentId, transitionProposalToImplemented,
  type ChangeProposal } from "@/domains/decision";
import { getTenant } from "@/domains/account";
import { captureChangeMeta, loadShippedChanges, objectiveOfStage, recordShipment, type MeasurementState } from "@/domains/measurement";
import { invalidateCoreSurfaces } from "../surface-release";
import { readChangesPage, type ChangesPage } from "../changes-data";

/** changes/actions: the manual "Mark implemented" action. Publishing authority is MANUAL and server-enforced: the kernel never writes a live page and never flips this itself. THE SHIPMENT TRANSACTION: the press writes a Shipment FIRST and flips the proposal SECOND, never the other way, because a crash between the two leaves a Shipment nobody flipped (which the next press heals) where the reverse leaves a change marked done that nothing on earth is measuring. And nothing lands at all unless the ONE verdict passes at this moment. `note` says what is still theirs to do after a PARTIAL apply, in their own words. */
type MarkProposalImplementedResponse = { success: boolean; error?: string; note?: string };

/** What one press landed: whether every piece is now on file, how many this press wrote, how many are genuinely still theirs to do (the remainder came off THIS press before, so press two of three said "the other 2" with one left), AND THE RECORD THAT IS MEASURING IT. The flip that follows will not run without that id, so a press can never close a change no record stands behind. */
type Shipped = { ok: true; complete: boolean; recorded: number; remaining: number; shipmentId: string; measurement: MeasurementState };

/** The exact version applied: its copy, its components, the basis it was drafted under AND THE PIECES THIS PRESS ACTUALLY APPLIED. Deliberately EXCLUDES status, so the flip that follows cannot change the id and a retry lands on the same record. Applying a different subset later is a DIFFERENT thing to measure, so it gets its own record instead of being silently swallowed by the first one. */
function shippedVersionOf(p: ChangeProposal, appliedIds: readonly string[]): string {
  const material = {
    change: p.recommendedChange,
    components: (p.bundle?.components ?? []).map((c) => [c.kind, c.before, c.after]),
    basis: p.basis ?? null,
    applied: [...appliedIds].sort(),
  };
  return createHash("sha256").update(JSON.stringify(material)).digest("hex").slice(0, 16);
}

/** WHERE THE NEW PAGE ACTUALLY LIVES. A page that did not exist has no address until the operator publishes it, so a new-page change marked done with no address left verification fetching the page LABEL as if it were a website. The address is owed, and it has to be one I can keep reading: on their own site, secure, and one plain page address with no query, because a tracking link is not the page. */
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

/** Write the Shipment for one proposal. Idempotent: the id is derived from the proposal and the version applied, so a retry keeps the stamp and the starting numbers already on file, and the caller flips nothing when it did not land. A SECOND PRESS DOES NOTHING AT ALL: rebuilding the record erased the live check back to null, moved the ship date to today and recomputed the starting numbers over a window that now included days AFTER the change, so pressing twice quietly flattered its own result. */
async function recordImplementation(tenantId: string, proposal: ChangeProposal,
  opts: { appliedIds: readonly string[]; operatorNote?: string | null; liveUrl?: string },
): Promise<Shipped | { ok: false; error: string }> {
  const bundleIds = (proposal.bundle?.components ?? []).map(componentIdOf);
  try {
    // FAIL CLOSED ON THE DUPLICATE CHECK. A ledger I could not read is not proof there is no prior record: writing blind resets the live check and moves the ship date, the exact bug this lookup exists to stop.
    const ledger = await loadShippedChanges();
    // WHAT IS ALREADY ON FILE COMES OUT OF THIS PRESS: the picker offers every piece by default, so a partial press followed by the obvious next one wrote a SECOND record measuring the same component twice, and no screen can cause that now whatever it sends. The same id twice in one press is one piece too, so a repeated pick cannot mint a second version of one record. NAMES ARE COMPARED ACROSS ERAS. A piece recorded before its exact copy was part of its name can only ever be compared at the precision it was written with; two names of today's era compare whole, so a redrafted piece is genuinely new work and is measured.
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
    // Every component unless the operator named the ones they applied; an atomic change has no bundle, so the change itself is its one component. THE EXACT COPY TRAVELS, because verifying is comparing what was proposed against what is on the page. THE RISK GRADE TRAVELS TOO: measurement saw only the kind, so a dangerous grade on an ordinary kind lost its day-56 follow up.
    const all = proposal.bundle?.components.map((c, i) => ({ id: componentIdOf(c, i), kind: c.kind, label: c.label, after: c.after ?? null, risk: c.risk ?? null,
      // A renamed link is verified against the words that should now be ON it, so those words ride along.
      ...(c.anchorAfter ? { anchorAfter: c.anchorAfter } : {}),
      // AND A FORWARD RIDES WITH ITS DESTINATION. Without it the live check read the first address out of the sentence, which is the one being MOVED, and graded a correct forward as a wrong one.
      ...(c.redirectTo ? { redirectTo: c.redirectTo } : {}) }))
      // An atomic change has no component to carry a grade, so it reads null rather than a guess.
      ?? [{ id: null, kind: proposal.changeFamily, label: proposal.opportunityType, after: proposal.recommendedChange?.kind === "existing_edit" ? proposal.recommendedChange.after : null, risk: null }];
    const componentsApplied = bundleIds.length > 0 ? all.filter((c) => c.id != null && covers(fresh, c.id)) : all;

    // The page as Beacon already holds it: canonical URL, path and the content hash from the last crawl, nothing fetched. THE OPERATOR'S OWN ADDRESS WINS for a new page: it is the only one that exists.
    const pageRef = (opts.liveUrl ?? proposal.pageUrl ?? proposal.pagePath ?? "").trim();
    const meta = pageRef ? await captureChangeMeta(tenantId, pageRef).catch(() => null) : null;
    const change = proposal.recommendedChange;

    // THE ONE DOOR THAT WRITES A SHIPMENT. It always writes and always answers with the row's id, so an implementation the operator really made is recorded whatever the search data can support; whether it can be fairly compared comes back beside it and is said out loud rather than used to refuse the record. Idempotent on (proposal, version): a retry lands on the row already on file.
    const landed = await recordShipment({
      tenantId, proposalId: proposal.id, proposalVersion: version,
      page: opts.liveUrl ?? meta?.canonPage ?? proposal.pageUrl ?? proposal.pageLabel,
      path: opts.liveUrl ? new URL(opts.liveUrl).pathname : meta?.path ?? proposal.pagePath ?? proposal.pageLabel,
      actionType: proposal.changeFamily,
      before: change.kind === "existing_edit" ? change.before : null,
      after: change.kind === "existing_edit" ? change.after : change.proposedTitle,
      // THE AI QUESTIONS RIDE TOO: the shipment's AI outcome joins observations on the tracked question texts, and dropping scope.prompts here left every future Result's AI half permanently dark.
      targetQueries: [proposal.primaryQuery, ...(proposal.bundle?.scope.queries ?? []), ...(proposal.bundle?.scope.prompts ?? [])]
        .filter((q, i, xs) => q && xs.indexOf(q) === i).slice(0, 10),
      basis: proposal.basis ?? null,
      // A new page answers a research case; an edit's subject is its own page.
      caseId: proposal.kind === "new_page" ? (proposal.id.split("::")[1]?.trim().toLowerCase() || null) : null,
      bundleHypothesis: proposal.bundle?.objective ?? proposal.whyItMatters,
      // THE YARDSTICK IS DECLARED AT THE PRESS, AND IT IS THE CARD'S OWN. Every AI card used to be judged on
      // mentions, so a change raised because rivals were cited and this site was never read was graded a win
      // the moment it was named more often, which is the thing it was already doing. The stage the card was
      // minted in names the metric; everything else is judged on clicks. Results reads the declaration.
      // ONE SOURCE, because two can disagree: the metric came off `aiImpact` while the baseline is frozen over
      // `aiScope`, so a card carrying one and not the other, or two different stages, shipped a change judged
      // on one thing and measured on another (reviewer, 2026-08-19). `aiScope.stage` is the canonical one:
      // it is the same scope the baseline and every later reading are taken over.
      judgedMetric: proposal.aiScope ? objectiveOfStage(proposal.aiScope.stage) : "clicks",
      // THE TYPED AI SCOPE RIDES WHOLE: prompt ids, assistants and the fan-out cluster, exactly as the card
      // claimed them. Flattening these into the ten targetQueries strings was how a shipment lost which
      // assistants and which follow-up searches its own result must be read on.
      aiScope: proposal.aiScope ?? null,
      componentsApplied,
      preChangeContentHash: meta?.contentHash ?? null,
      // THE NOTE TRAVELS WITH THE PRESS, and nothing else does: their own words ride along BESIDE the reading, and Beacon still goes and looks at the page itself before it says anything.
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

/** What the press says about the reading it just started. THE HEALTHY PATH NAMES THE DATE: "Marked done" with no
 *  promise left the operator with no idea when anything would come back, and the one question after applying a
 *  change is "when do I hear whether it worked" (blind customer review, 2026-08-25). The first proof window is
 *  7 days and search data trails the live site by about 3 more, so the date is day 10, on Results. */
function measurementNote(state: MeasurementState): string {
  if (state === "insufficient_comparison") return "Recorded. Too few pages on your site can be fairly compared against this one yet, so the reading starts as soon as enough of them have search data.";
  if (state === "measurement_unavailable") return "Recorded. Your search data could not be read just now, so the reading starts as soon as it can be.";
  if (state === "verification_needed") return "Recorded. The page is checked next, and the reading starts from what is found there.";
  const lands = new Date(Date.now() + 10 * 86_400_000).toLocaleDateString("en-US", { month: "long", day: "numeric" });
  return `Recorded, and the page is being watched. The first reading lands on Results around ${lands}; search data takes a few days to catch up with the live site.`;
}

/** Record that the operator applied a change. THE CLAIM STARTS THE CHECK AND NEVER ENDS IT: whatever arrives here, the Shipment is written with no verification on it, so Beacon still reads the live page itself. */
export async function markProposalImplementedAction(args: {
  proposalId: string;
  /** WHICH PIECES THEY ACTUALLY APPLIED, by the stable id each piece carries inside its stored bundle. ABSENT means all of them; anything else is intersected against the bundle on file and refused when it selects nothing, so a hand-made list can no longer conjure an empty selection past the confirmation. */
  componentIds?: string[];
  /** What they actually put on the page, in their own words. A note beside the reading, never instead of it. */
  operatorNote?: string;
  /** RETIRED, and accepted only so an old page still open in a browser is not an error. It used to suppress the live check; it does nothing now, and the check runs either way. */
  operatorConfirmed?: boolean;
  /** THE ONE CONFIRMATION THAT IS REAL. Set only by an operator who ticked the box beside a piece that moves or hides a page. Enforced HERE, on the server: a stale screen or a hand-made request cannot merge or redirect a page merely because it reached this action. */
  destructiveConfirmed?: boolean;
  /** WHERE THE NEW PAGE IS LIVE. Required for a new page, which has no address until they publish it. */
  liveUrl?: string;
  /** Set only by the many-at-once path below, which rebuilds the surfaces ONCE after the whole batch instead of once per card. Harmless if a client sets it: that path always rebuilds afterwards. */
  deferSurfaces?: boolean;
}): Promise<MarkProposalImplementedResponse> {
  const action = "markProposalImplemented";
  const t0 = Date.now();
  log.info("Action started", { action, params: { proposalId: args.proposalId } });

  // Same server-side publish authority the push path carries: a stale or hand-crafted client request cannot mark work live merely because it reached the server action.
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
    // THE VERDICT IS ASKED AT THE MOMENT OF THE MUTATION, not only where the screen was drawn. The button lives on a page that could have been open since before the bar moved or before this change's own receipt stopped resolving, and recording it would push a change I no longer stand behind into the proof ledger, where it would be measured and counted for weeks. No shipment lands unless this passes.
    if (stored.status !== "implemented_pending_verification"
      && actionableProposalFailures(stored, { tenantId, currentBasis: basis }).length > 0) {
      return { success: false, error: "This change was skipped, so it is not being recorded. Open Changes for the work that stands today." };
    }
    // AN UNFINISHED DELIVERABLE IS NOT WORK SOMEBODY CAN HAVE DONE. The ONE completeness boundary decides, so the typed research fact, an instruction where the copy should be, a blank left to fill and a page whose sections were never written are all refused by the same rule the queue and the card ask. A stale tab or a hand-made request cannot start a 28 day reading of work Beacon never wrote, and a generic instruction can never reach measurement because it can never be recorded here.
    const gaps = deliverableGaps(stored);
    if (gaps.length > 0) return { success: false, error: `Beacon has not finished this one yet, so there is nothing to record as done: ${gaps[0]}. It lands in your list as a change once the exact work is written.` };
    // AND A CHANGE THAT LEAVES ITS OWN DIAGNOSED CAUSE UNSETTLED IS NOT WORK EITHER. The queue holds it for review and says nothing there can be marked done; this is where that promise is kept, so a tab open since before the hold cannot start a 28 day reading of a split nobody settled.
    const unfit = unsettledCause(stored) ?? (stored.status === "ready" ? ((h) => h.safetyHold ? null : h.blocking)(openHold(stored)) : null);
    if (unfit) return { success: false, error: unfit }; // the SAME one servability verdict the list lanes by and the detail renders: a read-time hold minted between saves refuses the press too, so a 28 day reading can never start on copy Beacon's own gate refuses. Review rows fall to the lane refusal below, which is their honest answer.
    // AND THE LANE ITSELF IS THE RULE, not two of the reasons a row lands in it. Completeness and the unsettled cause are why MOST review cards are held, and this action asked only those two: a complete card that never earned `ready` (no producer promoted it, or a gate this pass could not run) was recordable through a direct link and would have started a 28 day reading of work nobody stood behind. Only `ready` is work somebody can have done; an already recorded row still replays idempotently below, so a double press is never an error.
    if (stored.status !== "ready" && stored.status !== "implemented_pending_verification") {
      return { success: false, error: "This change is still being reviewed, so it cannot be marked done yet. Open Changes for the work that is ready to make today." };
    }
    // WHAT THEY SAY THEY APPLIED IS CHECKED AGAINST WHAT I HOLD. The server used to take the caller's word for a list of KINDS, so a hand-built list nobody could have ticked selected nothing, walked past the confirmation below and closed the whole change. Ids are derived from the stored bundle HERE.
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
    // A CHANGE THAT MOVES OR HIDES A PAGE OWES A DELIBERATE YES, and so does one graded dangerous on its own terms. The canonical rule is the grade OR the kind OR a correction to a high-stakes fact; the four hardcoded kinds this used to check let every one of the others through without a tick.
    if (dangerousComponents(applied).length > 0 && args.destructiveConfirmed !== true) {
      return { success: false, error: "This one moves or hides a page, so it needs your confirmation before it is recorded. Open the change, tick the confirmation, and press it again." };
    }
    // THE ADDRESS GATE RUNS BEFORE ANYTHING IS WRITTEN, because the shipment is written first and a shipment pointing at a page label is a reading I can never take.
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
    // A PARTIAL APPLY CLOSES NOTHING: applying one piece of five used to mark the whole change done, so the four they never touched vanished. The change stays open carrying the rest, each subset measured alone, and the count is the TRUE remainder.
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
    if (!args.deferSurfaces) { await invalidateCoreSurfaces().catch(() => {}); revalidatePath("/changes"); revalidatePath("/", "layout"); }
    log.info("Action completed", { action, durationMs: Date.now() - t0, params: { proposalId: args.proposalId } });
    // A PRESS WITH NOTHING NEW IN IT IS NOT A SILENT SUCCESS: say plainly that it is already being measured.
    if (n === 0 && ids.length > 0) return { success: true, note: "Every piece of this change is already on file and being measured. There is nothing left for you to record here." };
    // AND A RECORD THAT CANNOT BE READ FAIRLY YET SAYS SO ON THE PRESS. The work is recorded either way, because what the operator applied is a fact and whether Search data can compare it is a different fact; being quiet about the second one promises a reading nobody can take.
    return { success: true, note: measurementNote(shipment.measurement) };
  } catch (err) {
    // THE RAW MESSAGE GOES TO THE LOG AND NOWHERE ELSE: a table name is not an answer to a customer.
    log.error("markProposalImplemented: failed", { proposalId: args.proposalId, error: err instanceof Error ? err.message : String(err) });
    return { success: false, error: "That could not be recorded just now. Press it again in a moment." };
  }
}

/** MANY AT ONCE, BECAUSE THAT IS HOW AN OPERATOR ACTUALLY WORKS. Every card owned its own server action, and
 *  Next runs those strictly one at a time, so twenty cards meant twenty round trips, twenty ledger reads and
 *  twenty full surface rebuilds: thirty to sixty seconds of "Saving..." for work the operator finished in one
 *  sitting. The recording underneath stays ATOMIC, one shipment per change exactly as before; what is shared is
 *  the trip and the rebuild. IDEMPOTENT by construction: a change already being measured answers that it is,
 *  and says so per id rather than failing the batch. A press that records nothing still rebuilds nothing. */
export async function markManyImplementedAction(args: { proposalIds: string[]; operatorNote?: string }): Promise<{ success: boolean; done: number; already: number; failed: { id: string; error: string }[]; note: string }> {
  const ids = [...new Set((args.proposalIds ?? []).filter((x) => typeof x === "string" && x.trim()))];
  if (ids.length === 0) return { success: false, done: 0, already: 0, failed: [], note: "No changes were selected." };
  if (!(await canPublishForCurrentTenant())) return { success: false, done: 0, already: 0, failed: [], note: "You do not have permission to mark these changes implemented." };
  const failed: { id: string; error: string }[] = []; let done = 0, already = 0;
  // BOUNDED, and small on purpose: every one of these writes a shipment and reads the ledger, so a wide fan-out
  // would trade the operator's wait for the database's. Four at a time is fast and cannot stampede.
  for (let i = 0; i < ids.length; i += 4) {
    const slice = ids.slice(i, i + 4);
    const answers = await Promise.all(slice.map(async (id) => ({ id,
      r: await markProposalImplementedAction({ proposalId: id, deferSurfaces: true, ...(args.operatorNote ? { operatorNote: args.operatorNote } : {}) })
        .catch((e: unknown) => ({ success: false as const, error: e instanceof Error ? e.message : "that could not be recorded" })) })));
    for (const { id, r } of answers) {
      if (!r.success) failed.push({ id, error: r.error ?? "that could not be recorded" });
      else if ((r.note ?? "").includes("already on file")) already += 1; else done += 1; }
  }
  if (done > 0 || already > 0) { await invalidateCoreSurfaces().catch(() => {}); revalidatePath("/changes"); revalidatePath("/", "layout"); }
  const parts = [done > 0 ? `${done} recorded` : null, already > 0 ? `${already} already being measured` : null,
    failed.length > 0 ? `${failed.length} could not be recorded` : null].filter(Boolean);
  return { success: failed.length < ids.length, done, already, failed, note: `${parts.join(", ")}.` };
}

/** STEP TWO OF THE TWO-STEP HOLD, AND THE ONLY WAY A CHANGE THAT MOVES OR HIDES A PAGE BECOMES WORK. Step one has always existed: a redirect, a merge, a canonical or a de-index is minted `needs_review` and the queue says so. Step two did not, so every one of them was held for a confirmation nobody could give and none could ever be pasted. The operator reads the pieces, the addresses, the destination, the copy, the risks and the evidence on the change's own detail page and confirms THAT version. NOTHING IS TRUSTED FROM THE SCREEN: the row is re-read here and every gate is asked again at the moment of the mutation, because the page could have been open since before the copy was redrafted, before the cause was re-judged or before the bar moved. Never automatic: this runs on a press and on nothing else. */
export async function confirmDangerousChangeAction(args: { proposalId: string; version: string }): Promise<MarkProposalImplementedResponse> {
  if (!(await canPublishForCurrentTenant())) return { success: false, error: "You do not have permission to confirm this change." };
  if (!args.proposalId || !args.version) return { success: false, error: "No change was specified." };
  const tenantId = await currentTenantId();
  try {
    const basis = await resolveCurrentBasis(tenantId).catch(() => null);
    const stored = await loadChangeProposal(tenantId, args.proposalId).catch(() => null);
    if (stored == null) return { success: false, error: "That change could not be found, so nothing was confirmed." };
    // THE LANE IS THE PERMISSION, AND ONLY THE DANGEROUS KIND MAY LEAVE IT THIS WAY. Work already ready, already done or already put aside is not up for a confirmation, and ordinary work sits in review because a quality gate held it: confirming that would promote copy nobody stands behind past the very gate that held it. AN UNFINISHED CHANGE IS NOT ONE ANYBODY CAN CONFIRM either, and neither is one that leaves its own diagnosed cause unsettled: the same two boundaries the queue and Mark done both ask, asked here at the moment of the mutation.
    if (stored.status !== "needs_review") return { success: false, error: "This one is not waiting for your confirmation. Open Changes for the work that stands today." };
    if (dangerousComponents(stored.bundle?.components ?? []).length === 0) return { success: false, error: "This one does not move or hide a page, so there is nothing here to confirm. It is being reviewed for another reason." };
    // UNFINISHED WORK AND AN UNSETTLED CAUSE ARE ASKED AGAIN, DIRECTLY, BY THE STORE BELOW: no separate pre-check is owed here. THE YES BINDS TO ONE EXACT VERSION: the copy, where it lands, the pieces, the destination, the risk grades, the risks, the caveats, the steps, the claims and the words behind them, the readings and the basis it was given for. Anything moved since makes it stale, and the SCREEN is answered here so a stale tab reads the plain sentence rather than a race it never ran into. THE PROMOTION ITSELF IS ONE COMPARE-AND-SET IN THE STORE: it re-reads the row, asks the row's own integrity of the PROMOTED version (whose change this is, the bar it was drafted under, whether its readings still stand), and writes only while the row is still the exact version that was confirmed. A rewrite landing in between changes nothing and is never overwritten.
    const stale = "This change has been rewritten since that screen was drawn, so your confirmation is not being applied to it. Open it again, read the new version, and confirm that one.";
    if (confirmedVersion(stored) !== args.version) return { success: false, error: stale };
    const done = await answerReviewedProposal(tenantId, args.proposalId, args.version, basis, { kind: "promote", at: new Date().toISOString() });
    if (done.status === "stale") return { success: false, error: stale };
    if (done.status === "refused") return { success: false, error: done.refusal! };
    if (done.status !== "promoted") { log.error("confirmDangerousChange: the confirmation did not land", { proposalId: args.proposalId }); return { success: false, error: "That could not be confirmed just now. Press it again in a moment." }; }
    await invalidateCoreSurfaces().catch(() => {});
    revalidatePath("/changes"); revalidatePath("/", "layout");
    return { success: true, note: "Confirmed. This change is ready to make, and the copy is on the card." };
  } catch (err) {
    log.error("confirmDangerousChange: failed", { proposalId: args.proposalId, error: err instanceof Error ? err.message : String(err) });
    return { success: false, error: "That could not be confirmed just now. Press it again in a moment." };
  }
}

/** THE OPERATOR'S ANSWER TO A DRAFT THEY READ. TWO ANSWERS, ONE DOOR: `approve` says the words are good enough to make and `improve` asks the next funded pass to write better ones over them. THE BOUNDARY IS SERVER-ENFORCED AND NOT A UI RULE: a human yes may answer EDITORIAL judgement (how it reads, whether anybody would hand it to a customer) and may never answer a fact about the work, so the row is re-read here, its own stored reasons are split into hard and soft by the ONE pure rule the card renders from, and a hard hold refuses with that exact reason. A change that moves or hides a page keeps its own version-bound confirmation and is refused here. The promotion itself is the SAME compare-and-set the confirmation uses: the yes binds to the exact version that was read, and a rewrite landing in between changes nothing. */
export async function reviewDraftAction(args: { proposalId: string; version: string; decision: "approve" | "improve" }): Promise<MarkProposalImplementedResponse> {
  if (!(await canPublishForCurrentTenant())) return { success: false, error: "You do not have permission to answer this draft." };
  if (!args.proposalId || !args.version) return { success: false, error: "No draft was specified." };
  const tenantId = await currentTenantId();
  try {
    const basis = await resolveCurrentBasis(tenantId).catch(() => null);
    const stored = await loadChangeProposal(tenantId, args.proposalId).catch(() => null);
    if (stored == null) return { success: false, error: "That draft could not be found, so nothing was changed." };
    if (stored.status !== "needs_review") return { success: false, error: "This one is not waiting on your review. Open Changes for the work that stands today." };
    const hold = openHold(stored);
    if (hold.lane === "research") return { success: false, error: "Nothing exact is written for this one yet, so there is no draft to answer. It is being researched and lands in your list as a change once the work is written." };
    const stale = "This draft has been rewritten since that screen was drawn, so your answer is not being applied to it. Open it again, read the new version, and answer that one.";
    if (confirmedVersion(stored) !== args.version) return { success: false, error: stale };
    const at = new Date().toISOString();
    if (args.decision === "approve") {
      // THE HARD HOLDS, REFUSED BY NAME. Approving one would promote copy past the very check that holds it.
      if (hold.blocking) return { success: false, error: `This one is not yours to wave through: ${hold.blocking} Ask for a better draft instead, or skip it.` };
      const who = (await getTenant(tenantId).catch(() => null))?.domain?.trim() || tenantId;
      const done = await answerReviewedProposal(tenantId, args.proposalId, args.version, basis, { kind: "promote", by: who, at });
      if (done.status === "stale") return { success: false, error: stale };
      if (done.status === "refused") return { success: false, error: done.refusal! };
      if (done.status !== "promoted") return { success: false, error: "That could not be approved just now. Press it again in a moment." };
    } else {
      const done = await answerReviewedProposal(tenantId, args.proposalId, args.version, basis, { kind: "redraft", at });
      if (done.status === "stale") return { success: false, error: stale };
      if (done.status !== "promoted") return { success: false, error: "That could not be sent back just now. Press it again in a moment." };
    }
    await invalidateCoreSurfaces().catch(() => {});
    revalidatePath("/changes"); revalidatePath("/", "layout");
    return { success: true, note: args.decision === "approve"
      ? "Approved. It is ready to make, the copy is on the card, and your name is on the approval."
      : "Sent back for better words. The next drafting pass writes over this one, and the draft you read stays here until it does." };
  } catch (err) {
    log.error("reviewDraft: failed", { proposalId: args.proposalId, error: err instanceof Error ? err.message : String(err) });
    return { success: false, error: "That could not be saved just now. Press it again in a moment." };
  }
}

/** THE NEXT PAGE OF THE RANKED QUEUE. Read-only, ONE page, cut at a rank offset inside the release the caller names. A release replaced since is answered with the fresh first page and the sentence saying so. */
export async function loadMoreChangesAction(args: {
  lane: "ready" | "todo" | "all"; cursor: number; releaseId?: string | null;
}): Promise<ChangesPage> {
  return readChangesPage(await currentTenantId(), args.lane, args.cursor, args.releaseId ?? null);
}

/** THE operator's "put this aside": the one terminal disposition that means exactly that, dismissed. Not a rejection by Beacon and not a lifecycle stage, so the change keeps its status, stops being the current answer, and the store refuses to re-draft that hypothesis until the evidence moves. ONLY WORK STILL WAITING ON THEM: a change already marked implemented is being measured, and is refused in their own words. */
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
