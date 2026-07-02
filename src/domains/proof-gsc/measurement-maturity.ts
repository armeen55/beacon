/**
 * measurement-maturity (2026-06-30, Move 2) — THE single, pure source of measurement
 * TRUTH for the whole product. Separates three concepts a proof record conflates:
 *
 *   MATURITY  — how far the measurement has progressed (collecting → early → interim
 *               → mature), independent of which way it moved.
 *   DIRECTION — which way the basis window moved (positive / negative / neutral).
 *   VERDICT   — the FINAL operator-facing call. Exists ONLY at mature_result.
 *
 * Why this module exists: the stored `verdict`/`confidence` on a ShippedChangeRecord
 * are computed from "the longest window that has run", so a record whose ONLY closed
 * window is the 7-day one can be persisted as verdict="lost", confidence="high"
 * (measure.ts:summarizeVerdict). That is an EARLY signal, not a final loss. Every
 * surface (Results, Changes, MoveCard, learning, aggregates) must reinterpret the
 * stored fields through THIS resolver so a 7-day read can never masquerade as a final
 * verdict, never earn mature high confidence, and never permanently train ranking.
 *
 * PURE — no I/O. Reads the record's `windows` (the ground truth for which checkpoint
 * actually closed) + the finalized GSC watermark. Pinned by measurement-maturity.test.ts.
 */

import { addDays, proofCheckDates, PROOF_WINDOW_DAYS, type ProofWindowDay } from "./measure";
import { overlappingShock, weatherCaveatSentence, type ShockWindow } from "./algorithm-weather";
import { recrawlBlindSentence } from "./recrawl-clock";

export type MeasurementMaturity =
  | "scheduled" // not yet live / activated — no measurement language at all
  | "collecting" // live; first checkpoint not open OR required GSC data not in yet
  | "early_checkpoint" // 7-day window closed — directional only, never final
  | "interim_checkpoint" // 14-day window closed — stronger, still not final
  | "mature_result" // 28-day window closed + sufficient data — final verdict eligible
  | "inconclusive" // mature window closed but evidence insufficient/within noise
  | "blocked_data" // checkpoint date passed but the GSC/GA4 data it needs isn't in
  | "attribution_limited"; // a measurement exists but an overlapping edit weakens it

export type MeasurementDirection = "positive" | "negative" | "neutral" | "unknown";
export type AttributionQuality = "clean" | "limited" | "compound";
export type PresentationConfidence = "high" | "medium" | "low";
export type EvidenceStrength = "strong" | "directional" | "tracking";

/** A change that overlaps this measurement window on the same page. */
export type OverlapContext = {
  /** "compound" = intentionally shipped together (one package); "overlap" = a second
   *  edit landed while this one was still measuring (accidental → weakens attribution). */
  kind: "compound" | "overlap";
  otherChangeCount: number;
};

/** Everything the resolver needs — all derivable from a ShippedChangeRecord + the
 *  finalized GSC watermark, with NO extra I/O. */
