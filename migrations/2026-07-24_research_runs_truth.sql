-- Research Run truth + database-time lease mutations (Slice 4 truth repair, 2026-07-24).
--
-- ADDITIVE follow-on to 2026-07-24_research_runs.sql (which stays immutable). The
-- first cut wrote advance / finish through plain table UPDATEs guarded only by
-- (id, tenant, lease_owner) - an EXPIRED owner could still advance, and a swallowed
-- phase error could still reach 'completed'. This migration moves advance, a new
-- pre-phase renew, and finish into SECURITY DEFINER functions that guard ownership
-- AND lease freshness AND status at DATABASE time, so:
--   - an expired-lease owner cannot advance / renew / finish (its work was recovered);
--   - a completed row can never be advanced or renewed;
--   - 'completed' clears last_error, so a swallowed error can never present as done;
--   - the pre-phase renew persists the phase attempt identity (phase_cursor) durably
--     BEFORE the side effect, so an interrupted retry proves the same unit of work.
--
-- It also narrows the status CHECK to the three honestly-produced states. There is
-- no honest producer of 'failed' (transient phase errors PAUSE with a bounded
-- last_error); the orchestrator verified zero 'failed' rows in production.
--
-- SECURITY: all writes go through the service-role admin client. These functions
-- are SECURITY DEFINER, tenant-scoped by the explicit p_tenant_id argument, revoke
-- public / anon / authenticated execute, and grant execute to service_role only.
--
-- NOT YET APPLIED TO PROD - apply via MCP apply_migration (operator-approved).
-- Idempotent: safe to re-run.

-- 1) Narrow the status vocabulary to the three honestly-produced states.
alter table public.research_runs drop constraint if exists research_runs_status_check;
alter table public.research_runs
  add constraint research_runs_status_check check (status in ('running', 'paused', 'completed'));

-- 2) advance_research_run: move to the next phase, guarded by ownership + a LIVE
--    lease + status = 'running'. progress is preserved when p_progress is null;
--    phase_cursor is set to p_cursor (null CLEARS the completed phase's attempt
--    identity). Returns whether a row matched (false ⇒ lease lost/expired/finished).
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

-- 3) renew_research_lease: extend the lease AND persist the pre-phase attempt
--    identity (phase_cursor) WITHOUT changing the phase. Same guards as advance.
--    Called BEFORE each phase side effect; a false return aborts before the work.
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

-- 4) finish_research_run: terminal update releasing the lease. 'completed' sets
--    current_phase='done', stamps completed_at, and CLEARS last_error; 'paused'
--    records the bounded p_error. Guards ownership + a LIVE lease + status in
--    ('running','paused'). Returns whether a row matched.
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

-- SECURITY DEFINER + tenant-scoped by the explicit p_tenant_id arg. Deny direct
-- anon / authenticated execution; grant execute to service_role only (explicit,
-- not relying on default privileges - without it the mutation would fail closed).
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
grant execute on function public.finish_research_run(text, uuid, text, text, jsonb) to service_role;
