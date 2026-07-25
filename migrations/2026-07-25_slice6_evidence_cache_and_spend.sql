-- Slice 6: canonical public-evidence cache + atomic provider spend (2026-07-25).
--
-- ADDITIVE. Two independent pieces the DataForSEO research funnel needs:
--
--   1. public.evidence_cache - ONE row-oriented cache for ALL public provider
--      evidence (keyword, SERP, AI answers, winning pages). Replaces the two
--      endpoint-owned JSON-blob caches (dataforseo-serp-cache,
--      dataforseo-keywords-cache). The cache key is TENANT-INDEPENDENT public
--      identity (endpoint + normalized input + location + language + device +
--      model + response form), so two accounts requesting identical public
--      evidence reuse one paid result. Spend attribution and derived
--      conclusions stay account-scoped in llm_budget_ledger and per-tenant
--      stores; NOTHING tenant-derived is written here.
--
--   2. reserve_provider_spend / adjust_provider_spend - the atomic Postgres
--      money path. The old order (check cap, call network, record spend after)
--      is unsafe under concurrent visit-driven work. Reservation now happens
--      BEFORE the network call under a per-(tenant, platform) advisory lock, so
--      two concurrent near-cap calls can never both pass, and reconciliation
--      adjusts to provider-reported actual cost afterward (a failed adjustment
--      keeps the higher reservation: overcount, never undercount).
--
-- SECURITY: server-only data. RLS denies anon and authenticated entirely; every
-- access goes through the service-role admin client. The RPCs are SECURITY
-- DEFINER, revoked from public/anon/authenticated, granted to service_role.
--
-- Apply via MCP apply_migration (orchestrator only). Idempotent: safe to re-run.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. The canonical public-evidence cache.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.evidence_cache (
  cache_key        text primary key,               -- deterministic public identity hash
  endpoint         text not null,                  -- canonical endpoint path, e.g. "dataforseo_labs/google/keyword_overview/live"
  endpoint_version text not null default 'v3',
  input_hash       text not null,                  -- sha of the normalized public input
  input_summary    text,                           -- bounded human-readable summary; never tenant data
  location_code    int  not null,
  language_code    text not null,
  device           text,                           -- null when the endpoint has no device dimension
  model_requested  text,                           -- AI endpoints: the model asked for
  model_served     text,                           -- AI endpoints: the model the provider reports actually serving
  status           text not null check (status in ('pending', 'ready', 'error')),
  provider_task_id text,                           -- Standard-mode task id; survives process death for GET resumption
  fetch_claimed_until timestamptz,                 -- single-flight claim lease for concurrent identical misses
  payload          jsonb,                          -- normalized evidence (null until ready)
  provenance       jsonb not null default '{}'::jsonb,
  posted_at        timestamptz,                    -- when the provider task was posted (Standard mode)
  ready_at         timestamptz,
  expires_at       timestamptz not null,           -- freshness boundary; stale rows are re-fetchable, never silently served as fresh
  error_at         timestamptz,
  error_detail     text,
  cost_usd         numeric not null default 0,     -- provider-reported cost of the paid call that produced this row
  content_hash     text,                           -- hash of payload for change detection
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Single-flight claim for one cache key. Outcomes:
--    'ready'   - a fresh ready row exists; caller uses payload at $0.
--    'claimed' - the caller now owns the fetch (row is pending, lease set);
--                it must do the paid work then mark ready/error.
--    'pending' - another invocation holds a live claim or an unexpired provider
--                task is in flight; caller treats it as resumable waiting state.
--    A stale-ready, errored, expired-claim, or expired row is re-claimable.
-- ─────────────────────────────────────────────────────────────────────────────
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
  -- Serialize per cache key so two identical concurrent misses cannot both claim.
  perform pg_advisory_xact_lock(hashtextextended('evidence_cache:' || p_cache_key, 0));

  select * into v from public.evidence_cache c where c.cache_key = p_cache_key;

  if found then
    if v.status = 'ready' and v.expires_at > now() then
      return query select 'ready'::text, v.payload, v.provider_task_id, v.model_served, v.ready_at, v.cost_usd;
      return;
    end if;
    if v.status = 'pending' and (v.fetch_claimed_until is null or v.fetch_claimed_until > now()) and v.provider_task_id is not null then
      -- A durable provider task is in flight; the caller may GET it (free) but
      -- must never repost. Surface the task id.
      return query select 'pending'::text, null::jsonb, v.provider_task_id, v.model_served, v.ready_at, v.cost_usd;
      return;
    end if;
    if v.status = 'pending' and v.fetch_claimed_until is not null and v.fetch_claimed_until > now() then
      -- Another invocation holds a live fetch claim (no task id yet).
      return query select 'pending'::text, null::jsonb, v.provider_task_id, v.model_served, v.ready_at, v.cost_usd;
      return;
    end if;
    -- Stale ready, errored, or dead claim: reclaim for a fresh fetch.
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Atomic per-(tenant, platform) spend reservation against a monthly cap.
--    Returns true and increments today's ledger row when (month-to-date sum +
--    amount) <= cap; returns false with NO write otherwise. The advisory lock
--    makes the read-check-increment one unit, so concurrent reservations
--    serialize and can never jointly exceed the cap.
-- ─────────────────────────────────────────────────────────────────────────────
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Reconcile a reservation to provider-reported actual cost. Signed delta;
--    today's row is clamped at zero so a refund can never go negative. A missed
--    adjustment simply leaves the higher reservation in place (fail-safe).
-- ─────────────────────────────────────────────────────────────────────────────
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Widen the research_runs phase vocabulary for the full funnel. Additive:
--    the three existing phases keep their meaning; four evidence phases join.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.research_runs drop constraint if exists research_runs_current_phase_check;
alter table public.research_runs add constraint research_runs_current_phase_check
  check (current_phase in (
    'refresh_sources', 'gsc_backfill_chunk',
    'keyword_discovery', 'prompt_observations', 'serp_analysis', 'winning_pages',
    'publish_surface', 'done'
  ));
