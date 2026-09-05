import "server-only";

/** today-view-data (CORE 100K cutover, 2026-07-22) - Today's slice, derived from the SAME ranked ChangeProposals /changes renders
 *  (loadChangesView). No parallel recommendation engine, no new persistence. Today answers only: what is the one best move next, and how
 *  much is measuring. */
import { after } from "next/server";
import { currentTenantId } from "@/lib/tenant-context";
import { loadChangesView, sanitizeSurfaceComputedAt, type ChangesView } from "./changes-data";
import { readCustomerSurface, isCustomerSurfaceStale } from "./surface-release";
import { countTrackedQuestions, researchPermission, researchRunStatus } from "@/domains/runtime";
import { checkBudget } from "@/domains/decision";
import type { ChangeProposal, ProducerOutcome } from "@/domains/decision";

/** One ranked "do this next" change Today reads. FOUR FIELDS, because four are rendered: the effort, the upside,
 *  the ranking sentence and the evidence tier rode this shape for months and no screen ever read one of them. */
type TodayOpportunity = { changeId: string; pageLabel: string; recommendation: string; problem?: string;
  /** WHICH LANE THIS ITEM CAME OUT OF, so Today can say what it is before anybody presses it. `ready` is
   *  finished work; `review` is a draft owing a look and `research` an opportunity with nothing written yet,
   *  and neither of those may ever be printed as a finished change. */
  lane: "ready" | "review" | "research" };

/** The minimal Today read model the Today page renders: the header sentence plus the ranked next opportunities. Owned here now that the
 *  changes-domain today-view was retired. */
type TodayView = {
  headerSentence: string;
  nextOpportunities: TodayOpportunity[];
  /** THE EXACT EDIT AT THE TOP OF THE QUEUE. Today used to lead with the paragraph arguing the change, so the
   *  first thing read was reasoning for a thing nobody had been told to do yet. The action comes first now, then
   *  the words on the page and the words to put there; the reason follows. Absent when the top change carries no
   *  line at all, and `paste` is false for a plan that is read rather than pasted. */
  topEdit?: { action: string; lead: string; before: string | null; after: string; paste: boolean; where?: string };
  /** The kernel's OWN verdict for pages it judged and declined to change, keyed the same way. Today quotes it instead of a generic "still
   *  checking", so a page it resolved to watch reads as a decision, not silence. */
  declineNotes?: { page: string; note: string }[];
  /** The earliest date a page I could not read may be tried again. Today says the date, because a wait is not activity. */
  waitingUntil?: string;
  /** Proven losses this pass is still identifying a cause for, so researching names a number. */
  investigating?: number;
  /** Ideas the store refused because the page already carries a change I am measuring: a held draft is not a failed draft, and a page
   *  holding one must not look forgotten. */
  heldForMeasurement?: number;
  /** THE SIZE OF THE READY QUEUE, uncapped, beside the capped `nextOpportunities` preview. ONE queue, ONE number: the command used to count
   *  the preview and say "4 more" under a header that said 12. */
  readyTotal?: number;
  /** THE RESEARCH LANE'S OWN TOTAL, the same number Changes prints over its own cards. */
  researchTotal?: number;
  /** THE NEEDS REVIEW LANE'S OWN TOTAL, counted in the database. Today has to carry it or the command cannot tell a genuinely quiet day from a
   *  day with twenty ideas waiting on the operator, and it said "nothing needs a decision" over both. */
  toDoTotal?: number;
  /** The canonical measuring count THIS release was built with, the same number Changes carries, so one navigation cannot show two answers
   *  to one question. ABSENT when the ledger could not be read. */
  measuringCount?: number;
  /** TRUE when that ledger could not be read: the count is withheld, never printed as a zero. */
  countsUnavailable?: boolean;
  /** What the production pass behind this release concluded, kept so a rebuild can hand it back. */
  producerOutcome?: ProducerOutcome;
};