export type MaturityInput = {
  /** Ship date (ISO or YYYY-MM-DD). null/empty ⇒ not shipped ⇒ scheduled. */
  shippedAt: string | null;
  now: Date;
  /** Latest finalized GSC date (the watermark) — null when no GSC data at all. */
  latestGscDate: string | null;
  /** The record's proof windows (day + whether that window has closed/ran). */
  windows: ReadonlyArray<{ day: number; ran: boolean }>;
  /** The stored GSC verdict (won/lost/inconclusive/measuring/insufficient_data). */
  verdict: string;
  /** Usable controls on the basis window (diff-in-diff comparators). */
  controlsUsed: number;
  /** Treated page baseline impressions (sufficiency gate). */
  baselineImpressions: number;
  /** Overlap/compound context, when another edit touches the same page+window. */
  overlap?: OverlapContext | null;
  /** Whether the change is live/activated. Defaults to true (proof rows are live). */
  live?: boolean;
  /** Algorithm-weather guard (master plan item 32): confirmed Google update
   *  ranges + detected sitewide shocks, so a measurement window that overlapped
   *  one gets a visible caveat and is excluded from learning. Additive - a
   *  caller that never passes this (or passes []) sees byte-identical output
   *  to before this field existed. Computed at READ time; never mutates the
   *  stored verdict. */
  shockWindows?: ReadonlyArray<ShockWindow>;
  /** Parallel-trends veto (master plan item 33): true when this record's
   *  comparison pages were NOT moving like the treated page before the ship
   *  (a baseline-scale mismatch or a diverging pre-ship trend slope, per
   *  control-matching.ts). Additive - a caller that never passes this (the
   *  default) sees byte-identical output to before this field existed.
   *  Computed at READ time from the SAME matcher numbers the ledger row's
   *  controlMatchNotes explains; never mutates the stored verdict. */
  weakComparison?: boolean;
  /** Seasonality guard (master plan item 69): true when this measurement
   *  window overlaps a detected demand inflection for the page's family
   *  (src/domains/seasonal/seasonal-inflection.ts). Additive - a caller that
   *  never passes this (the default) sees byte-identical output to before
   *  this field existed. Computed at READ time from the tenant's own family
   *  demand profile; never mutates the stored verdict. */
  seasonalInflection?: boolean;
  /** Plain first-person caveat sentence for the seasonal-inflection guard,
   *  when it fired (null otherwise). Passed through so the read site doesn't
   *  need to re-derive the sentence itself. */
  seasonalInflectionCaveat?: string | null;
  /** Recrawl-gated SEARCH clock (master plan item N11, operator-corrected
   *  scope): true when Google's index has NOT yet been observed holding this
   *  page's new content (recrawl-clock.ts's computeRecrawlClock returned
   *  basis "none"). Gates ONLY the Google-search verdict lane this
   *  presentation describes (GSC ranking / impressions / clicks / CTR) - the
   *  computed traffic/behavior attachments on the record (trafficOutcome,
   *  citationOutcome, dollarValue, etc.) keep their live_at clock and keep
   *  rendering on the card. Additive - a caller that never passes this (the
   *  default) sees byte-identical output to before this field existed.
   *  Computed at READ time from gsc_url_inspections (an INDEXED-version
   *  crawl timestamp, never a live-page fetch); NEVER mutates
   *  windows/verdict/shippedAt. When true, the SEARCH presentation is capped
   *  at a waiting state regardless of which calendar window has closed - a
   *  search verdict must never be read as final before Google's index has
   *  actually seen the change. */
  recrawlPending?: boolean;
  /** How many days the change has gone without a confirmed recrawl (from
   *  recrawl-clock.ts's daysBlind). Feeds the honest secondary sentence;
   *  null/undefined renders the day-agnostic fallback line. */
  recrawlDaysBlind?: number | null;
  /** ISO timestamp Google's index first showed a crawl AFTER the ship
   *  (recrawl-clock.ts's recrawlConfirmedAt). When set, the SEARCH checkpoint
   *  clock counts from here instead of shippedAt: a stored window that closed
   *  on the ship-based calendar reads as a checkpoint only once the same
   *  number of days have ALSO passed since this date (downgrade-only - this
   *  can never upgrade a window that has not stored-closed, and never changes
   *  the stored windows/lift math). GA4/Clarity/conversion attachments are
   *  NOT affected - their clock stays live_at. Additive - absent/null means
   *  the ship-based clock, byte-identical output to before this field
   *  existed. */
  recrawlConfirmedAt?: string | null;
  /** Control-contamination guard (master plan N13): true when at least one of
   *  this ship's comparison pages changed mid-window (treated by us, or its
   *  own content edited) per control-contamination.ts's classifier. Additive -
   *  a caller that never passes this (the default) sees byte-identical output
   *  to before this field existed. Computed at READ time from the full ledger
   *  + snapshot history; NEVER mutates the stored controlPages/verdict. */
  controlContaminated?: boolean;
  /** Plain first-person caveat sentence for the contamination guard, when it
   *  fired (null otherwise). Passed through so the read site doesn't need to
   *  re-derive the sentence itself - either the swap receipt ("I swapped it
   *  for a clean one") or the caution line when no substitute existed. */
  controlContaminationCaveat?: string | null;
};

/** Minimum sufficiency for a MATURE verdict (mirrors measure.ts thresholds). */
const MIN_CONTROLS_FOR_MATURE = 2;
const MIN_BASELINE_FOR_MATURE = 200;

