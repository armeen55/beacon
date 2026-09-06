/** decision/load-proposals (CORE 100K cutover, 2026-07-22): the ONE read path the live surfaces (Changes + Today) consume. It loads the persisted, re- validated ChangeProposals for a tenant, ranks them by honest value, and partitions them into the operator-facing lifecycle: ready     validated safe, every hold answered: act now. toDo      the exact copy exists and a judgement or one named check stands between it and ready. research  a real ranked signal with nothing exact written for it yet. VISIBLE, never a bare count. (a withdrawn draft is history and never surfaces; an implemented one has moved to the ledger.) Every lane above holds CURRENT-BASIS work only. A proposal drafted under an older basis, one carrying no basis, and every proposal at all when the current basis cannot be read are withheld from the queue and counted, never shown as work to do. The "measuring / decided" side of the lifecycle lives in the proof-gsc ledger (a shipped change under measurement), NOT here: a proposal the operator applied is recorded as a shipped change and measured there. This module owns only the pre-ship queue. PURE partition over a fail-soft load. server-only (reads the proposal store). */

import "server-only";

import { basisTag, getTenant, loadBusinessProfile, type BusinessProfile } from "@/domains/account";
import { loadChangeProposals } from "./proposal-store";
import { rankProposals } from "./rank-proposals";
import { actionableProposalFailures, validateProposal } from "./validate-proposal";
import { openHold } from "./completeness";
import { footprintsOverlap, mutationFootprint } from "./mutation-footprint";
import { CAUSE_LEVERS, unsettledCause, withholdReason } from "./authorization";
import type { ChangeProposal } from "./contracts";

/** The DECISION generation this kernel proposes under. It rides on the basis stamp, so every proposal manufactured under an earlier generation's rules is unsupported history the moment those rules change: it can never render Ready, it is demoted in presentation only, and no row is rewritten or deleted. Bump ONLY when the rules that decide WHAT earns a proposal change. 1 = every owned page over 20 impressions got a title and a description. 2 = a proposal exists only where exact query rows proved a recoverable gap. 3 = a proven gap is an INVESTIGATION until the live results page for that exact search is held; confidence follows evidence completeness, not the draft. 4 = holding that results page is not reading it. A change exists only where the page was DIAGNOSED off what those results actually say, so every proposal picked by whether the search words appeared in the stored title is history. 5 = no new page is proposed at all. Turning a competitor's example prompt into a page shipped duplicates of pages the account already owned, so generation is deleted until the evidence can prove a distinct page should exist. 6 = a new page is proposed again, and ONLY where the page by page comparison proved the winning pages share searches no page of this account reaches. Every page brief drafted under any earlier rule is history. 7 = what earns a change is picked against the account's own trusted curve, a proven fall reaches its own rung instead of falling through to more copy, a measured page earns nothing, and a split is settled off the words BOTH pages carry. 8 = a merge may move nothing. Winning ONE search never makes a page the home for a whole other page, so a redirect is earned only where the survivor already carries every section the loser carries; anything else is told apart instead. */
const DECISION_GENERATION = 8;

/**
 * The account's CURRENT research basis, or null when it cannot be read. Composes exactly what Runtime and the Evidence funnel compose, so one basis serves every
 * kernel, plus the decision generation above. Null on purpose when the account cannot be read: I cannot prove a single stored proposal is current, and the
 * queue below treats that as nothing to show rather than everything to show.
 */
export async function resolveCurrentBasis(
  tenantId: string,
  profile?: BusinessProfile | null,
): Promise<string | null> {
  try {
    const account = await getTenant(tenantId);
    const domain = account?.domain?.trim();
    if (!account || !domain) return null;
    const p = profile ?? (await loadBusinessProfile(tenantId));
    return `${basisTag(account.id, domain, p, account.growth_goal ?? null)}::d${DECISION_GENERATION}`;
  } catch {
    return null;
  }
}

