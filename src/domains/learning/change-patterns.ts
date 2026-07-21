/**
 * Learning Loop 1: Change Pattern Recognition
 *
 * RANK-1 (2026-07-06): this module's richer per-(signal x asset) success-rate
 * signal is no longer dormant. `changePatternsToOutcomes` reduces qualifying
 * patterns (>= MIN_DECIDED settled samples) into the SAME dimension-keyed
 * SettledOutcome[] the win-rate prior already consumes, so change-patterns
 * becomes an INPUT to the ONE bounded, decided-only outcome prior
 * (experiment-prior.ts) - never a second, parallel prior. A pattern below the
 * sample floor contributes nothing (neutral by absence), so a fresh/undecided
 * tenant with no qualifying patterns gets byte-identical ranking.
 *
 * Verdict-engine consolidation (2026-07-21, CORE 100K Lane F): the legacy
 * ChangeOutcome producer half (computeChangePatterns / materializeChangePatterns,
 * fed by the retired attribution memory loop) was removed. The `ChangePattern`
 * type and `changePatternsToOutcomes` stay: load-experiment-outcomes.ts still
 * reads previously materialized `change-patterns` store rows through them. The
 * URL pattern brain below (fed by url-change-outcomes) is untouched.
 */

import { writeStore } from "@/lib/persistence/json-store";
import type { UrlChangeOutcome } from "@/domains/attribution/url-change-outcome";
import type { EditToken } from "@/domains/changelog/dedupe";
import type { AssetType } from "@/lib/constants";
import {
  canonicalMoveType,
  MIN_DECIDED,
  type SettledOutcome,
} from "./experiment-prior";

// ---------------------------------------------------------------------------
// Type
// ---------------------------------------------------------------------------

/** Intentionally no tenant_id — this is a global aggregate across all tenants. CX4 replaces with GlobalPattern. */
export type ChangePattern = {
  id: string; // `${signal_type}::${asset_type}`
  signal_type: string;
  asset_type: string;
  sample_count: number;
  success_count: number;
  success_rate: number; // 0-1
  avg_citation_delta: number; // avg % delta for improving outcomes
  avg_mention_delta: number;
  avg_days_to_signal: number; // avg days_after for improving outcomes
  platform_response: Record<
    string,
    { improving: number; total: number; rate: number }
  >;
  engine_timing: {
    platform: string;
    median_days: number;
    earliest_days: number;
    latest_days: number;
    sample_count: number;
  }[];
  confidence: "high" | "medium" | "low";
  computed_at: string;
};

// ---------------------------------------------------------------------------
// RANK-1 bridge: change-patterns -> the ONE outcome prior
//
// Reduce the richer per-(signal x asset) success-rate patterns into the SAME
// dimension-keyed SettledOutcome[] the win-rate prior (experiment-prior.ts)
// already consumes, so this signal FEEDS that one bounded multiplier instead of
// being a second, drifting prior. Each qualifying pattern is expanded back into
// its success_count "won" + (sample_count - success_count) "lost" synthetic
// decided outcomes on the SAME actionType dimension (canonicalMoveType over the
// pattern's signal_type), so computeDimPriors applies the identical
// >= MIN_DECIDED gate, win-rate math, and [0.85, 1.15] clamp.
// ---------------------------------------------------------------------------

/**
 * Map a change-pattern `signal_type` (the faq/content/page/... changelog
 * vocabulary) into the SAME canonical move-kind space the proof ledger's
 * actionType uses (answer_block / edit_page / create_page / ...), so a
 * change-pattern REINFORCES the ledger's own bucket instead of splitting into a
 * separate one. Kept as an explicit, narrow table (not folded into the shared
 * canonicalMoveType, whose substring rules are tuned for rec-action / graph-gap
 * strings): faq is question-shaped content -> answer_block, generic on-page copy
 * -> edit_page, a page launch -> create_page. Anything not listed falls through
 * to the shared canonicalizer, then to the raw slug.
 */
const SIGNAL_TYPE_TO_MOVE_KIND: Record<string, string> = {
  faq: "answer_block",
  content: "edit_page",
  page: "create_page",
  service_page: "edit_page",
  technical: "fix_experience",
};

function signalTypeToMoveKind(signalType: string): string {
  const s = (signalType ?? "").toLowerCase().trim();
  return SIGNAL_TYPE_TO_MOVE_KIND[s] ?? canonicalMoveType(s);
}

