/**
 * Pure aggregator that rolls up per-observation schema v2 + v2.1 extraction
 * signal into a single Today-surface summary. Consumed by
 * src/components/today/enrichment-badges.tsx (Commit 7C, 2026-04-24).
 *
 * Input: today's UTC-date observations + the brand name.
 * Output: per-platform primary-recommendation rate, average citation rank,
 *         top descriptors, answer-structure breakdown.
 *
 * Pure: no I/O, no side effects. Testable without a DB.
 */

import type { PromptAnswerObservation } from "./types";
import type { TrackedEntity } from "@/domains/tracked-entities/types";
import { makeCompetitorRankingFilter } from "@/domains/recommendations/entity-pollution-filter";
import { DESCRIPTOR_QUALITY_STOPWORDS } from "./extraction";

/**
 * T1 (operator audit, 2026-05-05) — runtime descriptor quality filter.
 *
 * Builds a Set of stopwords combining the hard-global filter (industry
 * nouns, URL noise, temporal, generic-quality words) with the tenant's
 * business-config `stripWords` (city names, brand parts). Used by every
 * rollup that emits operator-visible descriptors so legacy
 * `descriptor_window` tokens never resurface as top-of-cloud filler.
 *
 * Pure / deterministic. Lowercase + trim normalization on input.
 */
function buildDescriptorRejectSet(
  tenantStripWords: ReadonlyArray<string> | undefined,
): Set<string> {
  const out = new Set<string>(DESCRIPTOR_QUALITY_STOPWORDS);
  if (tenantStripWords) {
    for (const w of tenantStripWords) {
      if (typeof w !== "string") continue;
      const norm = w.trim().toLowerCase();
      if (norm.length > 0) out.add(norm);
    }
  }
  return out;
}

/**
 * T1 — minimum descriptor count threshold below which the rollup is
 * considered too thin to render. Operator brief: "If fewer than 3
 * useful descriptors remain, show: 'Not enough distinctive description
 * signal yet.'" Exported so the UI can branch on the same threshold.
 */
export const MIN_USEFUL_DESCRIPTORS = 3;

/**
 * Bug-2 fix (2026-05-04): canonicalize platform values before using
 * them as Map keys.
 *
 * Native polls (Apr 22+) store `o.platform` lowercase ("chatgpt",
 * "perplexity"). W4 historical_recovered observations (Mar 5–Apr 21)
 * carry the capitalized display variant ("ChatGPT", "Perplexity",
 * "Google AI Overviews"). Without canonicalization, the rollup keys
 * "chatgpt" and "ChatGPT" into separate buckets — surfacing as
 * duplicate rows in /today's "Where AI ranks you", "What format
 * wins", and per-platform enrichment.
 *
 * The returned key matches the lowercase forms in
 * `src/lib/structure-labels.ts::PLATFORM_LABEL` so the UI label
 * lookup keeps working without changes.
 */
export function canonicalizePlatform(
  raw: string | null | undefined,
): string {
  if (!raw) return "unknown";
  const lower = raw.trim().toLowerCase();
  if (lower === "chatgpt" || lower === "openai") return "chatgpt";
  if (lower === "perplexity") return "perplexity";
  if (
    lower === "google ai overviews" ||
    lower === "google-ai-overviews" ||
    lower === "google_ai_overviews" ||
    lower === "google_aio" ||
    lower === "aio"
  ) {
    return "google_aio";
  }
  if (lower === "claude") return "claude";
  return lower; // fallback: whatever the data contains, lowercased
}

export type PlatformEnrichmentRollup = {
  platform: string;
  observations: number;
  /** # of observations where primary_recommendation=true. */
  primaryCount: number;
  /** primaryCount / observations, rounded to 2 decimals. Null when no obs. */
  primaryRate: number | null;
  /** # of observations where brand was cited (citation_rank non-null). */
  citedCount: number;
  /** Mean citation_rank across cited observations, rounded to 1 decimal.
   *  Null when no cited observations (rank is the position-in-list, so
   *  lower is better — "average rank 2.3" means the brand's citation is
   *  usually the 2nd or 3rd source). */
  avgCitationRank: number | null;
};

export type AnswerStructureRollup = {
  structure: string;
  count: number;
};

export type EnrichmentRollup = {
  /** ISO date (YYYY-MM-DD) the rollup represents. */
  date: string;
  /** Total brand-relevant observations on `date`. */
  totalObservations: number;
  /** Per-platform rollup (order = alphabetical, lowest-first for stable render). */
  byPlatform: PlatformEnrichmentRollup[];
  /**
   * Top `descriptor_window` tokens across all observations on `date`,
   * ordered by frequency (descending) and truncated to `maxDescriptors`.
   * Each token is lowercased; the same token across different observations
   * is summed. Primarily useful for a tag cloud.
   */
  topDescriptors: Array<{ word: string; count: number }>;
  /** Answer-structure breakdown — counts of each enum value seen. */
  answerStructures: AnswerStructureRollup[];
  /** Number of observations whose descriptor_window carried at least 1 token. */
  observationsWithDescriptors: number;
};

