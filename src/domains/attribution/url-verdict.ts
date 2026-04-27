/**
 * URL-level change verdict engine — adaptive Z-score.
 *
 * For a single URL + single change date, compute whether the change helped,
 * hurt, moved nothing, or is still too early to tell — using the URL's own
 * baseline noise level, not hardcoded thresholds.
 *
 * This file is pure functions. No I/O, no state. Takes a dense daily time
 * series and a change date, returns a structured verdict with the math shown.
 *
 * Formula:
 *   μ_pre  = mean of daily counts in the baseline window. ADAPTIVE: the
 *            window is max(baselineMinDays, min(baselineTargetDays, days_available))
 *            where days_available = days between the URL's first observation
 *            and the change date. A URL with only 8 days of history uses an
 *            8d baseline; a URL with 90d uses 14d (diminishing returns).
 *            If fewer than `baselineMinDays` days available, returns
 *            "not_enough_data".
 *   σ_pre  = stddev of daily counts in the baseline window
 *            (floored at 1.0 — Poisson assumption for low-count data)
 *   μ_post = mean of daily counts from change_date+1 through today (or +30d cap)
 *   N      = number of days in the post-change window
 *   z      = (μ_post − μ_pre) / (σ_pre / √N)
 *
 * Sustain check:
 *   count of the last 7 days where count > μ_pre  (for Helping)
 *   count of the last 7 days where count < μ_pre  (for Hurting)
 *
 * Verdicts:
 *   Helping          : z ≥ +Z_BAR  AND  sustain_up   ≥ SUSTAIN_MIN
 *   Hurting          : z ≤ −Z_BAR  AND  sustain_down ≥ SUSTAIN_MIN
 *   Nothing yet      : |z| < Z_BAR  AND  N ≥ NOTHING_YET_MIN_DAYS
 *   Too early        : |z| < Z_BAR  AND  N < NOTHING_YET_MIN_DAYS
 *   Not enough data  : baseline_days < BASELINE_MIN_DAYS
 *
 * Defaults (all move to business-config in Phase 3):
 *   BASELINE_TARGET_DAYS  = 14
 *   BASELINE_MIN_DAYS     = 7
 *   POST_WINDOW_MAX_DAYS  = 30
 *   Z_BAR                 = 2.0
 *   SUSTAIN_MIN           = 5
 *   SUSTAIN_LAST_N_DAYS   = 7
 *   POISSON_SIGMA_FLOOR   = 1.0
 *   NOTHING_YET_MIN_DAYS  = 14
 */

export type VerdictThresholds = {
  /** Upper bound on baseline window. Beyond this, diminishing returns on stddev estimate. */
  baselineTargetDays: number;
  /** Absolute minimum pre-change days to produce any verdict at all. Below this → not_enough_data. */
  baselineMinDays: number;
  /** Below this (but ≥ baselineMinDays) the confidence tier is downgraded by one. */
  baselineConfidentDays: number;
  postWindowMaxDays: number;
  zBar: number;
  sustainMin: number;
  sustainLastNDays: number;
  poissonSigmaFloor: number;
  nothingYetMinDays: number;
};

export const DEFAULT_THRESHOLDS: VerdictThresholds = {
  baselineTargetDays: 14,
  baselineMinDays: 3, // adaptive: allows newer URLs to get verdicts at reduced confidence
  baselineConfidentDays: 7,
  postWindowMaxDays: 30,
  zBar: 2.0,
  sustainMin: 5,
  sustainLastNDays: 7,
  poissonSigmaFloor: 1.0,
  nothingYetMinDays: 14,
};

export type VerdictLabel =
  | "helping"
  | "hurting"
  | "nothing_yet"
  | "too_early"
  | "not_enough_data"
  /**
   * Commit 2 (2026-04-24) — pure-split mixed-source abstain. Pre-change
   * window is entirely one measurement source (e.g. Profound benchmark)
   * and post-change window is entirely another (e.g. native polling).
   * Z-score across different measurement systems is not comparable, so
   * we abstain. Full partial-overlap mixed-window math is deferred to a
   * later commit in this phase.
   */
  | "not_enough_native_baseline"
  /**
   * Recommendation Lifecycle OS — Phase 4 (2026-04-27). Emitted ONLY
   * when `BEACON_LIFECYCLE_VERDICT_ENABLED=1` AND the changelog entry
   * is linked (via `source_rec_id` + `action_type` + `target_element_key`)
   * to a `recommended_edits` row whose `implementation_status` is
   * `"not_found_after_7d"`. The operator accepted the edit, ≥7 days
   * passed, and no scan ever detected the proposed change on the
   * target page. Z-score is NOT computed — the verdict is operationally
   * "the change never happened, so there is nothing to attribute."
   *
   * Distinct from `nothing_yet` (change happened but moved no needle)
   * and `too_early` (change happened but post-window too short).
   */
  | "not_implemented";

