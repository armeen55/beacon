/**
 * Change-level dollar attribution (BEACON_500 item 22, 2026-07-02).
 *
 * Multiplies two things that already exist:
 *   1. The per-change traffic/conversion lift a shipped change earned, control-
 *      adjusted vs comparison pages (src/domains/proof-gsc/traffic-outcome.ts).
 *   2. The operator's own unit economics rate (src/domains/revenue,
 *      BEACON_500 item 3): dollars per 1,000 sessions (rpm) or dollars per
 *      GA4 key event (per_lead).
 *
 * PURE. No I/O. The only inputs are numbers the caller already computed
 * elsewhere (never re-reads GA4, never re-derives the lift).
 *
 * HONESTY CONTRACT:
 *   - No revenue model set -> usdPerMonth is null and the sentence names the
 *     extra visits only, in clicks, never a dollar figure.
 *   - A revenue model IS set -> the sentence always says "your rate x the
 *     extra visitors this change earned", never "measured revenue". These
 *     dollars are an estimate the operator can verify against their own
 *     books, not a payout Beacon observed.
 *   - Negative lift multiplies straight through: a change that LOST traffic
 *     against its comparison pages states a negative dollar number plainly
 *     ("this change is costing you about $40 a month"), never hidden or
 *     floored at zero.
 *   - Deterministic. No dates, no randomness, no network. Same inputs, same
 *     output, every time.
 *   - No em dash or en dash anywhere in generated copy (hyphens only).
 *
 * Pinned by tests/domains/proof-gsc/change-dollar-value.test.ts.
 */

export type ChangeRevenueModel =
  | { kind: "rpm"; rpmUsd: number }
  | { kind: "per_lead"; dollarsPerLead: number };

export type ChangeDollarConfidence = "low" | "medium" | "high";

export type ChangeDollarValue = {
  /** Estimated dollars per month this change is worth, or costing, at the
   *  operator's own rate. Null when no revenue model is set (clicks-only). */
  usdPerMonth: number | null;
  /** One plain sentence, no em/en dashes. Always names the basis: the
   *  operator's rate x the extra visitors/leads this change earned. Never
   *  claims the dollars are measured. */
  basisSentence: string;
  /** How much weight to put on the number: thin traffic deltas (few extra
   *  sessions/events a month) read "low" even when the rate is solid, since a
   *  small count swings the dollar figure a lot on the next re-measure. */
  confidence: ChangeDollarConfidence;
};

const DAYS_PER_MONTH = 30;
const roundCents = (v: number): number => Math.round(v * 100) / 100;
const roundWhole = (v: number): number => Math.round(v);

/** Extra-sessions and extra-key-events thresholds for confidence bands. Kept
 *  low on purpose: a real business decision should not need thousands of
 *  extra visits before the dollar line reads "high confidence". */
const HIGH_SESSIONS_PER_MONTH = 200;
const MEDIUM_SESSIONS_PER_MONTH = 30;
const HIGH_EVENTS_PER_MONTH = 10;
const MEDIUM_EVENTS_PER_MONTH = 2;

function pluralize(n: number, noun: string): string {
  const abs = Math.abs(n);
  return `${noun}${abs === 1 ? "" : "s"}`;
}

