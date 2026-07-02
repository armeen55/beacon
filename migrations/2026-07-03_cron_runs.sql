-- 2026-07-03 - cron_runs: a durable ledger of every nightly job run (BEACON_500
-- item 85). syncAllConnectedForActiveTenants (src/lib/connectors/cron-sync.ts)
-- and the measure-due runner (src/app/api/cron/measure-due/route.ts) already
-- compute rich per-run results - which sources synced, which failed, how long
-- it took - but today that detail only ever hits log.info and vanishes once
-- Vercel rotates the function logs. This table gives the health panel on
-- /settings/connectors (and item 84's failure-streak/token-expiry escalation,
-- which reads per_source off this same ledger) something durable to read.
--
-- One row per (job) run. `tenant_id` is NULLABLE: most jobs here are FLEET-
-- level (one cron invocation fans out across every active tenant in a single
-- run), so a single row with tenant_id=NULL carries the whole night's summary
-- in `per_source`. A future per-tenant job can still write a scoped row by
-- setting tenant_id - the column is additive-flexible, not fleet-only by
-- constraint.
--
-- Additive, idempotent (CREATE TABLE IF NOT EXISTS + guarded policy/index
-- creation - safe to re-run). RLS mirrors the gsc_backfill_progress /
-- outreach_pipeline peers: deny anon outright, authenticated members scoped
-- to their own tenant OR to fleet-level rows (tenant_id IS NULL) so the
-- single-operator app can still read the nightly summary it wrote.
--
-- Written/read by src/domains/ops/cron-runs-store.ts. The store tolerates this
-- table not existing yet (PostgREST PGRST205 / raw Postgres 42P01) by falling
-- back to a local json-store file, so deploy order (code before migration)
-- never breaks the sync it is trying to observe.

CREATE TABLE IF NOT EXISTS public.cron_runs (
  id            bigint GENERATED ALWAYS AS IDENTITY,
  -- NULL = fleet-level row (the job fanned out across every active tenant in
  -- one run and this row IS that run's summary). Non-null when a job is
  -- scoped to one tenant.
  tenant_id     text,
  -- Stable job identifier, e.g. "sync-connectors", "measure-due".
  job           text NOT NULL,
  started_at    timestamptz NOT NULL,
  finished_at   timestamptz NOT NULL,
  duration_ms   integer NOT NULL,
  -- Overall verdict for the run: true when every source/tenant it touched
  -- succeeded (or there was nothing to do); false when at least one source
  -- failed. A run that threw before finishing is still written (fail-soft
  -- caller wraps every write in try/catch) with ok=false and the error
  -- folded into `notes`.
  ok            boolean NOT NULL,
  -- Per-source (or per-tenant) breakdown for this run, e.g.
  --   [{"tenant_id":"tenant-iranopedia","provider":"google_gsc","ok":true,"detail":"synced"}, ...]
  -- Shape is job-specific by convention, not a DB constraint - the store
  -- layer's TypeScript types are the contract.
  per_source    jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Free-form counts/flags that don't fit per_source: tenants touched,
  -- candidates skipped, backlog remaining, deadline-hit flags, the run's
  -- own error message when it threw before finishing normally.
  notes         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS cron_runs_job_started_at_idx
  ON public.cron_runs (job, started_at DESC);

CREATE INDEX IF NOT EXISTS cron_runs_tenant_id_idx
  ON public.cron_runs (tenant_id)
  WHERE tenant_id IS NOT NULL;

ALTER TABLE public.cron_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deny_anon ON public.cron_runs;
CREATE POLICY deny_anon ON public.cron_runs AS PERMISSIVE FOR ALL TO anon USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS tenant_authenticated_rw ON public.cron_runs;
CREATE POLICY tenant_authenticated_rw ON public.cron_runs AS PERMISSIVE FOR ALL TO authenticated
  USING (tenant_id IS NULL OR is_tenant_member(tenant_id))
  WITH CHECK (tenant_id IS NULL OR is_tenant_member(tenant_id));
