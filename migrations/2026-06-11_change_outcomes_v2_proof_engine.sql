-- 2026-06-11 (dream shift) — change_outcomes_v2: durable Supabase home for the
-- causal Proof Engine's StoredChangeOutcome.
--
-- THE DURABILITY FIX. The Proof Engine (natural-controls → StoredChangeOutcome)
-- persisted ONLY through the local json-store ("change-outcomes"), which:
--   • skips disk entirely on Vercel (lambda FS read-only → in-process cache
--     only, empty on every cold start), and
--   • is ephemeral on the nightly cron runner (GitHub Actions FS wiped after
--     the job).
-- It was NEVER dual-written to Supabase and readStore never hydrates from
-- Supabase — so loadChangeOutcomeById returned empty in production and the
-- causal /changes/[id] drilldown + the Move Forecast never lit up for a real
-- user, even after the engine was wired into the nightly cron.
--
-- This is the durable home: the engine dual-writes the full StoredChangeOutcome
-- as JSONB here (service-role, gated on DUAL_WRITE), and the web app hydrates
-- from it when the local store is empty (the hosted case).
--
-- Additive + idempotent. DISTINCT from the legacy `change_outcomes` table (the
-- old pre/post-delta `ChangeOutcome` shape, fed by syncChangeOutcomes) — that
-- system is left completely untouched. RLS mirrors the peer tables exactly:
-- deny anon; authenticated gated by is_tenant_member(tenant_id); the
-- service-role client (cron dual-write) bypasses RLS.
--
-- APPLIED to production via MCP 2026-06-11 (dream shift).

CREATE TABLE IF NOT EXISTS public.change_outcomes_v2 (
  id             text PRIMARY KEY,            -- `${tenant_id}::${source_id}`
  tenant_id      text NOT NULL,
  source_id      text NOT NULL,
  status         text,                        -- top-level for queryability
  primary_bucket text,                        -- top-level for queryability
  outcome        jsonb NOT NULL,              -- the full StoredChangeOutcome
  computed_at    timestamptz,
  stored_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, source_id)
);

CREATE INDEX IF NOT EXISTS change_outcomes_v2_tenant_idx
  ON public.change_outcomes_v2 (tenant_id);

ALTER TABLE public.change_outcomes_v2 ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deny_anon ON public.change_outcomes_v2;
CREATE POLICY deny_anon ON public.change_outcomes_v2
  AS PERMISSIVE FOR ALL TO anon
  USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS tenant_authenticated_rw ON public.change_outcomes_v2;
CREATE POLICY tenant_authenticated_rw ON public.change_outcomes_v2
  AS PERMISSIVE FOR ALL TO authenticated
  USING (is_tenant_member(tenant_id))
  WITH CHECK (is_tenant_member(tenant_id));
