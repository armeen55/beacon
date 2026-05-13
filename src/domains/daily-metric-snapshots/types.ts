export type SnapshotScopeType =
  | "prompt"
  | "topic"
  | "entity"
  | "platform"
  | "account";

export type SnapshotSourceType =
  | "derived"
  | "benchmark";

export type DailyMetricSnapshot = {
  id: string;
  date: string;
  scope_type: SnapshotScopeType;
  scope_id: string;
  platform: string;
  source_type: SnapshotSourceType;
  visibility_score: number | null;
  mention_count: number;
  citation_count: number;
  share_of_voice: number | null;
  avg_position: number | null;
  total_possible: number | null;
  metadata: Record<string, unknown>;
  /** Owning tenant. */
  tenant_id: string;
  // ─────────────────────────────────────────────────────────────────
  // Phase 2A (2026-05-19) — Today v2 read-model extensions.
  //
  // Three nullable additive columns added in migration
  // `2026-05-19_phase2a_today_visibility_readmodel_extensions.sql`.
  // Snapshot rows produced PRE-Phase-2A leave these null/undefined;
  // rows produced by the updated builder populate them in lockstep
  // with the existing mention_count / citation_count.
  //
  // Phase 2B (deferred, operator-gated) will read these columns from
  // `loadVisibilityReadModelFromSnapshots` to reproduce chart +
  // leaderboard numbers exactly. Until that loader ships, these
  // columns are write-only — no consumer reads them.
  // ─────────────────────────────────────────────────────────────────

  /**
   * Per-platform union of cited OR mentioned. Populated on platform-
   * scope rows (`scope_type === 'platform'`); null on entity/topic
   * rows. Formula: count of obs where
   * `tracked_brand_cited === true || tracked_brand_mentioned === true`.
   *
   * Required by the chart's per-platform view
   * (`computeVisibilityTimeSeriesByPlatform`) which uses the union
   * formula `(citesBrand(obs) || mentionsBrand(obs, brandSlugs))`.
   * Cannot be derived from mention_count + citation_count because
   * those two overlap.
   */
  cited_or_mentioned_count?: number | null;

  /**
   * Per-entity sum of position-weighted brand citations. Populated on
   * owned-brand entity-scope rows; null on competitor entity rows and
   * on platform/topic rows. Formula:
   *
   *   for obs in observations where tracked_brand_cited === true:
   *     sum += citationPositionWeight(obs.position)
   *
   * Position weights (operator-locked, see visibility-score.ts:133):
   *   pos 1-3 → 1.0, pos 4-6 → 0.5, pos 7+ → 0.25, null → 0.5.
   *
   * Required by the leaderboard's brand citation_rate formula in
   * `aggregateWindow` (visibility-score.ts:556). Cannot be derived
   * from raw citation_count without re-reading obs.position.
   */
  position_weighted_citation_count?: number | null;

  /**
   * Per-entity chart-equivalent presence count. Populated on entity-
   * scope rows; null on platform/topic rows. Formula:
   *
   *   For owned brand entity:
   *     count of obs where (tracked_brand_mentioned === true ||
   *                         obs.mentions includes canonical name).
   *
   *   For competitor entity:
   *     count of obs where slugified obs.mentions includes the
   *     entity's slugified canonical name.
   *
   * Required by the chart's competitor presence count and the
   * leaderboard's mention-rate numerator. The existing `mention_count`
   * column keeps its prior semantics (exact-name `mentions.includes`)
   * for backwards compatibility; this column carries the chart-
   * equivalent formula explicitly so the read-model loader can swap
   * without changing customer-visible numbers.
   */
  mentioned_obs_count?: number | null;
};