export type TodayComposite = {
  today: TodayView;
  hasChanges: boolean;
  surfaceVersion?: string;
  surfaceComputedAt?: string;
  /** TRUE when I am tracking zero questions, which is the one state that stops my research outright. Today shows the fix instead of a
   *  silent empty page. */
  needsTrackedQuestions?: boolean;
  /** Where that fix lives. */
  trackedQuestionsHref?: string;
  /** TRUE only when the account's real pause switch says research is off. Beacon may not promise a daily round,
   *  a next pass or work happening behind the scenes while it is off, so the surfaces read this and say the
   *  truthful line with the control that fixes it. A switch that could not be read claims nothing either way. */
  researchPaused?: boolean;
  /** TRUE when the MONTHLY MODEL budget the paid work itself asks about is refusing. Named for what it proves: search, stored evidence, cached answers and every deterministic path are not what this gate answers for. */
  modelBudgetSpent?: boolean;
  /** THE HEARTBEAT SENTENCE, off the latest research run's own row: what the last pass did and when, or that
   *  none has run. Absent when the row could not be read, so an outage never claims research is dead. */
  researchLiveness?: string;
};

/** A plain first-person directive for one proposal (the "do this next" line). */
function recommendationOf(p: ChangeProposal): string {
  const c = p.recommendedChange;
  // Slice 7: a bundled change already states its objective in one plain sentence.
  if (p.bundle) return p.bundle.objective;
  // A producer that wrote a real headline (a sentence, not a slug) owns this line.
  if (p.opportunityType.includes(" ") && p.opportunityType.length > 20) return p.opportunityType;
  if (c.kind === "new_page") return `Build a new page that answers "${p.primaryQuery}"`;
  const field = c.field === "meta" ? "meta description" : c.field.replace(/_/g, " ");
  return `Update the ${field} on ${p.pageLabel} to sharpen it for "${p.primaryQuery}"`;
}

/** PURE: map a ranked proposal to Today's opportunity shape. The PROBLEM rides along, because three directives
 *  with no statement of what any of them is for is a chore list, not a recommendation. */
const proposalToOpportunity = (p: ChangeProposal, lane: TodayOpportunity["lane"]): TodayOpportunity => ({ changeId: p.id, pageLabel: p.pageLabel,
  recommendation: recommendationOf(p), lane, ...(p.whyItMatters ? { problem: p.whyItMatters } : {}) });

/** PURE: the top ranked change said as an action plus the two lines. Null when it carries nothing to put there.
 *  EVERY CHANGE THAT REACHES HERE IS FINISHED: the completeness boundary keeps unfinished work out of the queue
 *  Today reads, so the "read this first" and instruction-paragraph branches this used to carry are gone with the
 *  cards that needed them. A merge is still read rather than pasted, because its work is several moves. */
function topEditOf(p: ChangeProposal): TodayView["topEdit"] {
  const c = p.recommendedChange;
  const after = (c.kind === "new_page" ? c.proposedTitle : c.after ?? "").trim();
  if (!after) return undefined;
  if (c.kind === "new_page") {
    return { action: `Build a new page that answers "${p.primaryQuery}"`, lead: "Page title: ", before: null, after, paste: true };
  }
  const field = c.field === "meta" ? "meta description" : c.field.replace(/_/g, " ");
  if (String(p.kind) === "consolidation" || p.changeFamily === "consolidation") {
    return { action: recommendationOf(p), lead: "", before: null, after: "", paste: false };
  }
  return {
    action: `Change the ${field} on ${p.pagePath ?? p.pageLabel}`,
    lead: "Change to: ",
    before: (c.before ?? "").trim() || null,
    after,
    paste: true,
    // WHERE IT GOES rides the one card the operator is steered to first: the Changes card has always carried it, and the Today card, the single card most operators act from, omitted it, so body copy arrived with no place to put it (blind customer review, 2026-08-25).
    ...((c.where ?? "").trim() ? { where: c.where!.trim() } : {}),
  };
}

/** How many ranked changes Today carries. Today renders the FIRST one and nothing else; the rest ride along so a caller that wants the
 *  runners-up never has to re-rank anything. */
