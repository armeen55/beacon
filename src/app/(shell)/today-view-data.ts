import "server-only";

/** today-view-data (CORE 100K cutover, 2026-07-22) - Today's slice, derived from the SAME ranked ChangeProposals /changes renders
 *  (loadChangesView). No parallel recommendation engine, no new persistence. Today answers only: what is the one best move next, and how
 *  much is measuring. */
import { after } from "next/server";
import { currentTenantId } from "@/lib/tenant-context";
import { loadChangesView, sanitizeSurfaceComputedAt, type ChangesView } from "./changes-data";
import { pageLabel } from "./changes/types";
import { readCustomerSurface, isCustomerSurfaceStale } from "./surface-release";
import { countTrackedQuestions, researchPermission, researchRunStatus } from "@/domains/runtime";
import { checkBudget } from "@/domains/decision";
import { openHold, type BundleComponent, type ChangeProposal } from "@/domains/decision";

/** One ranked "do this next" change Today reads. FOUR FIELDS, because four are rendered: the effort, the upside,
 *  the ranking sentence and the evidence tier rode this shape for months and no screen ever read one of them. */
type TodayOpportunity = { changeId: string; pageLabel: string; recommendation: string; problem?: string;
  /** ONLY FINISHED WORK REACHES TODAY (Product Truth, 2026-08-27): the top card and Up next draw from the ready lane alone, so
   *  the lane is stated once and can be nothing else. */
  lane: "ready" };

/** The minimal Today read model the Today page renders: the header sentence plus the ranked next opportunities. Owned here now that the
 *  changes-domain today-view was retired. */
type TodayView = {
  headerSentence: string;
  nextOpportunities: TodayOpportunity[];
  /** THE EXACT EDIT AT THE TOP OF THE QUEUE. Today used to lead with the paragraph arguing the change, so the
   *  first thing read was reasoning for a thing nobody had been told to do yet. The action comes first now, then
   *  the words on the page and the words to put there; the reason follows. Absent when the top change carries no
   *  line at all, and `paste` is false for a plan that is read rather than pasted. */
  topEdit?: { action: string; lead: string; before: string | null; after: string; paste: boolean; where?: string;
    /** The structure and the link the Changes card carries, so Today's Copy hands over the same payload. */
    units?: BundleComponent["units"]; link?: { href: string; anchor: string };
    /** One plain sentence above a block of code, so the first thing on the screen is never JSON (operator walk, 2026-09-16). */ markup?: string };
  /** The earliest date a page that could not be read may be tried again. Today says the date, because a wait is not activity. Carried on the
   *  release so a rebuild off a stale one keeps the sentence; nothing else the production pass concluded is stored, because no screen read it. */
  waitingUntil?: string;
  /** THE SIZE OF THE READY QUEUE, uncapped, beside the capped `nextOpportunities` preview. ONE queue, ONE number: the command used to count
   *  the preview and say "4 more" under a header that said 12. */
  readyTotal?: number;
  /** WHAT IS STILL BEING WRITTEN, CHECKED OR RESEARCHED, counted in the database, for the one status line Today prints under an
   *  empty top slot. The written count leaves out the rows Changes shows as the operator's own decision. */
  preparing?: { written: number; researching: number };
};