export type BuildEnrichmentRollupInput = {
  observations: ReadonlyArray<PromptAnswerObservation>;
  /** ISO date (YYYY-MM-DD). Only obs whose observed_at starts with this are used. */
  date: string;
  /** Max entries in `topDescriptors`. Defaults to 12. */
  maxDescriptors?: number;
  /**
   * T1 (operator audit, 2026-05-05) — runtime descriptor quality filter.
   *
   * Pre-W4 observations carry `descriptor_window` tokens that were
   * extracted before the latest stopword additions (custom/home/
   * builder/closed/area/etc.). Re-extracting every observation is
   * expensive; instead we apply the SAME stopword filter at rollup
   * time so /today renders clean even on legacy data.
   *
   * The filter is the union of:
   *   • The hard-global `DESCRIPTOR_QUALITY_STOPWORDS` set (industry-
   *     noun, temporal, URL-noise, generic-quality) — applied
   *     unconditionally.
   *   • The tenant's business-config `stripWords` (Bay-Area cities,
   *     brand parts) — passed in via `tenantStripWords`.
   *
   * When undefined or empty, only the global stopword set fires. In
   * tests, callers often pass `[]` to verify the global path works.
   */
  tenantStripWords?: ReadonlyArray<string>;
};

export function buildEnrichmentRollup(
  input: BuildEnrichmentRollupInput,
): EnrichmentRollup {
  const maxDescriptors = input.maxDescriptors ?? 12;
  // T1 — runtime stopword filter. Even if extraction-time filtering
  // missed a token (legacy obs), it gets dropped here.
  const rejectSet = buildDescriptorRejectSet(input.tenantStripWords);

  // Filter to the target date.
  const relevant = input.observations.filter((o) =>
    typeof o.observed_at === "string" && o.observed_at.startsWith(input.date),
  );

  // Aggregate per platform.
  const byPlatformMap = new Map<
    string,
    {
      observations: number;
      primaryCount: number;
      citedCount: number;
      citationRankSum: number;
    }
  >();
  for (const o of relevant) {
    // Bug-2 fix: canonicalize so "chatgpt" + "ChatGPT" share one bucket.
    const key = canonicalizePlatform(o.platform);
    let entry = byPlatformMap.get(key);
    if (!entry) {
      entry = {
        observations: 0,
        primaryCount: 0,
        citedCount: 0,
        citationRankSum: 0,
      };
      byPlatformMap.set(key, entry);
    }
    entry.observations += 1;
    if (o.primary_recommendation === true) entry.primaryCount += 1;
    if (typeof o.citation_rank === "number") {
      entry.citedCount += 1;
      entry.citationRankSum += o.citation_rank;
    }
  }

  const byPlatform: PlatformEnrichmentRollup[] = [...byPlatformMap.entries()]
    .map(([platform, e]) => ({
      platform,
      observations: e.observations,
      primaryCount: e.primaryCount,
      primaryRate:
        e.observations > 0
          ? Math.round((e.primaryCount / e.observations) * 100) / 100
          : null,
      citedCount: e.citedCount,
      avgCitationRank:
        e.citedCount > 0
          ? Math.round((e.citationRankSum / e.citedCount) * 10) / 10
          : null,
    }))
    .sort((a, b) => a.platform.localeCompare(b.platform));

  // Aggregate descriptors across all observations. T1 — apply the
  // runtime quality filter (`rejectSet`) per token. Tokens that match
  // are dropped silently; the observation still counts as
  // "had descriptors" for sample-size accounting.
  const descriptorCounts = new Map<string, number>();
  let obsWithDescriptors = 0;
  for (const o of relevant) {
    const tokens = o.descriptor_window ?? [];
    if (tokens.length > 0) obsWithDescriptors += 1;
    // Dedup within one observation (so a single answer that repeats a
    // descriptor doesn't get it counted twice in the cloud).
    const seen = new Set<string>();
    for (const token of tokens) {
      if (!token || seen.has(token)) continue;
      seen.add(token);
      const lower = token.toLowerCase();
      if (rejectSet.has(lower)) continue;
      descriptorCounts.set(token, (descriptorCounts.get(token) ?? 0) + 1);
    }
  }
  const topDescriptors = [...descriptorCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, maxDescriptors)
    .map(([word, count]) => ({ word, count }));

  // Aggregate answer structures.
  const structureCounts = new Map<string, number>();
  for (const o of relevant) {
    const s = o.answer_structure;
    if (!s) continue;
    structureCounts.set(s, (structureCounts.get(s) ?? 0) + 1);
  }
  const answerStructures: AnswerStructureRollup[] = [
    ...structureCounts.entries(),
  ]
    .map(([structure, count]) => ({ structure, count }))
    .sort((a, b) => b.count - a.count);

  return {
    date: input.date,
    totalObservations: relevant.length,
    byPlatform,
    topDescriptors,
    answerStructures,
    observationsWithDescriptors: obsWithDescriptors,
  };
}

