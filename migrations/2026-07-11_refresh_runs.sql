-- Refresh ledger (refresh-reliability wave, 2026-07-11, BUG 3).
--
-- WHY: cron_runs records ONE fleet-level row per nightly job with a count-free
-- per_source[] array. It cannot answer the operator's real question per source:
-- "when did you last pull this, what date is the data current through, and did
-- it actually work?" The 2026-07-11 connector-truth probe found:
--   * a real manual/on-use pull leaves NO cron_runs row (only the nightly job
--     records), so refreshes triggered by the operator or by visiting the app
--     were invisible;
--   * a run-level ok:true coexisted with per-source failures;
--   * Profound reported "synced today" while its newest data row was 14 days
--     old (0 new rows written = a silent partial that read as a success).
--
-- This table is the source-by-source ledger EVERY refresh path records into
-- (cron, manual "Refresh my data", and on-use auto-refresh all converge on the
-- one recordRefreshRun implementation). One row per (tenant, source, trigger,
-- run) with an HONEST per-source result (ok / partial / failed), the rows it
-- persisted (so a 0-row "success" shows as partial), the newest source data
-- date after the run, the failure category, and when Beacon will retry.
--
-- ADDITIVE + tenant-scoped. Mirrors the RLS posture of the sibling per-tenant
-- table migrations/2026-07-02_gsc_backfill_progress.sql: deny anon entirely,
-- authenticated access gated to tenant members via is_tenant_member(tenant_id).
-- Service-role writes (the sync/cron paths) bypass RLS as usual. The store
-- (src/domains/ops/refresh-runs-store.ts) fails soft to a file mirror until this
-- is applied, so deploy order (code before migration) never breaks a sync.

create table if not exists public.refresh_runs (
  id             bigint generated always as identity,
  tenant_id      text not null,
  source         text not null,        -- gsc / ga4 / clarity / profound
  trigger        text not null,        -- cron / manual / on-use
  started_at     timestamptz not null,
  finished_at    timestamptz not null,
  duration_ms    integer not null,
  result         text not null,        -- ok / partial / failed
  rows_persisted integer,              -- null when not cheaply known
  latest_data_date date,               -- newest source data date AFTER this run
  failure_category text,               -- honest reason code when result <> 'ok'
  next_retry_at  timestamptz,          -- when Beacon retries on its own (null = operator-driven)
  created_at     timestamptz not null default now(),
  primary key (id)
);

-- Newest-first per (tenant, source): the escalation streak read + the
-- per-source "last pulled / data through / result" strip both key off this.
create index if not exists refresh_runs_tenant_source_started_idx
  on public.refresh_runs (tenant_id, source, started_at desc);
create index if not exists refresh_runs_tenant_started_idx
  on public.refresh_runs (tenant_id, started_at desc);

alter table public.refresh_runs enable row level security;

drop policy if exists deny_anon on public.refresh_runs;
create policy deny_anon on public.refresh_runs
  as permissive for all to anon
  using (false) with check (false);

drop policy if exists tenant_authenticated_rw on public.refresh_runs;
create policy tenant_authenticated_rw on public.refresh_runs
  as permissive for all to authenticated
  using (is_tenant_member(tenant_id))
  with check (is_tenant_member(tenant_id));