/** WHAT THE LAST DRIVE LEFT UNDONE, SAID WHERE THE OPERATOR ALREADY READS THE DAY (measured, 2026-09-05). A drive that runs out of time writes the step it could not pay for onto its own row ("Publishing what this day found needs 40 seconds and this drive had 32 left, so nothing was started for it"), and nothing outside the runtime read it: Today said "Read 10 new answers closely today at 10:33 AM." while the day's last step had not run and the ranked list stood one pass behind. A paused run is a fact the row already carries whole, so the number, the step and what happens next are said here off the same view the heartbeat comes from. An interrupted run already says it stopped partway and is left alone. */
/** AND THE TWO DEADLINE ANSWERS ARE TWO SENTENCES, NEVER ONE (2026-09-05). A drive that runs out of time leaves two different states behind and they were told apart nowhere an operator could read: a step it would not START because it could not pay for it (nothing is running, the next pass takes it first), and a walk it STOPPED WAITING FOR (the writing carried on, what it spent is remembered, its work is owed again at its own rank). Both are said, each in its own words, and each stands on its own without the other. */
const unrunStep = (v: Awaited<ReturnType<typeof researchRunStatus>> | null): string => {
  if (v == null || v.liveness?.state === "interrupted") return ""; // an interrupted run already says it stopped partway and is left alone
  const both = [v.waiting, v.blocker].filter((x): x is string => !!x), said = both.map((x) => ` ${x}`).join("");
  if (v.state !== "paused" || !v.phaseLabel) return said; // a run that did not pause still owes these two facts about its last drive
  return ` Research paused after ${v.stepsDone} of ${v.stepsTotal} steps, so ${v.phaseLabel} has not run yet.${said}${v.pauseReason ? ` ${v.pauseReason}` : both.length > 0 ? "" : " The next pass starts there."}`;
};
const TODAY_PREVIEW_LIMIT = 3;

/** What THIS release's production pass actually concluded, so an empty queue can say which empty it is. Optional: a release built without
 *  it says nothing new. */
type TodayProducerSignal = {
  outcome?: ProducerOutcome;
  /** How many proven gaps this pass is still investigating (research_needed). */
  investigating?: number;
  declineNotes?: { page: string; note: string }[];
  /** The earliest retry date from the SAME canonical coverage pass; absent when nothing is waiting. */
  waitingUntil?: string | null;
  /** Drafts the store refused because the page already carries a change under measurement. */
  heldForMeasurement?: number;
};

/** THE PRODUCER SIGNAL THIS RELEASE WAS BUILT WITH, read back off the release itself. A basis shift rebuilds Today from the surviving
 *  proposals, and that rebuild used to be handed NOTHING: the retry date, the investigation count, the held-back ideas and the kernel's own
 *  verdicts all vanished the moment the bar moved, the exact visit where the operator most needs telling. Copied off the blob, never
 *  re-derived. */
function carriedProducerSignal(view: TodayView): TodayProducerSignal {
  return {
    ...(view.producerOutcome ? { outcome: view.producerOutcome } : {}),
    ...(view.declineNotes?.length ? { declineNotes: view.declineNotes } : {}),
    ...(view.waitingUntil ? { waitingUntil: view.waitingUntil } : {}),
    ...(typeof view.investigating === "number" ? { investigating: view.investigating } : {}),
    ...(typeof view.heldForMeasurement === "number" ? { heldForMeasurement: view.heldForMeasurement } : {}),
  };
}

/** A retry date in the operator's words: the day, never a timestamp and never a countdown. */
const retryDay = (iso: string): string =>
  new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "America/Los_Angeles" });

/** PURE: build the Today slice from a ChangesView. ONE LANE REACHES TODAY: the validated exact-copy changes, best first. A card still waiting
 *  on a review is COUNTED in its own clause and never offered as work. The COUNT is the whole lane counted in the database, never the page. */
