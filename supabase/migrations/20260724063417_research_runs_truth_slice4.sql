-- Research Run truth + database-time lease mutations (Slice 4 truth repair, 2026-07-24).
-- Full rationale in migrations/2026-07-24_research_runs_truth.sql (repo copy). Idempotent.

alter table public.research_runs drop constraint if exists research_runs_status_check;
alter table public.research_runs
  add constraint research_runs_status_check check (status in ('running', 'paused', 'completed'));

create or replace function public.advance_research_run(
  p_tenant_id     text,
  p_run_id        uuid,
  p_owner         text,
  p_next_phase    text,
  p_progress      jsonb,
  p_cursor        jsonb,
  p_lease_seconds int
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows int;
begin
  update public.research_runs r
     set current_phase    = p_next_phase,
         progress         = coalesce(p_progress, r.progress),
         phase_cursor     = p_cursor,
         updated_at       = now(),
         lease_expires_at = now() + make_interval(secs => p_lease_seconds)
   where r.id = p_run_id
     and r.tenant_id = p_tenant_id
     and r.lease_owner = p_owner
     and r.lease_expires_at >= now()
     and r.status = 'running';
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

create or replace function public.renew_research_lease(
  p_tenant_id     text,
  p_run_id        uuid,
  p_owner         text,
  p_cursor        jsonb,
  p_lease_seconds int
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows int;
begin
  update public.research_runs r
     set phase_cursor     = p_cursor,
         updated_at       = now(),
         lease_expires_at = now() + make_interval(secs => p_lease_seconds)
   where r.id = p_run_id
     and r.tenant_id = p_tenant_id
     and r.lease_owner = p_owner
     and r.lease_expires_at >= now()
     and r.status = 'running';
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

create or replace function public.finish_research_run(
  p_tenant_id text,
  p_run_id    uuid,
  p_owner     text,
  p_outcome   text,
  p_error     jsonb
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows int;
begin
  update public.research_runs r
     set status        = p_outcome,
         current_phase = case when p_outcome = 'completed' then 'done' else r.current_phase end,
         completed_at  = case when p_outcome = 'completed' then now() else null end,
         last_error    = case when p_outcome = 'completed' then null else p_error end,
         lease_owner       = null,
         lease_expires_at  = null,
         updated_at        = now()
   where r.id = p_run_id
     and r.tenant_id = p_tenant_id
     and r.lease_owner = p_owner
     and r.lease_expires_at >= now()
     and r.status in ('running', 'paused');
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

revoke all on function public.advance_research_run(text, uuid, text, text, jsonb, jsonb, int) from public;
revoke all on function public.advance_research_run(text, uuid, text, text, jsonb, jsonb, int) from anon;
revoke all on function public.advance_research_run(text, uuid, text, text, jsonb, jsonb, int) from authenticated;
grant execute on function public.advance_research_run(text, uuid, text, text, jsonb, jsonb, int) to service_role;

revoke all on function public.renew_research_lease(text, uuid, text, jsonb, int) from public;
revoke all on function public.renew_research_lease(text, uuid, text, jsonb, int) from anon;
revoke all on function public.renew_research_lease(text, uuid, text, jsonb, int) from authenticated;
grant execute on function public.renew_research_lease(text, uuid, text, jsonb, int) to service_role;

revoke all on function public.finish_research_run(text, uuid, text, text, jsonb) from public;
revoke all on function public.finish_research_run(text, uuid, text, text, jsonb) from anon;
revoke all on function public.finish_research_run(text, uuid, text, text, jsonb) from authenticated;
grant execute on function public.finish_research_run(text, uuid, text, text, jsonb) to service_role;;
