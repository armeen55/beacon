import "server-only";

/**
 * today-view-data (CORE 100K cutover, 2026-07-22) — Today's slice, derived from
 * the SAME ranked ChangeProposals /changes renders (loadChangesView). No parallel
 * recommendation engine, no new persistence. Today answers only: what is the one
 * best move next, and how much is measuring. Fail-soft: a missing changes read
 * degrades to a quiet Today.
 */
import { after } from "next/server";
import { currentTenantId } from "@/lib/tenant-context";
import { loadChangesView, sanitizeSurfaceComputedAt, setAsideClause, withCurrentBasisOnly, type ChangesView } from "./changes-data";
import { normalizedFixKey } from "@/components/today/today-smoke-alarm";
import { readCustomerSurface, isCustomerSurfaceStale } from "./surface-release";
import { countTrackedQuestions } from "@/domains/runtime";
import { resolveCurrentBasis } from "@/domains/decision";
import type { ChangeProposal } from "@/domains/decision";
import type { ProducerOutcome } from "@/domains/decision";
import type { TodayOpportunity, EvidenceStrength } from "@/domains/measurement/today/today-command";

/** The minimal Today read model the Today page renders (headerSentence + the one
 *  ranked next opportunity). Owned here now that the changes-domain today-view was
 *  retired. */
export type TodayView = {
  headerSentence: string;
  nextOpportunities: TodayOpportunity[];
  /** Pages that already have a READY proposal in THIS release, keyed by the same
   *  normalized path the smoke alarm blames, carrying the proposal to open. Today
   *  says "I have a fix ready" only from this list, and links straight at it.
   *  Optional so a release blob written before this field degrades to no claim.
   *  proposalId is EMPTY STRING when the change has no bundle: the fix is real
   *  (so the claim stays honest) but /changes/<id> would 404 for it, so the CTA
   *  falls back to the Changes queue. */
  readyFixes?: { page: string; proposalId: string }[];
  /** The kernel's OWN verdict for pages it judged and declined to change, keyed by
   *  the same normalized path readyFixes uses. Today quotes the verdict for the
   *  page it blames instead of a generic "still checking", so a page the decision
   *  resolved to watch reads as a decision, not as an absence. Optional: a release
   *  written before this field quotes nothing. */
  declineNotes?: { page: string; note: string }[];
  /** The earliest date a page I could not read may be tried again, or absent when nothing is waiting.
   *  Today says the date instead of "checking", because a wait is not activity. */
  waitingUntil?: string;
};

export type TodayComposite = {
  today: TodayView;
  hasChanges: boolean;
  surfaceVersion?: string;
  surfaceComputedAt?: string;
  /** TRUE when I am tracking zero questions, which is the one state that stops my
   *  research outright. Today shows the fix instead of a silent empty page. */
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

/** PURE: map a ranked proposal to Today's opportunity shape. */
export function proposalToOpportunity(p: ChangeProposal): TodayOpportunity {
  return {
    changeId: p.id,
    pageLabel: p.pageLabel,
    recommendation: recommendationOf(p),
    opportunityType: p.opportunityType,
    estimatedEffortMinutes: p.estimatedEffortMinutes,
    upside: p.upsidePerMonth,
    evidenceStrength: CONFIDENCE_TO_STRENGTH[p.confidence],
  };
}

/** How many ready changes Today previews under its one command. */
const TODAY_PREVIEW_LIMIT = 5;

/** What THIS release's production pass actually concluded, so an empty queue can
 *  say which empty it is. Optional: a release built without it says nothing new. */
export type TodayProducerSignal = {
  outcome?: ProducerOutcome;
  /** How many proven gaps this pass is still investigating (research_needed). */
  investigating?: number;
  declineNotes?: { page: string; note: string }[];
  /** The earliest retry date from the SAME canonical coverage pass; absent when nothing is waiting. */
  waitingUntil?: string | null;
};

/** A retry date in the operator's words: the day, never a timestamp and never a countdown. */
const retryDay = (iso: string): string =>
  new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "America/Los_Angeles" });

