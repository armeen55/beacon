-- Refresh ledger (refresh-reliability wave, 2026-07-11, BUG 3).
create table if not exists public.refresh_runs (
  id             bigint generated always as identity,
  tenant_id      text not null,
  source         text not null,
  trigger        text not null,
  started_at     timestamptz not null,
  finished_at    timestamptz not null,
  duration_ms    integer not null,
  result         text not null,
  rows_persisted integer,
  latest_data_date date,
  failure_category text,
  next_retry_at  timestamptz,
  created_at     timestamptz not null default now(),
  primary key (id)
);

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
  with check (is_tenant_member(tenant_id));;
