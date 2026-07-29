/**
 * today-command (Wave 3B, 2026-07-10) - THE one command model for Today. Today's job is to
 * answer one question in under five seconds: "what is the single best thing I should do now?".
 * This PURE selector collapses every Today signal into ONE ranked directive so the operator is
 * never handed three competing "do this" cards again.
 *
 * It SUBSUMES the three separate lead widgets Today used to stack:
 *   - the smoke alarm card (a page bleeding clicks)
 *   - the lead headline card (biggest win + next move)
 *   - the lead of the "What to do next" opportunities list
 * ...into a single command whose kind is chosen by a strict priority so two of them can never
 * shout at once.
 *
 * PURE, no I/O. Deterministic for a fixed input. Beacon voice: first person where it speaks, a
 * concrete number, a next step; no lab jargon; no em or en dashes.
 *
 * P2-b (2026-07-10, visual audit) - the observe copy never repeats a number or date the proof
 * strip (Today slot 5, right below this card) already owns: "N changes measuring" and "next
 * results land around X" used to render on BOTH the command and the strip at once. The observe
 * command now only points at what is measuring, in plain words, with no digit or date of its
 * own - firstReadOn stays on the input type (verdictSchedule's date, still useful context for a
 * future caller) but is deliberately not rendered here anymore.
 */

import type { TodaySmokeAlarm } from "@/components/today/today-smoke-alarm";

/** How much comparison evidence stands behind a move (CORE 100K: owned here now
 *  that the changes-domain today-view/canonical-change types were retired). */
export type EvidenceStrength = "strong" | "directional" | "tracking";

/** The one ranked "do this next" opportunity Today reads, derived from a ranked
 *  ChangeProposal (see today-view-data). */
export type TodayOpportunity = {
  changeId: string;
  pageLabel: string;
  recommendation: string;
  opportunityType: string;
  estimatedEffortMinutes: number;
  upside: number | null;
  evidenceStrength: EvidenceStrength;
};

export type TodayCommandKind = "fix_defect" | "background_recovery" | "respond_to_loss" | "ship_move" | "observe";

/** The one accent call to action. The card renders exactly one of these; it is the only accent
 *  element above the fold. */
export type TodayCommandCta = { label: string; href: string };

export type TodayCommand = {
  kind: TodayCommandKind;
  /** One bold directive: the single best thing to do now. */
  headline: string;
  /** The evidence lines under the headline (up to five, only as many as are true). */
  why: string[];
  /** One exact next step, in plain first person. */
  exactAction: string;
  /** The one accent CTA (never more than one). */
  cta: TodayCommandCta | null;
};

export type TodayCommandInput = {
  /** First-person sentences for each RED-tier pipeline violation (a genuinely broken pipe).
   *  Empty when the pipe is healthy. A stale-but-connected warning is NOT a defect and must be
   *  filtered out by the caller before it lands here. */
  pipelineAlarms: readonly string[];
  /** True only when the defect invalidates measurement itself. A failed draft
   * or page-factory job is operationally real but must not discredit valid GSC. */
  dataTrustBroken?: boolean;
  /** The page-blame smoke alarm (a specific page losing real clicks), or null. Already gated at
   *  its own floor (MIN_CLICKS_LOST = 10) upstream, so its mere presence is a material loss. */
  smokeAlarm: TodaySmokeAlarm | null;
  /** Week over week percent change in search clicks (rounded), or null when there is not enough
   *  history to say. A whole-site drop is a material loss even when no single page took the blame. */
  scoreboardDeltaPct: number | null;
  /** The single best undone move, or null when the backlog has nothing actionable.
   *  It comes from the SAME release's ready queue as everything else on Today, so the
   *  action Today names is the action the decision kernel actually resolved. */
  topOpportunity: TodayOpportunity | null;
  /** The kernel's own verdict for the declining page when it earned no change
   *  ("...its search click-through is healthy, so I am watching it..."), in one plain
   *  sentence. Absent = quote no verdict and say plainly that I am still checking. */
  declineVerdict?: string | null;
  /** verdictSchedule.firstReadOn (YYYY-MM-DD, UTC): the soonest date the next results land. */
  firstReadOn: string | null;
  /** The canonical count of changes still measuring (countLedgerLifecycle). */
  measuringCount: number;
};

