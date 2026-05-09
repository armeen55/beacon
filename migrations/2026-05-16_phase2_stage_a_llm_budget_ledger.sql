-- ============================================================================
-- Migration: 2026-05-16_phase2_stage_a_llm_budget_ledger.sql
-- Author:    Armeen Aminzadeh (operator) + Claude
-- Applied:   NOT APPLIED — apply via `supabase db query --linked --file ...`
--            after operator review.
-- Project:   jdegznovgysxyweknewh (beacon)
-- Phase:     Phase 2 Stage A — LLM budget ledger Supabase shadow
-- Plan:      docs/LLM_BUDGET_LEDGER_PLAN_2026_05_09.md
-- Depends:   E0 helper public.is_tenant_member(text) already applied.
-- ============================================================================
--
-- Purpose
-- -------
-- Move the LLM budget ledger off `.data/*.json` (ephemeral local FS) onto
-- Supabase so spend tracking survives across GitHub Actions runs and
-- Vercel deploys. Per-tenant + per-platform + per-day granularity, which
-- the current single-cap shape (`BEACON_DAILY_BUDGET_USD_PER_TENANT=$10`)
-- cannot represent.
--
-- Today's cost asymmetry — Perplexity ~$0.09 vs ChatGPT ~$2.88 per
-- 100-prompt run — makes per-platform tracking load-bearing, not a
-- nice-to-have.
--
-- Stage A scope (this migration)
-- ------------------------------
-- Additive ONLY:
--   • CREATE TABLE public.llm_budget_ledger
--   • Indexes for the common access patterns
--   • RLS: deny_anon + tenant_authenticated_rw (matches Cat-A1/A2/B
--     after E1.A/B/C; pattern proven safe under live cron load)
--   • Nonempty tenant_id CHECK + nonnegative checks on counters
--
-- Stage A does NOT:
--   • Wire the ledger into runtime budget enforcement (Stage B).
--   • Migrate `.data/cost-ledger.json` or `.data/global/llm-budget.json`
--     rows into the new table (Stage B / C; explicit dual-write window).
--   • Remove or deprecate the existing JSON-backed ledgers.
--   • Touch any other table.
--   • Mutate any rows.
--
-- Why the table is keyed (tenant_id, date_utc, platform)
-- ------------------------------------------------------
-- One row per tenant per UTC date per platform is the smallest grain
-- that captures every budget question we currently ask:
--   • "What did Ritz spend on ChatGPT today?" → single-row read
--   • "Should the next ChatGPT poll run?" → compare spent_usd to cap
--   • "What's the global spend today?" → SUM(spent_usd) by date
--   • "Which tenant exceeded their per-tenant cap on which day?" →
--     index-friendly read by (tenant_id, date_utc).
-- Anything finer (per-call rows) belongs in an append-only event table
-- (Stage C if needed); per-tenant/date/platform aggregate is enough
-- for enforcement.
--
-- UPSERT semantics
-- ----------------
-- The Stage B writer will use ON CONFLICT (tenant_id, date_utc, platform)
-- DO UPDATE to atomically increment counters. Single-row contention is
-- fine at one tenant; if customer #N stresses it, partition by hour or
-- chunk_offset later.
--
-- Cap configuration
-- -----------------
-- `daily_cap_usd` is per-row, optional, NULL = "use env default":
--   BEACON_DAILY_BUDGET_USD_PER_TENANT  (existing, $10 default)
--   BEACON_DAILY_BUDGET_GLOBAL_USD       (existing, $20 default)
--   BEACON_PER_RUN_BUDGET_USD            (existing, $8 default)
-- Stage B will read env first, then per-row override. Operators can
-- raise/lower a tenant's cap without redeploying by writing this column.
--
-- Platform enum
-- -------------
-- Open enum via CHECK so we can add platforms (claude, gemini, etc.)
-- with a column-rewrite-free ALTER. The four current values cover:
--   • 'perplexity'             — Perplexity native poll
--   • 'openai'                 — ChatGPT native poll (matches the
--                                 observation_runs.source label
--                                 'openai-native-poll')
--   • 'adjudicator-openai'     — gpt-4o adjudicator in rec generation
--                                 (today tracked in
--                                 .data/global/llm-budget.json)
--   • 'other'                  — escape hatch
--
-- RLS posture
-- -----------
-- Matches the policy shape that has held cleanly through E1.A, E1.B,
-- and E1.C: anon denied; authenticated callers must be a tenant
-- member; service_role bypasses RLS for the cron writer.
--
-- Rollback
-- --------
-- Single DROP TABLE in commented block at the bottom. Safe because
-- nothing in the runtime references the table yet (Stage A is shadow-
-- only).
--
-- ============================================================================