/**
 * Convert change patterns into dimension-keyed SettledOutcome[] for the outcome
 * prior. PURE. Only patterns with >= MIN_DECIDED settled samples contribute
 * (below that they stay neutral by absence, matching the prior's own floor), and
 * only when their signal_type maps to a real move kind. A pattern with
 * `sample_count` s and `success_count` w becomes w "won" + (s - w) "lost"
 * synthetic outcomes keyed on `actionType`, so it flows through the identical
 * win-rate math AND merges into the ledger's own bucket for that kind. Empty /
 * all-thin input -> [] (the prior stays byte-identical). Never mutates the
 * patterns; nothing here touches measurement history.
 */
export function changePatternsToOutcomes(
  patterns: readonly ChangePattern[],
): SettledOutcome[] {
  const out: SettledOutcome[] = [];
  for (const p of patterns) {
    // Guard against malformed rows: successes can never exceed samples.
    const sample = Math.max(0, Math.floor(p.sample_count));
    const won = Math.max(0, Math.min(sample, Math.floor(p.success_count)));
    const lost = sample - won;
    if (sample < MIN_DECIDED) continue; // below the prior's own decided floor
    const actionType = signalTypeToMoveKind(p.signal_type);
    if (!actionType || actionType === "other") continue; // unmappable signal -> nothing
    for (let i = 0; i < won; i += 1) out.push({ verdict: "won", dims: { actionType } });
    for (let i = 0; i < lost; i += 1) out.push({ verdict: "lost", dims: { actionType } });
  }
  return out;
}

// ===========================================================================
// URL-level pattern brain (Phase 1 — fed by URL Z-score outcomes)
//
// Parallel to the legacy signal_type × asset_type grouping above. This grouping
// uses edit_type tokens (from dedupe.ts) × asset_type and reads the
// `url-change-outcomes.json` store (G3), so it reflects the true
// change-and-land loop the operator actually cares about. Existing consumers
// of the legacy `computeChangePatterns` / `ChangePattern` are NOT touched —
// they continue to power the recommendation engine until Phase 3 migrates it.
// ===========================================================================

/** One bucket per (edit_type_token × asset_type). Fed into G5 "Ready on [date]". */
export type UrlChangePattern = {
  id: string; // `${edit_type_token}::${asset_type}`
  edit_type_token: EditToken;
  asset_type: AssetType;

  sample_count: number;
  helping_count: number;
  hurting_count: number;
  nothing_yet_count: number;

  success_rate: number; // helping / sample, 0..1
  regress_rate: number; // hurting / sample, 0..1

  /** Median landing_day_n across helping outcomes (null if zero helping). */
  median_landing_day: number | null;
  /** Median landing z across helping outcomes. */
  median_landing_z: number | null;
  /** Median delta_pct across ALL outcomes in the bucket (direction-signed). */
  median_delta_pct: number | null;
  /** Median baseline_days_used — operator sees how noisy the samples were. */
  median_baseline_days: number | null;

  /**
   * Tier for UI gating: how much to trust this bucket's predictions.
   * high ≥5, medium ≥3, low otherwise.
   */
  confidence_tier: "high" | "medium" | "low";

  /** Same metric as scan-state / watcher-state — enables "brain updated Nh ago" UI. */
  computed_at: string;
};

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Group URL-level outcomes by (edit_type_token × asset_type).
 *
 * A single outcome can contribute to multiple buckets when its change
 * description tokenizes to multiple edit types (e.g. a commit that
 * rewrites both title AND adds schema counts as a sample for both
 * `title_change × city_page` AND `schema_added × city_page`). This matches
 * how operators think: "my title changes on city pages landed in 3 days"
 * is the question — each edit type deserves its own bucket of evidence.
 */