/**
 * The material-loss threshold: a whole-site week-over-week drop this steep is today's biggest
 * problem even without a single blamed page. Deliberately NOT the -2 amber COLOR threshold the
 * scoreboard uses to tint its delta (scoreboard-section.tsx): a small dip changes the color, but
 * only a real drop takes over the command.
 */
export const LOSS_DELTA_PCT = -10;

/** Drop a single trailing period so a directive never reads with two dots. */
function stripPeriod(s: string): string {
  return s.replace(/\.\s*$/, "");
}

/**
 * P2-d (2026-07-10, visual audit) - the command card's own evidence words, mapped from the
 * SAME evidenceStrength field the Changes list's EVIDENCE_LABEL reads (canonical-change.ts),
 * but plainer: "Directional signal." and "Tracking only." read as lab jargon sitting inside
 * the ONE command's evidence bullet, even though EVIDENCE_LABEL is fine on a dense Changes row
 * next to other short chips. This map is used ONLY here, on the command card - EVIDENCE_LABEL
 * itself is unchanged for every other surface.
 */
const COMMAND_EVIDENCE_WORD: Record<EvidenceStrength, string> = {
  strong: "Strong comparison behind it.",
  directional: "Early evidence, worth doing.",
  tracking: "Still building evidence for this one.",
};

/** The command's CTA opens the ranked Changes queue with the recommended move on top.
 *  It used to carry ?focus=<id>, which nothing on /changes has ever read. */
const CHANGES_HREF = "/changes";

function fixDefect(input: TodayCommandInput): TodayCommand {
  if (input.dataTrustBroken === false) {
    return {
      kind: "background_recovery",
      headline: "I am finishing some background work. Your Google numbers are still trustworthy.",
      why: input.pipelineAlarms.slice(0, 4).map((s) => s.trim()).filter(Boolean),
      exactAction: "I am retrying the failed work automatically while you use Beacon. Refresh once in a moment to see the recovered state.",
      cta: null,
    };
  }
  return {
    kind: "fix_defect",
    headline: "Something is broken, so today's numbers are not trustworthy yet.",
    // The exact broken stages, in the pipe's own first-person sentences (up to four).
    why: input.pipelineAlarms.slice(0, 4).map((s) => s.trim()).filter(Boolean),
    exactAction: "Reconnect the source flagged above, then refresh so I can trust the numbers again.",
    cta: { label: "Check your connections", href: "/settings/connectors" },
  };
}

/**
 * ONE honest line about a page that lost clicks and earned NO change. A decline is
 * evidence that something moved; it is not evidence of what to do. Today may MENTION
 * it, and must carry the decision's own verdict when there is one, so a page the
 * kernel resolved to watch is never dressed up as the next action.
 */
function declineNote(input: TodayCommandInput): string | null {
  const a = input.smokeAlarm;
  if (!a) return null;
  const verdict = input.declineVerdict?.trim();
  if (verdict) return verdict;
  const lost = `${a.page} lost ${a.clicksLost.toLocaleString()} click${a.clicksLost === 1 ? "" : "s"} vs ${a.windowLabel}`;
  return `${lost}, and I have not found a change on it my evidence supports yet, so I am watching it rather than sending you to rewrite a page that may be winning.`;
}

