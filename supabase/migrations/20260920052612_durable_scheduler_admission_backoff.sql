-- One durable admission clock replaces the ten-minute fleet rescan. A paused run
-- is eligible only after its stored backoff, and a completed run opens another
-- same-day pass only when the canonical planner explicitly stored a wake.
alter table public.research_runs
  add column if not exists next_dispatch_at timestamptz,
  add column if not exists dispatch_reason text,
  add column if not exists dispatch_plan jsonb,
  add column if not exists dispatch_attempts integer not null default 0;

alter table public.research_runs
  drop constraint if exists research_runs_dispatch_plan_array,
  add constraint research_runs_dispatch_plan_array
    check (dispatch_plan is null or jsonb_typeof(dispatch_plan) = 'array'),
  drop constraint if exists research_runs_dispatch_attempts_nonnegative,
  add constraint research_runs_dispatch_attempts_nonnegative
    check (dispatch_attempts >= 0);

-- Existing open rows were retryable immediately before this migration. Preserve
-- that behavior once, then every subsequent pause receives a durable backoff.
update public.research_runs
   set next_dispatch_at = now(),
       dispatch_reason = coalesce(dispatch_reason, 'migration_recovery')
 where status in ('running', 'paused')
   and next_dispatch_at is null;

create index if not exists research_runs_dispatch_due
  on public.research_runs (next_dispatch_at, tenant_id)
  where next_dispatch_at is not null and status in ('paused', 'completed');

-- Provider task GETs are free, but they still consume function CPU and log
-- volume. Their own clock is independent from the research-run clock because a
-- public cache task can be shared across tenants.
alter table public.evidence_cache
  add column if not exists next_poll_at timestamptz,
  add column if not exists poll_attempts integer not null default 0;

update public.evidence_cache
   set next_poll_at = now()
 where status = 'pending'
   and provider_task_id is not null
   and next_poll_at is null;

alter table public.evidence_cache
  drop constraint if exists evidence_cache_poll_attempts_nonnegative,
  add constraint evidence_cache_poll_attempts_nonnegative check (poll_attempts >= 0),
  drop constraint if exists evidence_cache_pending_task_has_poll_clock,
  add constraint evidence_cache_pending_task_has_poll_clock check (
    status <> 'pending' or provider_task_id is null or next_poll_at is not null
  );

create index if not exists evidence_cache_poll_due
  on public.evidence_cache (next_poll_at, updated_at)
  where status = 'pending' and provider_task_id is not null;

