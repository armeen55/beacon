-- 2026-08-01  V1 Closure: the research day rolls at the operator's midnight, not 5 PM.
--
-- The daily cycle_key and the "already completed today" check both computed the day
-- as UTC at database time, while the product, GSC reporting and the new planner day
-- (src/lib/reporting-day.ts) speak America/Los_Angeles. Between 5 PM and midnight
-- Pacific the two disagreed: a run finished that morning looked like yesterday's, and
-- a new daily cycle could open while the operator's calendar still said the same day.
--
-- This replaces claim_research_run in place with the identical body except that both
-- day computations use America/Los_Angeles. Reversible: re-run the 2026-07-24
-- claim-semantics migration to restore the UTC version. Cycle keys already stored
-- under UTC labels are history and are not touched; at the seam the completed-today
-- check simply keeps today closed until the operator's real midnight, which can only
-- suppress a redundant run, never duplicate one (the unique index still holds).

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
  -- start date: yesterday's paused/running run is resumed, never ignored.
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

  -- No unfinished run exists. If a run already completed during the current
  -- Pacific day, research is current for today: no redundant same-day pass.
  if exists (
    select 1 from public.research_runs
     where tenant_id = p_tenant_id
       and status = 'completed'
       and (completed_at at time zone 'America/Los_Angeles')::date
         = (now() at time zone 'America/Los_Angeles')::date
  ) then
    return;
  end if;

  -- Otherwise start today's cycle, with the cycle_key computed at DATABASE time
  -- in the one reporting timezone the whole product speaks.
  begin
    return query
    insert into public.research_runs
      (tenant_id, cycle_key, status, current_phase, lease_owner, lease_expires_at)
    values
      (p_tenant_id,
       p_tenant_id || ':' || to_char(now() at time zone 'America/Los_Angeles', 'YYYY-MM-DD'),
       'running', 'refresh_sources', p_owner,
       now() + make_interval(secs => p_lease_seconds))
    returning research_runs.*;
  exception when unique_violation then
    return; -- a concurrent visit already created today's cycle or an open run
  end;
end;
$$;
