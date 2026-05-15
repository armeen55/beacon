-- Migration: 2026-05-15_phase_a3_robots_state_mirror.sql
-- Author:    Armeen Aminzadeh (operator) + Claude
-- Applied:   PENDING — operator approval required before apply.
-- Project:   jdegznovgysxyweknewh (beacon)
-- Phase:     Phase A.3 (post-A.3.5) robots-state Supabase mirror.
--
-- Why this migration exists:
--   The indexability loader (A.3.3b) and operator diagnostics page
--   (A.3.5) read robots.txt parsed-state to compute per-URL verdicts.
--   The reader, `readRobotsState()` in
--   `src/domains/pages/robots-parser.ts`, used to bypass the
--   classification-routing layer and read a FLAT path
--   `.data/robots-state.json`. On Vercel's read-only lambda FS
--   that file doesn't exist → reader returns null → loader drops
--   every bot allow/deny flag to null via the A.3.3b defense
--   ladder → every verdict collapses to `unknown`.
--
--   Even after retrofitting the readers/writers through the
--   tenant-routed `readDotDataJson("robots-state")` /
--   `writeDotDataJson("robots-state")` (Singleton classification
--   already correct), the DAILY-SCAN WRITES on the GH Actions
--   runner do NOT persist past job-exit. Without a Supabase
--   mirror, Vercel runtime has nothing to read.
--
--   This migration adds the persistent storage layer.
--   Production reads through `repo.getRobotsState()`. Daily-scan
--   writes through `repo.setRobotsState()` (dual-write Supabase
--   + tenant-routed disk).
--
-- Sequencing model A (operator-locked):
--   New code is safe to deploy BEFORE this migration applies.
--   Repository `getRobotsState()` soft-fails to null on the
--   `42P01` (undefined_table) PostgreSQL error, so production
--   readers see "no robots evidence" until both (a) the migration
--   applies AND (b) the next daily-scan runs the dual-write.
--   Writes fail loud — daily-scan will error if it tries to
--   UPSERT before the migration has run, which is the right
--   behavior (operator notices and applies migration).
--
-- Constraints (operator-locked):
--   * ADDITIVE ONLY — new table, no ALTERs to existing tables.
--   * No data mutation in this migration. The table starts empty;
--     populated by the next daily-scan run after this applies.
--   * RLS deny-all for authenticated; service_role (used by both
--     GH Actions scan AND Vercel runtime via repository) bypasses
--     RLS. Customer surfaces never read this table.
--   * Rollback: DROP TABLE IF EXISTS public.robots_state CASCADE.
--     Reverts cleanly because no other tables reference it.

CREATE TABLE IF NOT EXISTS public.robots_state (
  tenant_id        text         PRIMARY KEY,
  site_domain      text         NOT NULL,
  parsed           jsonb,
  last_fetched_at  timestamptz  NOT NULL,
  last_fetch_error text,
  schema_version   integer      NOT NULL DEFAULT 1,
  updated_at       timestamptz  NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.robots_state IS 'Phase A.3 (post-A.3.5) per-tenant robots.txt parsed-state mirror. Daily-scan dual-writes via repo.setRobotsState(); loader + diagnostics read via repo.getRobotsState(). Replaces flat-path .data/robots-state.json that returned null on production.';

COMMENT ON COLUMN public.robots_state.tenant_id IS 'Beacon tenant identifier. PK enforces one row per tenant; UPSERT-by-tenant on every scan.';

COMMENT ON COLUMN public.robots_state.parsed IS 'JSONB serialization of RobotsFile (directives[], sitemaps[], source, status, fetchedAt). Null when fetch returned non-2xx or unparseable.';

COMMENT ON COLUMN public.robots_state.schema_version IS 'Future shape evolution without breaking readers. v1 matches RobotsStateFile from src/domains/pages/robots-parser.ts.';

CREATE INDEX IF NOT EXISTS robots_state_updated_at_idx
  ON public.robots_state (updated_at DESC);

ALTER TABLE public.robots_state ENABLE ROW LEVEL SECURITY;

-- Deny-all for authenticated clients. service_role bypasses RLS.
-- Customer surfaces never read this table; only server-side
-- scan + diagnostic-loader paths via service_role.
CREATE POLICY "deny_authenticated" ON public.robots_state
  AS PERMISSIVE FOR ALL TO authenticated
  USING (false) WITH CHECK (false);