/** PURE: build the Today slice from a ChangesView. Today's next opportunities are
 *  the ready (validated, exact-copy) proposals, best first. The COUNT is the full
 *  ready list; the preview is the top five, so Today can never under-report the
 *  queue it is drawing from (it used to count the sliced preview). */
export function buildTodayViewFromChanges(view: ChangesView, producer: TodayProducerSignal = {}): TodayView {
  const readyTotal = view.ready.length;
  const ready = view.ready.slice(0, TODAY_PREVIEW_LIMIT).map(proposalToOpportunity);
  const readyFixes = view.ready
    .filter((p) => p.pagePath || p.pageUrl)
    .map((p) => ({ page: normalizedFixKey(p.pagePath ?? p.pageUrl ?? ""), proposalId: p.bundle ? p.id : "" }))
    .filter((f) => f.page.length > 0);
  const measuring = view.measuringCountCanonical;
  // Carried verbatim from the pass that judged those pages; omitted when empty so a
  // release stays as small as what it actually knows.
  const declineNotes = producer.declineNotes?.length ? { declineNotes: producer.declineNotes } : {};
  const waiting = producer.waitingUntil && Number.isFinite(Date.parse(producer.waitingUntil)) ? producer.waitingUntil : null;
  const rest = { ...declineNotes, ...(waiting ? { waitingUntil: waiting } : {}) };
  let headerSentence: string;
  if (readyTotal > 0) {
    const lead =
      readyTotal > ready.length
        ? `You have ${readyTotal} changes ready; here are the ${ready.length === 5 ? "five" : ready.length} strongest.`
        : `You have ${readyTotal} change${readyTotal === 1 ? "" : "s"} ready to apply.`;
    headerSentence =
      measuring > 0
        ? `${lead} ${measuring} more ${measuring === 1 ? "is" : "are"} still measuring.`
        : lead;
    return { headerSentence, nextOpportunities: ready, readyFixes, ...rest };
  } else if (waiting) {
    // A WAIT IS NOT ACTIVITY. Saying I am "checking" while the next legal read is tomorrow made a cooldown
    // read as work in flight, and left the operator refreshing a page that could not change today. Name the
    // date, own the pause, and ask for nothing: the retry is mine to make, not theirs.
    headerSentence = `I could not read some of the pages I need, so I am waiting until ${retryDay(waiting)} to try them again.${measuring > 0 ? ` ${measuring} change${measuring === 1 ? " is" : "s are"} still measuring.` : ""}`;
  } else if (producer.outcome === "investigating") {
    // Proven losses whose CAUSE is not identified yet. This used to fall through to
    // "Nothing needs a decision today", which is the one sentence that makes a paid
    // tool read as broken while it is actually working. Name the number instead.
    const n = producer.investigating ?? 0;
    headerSentence = `${n > 0 ? `I found ${n} ${n === 1 ? "page" : "pages"} losing clicks and I am` : "I am"} checking the live results pages for ${n === 1 ? "it" : "them"} before asking you to change anything.${measuring > 0 ? ` ${measuring} change${measuring === 1 ? " is" : "s are"} still measuring.` : ""}`;
  } else if (producer.outcome === "actionable_but_no_trusted_draft") {
    // Real gaps, no change I can stand behind. Saying "nothing needs a decision"
    // here would be a lie by omission, and showing yesterday's Ready work as
    // newly generated would be worse.
    headerSentence = `I found meaningful traffic gaps, but I am still checking the results pages and competing pages before asking you to change anything.${measuring > 0 ? ` ${measuring} change${measuring === 1 ? " is" : "s are"} still measuring.` : ""}`;
  } else if (view.toDo.length > 0) {
    // WORK WAITING OUTRANKS HOUSEKEEPING. Saying I set old ideas aside while ideas sit
    // in To do buried the only thing the operator could actually pick up.
    const tail = measuring > 0 ? `, and ${measuring} change${measuring === 1 ? " is" : "s are"} measuring` : "";
    headerSentence = `I have ${view.toDo.length} idea${view.toDo.length === 1 ? "" : "s"} to review with you${tail}.`;
  } else if ((view.demotedStaleBasis ?? 0) > 0) {
    // ONE sentence, owned by Changes: two copies of the same claim drift apart, and
    // the operator reads both on the same visit.
    headerSentence = `${setAsideClause(view.demotedStaleBasis)}${measuring > 0 ? ` ${measuring} change${measuring === 1 ? " is" : "s are"} still measuring.` : ""}`;
  } else if (measuring > 0) {
    headerSentence = `Nothing needs a decision today. ${measuring} change${measuring === 1 ? " is" : "s are"} measuring.`;
  } else {
    headerSentence = "Nothing needs a decision today. I am still gathering evidence, and I will rank your next moves as it lands.";
  }
  return { headerSentence, nextOpportunities: ready, readyFixes, ...rest };
}