/**
 * Optional per-day source tag. When every day in the baseline window carries
 * one tag and every day in the post-change window carries a DIFFERENT tag,
 * the Z-score is crossing measurement systems — we abstain with
 * `not_enough_native_baseline` rather than report a nonsense verdict. When
 * the tag is absent on any point in a window, the guard does not fire and
 * the engine behaves as before.
 */
export type DailyPointSource = "benchmark" | "derived";

export type VerdictExplanation = {
  /** Plain English narrative (~1–2 sentences) summarising the math. */
  summary: string;
  /** Structured math so a UI panel can render the derivation. */
  math: {
    baseline_days_used: number;
    mu_pre: number;
    sigma_pre_raw: number; // before Poisson floor
    sigma_pre_used: number; // after Poisson floor
    post_days_used: number;
    mu_post: number;
    z: number;
    sustain_up: number;
    sustain_down: number;
  };
};

export type UrlVerdict = {
  verdict: VerdictLabel;
  /** Signed Z-score, null when verdict=not_enough_data. */
  z: number | null;
  /** Relative change: (μ_post − μ_pre) / max(μ_pre, 1). */
  delta_pct: number | null;
  /** Absolute delta in citations/day. */
  delta_abs: number | null;
  /** Days of post-change data available. */
  post_days: number;
  /** Confidence tier derived from |z| and post_days. */
  confidence: "high" | "medium" | "low";
  /** Days in last 7 above/below pre-mean (directional sustain support). */
  sustain: { up: number; down: number };
  explanation: VerdictExplanation;
};

export type DailyPoint = {
  date: string;
  count: number;
  /**
   * Commit 2: optional source tag used by the pure-split mixed-source guard.
   * When omitted, the guard never fires (back-compat). Callers that build
   * the series from mixed measurement systems (Profound benchmark + native
   * polling) should tag every point.
   */
  source_type?: DailyPointSource;
};

export type ComputeVerdictInput = {
  /** Day-by-day citation counts for the URL, sorted ascending by date,
   *  ZERO-FILLED (use `denseSeries` from url-citation-history.ts). */
  series: DailyPoint[];
  /** Change date in YYYY-MM-DD. Baseline ends the day before; post starts the day after. */
  changeDate: string;
  /** "Today" in YYYY-MM-DD. Defaults to the last date in series. */
  asOfDate?: string;
  thresholds?: Partial<VerdictThresholds>;
};

// ---------------------------------------------------------------------------
// Pure math helpers
// ---------------------------------------------------------------------------

function mean(nums: number[]): number {
  if (nums.length === 0) return 0;
  let sum = 0;
  for (const n of nums) sum += n;
  return sum / nums.length;
}

function stddev(nums: number[], m: number): number {
  if (nums.length < 2) return 0;
  let s = 0;
  for (const n of nums) s += (n - m) * (n - m);
  return Math.sqrt(s / (nums.length - 1));
}

function isoDaysBetween(aISO: string, bISO: string): number {
  const a = new Date(aISO + "T00:00:00Z").getTime();
  const b = new Date(bISO + "T00:00:00Z").getTime();
  return Math.round((b - a) / 86_400_000);
}

