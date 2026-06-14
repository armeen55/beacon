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
  /**
   * M3 (operator audit, 2026-05-05) — denominator floor for relative-%
   * lift reporting. When the pre-change mean (`μ_pre`) is below this
   * floor, the relative-% lift is too noisy to publish (a baseline of
   * 0.5 citations/day going to 6/day would otherwise read as +1100%,
   * which overclaims causality). When `μ_pre < deltaPctMinBaseline`,
   * `delta_pct` is returned as `null`; renderers should show the
   * absolute delta ("citations rose from 0.5/day to 6/day") instead.
   *
   * Z-score and confidence tier remain unaffected — they already
   * floor σ_pre at `poissonSigmaFloor` so the math stays well-defined
   * for low-count series.
   */
  deltaPctMinBaseline: number;
  /**
   * T5.2 (2026-05-06) — sparse-pre-window precondition. Minimum number
   * of `full`-coverage polling days (≥80 obs) required in the pre-change
   * baseline before any `helping` / `hurting` verdict can ship. Below
   * this floor, `helping`/`hurting` is demoted to `nothing_yet` because
   * sparse pre-windows + sigma_floor=1.0 produce structural false
   * positives (Phase 3.B placebo-2 class).
   *
   * Back-compat: when no baseline point carries `sampling_status`, the
   * precondition counts ALL baseline days as "full" and is a no-op —
   * legacy fixtures + tests that don't tag sampling status keep their
   * previous semantics.
   */
  preDaysWithFullPollsMin: number;
  /**
   * T5.2 (2026-05-06) — `weak_signal` tier lower bound. When
   * `|z| ∈ [zBarWeakSignal, zBar)` AND sustain holds AND the
   * sparse-pre-window precondition is satisfied, emit `weak_signal`
   * (directional, never proof). Below this floor → `nothing_yet` /
   * `too_early` (existing behavior).
   *
   * Catches moderate-but-real lift like Phase 3.B real-3 menlo-park
   * (z=+1.35, lift was real but sub-cutoff under the old single-
   * threshold rule).
   */
  zBarWeakSignal: number;
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
  // M3 floor: anything under 1 citation/day pre-change is too thin to
  // trust as a denominator for relative %. Match the Poisson sigma
  // floor (1.0) — both express the "low-count series" regime.
  deltaPctMinBaseline: 1.0,
  // T5.2 (2026-05-06) — operator-locked attribution-hardening floors.
  preDaysWithFullPollsMin: 5,
  zBarWeakSignal: 1.2,
};

export type VerdictLabel =
  | "helping"
  | "hurting"
  /**
   * T5.2 (2026-05-06) — early-signal tier between `too_early` and
   * `helping`. Emitted when `|z| ∈ [zBarWeakSignal, zBar)` AND sustain
   * passes AND the sparse-pre-window precondition is satisfied.
   *
   * Customer-safe phrasing: "Early signs of lift" / "Directional signal"
   * / "Not yet a strong signal". NEVER described as proof / win /
   * worked / confirmed.
   *
   * Trust label (T3.2 verdict-provenance contract): directional, never
   * trustworthy.
   */
  | "weak_signal"
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

/**
 * D4 (operator audit, 2026-05-05) — observability metadata. When the M3
 * sampling-status guard fires (demoting helping/hurting → nothing_yet
 * because the post-window contains a proof day or has zero full days),
 * the materialize pass logs a structured warning. The verdict engine
 * itself stays pure (no I/O) — it just stamps this field so the caller
 * has enough context to emit the log.
 *
 * Absent (undefined) when the guard didn't fire — the common case.
 */
export type SamplingGuardDemotion = {
  from: "helping" | "hurting";
  to: "nothing_yet";
  reason: "proof_day_in_post_window" | "no_full_days_in_post_window";
};

/**
 * T5.2 (2026-05-06) — sparse-pre-window precondition demotion. Captures
 * when the `helping`/`hurting`/`weak_signal` verdict was downgraded to
 * `nothing_yet` because the pre-change window had fewer than
 * `preDaysWithFullPollsMin` days of full-coverage polling.
 *
 * Closes the Phase 3.B placebo-2 false-positive class (sparse pre-window
 * + sigma_floor=1.0 → inflated z). Emitted observability so the
 * materializer can log a structured warning naming the URL + verdict
 * + pre-full-poll-day count.
 *
 * Absent (undefined) when the precondition was satisfied — the common
 * case.
 */
