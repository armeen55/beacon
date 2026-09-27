-- Explicit paused manual delivery retains the same service-only claim, lease and advisory lock.
do $$ begin if md5(pg_get_functiondef('public.claim_research_run(text,text,integer)'::regprocedure)) <> '298d394bc3145236e080c994d793e376' then raise exception 'claim_research_run baseline changed'; end if; end $$;
CREATE OR REPLACE FUNCTION public.claim_research_run(p_tenant_id text, p_owner text, p_lease_seconds integer)
 RETURNS SETOF research_runs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_run public.research_runs%rowtype;
begin
  if not exists (select 1 from public.tenants t where t.id = p_tenant_id and t.status = 'active' and (coalesce(t.research_paused, false) = false and p_owner !~ '^manual-delivery:' or t.research_paused = true and p_lease_seconds = 800 and p_owner ~ '^manual-delivery:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')) then return; end if;
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
    and (p_owner !~ '^manual-delivery:' or right(cycle_key, 10) = to_char(now() at time zone 'America/Los_Angeles', 'YYYY-MM-DD'))
    and (completed_at at time zone 'America/Los_Angeles')::date = (now() at time zone 'America/Los_Angeles')::date) then return; end if;
  begin
    return query insert into public.research_runs
      (tenant_id, cycle_key, status, current_phase, lease_owner, lease_expires_at)
    values (p_tenant_id, p_tenant_id || ':' || to_char(now() at time zone 'America/Los_Angeles', 'YYYY-MM-DD'),
      'running', 'refresh_sources', p_owner, now() + make_interval(secs => p_lease_seconds)) returning research_runs.*;
  exception when unique_violation then return;
  end;
end;
$function$;