/** THE MEASUREMENT WINDOW: the longest reading Beacon takes on an applied change. Past it, that page is
 *  no longer measuring anything, so it may not discount the next change forever. */
const MEASUREMENT_WINDOW_DAYS = 28;

/** WHAT EACH KIND OF CHANGE HAS ACTUALLY DONE ON THIS ACCOUNT, off its own finished readings. The producing pass has always handed this to the ranking and the SCREEN never did, so every card the operator actually read was ranked as though the account had no track record at all. Same ledger, same rule, and now the SAME FUNCTION the producing pass calls: two copies of this walk lived in two files and could drift apart on any change to what counts as a reading. THE REQUEST-CACHED READ, because this runs on every render of every queue surface and the uncached one would re-read the whole ledger each time. Fail-soft to nothing: "I could not read the ledger" is never "this kind of change has done nothing". */
async function familyHistoryFor(tenantId: string): Promise<Map<string, { readings: number; netLift: number }>> {
  const ledger = await import("@/domains/measurement/proof-gsc/load-ledger").then((m) => m.loadProofLedgerCached(tenantId)).catch(() => null);
  if (!ledger) return new Map();
  return (await import("@/domains/measurement/treatment-learning")).learningFromShipments(ledger.map((r) => r.judgedMetric != null && r.judgedMetric !== "clicks" ? { ...r, windows: [] } : r)); // THE SAME REFUSAL THE PRODUCING PASS MAKES (decision/produce-proposals, `familyHistoryOf`): a change judged on assistants hands the click record none of its Google movement. The two doors read one ledger and must read it the same way, or the screen ranks on a record the pass refused.
}

/**
 * THE PAGES STILL UNDER MEASUREMENT, out of rows the caller already holds (no read, no kernel crossed). A page counts only while its implemented change is inside the window above: a row of ANY age used
 * to discount its page forever, so a change shipped six months ago quietly buried every later change to
 * the same page. A proposal carries no implemented-at stamp of its own, so its `createdAt` is the only date on file and it is read as the earliest the measurement can have started; a row with no readable date
 * counts as nothing, because "I cannot tell when" is never proof that something is being read now. PURE.
 */
export function pagesUnderMeasurement(
  proposals: Iterable<ChangeProposal>,
  now: Date = new Date(),
): string[] {
  const floor = now.getTime() - MEASUREMENT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  return [...proposals]
    .filter((p) => p.status === "implemented_pending_verification" && !!p.pagePath && Date.parse(p.createdAt) >= floor)
    .map((p) => p.pagePath as string);
}

/** WHAT COUNTS AS STOCK. The target is the five HIGHEST-IMPACT actionable changes, not five objects: four metadata
 *  rewrites and a title filled every slot, the deficit read zero, and the substantive body work the ranking itself
 *  scores higher could never fund again. A thin lever (a title, a description, a heading) is real work and counts,
 *  but at most THIN_STOCK_MAX of them may fill the stock; past that, the remaining slots belong to substantive
 *  changes, so the deficit keeps the drafting alive until the queue holds work worth the operator's morning. */
const THIN_LEVER_FIELD = new Set(["title", "meta", "h1"]); const THIN_STOCK_MAX = 3;
export function stockOf(ready: readonly ChangeProposal[]): number {
  const thin = ready.filter((p) => p.recommendedChange.kind === "existing_edit" && THIN_LEVER_FIELD.has(p.recommendedChange.field)).length;
  return (ready.length - thin) + Math.min(THIN_STOCK_MAX, thin);
}

