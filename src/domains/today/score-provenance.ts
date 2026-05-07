/**
 * Score provenance for /today — Trust Sprint Mini-Phase T3.1 (2026-05-06).
 *
 * Pure data contract. Zero I/O. Every score on /today must be explainable
 * by one of the builders below. The builder takes the same inputs the
 * rendering component uses and returns a structured `ScoreProvenance`
 * object that:
 *
 *   - names where the number came from (source store, in operator-friendly
 *     language; raw table names live only in `operatorDetail` for debug);
 *   - names what got divided by what (numerator / denominator);
 *   - names the date window;
 *   - states whether partial-poll days affect it;
 *   - states whether historical/imported data can influence it;
 *   - states a trust level the operator can read at a glance.
 *
 * Trust-level rules (locked from the Trust Sprint synthesis 2026-05-06):
 *
 *   trustworthy  → audit verified: math sound on stationary native-only
 *                  data with explicit guards; UI labels it "TRUSTWORTHY".
 *                  Examples: prompt category "early" (≥3 obs floor),
 *                  prompt category "winning" (≥3 obs / platform AND
 *                  primary_rate >= 0.5).
 *
 *   directional  → math defensible but with at least one structural
 *                  caveat that prevents calling it strictly accurate.
 *                  UI labels it "DIRECTIONAL" with the specific caveat.
 *                  Examples: composite visibility (no sampling gate;
 *                  mixes native + historical_recovered), mentions /
 *                  citations tile (silent fallback to all-time `results`),
 *                  ChatGPT/Perplexity primary % (latest sampled day, not
 *                  window average), competitor leaderboard (brand vs
 *                  competitor formula asymmetry).
 *
 *   unreliable   → audit flagged the number as misleading; UI labels it
 *                  "UNRELIABLE" or suppresses confident claims. Example:
 *                  Share Capture banner (coincidence detector marketed
 *                  as causal).
 *
 * **Honesty contract:** do NOT cosmetically rebrand uncertainty as
 * confidence. If a builder returns `directional`, the UI MUST show that
 * label; if `unreliable`, the UI MUST either hide or de-confidence the
 * number. Rebranding is a regression — the architecture invariants in
 * `tests/architecture/score-provenance-trust-labels.test.ts` enforce
 * this.
 */

export type ScoreTrustLevel = "trustworthy" | "directional" | "unreliable";

export type ScoreProvenance = {
  /** Stable id for `data-score-id="…"` attribute on the disclosure. */
  id: string;
  /** Operator-facing label, e.g. "Overall visibility (14-day)". */
  label: string;
  /** Operator-facing value as it appears next to the disclosure trigger, e.g. "23.4%". */
  valueLabel: string;
  trustLevel: ScoreTrustLevel;
  /** Customer-safe source description. NEVER includes raw table names. */
  sourceLabel: string;
  /** Operator-only debug detail; raw table names live here, hidden by default. */
  operatorDetail: string;
  /** Customer-safe date-window phrase, e.g. "Last 14 days". */
  dateWindow: string;
  /** What was counted, in customer-safe language. */
  platformRule: string;
  /** Customer-safe numerator phrase. */
  numeratorLabel: string;
  numeratorValue?: number | null;
  /** Customer-safe denominator phrase. */
  denominatorLabel: string;
  denominatorValue?: number | null;
  /** Sampling status if relevant ("full" | "partial" | "proof" | "empty"). */
  samplingStatus?: string | null;
  includesPartialDays: boolean;
  includesImportedData: boolean;
  /**
   * Customer-safe caveats. Each one is a complete sentence the operator
   * can read on its own. e.g. "Latest sampled day was partial (99/100
   * ChatGPT prompts)."
   */
  caveats: string[];
  /**
   * One-line plain-English summary, suitable for the disclosure header
   * row. Should naturally include the trust label, e.g. "Directional —
   * one sampled day was partial."
   */
  plainEnglish: string;
};

// ─────────────────────────────────────────────────────────────────────────
// 1. Overall visibility (chart headline)
// ─────────────────────────────────────────────────────────────────────────

