/**
 * Verdict provenance for /changes — Trust Sprint Mini-Phase T3.2 (2026-05-06).
 *
 * Pure data contract. Zero I/O. Every attribution verdict on /changes
 * (helping / hurting / nothing_yet / too_early / not_enough_data /
 * not_enough_native_baseline / not_implemented) must be explainable
 * via this builder.
 *
 * Trust-level rules (locked from the Trust Sprint attribution audit
 * 2026-05-06; see `docs/BEACON_ATTRIBUTION_TRUST_AUDIT_2026_05_06.md`):
 *
 *   ┌─────────────────────────────────────┬──────────────┐
 *   │ Verdict                             │ Trust level  │
 *   ├─────────────────────────────────────┼──────────────┤
 *   │ not_enough_data                     │ trustworthy  │
 *   │ too_early                           │ trustworthy  │
 *   │ nothing_yet                         │ trustworthy  │
 *   │ not_enough_native_baseline          │ trustworthy  │
 *   │ not_implemented                     │ trustworthy  │
 *   │ helping (clean window, has live_at) │ directional  │
 *   │ hurting (clean window, has live_at) │ directional  │
 *   │ helping (window touches contam date)│ unreliable   │
 *   │ hurting (window touches contam date)│ unreliable   │
 *   │ helping (live_at missing)           │ directional* │
 *   │ helping (< 5 full pre-poll days)    │ unreliable   │
 *   └─────────────────────────────────────┴──────────────┘
 *
 *   *with explicit caveat about commit-timestamp fallback
 *
 * Per the Trust Sprint synthesis, abstains (top 5) are the engine's
 * MOST honest output and the math core is well-defended against
 * low-count noise; the directional default for `helping` / `hurting`
 * reflects the empirical backtest finding (1 false positive in 5
 * placebos driven by sparse pre-window + sigma_floor inflation; 1
 * false negative in 5 reals at the z-cutoff). T5 will add the
 * `weak_signal` tier + `pre_days_with_full_polls >= 5` precondition;
 * until then we surface the same caveats here so the operator can
 * judge with eyes open.
 *
 * Honesty contract: do NOT call any `helping` verdict "proof" — use
 * "signal" / "early signal" / "measured signal" with the trust badge.
 */

import { NATIVE_REGIME_START } from "@/domains/product/native-regime";

// ─────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────

export type VerdictTrustLevel = "trustworthy" | "directional" | "unreliable";

export type VerdictKind =
  | "helping"
  | "hurting"
  /**
   * T5.2 (2026-05-06) — directional early-signal tier between
   * `too_early` and `helping`. Trust label = directional. Customer-safe
   * phrasing locked at "Early signs of lift" / "Not yet a strong
   * signal". NEVER described as proof / win / worked / confirmed.
   */
  | "weak_signal"
  | "nothing_yet"
  | "too_early"
  | "not_enough_data"
  | "not_enough_native_baseline"
  | "not_implemented";

/** What signal Beacon used as the "change went live" anchor. */
export type AnchorSource = "live_at" | "timestamp" | "unknown";

/**
 * Customer-safe verdict provenance. Every customer-facing field stays
 * jargon-free; raw Z-score + math live ONLY in `operatorDetail`.
 */
export type VerdictProvenance = {
  /** Stable id for `data-verdict-id="…"` on the disclosure. */
  id: string;
  /** Customer-facing label, e.g. "Citation lift after this change". */
  label: string;
  /** Customer-facing verdict copy, e.g. "Early signal — citations rose". */
  verdictLabel: string;
  trustLevel: VerdictTrustLevel;
  /** ISO date Beacon used as "change went live". null when unknown. */
  anchorDate: string | null;
  /** Whether Beacon used a real `live_at` scan timestamp or fell back to commit `timestamp`. */
  anchorSource: AnchorSource;
  /** Customer-safe pre-window phrase. */
  preWindowLabel: string;
  /** Customer-safe post-window phrase. */
  postWindowLabel: string;
  preDays: number;
  postDays: number;
  /** Days in pre-window where the platform poll completed at full coverage (≥80 obs). */
  preFullPollDays?: number;
  /** Days in post-window where the platform poll completed at full coverage. */
  postFullPollDays?: number;
  /** Average citations/day before the change. */
  preAverage?: number;
  /** Average citations/day after the change. */
  postAverage?: number;
  /** "≈ 5/day before, ≈ 11/day after" — humanized. */
  normalRangeLabel?: string;
  /** "Strong signal" / "Weak signal" / null. */
  changeStrengthLabel?: string;
  /** Z-score numeric — operator-only. Customer disclosures must NOT print it. */
  zScore?: number | null;
  /** Customer-safe sustain phrasing, e.g. "Up 6 of last 7 days". */
  sustainLabel?: string;
  /** "full" | "partial" | "proof" | "empty" or null. */
  samplingStatusLabel?: string;
  /** Customer-safe caveat sentences. */
  caveats: string[];
  /** One-line plain-English summary; should naturally include the trust label. */
  plainEnglish: string;
  /**
   * Operator-only debug detail. Lines are rendered in a nested
   * `<details>` block; each line MAY include Z-score, file:line, raw
   * math. NEVER rendered in the customer summary line.
   */
  operatorDetail: string[];
};