/** WHAT THE ROWS THEMSELVES ALREADY ANSWERED ABOUT THE DAY'S UNSETTLED WORK (2026-09-05). A walk the caller's box cut off keeps
 *  running: the job in flight lands its row a minute after the drive stopped waiting, and the day remembered that attempt as
 *  `retryable_blocked`, so the next drive funded the same work again and paid a second time for words already on file. The answer
 *  is on the row and nowhere else. A live row carrying that exact `workKey` IS what this work produces under this exact evidence
 *  (the identity carries the page, the evidence, the family, the treatment, the cause and the search), so the memory takes the
 *  row's own answer: `produced` where the row stands ready, and the draft it saved where a named check or a person still stands
 *  between those words and ready. A key with no row of its own is untouched and still owed, and a row that owes a corrective
 *  redraft wears a different identity, so settling here can never write off the work that redraft is.
 *  AND ONLY A ROW THIS DAY'S WORK COULD HAVE WRITTEN MAY SETTLE IT (reviewer, 2026-09-05). With no moment to measure against, a
 *  ready row standing since an earlier day settled today's blocked job, so a drive that produced nothing read as produced on its
 *  own receipt and the day memory could repeat it. The row has to stand at or after the moment the caller names: its own update
 *  moment where the store carries one, and the moment it was created otherwise. A row that can say neither settles nothing. */
export function settledByRows(
  memory: Readonly<Record<string, { calls: number; last: string; settled: boolean }>>,
  rows: { ready: readonly ChangeProposal[]; toDo?: readonly ChangeProposal[] },
  /** THE MOMENT A ROW MUST STAND AT OR AFTER: the drive's own start where the caller holds one, and the start of the day this memory belongs to where it does not. Omitted, it is today's start, because a day memory is only ever read back on the day that wrote it. */
  since: Date | string | number = new Date().toISOString().slice(0, 10),
): Record<string, { calls: number; last: string; settled: boolean }> {
  const floor = new Date(since).getTime();
  const stood = (p: ChangeProposal): boolean => Date.parse((p as { updatedAt?: string }).updatedAt ?? p.createdAt) >= floor;
  const landed = new Map<string, string>();
  for (const p of rows.toDo ?? []) if (p.workKey && stood(p)) landed.set(p.workKey, "review_saved");
  for (const p of rows.ready) if (p.workKey && stood(p)) landed.set(p.workKey, "produced");
  const out = { ...memory };
  for (const [key, m] of Object.entries(out)) {
    const answer = landed.get(key);
    if (answer && !m.settled && m.calls > 0 && m.last === "retryable_blocked") out[key] = { ...m, last: answer, settled: true };
  }
  return out;
}

export type RankedProposalQueue = {
  /** Every live CURRENT-BASIS proposal, ranked most-valuable first. */
  ranked: ChangeProposal[];
  /** Validated-safe, exact-copy-ready proposals (status "ready"). */
  ready: ChangeProposal[];
  /** DRAFTS TO REVIEW: the exact copy is written and something still stands between it and ready, either a
   *  person's judgement or one named check. Shown in full, never called finished. */
  toDo: ChangeProposal[];
  /** OPPORTUNITIES BEING RESEARCHED: a real ranked signal with no finished copy yet. Shown in full with what
   *  is known, what is missing and what happens next, never offered as work and never collapsed to a count. */
  research: ChangeProposal[];
  /** Marked implemented and not yet checked on the live page. Counted, never queued: it is
   *  the operator's claim awaiting my reading, so it belongs on the lifecycle line, not the list. */
  implementedPendingVerification: number;
  /** How many live rows I set aside instead of queueing, because I cannot show
   *  they were drafted under the basis I hold now (surfaces say this out loud). */
  demotedStaleBasis: number;
  /** TRUE when the account's current basis could not be read at all. The queue is
   *  empty because I cannot tell what is current, NOT because I raised the bar. */
  basisUnreadable: boolean;
};

/** Load + rank + partition a tenant's proposal queue. Fail-soft → empty queue.
 *  `deps.currentBasis` is injectable for tests; production resolves the account's
 *  live basis. */