const dayStr = (now: Date): string => now.toISOString().slice(0, 10);

/** The latest proof window day that has actually CLOSED (28 > 14 > 7), or null. */
export function basisDayOf(windows: ReadonlyArray<{ day: number; ran: boolean }>): ProofWindowDay | null {
  const ran = windows.filter((w) => w.ran).map((w) => w.day).sort((a, b) => b - a);
  const top = ran[0];
  return top === 7 || top === 14 || top === 28 ? (top as ProofWindowDay) : null;
}

/**
 * The basis window day the SEARCH clock may actually read from (master plan
 * N11): the stored closed window (basisDayOf), additionally capped by the
 * recrawl-confirmed clock when one exists - a 7-day search read only counts
 * once 7 days have ALSO passed since Google's index first showed the new
 * content, not just since the ship. Downgrade-only: this can never mark a
 * window closed that did not stored-close, and with no recrawlConfirmedAt it
 * returns basisDayOf unchanged (byte-identical legacy behavior). Calendar
 * check only - the stored `ran` flag already encoded GSC data availability
 * for the ship-based window, and the stored lift numbers themselves are
 * ship-based either way; this cap is the read-time honesty layer over how
 * much post-index-crawl exposure the read actually had. PURE.
 */
export function effectiveSearchBasisDay(
  input: Pick<MaturityInput, "windows" | "recrawlConfirmedAt" | "now">,
): ProofWindowDay | null {
  const stored = basisDayOf(input.windows);
  if (stored == null) return null;
  const confirmed = input.recrawlConfirmedAt ? input.recrawlConfirmedAt.slice(0, 10) : null;
  if (!confirmed || !/^\d{4}-\d{2}-\d{2}$/.test(confirmed)) return stored;
  const today = dayStr(input.now);
  for (const d of [28, 14, 7] as ProofWindowDay[]) {
    if (d > stored) continue;
    if (!input.windows.some((w) => w.day === d && w.ran)) continue;
    if (today >= addDays(confirmed, d)) return d;
  }
  return null;
}

/** Which way the basis window moved (independent of maturity). PURE. */
export function directionOf(verdict: string): MeasurementDirection {
  if (verdict === "won") return "positive";
  if (verdict === "lost") return "negative";
  if (verdict === "inconclusive" || verdict === "insufficient_data") return "neutral";
  return "unknown"; // measuring / unknown
}

function attributionQualityOf(overlap?: OverlapContext | null): AttributionQuality {
  if (!overlap) return "clean";
  return overlap.kind === "compound" ? "compound" : "limited";
}

/**
 * The single maturity resolver. PURE. Reads which window actually CLOSED (not the
 * stored verdict) plus the GSC watermark, so an early read is always recognized as
 * early. Precedence is "dominant caveat first": scheduled → recrawl-pending →
 * accidental-overlap → blocked-data → by basis window (28/14/7) → collecting.
 */
