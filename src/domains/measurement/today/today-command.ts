/**
 * today-command (V1 Truth Convergence Phase 8, 2026-08-01) - THE one command model for Today.
 * Today answers one question in under five seconds: "what is the single best thing I should do
 * now?".
 *
 * FOUR PRIMARY STATES, AND EXACTLY ONE AT A TIME:
 *   needs_attention - something genuinely blocks me, so today's numbers are not trustworthy yet.
 *   act_now         - I hold at least one change that is ready to apply, best first.
 *   researching     - work is running or waiting on a date, with the numbers the run persisted.
 *   monitoring      - changes you applied are measuring and nothing stronger is ready.
 *
 * THIS REPLACES the five overlapping command kinds that came before it (fix_defect,
 * background_recovery, respond_to_loss, ship_move, observe), where a losing page and a ready
 * move were two different "do this" cards competing for the same slot, and a quiet day could
 * read as all clear on a screen that also reported pages losing clicks.
 *
 * NEVER ALL CLEAR WITH LOSSES. `losingNote` is computed independently of the state and renders
 * in every one of them, so a page bleeding clicks is said out loud whether I have a fix for it
 * or not. A loss is evidence that something moved; it was never evidence of what to do, so it
 * informs the card and never takes it over.
 *
 * PURE, no I/O. Deterministic for a fixed input. Beacon voice: first person, a concrete number
 * when one exists, always a next step; no lab jargon; no em or en dashes.
 */

import type { TodaySmokeAlarm } from "@/components/today/today-smoke-alarm";

/** How much comparison evidence stands behind a move (CORE 100K: owned here now
 *  that the changes-domain today-view/canonical-change types were retired). */
export type EvidenceStrength = "strong" | "directional" | "tracking";

/** One ranked "do this next" change Today reads, derived from a ranked
 *  ChangeProposal (see today-view-data). */
export type TodayOpportunity = {
  changeId: string;
  pageLabel: string;
  recommendation: string;
  opportunityType: string;
  estimatedEffortMinutes: number;
  upside: number | null;
  evidenceStrength: EvidenceStrength;
  /** WHY THIS SITS WHERE IT SITS, stamped by the ONE ranker (rank-proposals) and rendered
   *  rather than recomputed. Absent on the last ranked row, which has nothing below it. */
  whyRankedAboveNext?: string;
  /** THE PROBLEM THIS SOLVES, in the proposal's own sentence. A move with no problem on it is a
   *  chore; the operator deserves to read what it is for before doing it. */
  problem?: string;
};

/** The four states Today may be in. There is no fifth, and no two at once. */
type TodayPrimaryState = "needs_attention" | "act_now" | "researching" | "monitoring";

type TodayCommand = {
  state: TodayPrimaryState;
  /** One bold directive: the single best thing to do now. */
  headline: string;
  /** The evidence lines under the headline (up to five, only as many as are true). */
  why: string[];
  /** One exact next step, in plain first person. */
  exactAction: string;
  /** The one accent call to action (never more than one). */
  cta: { label: string; href: string } | null;
  /** The top three ranked changes. Only `act_now` ever carries any. */
  ranked: TodayOpportunity[];
  /** THE WORK THAT IS REAL BUT NOT YET A CHANGE: the topics I am buying evidence on and the
   *  pages I am watching, best first. It renders in EVERY state except a blocker, because an
   *  account holding open topics and declining pages must never read as an account with nothing
   *  happening. Empty only when there genuinely is nothing open. */
  inResearch: { label: string; signal: string; nextStep: string; href: string }[];
  /** A page or a whole site losing clicks, in one sentence, whatever the state.
   *  Null only when nothing is actually losing. */
  losingNote: string | null;
};

/** What the persisted Research Run row says about work in flight, straight off the
 *  columns run-status projects. Nothing here is recomputed or guessed. */
type TodayResearchProgress = {
  /** The run is open and being worked right now. */
  running?: boolean;
  /** The plain-language phase the row records ("researching what your customers search for"). */
  phaseLabel?: string;
  /** Today's AI checks, as the planner's own arithmetic persisted them. */
  checksDone?: number;
  checksTotal?: number;
  /** Topics the frozen plan still has open. */
  casesActive?: number;
  /** The earliest date a promised retry becomes legal. */
  nextDueAt?: string | null;
};