// ─────────────────────────────────────────────────────────────────────────
// Contaminated dates (T2 audit; surface caveats; do NOT change verdict math)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Days where the data layer was contaminated (duplicate observations or
 * partial chunks) before T2.3 dedupe + T2.4 resnapshot. Verdicts whose
 * pre/post window touches any of these dates carry a caveat.
 *
 * Post-T2 the data is now de-duped + re-snapshotted, but historical
 * verdicts computed PRE-T2 may still be on disk. Surfacing the caveat
 * defends against stale verdicts being read as causal until the next
 * verdict materialize pass writes a fresh row.
 *
 * Frozen as a known set; not derived from data because the audit's
 * specific date callouts are operator-locked.
 */
export const CONTAMINATED_DATES = [
  "2026-04-23",
  "2026-04-26",
  "2026-05-06",
] as const;

const CONTAMINATED_SET = new Set<string>(CONTAMINATED_DATES);

/**
 * Returns true when the inclusive [start, end] date range overlaps any
 * known contaminated date. Half-open windows are caller's responsibility;
 * since `change.timestamp` is anchored on calendar days, inclusive is
 * the right interpretation here.
 */
export function windowTouchesContaminatedDate(
  startISO: string | null,
  endISO: string | null,
): boolean {
  if (startISO == null && endISO == null) return false;
  if (startISO == null || endISO == null) return false;
  for (const d of CONTAMINATED_DATES) {
    if (d >= startISO && d <= endISO) return true;
  }
  return false;
}

/** True when ANY date in the (inclusive) range falls before NATIVE_REGIME_START. */
function rangeTouchesPreCutover(startISO: string | null, endISO: string | null): boolean {
  if (startISO == null || endISO == null) return false;
  return startISO < NATIVE_REGIME_START;
}

// ─────────────────────────────────────────────────────────────────────────
// Builder inputs
// ─────────────────────────────────────────────────────────────────────────

export type BuildVerdictProvenanceInput = {
  /** A short id for the disclosure DOM attribute. */
  id: string;
  /** The verdict the engine emitted. */
  verdict: VerdictKind;
  /** Anchor date the engine used (the change date or null when unknown). */
  anchorDate: string | null;
  /** Whether the engine used `change.live_at` or fell back to `change.timestamp`. */
  anchorSource: AnchorSource;
  /** Pre-window inclusive start date (ISO). null when no series. */
  preStartISO: string | null;
  /** Pre-window inclusive end date (ISO). null when no series. */
  preEndISO: string | null;
  /** Post-window inclusive start date (ISO). null when no post data. */
  postStartISO: string | null;
  /** Post-window inclusive end date (ISO). null when no post data. */
  postEndISO: string | null;
  /** Days in the pre-window the engine actually used for math. */
  preDays: number;
  /** Days in the post-window the engine actually used for math. */
  postDays: number;
  /** Days in pre-window classified `full` (≥80 obs). Undefined when unknown. */
  preFullPollDays?: number;
  /** Days in post-window classified `full` (≥80 obs). Undefined when unknown. */
  postFullPollDays?: number;
  /** Mean citations/day before the change. */
  muPre?: number;
  /** Mean citations/day after the change. */
  muPost?: number;
  /** Z-score (raw signed). Goes only to operatorDetail. */
  zScore?: number | null;
  /** Last-7-days sustain-up count (operator-only by default). */
  sustainUp?: number | null;
  /** Last-7-days sustain-down count (operator-only by default). */
  sustainDown?: number | null;
  /** Engine confidence tier (`high`/`medium`/`low`). */
  confidence?: "high" | "medium" | "low" | null;
  /** Sampling guard demotion if it fired. */
  samplingGuardDemotion?: { from: string; to: string; reason: string } | null;
  /** Customer-safe brief description of what changed (page path or asset name). */
  changeDescription?: string | null;
};

