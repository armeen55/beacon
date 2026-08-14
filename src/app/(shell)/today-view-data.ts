import "server-only";

/** today-view-data (CORE 100K cutover, 2026-07-22) - Today's slice, derived from the SAME ranked ChangeProposals /changes renders
 *  (loadChangesView). No parallel recommendation engine, no new persistence. Today answers only: what is the one best move next, and how
 *  much is measuring. */
import { after } from "next/server";
import { currentTenantId } from "@/lib/tenant-context";
import { loadChangesView, sanitizeSurfaceComputedAt, type ChangesView } from "./changes-data";
import { readCustomerSurface, isCustomerSurfaceStale } from "./surface-release";
import { countTrackedQuestions, researchPermission } from "@/domains/runtime";
import type { ChangeProposal, ProducerOutcome } from "@/domains/decision";

/** One ranked "do this next" change Today reads. FOUR FIELDS, because four are rendered: the effort, the upside,
 *  the ranking sentence and the evidence tier rode this shape for months and no screen ever read one of them. */
type TodayOpportunity = { changeId: string; pageLabel: string; recommendation: string; problem?: string };

/** The minimal Today read model the Today page renders: the header sentence plus the ranked next opportunities. Owned here now that the
 *  changes-domain today-view was retired. */
type TodayView = {
  headerSentence: string;
  nextOpportunities: TodayOpportunity[];
  /** THE EXACT EDIT AT THE TOP OF THE QUEUE. Today used to lead with the paragraph arguing the change, so the
   *  first thing read was reasoning for a thing nobody had been told to do yet. The action comes first now, then
   *  the words on the page and the words to put there; the reason follows. Absent when the top change carries no
   *  line at all, and `paste` is false for a plan that is read rather than pasted. */
  topEdit?: { action: string; lead: string; before: string | null; after: string; paste: boolean };
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
  /** TRUE only when the account's real pause switch says research is off. Beacon may not promise a daily round,
   *  a next pass or work happening behind the scenes while it is off, so the surfaces read this and say the
   *  truthful line with the control that fixes it. A switch that could not be read claims nothing either way. */
  researchPaused?: boolean;
};

/** A plain first-person directive for one proposal (the "do this next" line). */
function recommendationOf(p: ChangeProposal): string {
  const c = p.recommendedChange;
  // Slice 7: a bundled change already states its objective in one plain sentence.
  if (p.bundle) return p.bundle.objective;
  // A producer that wrote a real headline (a sentence, not a slug) owns this line.
  if (p.opportunityType.includes(" ") && p.opportunityType.length > 20) return p.opportunityType;
  if (c.kind === "new_page") return `Build a new page that answers "${p.primaryQuery}"`;
  const field = c.field === "meta" ? "description" : c.field.replace(/_/g, " ");
  return `Update the ${field} on ${p.pageLabel} to sharpen it for "${p.primaryQuery}"`;
}

/** PURE: map a ranked proposal to Today's opportunity shape. The PROBLEM rides along, because three directives
 *  with no statement of what any of them is for is a chore list, not a recommendation. */
const proposalToOpportunity = (p: ChangeProposal): TodayOpportunity => ({ changeId: p.id, pageLabel: p.pageLabel,
  recommendation: recommendationOf(p), ...(p.whyItMatters ? { problem: p.whyItMatters } : {}) });

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
  const field = c.field === "meta" ? "description" : c.field.replace(/_/g, " ");
  if (String(p.kind) === "consolidation" || p.changeFamily === "consolidation") {
    return { action: recommendationOf(p), lead: "", before: null, after: "", paste: false };
  }
  return {
    action: `Change the ${field} on ${p.pagePath ?? p.pageLabel}`,
    lead: "Change to: ",
    before: (c.before ?? "").trim() || null,
    after,
    paste: true,
  };
}

/** How many ranked changes Today carries. Today renders the FIRST one and nothing else; the rest ride along so a caller that wants the
 *  runners-up never has to re-rank anything. */
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

/** PURE: build the Today slice from a ChangesView. ONE FLAT QUEUE, exactly as Changes now renders it: the validated exact-copy changes
 *  first, then the ones still waiting on a review, best first. The COUNT is the whole queue counted in the database, never the page. */
export function buildTodayViewFromChanges(view: ChangesView, producer: TodayProducerSignal = {}): TodayView {
  // THE COUNT IS THE COUNT, NEVER THE PAGE. `view.ready` is one page of the ranking now, so counting it would under-report the queue Today
  // is drawing from; `summary` carries the total counted in the database.
  const readyTotal = view.summary?.ready ?? view.ready.length;
  const flat = [...view.ready, ...view.toDo];
  const ready = flat.slice(0, TODAY_PREVIEW_LIMIT).map(proposalToOpportunity);
  const topEdit = flat[0] ? topEditOf(flat[0]) : undefined;
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
  // ONE SENTENCE, AND EVERY CHANGE IT COUNTS IS FINISHED WORK. The queue Today reads holds complete deliverables
  // only, so this number is changes that can actually be made today. An unfinished opportunity is never counted
  // here and never called an edit: it rides its own clause, as a count and a next step, and nothing else.
  // "16 ideas to review" over a card pointing at research was one screen contradicting itself twice.
  const openTotal = readyTotal + (view.summary?.todo ?? view.toDo.length);
  const developing = view.developing ?? 0;
  const stillComing = developing > 0
    ? ` ${developing} ${developing === 1 ? "opportunity is" : "opportunities are"} still being developed.`
    : "";
  const headerSentence = openTotal > 0
    ? `You have ${openTotal} finished ${openTotal === 1 ? "change" : "changes"} ready to make, best first.${stillComing}`
    : waiting
      ? `No finished change is ready today. Some of your pages could not be read, so they get another try on ${retryDay(waiting)}.${stillComing}`
      // A BAR THAT COULD NOT BE READ IS NOT A QUEUE THAT IS EMPTY. With the basis unreadable, every stored idea
      // is held back as unconfirmed rather than judged, so the queue reads zero for a reason that has nothing to
      // do with the operator's work, and "no edits waiting" is the one sentence that must not be said over it.
      // Changes already says exactly this on the same release; Today may not disagree with it.
      : view.basisUnreadable
        ? "Which of your saved ideas still hold could not be confirmed just now. Beacon is checking again automatically."
        : `No finished change is ready today.${stillComing || " The next one is ranked here the moment Beacon has written the exact work."}`;
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
      await refreshCustomerSurface(tenantId).catch(() => null);
    });

  // One lean head-count, in parallel with the surface read: zero tracked questions is the ONE state that stops research outright, and Today
  // has to name it rather than look merely quiet. A failed count (null) claims NOTHING: a false zero would advertise a recovery the account
  // does not need.
  const [customer, trackedCount, permission] = await Promise.all([
    readCustomerSurface(tenantId).catch(() => null),
    countTrackedQuestions(tenantId).catch(() => null),
    // THE REAL SWITCH, NOT AN ASSUMPTION. A surface that promises a nightly round while research is off is
    // telling the operator work is happening that is not. Unreadable claims nothing.
    researchPermission(tenantId).catch(() => "unreadable" as const),
  ]);
  const research = permission === "paused" ? { researchPaused: true } : {};
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