export type TodayCommandInput = {
  /** First-person sentences for each genuine blocker: a connection that failed, a spending
   *  breaker that tripped, a business profile I do not hold. Empty on a healthy account.
   *  A stale-but-connected warning is NOT a blocker and must be filtered out upstream. */
  blockers: readonly string[];
  /** Where the operator fixes the blocker above. */
  blockerHref?: string;
  /** The page-blame smoke alarm (a specific page losing real clicks), or null. Already gated at
   *  its own floor (MIN_CLICKS_LOST = 10) upstream, so its mere presence is a material loss. */
  smokeAlarm: TodaySmokeAlarm | null;
  /** Week over week percent change in search clicks (rounded), or null when there is not enough
   *  history to say. A whole-site drop is a material loss even when no single page took blame. */
  scoreboardDeltaPct: number | null;
  /** The ranked ready PREVIEW, best first. One or more of these IS the act-now state. This is
   *  capped upstream (today-view-data previews three), so it is never the size of the queue. */
  readyChanges: readonly TodayOpportunity[];
  /** THE SIZE OF THE QUEUE, uncapped. ONE queue may only ever be given ONE number: counting the
   *  capped preview above made the card say "4 more are ranked under it" on the same screen whose
   *  header said 12 were ready. Absent = the preview really is everything. */
  readyTotal?: number;
  /** The kernel's own verdict for the declining page when it earned no change
   *  ("...its search click-through is healthy, so I am watching it..."), in one plain
   *  sentence. Absent = quote no verdict and say plainly that I have not found a change. */
  declineVerdict?: string | null;
  /** verdictSchedule.firstReadOn (YYYY-MM-DD, UTC): the soonest date the next results land. */
  firstReadOn: string | null;
  /** The earliest date a page I could not read may legally be tried again, or null when nothing
   *  is waiting. While it is set I am not checking anything: I am waiting, and I have to say so. */
  waitingUntil?: string | null;
  /** The canonical count of changes still measuring (countLedgerLifecycle). */
  measuringCount: number;
  /** The persisted run row, when there is one. */
  research?: TodayResearchProgress;
  /** Drafts this pass held back because the page already carries a change I am measuring. */
  heldForMeasurement?: number;
  /** Proven losses whose cause I am still identifying. */
  investigating?: number;
  /** THE BACKLOG WAITING ON A HUMAN LOOK (the Needs review lane's own total). A quiet-day
   *  sentence is a claim about the WHOLE account, so it may not be said over ideas that are
   *  sitting there waiting for the operator; every state that could go quiet names this first. */
  toDo?: number;
  /** The ranked open work that is not a change yet (topics being researched, pages being
   *  watched), already ordered and capped by the caller. */
  inResearch?: readonly { label: string; signal: string; nextStep: string; href: string }[];
};

/**
 * The material-loss threshold: a whole-site week-over-week drop this steep is a real loss even
 * with no single blamed page. Deliberately NOT the -2 amber COLOR threshold the scoreboard uses
 * to tint its delta (scoreboard-section.tsx): a small dip changes the color, only a real drop
 * earns a sentence of its own.
 */
const LOSS_DELTA_PCT = -10;

/** Drop a single trailing period so a directive never reads with two dots. */
function stripPeriod(s: string): string {
  return s.replace(/\.\s*$/, "");
}

/** A date in the operator's words: the day, never a timestamp and never a countdown. A bare
 *  YYYY-MM-DD is a FINALIZED DAY (the measurement schedule's own unit) and is read in UTC, so
 *  the day I promise is the day I named; a full timestamp is a moment and is read where the
 *  operator lives, which is the same rule today-view-data's retry sentence follows. */
const dayLabel = (iso: string): string => {
  const dateOnly = iso.length === 10;
  return new Date(dateOnly ? `${iso}T00:00:00Z` : iso).toLocaleDateString("en-US", {
    month: "long", day: "numeric", timeZone: dateOnly ? "UTC" : "America/Los_Angeles",
  });
};

/** A date I can actually say, or null. An unparseable stamp promises nothing. */
const usableDay = (iso: string | null | undefined): string | null =>
  iso && Number.isFinite(Date.parse(iso.length === 10 ? `${iso}T00:00:00Z` : iso)) ? iso : null;

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

/**
 * The command card's own evidence words, mapped from the SAME evidenceStrength field the
 * Changes list reads, but plainer: "Directional signal." and "Tracking only." read as lab
 * jargon inside the one command's evidence bullet.
 */
