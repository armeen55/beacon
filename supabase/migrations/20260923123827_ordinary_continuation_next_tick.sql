-- Ordinary durable continuation is eligible at the next existing fleet tick.
-- Provider waits, completion probes and failure backoff retain their delays.
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
    when v_reason = 'continuation' then now()
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
