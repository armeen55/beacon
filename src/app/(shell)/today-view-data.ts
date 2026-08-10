import "server-only";

/** today-view-data (CORE 100K cutover, 2026-07-22) - Today's slice, derived from the SAME ranked ChangeProposals /changes renders
 *  (loadChangesView). No parallel recommendation engine, no new persistence. Today answers only: what is the one best move next, and how
 *  much is measuring. */
import { after } from "next/server";
import { currentTenantId } from "@/lib/tenant-context";
import { loadChangesView, sanitizeSurfaceComputedAt, setAsideClause, type ChangesView } from "./changes-data";
import { normalizedFixKey } from "@/components/today/today-smoke-alarm";
import { readCustomerSurface, isCustomerSurfaceStale } from "./surface-release";
import { countTrackedQuestions } from "@/domains/runtime";
import type { ChangeProposal } from "@/domains/decision";
import type { ProducerOutcome } from "@/domains/decision";
import type { TodayOpportunity, EvidenceStrength } from "@/domains/measurement/today/today-command";

/** The minimal Today read model the Today page renders: the header sentence plus the ranked next opportunities. Owned here now that the
 *  changes-domain today-view was retired. */
export type TodayView = {
  headerSentence: string;
  nextOpportunities: TodayOpportunity[];
  /** Pages with a READY proposal in THIS release, keyed by the path the smoke alarm blames, carrying the change to open. Today says "I have
   *  a fix ready" only from here, and links straight at it. proposalId is EMPTY when the change has no bundle: the fix is real, but
   *  /changes/<id> would 404, so the CTA falls back to the queue. */
  readyFixes?: { page: string; proposalId: string }[];
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
};

const CONFIDENCE_TO_STRENGTH: Record<ChangeProposal["confidence"], EvidenceStrength> = {
  high: "strong",
  medium: "directional",
  low: "tracking",
};

/** A plain first-person directive for one proposal (the "do this next" line). */
function recommendationOf(p: ChangeProposal): string {
  const c = p.recommendedChange;
  // Slice 7: a bundled change already states its objective in one plain sentence.
  if (p.bundle) return p.bundle.objective;
  if (c.kind === "new_page") return `Build a new page that answers "${p.primaryQuery}"`;
  const field = c.field === "meta" ? "description" : c.field.replace(/_/g, " ");
  return `Update the ${field} on ${p.pageLabel} to sharpen it for "${p.primaryQuery}"`;
}

/** PURE: map a ranked proposal to Today's opportunity shape. `whyRankedAboveNext` is RENDERED, never recomputed: the ONE ranker stamped it,
 *  so Today and Changes give the same reason for the same order. */
function proposalToOpportunity(p: ChangeProposal): TodayOpportunity {
  return {
    changeId: p.id,
    pageLabel: p.pageLabel,
    recommendation: recommendationOf(p),
    opportunityType: p.opportunityType,
    estimatedEffortMinutes: p.estimatedEffortMinutes,
    upside: p.upsidePerMonth,
    evidenceStrength: CONFIDENCE_TO_STRENGTH[p.confidence],
    ...(p.whyRankedAboveNext ? { whyRankedAboveNext: p.whyRankedAboveNext } : {}),
    // THE PROBLEM, carried onto the move. Today used to hand over three directives with no
    // statement of what any of them was for, which is a chore list, not a recommendation.
    ...(p.whyItMatters ? { problem: p.whyItMatters } : {}),
  };
}

/** How many ready changes Today previews. THREE is the whole ask of a visit: a fourth and fifth row turned one decision into a reading
 *  list. */
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

/** PURE: build the Today slice from a ChangesView. Today's next opportunities are the ready (validated, exact-copy) proposals, best first.
 *  The COUNT is the full ready list; the preview is the top three, so Today can never under-report the queue it is drawing from (it used to
 *  count the sliced preview). */
