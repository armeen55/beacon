-- Migration: 2026-05-04_poll_integrity_raw_poll_chunks.sql
-- Author:    Armeen Aminzadeh (operator) + Claude
-- Applied:   2026-05-04 via Supabase apply_migration MCP
-- Project:   jdegznovgysxyweknewh (beacon)
-- Phase:     Poll Integrity Hardening (post May 2-4 launch-blocker incident)
--
-- Why this migration exists:
--   Between May 1 ~22:00 UTC and May 4 ~20:08 UTC, daily native polls
--   ran successfully against OpenAI/Perplexity (~$9 spend, 600 prompts
--   answered) but every observation upsert was silently rejected by
--   Supabase with PGRST204 ("column not in schema cache"). The provider
--   responses are PERMANENTLY LOST — they were never persisted because
--   no schema-stable raw store existed before the transform/upsert step.
--
--   This table is the raw safety net. It is written BEFORE we call the
--   Schema v2 transform + observation upsert. If observation upsert
--   fails for ANY reason (column drift, validation error, network
--   blip), the raw provider response is preserved here and a future
--   recovery script can reconstruct observations from this row's
--   raw_response JSON.
--
-- Constraints (operator-locked):
--   • run_id PK so re-runs are idempotent (upsert)
--   • DELIBERATELY MINIMAL columns — only the bare-minimum fields
--     needed to identify and replay the call. Adding Schema v2.x
--     enrichment fields here would re-introduce the same column-drift
--     failure mode this table exists to defend against.
--   • prompt_ids stored as TEXT[] for cheap point-lookup
--   • raw_response stored as JSONB so any provider shape persists
--   • observations_persisted_count is null until the reconciliation
--     step stamps it (post-pipeline). Compare to prompt_count for the
--     verified-persistence verdict.
--   • reconciliation_status enum captured as TEXT so future statuses
--     can be added without a migration.

ALTER TABLE IF EXISTS public.raw_poll_chunks
  ALTER COLUMN observations_persisted_count DROP NOT NULL;
-- (no-op if the column was created nullable already; defensive in case
--  a future migration tightens it)

CREATE TABLE IF NOT EXISTS public.raw_poll_chunks (
  run_id                       TEXT PRIMARY KEY,
  tenant_id                    TEXT NOT NULL,
  platform                     TEXT NOT NULL,
  source                       TEXT NOT NULL,
  chunk_offset                 INTEGER NOT NULL DEFAULT 0,
  chunk_limit                  INTEGER NULL,
  prompt_count                 INTEGER NOT NULL DEFAULT 0,
  prompt_ids                   TEXT[] NOT NULL DEFAULT '{}',
  raw_response                 JSONB NULL,
  cost_usd                     NUMERIC NULL,
  observations_persisted_count INTEGER NULL,
  reconciliation_status        TEXT NULL,
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_raw_poll_chunks_tenant_created
  ON public.raw_poll_chunks (tenant_id, created_at DESC);

COMMENT ON TABLE public.raw_poll_chunks IS
  'Poll Integrity Hardening (2026-05-04): raw provider responses written BEFORE observation upsert. Preserves data even if observation persistence fails. Schema deliberately minimal so it cannot suffer the same column-drift failure that caused the May 2-4 incident.';

COMMENT ON COLUMN public.raw_poll_chunks.observations_persisted_count IS
  'Filled by the reconciliation step after syncObs. Null until reconciled. Compare to prompt_count for verified-persistence verdict.';

COMMENT ON COLUMN public.raw_poll_chunks.reconciliation_status IS
  'One of: pending | verified_complete | persistence_mismatch | observation_upsert_threw | snapshot_derivation_failed. Stamped post-pipeline.';