async function loadTodayViewUncached(): Promise<TodayComposite> {
  const view = await loadChangesView().catch(() => null);
  if (!view) {
    return { today: { headerSentence: "Nothing needs a decision today.", nextOpportunities: [] }, hasChanges: false };
  }
  return { today: buildTodayViewFromChanges(view), hasChanges: view.proposals.length > 0 };
}

/** Compose Today from the exact Changes release that will ship beside it, and from
 *  what that release's own production pass concluded. */
export async function buildTodayCompositeFromChanges(view: ChangesView, producer: TodayProducerSignal = {}): Promise<TodayComposite> {
  return { today: buildTodayViewFromChanges(view, producer), hasChanges: view.proposals.length > 0 };
}

export async function loadTodayView(): Promise<TodayComposite> {
  return loadTodayViewWithSwr(await currentTenantId());
}

type TodayViewBuilder = (tenantId: string) => Promise<TodayComposite>;

/** Exported for tests; render paths go through loadTodayView above. */
export async function loadTodayViewWithSwr(
  tenantId: string,
  deps: { build?: TodayViewBuilder } = {},
): Promise<TodayComposite> {
  const build = deps.build ?? (() => loadTodayViewUncached());
  const scheduleReleaseRebuild = () =>
    after(async () => {
      const { refreshCustomerSurface } = await import("./surface-release");
      await refreshCustomerSurface(tenantId).catch(() => null);
    });

  // One lean head-count, in parallel with the surface read: zero tracked
  // questions is the ONE state that stops research outright, and Today has to
  // name it rather than look merely quiet. A failed count (null) claims
  // NOTHING: a false zero would advertise a recovery the account does not need.
  const [customer, trackedCount] = await Promise.all([
    readCustomerSurface(tenantId).catch(() => null),
    countTrackedQuestions(tenantId).catch(() => null),
  ]);
  const paused = trackedCount === 0
    ? { needsTrackedQuestions: true, trackedQuestionsHref: "/settings/config#tracked-ai-prompts" }
    : {};

  if (customer) {
    if (isCustomerSurfaceStale(customer.computedAt, Date.now())) scheduleReleaseRebuild();
    // THE SAME BAR CHANGES APPLIES. Serving today's slice straight off the stored
    // release let Today promise "I have a fix ready" and link to a change the detail
    // page then called set aside, on one click. The release is re-checked against the
    // basis this account holds now, and Today is rebuilt from what survives.
    const gated = withCurrentBasisOnly(customer.changes, await resolveCurrentBasis(tenantId).catch(() => null));
    const today = gated.proposals.length === customer.changes.proposals.length
      ? customer.today.today
      : buildTodayViewFromChanges(gated);
    return {
      ...customer.today,
      today,
      ...paused,
      surfaceVersion: customer.releaseId,
      surfaceComputedAt: sanitizeSurfaceComputedAt(customer.computedAt) ?? undefined,
    };
  }
  scheduleReleaseRebuild();
  return { ...(await build(tenantId)), ...paused };
}