const COMMAND_EVIDENCE_WORD: Record<EvidenceStrength, string> = {
  strong: "Strong comparison behind it.",
  directional: "Early evidence, worth doing.",
  tracking: "Still building evidence for this one.",
};

/** The command's CTA opens the ranked Changes queue with the recommended move on top. */
const CHANGES_HREF = "/changes";

/**
 * ONE honest sentence about what is losing clicks, computed for EVERY state. A page the
 * decision kernel resolved to watch carries the kernel's own verdict; a page with no verdict
 * says plainly that I have not found a change for it; a whole-site drop with nobody to blame
 * says exactly that. This is what makes an all-clear-with-losses screen impossible.
 */
function losingNoteOf(input: TodayCommandInput): string | null {
  const alarm = input.smokeAlarm;
  if (alarm) {
    const verdict = input.declineVerdict?.trim();
    if (verdict) return verdict;
    const lost = `${alarm.page} lost ${alarm.clicksLost.toLocaleString()} ${plural(alarm.clicksLost, "click", "clicks")} vs ${alarm.windowLabel}`;
    return alarm.hasReadyFix
      ? `${lost}, and the change I have ready for it is in your queue.`
      : `${lost}, and I have not found a change on it my evidence supports yet, so I am watching it rather than sending you to rewrite a page that may be winning.`;
  }
  const delta = input.scoreboardDeltaPct;
  if (delta != null && delta <= LOSS_DELTA_PCT) {
    return `Your search clicks are down ${Math.abs(delta)}% vs the week before, and no single page took the blame, so this is a whole-site dip.`;
  }
  return null;
}

// ── the four states ───────────────────────────────────────────────────────────

/** The open work, best first, capped at three. Rendered in every state but a blocker. */
const openWork = (input: TodayCommandInput): TodayCommand["inResearch"] => (input.inResearch ?? []).slice(0, 3).map((r) => ({ ...r }));

/** The backlog sentence, or null when the Needs review lane really is empty. */
function reviewLine(input: TodayCommandInput): string | null {
  const n = input.toDo ?? 0;
  return n > 0 ? `${n} ${plural(n, "idea is", "ideas are")} waiting for your review on Changes.` : null;
}

/** 1. Something blocks me, so the numbers on this screen are not trustworthy yet. */
function needsAttention(input: TodayCommandInput): TodayCommand {
  return {
    state: "needs_attention",
    headline: "Something needs you before I can trust today's numbers.",
    why: input.blockers.slice(0, 4).map((s) => s.trim()).filter(Boolean),
    exactAction: "Fix the one flagged above, then refresh so I can trust the numbers again.",
    cta: { label: "Fix this now", href: input.blockerHref ?? "/settings/connectors" },
    ranked: [],
    inResearch: [],
    losingNote: losingNoteOf(input),
  };
}

/** 2. I hold work that is ready to apply. The top three ride the card, best first. */
function actNow(input: TodayCommandInput): TodayCommand {
  const ranked = input.readyChanges.slice(0, 3);
  const top = ranked[0]!;
  const why: string[] = [];
  // MODELED OPPORTUNITY, NEVER PROMISED LIFT. This line used to read "about N more clicks a
  // month if this works", which forecast an edit against a curve that only ever measured a
  // ceiling.
  why.push(
    top.upside != null && Number.isFinite(top.upside) && top.upside > 0
      ? `${top.pageLabel}: this search earns about ${Math.round(top.upside).toLocaleString()} fewer clicks a month than pages at a similar position usually get.`
      : `This one is on ${top.pageLabel}.`,
  );
  why.push(COMMAND_EVIDENCE_WORD[top.evidenceStrength]);
  why.push(`About ${top.estimatedEffortMinutes} ${plural(top.estimatedEffortMinutes, "minute", "minutes")} of work.`);
  // OFF THE QUEUE, NEVER OFF THE PREVIEW. The card may still render three; the sentence counts
  // what is actually ranked, which is the same number the header says.
  const total = Math.max(input.readyTotal ?? 0, input.readyChanges.length);
  if (total > 1) {
    const rest = total - 1;
    why.push(`${rest} more ${plural(rest, "change is", "changes are")} ranked under it, and I say below why this one goes first.`);
  }
  return {
    state: "act_now",
    headline: `Do this next: ${stripPeriod(top.recommendation)}.`,
    why,
    exactAction: `Open ${top.pageLabel} on Changes to make this change.`,
    cta: { label: "See the change", href: CHANGES_HREF },
    ranked,
    inResearch: openWork(input),
    losingNote: losingNoteOf(input),
  };
}