export type PreFullPollDemotion = {
  from: "helping" | "hurting" | "weak_signal";
  to: "nothing_yet";
  reason: "sparse_pre_full_poll_days";
  preDaysWithFullPolls: number;
  preDaysWithFullPollsMin: number;
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
  /**
   * D4 (operator audit, 2026-05-05) — set when the sampling-status guard
   * demoted helping/hurting → nothing_yet. The materializer logs a
   * structured warning when this is present. Pure compute (no I/O).
   */
  sampling_guard_demoted?: SamplingGuardDemotion;
  /**
   * T5.2 (2026-05-06) — set when the sparse-pre-window precondition
   * demoted helping/hurting/weak_signal → nothing_yet. The materializer
   * logs a structured warning when this is present.
   */
  pre_full_poll_demoted?: PreFullPollDemotion;
};

/**
 * M3 (operator audit, 2026-05-05) — sampling-status tag for the
 * attribution guard. Mirrors the runtime values produced by
 * `classifySampling` in `src/domains/observations/poll-health.ts`:
 *
 *   "full"    ≥ 80 observations on this day (a normal-sized run)
 *   "partial" 10–79 observations
 *   "proof"   1–9 observations (manual-proof-style run)
 *   "empty"   0 observations
 *
 * String-typed (not the imported `SamplingStatus`) so this domain stays
 * decoupled from the observations domain. When omitted, the guard
 * never fires (back-compat).
 */