BEGIN;

-- ─── Table ────────────────────────────────────────────────────────────────

CREATE TABLE public.llm_budget_ledger (
  tenant_id      text         NOT NULL,
  date_utc       date         NOT NULL,
  platform       text         NOT NULL,
  spent_usd      numeric(12,6) NOT NULL DEFAULT 0,
  call_count     integer      NOT NULL DEFAULT 0,
  prompt_count   integer      NOT NULL DEFAULT 0,
  chunk_count    integer      NOT NULL DEFAULT 0,
  daily_cap_usd  numeric(12,6),
  last_run_id    text,
  metadata       jsonb,
  created_at     timestamptz  NOT NULL DEFAULT now(),
  updated_at     timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT llm_budget_ledger_pkey
    PRIMARY KEY (tenant_id, date_utc, platform),
  CONSTRAINT llm_budget_ledger_tenant_id_nonempty_chk
    CHECK (tenant_id <> ''),
  CONSTRAINT llm_budget_ledger_platform_chk
    CHECK (platform IN ('perplexity', 'openai', 'adjudicator-openai', 'other')),
  CONSTRAINT llm_budget_ledger_spent_usd_nonneg_chk
    CHECK (spent_usd >= 0),
  CONSTRAINT llm_budget_ledger_call_count_nonneg_chk
    CHECK (call_count >= 0),
  CONSTRAINT llm_budget_ledger_prompt_count_nonneg_chk
    CHECK (prompt_count >= 0),
  CONSTRAINT llm_budget_ledger_chunk_count_nonneg_chk
    CHECK (chunk_count >= 0),
  CONSTRAINT llm_budget_ledger_daily_cap_usd_nonneg_chk
    CHECK (daily_cap_usd IS NULL OR daily_cap_usd >= 0)
);

COMMENT ON TABLE public.llm_budget_ledger IS
  'Phase 2 Stage A (2026-05-16). Per-tenant per-day per-platform LLM '
  'spend ledger. Replaces .data/cost-ledger.json + '
  '.data/global/llm-budget.json. Stage A is shadow only — runtime '
  'enforcement migrates in Stage B.';

-- ─── Indexes ──────────────────────────────────────────────────────────────

-- Most-recent-first reads scoped to a tenant (dashboards, ops queries).
CREATE INDEX llm_budget_ledger_tenant_date_idx
  ON public.llm_budget_ledger (tenant_id, date_utc DESC);

-- Global "today's spend" aggregation across tenants (canary, ops).
CREATE INDEX llm_budget_ledger_date_idx
  ON public.llm_budget_ledger (date_utc DESC);

-- ─── RLS ──────────────────────────────────────────────────────────────────

ALTER TABLE public.llm_budget_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.llm_budget_ledger FORCE  ROW LEVEL SECURITY;

CREATE POLICY "deny_anon" ON public.llm_budget_ledger
  AS PERMISSIVE FOR ALL TO anon
  USING (false) WITH CHECK (false);

CREATE POLICY "tenant_authenticated_rw" ON public.llm_budget_ledger
  AS PERMISSIVE FOR ALL TO authenticated
  USING      (public.is_tenant_member(tenant_id))
  WITH CHECK (public.is_tenant_member(tenant_id));

COMMIT;

-- ============================================================================
-- ROLLBACK (commented out; uncomment + apply only if rollback is required)
-- ============================================================================
-- BEGIN;
--   DROP POLICY "tenant_authenticated_rw" ON public.llm_budget_ledger;
--   DROP POLICY "deny_anon" ON public.llm_budget_ledger;
--   DROP TABLE public.llm_budget_ledger;
-- COMMIT;
-- ============================================================================