export function buildTodayViewFromChanges(view: ChangesView, producer: TodayProducerSignal = {}): TodayView {
  // THE COUNT IS THE COUNT, NEVER THE PAGE. `view.ready` is one page of the ranking now, so counting it would under-report the queue Today
  // is drawing from; `summary` carries the total counted in the database.
  const readyTotal = view.summary?.ready ?? view.ready.length;
  const ready = view.ready.slice(0, TODAY_PREVIEW_LIMIT).map(proposalToOpportunity);
  const readyFixes = view.ready
    .filter((p) => p.pagePath || p.pageUrl)
    .map((p) => ({ page: normalizedFixKey(p.pagePath ?? p.pageUrl ?? ""), proposalId: p.bundle ? p.id : "" }))
    .filter((f) => f.page.length > 0);
  // A LEDGER I COULD NOT READ IS NOT AN EMPTY ONE: no measuring clause is claimed and no count is handed on.
  const unread = view.countsUnavailable === true;
  const measuring = unread ? 0 : view.measuringCountCanonical;
  // Carried verbatim from the pass that judged those pages; omitted when empty so a release stays as small as what it actually knows.
  const declineNotes = producer.declineNotes?.length ? { declineNotes: producer.declineNotes } : {};
  const waiting = producer.waitingUntil && Number.isFinite(Date.parse(producer.waitingUntil)) ? producer.waitingUntil : null;
  const held = producer.heldForMeasurement ?? 0;
  const rest = {
    ...declineNotes,
    ...(waiting ? { waitingUntil: waiting } : {}),
    ...((producer.investigating ?? 0) > 0 ? { investigating: producer.investigating } : {}),
    ...(held > 0 ? { heldForMeasurement: held } : {}),
    ...(producer.outcome ? { producerOutcome: producer.outcome } : {}),
    readyTotal,
    toDoTotal: view.summary?.todo ?? view.toDo.length,
    ...(unread ? { countsUnavailable: true } : { measuringCount: measuring }),
  };
  let headerSentence: string;
  if (readyTotal > 0) {
    const lead =
      readyTotal > ready.length
        ? `You have ${readyTotal} changes ready to apply; here are the three strongest.`
        : `You have ${readyTotal} change${readyTotal === 1 ? "" : "s"} ready to apply.`;
    headerSentence =
      measuring > 0
        ? `${lead} ${measuring} more ${measuring === 1 ? "is" : "are"} still measuring.`
        : lead;
    return { headerSentence, nextOpportunities: ready, readyFixes, ...rest };
  } else if (waiting) {
    // A WAIT IS NOT ACTIVITY. Saying I am "checking" while the next legal read is tomorrow made a cooldown read as work in flight, and left
    // the operator refreshing a page that could not change today. Name the date, own the pause, and ask for nothing: the retry is mine to
    // make, not theirs.
    headerSentence = `I could not read some of the pages I need, so I am waiting until ${retryDay(waiting)} to try them again.${measuring > 0 ? ` ${measuring} change${measuring === 1 ? " is" : "s are"} still measuring.` : ""}`;
  } else if (producer.outcome === "investigating") {
    // Proven losses whose CAUSE is not identified yet. This used to fall through to "Nothing needs a decision today", which is the one
    // sentence that makes a paid tool read as broken while it is actually working. Name the number instead.
    const n = producer.investigating ?? 0;
    headerSentence = `${n > 0 ? `I found ${n} ${n === 1 ? "page" : "pages"} losing clicks and I am` : "I am"} checking the live results pages for ${n === 1 ? "it" : "them"} before asking you to change anything.${measuring > 0 ? ` ${measuring} change${measuring === 1 ? " is" : "s are"} still measuring.` : ""}`;
  } else if (producer.outcome === "actionable_but_no_trusted_draft") {
    // Real gaps, no change I can stand behind. Saying "nothing needs a decision" here would be a lie by omission, and showing yesterday's
    // Ready work as newly generated would be worse.
    headerSentence = `I found meaningful traffic gaps, but I am still checking the results pages and competing pages before asking you to change anything.${measuring > 0 ? ` ${measuring} change${measuring === 1 ? " is" : "s are"} still measuring.` : ""}`;
  } else if ((view.summary?.todo ?? view.toDo.length) > 0) {
    // WORK WAITING OUTRANKS HOUSEKEEPING. Saying I set old ideas aside while ideas sit in To do buried the only thing the operator could
    // actually pick up.
    const n = view.summary?.todo ?? view.toDo.length, tail = measuring > 0 ? `, and ${measuring} change${measuring === 1 ? " is" : "s are"} measuring` : "";
    headerSentence = `I have ${n} idea${n === 1 ? "" : "s"} to review with you${tail}.`;
  } else if ((view.demotedStaleBasis ?? 0) > 0) {
    // ONE sentence, owned by Changes: two copies of the same claim drift apart, and the operator reads both on the same visit.
    headerSentence = `${setAsideClause(view.demotedStaleBasis)}${measuring > 0 ? ` ${measuring} change${measuring === 1 ? " is" : "s are"} still measuring.` : ""}`;
  } else if (measuring > 0) {
    // NOT "nothing needs a decision today". That is a claim about the whole account, and it was
    // printed over open topics, declining pages and a backlog. The true and much smaller claim is
    // that no change has cleared Ready, so that is the one I make.
    headerSentence = `No change is ready for you to make today. ${measuring} change${measuring === 1 ? " is" : "s are"} measuring, and I say below what I am working on.`;
  } else {
    headerSentence = "No change is ready for you to make today. I say below what I am researching and what I am watching, and I rank your next move here the moment one earns it.";
  }
  return { headerSentence, nextOpportunities: ready, readyFixes, ...rest };
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
      await refreshCustomerSurface(tenantId).catch(() => null);
    });

  // One lean head-count, in parallel with the surface read: zero tracked questions is the ONE state that stops research outright, and Today
  // has to name it rather than look merely quiet. A failed count (null) claims NOTHING: a false zero would advertise a recovery the account
  // does not need.
  const [customer, trackedCount] = await Promise.all([
    readCustomerSurface(tenantId).catch(() => null),
    countTrackedQuestions(tenantId).catch(() => null),
  ]);
  // WHAT I SAY WHEN I COULD NOT LOOK. "Nothing needs a decision today" is the one sentence an outage must never produce: it is a claim
  // about their business they cannot tell apart from the truth.
  const unreadable = "I could not read your changes just now, so I am not telling you the day is clear. Beacon is checking again automatically.";
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
      surfaceVersion: view?.surfaceVersion ?? customer.releaseId,
      surfaceComputedAt: sanitizeSurfaceComputedAt(customer.computedAt) ?? undefined,
    };
  }
  // No release on file yet: build one page of Today off the Changes read, and say nothing I cannot show.
  scheduleReleaseRebuild();
  const view = await loadChangesView().catch(() => null);
  if (!view || (view.releaseUnreadable && view.proposals.length === 0)) {
    return { today: { headerSentence: unreadable, nextOpportunities: [] }, hasChanges: false, ...paused };
  }
  return { today: buildTodayViewFromChanges(view), hasChanges: view.proposals.length > 0, ...paused };
}
