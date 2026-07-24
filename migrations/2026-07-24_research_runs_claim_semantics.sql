-- Research Run claim semantics repair (Slice 4 follow-on, 2026-07-24).
--
-- ADDITIVE follow-on to 2026-07-24_research_runs.sql and
-- 2026-07-24_research_runs_truth.sql (both stay immutable). It fixes a confirmed
-- cross-day duplicate-run bug: the original claim searched ONLY today's cycle_key
-- and the only uniqueness was (tenant_id, cycle_key), so a paused or running run
-- left over from an earlier UTC day was invisible to today's claim, and a SECOND
-- open run was created today. The account then had two unfinished runs racing the
-- same account, and yesterday's partial progress was stranded.
--
-- FIX, two parts:
--   1) A partial unique index makes "at most one unfinished (running or paused)
--      run per account, across ALL dates" a DATABASE invariant, not a hope.
--   2) A new 3-arg claim_research_run finds-or-resumes the single unfinished run
--      for the account regardless of its cycle_key or start date, computes the
--      daily cycle_key at DATABASE time, and only ever creates a new daily cycle
--      when no unfinished run exists and none completed already this UTC day.
--
-- The claim serializes the find-or-create decision per account with a transaction
-- advisory lock; the partial unique index remains the durable invariant under any
-- race the advisory lock does not cover.
--
-- SECURITY: unchanged posture. SECURITY DEFINER, tenant-scoped by the explicit
-- p_tenant_id argument, revoke public / anon / authenticated, grant execute to
-- service_role only. All writes go through the service-role admin client.
--
-- APPLIED TO PROD 2026-07-24 as research_runs_claim_semantics_slice4 (MCP
-- apply_migration, operator-approved). Idempotent: safe to re-run.

-- 1) Durable invariant: at most one unfinished run per account, across all dates.
create unique index if not exists research_runs_one_open_per_tenant
  on public.research_runs (tenant_id)
  where status in ('running', 'paused');

-- 2) Replace the claim with a NEW 3-arg signature (the cycle_key is now computed
--    at DATABASE time, not passed by the caller) and drop the superseded 4-arg one.
drop function if exists public.claim_research_run(text, text, text, int);

create or replace function public.claim_research_run(
  p_tenant_id     text,
  p_owner         text,
  p_lease_seconds int
) returns setof public.research_runs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run   public.research_runs%rowtype;
begin
  -- Serialize the find-or-create decision per account so two concurrent visits
  -- cannot both decide "no open run exists" and both insert. The partial unique
  -- index is the durable invariant regardless; this just avoids a lost race.
  perform pg_advisory_xact_lock(hashtextextended('research_runs:' || p_tenant_id, 0));

  -- Find the single unfinished run for the account, regardless of cycle_key or
  -- start date. This is what fixes the cross-day duplicate-run bug: yesterday's
  -- paused/running run is resumed, never ignored.
  select * into v_run
    from public.research_runs
   where tenant_id = p_tenant_id
     and status in ('running', 'paused')
   order by started_at desc
   limit 1;

  if found then
    -- A foreign, still-live lease means another invocation is actively driving
    -- this run: do not disturb it, and never create a second run.
    if v_run.lease_owner is not null
       and v_run.lease_owner <> p_owner
       and v_run.lease_expires_at >= now() then
      return;
    end if;

    -- Otherwise the run is unleased, its lease expired, it is paused, or it is
    -- already ours: claim THAT row. id, cycle_key, current_phase, phase_cursor,
    -- progress, and last_error are all preserved (last_error clears only on a
    -- later successful finish_research_run).
    return query
    update public.research_runs r
       set lease_owner      = p_owner,
           lease_expires_at  = now() + make_interval(secs => p_lease_seconds),
           status            = case when r.status = 'paused' then 'running' else r.status end,
           updated_at        = now()
     where r.id = v_run.id
       and r.status in ('running', 'paused')
    returning r.*;
    return;
  end if;

  -- No unfinished run exists. If a run already completed during the current UTC
  -- day, research is current for today: do no redundant same-day maintenance pass.
  if exists (
    select 1 from public.research_runs
     where tenant_id = p_tenant_id
       and status = 'completed'
       and (completed_at at time zone 'utc')::date = (now() at time zone 'utc')::date
  ) then
    return;
  end if;

  -- Otherwise start today's cycle, with the cycle_key computed at DATABASE time.
  -- The begin/exception guard covers both the (tenant, cycle_key) unique index and
  -- the new partial unique index under any race the advisory lock did not serialize.
  begin
    return query
    insert into public.research_runs
      (tenant_id, cycle_key, status, current_phase, lease_owner, lease_expires_at)
    values
      (p_tenant_id,
       p_tenant_id || ':' || to_char(now() at time zone 'utc', 'YYYY-MM-DD'),
       'running', 'refresh_sources', p_owner,
       now() + make_interval(secs => p_lease_seconds))
    returning research_runs.*;
  exception when unique_violation then
    return; -- a concurrent visit already created today's cycle or an open run
  end;
end;
$$;

-- SECURITY DEFINER + tenant-scoped by the explicit p_tenant_id arg (the app calls
-- it with the service-role admin client, which bypasses RLS). Deny direct
-- anon/authenticated execution; grant execute to service_role only (explicit, not
-- relying on default privileges - without it the claim would fail closed forever
-- and no run would ever start).
revoke all on function public.claim_research_run(text, text, int) from public;
revoke all on function public.claim_research_run(text, text, int) from anon;
revoke all on function public.claim_research_run(text, text, int) from authenticated;
grant execute on function public.claim_research_run(text, text, int) to service_role;