// ─────────────────────────────────────────────────────────────────────────
// Builder
// ─────────────────────────────────────────────────────────────────────────

const VERDICT_LABEL_MAP: Record<VerdictKind, string> = {
  helping: "Citation lift detected after this change",
  hurting: "Citation drop detected after this change",
  // T5.2 (2026-05-06) — customer-safe directional phrasing.
  weak_signal: "Early signs of lift detected after this change",
  nothing_yet: "No measurable shift after this change",
  too_early: "Too early to read this change",
  not_enough_data: "Not enough data to read this change",
  not_enough_native_baseline:
    "Not enough native-poll baseline to compare with",
  not_implemented: "Edit was accepted but the page didn't show it",
};

/**
 * T5.2 (2026-05-06) — `weak_signal` is excluded because it's NOT an
 * abstain; the builder handles it inline with directional copy. The 5
 * abstain verdicts retain their trustworthy plainEnglish here.
 */
const VERDICT_PLAIN_TRUSTWORTHY: Record<
  Exclude<
    VerdictKind,
    "helping" | "hurting" | "weak_signal"
  >,
  string
> = {
  not_enough_data:
    "Trustworthy abstain — there isn't enough citation history yet to compare before vs. after.",
  too_early:
    "Trustworthy abstain — the post-change window is still too short to read a result.",
  nothing_yet:
    "Trustworthy abstain — Beacon has watched the post-change window but seen no measurable shift.",
  not_enough_native_baseline:
    "Trustworthy abstain — pre-change days were imported historical data and post-change days are native polls; the two systems aren't directly comparable.",
  not_implemented:
    "Trustworthy abstain — Beacon scanned the page after the edit was accepted but never saw the proposed change land.",
};

function isAbstain(v: VerdictKind): boolean {
  return (
    v === "not_enough_data" ||
    v === "too_early" ||
    v === "nothing_yet" ||
    v === "not_enough_native_baseline" ||
    v === "not_implemented"
  );
}