export type DailyPointSamplingStatus = "full" | "partial" | "proof" | "empty";

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
  /**
   * M3 (operator audit, 2026-05-05): sampling status for THIS day. The
   * verdict engine uses this to demote `helping` / `hurting` verdicts
   * when the post-window contains any `proof` day or no `full` days,
   * preventing a 5-prompt manual-proof run from creating a measured-win
   * card. When omitted on every point, the guard is a no-op (back-compat).
   */
  sampling_status?: DailyPointSamplingStatus;
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
  let baselinePoints = series.filter(
    (p) => p.date >= baselineStart && p.date <= baselineEnd,
  );

  // --- Post window: [change + 1 .. min(asOfDate, change + post_max)]
  const postStart = shiftIsoDate(change, 1);
  const postMaxEnd = shiftIsoDate(change, t.postWindowMaxDays);
  const postEnd = asOfDate < postMaxEnd ? asOfDate : postMaxEnd;
  let postPoints =
    postStart > postEnd
      ? []
      : series.filter((p) => p.date >= postStart && p.date <= postEnd);

  // ── Mixed-source handling (Phase v4 Commit 7A, 2026-04-30) ─────────
  // Replaces Commit 2's pure-split abstain. When baseline and post
  // windows mix Profound benchmark + native derived points (whether
  // pure-split or partial overlap), drop benchmark points from both
  // sides and run the normal Z-score on the derived-only series.
  // Profound stopped 2026-04-15 and native started 2026-04-22 with no
  // parallel-system overlap, so there's no calibration ratio we could
  // use to scale benchmark counts into derived units — drop is the
  // only honest move. Abstain (`not_enough_native_baseline`) only when
  // the filtered baseline is too thin to compute a verdict from.
  let benchmarkBaselineDropped = 0;
  let benchmarkPostDropped = 0;
  {
    const allBaselineTagged =
      baselinePoints.length > 0 &&
      baselinePoints.every((p) => p.source_type !== undefined);
    const allPostTagged =
      postPoints.length > 0 &&
      postPoints.every((p) => p.source_type !== undefined);
    // Back-compat: only run mix detection when BOTH windows are fully tagged.
    // If any point is untagged, fall through to the legacy Z-score path so
    // pre-source_type callers behave as before.
    if (allBaselineTagged && allPostTagged) {
      const baselineSources = new Set(
        baselinePoints
          .map((p) => p.source_type)
          .filter((s): s is DailyPointSource => s !== undefined),
      );
      const postSources = new Set(
        postPoints
          .map((p) => p.source_type)
          .filter((s): s is DailyPointSource => s !== undefined),
      );
      const baselineMixed = baselineSources.size > 1;
      const postMixed = postSources.size > 1;
      const splitAcross =
        baselineSources.size === 1 &&
        postSources.size === 1 &&
        [...baselineSources][0] !== [...postSources][0];
      if (baselineMixed || postMixed || splitAcross) {
        const filteredBaseline = baselinePoints.filter(
          (p) => p.source_type !== "benchmark",
        );
        const filteredPost = postPoints.filter(
          (p) => p.source_type !== "benchmark",
        );
        benchmarkBaselineDropped =
          baselinePoints.length - filteredBaseline.length;
        benchmarkPostDropped = postPoints.length - filteredPost.length;

        if (filteredBaseline.length < t.baselineMinDays) {
          const muPreLocal = mean(filteredBaseline.map((p) => p.count));
          const muPostLocal = mean(filteredPost.map((p) => p.count));
          return {
            verdict: "not_enough_native_baseline",
            z: null,
            delta_pct: null,
            delta_abs: null,
            post_days: filteredPost.length,
            confidence: "low",
            sustain: { up: 0, down: 0 },
            explanation: {
              summary:
                `Dropped ${benchmarkBaselineDropped} pre-cutover day(s) from baseline; ` +
                `only ${filteredBaseline.length} native day(s) remain (need ≥ ${t.baselineMinDays}). ` +
                `Not enough native baseline to judge yet.`,
              math: {
                baseline_days_used: filteredBaseline.length,
                mu_pre: round(muPreLocal, 2),
                sigma_pre_raw: 0,
                sigma_pre_used: t.poissonSigmaFloor,
                post_days_used: filteredPost.length,
                mu_post: round(muPostLocal, 2),
                z: 0,
                sustain_up: 0,
                sustain_down: 0,
              },
            },
          };
        }

        baselinePoints = filteredBaseline;
        postPoints = filteredPost;
      }
    }
  }

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
  // M3 (operator audit, 2026-05-05): apply baseline-floor guard. Below
  // the floor (default: 1.0 citations/day) the relative-% reading is
  // too noisy to publish — a 0.5/day → 6/day jump would read as
  // +1100% and overclaim causality. The renderer falls back to the
  // absolute delta ("rose from 0.5/day to 6/day"). Z-score and
  // confidence tier are unaffected.
  const deltaPctSafe =
    muPre >= t.deltaPctMinBaseline ? deltaAbs / muPre : null;

  // T5.2 (2026-05-06) — verdict-tier selection. Order:
  //   1. helping       — z >= zBar AND sustain
  //   2. hurting       — z <= -zBar AND sustain
  //   3. weak_signal   — |z| ∈ [zBarWeakSignal, zBar) AND sustain
  //   4. nothing_yet   — N >= nothingYetMinDays
  //   5. too_early     — fallback
  // The sparse-pre-window precondition (§T5.2 demotion below) demotes
  // helping / hurting / weak_signal → nothing_yet when there are too
  // few full-coverage polling days in the baseline.
  let verdict: VerdictLabel;
  if (z >= t.zBar && sustainUp >= t.sustainMin) {
    verdict = "helping";
  } else if (z <= -t.zBar && sustainDown >= t.sustainMin) {
    verdict = "hurting";
  } else if (z >= t.zBarWeakSignal && sustainUp >= t.sustainMin) {
    // audit wave-2 #11 (2026-06-14): weak_signal is a POSITIVE-only tier —
    // its locked customer copy is "Early signs of lift detected after this
    // change". The old condition (|z| >= zBarWeakSignal && (sustainUp ||
    // sustainDown)) let a DOWNWARD-trending URL (negative z + sustainDown)
    // borrow that label, rendering "early signs of lift" on a page that is
    // actually DECLINING — a false ROI claim, the exact thing the proof
    // engine's computed-vs-weak discipline exists to prevent. Require
    // positive z AND upward sustain; a weak decline now falls through to
    // nothing_yet (honest "not yet measurable"), while a STRONG decline is
    // still caught by the `hurting` tier above.
    verdict = "weak_signal";
  } else if (N >= t.nothingYetMinDays) {
    verdict = "nothing_yet";
  } else {
    verdict = "too_early";
  }

  // M3 (operator audit, 2026-05-05) — sampling-status attribution
  // guard. If ANY day in the post-change window is a `proof` day
  // (1–9 observations) OR the post-window contains zero `full` days
  // (≥80 observations), demote `helping`/`hurting` to `nothing_yet`.
  // This prevents a 5-prompt manual-proof run (e.g. May 4 incident
  // recovery) from creating a measured-win card. Back-compat: if no
  // post-window point carries `sampling_status`, the guard is a no-op.
  //
  // Operator-locked rule: "proof/partial days should not create or
  // upgrade measured-win cards."
  //
  // D4 (2026-05-05): when the guard fires, capture the demotion in
  // `samplingGuardDemotion` so the materializer can emit a structured
  // observability log (tenant + change + reason + before/after).
  let samplingGuardDemotion: SamplingGuardDemotion | undefined;
  if (verdict === "helping" || verdict === "hurting") {
    const originalVerdict = verdict;
    const taggedPost = postPoints.filter(
      (p) => typeof p.sampling_status === "string",
    );
    if (taggedPost.length > 0) {
      const hasProofDay = taggedPost.some(
        (p) => p.sampling_status === "proof",
      );
      const hasFullDay = taggedPost.some(
        (p) => p.sampling_status === "full",
      );
      if (hasProofDay || !hasFullDay) {
        samplingGuardDemotion = {
          from: originalVerdict,
          to: "nothing_yet",
          reason: hasProofDay
            ? "proof_day_in_post_window"
            : "no_full_days_in_post_window",
        };
        verdict = "nothing_yet";
      }
    }
  }

  // T5.2 (2026-05-06) — sparse-pre-window precondition. When the
  // pre-change baseline has fewer than `preDaysWithFullPollsMin`
  // full-coverage polling days (≥80 obs OR sampling_status==='full'),
  // demote `helping` / `hurting` / `weak_signal` → `nothing_yet`.
  //
  // Closes the Phase 3.B placebo-2 false-positive class: sparse pre-
  // windows + sigma_floor=1.0 produce structurally inflated z-scores
  // (e.g. mu_pre on 2 partial-poll days → sigma floor activates → any
  // moderate post-window shift reads as "high z, real lift" when it's
  // actually noise).
  //
  // Back-compat: when NO baseline point carries `sampling_status`, we
  // count every baseline day as "full" so the precondition is a no-op.
  // Existing fixtures + tests that don't tag sampling status keep their
  // previous semantics.
  let preFullPollDemotion: PreFullPollDemotion | undefined;
  if (verdict === "helping" || verdict === "hurting" || verdict === "weak_signal") {
    const originalVerdict = verdict;
    const taggedBaseline = baselinePoints.filter(
      (p) => typeof p.sampling_status === "string",
    );
    let preDaysWithFullPolls: number;
    if (taggedBaseline.length === 0) {
      // Back-compat: no sampling tags → count all baseline days as full.
      preDaysWithFullPolls = baselinePoints.length;
    } else {
      preDaysWithFullPolls = baselinePoints.filter(
        (p) => p.sampling_status === "full",
      ).length;
    }
    if (preDaysWithFullPolls < t.preDaysWithFullPollsMin) {
      preFullPollDemotion = {
        from: originalVerdict,
        to: "nothing_yet",
        reason: "sparse_pre_full_poll_days",
        preDaysWithFullPolls,
        preDaysWithFullPollsMin: t.preDaysWithFullPollsMin,
      };
      verdict = "nothing_yet";
    }
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
    delta_pct: N > 0 ? deltaPctSafe : null,
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
    sampling_guard_demoted: samplingGuardDemotion,
    pre_full_poll_demoted: preFullPollDemotion,
  };
}

