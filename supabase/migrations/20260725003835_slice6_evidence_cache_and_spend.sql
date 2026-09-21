-- Slice 6: canonical public-evidence cache + atomic provider spend (2026-07-25).
-- Full context in migrations/2026-07-25_slice6_evidence_cache_and_spend.sql.

create table if not exists public.evidence_cache (
  cache_key        text primary key,
  endpoint         text not null,
  endpoint_version text not null default 'v3',
  input_hash       text not null,
  input_summary    text,
  location_code    int  not null,
  language_code    text not null,
  device           text,
  model_requested  text,
  model_served     text,
  status           text not null check (status in ('pending', 'ready', 'error')),
  provider_task_id text,
  fetch_claimed_until timestamptz,
  payload          jsonb,
  provenance       jsonb not null default '{}'::jsonb,
  posted_at        timestamptz,
  ready_at         timestamptz,
  expires_at       timestamptz not null,
  error_at         timestamptz,
  error_detail     text,
  cost_usd         numeric not null default 0,
  content_hash     text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists evidence_cache_endpoint_status on public.evidence_cache (endpoint, status);
create index if not exists evidence_cache_expires on public.evidence_cache (expires_at);
create index if not exists evidence_cache_task on public.evidence_cache (provider_task_id) where provider_task_id is not null;

alter table public.evidence_cache enable row level security;
drop policy if exists deny_all on public.evidence_cache;
create policy deny_all on public.evidence_cache
  as permissive for all to anon, authenticated
  using (false) with check (false);

create or replace function public.claim_evidence_fetch(
  p_cache_key        text,
  p_endpoint         text,
  p_endpoint_version text,
  p_input_hash       text,
  p_input_summary    text,
  p_location_code    int,
  p_language_code    text,
  p_device           text,
  p_model_requested  text,
  p_claim_seconds    int
) returns table (outcome text, payload jsonb, provider_task_id text, model_served text, ready_at timestamptz, cost_usd numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v record;
begin
  perform pg_advisory_xact_lock(hashtextextended('evidence_cache:' || p_cache_key, 0));

  select * into v from public.evidence_cache c where c.cache_key = p_cache_key;

  if found then
    if v.status = 'ready' and v.expires_at > now() then
      return query select 'ready'::text, v.payload, v.provider_task_id, v.model_served, v.ready_at, v.cost_usd;
      return;
    end if;
    if v.status = 'pending' and (v.fetch_claimed_until is null or v.fetch_claimed_until > now()) and v.provider_task_id is not null then
      return query select 'pending'::text, null::jsonb, v.provider_task_id, v.model_served, v.ready_at, v.cost_usd;
      return;
    end if;
    if v.status = 'pending' and v.fetch_claimed_until is not null and v.fetch_claimed_until > now() then
      return query select 'pending'::text, null::jsonb, v.provider_task_id, v.model_served, v.ready_at, v.cost_usd;
      return;
    end if;
    update public.evidence_cache c
       set status = 'pending',
           fetch_claimed_until = now() + make_interval(secs => p_claim_seconds),
           error_at = null, error_detail = null,
           updated_at = now()
     where c.cache_key = p_cache_key;
    return query select 'claimed'::text, null::jsonb, v.provider_task_id, v.model_served, v.ready_at, v.cost_usd;
    return;
  end if;

  insert into public.evidence_cache
    (cache_key, endpoint, endpoint_version, input_hash, input_summary, location_code,
     language_code, device, model_requested, status, fetch_claimed_until, expires_at)
  values
    (p_cache_key, p_endpoint, p_endpoint_version, p_input_hash, p_input_summary, p_location_code,
     p_language_code, p_device, p_model_requested, 'pending',
     now() + make_interval(secs => p_claim_seconds), now() + make_interval(secs => p_claim_seconds));
  return query select 'claimed'::text, null::jsonb, null::text, null::text, null::timestamptz, 0::numeric;
end;
$$;

revoke all on function public.claim_evidence_fetch(text, text, text, text, text, int, text, text, text, int) from public;
revoke all on function public.claim_evidence_fetch(text, text, text, text, text, int, text, text, text, int) from anon;
revoke all on function public.claim_evidence_fetch(text, text, text, text, text, int, text, text, text, int) from authenticated;
grant execute on function public.claim_evidence_fetch(text, text, text, text, text, int, text, text, text, int) to service_role;

create or replace function public.reserve_provider_spend(
  p_tenant_id   text,
  p_platform    text,
  p_amount      numeric,
  p_monthly_cap numeric
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_month_spent numeric;
begin
  if p_amount is null or p_amount < 0 or p_monthly_cap is null or p_monthly_cap < 0 then
    return false;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('provider_spend:' || p_tenant_id || ':' || p_platform, 0));

  select coalesce(sum(spent_usd), 0) into v_month_spent
    from public.llm_budget_ledger
   where tenant_id = p_tenant_id
     and platform = p_platform
     and date_utc >= date_trunc('month', (now() at time zone 'utc'))::date;

  if v_month_spent + p_amount > p_monthly_cap then
    return false;
  end if;

  insert into public.llm_budget_ledger (tenant_id, date_utc, platform, spent_usd, call_count)
  values (p_tenant_id, (now() at time zone 'utc')::date, p_platform, p_amount, 1)
  on conflict (tenant_id, date_utc, platform)
  do update set spent_usd = public.llm_budget_ledger.spent_usd + excluded.spent_usd,
                call_count = public.llm_budget_ledger.call_count + 1,
                updated_at = now();
  return true;
end;
$$;

revoke all on function public.reserve_provider_spend(text, text, numeric, numeric) from public;
revoke all on function public.reserve_provider_spend(text, text, numeric, numeric) from anon;
revoke all on function public.reserve_provider_spend(text, text, numeric, numeric) from authenticated;
grant execute on function public.reserve_provider_spend(text, text, numeric, numeric) to service_role;

create or replace function public.adjust_provider_spend(
  p_tenant_id text,
  p_platform  text,
  p_delta     numeric
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_delta is null or p_delta = 0 then
    return true;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('provider_spend:' || p_tenant_id || ':' || p_platform, 0));
  update public.llm_budget_ledger l
     set spent_usd = greatest(0, l.spent_usd + p_delta),
         updated_at = now()
   where l.tenant_id = p_tenant_id
     and l.platform = p_platform
     and l.date_utc = (now() at time zone 'utc')::date;
  return found;
end;
$$;

revoke all on function public.adjust_provider_spend(text, text, numeric) from public;
revoke all on function public.adjust_provider_spend(text, text, numeric) from anon;
revoke all on function public.adjust_provider_spend(text, text, numeric) from authenticated;
grant execute on function public.adjust_provider_spend(text, text, numeric) to service_role;

alter table public.research_runs drop constraint if exists research_runs_current_phase_check;
alter table public.research_runs add constraint research_runs_current_phase_check
  check (current_phase in (
    'refresh_sources', 'gsc_backfill_chunk',
    'keyword_discovery', 'prompt_observations', 'serp_analysis', 'winning_pages',
    'publish_surface', 'done'
  ));;