export type TodayComposite = {
  today: TodayView;
  hasChanges: boolean;
  surfaceVersion?: string;
  surfaceComputedAt?: string;
  /** TRUE when zero questions are tracked, which is the one state that stops research outright. Today shows the fix instead of a
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

/** One imperative line for one proposal (the "do this next" line). */
function recommendationOf(p: ChangeProposal): string {
  const c = p.recommendedChange;
  // Slice 7: a bundled change already states its objective in one plain sentence.
  if (p.bundle) return p.bundle.objective;
  // A producer that wrote a real headline (a sentence, no slug or address in it) owns this line, the same rule Changes reads.
  if (p.opportunityType.includes(" ") && p.opportunityType.length > 20 && !/(^|\s)\//.test(p.opportunityType)) return p.opportunityType;
  if (c.kind === "new_page") return `Build a new page that answers "${p.primaryQuery}"`;
  const field = c.field === "meta" ? "meta description" : c.field.replace(/_/g, " ");
  return `Update the ${field} on ${pageLabel(p.pagePath) || p.pageLabel} to sharpen it for "${p.primaryQuery}"`;
}

/** PURE: map a ranked proposal to Today's opportunity shape. The PROBLEM rides along, because three directives
 *  with no statement of what any of them is for is a chore list, not a recommendation. */
const proposalToOpportunity = (p: ChangeProposal): TodayOpportunity => ({ changeId: p.id, pageLabel: p.pageLabel,
  recommendation: recommendationOf(p), lane: "ready", ...(p.whyItMatters ? { problem: p.whyItMatters } : {}) });

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
    // THE PAGE, SAID THE WAY A PERSON SAYS IT (audit 3.9): the headline printed the raw path, and Changes already reads the same path through pageLabel.
    action: c.linkTo ? `Add a link on ${p.pagePath ? pageLabel(p.pagePath) : p.pageLabel}` : c.field === "schema" ? `${c.before ? "Replace the structured data on" : "Add structured data to"} ${p.pagePath ? pageLabel(p.pagePath) : p.pageLabel}` : c.before == null && (c.field === "section" || c.field === "answer_block") ? `Add a paragraph to ${p.pagePath ? pageLabel(p.pagePath) : p.pageLabel}` : `Change the ${field} on ${p.pagePath ? pageLabel(p.pagePath) : p.pageLabel}`, // the verb the Changes card uses: a link is added, a paragraph is added, markup is added or replaced (operator walk, 2026-09-16: "Change the section on Samanid empire flag" for an added link)
    lead: "Change to: ",
    ...(c.field === "schema" ? { markup: "This is code for the page head, not visible text. It tells Google which questions this page answers, in Google's own format." } : {}),
    before: (c.before ?? "").trim() || null,
    after,
    paste: true,
    ...(c.units ? { units: c.units } : {}),
    ...(c.linkTo ? { link: { href: c.linkTo, anchor: c.anchorText ?? "" } } : {}),
    // WHERE IT GOES rides the one card the operator is steered to first: the Changes card has always carried it, and the Today card, the single card most operators act from, omitted it, so body copy arrived with no place to put it (blind customer review, 2026-08-25).
    ...((c.where ?? "").trim() ? { where: c.where!.trim() } : {}),
  };
}

/** How many ranked changes Today carries. Today renders the FIRST one and nothing else; the rest ride along so a caller that wants the
 *  runners-up never has to re-rank anything. */
/** WHAT THE LAST DRIVE LEFT UNDONE, SAID WHERE THE OPERATOR ALREADY READS THE DAY (measured, 2026-09-05). A drive that runs out of time writes the step it could not pay for onto its own row ("Publishing what this day found needs 40 seconds and this drive had 32 left, so nothing was started for it"), and nothing outside the runtime read it: Today said "Read 10 new answers closely today at 10:33 AM." while the day's last step had not run and the ranked list stood one pass behind. A paused run is a fact the row already carries whole, so the number, the step and what happens next are said here off the same view the heartbeat comes from. An interrupted run already says it stopped partway and is left alone. */
/** AND THE PAGES A PAID SEARCH PUT IN FRONT OF THIS ACCOUNT THAT NOTHING HAS READ ARE SAID HERE TOO, off the same run row's own receipt: the runtime has counted them since the winner read was made due and no surface carried the number, so a day that owed a reading of pages already paid for read as a day that owed nothing. Said only above zero, and never at all where the count could not be read, because unknown is not none. */
/** AND THE TWO DEADLINE ANSWERS ARE TWO SENTENCES, NEVER ONE (2026-09-05). A drive that runs out of time leaves two different states behind and they were told apart nowhere an operator could read: a step it would not START because it could not pay for it (nothing is running, the next pass takes it first), and a walk it STOPPED WAITING FOR (the writing carried on, what it spent is remembered, its work is owed again at its own rank). Both are said, each in its own words, and each stands on its own without the other. */
const unrunStep = (v: Awaited<ReturnType<typeof researchRunStatus>> | null): string => {
  if (v == null || v.liveness?.state === "interrupted") return ""; // an interrupted run already says it stopped partway and is left alone
  const n = v.winnersOwed ?? 0, owed = n > 0 ? `${n} page${n === 1 ? "" : "s"} winning a search already bought ${n === 1 ? "is" : "are"} owed a read. The next pass reads ${n === 1 ? "it" : "them"}.` : null;
  const both = [v.waiting, v.blocker, owed].filter((x): x is string => !!x), said = both.map((x) => ` ${x}`).join("");
  if (v.state === "queued") return ` Research continues from ${v.phaseLabel} on the next pass.${said}`;
  if (v.state !== "paused" || !v.phaseLabel) return said; // a run that did not pause still owes these two facts about its last drive
  return ` Research paused after ${v.stepsDone} of ${v.stepsTotal} steps, so ${v.phaseLabel} has not run yet.${said}${v.pauseReason ? ` ${v.pauseReason}` : both.length > 0 ? "" : " The next pass starts there."}`;
};
const TODAY_PREVIEW_LIMIT = 3;

