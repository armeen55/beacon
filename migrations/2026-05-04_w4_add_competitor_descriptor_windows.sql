-- Migration: 2026-05-04_w4_add_competitor_descriptor_windows.sql
-- Author:    Armeen Aminzadeh (operator) + Claude
-- Applied:   2026-05-04 via Supabase apply_migration MCP
-- Project:   jdegznovgysxyweknewh (beacon)
-- Phase:     W4 Stage 7 (core publish unblock — operator option 1)
--
-- Why this migration exists:
--   W4 Stage 7 --write attempted to upsert 14,096 historical_recovered
--   observations into `prompt_answer_observations`. Supabase rejected
--   batch 0 with PGRST204 because the staged rows carry the W2 Schema
--   v2.1 enrichment field `competitor_descriptor_windows` and the
--   target table did not have that column.
--
--   Operator chose option 1 (add the missing column) over alternatives
--   (strip the field, sidecar table, defer W4). This migration is the
--   minimum change to unblock the publish.
--
-- Constraints (operator-locked, 2026-05-04):
--   • nullable (no NOT NULL, no DEFAULT) so existing native rows stay
--     untouched
--   • no backfill in this migration
--   • no other column constraints
--   • does NOT touch any other column on prompt_answer_observations
--   • does NOT touch any other table — daily_metric_snapshots stays
--     untouched
--   • IF NOT EXISTS guard — re-running the migration is a no-op
--
-- Forward references:
--   • src/domains/prompt-answer-observations/extraction.ts (W2 day 2)
--     will populate this column on new native observations.
--   • scripts/customer-one-backfill.ts (Stage 2 of W4) already
--     populates it on historical_recovered observations.
--   • Read paths that join this column should treat null as
--     "no enrichment available" (pre-W4 native rows).

ALTER TABLE public.prompt_answer_observations
  ADD COLUMN IF NOT EXISTS competitor_descriptor_windows jsonb;

COMMENT ON COLUMN public.prompt_answer_observations.competitor_descriptor_windows IS
  'W4 Stage 7 (2026-05-04): Schema v2.1 enrichment — descriptor windows extracted around competitor name mentions in the answer text. Map of competitor_canonical_name -> array of descriptor strings. Nullable because pre-W4 native rows do not carry this field. Populated by deterministic extractor in scripts/customer-one-backfill.ts and (going forward) in src/domains/prompt-answer-observations/extraction.ts when W2 day 2 backfill lands.';