export function buildTodayViewFromChanges(view: ChangesView, producer: TodayProducerSignal = {}): TodayView {
  // THE COUNT IS THE COUNT, NEVER THE PAGE. `view.ready` is one page of the ranking now, so counting it would under-report the queue Today
  // is drawing from; `summary` carries the total counted in the database.
  const readyTotal = view.summary?.ready ?? view.ready.length;
  // ONLY WHAT IS READY IS OFFERED. Today used to draw its preview and its "Do this first" edit off ready AND review together, so on a day
  // with nothing finished the top of the homepage handed over a card the queue itself holds back, with a Copy press on it.
  // AT MOST THREE NEXT ITEMS: THE TOP OF THE ONE RANKING, each wearing its lane. Lane-priority concatenation
  // used to rebuild the retired hierarchy right at the top of the homepage, so a three impression finished
  // description sat above the account's biggest researched opportunity. The ORDER is the ranking's own (rows
  // the ranked head does not name keep lane order behind it, which is also the whole answer on a stored blob
  // that predates `proposals`); the LABEL is what says whether there is something to paste, and no research
  // row can print as finished work.
  type Lane = "ready" | "review" | "research";
  const lanes: Array<[{ id: string }, Lane]> = [
    ...view.ready.map((p): [{ id: string }, Lane] => [p, "ready"]),
    ...view.toDo.map((p): [{ id: string }, Lane] => [p, "review"]),
    ...(view.research ?? []).map((p): [{ id: string }, Lane] => [p, "research"])];
  const rank = new Map((view.proposals ?? []).map((p, i) => [p.id, i]));
  lanes.sort((a, b) => (rank.get(a[0].id) ?? Infinity) - (rank.get(b[0].id) ?? Infinity));
  // TODAY NEVER LEADS WITH RESEARCH WHILE ANY FINISHED CHANGE EXISTS (operator, 2026-08-22): the top slot is
  // the highest-ranked READY change whenever one is on file; the rest of the preview keeps the global order.
  const lead = lanes.find(([, l]) => l === "ready");
  const ordered = lead ? [lead, ...lanes.filter((x) => x !== lead)] : lanes;
  const ready = ordered.slice(0, TODAY_PREVIEW_LIMIT)
    .map(([p, lane]) => proposalToOpportunity(p as Parameters<typeof proposalToOpportunity>[0], lane));
  const topEdit = view.ready[0] ? topEditOf(view.ready[0]!) : undefined;
  // A LEDGER I COULD NOT READ IS NOT AN EMPTY ONE: no measuring clause is claimed and no count is handed on.
  const unread = view.countsUnavailable === true;
  const measuring = unread ? 0 : view.measuringCountCanonical;
  // Carried verbatim from the pass that judged those pages; omitted when empty so a release stays as small as what it actually knows.
  const declineNotes = producer.declineNotes?.length ? { declineNotes: producer.declineNotes } : {};
  const waiting = producer.waitingUntil && Number.isFinite(Date.parse(producer.waitingUntil)) ? producer.waitingUntil : null;
  const held = producer.heldForMeasurement ?? 0;
  const researching = view.summary?.research ?? (view.research ?? []).length;
  const inReview = view.summary?.todo ?? view.toDo.length;
  const rest = {
    ...declineNotes,
    ...(waiting ? { waitingUntil: waiting } : {}),
    ...((producer.investigating ?? 0) > 0 ? { investigating: producer.investigating } : {}),
    ...(held > 0 ? { heldForMeasurement: held } : {}),
    ...(producer.outcome ? { producerOutcome: producer.outcome } : {}),
    readyTotal,
    toDoTotal: inReview,
    researchTotal: researching,
    ...(unread ? { countsUnavailable: true } : { measuringCount: measuring }),
  };
  // ONE SENTENCE, AND EVERY CHANGE IT COUNTS IS FINISHED WORK: the READY lane alone, which is the only lane
  // whose words are written, checked and pasteable today. THE OPENING IS NOT A STATUS ESSAY (operator,
  // 2026-08-21): the draft and research counts left this sentence entirely, because Changes labels those
  // lanes itself and Today opens on the one number that is work.
  const openTotal = readyTotal;
  const headerSentence = openTotal > 0
    ? `You have ${openTotal} finished ${openTotal === 1 ? "change" : "changes"} ready to make, best first.`
    : waiting
      ? `No finished change is ready today. Some of your pages could not be read, so they get another try on ${retryDay(waiting)}.`
      // A BAR THAT COULD NOT BE READ IS NOT A QUEUE THAT IS EMPTY. With the basis unreadable, every stored idea
      // is held back as unconfirmed rather than judged, so the queue reads zero for a reason that has nothing to
      // do with the operator's work, and "no edits waiting" is the one sentence that must not be said over it.
      // Changes already says exactly this on the same release; Today may not disagree with it.
      : view.basisUnreadable
        ? "Which of your saved ideas still hold could not be confirmed just now. Beacon is checking again automatically."
        : "No finished change is ready today. The next one lands here the moment the exact work is written.";
  return { headerSentence, nextOpportunities: ready, ...(topEdit ? { topEdit } : {}), ...rest };
}

/** Compose Today from the exact Changes release that will ship beside it, and from what that release's own production pass concluded. */
export async function buildTodayCompositeFromChanges(view: ChangesView, producer: TodayProducerSignal = {}): Promise<TodayComposite> {
  return { today: buildTodayViewFromChanges(view, producer), hasChanges: view.proposals.length > 0 };
}

export async function loadTodayView(): Promise<TodayComposite> {
  return loadTodayViewWithSwr(await currentTenantId());
}