export function deriveMeasurementMaturity(input: MaturityInput): MeasurementMaturity {
  if (!input.shippedAt || input.live === false) return "scheduled";

  // Recrawl-gated SEARCH clock (master plan N11): no calendar window, however
  // long closed, outranks the fact that Google's index has not yet picked up
  // the new content. A SEARCH verdict computed against the OLD indexed page
  // is not a verdict at all - cap at "collecting" (renders as the honest
  // "Waiting" badge) until recrawl-clock.ts confirms the index saw the
  // change. Dominates even a mature/inconclusive basis window, but never
  // overrides "scheduled" above (nothing shipped yet has nothing to recrawl).
  // SCOPE: this caps ONLY this search-lane presentation - the record's
  // computed traffic/behavior attachments (trafficOutcome etc.) keep their
  // live_at clock and keep rendering on the card, untouched by this module.
  if (input.recrawlPending === true) return "collecting";

  // Once confirmed, the SEARCH clock counts from recrawlConfirmedAt, not
  // shippedAt: a stored window only reads as a checkpoint after the same
  // number of days have also passed since Google's index picked up the
  // change (effectiveSearchBasisDay; downgrade-only, legacy-identical when
  // no confirmation is known).
  const basis = effectiveSearchBasisDay(input);

  // Accidental overlap weakens attribution for ANY readable/active measurement — it
  // dominates the headline (a package shipped on purpose is "compound", not limited).
  if (input.overlap?.kind === "overlap" && input.overlap.otherChangeCount > 0) {
    return "attribution_limited";
  }

  if (basis === 28) {
    const sufficient =
      input.controlsUsed >= MIN_CONTROLS_FOR_MATURE &&
      input.baselineImpressions >= MIN_BASELINE_FOR_MATURE &&
      (input.verdict === "won" || input.verdict === "lost");
    return sufficient ? "mature_result" : "inconclusive";
  }
  if (basis === 14) return "interim_checkpoint";
  if (basis === 7) return "early_checkpoint";

  // No window has closed yet. Distinguish "still waiting on the calendar" (collecting)
  // from "the date passed but Google's data hasn't arrived" (blocked_data).
  const nextDay = PROOF_WINDOW_DAYS.find((d) => !input.windows.some((w) => w.day === d && w.ran)) ?? null;
  if (nextDay != null) {
    const checkOn = proofCheckDates(input.shippedAt)[nextDay as ProofWindowDay];
    const requiredGscDate = addDays(checkOn, -1);
    const calendarClosed = dayStr(input.now) >= checkOn;
    const gscAvailable = input.latestGscDate != null && input.latestGscDate >= requiredGscDate;
    if (calendarClosed && !gscAvailable) return "blocked_data";
  }
  return "collecting";
}

// ── Presentation: the view-model every surface renders from ──

export type MeasurementPresentation = {
  maturity: MeasurementMaturity;
  direction: MeasurementDirection;
  /** The FINAL verdict — non-null ONLY at mature_result. */
  verdict: "helped" | "no_lift" | "did_not_help" | null;
  confidence: PresentationConfidence;
  /** Short operator-facing headline (the only line a compact row needs). */
  headline: string;
  /** One honest follow-on sentence (next checkpoint / waiting-for-data / overlap). */
  explanation: string;
  /** Soonest future checkpoint date (YYYY-MM-DD), or null. */
  nextCheckpoint: string | null;
  /** The GSC date the next/last window needs, and what Google currently has. */
  requiredDataThrough: string | null;
  availableDataThrough: string | null;
  evidenceStrength: EvidenceStrength;
  attributionQuality: AttributionQuality;
  /** True ONLY when a mature, cleanly-attributed result may train ranking. */
  learningEligibility: boolean;
  /** The window day this reads from (7/14/28), or null when nothing has closed. */
  basisDay: ProofWindowDay | null;
  /** Semantic tone for UI color — never red/green before maturity. */
  tone: "positive" | "negative" | "neutral" | "progress" | "waiting";
  /** Algorithm-weather guard (master plan item 32): non-null when this
   *  measurement window overlapped a confirmed Google update or a detected
   *  sitewide shock. Renders as a visible caveat line on the Results row and
   *  additively demotes learningEligibility to false, the same way an
   *  accidental overlap already weakens attributionQuality above. */
  weatherCaveat: string | null;
  /** True when a shock overlap was found - separate from the sentence so a
   *  reader that only needs the exclusion decision (the prior/lesson gate)
   *  doesn't have to string-match weatherCaveat. */
  weatherQuarantined: boolean;
  /** Parallel-trends veto (master plan item 33): non-null when this record's
   *  comparison pages were not moving like the treated page before the ship
   *  (mismatched baseline scale or a diverging pre-ship trend). Renders as a
   *  visible caveat on the Results row and, like weatherCaveat, additively
   *  demotes learningEligibility to false. */
  weakComparisonCaveat: string | null;
  /** True when the weak-comparison veto fired - separate from the sentence so
   *  a reader that only needs the exclusion decision doesn't have to
   *  string-match weakComparisonCaveat. */
  weakComparisonFlagged: boolean;
  /** Seasonality guard (master plan item 69): non-null when this measurement
   *  window overlapped a detected demand inflection for the page's family.
   *  Renders as a visible caveat on the Results row and, like weatherCaveat
   *  and weakComparisonCaveat, additively demotes learningEligibility to
   *  false - a page shipped into (or measured across) its own family's demand
   *  swing should never quietly train the ranking prior as a clean win/loss. */
  seasonalInflectionCaveat: string | null;
  /** True when the seasonal-inflection guard fired - separate from the
   *  sentence so a reader that only needs the exclusion decision doesn't have
   *  to string-match seasonalInflectionCaveat. */
  seasonalInflectionFlagged: boolean;
  /** Recrawl-gated SEARCH clock (master plan N11): true when Google's index
   *  has not yet been observed holding this page's new content. While true,
   *  the SEARCH maturity is capped at "collecting" (the "Waiting" badge)
   *  regardless of which calendar window has closed, direction reads
   *  "unknown" (no stale-index lean may leak), and learningEligibility is
   *  additively false - exposed here so the N10 verdict-reliability
   *  composite can read it without re-deriving the clock itself. Gates ONLY
   *  this search-lane presentation: the record's computed traffic/behavior
   *  attachments (trafficOutcome etc.) keep their live_at clock and keep
   *  rendering on the card. */
  recrawlPending: boolean;
  /** Honest secondary sentence for a recrawl-pending row: "Google has not
   *  re-read this page yet, so the search clock has not started. Visit
   *  tracking started the day the change went live." Null when the recrawl
   *  is confirmed (or the caller never passed recrawl input at all - same
   *  additive posture as the other caveats above). */
  recrawlPendingCaveat: string | null;
  /** Control-contamination guard (master plan N13): true when at least one
   *  comparison page changed mid-window. Renders as a visible caveat on the
   *  Results row and, like the other guards above, additively demotes
   *  learningEligibility to false - exposed here so the N10 verdict-
   *  reliability composite can read it without re-deriving the classifier. */
  controlContaminationFlagged: boolean;
  /** Honest caveat sentence for the contamination guard, when it fired: the
   *  swap receipt when a clean substitute was found and used, or the caution
   *  line when none was available. Null when no control was contaminated. */
  controlContaminationCaveat: string | null;
};

