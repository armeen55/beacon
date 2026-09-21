-- Durable visit-driven Research Runs (Slice 4, 2026-07-24).
-- Full rationale in migrations/2026-07-24_research_runs.sql (repo copy).
-- Idempotent: safe to re-run.

create table if not exists public.research_runs (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      text not null references public.tenants(id),
  cycle_key      text not null,
  status         text not null check (status in ('running','paused','completed','failed')),
  current_phase  text not null check (current_phase in ('refresh_sources','gsc_backfill_chunk','publish_surface','done')),
  phase_cursor   jsonb,
  progress       jsonb not null default '{}'::jsonb,
  spend_usd      numeric not null default 0,
  last_error     jsonb,
  lease_owner    text,
  lease_expires_at timestamptz,
  started_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  completed_at   timestamptz
);

create unique index if not exists research_runs_cycle
  on public.research_runs (tenant_id, cycle_key);
create index if not exists research_runs_latest
  on public.research_runs (tenant_id, started_at desc);

alter table public.research_runs enable row level security;

drop policy if exists deny_anon on public.research_runs;
create policy deny_anon on public.research_runs
  as permissive for all to anon
  using (false) with check (false);

drop policy if exists tenant_authenticated_select on public.research_runs;
create policy tenant_authenticated_select on public.research_runs
  as permissive for select to authenticated
  using (is_tenant_member(tenant_id));

create or replace function public.claim_research_run(
  p_tenant_id     text,
  p_cycle_key     text,
  p_owner         text,
  p_lease_seconds int
) returns setof public.research_runs
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.research_runs r
     set lease_owner = p_owner,
         lease_expires_at = now() + make_interval(secs => p_lease_seconds),
         status = case when r.status = 'paused' then 'running' else r.status end,
         updated_at = now()
   where r.tenant_id = p_tenant_id
     and r.cycle_key = p_cycle_key
     and r.status in ('running','paused')
     and (r.lease_owner is null or r.lease_expires_at < now() or r.lease_owner = p_owner)
  returning r.*;
  if found then
    return;
  end if;

  begin
    return query
    insert into public.research_runs
      (tenant_id, cycle_key, status, current_phase, lease_owner, lease_expires_at)
    values
      (p_tenant_id, p_cycle_key, 'running', 'refresh_sources', p_owner,
       now() + make_interval(secs => p_lease_seconds))
    returning research_runs.*;
  exception when unique_violation then
    return;
  end;
end;
$$;

revoke all on function public.claim_research_run(text, text, text, int) from public;
revoke all on function public.claim_research_run(text, text, text, int) from anon;
revoke all on function public.claim_research_run(text, text, text, int) from authenticated;
grant execute on function public.claim_research_run(text, text, text, int) to service_role;;