async function loadTodayViewWithSwr(tenantId: string): Promise<TodayComposite> {
  const scheduleReleaseRebuild = () =>
    after(async () => {
      const { refreshCustomerSurface } = await import("./surface-release");
      await refreshCustomerSurface(tenantId, { maxDrafts: 0 }).catch(() => null); // a stale-release rebuild republishes stored truth at $0; it never drafts
    });

  // One lean head-count, in parallel with the surface read: zero tracked questions is the ONE state that stops research outright, and Today
  // has to name it rather than look merely quiet. A failed count (null) claims NOTHING: a false zero would advertise a recovery the account
  // does not need.
  const [customer, trackedCount, permission, runStatus, budgetSpent] = await Promise.all([
    readCustomerSurface(tenantId).catch(() => null),
    countTrackedQuestions(tenantId).catch(() => null),
    // THE REAL SWITCH, NOT AN ASSUMPTION. A surface that promises a nightly round while research is off is
    // telling the operator work is happening that is not. Unreadable claims nothing.
    researchPermission(tenantId).catch(() => "unreadable" as const),
    // THE HEARTBEAT, off the latest run's own row: the day has a pulse the operator can read without asking.
    researchRunStatus(tenantId).catch(() => null),
    // A SPENT BUDGET MUST NOT LOOK LIKE A QUIET DAY. This file already refuses to let an outage say "nothing
    // needs a decision today"; a budget that has run out is the same claim by another route, and it is the one
    // state that stops every paid door at once while the surface carries on looking normal. Asked of the SAME
    // gate the runtime asks, with nothing projected, so the answer is the one the work itself would get.
    // Unreadable claims nothing, exactly like the permission read above it.
    // ASKED THE WAY THE WORK ASKS IT: a cent of projected cost, because the gate compares the spend PLUS the
    // call about to be made. Asking with nothing projected asks "could you spend nothing", which is yes even at
    // a ceiling where every real call is refused, so the line would never have appeared on the day it is for.
    checkBudget({ tenantId, projectedCostUsd: 0.01 }).then((b) => b.allowed === false).catch(() => false),
  ]);
  const research = { ...(permission === "paused" ? { researchPaused: true } : {}), ...(budgetSpent ? { modelBudgetSpent: true } : {}),
    ...(runStatus?.liveness?.line ? { researchLiveness: `${runStatus.liveness.line}${unrunStep(runStatus)}` } : {}) };
  // WHAT I SAY WHEN I COULD NOT LOOK. "Nothing needs a decision today" is the one sentence an outage must never produce: it is a claim
  // about their business they cannot tell apart from the truth.
  const unreadable = "Your changes could not be read just now, so the day is not being called clear. Beacon is checking again automatically.";
  const paused = trackedCount === 0
    ? { needsTrackedQuestions: true, trackedQuestionsHref: "/settings/config#tracked-ai-prompts" }
    : {};

  if (customer) {
    if (isCustomerSurfaceStale(customer.computedAt, Date.now())) scheduleReleaseRebuild();
    // ONE READ, THE SAME ONE CHANGES USES. Serving Today's slice off the stored release let it count a change the operator had just put
    // aside and offer a fix whose link 404'd, because a blob has no way to say "put aside" and no way to know a stamp landed while its own
    // write did not. The counts, the ready fixes and the release id now all come from the database-gated lane Changes reads, so a dismissal
    // lands on both surfaces on the very next render; only what the PRODUCTION pass concluded is still carried on the blob.
    const view = await loadChangesView().catch(() => null);
    return {
      ...customer.today,
      today: view ? buildTodayViewFromChanges(view, carriedProducerSignal(customer.today.today)) : customer.today.today,
      ...paused,
      ...research,
      surfaceVersion: view?.surfaceVersion ?? customer.releaseId,
      surfaceComputedAt: sanitizeSurfaceComputedAt(customer.computedAt) ?? undefined,
    };
  }
  // No release on file yet: build one page of Today off the Changes read, and say nothing I cannot show.
  scheduleReleaseRebuild();
  const view = await loadChangesView().catch(() => null);
  if (!view || (view.releaseUnreadable && view.proposals.length === 0)) {
    return { today: { headerSentence: unreadable, nextOpportunities: [] }, hasChanges: false, ...paused, ...research };
  }
  return { today: buildTodayViewFromChanges(view), hasChanges: view.proposals.length > 0, ...paused, ...research };
}