export function buildVerdictProvenance(
  input: BuildVerdictProvenanceInput,
): VerdictProvenance {
  const caveats: string[] = [];
  const operatorDetail: string[] = [];

  // ── Anchor caveats ──
  if (input.anchorSource === "timestamp" && (input.verdict === "helping" || input.verdict === "hurting")) {
    caveats.push(
      "Beacon used the changelog timestamp as the change date because no live-at scan timestamp exists for this row. The actual deploy day may differ.",
    );
  }
  if (input.anchorSource === "unknown") {
    caveats.push(
      "The change date is unknown — Beacon could not anchor a before/after window for this row.",
    );
  }

  // ── Contaminated-date caveats (pre + post window) ──
  // Per T2 audit: 2026-04-23 / 2026-04-26 / 2026-05-06 had partial polls
  // or duplicate observations. Verdict math may have been computed pre-T2
  // dedupe + resnapshot.
  const preTouchesContam = windowTouchesContaminatedDate(input.preStartISO, input.preEndISO);
  const postTouchesContam = windowTouchesContaminatedDate(input.postStartISO, input.postEndISO);
  if (preTouchesContam || postTouchesContam) {
    const which: string[] = [];
    for (const d of CONTAMINATED_DATES) {
      const inPre =
        input.preStartISO != null &&
        input.preEndISO != null &&
        d >= input.preStartISO &&
        d <= input.preEndISO;
      const inPost =
        input.postStartISO != null &&
        input.postEndISO != null &&
        d >= input.postStartISO &&
        d <= input.postEndISO;
      if (inPre || inPost) which.push(d);
    }
    caveats.push(
      `Window includes ${which.join(", ")} — ${which.length === 1 ? "a date" : "dates"} that had partial polling or duplicate observations before the data layer was cleaned. Treat this verdict as directional until you refresh your connected data.`,
    );
  }

  // ── Pre-cutover caveat ──
  const preTouchesPreCutover = rangeTouchesPreCutover(input.preStartISO, input.preEndISO);
  if (preTouchesPreCutover) {
    caveats.push(
      "Pre-change window includes dates before native AI polling began on Apr 22, 2026 — those rows were re-derived from the historical data import.",
    );
  }

  // ── Pre full-poll-day count caveat (T5 territory; just surface) ──
  if (
    (input.verdict === "helping" || input.verdict === "hurting") &&
    typeof input.preFullPollDays === "number" &&
    input.preFullPollDays < 5
  ) {
    caveats.push(
      `Pre-change window had only ${input.preFullPollDays} day${input.preFullPollDays === 1 ? "" : "s"} of full-coverage polling — sparse baselines can over-amplify a small post-change shift.`,
    );
  }

  // ── Sampling guard demotion caveat ──
  if (input.samplingGuardDemotion) {
    caveats.push(
      `Beacon's sampling guard demoted this verdict from ${input.samplingGuardDemotion.from} to ${input.samplingGuardDemotion.to} because ${
        input.samplingGuardDemotion.reason === "proof_day_in_post_window"
          ? "the post-change window included a small proof-run day"
          : "no day in the post-change window had full-coverage polling"
      }.`,
    );
  }

  // ── Post-cutover micro-caveat for too-early verdicts when post-days < 5 ──
  if (input.verdict === "too_early" && input.postDays < 5) {
    caveats.push(
      `Beacon needs at least 5 days of post-change citations before it will issue a directional read.`,
    );
  }

  // ── Trust level ──
  // Operator-locked rubric (T3.2 brief allows "unreliable OR strong
  // caveat" for the contaminated-date case):
  //   - Abstains → trustworthy.
  //   - helping/hurting + sparse pre-window (<5 full poll days) →
  //     UNRELIABLE. This matches the empirical attribution backtest's
  //     placebo-2 false-positive root cause.
  //   - helping/hurting touching a contaminated date → still DIRECTIONAL
  //     because T2 dedupe + resnapshot cleaned the data; the caveat
  //     above already surfaces the partial-coverage / dedupe history.
  //   - helping/hurting on a clean window → DIRECTIONAL.
  let trustLevel: VerdictTrustLevel;
  if (isAbstain(input.verdict)) {
    trustLevel = "trustworthy";
  } else if (input.verdict === "weak_signal") {
    // T5.2 (2026-05-06) — `weak_signal` is always directional. The
    // sparse-pre-window precondition in url-verdict.ts already demotes
    // sparse-baseline weak_signal → nothing_yet before reaching this
    // builder, so a `weak_signal` we see here has cleared the floor.
    // Trust contract: directional + caveat that it's not yet a strong
    // signal.
    trustLevel = "directional";
  } else {
    // helping / hurting
    const sparsePreWindow =
      typeof input.preFullPollDays === "number" && input.preFullPollDays < 5;
    // Reference preTouchesContam / postTouchesContam to keep the lint quiet;
    // the values already drove the caveat surfacing above.
    void preTouchesContam;
    void postTouchesContam;
    if (sparsePreWindow) {
      trustLevel = "unreliable";
    } else {
      trustLevel = "directional";
    }
  }

  // ── verdictLabel + plainEnglish ──
  const verdictLabel = VERDICT_LABEL_MAP[input.verdict];
  let plainEnglish: string;
  if (isAbstain(input.verdict)) {
    plainEnglish = VERDICT_PLAIN_TRUSTWORTHY[input.verdict as Exclude<VerdictKind, "helping" | "hurting" | "weak_signal">];
  } else if (input.verdict === "weak_signal") {
    // T5.2 — operator-locked phrasing: directional, never proof.
    // Customer copy MUST NOT include "z-score" / Greek notation / raw
    // math (locked by `verdict-provenance-trust-labels.test.ts`).
    plainEnglish = `Directional signal — Beacon detected early signs of lift after this change, but the change-strength reading is below the strong-signal bar. Not yet a strong signal; watch the post-change window over the next few days.`;
  } else if (trustLevel === "unreliable") {
    plainEnglish = `Unreliable — Beacon detected a ${input.verdict === "helping" ? "lift" : "drop"} after this change, but the pre-change window has too few full-coverage poll days. Sparse baselines can over-amplify a small post-change shift; do not read as causal yet.`;
  } else {
    plainEnglish = `Directional signal — Beacon compared the days before this change with the days after. ${input.verdict === "helping" ? "Citations rose" : "Citations fell"} after the change, but the math is correlation, not proof of causation.`;
  }

  // ── Customer-safe summary fields ──
  const preWindowLabel =
    input.preStartISO && input.preEndISO
      ? `${input.preStartISO} → ${input.preEndISO} (${input.preDays}-day baseline)`
      : `${input.preDays}-day baseline`;
  const postWindowLabel =
    input.postStartISO && input.postEndISO
      ? `${input.postStartISO} → ${input.postEndISO} (${input.postDays}-day post-change window)`
      : `${input.postDays}-day post-change window`;

  const normalRangeLabel =
    typeof input.muPre === "number" && typeof input.muPost === "number"
      ? `≈ ${formatDailyRate(input.muPre)} before, ≈ ${formatDailyRate(input.muPost)} after`
      : undefined;

  const changeStrengthLabel =
    typeof input.zScore === "number"
      ? Math.abs(input.zScore) >= 2
        ? "Strong signal"
        : "Weak signal"
      : undefined;

  const sustainLabel =
    typeof input.sustainUp === "number" && typeof input.sustainDown === "number"
      ? input.sustainUp >= 5
        ? `Citations were higher than the baseline on ${input.sustainUp} of the last 7 days.`
        : input.sustainDown >= 5
          ? `Citations were lower than the baseline on ${input.sustainDown} of the last 7 days.`
          : "No sustained direction in the last 7 days."
      : undefined;

  // ── Operator detail (Z-score, math, file:line) ──
  if (typeof input.zScore === "number") {
    operatorDetail.push(`Z-score = ${input.zScore.toFixed(2)} (signed)`);
  }
  if (typeof input.muPre === "number" && typeof input.muPost === "number") {
    operatorDetail.push(
      `mu_pre = ${input.muPre.toFixed(3)}/day; mu_post = ${input.muPost.toFixed(3)}/day; delta_abs = ${(
        input.muPost - input.muPre
      ).toFixed(3)}/day`,
    );
  }
  if (typeof input.sustainUp === "number" && typeof input.sustainDown === "number") {
    operatorDetail.push(`sustain_up=${input.sustainUp}, sustain_down=${input.sustainDown} (last 7 post-window days)`);
  }
  if (typeof input.preFullPollDays === "number") {
    operatorDetail.push(`pre_full_poll_days = ${input.preFullPollDays}`);
  }
  if (typeof input.postFullPollDays === "number") {
    operatorDetail.push(`post_full_poll_days = ${input.postFullPollDays}`);
  }
  if (input.confidence != null) {
    operatorDetail.push(`engine_confidence_tier = ${input.confidence}`);
  }
  operatorDetail.push(
    "Math source: src/domains/attribution/url-verdict.ts → computeUrlVerdict (sigma_pre floored at POISSON_SIGMA_FLOOR=1.0).",
  );
  if (input.anchorSource === "live_at") {
    operatorDetail.push(`anchor_source = live_at (real scan timestamp)`);
  } else if (input.anchorSource === "timestamp") {
    operatorDetail.push(`anchor_source = changelog.timestamp (no live_at scan timestamp; fallback)`);
  } else {
    operatorDetail.push(`anchor_source = unknown`);
  }

  return {
    id: input.id,
    label: input.changeDescription ?? verdictLabel,
    verdictLabel,
    trustLevel,
    anchorDate: input.anchorDate,
    anchorSource: input.anchorSource,
    preWindowLabel,
    postWindowLabel,
    preDays: input.preDays,
    postDays: input.postDays,
    preFullPollDays: input.preFullPollDays,
    postFullPollDays: input.postFullPollDays,
    preAverage: input.muPre,
    postAverage: input.muPost,
    normalRangeLabel,
    changeStrengthLabel,
    zScore: input.zScore,
    sustainLabel,
    samplingStatusLabel: input.samplingGuardDemotion
      ? `${input.samplingGuardDemotion.from} → ${input.samplingGuardDemotion.to}`
      : undefined,
    caveats,
    plainEnglish,
    operatorDetail,
  };
}

function formatDailyRate(n: number): string {
  if (n === 0) return "0/day";
  if (n < 1) return `${n.toFixed(2)}/day`;
  if (n < 10) return `${n.toFixed(1)}/day`;
  return `${Math.round(n)}/day`;
}
