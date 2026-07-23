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
   * Number of observations where the owned brand was cited at least once.
   * New builders persist the value in `metadata.cited_obs_count` so the
   * customer-facing citation rate uses an observation numerator rather than
   * the number of cited URLs (which can legitimately exceed observations).
   * Kept optional here for file/import compatibility with historical rows.
   */
  cited_obs_count?: number | null;

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

  // ─────────────────────────────────────────────────────────────────
  // Section 6 C2 (2026-05-15) — Primary Recommendation first-class
  // metric. One additive-nullable INTEGER column on
  // `daily_metric_snapshots`. Migration:
  //   migrations/2026-05-15_section6_primary_recommendation_column.sql
  // C1.1 comment correction:
  //   migrations/2026-05-15_section6_primary_recommendation_column_comment_update.sql
  //
  // Storage layer matches the C1.1-applied COMMENT ON COLUMN verbatim.
  // ─────────────────────────────────────────────────────────────────

  /**
   * Section 6 (2026-05-15) — count of `PromptAnswerObservation` rows
   * on this snapshot's scope/date where `primary_recommendation ===
   * true`. The heuristic that derives the per-observation boolean
   * lives upstream of this column (see
   * `src/domains/ai-visibility/prompt-answer-observations.ts:63`); this
   * column is a per-scope materialization of that signal so customer
   * surfaces don't need to re-walk raw observations.
   *
   * **Per-scope contract (C2 builder):**
   *   • `scope_type = "platform"` — POPULATED. Count of obs on the
   *     run's platform-day with `primary_recommendation === true`.
   *   • `scope_type = "prompt"` — POPULATED. Per-prompt-per-platform
   *     count. Caller emits one prompt row per distinct `prompt_id`
   *     in the run.
   *   • `scope_type = "entity"`, `is_owned = true` — POPULATED. Same
   *     run-wide count as the platform row (the owned entity row is
   *     a per-entity view of the same observations).
   *   • `scope_type = "entity"`, `is_owned = false` — NULL. Primary
   *     recommendation is a my-brand concept; competitor rows carry
   *     null per the Phase 2A `position_weighted_citation_count`
   *     precedent.
   *   • `scope_type = "topic"` — NULL per H8 lock (Section 6
   *     Decision Lock). No v1 consumer for topic-level primary
   *     share; locked NULL until a future phase introduces one.
   *   • `scope_type = "account"` — NOT MATERIALIZED in C2. The
   *     native poll orchestrator is per-platform-per-chunk so a
   *     cross-platform account row written from any one invocation
   *     would last-write-wins overwrite the others. Account-level
   *     primary share is derived at READ TIME from platform rows
   *     (`SUM(primary_recommendation_count) WHERE
   *     scope_type='platform'`) until a dedicated post-cron account
   *     aggregator is approved in a later phase.
   *
   * **Historical rows** produced before C2 (~2026-05-15) carry NULL
   * until the C3 backfill script populates from each tenant's
   * earliest active-provider observation date per H5.
   *
   * **null vs absent**: the column is optional in the TypeScript
   * type so PRE-Section-6 builder paths (legacy Profound runs that
   * predate C2's retrofit) can still compile while the row literal
   * keeps the column unset. Persisted as NULL via Supabase upsert
   * (missing key = NULL). Post-C2 row literals are explicit about
   * the scope contract above; "explicit null literal" on topic /
   * competitor-entity rows is pinned by
   * `tests/architecture/snapshot-builder-topic-null-primary-rec.test.ts`.
   */
  primary_recommendation_count?: number | null;
};