/** What THIS release's production pass concluded that Today prints: the earliest retry date from the canonical coverage pass, absent when
 *  nothing is waiting. Read back off the release itself on a rebuild, so the retry sentence survives a basis shift. */
type TodayProducerSignal = { waitingUntil?: string | null };

/** A retry date in the operator's words: the day, never a timestamp and never a countdown. */
const retryDay = (iso: string): string =>
  new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "America/Los_Angeles" });

/** PURE: build the Today slice from a ChangesView. ONE LANE REACHES TODAY: the validated exact-copy changes, best first. A card still waiting
 *  on a review is COUNTED in its own clause and never offered as work. The COUNT is the whole lane counted in the database, never the page. */
export function buildTodayViewFromChanges(view: ChangesView, producer: TodayProducerSignal = {}): TodayView {
  // THE COUNT IS THE COUNT, NEVER THE PAGE. `view.ready` is one page of the ranking now, so counting it would under-report the queue Today
  // is drawing from; `summary` carries the total counted in the database.
  const readyTotal = view.summary?.ready ?? view.ready.length;
  // ONLY WHAT IS READY IS OFFERED (Product Truth, 2026-08-27). Today used to draw its preview off ready, review AND research
  // together, so a day with nothing finished opened on a draft labelled "Still being checked" with a Copy press on it. The
  // preview is the top of the ready lane in the ranking's own order, at most three, and everything else is one count.
  const rank = new Map((view.proposals ?? []).map((p, i) => [p.id, i]));
  const ready = [...view.ready].sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity)).slice(0, TODAY_PREVIEW_LIMIT).map(proposalToOpportunity);
  const decisions = (view.toDo ?? []).filter((p) => { const h = openHold(p); return h.safetyHold && !h.faulted; }).length;
  const preparing = { written: Math.max(0, (view.summary?.todo ?? view.toDo.length) - decisions), researching: view.summary?.research ?? (view.research ?? []).length };
  const topEdit = view.ready[0] ? topEditOf(view.ready[0]!) : undefined;
  const waiting = producer.waitingUntil && Number.isFinite(Date.parse(producer.waitingUntil)) ? producer.waitingUntil : null;
  const rest = { ...(waiting ? { waitingUntil: waiting } : {}), readyTotal, preparing };
  // ONE SENTENCE, AND EVERY CHANGE IT COUNTS IS FINISHED WORK: the READY lane alone, which is the only lane
  // whose words are written, checked and pasteable today. THE OPENING IS NOT A STATUS ESSAY (operator,
  // 2026-08-21): the draft and research counts left this sentence entirely, because Changes labels those
  // lanes itself and Today opens on the one number that is work.
  const openTotal = readyTotal;
  const headerSentence = openTotal > 0
    ? `You have ${openTotal} finished ${openTotal === 1 ? "change" : "changes"} ready to make, best first.`
    : waiting
      ? `No finished change is ready today. Some of your pages could not be read, so they get another try on ${retryDay(waiting)}.`
      // A ROW IS SERVED WHATEVER THE BAR SAYS (owner's editorial policy, 2026-09-06): the release keeps every row the account holds, so an unreadable bar no longer empties the queue and Today no longer explains an emptied one.
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
    ...(runStatus?.liveness?.line && (permission === "running" || runStatus.state !== "queued") ? { researchLiveness: `${runStatus.liveness.line}${unrunStep(runStatus)}` } : {}) };
  // WHAT IS SAID WHEN NOTHING COULD BE READ. "Nothing needs a decision today" is the one sentence an outage must never produce: it is a claim
  // about their business they cannot tell apart from the truth.
  const unreadable = "Your changes could not be read just now, so the day is not being called clear. The next check runs on its own.";
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
      today: view ? buildTodayViewFromChanges(view, { waitingUntil: customer.today.today.waitingUntil }) : customer.today.today,
      ...paused,
      ...research,
      surfaceVersion: view?.surfaceVersion ?? customer.releaseId,
      surfaceComputedAt: sanitizeSurfaceComputedAt(customer.computedAt) ?? undefined,
    };
  }
  // No release on file yet: build one page of Today off the Changes read, and say nothing that cannot be shown.
  scheduleReleaseRebuild();
  const view = await loadChangesView().catch(() => null);
  if (!view || (view.releaseUnreadable && view.proposals.length === 0)) {
    return { today: { headerSentence: unreadable, nextOpportunities: [] }, hasChanges: false, ...paused, ...research };
  }
  return { today: buildTodayViewFromChanges(view), hasChanges: view.proposals.length > 0, ...paused, ...research };
}