/** Plain first-person caveat sentence for a Results row whose comparison pages
 *  were not moving like the treated page before the ship. No dashes. PURE. */
export function weakComparisonSentence(): string {
  return "The comparison pages were not moving like this page before the change, so I am reading this result cautiously.";
}

/**
 * The measurement window a proof record's BASIS checkpoint actually covers:
 * ship date -> the basis day's check-on date (falling back to the soonest
 * future checkpoint when nothing has closed yet, so an in-flight window still
 * gets checked against ongoing algorithm weather). PURE. Exported so read
 * sites (Results page, load-experiment-outcomes.ts) compute the SAME window
 * the presentation itself judges, instead of re-deriving their own dates.
 */
export function measurementWindowOf(
  shippedAt: string | null,
  windows: ReadonlyArray<{ day: number; ran: boolean }>,
): { start: string; end: string } | null {
  if (!shippedAt) return null;
  const basis = basisDayOf(windows);
  const checks = proofCheckDates(shippedAt);
  const day = basis ?? (PROOF_WINDOW_DAYS.find((d) => !windows.some((w) => w.day === d && w.ran)) ?? 28);
  return { start: shippedAt.slice(0, 10), end: checks[day as ProofWindowDay] };
}

function maturityConfidence(
  maturity: MeasurementMaturity,
  controlsUsed: number,
  baselineImpressions: number,
): PresentationConfidence {
  if (maturity !== "mature_result") {
    return maturity === "interim_checkpoint" ? "medium" : "low";
  }
  // Mature: high requires strong sufficiency; never from control count alone at 7d
  // (that path can't reach here — maturity gates it).
  if (controlsUsed >= 3 && baselineImpressions >= 3000) return "high";
  if (controlsUsed >= 2 && baselineImpressions >= 800) return "medium";
  return "low";
}

function evidenceStrengthOf(maturity: MeasurementMaturity, attribution: AttributionQuality): EvidenceStrength {
  if (maturity === "mature_result" && attribution === "clean") return "strong";
  if (maturity === "scheduled" || maturity === "collecting" || maturity === "blocked_data") return "tracking";
  return "directional"; // early / interim / inconclusive / attribution_limited
}