/** 3. Work is running or waiting on a date, in the run's own persisted numbers. */
function researching(input: TodayCommandInput): TodayCommand {
  const r = input.research ?? {};
  const waiting = usableDay(input.waitingUntil);
  const due = usableDay(r.nextDueAt);
  const investigating = input.investigating ?? 0;

  // A WAIT IS NOT A CHECK. Saying I am "checking" while the next legal read is tomorrow made a
  // cooldown read as work in flight and left the operator refreshing a page that could not change.
  const headline = waiting
    ? `I could not read some of the pages I need, so I am waiting until ${dayLabel(waiting)} to try them again.`
    : r.running && r.phaseLabel
      ? `I am researching right now: ${r.phaseLabel}.`
      : investigating > 0
        ? `I found ${investigating} ${plural(investigating, "page", "pages")} losing clicks and I am checking the live results ${plural(investigating, "page", "pages")} before asking you to change anything.`
        : due
          ? `My last research pass is finished, and nothing more is due until ${dayLabel(due)}.`
          : "I am still gathering evidence, and I will rank your next move here as soon as one earns it.";

  const why: string[] = [];
  if (typeof r.checksDone === "number" && typeof r.checksTotal === "number" && r.checksTotal > 0) {
    why.push(`${r.checksDone} of ${r.checksTotal} AI checks done today.`);
  }
  if (typeof r.casesActive === "number" && r.casesActive > 0) {
    why.push(`${r.casesActive} ${plural(r.casesActive, "topic is", "topics are")} still open.`);
  }
  // A DRAFT HELD BACK IS NOT A DRAFT THAT FAILED. The store refuses a fresh idea for a page whose
  // last change is still being measured, and saying so beats letting that page look forgotten.
  const held = input.heldForMeasurement ?? 0;
  if (held > 0) {
    why.push(`I am holding ${held} new ${plural(held, "idea", "ideas")} back because ${plural(held, "that page", "those pages")} already ${plural(held, "carries", "carry")} a change I am measuring.`);
  }
  // RESEARCH DOES NOT SWALLOW WHAT IS OWED. Work in flight used to erase the measuring count and
  // the date its first read lands, so an operator whose changes were being measured lost both
  // numbers the moment a run opened.
  if (input.measuringCount > 0) {
    why.push(`${input.measuringCount} of your ${plural(input.measuringCount, "change is", "changes are")} still measuring.`);
    const read = usableDay(input.firstReadOn);
    if (read) why.push(`The first read on those lands around ${dayLabel(read)}.`);
  }
  const open = openWork(input);
  const review = reviewLine(input);
  if (review) why.unshift(review);
  if (open.length > 0) {
    why.push(`${open.length === 1 ? "1 topic is" : `${open.length} topics are`} open below, with what I hold and what I am buying next on each.`);
  }
  if (why.length === 0) why.push("My next daily round picks this back up, and nothing here needs you first.");

  // NOT "there is nothing for you to do". That sentence is false on an account holding open
  // topics, declining pages and a backlog, and it is the one line that makes a working system
  // read as a broken one. NO CHANGE BEING READY is a true and much smaller claim, so it is the
  // one I make, and the work in flight is named right under it.
  return {
    state: "researching",
    headline,
    why: why.slice(0, 5),
    exactAction: review
      ? `No change is ready to apply yet. ${review} Start at the top of that list: I ranked it.`
      : waiting
        ? `No change is ready for you to make yet. I retry those pages myself from ${dayLabel(waiting)} and rank whatever they earn on Changes.`
        : "No change is ready for you to make yet. Here is what I am working on, and it lands on Changes the moment it earns a change.",
    cta: review || open.length > 0
      ? { label: review ? "Review those ideas" : "See what I am working on", href: CHANGES_HREF }
      : null,
    ranked: [],
    inResearch: open,
    losingNote: losingNoteOf(input),
  };
}

/**
 * 4. Changes you applied are live and measuring, and nothing stronger is ready.
 *
 * MONITORING OWNS THE QUIET DAY OUTRIGHT. A page under investigation and an idea held back are
 * both real, and neither is present-tense work: claiming "researching" over them asserted a run
 * that was not open, and cost the operator the measuring count, the read date and the one place
 * they can go look. They render as lines INSIDE this state instead.
 */