function respondToLoss(input: TodayCommandInput): TodayCommand {
  const alarm = input.smokeAlarm;
  const delta = input.scoreboardDeltaPct;
  if (alarm) {
    const why: string[] = [];
    why.push("I already have a fix ready for this page.");
    // Name a DIFFERENT window than the 4-week page number above: the whole-site last-7-vs-
    // prior-7 delta. P2-c (2026-07-10, visual audit) - standardized to "vs the week before"
    // (the SAME phrase the no-single-page branch below uses for this identical delta), so the
    // two never read as two different measurements of the same number.
    if (delta != null && delta <= -3) {
      why.push(`Your whole site is down ${Math.abs(delta)}% vs the week before too.`);
    }
    if (input.measuringCount > 0) {
      why.push(
        `${input.measuringCount} other change${input.measuringCount === 1 ? " is" : "s are"} still measuring.`,
      );
    }
    return {
      kind: "respond_to_loss",
      // The clicksLost delta and its window phrase both come from the ONE smoke
      // alarm (windowLabel), so this headline and the alarm sentence name the same
      // number over the same defined, reproducible window - never "the last 4
      // weeks" with no end date. See today-smoke-alarm.ts for why.
      headline: `Your biggest problem today: ${alarm.page} lost ${alarm.clicksLost.toLocaleString()} click${alarm.clicksLost === 1 ? "" : "s"} vs ${alarm.windowLabel}.`,
      why,
      exactAction: `Open ${alarm.page} and apply the fix.`,
      cta: { label: alarm.actionLabel, href: alarm.href },
    };
  }

  // Whole-site drop with no single blamed page.
  const pct = Math.abs(delta ?? 0);
  const why: string[] = ["No single page took all the blame, so this is a whole-site dip."];
  if (input.measuringCount > 0) {
    why.push(
      `${input.measuringCount} change${input.measuringCount === 1 ? " is" : "s are"} measuring, which may already be turning this around.`,
    );
  }
  return {
    kind: "respond_to_loss",
    // P2-c (2026-07-10, visual audit) - "vs the week before" (not "over the last 7 days"),
    // matching the SAME last-7-vs-prior-7 delta's phrasing above so the two never read as two
    // different measurements.
    headline: `Your search clicks are down ${pct}% vs the week before. That is today's biggest problem.`,
    why,
    exactAction: "Open Changes and ship the top recovery move.",
    cta: { label: "See what to fix", href: "/changes" },
  };
}

function shipMove(input: TodayCommandInput): TodayCommand {
  const o = input.topOpportunity!;
  const why: string[] = [];
  // MODELED OPPORTUNITY, NEVER PROMISED LIFT. This line used to read "about N more
  // clicks a month if this works", which forecast an edit against a generalized
  // click curve that only ever measured a CEILING.
  why.push(
    o.upside != null && Number.isFinite(o.upside) && o.upside > 0
      ? `${o.pageLabel}: this search earns about ${Math.round(o.upside).toLocaleString()} fewer clicks a month than pages at a similar position usually get.`
      : `This one is on ${o.pageLabel}.`,
  );
  why.push(COMMAND_EVIDENCE_WORD[o.evidenceStrength]);
  why.push(`About ${o.estimatedEffortMinutes} minute${o.estimatedEffortMinutes === 1 ? "" : "s"} of work.`);
  const decline = declineNote(input);
  if (decline) why.push(decline);
  return {
    kind: "ship_move",
    headline: `Do this next: ${stripPeriod(o.recommendation)}.`,
    why,
    exactAction: `Open ${o.pageLabel} on Changes to make this change.`,
    cta: { label: "See the change", href: CHANGES_HREF },
  };
}

/**
 * Traffic really moved and I have no change I can stand behind. Say exactly that.
 * No CTA: sending an operator to Changes for a page that has no fix is the walk of
 * shame this product exists to prevent.
 */
function stillChecking(input: TodayCommandInput): TodayCommand {
  const why: string[] = [];
  const decline = declineNote(input);
  if (decline) why.push(decline);
  if (input.measuringCount > 0) why.push("Your active changes are still measuring below.");
  why.push("I will put a change in front of you the moment my evidence supports one.");
  return {
    kind: "observe",
    // Only a BLAMED page earns the plural "traffic gaps": that loss is measured on a
    // named page. A whole-site delta with no page behind it is one moving number, and
    // dressing it as found gaps claimed research that had not happened.
    headline: input.smokeAlarm
      ? "I found meaningful traffic gaps, but I am still checking the results pages and competing pages before asking you to change anything."
      : "Your search traffic moved this week, and I have not found a change I can stand behind yet.",
    why,
    // NOT "give me one more research pass". That asked the operator for something they cannot
    // give, promised nothing back, and hid whether I would ever return to it. This says what is
    // still open, that I carry it forward myself, and what would have to change for a topic I
    // have already closed. No progress bar, and no number I have not measured.
    exactAction: "There is nothing for you to do here today. I carry these searches forward and check them again on your next visit, and where the results never settle on one kind of page I close the topic and reopen it only if that changes.",
    cta: null,
  };
}