/** Build the full presentation for a record. PURE — the one place language is decided. */
export function buildMeasurementPresentation(input: MaturityInput): MeasurementPresentation {
  const maturity = deriveMeasurementMaturity(input);
  // Recrawl-gated SEARCH clock (N11): before Google's index has the new
  // content, the stored verdict was measured against the OLD page, so no
  // search direction may leak onto the card ("This is probably hurting."
  // off stale-index data would be an ungated search read). Direction reads
  // "unknown" -> the primary Search line renders "Not clear yet." The
  // traffic/behavior attachments on the record are untouched - their live_at
  // clock keeps running and the card keeps rendering them.
  const direction: MeasurementDirection =
    input.recrawlPending === true ? "unknown" : directionOf(input.verdict);
  const attributionQuality = attributionQualityOf(input.overlap);
  // Once recrawl is confirmed, the SEARCH checkpoints count from
  // recrawlConfirmedAt, not shippedAt (downgrade-only; identical to legacy
  // when no confirmation is known). While pending there is no search basis
  // at all - the clock has not started.
  const basisDay = input.recrawlPending === true ? null : effectiveSearchBasisDay(input);
  const searchClockStart =
    input.recrawlConfirmedAt &&
    /^\d{4}-\d{2}-\d{2}/.test(input.recrawlConfirmedAt) &&
    input.shippedAt &&
    input.recrawlConfirmedAt.slice(0, 10) >= input.shippedAt.slice(0, 10)
      ? input.recrawlConfirmedAt.slice(0, 10)
      : null;
  const checks = input.shippedAt ? proofCheckDates(searchClockStart ?? input.shippedAt) : null;

  // A window is EFFECTIVELY closed for the search clock only when it stored-
  // closed AND (when the clock is shifted) the same day count has passed
  // since the confirmed index crawl. With no shift this is exactly the
  // stored `ran` flag - legacy-identical.
  const effectivelyClosed = (d: ProofWindowDay): boolean => {
    if (!input.windows.some((w) => w.day === d && w.ran)) return false;
    if (!searchClockStart) return true;
    return dayStr(input.now) >= addDays(searchClockStart, d);
  };
  const nextDay = input.shippedAt
    ? (PROOF_WINDOW_DAYS.find((d) => !effectivelyClosed(d)) ?? null)
    : null;
  // While recrawl is pending there IS no known next search checkpoint - the
  // clock has not started, so a ship-based "matures YYYY-MM-DD" date would be
  // the exact false countdown the caveat sentence refutes. Null flows through
  // proofBadgeMaturesOn so the badge's secondary text stays silent.
  const nextCheckpoint =
    input.recrawlPending === true
      ? null
      : nextDay != null && checks
        ? checks[nextDay as ProofWindowDay]
        : null;
  const finalCheckpoint = checks ? checks[28] : null;
  const requiredDataThrough =
    maturity === "blocked_data" && nextCheckpoint ? addDays(nextCheckpoint, -1) : null;

  const confidence = maturityConfidence(maturity, input.controlsUsed, input.baselineImpressions);
  const evidenceStrength = evidenceStrengthOf(maturity, attributionQuality);

  // Algorithm-weather guard (item 32): a shock overlapping this window is
  // additive - it never changes the maturity/verdict/tone computed above, it
  // only adds a caveat and, like an accidental overlap, revokes learning
  // eligibility. A record with no shockWindows (the default) behaves exactly
  // as before this field existed.
  const measurementWindow = measurementWindowOf(input.shippedAt, input.windows);
  const shockHit =
    measurementWindow && input.shockWindows && input.shockWindows.length > 0
      ? overlappingShock(measurementWindow.start, measurementWindow.end, input.shockWindows)
      : null;
  const weatherCaveat = shockHit ? weatherCaveatSentence(shockHit) : null;
  const weatherQuarantined = shockHit != null;

  // Parallel-trends veto (item 33): additive, same posture as the weather
  // guard above - a record whose comparison pages diverged from the treated
  // page's pre-ship trend/scale reads cautiously even though its window
  // otherwise closed cleanly. A caller that never passes weakComparison sees
  // byte-identical output to before this field existed.
  const weakComparisonFlagged = input.weakComparison === true;
  const weakComparisonCaveat = weakComparisonFlagged ? weakComparisonSentence() : null;

  // Seasonality guard (item 69): additive, same posture as the weather guard
  // and the parallel-trends veto above - a caller that never passes
  // seasonalInflection sees byte-identical output to before this field
  // existed.
  const seasonalInflectionFlagged = input.seasonalInflection === true;
  const seasonalInflectionCaveat = seasonalInflectionFlagged
    ? (input.seasonalInflectionCaveat ?? "This page's family has a recurring demand swing that overlaps this measurement window, so I am reading this result cautiously.")
    : null;

  // Recrawl-gated SEARCH clock (master plan N11): additive, same posture as
  // the guards above, but scoped to the search lane only - the traffic and
  // behavior attachments computed on the record are never gated here.
  // deriveMeasurementMaturity() already forced maturity to "collecting" when
  // this fired, so learningEligibility below is already false via the
  // mature_result check - listed explicitly anyway so the exclusion reason
  // is legible at this call site, matching every sibling guard's style.
  const recrawlPending = input.recrawlPending === true;
  const recrawlPendingCaveat = recrawlPending
    ? recrawlBlindSentence(input.recrawlDaysBlind ?? null)
    : null;

  // Control-contamination guard (master plan N13): additive, same posture as
  // the guards above - a caller that never passes controlContaminated sees
  // byte-identical output to before this field existed. The caveat sentence
  // itself (swap receipt vs caution line) is computed by
  // control-contamination.ts's buildContaminationNotes and passed straight
  // through, same as seasonalInflectionCaveat above.
  const controlContaminationFlagged = input.controlContaminated === true;
  const controlContaminationCaveat = controlContaminationFlagged
    ? (input.controlContaminationCaveat ?? "A comparison page changed during measurement, so I am reading this result with caution.")
    : null;

  const learningEligibility =
    maturity === "mature_result" &&
    attributionQuality === "clean" &&
    !weatherQuarantined &&
    !weakComparisonFlagged &&
    !seasonalInflectionFlagged &&
    !recrawlPending &&
    !controlContaminationFlagged;

  const verdict: MeasurementPresentation["verdict"] =
    maturity === "mature_result"
      ? direction === "positive" ? "helped" : direction === "negative" ? "did_not_help" : "no_lift"
      : null;

  let headline = "";
  let explanation = "";
  let tone: MeasurementPresentation["tone"] = "neutral";

  switch (maturity) {
    case "scheduled":
      headline = "Not shipped yet";
      explanation = "Measurement starts once this change is live.";
      tone = "neutral";
      break;
    case "collecting":
      if (recrawlPending) {
        // Recrawl-gated SEARCH clock (master plan N11): the calendar may have
        // moved, but nothing here is a real SEARCH checkpoint until Google's
        // index picks up the page - say so plainly instead of a
        // "collecting"/"first checkpoint opens X" line that implies a normal
        // countdown is already running. The sentence also names the split:
        // visit tracking (GA4/Clarity) started at live_at and keeps reading.
        headline = "Waiting";
        explanation = recrawlPendingCaveat ?? recrawlBlindSentence(null);
        tone = "waiting";
      } else {
        headline = "Collecting data";
        explanation = nextCheckpoint
          ? `First checkpoint opens ${nextCheckpoint}.${input.latestGscDate ? ` Google data currently available through ${input.latestGscDate}.` : ""}`
          : "Gathering the first Search Console window.";
        // Confirmed-shift honesty (N11): when the search clock counts from
        // the confirmed index crawl, the checkpoint date above is already
        // shifted - name why so a later-than-expected date never reads as a
        // stall.
        if (searchClockStart && searchClockStart > (input.shippedAt ?? "").slice(0, 10)) {
          explanation += " The search clock counts from when Google re-read this page.";
        }
        tone = "progress";
      }
      break;
    case "early_checkpoint":
      headline = direction === "positive" ? "Early positive signal" : direction === "negative" ? "Early negative signal" : "Too early to call";
      explanation = `7-day signal, directional only.${finalCheckpoint ? ` Final checkpoint opens ${finalCheckpoint}.` : ""}`;
      tone = direction === "positive" ? "progress" : direction === "negative" ? "progress" : "neutral";
      break;
    case "interim_checkpoint":
      headline = direction === "positive" ? "Interim positive signal" : direction === "negative" ? "Interim negative signal" : "Still inconclusive";
      explanation = `Evidence strengthening at 14 days.${finalCheckpoint ? ` Final checkpoint opens ${finalCheckpoint}.` : ""}`;
      tone = "progress";
      break;
    case "mature_result":
      if (verdict === "helped") { headline = confidence === "high" ? "Helped" : "Likely helped"; tone = "positive"; }
      else if (verdict === "did_not_help") { headline = confidence === "high" ? "Did not help" : "Likely hurt"; tone = "negative"; }
      else { headline = "No clear lift"; tone = "neutral"; }
      explanation = "Measured over the full 28-day window versus comparison pages.";
      break;
    case "inconclusive":
      headline = "No clear result";
      explanation = "The 28-day window closed but the change didn't move the metric beyond normal variation.";
      tone = "neutral";
      break;
    case "blocked_data":
      headline = "Waiting for Google data";
      explanation = `Checkpoint date reached, waiting for Search Console data through ${requiredDataThrough ?? "the window close"}. This measurement is not stalled.`;
      tone = "waiting";
      break;
    case "attribution_limited":
      headline = direction === "positive" ? "Directional (overlapping edit)" : direction === "negative" ? "Directional (overlapping edit)" : "Directional only";
      explanation = "Another change on this page overlaps this measurement, so attribution is weakened; read as directional.";
      tone = "neutral";
      break;
  }

  return {
    maturity,
    direction,
    verdict,
    confidence,
    headline,
    explanation,
    nextCheckpoint,
    requiredDataThrough,
    availableDataThrough: input.latestGscDate,
    evidenceStrength,
    attributionQuality,
    learningEligibility,
    basisDay,
    tone,
    weatherCaveat,
    weatherQuarantined,
    weakComparisonCaveat,
    weakComparisonFlagged,
    seasonalInflectionCaveat,
    seasonalInflectionFlagged,
    recrawlPending,
    recrawlPendingCaveat,
    controlContaminationFlagged,
    controlContaminationCaveat,
  };
}