function monitoring(input: TodayCommandInput): TodayCommand {
  const n = input.measuringCount;
  const why: string[] = [];
  const read = usableDay(input.firstReadOn);
  if (read) why.push(`The first read lands around ${dayLabel(read)}.`);
  const investigating = input.investigating ?? 0;
  if (investigating > 0) {
    why.push(`I found ${investigating} ${plural(investigating, "page", "pages")} losing clicks and I am checking the live results for ${plural(investigating, "it", "them")} before asking you to change anything.`);
  }
  const held = input.heldForMeasurement ?? 0;
  if (held > 0) {
    why.push(`I am holding ${held} new ${plural(held, "idea", "ideas")} back because ${plural(held, "that page", "those pages")} already ${plural(held, "carries", "carry")} a change I am measuring.`);
  }
  const open = openWork(input);
  const review = reviewLine(input);
  // AN ALL CLEAR IS A CLAIM, AND IT NEEDS AN EMPTY BOARD BEHIND IT. Saying nothing has moved
  // enough to need a decision, over topics I am actively buying evidence on OR over ideas
  // sitting in the review lane, told the operator their account was idle while I was working
  // it and while work of their own was waiting. The dead end sentence needs BOTH to be empty.
  if (review) why.unshift(review);
  if (open.length > 0) {
    why.push(`${open.length === 1 ? "1 topic is" : `${open.length} topics are`} open below, and I rank whatever they earn on Changes.`);
  } else if (!review) {
    why.push("Nothing I am tracking has moved enough to need a decision from you.");
    why.push("I will tell you the moment one of them needs one.");
  }
  return {
    state: "monitoring",
    headline: `${n} ${plural(n, "change is", "changes are")} live and measuring.`,
    why: why.slice(0, 5),
    exactAction: review
      ? `${review} Start at the top of that list: I ranked it.`
      : open.length > 0
        ? "No change is ready for you to make today. The research listed here is mine to finish, not yours."
        : "Check back tomorrow, or look at what is measuring.",
    cta: review ? { label: "Review those ideas", href: CHANGES_HREF } : { label: "See what's measuring", href: "/results" },
    ranked: [],
    inResearch: open,
    losingNote: losingNoteOf(input),
  };
}

/**
 * THE one command for Today. Exactly one of four states, by strict priority:
 *   1. a genuine blocker  -> needs_attention (numbers are not trustworthy; fix it first)
 *   2. a ready change     -> act_now         (the top three, best first)
 *   3. work in flight     -> researching     (a run is open, or a promised date is on the clock)
 *   4. otherwise          -> monitoring      (what you applied is measuring)
 *
 * RESEARCHING IS A CLAIM ABOUT RIGHT NOW, so it needs genuine activity (an open run) or a
 * scheduled wait (a retry date, a next-due date). An investigation with nobody working it and an
 * idea held back are FACTS, not activity, and they render inside whichever state is true instead
 * of manufacturing one. The one exception is the cold account with nothing measuring at all: the
 * visit itself starts the run (the page kicks it after the response), so that claim is true.
 *
 * The last two are total between them: `researching` owns the cold account, monitoring owns every
 * account with work under measurement, so there is never a fifth answer and never a bare zero.
 *
 * A DECLINE IS NOT AN ACTION. A bleeding page cannot take over the command on its own: it
 * rides `losingNote` in whatever state is true, with the kernel's own verdict when there is
 * one, so a page the kernel resolved to WATCH is never handed over as the next thing to do.
 */
export function buildTodayCommand(input: TodayCommandInput): TodayCommand {
  if (input.blockers.length > 0) return needsAttention(input);
  if (input.readyChanges.length > 0) return actNow(input);
  const r = input.research ?? {};
  const inFlight =
    r.running === true
    || usableDay(input.waitingUntil) != null
    || usableDay(r.nextDueAt) != null;
  const coldAccount = input.measuringCount === 0;
  return inFlight || coldAccount ? researching(input) : monitoring(input);
}

/**
 * Whether the Today greeting's own streak clause ("you are on a roll") may celebrate in this
 * state. The exact live contradiction this exists for: the greeting said "16 changes shipped in
 * the last 14 days, you are on a roll." directly above a command naming a page that lost 163
 * clicks. A celebration must never sit next to a blocker, and never next to a real loss. The
 * streak COUNT itself still renders either way (it stays true), only the clause is suppressed.
 * PURE.
 */
export function commandAllowsCelebration(command: TodayCommand): boolean {
  return command.state !== "needs_attention" && command.losingNote == null;
}