export async function loadProposalQueue(
  tenantId: string,
  /** `now` is a SEAM, not a setting: the age of a change's own readings is judged against it, so a caller with a fixed clock reads the same queue every time it asks. Production passes nothing and gets the real moment, exactly as before. */
  deps: { currentBasis?: string | null; now?: Date } = {},
): Promise<RankedProposalQueue> {
  const now = deps.now ?? new Date();
  const currentBasis =
    deps.currentBasis !== undefined ? deps.currentBasis : await resolveCurrentBasis(tenantId);
  const byId = await loadChangeProposals(tenantId).catch(() => new Map<string, ChangeProposal>());
  const live = [...byId.values()].filter((p) => p.status !== "implemented_pending_verification");
  // Your queue is CURRENT WORK ONLY. A proposal enters it only when I can show it was drafted under the basis this account holds right now. An older basis, no basis at all, and a current basis I could not read all SET THE ROW ASIDE. Unreadable fails closed: being unable to read the basis is not proof anything is current, it is proof I cannot tell, so I show you nothing rather than guess. A set-aside row keeps its words, its status and its history: no stored row is rewritten or deleted, it just stops presenting as work waiting on you, and it is counted below so I can say so. A NEW PAGE PASSES THE SAME BAR TWICE. Under generation 6 a page brief may be work again, but only one built to today's evidence contract: the earned verdict it came from, an outline, and every piece tracing to a receipt item. A brief carrying none of that is an older idea however current its basis looks, and reviving the ones that turned a rival's example question into an article is the worst thing this queue could do, so it is refused here and still COUNTED below. AND EVERY DEEP CHANGE PASSES ITS OWN RECEIPT AT READ TIME. A stored bundle whose claims stopped resolving kept rendering exactly as written until something re-selected its page, so the screen is the safety net: a row that cannot show its work is withheld here whatever the producer pass has had a chance to do.
  const standing = live.filter((p) => actionableProposalFailures(p, { tenantId, currentBasis, now }).length === 0
    && (p.kind !== "new_page" || validateProposal(p).verdict !== "rejected"));
  // THE COMPLETENESS BOUNDARY DECIDES THE LANE, NEVER WHETHER THE WORK IS SEEN (operator, 2026-08-15). A row whose
  // deliverable is not finished used to leave the queue entirely and reach the operator as a number, which buried
  // genuine opportunities the account had already paid to find. Every standing row is ranked and shown; what the
  // boundary decides is which of the three lanes it lands in and which controls its card carries.
  const all = standing;
  // A CHANGE REPLACES ONLY THE WORK IT ACTUALLY OVERWRITES (operator, 2026-08-26). This asked instead whether any OTHER row on the page carried a bundle, and dropped every non-bundle row when one did. Live that hid eight standing rows behind a single table-row bundle, three of them already shown to the operator as Ready: the /farsi-numbers zero explainer, and the Late Safavid linked paragraph and title. One page is not one opportunity, so the question is what each row WRITES: a bundle rewriting a title still takes the plain title rewrite with it, while a table row, a heading, a schema block and a title on one page are four changes and all four stand. READ AFTER the basis filter above, never before it: a row that cannot be presented may not suppress one that can. Richest first, so the bundle that subsumes several atomic cards is the one kept, and ties break on id so the queue is the same on every read. Ranking has not run yet, which is why worth cannot decide it here.
  // FINISHED WORK IS NOT HIDDEN BY UNFINISHED WORK (operator, 2026-08-29). Which of two overlapping rows
  // survived was decided on FOOTPRINT SIZE alone, so the richer row won whatever state it was in: a
  // half-finished bundle outranked an atomic change that was finished, checked and paste-ready, and the
  // finished one left the screen. Richness says how much a row rewrites, never whether it is done.
  // Lifecycle asks first now, off the SAME verdict the lanes below publish rather than `status` alone,
  // because a row stamped ready by an older pass is not ready. Size still breaks ties among equals, so a
  // finished bundle keeps subsuming the finished atomics it contains, and id breaks the rest: one order.
  const laneCache = new Map<string, "ready" | "research" | "todo">();
  const laneOf = (p: ChangeProposal): "ready" | "research" | "todo" => {
    const seen = laneCache.get(p.id); if (seen != null) return seen;
    const hold = openHold(p);
    // A CARD WHOSE OWN RECEIPT SAYS ITS ACTION CANNOT FIX ITS CAUSE IS NOT A DRAFT (operator, 2026-08-17: a
    // title rewrite sat at rank 2 in the drafts lane with causeFit reading "this change does not touch two of
    // your own pages splitting one search"). The opportunity stays visible in the research lane, where its
    // evidence still argues; it returns as a draft only when a pass writes the treatment its cause authorizes.
    const cause = p.causeFinding?.cause ?? p.diagnosisCause;
    // An UNTREATABLE cause on an edit card is the same contradiction with a different receipt: nothing a page
    // edit can carry fixes it, so the card is a finding and argues from the research lane.
    const mismatched = p.researchOnly !== true && cause != null
      && ((CAUSE_LEVERS[cause]?.size ?? 0) === 0 || withholdReason(p, cause) != null);
    // A ROW RE-ADMITTED ACROSS A GENERATION IS WORK AGAIN, NEVER PASTE-READY ON ARRIVAL: its `ready` was
    // stamped by an older door, and this queue has already shipped what an older door waved through. The
    // opportunity stays ranked and visible either way; only the paste-ready claim waits for the current
    // door's own yes.
    const lane = hold.lane === "research" || mismatched ? "research" as const
      : p.status === "ready" && hold.blocking == null && unsettledCause(p) == null && p.basis === currentBasis ? "ready" as const
      : "todo" as const;
    laneCache.set(p.id, lane); return lane;
  };
  const finished = (p: ChangeProposal): number => (laneOf(p) === "ready" ? 1 : 0);
  const held: ChangeProposal[] = [];
  for (const p of [...all].sort((a, b) => finished(b) - finished(a) || mutationFootprint(b).size - mutationFootprint(a).size || a.id.localeCompare(b.id)))
    if (!held.some((k) => footprintsOverlap(k, p))) held.push(p);
  const current = all.filter((p) => held.includes(p));
  const demotedStaleBasis = live.length - standing.length;
  // WHY the queue is empty decides what may be said: a raised bar is true of an older or missing basis and a lie when the account simply could not be read, so the surfaces get the reason, not just the number.
  const basisUnreadable = currentBasis == null;
  // A page whose change the operator already applied IS a page under measurement, for as long as the measurement runs. Ranking a second change onto it would make the first one unreadable, so the ranker
  // discounts it hard and says so on the card. The applied rows are already in hand here, so this costs no read and reaches past no kernel boundary.
  const ranked = rankProposals(current, { measuringPagePaths: pagesUnderMeasurement(byId.values()),
    familyHistory: await familyHistoryFor(tenantId) });
  // READY has to mean ready: the validator passed it (status "ready"), it owes nobody a source, AND its lever treats the cause its own evidence named. That last one is the screen's half of the same boundary the producer now applies: a row stamped ready by an older pass, or by a producer that never asked, cannot serve as paste-ready work just because it is already on file. Every other current-basis row is a to-do. THE THREE LANES, off the ONE hold: nothing written yet is research, exact copy with anything at all still standing is a draft to review, and a row stamped ready whose holds are all answered is ready. `blocking` is asked here as well as at the mutation, so a row promoted by an older pass, or one whose banked placement can no longer be checked, is demoted in presentation instead of being served as paste-ready work.
  const ready: ChangeProposal[] = [], toDo: ChangeProposal[] = [], research: ChangeProposal[] = [];
  for (const p of ranked) {
    const lane = laneOf(p);
    if (lane === "research") research.push(p);
    else if (lane === "ready") ready.push(p);
    else toDo.push(p);
  }
  return {
    ranked,
    ready,
    toDo,
    research,
    implementedPendingVerification: [...byId.values()].filter((p) => p.status === "implemented_pending_verification").length,
    demotedStaleBasis,
    basisUnreadable,
  };
}