const MAX_WINDOW_DAYS = Math.max(...PROOF_WINDOW_DAYS);

const normPath = (p: string): string =>
  ((p || "/").replace(/^https?:\/\/[^/]+/, "") || "/").replace(/[?#].*$/, "").replace(/\/$/, "") || "/";

/**
 * Derive overlap context for each proof record from ship timestamps alone (no new
 * table): two records on the SAME page whose 28-day measurement windows intersect
 * weaken each other's attribution. PURE. Returns a Map keyed by record id; absence
 * = clean. Intentional same-day packages collapse to one proof id upstream
 * (id = path::date), so anything detected here is an accidental overlap.
 */
export function detectMeasurementOverlaps(
  records: ReadonlyArray<{ id: string; path: string; shippedAt: string }>,
): Map<string, OverlapContext> {
  const out = new Map<string, OverlapContext>();
  for (let i = 0; i < records.length; i++) {
    const a = records[i];
    if (!a.shippedAt) continue;
    let count = 0;
    for (let j = 0; j < records.length; j++) {
      if (i === j) continue;
      const b = records[j];
      if (!b.shippedAt || normPath(a.path) !== normPath(b.path)) continue;
      const diffDays = Math.abs(Date.parse(a.shippedAt) - Date.parse(b.shippedAt)) / 86_400_000;
      if (diffDays < MAX_WINDOW_DAYS) count++;
    }
    if (count > 0) out.set(a.id, { kind: "overlap", otherChangeCount: count });
  }
  return out;
}

/** Does this record's measurement count as a FINAL outcome (for aggregates)? PURE. */
export function isMatureOutcome(maturity: MeasurementMaturity): boolean {
  return maturity === "mature_result";
}

/** Is this still in-flight (belongs in "Measuring", not a final bucket)? PURE. */
export function isInFlight(maturity: MeasurementMaturity): boolean {
  return (
    maturity === "scheduled" ||
    maturity === "collecting" ||
    maturity === "early_checkpoint" ||
    maturity === "interim_checkpoint" ||
    maturity === "blocked_data" ||
    maturity === "attribution_limited"
  );
}