export function computeUrlChangePatterns(
  outcomes: UrlChangeOutcome[],
): UrlChangePattern[] {
  // Build buckets keyed by (token × asset_type).
  const buckets = new Map<string, UrlChangeOutcome[]>();
  for (const o of outcomes) {
    // Skip outcomes with no tokenizable edit description — they can't
    // contribute to a typed bucket.
    if (!o.edit_type_tokens || o.edit_type_tokens.length === 0) continue;
    for (const token of o.edit_type_tokens) {
      const key = `${token}::${o.asset_type}`;
      const bucket = buckets.get(key) ?? [];
      bucket.push(o);
      buckets.set(key, bucket);
    }
  }

  const patterns: UrlChangePattern[] = [];
  const computedAt = new Date().toISOString();

  for (const [id, bucketOutcomes] of buckets) {
    const [token, assetType] = id.split("::") as [EditToken, AssetType];

    const helping = bucketOutcomes.filter((o) => o.verdict === "helping");
    const hurting = bucketOutcomes.filter((o) => o.verdict === "hurting");
    const nothingYet = bucketOutcomes.filter(
      (o) => o.verdict === "nothing_yet",
    );

    const sampleCount = bucketOutcomes.length;

    const helpingLandingDays = helping
      .map((o) => o.landing_day_n)
      .filter((n): n is number => n !== null);
    const helpingLandingZs = helping
      .map((o) => o.landing_z)
      .filter((n): n is number => n !== null);
    const allDeltaPcts = bucketOutcomes
      .map((o) => o.delta_pct)
      .filter((n): n is number => n !== null);
    const allBaselineDays = bucketOutcomes.map((o) => o.baseline_days_used);

    const confidenceTier: UrlChangePattern["confidence_tier"] =
      sampleCount >= 5 ? "high" : sampleCount >= 3 ? "medium" : "low";

    patterns.push({
      id,
      edit_type_token: token,
      asset_type: assetType,
      sample_count: sampleCount,
      helping_count: helping.length,
      hurting_count: hurting.length,
      nothing_yet_count: nothingYet.length,
      success_rate:
        sampleCount > 0
          ? Math.round((helping.length / sampleCount) * 100) / 100
          : 0,
      regress_rate:
        sampleCount > 0
          ? Math.round((hurting.length / sampleCount) * 100) / 100
          : 0,
      median_landing_day: median(helpingLandingDays),
      median_landing_z: median(helpingLandingZs),
      median_delta_pct: median(allDeltaPcts),
      median_baseline_days: median(allBaselineDays),
      confidence_tier: confidenceTier,
      computed_at: computedAt,
    });
  }

  // Sort by confidence first (high/medium/low), then success_rate desc, then
  // sample_count desc. UI can surface high-confidence helpers first.
  const tierRank: Record<UrlChangePattern["confidence_tier"], number> = {
    high: 0,
    medium: 1,
    low: 2,
  };
  patterns.sort((a, b) => {
    if (tierRank[a.confidence_tier] !== tierRank[b.confidence_tier]) {
      return tierRank[a.confidence_tier] - tierRank[b.confidence_tier];
    }
    if (a.success_rate !== b.success_rate) return b.success_rate - a.success_rate;
    return b.sample_count - a.sample_count;
  });

  return patterns;
}

/**
 * Persist url change patterns to disk. Written to a SEPARATE store
 * (`.data/url-change-patterns.json`) so the legacy `.data/change-patterns.json`
 * consumed by the recommendation engine is untouched. Phase 3 migrates rec
 * engine to read from here; until then both coexist.
 */
export async function materializeUrlChangePatterns(
  outcomes: UrlChangeOutcome[],
): Promise<UrlChangePattern[]> {
  const patterns = computeUrlChangePatterns(outcomes);
  await writeStore("url-change-patterns", patterns);
  // No Supabase sync yet — new table lands in G9.
  return patterns;
}

/**
 * Lookup utility for G5: given a change's edit tokens + asset type, return
 * the highest-confidence matching pattern (or null if none exists).
 *
 * Picks the bucket with the most samples AND best confidence tier. When a
 * change has multiple tokens, we return the pattern for the token with the
 * highest-confidence bucket (e.g., if both `title_change` and `schema_added`
 * match and title_change has 8 samples vs schema_added's 3, we use
 * title_change).
 */
export function findBestUrlPattern(
  editTypeTokens: readonly EditToken[],
  assetType: AssetType,
  patterns: UrlChangePattern[],
): UrlChangePattern | null {
  if (editTypeTokens.length === 0) return null;

  const candidates = patterns.filter(
    (p) =>
      p.asset_type === assetType &&
      editTypeTokens.includes(p.edit_type_token),
  );
  if (candidates.length === 0) return null;

  const tierRank: Record<UrlChangePattern["confidence_tier"], number> = {
    high: 0,
    medium: 1,
    low: 2,
  };
  candidates.sort((a, b) => {
    if (tierRank[a.confidence_tier] !== tierRank[b.confidence_tier]) {
      return tierRank[a.confidence_tier] - tierRank[b.confidence_tier];
    }
    return b.sample_count - a.sample_count;
  });
  return candidates[0];
}
