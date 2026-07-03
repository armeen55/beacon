/**
 * today-goal-pace (P14, v1 329/331 - "goal pace + start-my-day routine") - a one-line honest
 * pace read plus the concrete 20-minute ritual next step:
 *
 *   "You have shipped 3 of your 5 changes this week. Two left. Start your day: open the top
 *    change on /cities, then check yesterday's numbers."
 *
 * PURE (no I/O). Every number reuses a count another Today surface already owns: `shippedThisWeek`
 * is the same weekly ledger tally the cumulative-outcome strip reads, `weeklyGoal` is the tenant's
 * standing weekly change goal, `ready` is the prepared-not-yet-shipped count (the same tonight
 * chip number). No new store, no new persistence - this composes existing counts into the daily
 * ritual line the owner's manual describes.
 *
 * The pace clause is honest in both directions: ahead of pace celebrates in one sentence, behind
 * pace states the gap plainly without hedging filler. The ritual clause always gives ONE concrete
 * next action, chosen from what is actually actionable right now (a ready change to open, else a
 * measuring result to peek at, else planning tonight's batch) so "start my day" is never a dead
 * end. Beacon voice: first person, a concrete number, a next step; no lab jargon; no em/en dashes.
 */

export type TodayGoalPace = {
  /** The honest pace read, e.g. "You have shipped 3 of your 5 changes this week. Two left." */
  paceClause: string;
  /** The concrete 20-minute ritual next step, e.g. "Start your day: open the top change ...". */
  ritualClause: string;
  /** Where the ritual's action link points. */
  href: string;
  /** The action link text. */
  actionLabel: string;
  /** Progress toward the weekly goal, 0..1, for a subtle bar (never over 1). */
  progress: number;
  /** true when at or past the weekly goal - the celebratory tone. */
  onTrack: boolean;
};

/** Spelled small counts read warmer than digits in a sentence ("Two left" not "2 left"). */
function spell(n: number): string {
  const words = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
  return n >= 0 && n <= 10 ? words[n] : n.toLocaleString();
}

function prettyPath(u: string): string {
  const p = (u.replace(/^https?:\/\/[^/]+/i, "") || "/").replace(/\/$/, "") || "/";
  return p.length > 40 ? p.slice(0, 37) + "..." : p;
}

/**
 * Compose the pace + ritual lines. Returns null only when there is genuinely nothing to pace or
 * do (no goal set AND nothing shipped AND nothing ready AND nothing measuring) - a fresh, empty
 * tenant, where a "0 of 0" strip would just be noise. Otherwise it always returns both a pace
 * read and a concrete ritual step.
 */
export function buildTodayGoalPace(input: {
  shippedThisWeek: number;
  /** Standing weekly change goal (0 when the tenant has not set one). */
  weeklyGoal: number;
  /** Prepared, not-yet-shipped picks (the tonight-chip "ready" number). */
  ready: number;
  /** Whole-tenant in-flight measuring count (the same number the measuring strip shows). */
  measuring: number;
  /** The page of the top ready change to open, when one exists. */
  topReadyPage: string | null;
  nowMs: number;
}): TodayGoalPace | null {
  const { shippedThisWeek, weeklyGoal, ready, measuring } = input;
  if (weeklyGoal <= 0 && shippedThisWeek === 0 && ready === 0 && measuring === 0) return null;

  // ── Pace clause ──
  let paceClause: string;
  let progress: number;
  let onTrack: boolean;
  if (weeklyGoal > 0) {
    const remaining = Math.max(0, weeklyGoal - shippedThisWeek);
    progress = Math.min(1, shippedThisWeek / weeklyGoal);
    onTrack = shippedThisWeek >= weeklyGoal;
    const head = `You have shipped ${shippedThisWeek} of your ${weeklyGoal} change${weeklyGoal === 1 ? "" : "s"} this week.`;
    const tail = onTrack
      ? shippedThisWeek > weeklyGoal
        ? ` You are past your goal by ${spell(shippedThisWeek - weeklyGoal)}.`
        : " Goal met."
      : ` ${spell(remaining).replace(/^./, (c) => c.toUpperCase())} left.`;
    paceClause = head + tail;
  } else {
    // No goal set - report the honest raw pace without a denominator or a fabricated target.
    progress = 0;
    onTrack = shippedThisWeek > 0;
    paceClause =
      shippedThisWeek > 0
        ? `You have shipped ${spell(shippedThisWeek)} change${shippedThisWeek === 1 ? "" : "s"} this week.`
        : "You have not shipped a change yet this week.";
  }

  // ── Ritual clause: ONE concrete next action, from what is actionable right now ──
  let ritualClause: string;
  let href: string;
  let actionLabel: string;
  if (ready > 0 && input.topReadyPage) {
    const page = prettyPath(input.topReadyPage);
    ritualClause = `Start your day: open the top change on ${page}, ship it, then check yesterday's numbers. About 20 minutes.`;
    href = "#daily-experiments";
    actionLabel = "Start with tonight's plan";
  } else if (ready > 0) {
    ritualClause = `Start your day: review your ${spell(ready)} ready change${ready === 1 ? "" : "s"}, ship what looks right, then check yesterday's numbers. About 20 minutes.`;
    href = "#daily-experiments";
    actionLabel = "Start with tonight's plan";
  } else if (measuring > 0) {
    ritualClause = `Start your day: nothing is queued, so peek at the ${spell(measuring)} change${measuring === 1 ? "" : "s"} still measuring, then pick tomorrow's move. About 20 minutes.`;
    href = "/results";
    actionLabel = "See what is measuring";
  } else {
    ritualClause = "Start your day: pick your next change from Changes and get it queued for tonight. About 20 minutes.";
    href = "/changes";
    actionLabel = "Pick tonight's move";
  }

  return { paceClause, ritualClause, href, actionLabel, progress, onTrack };
}