export type OverallVisibilityInputs = {
  /** Window-relative composite score the chart is rendering, e.g. 23.4. */
  scorePct: number | null;
  /** 7 | 14 | 30 | 60. */
  windowDays: number;
  /** Whether the window touches any pre-NATIVE_REGIME_START dates. */
  windowTouchesPreCutover: boolean;
  /** Whether any sampled day in the window had partial coverage (10–79 obs). */
  hasPartialDays: boolean;
  /** Whether any sampled day in the window had proof-only coverage (1–9 obs). */
  hasProofDays: boolean;
};

export function buildOverallVisibilityProvenance(
  input: OverallVisibilityInputs,
): ScoreProvenance {
  const caveats: string[] = [];
  if (input.hasProofDays) {
    caveats.push("At least one sampled day had only a small proof-run sample (1–9 prompts).");
  }
  if (input.hasPartialDays) {
    caveats.push("At least one sampled day had partial coverage (10–79 of 100 prompts).");
  }
  if (input.windowTouchesPreCutover) {
    caveats.push(
      "Window includes dates before native AI polling began on Apr 22, 2026 — those days were re-derived from the historical data import.",
    );
  }
  caveats.push(
    "The chart treats all sampled days equally — partial days are not down-weighted.",
  );

  return {
    id: "overall-visibility",
    label: `Overall visibility (${input.windowDays}-day)`,
    valueLabel: input.scorePct == null ? "—" : `${input.scorePct.toFixed(1)}%`,
    trustLevel: "directional",
    sourceLabel: "Native AI answer observations from your tracked prompts",
    operatorDetail:
      "src/domains/product/visibility-score.ts → computeVisibilityTimeSeries (metric=composite). Reads prompt_answer_observations via tenantRepo.getPromptAnswerObservations.",
    dateWindow: `Last ${input.windowDays} days`,
    platformRule: "All sampled platforms (ChatGPT, Perplexity, etc.), averaged equally",
    numeratorLabel: "Days where you were cited (averaged across platforms)",
    denominatorLabel: "Total sampled prompts in window",
    samplingStatus: input.hasProofDays
      ? "proof"
      : input.hasPartialDays
        ? "partial"
        : "full",
    includesPartialDays: input.hasPartialDays || input.hasProofDays,
    includesImportedData: input.windowTouchesPreCutover,
    caveats,
    plainEnglish:
      "Directional — the chart counts every sampled day equally, so partial-coverage days can pull the line up or down without a weighting correction.",
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 2. Mentions count (KPI tile)
// ─────────────────────────────────────────────────────────────────────────

export type MentionsTileInputs = {
  /** The displayed mention count. */
  value: number | null;
  /** Whether the count came from the `daily_metric_snapshots` derived rows. */
  derivedKpiAvailable: boolean;
  /** ISO date the derived row applies to (today or yesterday). null when fallback. */
  asOfDate: string | null;
  /** True when asOfDate fell back to yesterday's row. */
  isFallback: boolean;
  /** Sampling status of the as-of-date sample. */
  samplingStatus?: "full" | "partial" | "proof" | "empty" | null;
};

export function buildMentionsTileProvenance(
  input: MentionsTileInputs,
): ScoreProvenance {
  const caveats: string[] = [];
  if (!input.derivedKpiAvailable) {
    caveats.push(
      "No daily snapshot available for today — the tile is showing a cumulative cross-time total instead of a single-day count. Day-over-day comparisons are not meaningful.",
    );
  }
  if (input.isFallback) {
    caveats.push("Today's poll hasn't run yet — showing yesterday's total.");
  }
  if (input.samplingStatus === "partial") {
    caveats.push("Today's sample was partial (under 80 prompts).");
  } else if (input.samplingStatus === "proof") {
    caveats.push("Today's sample was a proof-run only (1–9 prompts).");
  } else if (input.samplingStatus === "empty") {
    caveats.push("Today's sample was empty.");
  }

  // Trust level: directional. Even when derived KPI is available, the
  // tile shows a single-day snapshot (latest), so it can swing day to day
  // on partial-coverage days. The audit found a silent fallback to all-time
  // results when the derived row is missing — that's a separate hazard
  // we surface as a caveat above.
  return {
    id: "mentions-tile",
    label: "Times AI mentioned you (tile)",
    valueLabel: input.value == null ? "—" : input.value.toLocaleString("en-US"),
    trustLevel: "directional",
    sourceLabel: input.derivedKpiAvailable
      ? "Today's native AI answer poll"
      : "Cumulative all-time mentions across all polls",
    operatorDetail: input.derivedKpiAvailable
      ? "src/domains/today/today-kpis.ts → fetchTodayDerivedKpis. Reads daily_metric_snapshots WHERE source_type='derived' AND scope_type='platform' AND date=today."
      : "src/app/(shell)/today-data.ts:1413-1415 → visibilitySummary.totalMentions fallback. Reads ALL `results` rows with no date filter (cumulative, all-time).",
    dateWindow: input.derivedKpiAvailable && input.asOfDate
      ? `As of ${input.asOfDate}${input.isFallback ? " (yesterday)" : " (today)"}`
      : "Cumulative across all polls",
    platformRule: "All platforms, summed",
    numeratorLabel: "Mention count from the derived daily row",
    denominatorLabel: "(raw count, no denominator)",
    samplingStatus: input.samplingStatus ?? null,
    includesPartialDays: input.samplingStatus === "partial" || input.samplingStatus === "proof",
    includesImportedData: !input.derivedKpiAvailable,
    caveats,
    plainEnglish: input.derivedKpiAvailable
      ? "Directional — single-day count; varies with daily sample size."
      : "Directional — fallback path. Showing cumulative totals across all time, not today's count.",
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 3. Citations count (KPI tile) — same shape as Mentions
// ─────────────────────────────────────────────────────────────────────────

export type CitationsTileInputs = MentionsTileInputs;

export function buildCitationsTileProvenance(
  input: CitationsTileInputs,
): ScoreProvenance {
  const base = buildMentionsTileProvenance(input);
  return {
    ...base,
    id: "citations-tile",
    label: "Times AI cited you (tile)",
    operatorDetail: input.derivedKpiAvailable
      ? "src/domains/today/today-kpis.ts → fetchTodayDerivedKpis. Sums citation_count across the derived daily snapshot rows."
      : "src/app/(shell)/today-data.ts:625 → visibilitySummary.totalCitations fallback. Sums citation_count across ALL `results` rows (cumulative, all-time).",
    numeratorLabel: "Citation count from the derived daily row",
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 4. Per-platform primary % (ChatGPT / Perplexity)
// ─────────────────────────────────────────────────────────────────────────

export type PrimaryRateInputs = {
  /** "ChatGPT" | "Perplexity" | etc — operator-facing label. */
  platformLabel: string;
  /** Latest sampled-day primary rate, 0–1. */
  latestRate: number | null;
  /** Number of observations on the latest sampled day. */
  latestDayObsCount: number | null;
  /** Window the sparkline covers (days). */
  windowDays: number;
  /** "thin" | "enough" | "empty" — copy hint already on the rendering side. */
  sampleStatus: "thin" | "enough" | "empty";
};

export function buildPrimaryRateProvenance(
  input: PrimaryRateInputs,
): ScoreProvenance {
  const caveats: string[] = [];
  caveats.push(
    "This number is the primary-recommendation rate from the LATEST sampled day in the window — not an average across the whole window.",
  );
  if (input.sampleStatus === "thin") {
    caveats.push(
      "Sample size is thin — the latest day's rate is more volatile than a multi-day average would be.",
    );
  }
  if (input.latestDayObsCount != null && input.latestDayObsCount < 100) {
    if (input.latestDayObsCount < 80) {
      caveats.push(
        `The latest sampled day had ${input.latestDayObsCount} observations (below the 80-prompt full-day threshold).`,
      );
    } else {
      caveats.push(
        `The latest sampled day had ${input.latestDayObsCount} of 100 prompts — partial coverage even though it clears the 80-prompt full-day threshold.`,
      );
    }
  }

  return {
    id: `primary-rate-${input.platformLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    label: `${input.platformLabel} primary recommendation rate`,
    valueLabel:
      input.latestRate == null
        ? "—"
        : `${Math.round(input.latestRate * 100)}%`,
    trustLevel: "directional",
    sourceLabel: `${input.platformLabel} native poll observations from the latest sampled day`,
    operatorDetail:
      "src/domains/prompt-answer-observations/enrichment-rollup.ts → buildPlatformPrimaryRateSparklines. Latest sampled day's primary_rate is displayed; sparkline points are averaged daily but the headline number is single-day.",
    dateWindow: `Latest sampled day in last ${input.windowDays} days`,
    platformRule: `${input.platformLabel} only`,
    numeratorLabel: `${input.platformLabel} answers where you were named the primary recommendation`,
    denominatorLabel: `${input.platformLabel} prompts sampled on the latest day`,
    denominatorValue: input.latestDayObsCount ?? null,
    samplingStatus:
      input.latestDayObsCount == null
        ? null
        : input.latestDayObsCount >= 80
          ? "full"
          : input.latestDayObsCount >= 10
            ? "partial"
            : input.latestDayObsCount >= 1
              ? "proof"
              : "empty",
    includesPartialDays:
      input.latestDayObsCount != null && input.latestDayObsCount < 80,
    includesImportedData: false,
    caveats,
    plainEnglish:
      "Directional — single-day rate, not a window average. Small samples can swing the percentage.",
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 5. Competitor leaderboard score (per-row "share-of-voice")
// ─────────────────────────────────────────────────────────────────────────

export type CompetitorLeaderboardInputs = {
  /** Window the leaderboard is computed over. */
  windowDays: number;
  /** Whether the window touches pre-cutover Profound-era dates. */
  windowTouchesPreCutover: boolean;
  /** Number of competitor entities ranked (after entity-pollution-filter). */
  rowCount: number;
};

export function buildCompetitorLeaderboardProvenance(
  input: CompetitorLeaderboardInputs,
): ScoreProvenance {
  const caveats: string[] = [
    // The audit's #1 finding here.
    "Your row uses a composite score (mentions + position-weighted citations); competitor rows use a flat mention rate. The numbers are not strictly comparable across rows.",
    "Directories like Houzz, Yelp, BBB are filtered out of the rank list, but their citations still count toward the window denominator.",
  ];
  if (input.windowTouchesPreCutover) {
    caveats.push(
      "Window includes dates before native AI polling began on Apr 22, 2026 — those rows mix re-derived historical data with native-poll data.",
    );
  }

  return {
    id: "competitor-leaderboard",
    label: `Competitor leaderboard (${input.windowDays}-day)`,
    valueLabel: `${input.rowCount} ranked entities`,
    trustLevel: "directional",
    sourceLabel: "Co-mention rate across your tracked prompts in the window",
    operatorDetail:
      "src/domains/product/visibility-score.ts → aggregateWindow + computeLeaderboard. Filtered through entity-pollution-filter (no Houzz/Yelp/etc). Brand row uses composite(mentionRate, citationRate); competitor rows use flat count/total*100.",
    dateWindow: `Last ${input.windowDays} days`,
    platformRule: "All platforms, summed across the window",
    numeratorLabel: "Observations where the entity was mentioned",
    denominatorLabel: "Total observations in window (all platforms)",
    includesPartialDays: true,
    includesImportedData: input.windowTouchesPreCutover,
    caveats,
    plainEnglish:
      "Directional — your row and competitor rows are computed with different formulas, so ranks are reliable but absolute percentages are not strictly comparable.",
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 6. Prompt category counts (winning / weak / close / outranked / early)
// ─────────────────────────────────────────────────────────────────────────

export type PromptCategoryInputs = {
  category: "winning" | "absent" | "close" | "outranked" | "early";
  count: number;
  lookbackDays: number;
};

export function buildPromptCategoryProvenance(
  input: PromptCategoryInputs,
): ScoreProvenance {
  const trustLevel: ScoreTrustLevel =
    input.category === "early" || input.category === "winning"
      ? "trustworthy"
      : "directional";

  const platformRule =
    input.category === "winning"
      ? "Per platform — at least one platform with primary_rate ≥ 50% on ≥3 observations"
      : input.category === "early"
        ? "Per prompt — fewer than 3 observations across all platforms"
        : "Per prompt — aggregated across all platforms";

  const caveats: string[] = [];
  switch (input.category) {
    case "winning":
      caveats.push(
        "Requires at least 3 observations on at least one platform AND primary_rate ≥ 50% on that platform.",
      );
      break;
    case "early":
      caveats.push(
        "Prompts with fewer than 3 native-poll observations are always classified Early — regardless of the answers themselves.",
      );
      break;
    case "outranked":
      caveats.push(
        "Counts prompts where competitors were mentioned but you weren't. The competitor list isn't filtered for directories — a mistakenly-tagged directory could trip this.",
      );
      break;
    case "absent":
      caveats.push(
        "Counts prompts where you weren't cited at all in the window. Includes new prompts that simply haven't accumulated observations yet.",
      );
      break;
    case "close":
      caveats.push(
        "Counts prompts where you were mentioned but never the primary recommendation. Promotion to Winning depends on primary-rate clearing 50%.",
      );
      break;
  }

  const labelMap: Record<PromptCategoryInputs["category"], string> = {
    winning: "Winning prompts",
    absent: "Absent prompts",
    close: "Close prompts",
    outranked: "Outranked prompts",
    early: "Early prompts (warming up)",
  };

  return {
    id: `prompt-category-${input.category}`,
    label: labelMap[input.category],
    valueLabel: input.count.toLocaleString("en-US"),
    trustLevel,
    sourceLabel: "Native AI answer observations on your tracked prompts",
    operatorDetail:
      "src/domains/prompts/opportunity-classify.ts → classifyPromptOpportunity. Lookback window clamped forward to NATIVE_REGIME_START so pre-cutover Profound data is excluded. minObservationsForCategory=3 floor.",
    dateWindow: `Last ${input.lookbackDays} days (pre-cutover dates excluded)`,
    platformRule,
    numeratorLabel: "Prompts in this category",
    numeratorValue: input.count,
    denominatorLabel: "Active tracked prompts",
    includesPartialDays: false, // classifier counts observations, not days
    includesImportedData: false,
    caveats,
    plainEnglish:
      trustLevel === "trustworthy"
        ? "Trustworthy — the classifier requires at least 3 native observations and excludes pre-cutover historical data."
        : "Directional — the count depends on how the classifier handles competitor co-mentions and absence; partial-coverage days can shift category boundaries.",
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 7. Share-capture banner — UNRELIABLE per audit
// ─────────────────────────────────────────────────────────────────────────

export type ShareCaptureInputs = {
  visible: boolean;
};

export function buildShareCaptureProvenance(
  input: ShareCaptureInputs,
): ScoreProvenance {
  return {
    id: "share-capture-banner",
    label: "Share-capture banner",
    valueLabel: input.visible ? "(banner shown)" : "(banner hidden)",
    trustLevel: "unreliable",
    sourceLabel: "Co-incidence: your row went up while at least one of the top-5 competitors went down",
    operatorDetail:
      "src/components/today/visibility-leaderboard.tsx:50,56 — brand delta > 0.5pp AND ≥1 top-5 competitor delta < −0.5pp. Hardcoded threshold; no causal verification of mention redistribution.",
    dateWindow: "Inherits from leaderboard window (default 14 days)",
    platformRule: "All platforms",
    numeratorLabel: "Brand delta in window (composite, position-weighted)",
    denominatorLabel: "(coincidence test, no denominator)",
    includesPartialDays: true,
    includesImportedData: false,
    caveats: [
      "Math is a coincidence test — the banner does NOT verify that mentions were redistributed from a competitor to you.",
      "Brand delta and competitor delta are computed with different formulas, so the comparison isn't dimensionally equal.",
      "The banner should be read as a leading signal worth investigating, not a causal claim.",
    ],
    plainEnglish:
      "Unreliable — the banner copy implies a causal relationship that the math does not check.",
  };
}