function round(n: number, digits: number): number {
  const f = Math.pow(10, digits);
  return Math.round(n * f) / f;
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
    case "weak_signal":
      // T5.2 (2026-05-06) — directional language only. Customer-safe
      // phrasing: "Early signs of lift" / "Not yet a strong signal".
      // NEVER say "worked" / "proven" / "win" / "confirmed lift".
      return `Early signs of lift — ${pre}, ${post}. z=${zStr} is below the ±2 strong-signal bar but above the ±1.2 directional bar. Not yet a strong signal; watch the post-change window over the next few days.`;
    case "nothing_yet":
      return `No meaningful movement — ${pre}, ${post}. z=${zStr} (below ±2 significance bar).`;
    case "too_early":
      if (N === 0) return `Change too recent — no post-change days yet.`;
      return `Too early — only ${N}d of post-change data. ${pre}, ${post}, z=${zStr} so far.`;
    case "not_enough_data":
      return `Not enough baseline data before the change to judge.`;
    case "not_enough_native_baseline":
      // Generated inline at the mixed-source filter above (carries richer
      // context including how many pre-cutover days were dropped). This
      // branch is for type exhaustiveness only.
      return `Not enough native data yet to judge.`;
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
  // T5.2 (2026-05-06) — customer-safe directional label. NEVER "Win" /
  // "Proof" / "Confirmed". Operator-locked at the SYSTEM_PROMPT level
  // for every consumer (lifecycle copy + status pill + provenance).
  weak_signal: "Early signs of lift",
  nothing_yet: "Nothing yet",
  too_early: "Too early",
  not_enough_data: "No baseline",
  not_enough_native_baseline: "Not enough native data yet",
  not_implemented: "Not implemented",
};

export const VERDICT_TONE: Record<VerdictLabel, "success" | "danger" | "muted" | "neutral"> = {
  helping: "success",
  hurting: "danger",
  // T5.2 — yellow / amber band; visually distinct from helping (success).
  weak_signal: "neutral",
  nothing_yet: "muted",
  too_early: "neutral",
  not_enough_data: "muted",
  not_enough_native_baseline: "neutral",
  not_implemented: "muted",
};