// ---------------------------------------------------------------------------
// W2 Step 2.2b — sample-status thresholds (shared across rollups)
// ---------------------------------------------------------------------------

/**
 * Classifies a sample-count integer for UI render decisions. The v2
 * layout doesn't HIDE thin data — it just softens the copy ("a few
 * observations so far" vs "based on N answers"). The operator can
 * still see what AI said; the UI just stops promising precision it
 * doesn't have.
 */
export type SampleStatus = "empty" | "thin" | "enough";

/** Threshold for "thin" → "enough" classification. Tuned at 10 obs:
 *  with daily polling, that's roughly half a day on one platform — the
 *  point at which descriptor-cloud / format-mix distributions stop
 *  being noisy. */
const SAMPLE_ENOUGH_MIN = 10;

function classifySample(observationCount: number): SampleStatus {
  if (observationCount <= 0) return "empty";
  if (observationCount < SAMPLE_ENOUGH_MIN) return "thin";
  return "enough";
}

// ---------------------------------------------------------------------------
// W2 Step 2.2 — windowed rollups for "How AI Described You" v2
// ---------------------------------------------------------------------------

/** UTC-safe `subtractDays`. Returns YYYY-MM-DD. */
function subtractDaysIso(date: string, n: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/** True when the observation's observed_at date falls inside [startDate, endDate] inclusive. */
function inWindow(o: PromptAnswerObservation, startDate: string, endDate: string): boolean {
  const obsDate =
    typeof o.observed_at === "string" ? o.observed_at.slice(0, 10) : null;
  if (!obsDate) return false;
  return obsDate >= startDate && obsDate <= endDate;
}

/**
 * Per-descriptor entry with rank delta vs the prior equal-length window.
 * `delta = priorRank - rankThisWindow` (positive = moved up the leaderboard).
 * `rankPriorWindow` and `delta` are null when the descriptor wasn't in the
 * prior window's top-N or the prior window has no observations.
 */
export type DescriptorWithDelta = {
  word: string;
  count: number;
  rankThisWindow: number;
  rankPriorWindow: number | null;
  delta: number | null;
};

/**
 * Rolls up a descriptor cloud across a calendar-day window AND adds prior-
 * window rank deltas so the v2 UI can render "↑3 / ↓2 / —" arrows next to
 * each descriptor. Uses `descriptor_window` (the BRAND'S tokens). For the
 * competitor column, see `buildCompetitorEnrichmentRollup`.
 */
export type EnrichmentWindowRollup = {
  windowEndDate: string;
  windowDays: number;
  currentWindow: EnrichmentRollup;
  /** Sampled-day count in the current window. */
  currentSampledDays: number;
  /** Sampled-day count in the prior equal-length window. */
  priorSampledDays: number;
  /** Top descriptors with rank-delta-vs-prior-window. Length ≤ maxDescriptors. */
  topDescriptorsWithDelta: DescriptorWithDelta[];
  /**
   * W2 Step 2.2b — observation-count classification ("empty" / "thin" /
   * "enough") so the UI can soften copy when the descriptor cloud is
   * built from a small sample. Counted from observations whose
   * `descriptor_window` had ≥1 token (i.e. brand was actually mentioned).
   */
  sampleStatus: SampleStatus;
};

export type BuildEnrichmentWindowRollupInput = {
  observations: ReadonlyArray<PromptAnswerObservation>;
  /** End of the current window (inclusive), YYYY-MM-DD. */
  endDate: string;
  windowDays?: number; // default 7
  maxDescriptors?: number; // default 5
  /**
   * T1 (operator audit, 2026-05-05) — tenant-config stripWords passed
   * through to the inner `buildEnrichmentRollup` calls so the brand
   * window AND the prior-window rank deltas use the SAME quality
   * filter. See `BuildEnrichmentRollupInput.tenantStripWords`.
   */
  tenantStripWords?: ReadonlyArray<string>;
};

export function buildEnrichmentWindowRollup(
  input: BuildEnrichmentWindowRollupInput,
): EnrichmentWindowRollup {
  const windowDays = input.windowDays ?? 7;
  const maxDescriptors = input.maxDescriptors ?? 5;
  const tenantStripWords = input.tenantStripWords;
  const rejectSet = buildDescriptorRejectSet(tenantStripWords);

  const startDate = subtractDaysIso(input.endDate, windowDays - 1);
  const priorEndDate = subtractDaysIso(input.endDate, windowDays);
  const priorStartDate = subtractDaysIso(input.endDate, 2 * windowDays - 1);

  // Build a single-day rollup wrapper isn't sufficient — we need the whole
  // window. Re-roll inline so we can also count sampled days + reuse the
  // same descriptor-frequency logic for both windows.
  const currentObs = input.observations.filter((o) =>
    inWindow(o, startDate, input.endDate),
  );
  const priorObs = input.observations.filter((o) =>
    inWindow(o, priorStartDate, priorEndDate),
  );

  // Reuse buildEnrichmentRollup for the current-window summary (per-platform
  // primary rate, answer structures, etc.). Pass each-day-as-unit by setting
  // `date` to a sentinel that matches all current-window obs — actually
  // buildEnrichmentRollup filters by single date, so we wrap it differently:
  // we build the rollup from the pre-filtered current-window obs and pass
  // them through, treating endDate as the "as-of" stamp for the result.
  const currentWindow = buildEnrichmentRollup({
    observations: currentObs.map((o) => ({
      ...o,
      // Force observed_at into the endDate stamp so the rollup's
      // single-date filter accepts every current-window observation.
      // Pure transform; original observation array is not mutated.
      observed_at: input.endDate + "T00:00:00.000Z",
    })),
    date: input.endDate,
    maxDescriptors,
    tenantStripWords,
  });

  // Compute prior-window descriptor frequencies so we can attach rank
  // deltas. T1 — apply the SAME reject set so a token that's filtered
  // out of the current window doesn't inflate the prior-window rank
  // (which would surface as a misleading "↑" arrow).
  const priorDescriptorCounts = countDescriptorWindow(priorObs, rejectSet);
  const priorRanks = new Map<string, number>();
  [...priorDescriptorCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .forEach(([word], i) => priorRanks.set(word, i + 1));

  const topDescriptorsWithDelta: DescriptorWithDelta[] =
    currentWindow.topDescriptors.map((d, i) => {
      const rankThisWindow = i + 1;
      const rankPriorWindow = priorRanks.get(d.word) ?? null;
      const delta =
        rankPriorWindow !== null ? rankPriorWindow - rankThisWindow : null;
      return {
        word: d.word,
        count: d.count,
        rankThisWindow,
        rankPriorWindow,
        delta,
      };
    });

  return {
    windowEndDate: input.endDate,
    windowDays,
    currentWindow,
    currentSampledDays: countSampledDays(currentObs),
    priorSampledDays: countSampledDays(priorObs),
    topDescriptorsWithDelta,
    sampleStatus: classifySample(currentWindow.observationsWithDescriptors),
  };
}

/** Aggregate `descriptor_window` tokens across observations. Pure helper.
 *  T1 (2026-05-05): accepts an optional reject set so the prior-window
 *  count uses the SAME quality filter as the current-window count. */
function countDescriptorWindow(
  observations: ReadonlyArray<PromptAnswerObservation>,
  rejectSet?: ReadonlySet<string>,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const o of observations) {
    const tokens = o.descriptor_window ?? [];
    const seen = new Set<string>();
    for (const t of tokens) {
      if (!t || seen.has(t)) continue;
      seen.add(t);
      if (rejectSet && rejectSet.has(t.toLowerCase())) continue;
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
  }
  return counts;
}

/** Distinct YYYY-MM-DD date count across observations. */
function countSampledDays(
  observations: ReadonlyArray<PromptAnswerObservation>,
): number {
  const days = new Set<string>();
  for (const o of observations) {
    if (typeof o.observed_at === "string") days.add(o.observed_at.slice(0, 10));
  }
  return days.size;
}

// ---------------------------------------------------------------------------
// Competitor descriptor rollup (W2 Step 2.2)
// ---------------------------------------------------------------------------

/**
 * Why a competitor rollup may have no descriptors. The v2 UI renders an
 * explicit empty state rather than fabricating descriptors from the brand's
 * `descriptor_window`.
 *
 * - `no_observations_in_window`: zero observations in the date window.
 * - `no_descriptor_field_yet`: observations exist but NONE carry the
 *   `competitor_descriptor_windows` field (legacy native rows + un-backfilled
 *   historical_recovered rows). Will resolve as new polls accumulate or
 *   after W4 unified extraction.
 * - `competitor_not_mentioned`: at least one observation has the field, but
 *   no observation in the window has the requested competitor as a key.
 *   The competitor genuinely didn't show up in AI answers during this
 *   window.
 */
export type CompetitorEnrichmentEmptyReason =
  | "no_observations_in_window"
  | "no_descriptor_field_yet"
  | "competitor_not_mentioned";

export type CompetitorEnrichmentRollup = {
  competitorName: string;
  windowEndDate: string;
  windowDays: number;
  totalObservations: number;
  /** # of observations in window that mentioned this competitor (via any signal). */
  observationsMentioningCompetitor: number;
  /** # of observations whose `competitor_descriptor_windows[competitorName]` is non-empty. */
  observationsWithDescriptors: number;
  /** # of observations whose `competitor_descriptor_windows` field is present at all
   *  (regardless of whether THIS competitor is keyed in it). Distinguishes
   *  "missing field on legacy rows" from "competitor genuinely absent". */
  observationsWithFieldAvailable: number;
  topDescriptors: Array<{ word: string; count: number }>;
  topDescriptorsWithDelta: DescriptorWithDelta[];
  /**
   * Null when descriptors were recovered. Otherwise carries the reason so
   * the UI can render a precise empty-state message.
   */
  emptyStateReason: CompetitorEnrichmentEmptyReason | null;
  /**
   * W2 Step 2.2b — observation-count classification. Counted from
   * `observationsWithDescriptors` (rows that actually contributed
   * competitor descriptor tokens). "empty" lines up with
   * `emptyStateReason !== null`; "thin" / "enough" let the UI soften
   * "based on N answers" copy.
   */
  sampleStatus: SampleStatus;
};

export type BuildCompetitorEnrichmentRollupInput = {
  observations: ReadonlyArray<PromptAnswerObservation>;
  /** Canonical competitor name (matches the key inside `competitor_descriptor_windows`). */
  competitorName: string;
  endDate: string;
  windowDays?: number; // default 7
  maxDescriptors?: number; // default 5
  /**
   * T1 (operator audit, 2026-05-05) — same quality filter the brand
   * window applies. Competitor descriptors are sampled from the SAME
   * AI-answer text and suffer the same generic-noun pollution
   * (custom/home/builder/area/etc.). Filter must mirror the brand's
   * to keep the side-by-side compare honest.
   */
  tenantStripWords?: ReadonlyArray<string>;
};

export function buildCompetitorEnrichmentRollup(
  input: BuildCompetitorEnrichmentRollupInput,
): CompetitorEnrichmentRollup {
  const windowDays = input.windowDays ?? 7;
  const maxDescriptors = input.maxDescriptors ?? 5;
  const rejectSet = buildDescriptorRejectSet(input.tenantStripWords);

  const startDate = subtractDaysIso(input.endDate, windowDays - 1);
  const priorEndDate = subtractDaysIso(input.endDate, windowDays);
  const priorStartDate = subtractDaysIso(input.endDate, 2 * windowDays - 1);

  const currentObs = input.observations.filter((o) =>
    inWindow(o, startDate, input.endDate),
  );
  const priorObs = input.observations.filter((o) =>
    inWindow(o, priorStartDate, priorEndDate),
  );

  // Count signal-presence regimes — distinguishes legacy rows
  // (no field at all) from rows that have the field but no entry for THIS
  // competitor.
  let observationsWithFieldAvailable = 0;
  let observationsWithDescriptors = 0;
  let observationsMentioningCompetitor = 0;
  const currentDescriptorCounts = new Map<string, number>();

  for (const o of currentObs) {
    const fieldPresent =
      o.competitor_descriptor_windows !== null &&
      o.competitor_descriptor_windows !== undefined;
    if (fieldPresent) observationsWithFieldAvailable += 1;

    // Cross-signal mention check — uses competitor_co_mentions when present
    // (broader signal that doesn't depend on competitor_descriptor_windows
    // being populated). Lets us distinguish "competitor shows up in answers
    // but pre-Step-2.1 rows lack descriptors" from "competitor is absent".
    if (
      o.competitor_co_mentions &&
      o.competitor_co_mentions.includes(input.competitorName)
    ) {
      observationsMentioningCompetitor += 1;
    }

    if (!fieldPresent) continue;
    const tokens =
      o.competitor_descriptor_windows![input.competitorName] ?? null;
    if (!tokens || tokens.length === 0) continue;
    observationsWithDescriptors += 1;

    // Dedupe within one observation — a single answer that repeats a token
    // shouldn't get counted twice in the descriptor cloud.
    // T1 — apply the runtime quality filter (rejectSet).
    const seen = new Set<string>();
    for (const token of tokens) {
      if (!token || seen.has(token)) continue;
      seen.add(token);
      if (rejectSet.has(token.toLowerCase())) continue;
      currentDescriptorCounts.set(
        token,
        (currentDescriptorCounts.get(token) ?? 0) + 1,
      );
    }
  }

  // Compute prior window's per-competitor descriptor counts for delta math.
  // T1 — same rejectSet so prior-window ranks stay consistent.
  const priorDescriptorCounts = new Map<string, number>();
  for (const o of priorObs) {
    if (
      o.competitor_descriptor_windows === null ||
      o.competitor_descriptor_windows === undefined
    )
      continue;
    const tokens = o.competitor_descriptor_windows[input.competitorName];
    if (!tokens || tokens.length === 0) continue;
    const seen = new Set<string>();
    for (const t of tokens) {
      if (!t || seen.has(t)) continue;
      seen.add(t);
      if (rejectSet.has(t.toLowerCase())) continue;
      priorDescriptorCounts.set(t, (priorDescriptorCounts.get(t) ?? 0) + 1);
    }
  }
  const priorRanks = new Map<string, number>();
  [...priorDescriptorCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .forEach(([word], i) => priorRanks.set(word, i + 1));

  const topDescriptors = [...currentDescriptorCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, maxDescriptors)
    .map(([word, count]) => ({ word, count }));

  const topDescriptorsWithDelta: DescriptorWithDelta[] = topDescriptors.map(
    (d, i) => {
      const rankThisWindow = i + 1;
      const rankPriorWindow = priorRanks.get(d.word) ?? null;
      const delta =
        rankPriorWindow !== null ? rankPriorWindow - rankThisWindow : null;
      return {
        word: d.word,
        count: d.count,
        rankThisWindow,
        rankPriorWindow,
        delta,
      };
    },
  );

  // Empty-state reason — strict precedence so the UI can render a precise
  // explanation. NEVER falls back to fabricating descriptors from the
  // brand's descriptor_window.
  let emptyStateReason: CompetitorEnrichmentEmptyReason | null = null;
  if (topDescriptors.length === 0) {
    if (currentObs.length === 0) {
      emptyStateReason = "no_observations_in_window";
    } else if (observationsWithFieldAvailable === 0) {
      emptyStateReason = "no_descriptor_field_yet";
    } else {
      emptyStateReason = "competitor_not_mentioned";
    }
  }

  return {
    competitorName: input.competitorName,
    windowEndDate: input.endDate,
    windowDays,
    totalObservations: currentObs.length,
    observationsMentioningCompetitor,
    observationsWithDescriptors,
    observationsWithFieldAvailable,
    topDescriptors,
    topDescriptorsWithDelta,
    emptyStateReason,
    sampleStatus: classifySample(observationsWithDescriptors),
  };
}

// ---------------------------------------------------------------------------
// Per-platform primary-rate sparkline (W2 Step 2.2)
// ---------------------------------------------------------------------------

export type PlatformPrimaryRatePoint = {
  date: string; // YYYY-MM-DD
  observations: number;
  /** primaryCount / observations on this platform-day. Null when 0 obs. */
  primaryRate: number | null;
};

export type PlatformPrimaryRateSparkline = {
  platform: string;
  /** Length === windowDays. Days with zero observations get a null primaryRate. */
  points: PlatformPrimaryRatePoint[];
  /** W2 Step 2.2b — total observations across the sparkline window for
   *  this platform. */
  totalObservations: number;
  /** W2 Step 2.2b — sample-status classification across the window so
   *  the UI can label thin per-platform sparklines softly. */
  sampleStatus: SampleStatus;
};

export type BuildPlatformPrimaryRateSparklinesInput = {
  observations: ReadonlyArray<PromptAnswerObservation>;
  /** End of the sparkline window (inclusive), YYYY-MM-DD. */
  endDate: string;
  windowDays?: number; // default 14
  /** When supplied, only emit sparklines for these platform labels. */
  platforms?: ReadonlyArray<string>;
};

/**
 * Per-platform daily primary-recommendation rate over a calendar-day
 * window. Pure aggregator over `primary_recommendation` field. Returns
 * empty array when no observations carry the field at all (legacy rows
 * pre-Schema-v2). UI can render a "no sparkline data yet" treatment in
 * that case rather than a flat-line chart.
 *
 * Days with zero observations on a platform get `primaryRate: null` so
 * the chart can render a gap instead of a misleading 0%.
 */
export function buildPlatformPrimaryRateSparklines(
  input: BuildPlatformPrimaryRateSparklinesInput,
): PlatformPrimaryRateSparkline[] {
  const windowDays = input.windowDays ?? 14;
  const startDate = subtractDaysIso(input.endDate, windowDays - 1);

  // Platform discovery + per-(platform, date) bucket.
  const buckets = new Map<
    string,
    Map<string, { obs: number; primary: number }>
  >();
  let anyPrimaryFieldSeen = false;
  for (const o of input.observations) {
    if (!inWindow(o, startDate, input.endDate)) continue;
    // Bug-2 fix: canonicalize so "chatgpt"/"ChatGPT" share one sparkline.
    const platform = canonicalizePlatform(o.platform);
    const date = o.observed_at?.slice(0, 10);
    if (!date) continue;
    let dayMap = buckets.get(platform);
    if (!dayMap) {
      dayMap = new Map();
      buckets.set(platform, dayMap);
    }
    let day = dayMap.get(date);
    if (!day) {
      day = { obs: 0, primary: 0 };
      dayMap.set(date, day);
    }
    day.obs += 1;
    if (typeof o.primary_recommendation === "boolean")
      anyPrimaryFieldSeen = true;
    if (o.primary_recommendation === true) day.primary += 1;
  }

  // No `primary_recommendation` in any observation → return empty so the UI
  // can render an explicit empty state instead of all-null sparklines.
  if (!anyPrimaryFieldSeen) return [];

  // Build the date axis in chronological order so the UI renders left→right.
  const dateAxis: string[] = [];
  for (let i = windowDays - 1; i >= 0; i--) {
    dateAxis.push(subtractDaysIso(input.endDate, i));
  }

  const wantPlatforms = input.platforms
    ? new Set(input.platforms)
    : new Set(buckets.keys());

  const out: PlatformPrimaryRateSparkline[] = [];
  for (const platform of [...wantPlatforms].sort()) {
    const dayMap = buckets.get(platform) ?? new Map();
    let totalObservations = 0;
    const points: PlatformPrimaryRatePoint[] = dateAxis.map((date) => {
      const day = dayMap.get(date);
      if (!day || day.obs === 0) {
        return { date, observations: 0, primaryRate: null };
      }
      totalObservations += day.obs;
      return {
        date,
        observations: day.obs,
        primaryRate: Math.round((day.primary / day.obs) * 100) / 100,
      };
    });
    out.push({
      platform,
      points,
      totalObservations,
      sampleStatus: classifySample(totalObservations),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// W2 Step 2.2b — format-wins rollup (per-platform answer-structure mix)
// ---------------------------------------------------------------------------

/** One bucket of the per-platform answer-structure breakdown. */
export type StructureBucket = {
  /** Internal enum key (e.g. "ranked_list"). UI maps via STRUCTURE_LABEL. */
  structure: string;
  /** Number of observations whose answer_structure equals this value. */
  count: number;
  /** count / sampleCount, rounded to 2 decimals. */
  pct: number;
};

/**
 * One platform's answer-structure mix. The v2 layout's "What format wins"
 * section renders one of these per platform — telling the operator which
 * answer shape AI prefers when answering on this platform so the
 * operator's content can match it.
 */
export type FormatWinsRollup = {
  platform: string;
  windowEndDate: string;
  windowDays: number;
  /** # observations on this platform that carried `answer_structure`. */
  sampleCount: number;
  /** "empty" / "thin" / "enough" — see classifySample. */
  sampleStatus: SampleStatus;
  /** Top structure key (e.g. "ranked_list"). Null when sampleCount === 0. */
  dominantStructure: string | null;
  /** Top structure's pct (0..1). Null when sampleCount === 0. */
  dominantPct: number | null;
  /** Full distribution sorted by count desc. */
  structures: StructureBucket[];
};

export type BuildFormatWinsRollupInput = {
  observations: ReadonlyArray<PromptAnswerObservation>;
  endDate: string;
  windowDays?: number; // default 7
  /** When supplied, only return rollups for these platform labels. */
  platforms?: ReadonlyArray<string>;
};

/**
 * Per-platform answer-structure breakdown over a calendar-day window.
 * Only counts observations whose `answer_structure` field is non-null —
 * pre-Schema-v2 legacy rows contribute nothing (they show as `empty` /
 * 0 sampleCount on their platform if they have no current Schema-v2
 * peers; otherwise they're invisible).
 */
export function buildFormatWinsRollup(
  input: BuildFormatWinsRollupInput,
): FormatWinsRollup[] {
  const windowDays = input.windowDays ?? 7;
  const startDate = subtractDaysIso(input.endDate, windowDays - 1);

  // Bucket by platform → structure → count.
  const byPlatform = new Map<string, Map<string, number>>();
  for (const o of input.observations) {
    if (!inWindow(o, startDate, input.endDate)) continue;
    // Bug-2 fix: canonicalize so "chatgpt"/"ChatGPT" share one row.
    const platform = canonicalizePlatform(o.platform);
    const structure = o.answer_structure;
    if (!structure) continue;
    let s = byPlatform.get(platform);
    if (!s) {
      s = new Map();
      byPlatform.set(platform, s);
    }
    s.set(structure, (s.get(structure) ?? 0) + 1);
  }

  // Determine which platforms to emit. When the caller supplies a list,
  // emit one rollup per requested platform even if it has zero matching
  // observations — UI may want to show "no data yet" for known-existent
  // platforms.
  const wantPlatforms = input.platforms
    ? new Set(input.platforms)
    : new Set(byPlatform.keys());

  const out: FormatWinsRollup[] = [];
  for (const platform of [...wantPlatforms].sort()) {
    const struct = byPlatform.get(platform) ?? new Map();
    const sampleCount = [...struct.values()].reduce((a, b) => a + b, 0);
    const buckets: StructureBucket[] = [...struct.entries()]
      .map(([structure, count]) => ({
        structure,
        count,
        pct:
          sampleCount > 0
            ? Math.round((count / sampleCount) * 100) / 100
            : 0,
      }))
      .sort(
        (a, b) =>
          b.count - a.count || a.structure.localeCompare(b.structure),
      );
    out.push({
      platform,
      windowEndDate: input.endDate,
      windowDays,
      sampleCount,
      sampleStatus: classifySample(sampleCount),
      dominantStructure: buckets[0]?.structure ?? null,
      dominantPct: buckets[0]?.pct ?? null,
      structures: buckets,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// W2 Step 2.2b — competitor dropdown helper (default selection)
// ---------------------------------------------------------------------------

/** One entry in the v2 layout's "compare to competitor" dropdown. */
export type CompetitorDropdownEntry = {
  /** Canonical competitor name (matches `competitor_descriptor_windows` keys). */
  name: string;
  /** # observations in window where competitor_co_mentions includes this name. */
  comentionCount: number;
  /** # observations whose competitor_descriptor_windows[name] is non-empty. */
  observationsWithDescriptors: number;
  /** observationsWithDescriptors > 0. */
  hasDescriptorData: boolean;
  /** True on exactly one entry (the chosen default). */
  isDefault: boolean;
};

export type BuildCompetitorDropdownInput = {
  observations: ReadonlyArray<PromptAnswerObservation>;
  /** Tracked-entity registry — required so directories + generic nouns
   *  can be filtered out via shared entity-pollution logic. */
  trackedEntities: ReadonlyArray<TrackedEntity>;
  endDate: string;
  windowDays?: number; // default 7
  /** Cap on entries returned. Defaults to 10. */
  limit?: number;
};

/**
 * Builds the dropdown / comparison-target selection for the v2 layout's
 * right column ("Who AI thinks they are"). Filters through the shared
 * entity-pollution-filter so directories (Houzz, Yelp, Angi) and generic
 * nouns ("General Contractors") are EXCLUDED — they cannot be defaulted
 * to or selected as a comparison target.
 *
 * Sort order:
 *   1. Competitors WITH descriptor data first (so the default lands on
 *      something the v2 right column can actually render).
 *   2. Then by `observationsWithDescriptors` desc.
 *   3. Then by `comentionCount` desc.
 *   4. Then alphabetical by name.
 *
 * Default = first entry (single competitor flagged `isDefault: true`).
 *
 * If no real competitor has descriptor data yet (e.g. window straddles
 * the Step 2.1 ship date), the default falls back to the strongest real
 * competitor by `comentionCount`. The UI then renders the
 * `no_descriptor_field_yet` empty state for that competitor's column —
 * never fabricates descriptors.
 */
export function buildCompetitorDropdown(
  input: BuildCompetitorDropdownInput,
): CompetitorDropdownEntry[] {
  const windowDays = input.windowDays ?? 7;
  const limit = input.limit ?? 10;
  const startDate = subtractDaysIso(input.endDate, windowDays - 1);

  const comentionCounts = new Map<string, number>();
  const descriptorCounts = new Map<string, number>();

  for (const o of input.observations) {
    if (!inWindow(o, startDate, input.endDate)) continue;

    // Count co-mentions (broader signal — present even on legacy rows
    // without competitor_descriptor_windows).
    for (const name of o.competitor_co_mentions ?? []) {
      comentionCounts.set(name, (comentionCounts.get(name) ?? 0) + 1);
    }

    // Count descriptor-bearing observations per competitor.
    const cdw = o.competitor_descriptor_windows;
    if (cdw && typeof cdw === "object") {
      for (const [name, tokens] of Object.entries(cdw)) {
        if (!tokens || tokens.length === 0) continue;
        descriptorCounts.set(name, (descriptorCounts.get(name) ?? 0) + 1);
      }
    }
  }

  // Filter through entity-pollution-filter — directories + generic nouns
  // get dropped. Brand entries (the operator's own brand) are also
  // filtered, since they can never be a "compare to" target.
  const isCompetitorRankable = makeCompetitorRankingFilter(
    input.trackedEntities,
  );

  // Union of names from co-mentions + descriptors so a competitor that
  // shows up only via one signal still surfaces.
  const allNames = new Set<string>([
    ...comentionCounts.keys(),
    ...descriptorCounts.keys(),
  ]);

  const entries: CompetitorDropdownEntry[] = [];
  for (const name of allNames) {
    if (!isCompetitorRankable(name)) continue;
    const descCount = descriptorCounts.get(name) ?? 0;
    entries.push({
      name,
      comentionCount: comentionCounts.get(name) ?? 0,
      observationsWithDescriptors: descCount,
      hasDescriptorData: descCount > 0,
      isDefault: false,
    });
  }

  entries.sort((a, b) => {
    if (a.hasDescriptorData !== b.hasDescriptorData) {
      return a.hasDescriptorData ? -1 : 1;
    }
    if (a.observationsWithDescriptors !== b.observationsWithDescriptors) {
      return b.observationsWithDescriptors - a.observationsWithDescriptors;
    }
    if (a.comentionCount !== b.comentionCount) {
      return b.comentionCount - a.comentionCount;
    }
    return a.name.localeCompare(b.name);
  });

  if (entries.length > 0) entries[0].isDefault = true;

  return entries.slice(0, limit);
}

// ---------------------------------------------------------------------------
// W2 Step 2.3 (master plan) — bundle type for the v2 layout
// ---------------------------------------------------------------------------

/**
 * The complete data contract the v2 "How AI described you this week"
 * component consumes. Server (today-data.ts) precomputes the bundle;
 * client (enrichment-v2.tsx) renders it. Keeping the type in the data
 * layer keeps the component file purely presentational + lets server
 * + client agree on the shape without importing across the boundary.
 */
export type EnrichmentV2Data = {
  /** Operator brand display name. */
  brandName: string;
  /** Window anchor (UTC date). */
  windowEndDate: string;
  /** Window length in calendar days. */
  windowDays: number;
  /** Brand descriptor rollup with prior-window deltas. */
  brand: EnrichmentWindowRollup;
  /** Filtered competitor selector options + isDefault flag. */
  competitorOptions: CompetitorDropdownEntry[];
  /** Per-competitor rollups, keyed by canonical competitor name. */
  competitorRollups: Record<string, CompetitorEnrichmentRollup>;
  /** Per-platform primary-rate daily sparklines. */
  sparklines: PlatformPrimaryRateSparkline[];
  /** Per-platform answer-shape mix. */
  formatWins: FormatWinsRollup[];
};