function observe(input: TodayCommandInput): TodayCommand {
  const why: string[] = [];
  if (input.measuringCount > 0) {
    // P2-b (2026-07-10, visual audit) - the measuring count + next-read date are the proof
    // strip's job (slot 5, right below this card); this line used to repeat both, so an
    // observe day said "N changes are measuring... next results land around X" twice on the
    // same screen. The command now only points at what is measuring, with no repeated number
    // or date - the strip is the sole owner of both.
    why.push("Your active changes are still measuring below.");
    why.push("I will tell you the moment one of them needs a decision.");
    return {
      kind: "observe",
      headline: "Nothing needs a decision today. Keep measuring.",
      why,
      exactAction: "Check back tomorrow, or peek at what is measuring.",
      cta: { label: "See what's measuring", href: "/results" },
    };
  }
  return {
    kind: "observe",
    headline: "Nothing needs a decision today. Keep measuring.",
    why: [
      "Nothing I am tracking has moved enough to need a decision from you.",
      "Ship a change from Changes and I will start measuring it.",
    ],
    exactAction: "Pick your next move from Changes when you are ready.",
    cta: { label: "Open Changes", href: "/changes" },
  };
}

/**
 * The one command for Today, by strict priority:
 *   1. a broken data pipe            -> fix_defect      (numbers are not trustworthy; fix it first)
 *   2. a loss I CAN FIX               -> respond_to_loss (a bleeding page whose fix is ready, or a
 *                                                        site-wide drop with a ranked move behind it)
 *   3. the top ranked move            -> ship_move       (the single best undone change)
 *   4. a loss I cannot fix yet        -> stillChecking   (say so, and ask for nothing)
 *   5. nothing to decide              -> observe         (keep measuring; here is when results land)
 *
 * A DECLINE IS NOT AN ACTION (2026-07-27). Today used to promote any bleeding page to "your
 * biggest problem today" straight off the click-decay signal, completely independent of what the
 * decision kernel resolved for it: a page the kernel resolved to WATCH (its click-through is
 * healthy) was handed to the operator as the next thing to do, pointed at a Changes queue that
 * held no fix for it. Now a decline can only take over the command when THIS release actually
 * holds a ready fix for that page; otherwise it is mentioned, with its verdict, under a command
 * that is honest about what I can and cannot support.
 */
export function buildTodayCommand(input: TodayCommandInput): TodayCommand {
  if (input.pipelineAlarms.length > 0) return fixDefect(input);
  const fixReady = input.smokeAlarm?.hasReadyFix === true;
  const siteWideDrop = input.scoreboardDeltaPct != null && input.scoreboardDeltaPct <= LOSS_DELTA_PCT;
  if (fixReady) return respondToLoss(input);
  if (siteWideDrop && input.smokeAlarm == null && input.topOpportunity) return respondToLoss(input);
  if (input.topOpportunity) return shipMove(input);
  if (input.smokeAlarm != null || siteWideDrop) return stillChecking(input);
  return observe(input);
}

/**
 * P1-5 (2026-07-10, visual audit) - whether the Today greeting's own streak clause ("you are on
 * a roll") may celebrate for this command kind. The audit's exact live contradiction: the
 * greeting said "16 changes shipped in the last 14 days, you are on a roll." directly above the
 * command's "Your biggest problem today: ... lost 163 clicks." A win-streak celebration must
 * never sit next to a command that says something is broken (fix_defect) or actively losing
 * (respond_to_loss) - the streak COUNT itself still renders either way (it stays true), only the
 * celebratory clause is suppressed. PURE.
 */
export function commandAllowsCelebration(kind: TodayCommandKind): boolean {
  return kind !== "fix_defect" && kind !== "background_recovery" && kind !== "respond_to_loss";
}