function fmtCount(n: number): string {
  return Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function fmtUsd(n: number): string {
  const abs = Math.abs(n);
  const rounded = abs < 10 ? roundCents(abs) : roundWhole(abs);
  return rounded.toLocaleString("en-US", {
    minimumFractionDigits: rounded < 10 && rounded % 1 !== 0 ? 2 : 0,
    maximumFractionDigits: 2,
  });
}

/**
 * Roll a per-window delta (measured over `windowDays`) up to a monthly rate.
 * A change measured over 7 days that earned 14 extra sessions is worth
 * "about 60 extra sessions a month" (14 / 7 * 30), not 14. Deterministic,
 * no floors, negative deltas pass straight through.
 */
export function toMonthlyRate(deltaOverWindow: number, windowDays: number): number {
  if (!Number.isFinite(deltaOverWindow) || !Number.isFinite(windowDays) || windowDays <= 0) return 0;
  return (deltaOverWindow / windowDays) * DAYS_PER_MONTH;
}

/**
 * Derive the CONTROL-ADJUSTED extra sessions a change earned over its
 * measured window, from the same numbers traffic-outcome.ts already
 * computed. This mirrors (does not duplicate) traffic-outcome's own diff-in-
 * diff: `adjustedSessionsPct` is treated-minus-control percent lift, so
 * applying it to the page's own pre-window sessions gives the absolute extra
 * sessions attributable to the change, not natural drift shared by
 * comparison pages.
 *
 * This MUST be used instead of a raw `sessionsPost - sessionsPre` delta: the
 * raw delta can disagree with (even have the opposite sign from) the
 * adjusted percentage whenever every comparable page moved together (e.g.
 * traffic dipped site-wide but this page dipped LESS than its comparison
 * pages, a real relative win). Dollars must track the same number the
 * traffic-outcome label already shows the operator, or the two lines on one
 * card would contradict each other.
 */
export function extraSessionsFromTrafficOutcome(t: {
  ran: boolean;
  treated: { sessionsPre: number };
  adjustedSessionsPct: number | null;
}): number {
  if (!t.ran || t.adjustedSessionsPct == null) return 0;
  return t.adjustedSessionsPct * t.treated.sessionsPre;
}

export function computeChangeDollarValue(args: {
  /** Extra sessions/clicks this change earned over the measured window,
   *  already control-adjusted (e.g. traffic-outcome's own before/after delta
   *  on the treated page, or a GSC clicks delta). Positive = gained, negative
   *  = lost vs comparison pages. */
  trafficDelta: number;
  /** The window (in days) `trafficDelta` was measured over. Used only to
   *  roll the delta up to a monthly rate; pass 30 if the delta is already
   *  monthly. */
  windowDays: number;
  /** Extra GA4 key events (leads/sign-ups/purchases) this change earned over
   *  the same window, control-adjusted. Positive = gained, negative = lost. */
  keyEventDelta: number;
  /** The operator's own unit economics rate (item 3), or undefined/null when
   *  none is configured yet. */
  revenueModel: ChangeRevenueModel | null | undefined;
}): ChangeDollarValue {
  const { trafficDelta, windowDays, keyEventDelta, revenueModel } = args;

  const safeTrafficDelta = Number.isFinite(trafficDelta) ? trafficDelta : 0;
  const safeKeyEventDelta = Number.isFinite(keyEventDelta) ? keyEventDelta : 0;
  const sessionsPerMonth = toMonthlyRate(safeTrafficDelta, windowDays);
  const eventsPerMonth = toMonthlyRate(safeKeyEventDelta, windowDays);

  if (revenueModel == null) {
    return {
      usdPerMonth: null,
      basisSentence: clicksOnlySentence(sessionsPerMonth),
      confidence: sessionsConfidence(sessionsPerMonth),
    };
  }

  if (revenueModel.kind === "rpm") {
    const rpm = Number.isFinite(revenueModel.rpmUsd) ? revenueModel.rpmUsd : 0;
    if (rpm <= 0) {
      return {
        usdPerMonth: null,
        basisSentence: clicksOnlySentence(sessionsPerMonth),
        confidence: sessionsConfidence(sessionsPerMonth),
      };
    }
    const usdPerMonth = roundCents((sessionsPerMonth / 1000) * rpm);
    return {
      usdPerMonth,
      basisSentence: rpmSentence(usdPerMonth, sessionsPerMonth, rpm),
      confidence: sessionsConfidence(sessionsPerMonth),
    };
  }

  // per_lead
  const dollarsPerLead = Number.isFinite(revenueModel.dollarsPerLead)
    ? revenueModel.dollarsPerLead
    : 0;
  if (dollarsPerLead <= 0) {
    return {
      usdPerMonth: null,
      basisSentence: clicksOnlySentence(sessionsPerMonth),
      confidence: sessionsConfidence(sessionsPerMonth),
    };
  }
  const usdPerMonth = roundCents(eventsPerMonth * dollarsPerLead);
  return {
    usdPerMonth,
    basisSentence: perLeadSentence(usdPerMonth, eventsPerMonth, dollarsPerLead),
    confidence: eventsConfidence(eventsPerMonth),
  };
}

function clicksOnlySentence(sessionsPerMonth: number): string {
  const rounded = roundWhole(sessionsPerMonth);
  if (rounded === 0) {
    return "This change is not moving visits enough yet to size in dollars. Set your rate per visitor or lead in settings once it does.";
  }
  const verb = rounded > 0 ? "earning you" : "costing you";
  return `This change is ${verb} about ${fmtCount(rounded)} extra ${pluralize(rounded, "visit")} a month. Set your rate per visitor or lead in settings to see this in dollars.`;
}

function rpmSentence(usdPerMonth: number, sessionsPerMonth: number, rpmUsd: number): string {
  const roundedSessions = roundWhole(sessionsPerMonth);
  const verb = usdPerMonth >= 0 ? "worth about" : "costing you about";
  if (roundedSessions === 0) {
    return `This change is not moving visits enough yet to be worth much either way, at your rate of $${fmtUsd(rpmUsd)} per 1,000 visits.`;
  }
  return `This change is ${verb} $${fmtUsd(usdPerMonth)} a month, your rate of $${fmtUsd(rpmUsd)} per 1,000 visits times the ${fmtCount(roundedSessions)} extra ${pluralize(roundedSessions, "visit")} it earned.`;
}

function perLeadSentence(usdPerMonth: number, eventsPerMonth: number, dollarsPerLead: number): string {
  const roundedEvents = roundWhole(eventsPerMonth);
  const verb = usdPerMonth >= 0 ? "worth about" : "costing you about";
  if (roundedEvents === 0) {
    return `This change is not moving leads enough yet to be worth much either way, at your rate of $${fmtUsd(dollarsPerLead)} per lead.`;
  }
  return `This change is ${verb} $${fmtUsd(usdPerMonth)} a month, your rate of $${fmtUsd(dollarsPerLead)} per lead times the ${fmtCount(roundedEvents)} extra ${pluralize(roundedEvents, "lead")} it earned.`;
}

function sessionsConfidence(sessionsPerMonth: number): ChangeDollarConfidence {
  const abs = Math.abs(sessionsPerMonth);
  if (abs >= HIGH_SESSIONS_PER_MONTH) return "high";
  if (abs >= MEDIUM_SESSIONS_PER_MONTH) return "medium";
  return "low";
}

function eventsConfidence(eventsPerMonth: number): ChangeDollarConfidence {
  const abs = Math.abs(eventsPerMonth);
  if (abs >= HIGH_EVENTS_PER_MONTH) return "high";
  if (abs >= MEDIUM_EVENTS_PER_MONTH) return "medium";
  return "low";
}

/**
 * Presentation gate shared by the Wins band row (proof/page.tsx): the dollar
 * line only ever shows on a MATURE WIN with a positive dollar value. A
 * measuring/in-flight row, a learning (non-win) row, or a win with no usable
 * revenue model never renders a dollar figure. Pulled out as a pure predicate
 * (rather than left inline in JSX) so this gate is unit-testable without a
 * full component render.
 */
export function shouldShowChangeDollarLine(args: {
  band: "win" | "learning" | "inflight" | undefined;
  dollarValue: Pick<ChangeDollarValue, "usdPerMonth"> | null | undefined;
}): boolean {
  return (
    args.band === "win" &&
    args.dollarValue != null &&
    args.dollarValue.usdPerMonth != null &&
    args.dollarValue.usdPerMonth > 0
  );
}
