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
  /** The single best undone move, or null when the backlog has nothing actionable. */
  topOpportunity: TodayOpportunity | null;
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

/** The deep link to one change's detail on Changes (the SAME encoding the Changes list reads
 *  from ?focus). Kept here so the command's CTA and any render pin agree byte for byte. */
export function changeFocusHref(changeId: string): string {
  return `/changes?focus=${encodeURIComponent(changeId)}`;
}

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

function respondToLoss(input: TodayCommandInput): TodayCommand {
  const alarm = input.smokeAlarm;
  const delta = input.scoreboardDeltaPct;
  if (alarm) {
    const fixReady = alarm.actionLabel === "See the fix";
    const why: string[] = [];
    why.push(
      fixReady
        ? "I already have a fix ready for this page."
        : "This one is worth a look before it slides further.",
    );
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
      exactAction: fixReady
        ? `Open ${alarm.page} and apply the fix.`
        : `Open ${alarm.page} and see what changed.`,
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
  if (o.upside != null && Number.isFinite(o.upside) && o.upside > 0) {
    why.push(`${o.pageLabel}: about ${Math.round(o.upside).toLocaleString()} more clicks a month if this works.`);
  } else {
    why.push(`This one is on ${o.pageLabel}.`);
  }
  why.push(COMMAND_EVIDENCE_WORD[o.evidenceStrength]);
  why.push(`About ${o.estimatedEffortMinutes} minute${o.estimatedEffortMinutes === 1 ? "" : "s"} of work.`);
  return {
    kind: "ship_move",
    headline: `Do this next: ${stripPeriod(o.recommendation)}.`,
    why,
    exactAction: `Open ${o.pageLabel} on Changes to make this change.`,
    cta: { label: "See the change", href: changeFocusHref(o.changeId) },
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
      "Everything I am tracking is quiet, and nothing needs a decision.",
      "Ship a change from Changes and I will start measuring it.",
    ],
    exactAction: "Pick your next move from Changes when you are ready.",
    cta: { label: "Open Changes", href: "/changes" },
  };
}

/**
 * The one command for Today, by strict priority:
 *   1. a broken data pipe    -> fix_defect      (numbers are not trustworthy; fix it first)
 *   2. a material loss        -> respond_to_loss (a page bleeding clicks, or a >=10% site drop)
 *   3. the top ranked move    -> ship_move       (the single best undone change)
 *   4. nothing to decide      -> observe         (keep measuring; here is when results land)
 *
 * A defect always beats a larger loss (a loss read off a broken pipe is not trustworthy). A page
 * smoke alarm OR a whole-site drop of at least LOSS_DELTA_PCT counts as a material loss. ship_move
 * fires only when a real opportunity exists; otherwise observe.
 */
export function buildTodayCommand(input: TodayCommandInput): TodayCommand {
  if (input.pipelineAlarms.length > 0) return fixDefect(input);
  const materialLoss =
    input.smokeAlarm != null ||
    (input.scoreboardDeltaPct != null && input.scoreboardDeltaPct <= LOSS_DELTA_PCT);
  if (materialLoss) return respondToLoss(input);
  if (input.topOpportunity) return shipMove(input);
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
