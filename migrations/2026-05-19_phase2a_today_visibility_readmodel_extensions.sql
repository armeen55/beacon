-- Migration: 2026-05-19_phase2a_today_visibility_readmodel_extensions.sql
-- Author:    Armeen Aminzadeh (operator) + Claude
-- Applied:   NOT YET APPLIED — pending operator approval before running
--            against production Supabase via apply_migration MCP.
-- Project:   jdegznovgysxyweknewh (beacon)
-- Phase:     Today v2 perf architecture reset — Phase 2A read-model
--            schema extensions (operator-gated approval, 2026-05-12).
--
-- Why this migration exists:
--   Phase 1 of the Today v2 architecture reset proved (with a measured
--   8-observation equivalence harness at
--   `src/domains/today/visibility-read-model-equivalence.test.ts`) that
--   `daily_metric_snapshots` as it stands cannot fully replace raw
--   `prompt_answer_observations` computation for the Today v2 visibility
--   section without changing customer-visible numbers. The drift sources:
--
--     1. Per-platform brand series uses (tracked_brand_cited OR
--        tracked_brand_mentioned) per obs — the snapshot stores
--        `mention_count` and `citation_count` separately, so the union
--        can't be reconstructed. Measured drift: up to 25 pp on the
--        fixture's Perplexity row.
--     2. Leaderboard brand `citation_rate` uses position-weighted
--        citations (citationPositionWeight: pos 1-3 → 1.0, pos 4-6 → 0.5,
--        pos 7+ → 0.25, unknown → 0.5). The snapshot stores only raw
--        citation counts. Measured drift: 9.4 pp on the fixture.
--     3. Competitor citation_rate in the chart treats "cited == mentioned"
--        (no competitor-domain map) — the snapshot's `citation_count` for
--        a competitor uses real domain match. Measured drift: 25 pp on
--        the fixture (competitors mentioned but not cited by domain).
--
--   The operator explicitly forbid silent metric-definition changes
--   ("correctness and trust beat speed"). This migration adds three
--   additive nullable columns the Phase 1 report identified as the
--   minimum needed to close the gap WITHOUT changing how the chart /
--   leaderboard render. Once populated (by the updated builder + the
--   backfill script in `scripts/backfill-snapshot-extensions.ts`),
--   Phase 2B can swap `loadTodayV2VisibilityData` to read from snapshots
--   while preserving every customer-visible number to within rounding.
--
-- Constraints (operator-locked):
--   • ADDITIVE ONLY — every new column is nullable; no DROPs, no NOT NULL
--     adds, no type changes on existing columns. Backwards-compatible
--     with all existing readers and the current dual-write path.
--   • No data mutation in this migration. Backfill is a separate
--     idempotent script (`scripts/backfill-snapshot-extensions.ts`)
--     that supports --dry-run + --tenant + --since/--until filters
--     and never runs unless the operator approves explicitly.
--   • No new constraints, no new indexes (read patterns are unchanged
--     for now; Phase 2B will add an index on (tenant_id, date) if the
--     loader-swap perf measurement shows it's needed).
--   • No RLS policy changes — existing policies cover the new columns
--     automatically (RLS operates at row scope, not column scope).
--   • No paid APIs, no polls, no scans triggered by this migration.

-- ─────────────────────────────────────────────────────────────────────
-- Column 1: cited_or_mentioned_count
-- ─────────────────────────────────────────────────────────────────────
-- Populated on PLATFORM-scope rows (scope_type = 'platform'). Captures
-- the chart's per-platform "cited OR mentioned" union — the formula
-- `computeVisibilityTimeSeriesByPlatform` uses:
--
--   for each obs on (platform, date):
--     if citesBrand(obs) || mentionsBrand(obs, brandSlugs): cited++
--
-- Stored value = count of obs on that platform-day where
-- `tracked_brand_cited = true OR tracked_brand_mentioned = true`.
-- The snapshot builder writes this in lockstep with `mention_count`
-- and `citation_count`; the union can't be reconstructed from those
-- two alone, hence the new column.

ALTER TABLE "public"."daily_metric_snapshots"
  ADD COLUMN IF NOT EXISTS "cited_or_mentioned_count" integer NULL;

COMMENT ON COLUMN "public"."daily_metric_snapshots"."cited_or_mentioned_count" IS
  'Phase 2A (2026-05-19) — count of obs on platform-day where brand was cited OR mentioned. Populated on platform-scope rows; null on entity/topic rows. Required by the chart''s per-platform view formula (tracked_brand_cited OR tracked_brand_mentioned). Cannot be derived from mention_count + citation_count because those two overlap.';

-- ─────────────────────────────────────────────────────────────────────
-- Column 2: position_weighted_citation_count
-- ─────────────────────────────────────────────────────────────────────
-- Populated on ENTITY-scope rows where the entity is the owned brand
-- (`is_owned = true`). Captures the leaderboard's position-weighted
-- citation sum from `aggregateWindow` in visibility-score.ts:
--
--   for each obs:
--     if obs.tracked_brand_cited === true:
--       weight = citationPositionWeight(obs.position)
--       sum += weight
--
-- Position weights (operator-locked, see visibility-score.ts:133):
--   pos 1-3 → 1.0  (top-of-answer)
--   pos 4-6 → 0.5  (mid-answer)
--   pos 7+  → 0.25 (deep)
--   null    → 0.5  (default for missing position data)
--
-- Stored as numeric (the sum can be fractional). Null on competitor
-- entity rows (no position weights tracked for competitor citations
-- in the current Today semantics — the chart uses mention-as-citation
-- for competitors, see column 3 below).

ALTER TABLE "public"."daily_metric_snapshots"
  ADD COLUMN IF NOT EXISTS "position_weighted_citation_count" numeric NULL;

COMMENT ON COLUMN "public"."daily_metric_snapshots"."position_weighted_citation_count" IS
  'Phase 2A (2026-05-19) — sum of citationPositionWeight (1.0/0.5/0.25/0.5-default) over obs where brand was cited. Populated on owned-brand entity-scope rows only; null on competitor entity rows and on platform/topic rows. Required by the leaderboard''s brand citation_rate formula; cannot be derived from raw citation_count without re-reading obs.position.';

-- ─────────────────────────────────────────────────────────────────────
-- Column 3: mentioned_obs_count
-- ─────────────────────────────────────────────────────────────────────
-- Populated on ENTITY-scope rows. Captures the chart's competitor
-- "presence" count and the leaderboard's mention-rate numerator:
--
--   For owned brand entity (is_owned = true):
--     count of obs where (tracked_brand_mentioned === true) OR
--                        (obs.mentions includes brand canonical name)
--     This matches `mentionsBrand` in visibility-score.ts:144.
--
--   For competitor entity (is_owned = false):
--     count of obs where (obs.mentions includes competitor canonical
--     name OR slugified-name match).
--     This matches the chart's competitor presence formula in
--     `computeVisibilityTimeSeries` (which sets cited == mentioned for
--     competitors because there's no competitor-domain map).
--
-- The existing `mention_count` column has very similar semantics but
-- differs in two subtle ways: (a) for the owned brand, the existing
-- `countMentions(obs, brand.name)` only checks `mentions.includes`,
-- missing the `tracked_brand_mentioned` flag fast-path; (b) for both,
-- the existing helper uses exact name match while the chart uses slug
-- match (case + whitespace normalized). Adding this column lets the
-- read-model loader use the chart-equivalent formula explicitly,
-- without rewriting `mention_count`'s meaning (which other consumers
-- already depend on).

ALTER TABLE "public"."daily_metric_snapshots"
  ADD COLUMN IF NOT EXISTS "mentioned_obs_count" integer NULL;

COMMENT ON COLUMN "public"."daily_metric_snapshots"."mentioned_obs_count" IS
  'Phase 2A (2026-05-19) — count of obs where entity was mentioned, computed using the chart-equivalent formula. For owned brand: tracked_brand_mentioned OR mentions includes canonical name. For competitor: mentions includes canonical name (slug-normalized match). Populated on entity-scope rows; null on platform/topic rows. The existing `mention_count` column keeps its current semantics (exact-name match only); this column is purpose-built for the Phase 2B Today read-model loader so it can compute chart-equivalent competitor citation_rate without rewriting mention_count.';

-- ─────────────────────────────────────────────────────────────────────
-- Backwards compatibility note
-- ─────────────────────────────────────────────────────────────────────
-- Existing readers (today-kpis.ts, repo.getDailyMetricSnapshots,
-- canonical-store, dual-write.ts) never touch the new columns. The
-- `DailyMetricSnapshot` TS type adds them as optional (nullable)
-- fields, so unset rows return undefined/null and existing logic
-- runs unchanged.
--
-- After this migration applies AND the updated builder is deployed
-- AND the backfill has run for historical rows, the Phase 2B
-- `loadVisibilityReadModelFromSnapshots` can begin reading these
-- columns. Phase 2B is not in scope for this migration — operator
-- approves the loader swap separately, only after the equivalence
-- harness proves exact match against raw observation compute.