function shiftIsoDate(iso: string, days: number): string {
  const t = new Date(iso + "T00:00:00Z").getTime() + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Core engine
// ---------------------------------------------------------------------------

export function computeUrlVerdict(input: ComputeVerdictInput): UrlVerdict {
  const t: VerdictThresholds = {
    ...DEFAULT_THRESHOLDS,
    ...(input.thresholds ?? {}),
  };

  const series = input.series;
  const asOfDate =
    input.asOfDate ?? series[series.length - 1]?.date ?? input.changeDate;

  const change = input.changeDate;

  // --- Baseline window: [change − target .. change − 1], inclusive
  const baselineStart = shiftIsoDate(change, -t.baselineTargetDays);
  const baselineEnd = shiftIsoDate(change, -1);
  const baselinePoints = series.filter(
    (p) => p.date >= baselineStart && p.date <= baselineEnd,
  );

  // --- Post window: [change + 1 .. min(asOfDate, change + post_max)]
  const postStart = shiftIsoDate(change, 1);
  const postMaxEnd = shiftIsoDate(change, t.postWindowMaxDays);
  const postEnd = asOfDate < postMaxEnd ? asOfDate : postMaxEnd;
  const postPoints =
    postStart > postEnd
      ? []
      : series.filter((p) => p.date >= postStart && p.date <= postEnd);

  const baselineCounts = baselinePoints.map((p) => p.count);
  const postCounts = postPoints.map((p) => p.count);

  const muPre = mean(baselineCounts);
  const sigmaPreRaw = stddev(baselineCounts, muPre);
  const sigmaPreUsed = Math.max(sigmaPreRaw, t.poissonSigmaFloor);
  const muPost = mean(postCounts);
  const N = postCounts.length;

  // --- Sustain check: last SUSTAIN_LAST_N_DAYS of post window
  const sustainWindow = postPoints.slice(-t.sustainLastNDays);
  let sustainUp = 0;
  let sustainDown = 0;
  for (const p of sustainWindow) {
    if (p.count > muPre) sustainUp += 1;
    else if (p.count < muPre) sustainDown += 1;
  }

  // --- Pure-split mixed-source abstain (Commit 2, 2026-04-24)
  // When every day in the baseline window carries one source_type and every
  // day in the post-change window carries a DIFFERENT source_type, the Z-
  // score is comparing measurement systems (Profound benchmark vs native
  // polling), not a real change. Abstain with explanation instead of
  // reporting a nonsense verdict. When the tag is absent on any point,
  // the guard does not fire — back-compat for callers that don't yet tag
  // their series.
  const baselineSource = uniformSourceType(baselinePoints);
  const postSource = uniformSourceType(postPoints);
  if (
    baselineSource !== null &&
    postSource !== null &&
    baselineSource !== postSource &&
    baselinePoints.length > 0 &&
    postPoints.length > 0
  ) {
    const muPreLocal = mean(baselineCounts);
    const sigmaPreRawLocal = stddev(baselineCounts, muPreLocal);
    const sigmaPreUsedLocal = Math.max(
      sigmaPreRawLocal,
      t.poissonSigmaFloor,
    );
    const muPostLocal = mean(postCounts);
    return {
      verdict: "not_enough_native_baseline",
      z: null,
      delta_pct: null,
      delta_abs: null,
      post_days: postCounts.length,
      confidence: "low",
      sustain: { up: sustainUp, down: sustainDown },
      explanation: {
        summary: `Mixed measurement sources: baseline ${baselinePoints.length}d from ${sourceLabel(baselineSource)}, post-change ${postPoints.length}d from ${sourceLabel(postSource)}. Z-score across different systems is not comparable — not enough native baseline to judge yet.`,
        math: {
          baseline_days_used: baselineCounts.length,
          mu_pre: muPreLocal,
          sigma_pre_raw: sigmaPreRawLocal,
          sigma_pre_used: sigmaPreUsedLocal,
          post_days_used: postCounts.length,
          mu_post: muPostLocal,
          z: 0,
          sustain_up: sustainUp,
          sustain_down: sustainDown,
        },
      },
    };
  }

  // --- Not-enough-data short-circuit
  if (baselineCounts.length < t.baselineMinDays) {
    return {
      verdict: "not_enough_data",
      z: null,
      delta_pct: null,
      delta_abs: null,
      post_days: N,
      confidence: "low",
      sustain: { up: sustainUp, down: sustainDown },
      explanation: {
        summary: `Only ${baselineCounts.length} day${baselineCounts.length === 1 ? "" : "s"} of baseline data before the change (need at least ${t.baselineMinDays}). Can't compute a reliable verdict yet.`,
        math: {
          baseline_days_used: baselineCounts.length,
          mu_pre: muPre,
          sigma_pre_raw: sigmaPreRaw,
          sigma_pre_used: sigmaPreUsed,
          post_days_used: N,
          mu_post: muPost,
          z: 0,
          sustain_up: sustainUp,
          sustain_down: sustainDown,
        },
      },
    };
  }

  // --- Z-score
  // If N is 0 (change is in the future or same day as asOfDate), verdict is too_early.
  let z = 0;
  if (N > 0) {
    z = (muPost - muPre) / (sigmaPreUsed / Math.sqrt(N));
  }

  const deltaAbs = muPost - muPre;
  const deltaPct = muPre > 0 ? deltaAbs / muPre : deltaAbs;

  let verdict: VerdictLabel;
  if (z >= t.zBar && sustainUp >= t.sustainMin) {
    verdict = "helping";
  } else if (z <= -t.zBar && sustainDown >= t.sustainMin) {
    verdict = "hurting";
  } else if (N >= t.nothingYetMinDays) {
    verdict = "nothing_yet";
  } else {
    verdict = "too_early";
  }

  const confidence: "high" | "medium" | "low" = (() => {
    const absZ = Math.abs(z);
    // Base tier from z-strength + post window depth.
    let tier: "high" | "medium" | "low";
    if (absZ >= 3 && N >= t.nothingYetMinDays) tier = "high";
    else if (absZ >= 2 && N >= t.baselineMinDays) tier = "medium";
    else tier = "low";

    // Downgrade one tier when baseline is adaptive-short (< confidentDays).
    // Example: 5-day baseline + strong z=+3.5 → "medium" not "high".
    // Rationale: with so few baseline days, the stddev estimate is noisier
    // and a strong z can be overstated.
    const baselineAdaptiveShort =
      baselineCounts.length < t.baselineConfidentDays;
    if (baselineAdaptiveShort) {
      if (tier === "high") tier = "medium";
      else if (tier === "medium") tier = "low";
    }
    return tier;
  })();

  const summary = buildSummary({
    verdict,
    muPre,
    sigmaPreUsed,
    muPost,
    z,
    N,
    sustainUp,
    sustainDown,
    baselineDaysUsed: baselineCounts.length,
  });

  return {
    verdict,
    z: N > 0 ? z : null,
    delta_pct: N > 0 ? deltaPct : null,
    delta_abs: N > 0 ? deltaAbs : null,
    post_days: N,
    confidence,
    sustain: { up: sustainUp, down: sustainDown },
    explanation: {
      summary,
      math: {
        baseline_days_used: baselineCounts.length,
        mu_pre: round(muPre, 2),
        sigma_pre_raw: round(sigmaPreRaw, 2),
        sigma_pre_used: round(sigmaPreUsed, 2),
        post_days_used: N,
        mu_post: round(muPost, 2),
        z: round(z, 2),
        sustain_up: sustainUp,
        sustain_down: sustainDown,
      },
    },
  };
}

function round(n: number, digits: number): number {
  const f = Math.pow(10, digits);
  return Math.round(n * f) / f;
}

/** Returns the single source_type if every point in the window carries the
 *  same (non-null) tag; returns null when any point is untagged or when the
 *  window is empty or mixed. Used by the pure-split abstain guard. */
function uniformSourceType(points: DailyPoint[]): DailyPointSource | null {
  if (points.length === 0) return null;
  let found: DailyPointSource | null = null;
  for (const p of points) {
    if (!p.source_type) return null; // untagged → guard disabled
    if (found === null) found = p.source_type;
    else if (found !== p.source_type) return null; // mixed within window
  }
  return found;
}

function sourceLabel(source: DailyPointSource): string {
  return source === "benchmark" ? "Profound benchmark" : "native polling";
}

function buildSummary(args: {
  verdict: VerdictLabel;
  muPre: number;
  sigmaPreUsed: number;
  muPost: number;
  z: number;
  N: number;
  sustainUp: number;
  sustainDown: number;
  baselineDaysUsed: number;
}): string {
  const {
    verdict,
    muPre,
    sigmaPreUsed,
    muPost,
    z,
    N,
    sustainUp,
    sustainDown,
    baselineDaysUsed,
  } = args;

  const pre = `baseline ${round(muPre, 1)}/day ± ${round(sigmaPreUsed, 1)} over ${baselineDaysUsed}d`;
  const post = `after-change avg ${round(muPost, 1)}/day over ${N}d`;
  const zStr = z >= 0 ? `+${round(z, 1)}` : `${round(z, 1)}`;

  switch (verdict) {
    case "helping":
      return `Citations up — ${pre}, ${post}. z=${zStr} (significant), sustained ${sustainUp} of last 7 days above baseline.`;
    case "hurting":
      return `Citations down — ${pre}, ${post}. z=${zStr} (significant decline), ${sustainDown} of last 7 days below baseline.`;
    case "nothing_yet":
      return `No meaningful movement — ${pre}, ${post}. z=${zStr} (below ±2 significance bar).`;
    case "too_early":
      if (N === 0) return `Change too recent — no post-change days yet.`;
      return `Too early — only ${N}d of post-change data. ${pre}, ${post}, z=${zStr} so far.`;
    case "not_enough_data":
      return `Not enough baseline data before the change to judge.`;
    case "not_enough_native_baseline":
      // Generated inline at the guard site above (carries richer context).
      return `Mixed measurement sources — not enough native baseline to judge yet.`;
    case "not_implemented":
      // Phase 4: synthetic verdict — `buildNotImplementedVerdict` in
      // url-change-outcome.ts hand-builds the explanation. This branch
      // is for type exhaustiveness only and shouldn't be reached
      // through `computeUrlVerdict`.
      return `Beacon never detected this change live on the page.`;
  }
}

// ---------------------------------------------------------------------------
// Convenience: plain-English label for the verdict pill.
// ---------------------------------------------------------------------------

export const VERDICT_LABEL: Record<VerdictLabel, string> = {
  helping: "Helping",
  hurting: "Hurting",
  nothing_yet: "Nothing yet",
  too_early: "Too early",
  not_enough_data: "No baseline",
  not_enough_native_baseline: "No native baseline",
  not_implemented: "Not implemented",
};

export const VERDICT_TONE: Record<VerdictLabel, "success" | "danger" | "muted" | "neutral"> = {
  helping: "success",
  hurting: "danger",
  nothing_yet: "muted",
  too_early: "neutral",
  not_enough_data: "muted",
  not_enough_native_baseline: "neutral",
  not_implemented: "muted",
};
