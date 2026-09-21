create or replace function public.increment_llm_spend(p_tenant_id text, p_platform text, p_delta numeric, p_prompts integer default 0, p_chunks integer default 0, p_run_id text default null::text, p_metadata jsonb default null::jsonb)
returns boolean language plpgsql security definer set search_path to 'public' as $function$
begin
  if p_tenant_id is null or p_platform is null or p_delta is null then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended('provider_spend:' || p_tenant_id || ':' || p_platform, 0));
  insert into public.llm_budget_ledger (tenant_id, date_utc, platform, spent_usd, call_count, prompt_count, chunk_count, last_run_id, metadata)
  values (p_tenant_id, (now() at time zone 'America/Los_Angeles')::date, p_platform, greatest(0, p_delta), 1, coalesce(p_prompts,0), coalesce(p_chunks,0), p_run_id, p_metadata)
  on conflict (tenant_id, date_utc, platform)
  do update set spent_usd = greatest(0, public.llm_budget_ledger.spent_usd + p_delta),
                call_count = public.llm_budget_ledger.call_count + 1,
                prompt_count = public.llm_budget_ledger.prompt_count + coalesce(p_prompts,0),
                chunk_count = public.llm_budget_ledger.chunk_count + coalesce(p_chunks,0),
                last_run_id = p_run_id,
                metadata = coalesce(p_metadata, public.llm_budget_ledger.metadata),
                updated_at = now();
  return true;
end; $function$;

create or replace function public.reserve_provider_spend(p_tenant_id text, p_platform text, p_amount numeric, p_monthly_cap numeric)
returns boolean language plpgsql security definer set search_path to 'public' as $function$
declare
  v_month_spent numeric;
begin
  if p_amount is null or p_amount < 0 or p_monthly_cap is null or p_monthly_cap < 0 then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended('provider_spend:' || p_tenant_id || ':' || p_platform, 0));
  select coalesce(sum(spent_usd), 0) into v_month_spent
    from public.llm_budget_ledger
   where tenant_id = p_tenant_id and platform = p_platform
     and date_utc >= date_trunc('month', (now() at time zone 'America/Los_Angeles'))::date;
  if v_month_spent + p_amount > p_monthly_cap then return false; end if;
  insert into public.llm_budget_ledger (tenant_id, date_utc, platform, spent_usd, call_count)
  values (p_tenant_id, (now() at time zone 'America/Los_Angeles')::date, p_platform, p_amount, 1)
  on conflict (tenant_id, date_utc, platform)
  do update set spent_usd = public.llm_budget_ledger.spent_usd + excluded.spent_usd,
                call_count = public.llm_budget_ledger.call_count + 1,
                updated_at = now();
  return true;
end; $function$;

create or replace function public.adjust_provider_spend(p_tenant_id text, p_platform text, p_delta numeric)
returns boolean language plpgsql security definer set search_path to 'public' as $function$
begin
  if p_delta is null or p_delta = 0 then return true; end if;
  perform pg_advisory_xact_lock(hashtextextended('provider_spend:' || p_tenant_id || ':' || p_platform, 0));
  update public.llm_budget_ledger l
     set spent_usd = greatest(0, l.spent_usd + p_delta), updated_at = now()
   where l.tenant_id = p_tenant_id and l.platform = p_platform
     and l.date_utc = (now() at time zone 'America/Los_Angeles')::date;
  return found;
end; $function$;;