-- Progress remains the durable receipt visible to the runtime. When it carries
-- a dispatch object, this same row lock also stamps the indexed admission
-- columns, so the planner receipt and scheduler door cannot disagree.
create or replace function public.patch_research_run_progress(
  p_tenant_id text,
  p_run_id text,
  p_patch jsonb,
  p_increment_key text default null,
  p_increment_day text default null
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_progress jsonb;
begin
  update public.research_runs r
     set progress =
           (coalesce(r.progress, '{}'::jsonb) || coalesce(p_patch, '{}'::jsonb))
           || case when p_increment_key is null then '{}'::jsonb else jsonb_build_object(
                p_increment_key, jsonb_build_object(
                  'day', p_increment_day,
                  'count', case when coalesce(r.progress -> p_increment_key ->> 'day', '') = coalesce(p_increment_day, '')
                    then coalesce((r.progress -> p_increment_key ->> 'count')::int, 0) + 1 else 1 end)) end,
         next_dispatch_at = case when coalesce(p_patch, '{}'::jsonb) ? 'dispatch'
           then nullif(p_patch #>> '{dispatch,at}', '')::timestamptz else r.next_dispatch_at end,
         dispatch_reason = case when coalesce(p_patch, '{}'::jsonb) ? 'dispatch'
           then nullif(p_patch #>> '{dispatch,reason}', '') else r.dispatch_reason end,
         dispatch_plan = case when coalesce(p_patch, '{}'::jsonb) ? 'dispatch'
           then coalesce(p_patch #> '{dispatch,plan}', '[]'::jsonb) else r.dispatch_plan end,
         dispatch_attempts = case when coalesce(p_patch, '{}'::jsonb) ? 'dispatch'
           then greatest(0, coalesce((p_patch #>> '{dispatch,attempts}')::int, 0)) else r.dispatch_attempts end
   where r.tenant_id = p_tenant_id and r.id = p_run_id::uuid
  returning r.progress into v_progress;
  return v_progress;
end;
$$;

revoke all on function public.patch_research_run_progress(text, text, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.patch_research_run_progress(text, text, jsonb, text, text) to service_role;

-- Preserve the six-argument spend-attributing finish contract introduced by
-- 20260919170828. A pause atomically schedules exponential admission (10m..12h).
-- Completion gets one crash-safe probe; the application replaces it with the
-- exact owed-work plan or clears it after its post-cycle due read.
create or replace function public.finish_research_run(
  p_tenant_id text,
  p_run_id uuid,
  p_owner text,
  p_outcome text,
  p_error jsonb,
  p_spend_usd numeric
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_rows integer; v_attributed numeric; v_attempts integer; v_wake timestamptz;
begin
  if p_outcome not in ('paused', 'completed') then return false; end if;
  if p_spend_usd is not null and p_spend_usd < 0 then return false; end if;
  perform 1 from public.research_runs r
   where r.id = p_run_id and r.tenant_id = p_tenant_id
     and r.lease_owner = p_owner and r.lease_expires_at >= now()
     and r.status in ('running', 'paused') for update;
  if not found then return false; end if;
  select coalesce(sum(case when s.state = 'reconciled' then s.accounted_usd
                      when s.state in ('transmitted', 'ambiguous') then s.estimated_usd else 0 end), 0)
    into v_attributed from public.spend_reservations s
   where s.tenant_id = p_tenant_id and s.research_run_id = p_run_id;
  select case when p_outcome = 'paused' then least(dispatch_attempts + 1, 10) else 0 end
    into v_attempts from public.research_runs where id = p_run_id;
  v_wake := case when p_outcome = 'paused'
    then now() + least(interval '12 hours', interval '10 minutes' * power(2::numeric, greatest(v_attempts - 1, 0)))
    else now() + interval '10 minutes' end;
  update public.research_runs r
     set status = p_outcome,
         current_phase = case when p_outcome = 'completed' then 'done' else r.current_phase end,
         completed_at = case when p_outcome = 'completed' then now() else null end,
         last_error = case when p_outcome = 'completed' then null else p_error end,
         spend_usd = greatest(coalesce(r.spend_usd, 0),
           case when jsonb_typeof(r.progress #> '{funnel,spendUsd}') = 'number'
             then greatest(0, (r.progress #>> '{funnel,spendUsd}')::numeric) else 0 end,
           coalesce(v_attributed, 0), coalesce(p_spend_usd, 0)),
         next_dispatch_at = v_wake,
         dispatch_reason = case when p_outcome = 'paused' then 'paused_backoff' else 'completion_probe' end,
         dispatch_plan = case when p_outcome = 'paused' then coalesce(r.progress #> '{plan,units}', '[]'::jsonb) else '[]'::jsonb end,
         dispatch_attempts = v_attempts,
         progress = case when p_outcome = 'paused' then jsonb_set(coalesce(r.progress, '{}'::jsonb), '{dispatch}',
           jsonb_build_object('at', v_wake, 'reason', 'paused_backoff', 'plan', coalesce(r.progress #> '{plan,units}', '[]'::jsonb), 'attempts', v_attempts), true)
           else jsonb_set(coalesce(r.progress, '{}'::jsonb), '{dispatch}',
             jsonb_build_object('at', v_wake, 'reason', 'completion_probe', 'plan', '[]'::jsonb, 'attempts', 0), true) end,
         lease_owner = null, lease_expires_at = null, updated_at = now()
   where r.id = p_run_id and r.tenant_id = p_tenant_id
     and r.lease_owner = p_owner and r.lease_expires_at >= now()
     and r.status in ('running', 'paused');
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

revoke all on function public.finish_research_run(text, uuid, text, text, jsonb, numeric) from public, anon, authenticated;
grant execute on function public.finish_research_run(text, uuid, text, text, jsonb, numeric) to service_role;

-- Both doors keep using claim_research_run. Scheduler eligibility is decided by
-- claim_due_research_work; an explicit visit may still recover the same paused
-- row immediately through the same lease/runtime, never a parallel pipeline.
create or replace function public.claim_research_run(
  p_tenant_id text,
  p_owner text,
  p_lease_seconds int
) returns setof public.research_runs
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_run public.research_runs%rowtype;
begin
  if not exists (select 1 from public.tenants t where t.id = p_tenant_id and t.status = 'active' and coalesce(t.research_paused, false) = false) then return; end if;
  perform pg_advisory_xact_lock(hashtextextended('research_runs:' || p_tenant_id, 0));
  select * into v_run from public.research_runs
   where tenant_id = p_tenant_id and status in ('running', 'paused')
   order by started_at desc limit 1;
  if found then
    if v_run.lease_owner is not null and v_run.lease_owner <> p_owner and v_run.lease_expires_at >= now() then return; end if;
    return query update public.research_runs r set
      lease_owner = p_owner, lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      status = case when r.status = 'paused' then 'running' else r.status end,
      next_dispatch_at = null, dispatch_reason = null, dispatch_plan = null,
      progress = coalesce(r.progress, '{}'::jsonb) - 'dispatch', updated_at = now()
     where r.id = v_run.id and r.status in ('running', 'paused') returning r.*;
    return;
  end if;
  if exists (select 1 from public.research_runs where tenant_id = p_tenant_id and status = 'completed'
    and (completed_at at time zone 'America/Los_Angeles')::date = (now() at time zone 'America/Los_Angeles')::date) then return; end if;
  begin
    return query insert into public.research_runs
      (tenant_id, cycle_key, status, current_phase, lease_owner, lease_expires_at)
    values (p_tenant_id, p_tenant_id || ':' || to_char(now() at time zone 'America/Los_Angeles', 'YYYY-MM-DD'),
      'running', 'refresh_sources', p_owner, now() + make_interval(secs => p_lease_seconds)) returning research_runs.*;
  exception when unique_violation then return;
  end;
end;
$$;

revoke all on function public.claim_research_run(text, text, int) from public, anon, authenticated;
grant execute on function public.claim_research_run(text, text, int) to service_role;

-- Fleet admission now returns at most the requested eligible rows without a
-- planner scan. A completed row's wake is consumed under the same per-account
-- advisory lock that guards the one-open-run invariant.
create or replace function public.claim_due_research_work(
  p_owner text,
  p_limit int,
  p_lease_seconds int
) returns setof public.research_runs
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_tenant text; v_claimed int := 0; v_completed public.research_runs%rowtype; v_count int;
begin
  if p_limit is null or p_limit < 1 then return; end if;
  for v_tenant in
    select t.id from public.tenants t
     where t.status = 'active' and coalesce(t.research_paused, false) = false and (
       (not exists (select 1 from public.research_runs r where r.tenant_id = t.id and r.status in ('running','paused'))
        and not exists (select 1 from public.research_runs r where r.tenant_id = t.id and r.status = 'completed'
          and (r.completed_at at time zone 'America/Los_Angeles')::date = (now() at time zone 'America/Los_Angeles')::date))
       or exists (select 1 from public.research_runs r where r.tenant_id = t.id and (
         (r.status = 'running' and (r.lease_owner is null or r.lease_expires_at < now()))
         or (r.status = 'paused' and coalesce(r.next_dispatch_at, now()) <= now())
         or (r.status = 'completed' and r.next_dispatch_at <= now()
           and (r.completed_at at time zone 'America/Los_Angeles')::date = (now() at time zone 'America/Los_Angeles')::date)))
     )
     order by (select min(coalesce(r2.next_dispatch_at, r2.updated_at, r2.started_at)) from public.research_runs r2 where r2.tenant_id = t.id) asc nulls first, t.id
  loop
    exit when v_claimed >= p_limit;
    perform pg_advisory_xact_lock(hashtextextended('research_runs:' || v_tenant, 0));
    return query select * from public.claim_research_run(v_tenant, p_owner, p_lease_seconds);
    if found then v_claimed := v_claimed + 1; continue; end if;
    select * into v_completed from public.research_runs r where r.tenant_id = v_tenant and r.status = 'completed'
      and r.next_dispatch_at <= now()
      and (r.completed_at at time zone 'America/Los_Angeles')::date = (now() at time zone 'America/Los_Angeles')::date
      order by r.completed_at desc limit 1 for update;
    if not found then continue; end if;
    select count(*)::int into v_count from public.research_runs r where r.tenant_id = v_tenant
      and r.cycle_key like '%' || to_char(now() at time zone 'America/Los_Angeles', 'YYYY-MM-DD');
    begin
      return query insert into public.research_runs
        (tenant_id, cycle_key, status, current_phase, lease_owner, lease_expires_at, progress)
      values (v_tenant, v_tenant || ':p' || (v_count + 1)::text || ':' || to_char(now() at time zone 'America/Los_Angeles', 'YYYY-MM-DD'),
        'running', 'refresh_sources', p_owner, now() + make_interval(secs => p_lease_seconds),
        case when jsonb_array_length(coalesce(v_completed.dispatch_plan, '[]'::jsonb)) > 0
          then jsonb_build_object('plan', jsonb_build_object('units', v_completed.dispatch_plan, 'openedFor', true)) else '{}'::jsonb end)
      returning research_runs.*;
      update public.research_runs set next_dispatch_at = null, dispatch_reason = null, dispatch_plan = null
       where id = v_completed.id;
      v_claimed := v_claimed + 1;
    exception when unique_violation then continue;
    end;
  end loop;
end;
$$;

revoke all on function public.claim_due_research_work(text, int, int) from public, anon, authenticated;
grant execute on function public.claim_due_research_work(text, int, int) to service_role;
