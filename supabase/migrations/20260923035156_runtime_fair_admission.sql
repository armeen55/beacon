-- Forward-only replacement of the two existing service-role RPCs. No rows or evidence are deleted.
-- Ordinary continuation and provider waits keep the ten-minute dispatcher cadence;
-- only a persisted error earns exponential backoff. Admission rotates by the
-- latest service of current/open work, never the oldest historical run.
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
declare v_rows integer; v_attributed numeric; v_attempts integer; v_wake timestamptz; v_reason text;
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
  select case when p_outcome = 'paused' and p_error is not null then least(dispatch_attempts + 1, 10) else 0 end
    into v_attempts from public.research_runs where id = p_run_id;
  v_reason := case when p_outcome = 'completed' then 'completion_probe'
    when p_error is not null then 'failure_backoff'
    when exists (select 1 from public.research_runs where id = p_run_id and progress ? 'providerWait') then 'provider_wait'
    else 'continuation' end;
  v_wake := case when v_reason = 'failure_backoff'
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
         dispatch_reason = v_reason,
         dispatch_plan = case when p_outcome = 'paused' then coalesce(r.progress #> '{plan,units}', '[]'::jsonb) else '[]'::jsonb end,
         dispatch_attempts = v_attempts,
         progress = case when p_outcome = 'paused' then jsonb_set(coalesce(r.progress, '{}'::jsonb), '{dispatch}',
           jsonb_build_object('at', v_wake, 'reason', v_reason, 'plan', coalesce(r.progress #> '{plan,units}', '[]'::jsonb), 'attempts', v_attempts), true)
           else jsonb_set(coalesce(r.progress, '{}'::jsonb), '{dispatch}',
             jsonb_build_object('at', v_wake, 'reason', v_reason, 'plan', '[]'::jsonb, 'attempts', 0), true) end,
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
           and (r.completed_at at time zone 'America/Los_Angeles')::date = (now() at time zone 'America/Los_Angeles')::date
           and r.id = (select newest.id from public.research_runs newest where newest.tenant_id = t.id and newest.status = 'completed'
             and (newest.completed_at at time zone 'America/Los_Angeles')::date = (now() at time zone 'America/Los_Angeles')::date
             order by newest.completed_at desc, newest.started_at desc, newest.id desc limit 1)
           and not exists (select 1 from public.research_runs opened where opened.tenant_id = t.id and opened.status in ('running','paused')))))
     )
     order by coalesce((select max(r2.updated_at) from public.research_runs r2 where r2.tenant_id = t.id
       and (r2.status in ('running','paused') or r2.cycle_key like '%' || to_char(now() at time zone 'America/Los_Angeles', 'YYYY-MM-DD'))), t.created_at) asc,
       (select min(r2.next_dispatch_at) from public.research_runs r2 where r2.tenant_id = t.id and r2.next_dispatch_at <= now()
         and (r2.status in ('running','paused') or r2.cycle_key like '%' || to_char(now() at time zone 'America/Los_Angeles', 'YYYY-MM-DD'))) asc nulls first, t.id
  loop
    exit when v_claimed >= p_limit;
    perform pg_advisory_xact_lock(hashtextextended('research_runs:' || v_tenant, 0));
    return query select * from public.claim_research_run(v_tenant, p_owner, p_lease_seconds);
    if found then v_claimed := v_claimed + 1; continue; end if;
    if exists (select 1 from public.research_runs opened where opened.tenant_id = v_tenant and opened.status in ('running','paused')) then continue; end if;
    select * into v_completed from public.research_runs r where r.tenant_id = v_tenant and r.status = 'completed'
      and (r.completed_at at time zone 'America/Los_Angeles')::date = (now() at time zone 'America/Los_Angeles')::date
      order by r.completed_at desc, r.started_at desc, r.id desc limit 1 for update;
    if not found or v_completed.next_dispatch_at is null or v_completed.next_dispatch_at > now() then continue; end if;
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
