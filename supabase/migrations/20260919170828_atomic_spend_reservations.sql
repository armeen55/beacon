-- One tenant-wide spend door. Estimates are upper bounds; actual charges enter
-- llm_budget_ledger exactly once when the reservation is reconciled.

-- Policy lives in the database, not in whichever application instance happens
-- to win a rolling-deploy race. Callers may ask for a lower ceiling, never a
-- higher one. Changing these rows is the one explicit operator control plane.
create table public.spend_policy (
  policy_key text primary key,
  monthly_cap_usd numeric(12,6) check (monthly_cap_usd is null or monthly_cap_usd >= 0),
  lifetime_cap_usd numeric(12,6) check (lifetime_cap_usd is null or lifetime_cap_usd >= 0),
  updated_at timestamptz not null default now(),
  check (monthly_cap_usd is not null or lifetime_cap_usd is not null)
);
insert into public.spend_policy (policy_key, monthly_cap_usd, lifetime_cap_usd) values
  ('global', 500, null),
  ('platform:perplexity', 250, null), ('platform:openai', 250, null),
  ('platform:adjudicator-openai', 250, null), ('platform:onboarding-openai', 250, 2),
  ('platform:dataforseo-serp', 250, null), ('platform:other', 250, null)
on conflict (policy_key) do nothing;

-- Created before the spend door because the final provider-transmission claim
-- and proposal retirement share this exact work-key lock. The lifecycle
-- migration below adds its trigger, backfill, RLS and service-role read grant.
create table if not exists public.proposal_work_tombstones (
  tenant_id text not null references public.tenants(id) on delete cascade,
  work_key text not null check (work_key <> ''),
  proposal_id text not null,
  disposition text not null check (disposition in ('dismissed', 'withdrawn', 'superseded', 'settled')),
  retired_at timestamptz not null default now(),
  primary key (tenant_id, work_key, proposal_id)
);
alter table public.proposal_work_tombstones enable row level security;
alter table public.proposal_work_tombstones force row level security;
revoke all on table public.proposal_work_tombstones from public, anon, authenticated;

create table public.spend_reservations (
  attempt_id text primary key default gen_random_uuid()::text,
  tenant_id text not null references public.tenants(id) on delete cascade,
  reporting_day date not null,
  logical_key text not null,
  request_fingerprint text not null check (request_fingerprint <> ''),
  attempt_ordinal integer not null check (attempt_ordinal > 0),
  platform text not null check (platform in (
    'perplexity', 'openai', 'adjudicator-openai', 'onboarding-openai',
    'dataforseo-serp', 'other'
  )),
  purpose text not null check (purpose <> ''),
  proposal_work_key text check (proposal_work_key is null or proposal_work_key <> ''),
  research_run_id uuid references public.research_runs(id) on delete set null,
  research_run_owner text,
  recovery_kind text not null default 'none' check (recovery_kind in ('none', 'provider_task_listing', 'provider_exact_required')),
  cohort_member boolean not null default false,
  estimated_usd numeric(12,6) not null check (estimated_usd >= 0),
  global_monthly_cap_usd numeric(12,6) not null check (global_monthly_cap_usd > 0),
  monthly_cap_usd numeric(12,6) check (monthly_cap_usd is null or monthly_cap_usd >= 0),
  lifetime_cap_usd numeric(12,6) check (lifetime_cap_usd is null or lifetime_cap_usd >= 0),
  accounted_usd numeric(12,6) check (accounted_usd >= 0),
  accounting_basis text check (accounting_basis in ('provider_reported', 'provider_advance', 'usage_estimate', 'reservation_estimate')),
  cap_breached boolean not null default false,
  result_payload jsonb,
  state text not null default 'reserved' check (state in (
    'reserved', 'transmitted', 'ambiguous', 'reconciled', 'released'
  )),
  provider_task_id text,
  transport_started_at timestamptz,
  lease_expires_at timestamptz not null,
  reconciled_at timestamptz,
  released_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, reporting_day, logical_key, attempt_ordinal),
  check (state <> 'reconciled' or (accounted_usd is not null and accounting_basis is not null and reconciled_at is not null)),
  check (state <> 'released' or released_at is not null)
);

create unique index spend_reservations_one_unresolved_operation
  on public.spend_reservations (tenant_id, logical_key)
  where state in ('reserved', 'transmitted', 'ambiguous');
create index spend_reservations_cap_read
  on public.spend_reservations (tenant_id, reporting_day, state);
create index spend_reservations_monthly_read
  on public.spend_reservations (tenant_id, platform, reporting_day, state);
create unique index spend_reservations_provider_task
  on public.spend_reservations (platform, provider_task_id)
  where provider_task_id is not null;

create table public.cohort_spend_holds (
  tenant_id text not null references public.tenants(id) on delete cascade,
  reporting_day date not null,
  hold_usd numeric(12,6) not null check (hold_usd >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, reporting_day)
);

alter table public.evidence_cache add column if not exists spend_attempt_id text
  references public.spend_reservations(attempt_id);
alter table public.evidence_cache add column if not exists provider_repost_count smallint
  not null default 0 check (provider_repost_count between 0 and 1);
alter table public.evidence_cache add column if not exists fetch_generation integer
  not null default 1 check (fetch_generation > 0);

-- OUT columns changed (fetch_generation was added), which PostgreSQL cannot
-- replace in place. Funding is off for this migration window, so recreate the
-- function and immediately restore its locked grant below.
drop function if exists public.claim_evidence_fetch(text, text, text, text, text, integer, text, text, text, integer);
create or replace function public.claim_evidence_fetch(
  p_cache_key text, p_endpoint text, p_endpoint_version text, p_input_hash text,
  p_input_summary text, p_location_code int, p_language_code text, p_device text,
  p_model_requested text, p_claim_seconds int
) returns table (outcome text, payload jsonb, provider_task_id text, model_served text,
  ready_at timestamptz, cost_usd numeric, fetch_generation integer)
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare v public.evidence_cache%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('evidence_cache:' || p_cache_key, 0));
  select * into v from public.evidence_cache where cache_key = p_cache_key;
  if found then
    if v.status = 'ready' and v.expires_at > now() then
      return query select 'ready'::text, v.payload, v.provider_task_id, v.model_served, v.ready_at, v.cost_usd, v.fetch_generation; return;
    end if;
    if v.quarantined_at is not null then
      return query select 'pending'::text, null::jsonb, v.provider_task_id, v.model_served, v.ready_at, v.cost_usd, v.fetch_generation; return;
    end if;
    if v.status = 'ready' and v.expires_at <= now() then
      update public.evidence_cache set provider_task_id = null, spend_attempt_id = null,
        payload = null, provenance = null, model_served = null, ready_at = null,
        cost_usd = 0, content_hash = null, posted_at = null,
        posted_attempt_at = null, provider_repost_count = 0,
        status = 'pending', fetch_claimed_until = now() + make_interval(secs => p_claim_seconds),
        fetch_generation = v.fetch_generation + 1,
        error_at = null, error_detail = null, updated_at = now() where cache_key = p_cache_key;
      return query select 'claimed'::text, null::jsonb, null::text, v.model_served, null::timestamptz, 0::numeric, v.fetch_generation + 1; return;
    end if;
    if v.status = 'pending' and (v.fetch_claimed_until is null or v.fetch_claimed_until > now())
       and v.provider_task_id is not null then
      return query select 'pending'::text, null::jsonb, v.provider_task_id, v.model_served, v.ready_at, v.cost_usd, v.fetch_generation; return;
    end if;
    if v.status = 'pending' and v.fetch_claimed_until is not null and v.fetch_claimed_until > now() then
      return query select 'pending'::text, null::jsonb, v.provider_task_id, v.model_served, v.ready_at, v.cost_usd, v.fetch_generation; return;
    end if;
    if v.posted_attempt_at is not null and v.provider_task_id is null and v.status = 'pending' then
      -- A pre-call receipt is written before the final transmission claim. If
      -- the process dies in that gap, the spend row itself proves that no byte
      -- crossed the wire. Release and reclaim that generation; only a
      -- transmitted/ambiguous attempt is a permanent uncertainty hold.
      if v.spend_attempt_id is not null and exists (
        select 1 from public.spend_reservations s
         where s.attempt_id = v.spend_attempt_id
           and s.state in ('reserved', 'released')
           and s.transport_started_at is null
      ) then
        update public.spend_reservations
           set state = 'released', released_at = coalesce(released_at, now()), updated_at = now()
         where attempt_id = v.spend_attempt_id and state = 'reserved'
           and transport_started_at is null;
        update public.evidence_cache set spend_attempt_id = null, posted_attempt_at = null,
          status = 'pending', fetch_claimed_until = now() + make_interval(secs => p_claim_seconds),
          error_at = null, error_detail = null, updated_at = now()
         where cache_key = p_cache_key;
        return query select 'claimed'::text, null::jsonb, null::text, v.model_served,
          v.ready_at, 0::numeric, v.fetch_generation; return;
      end if;
      update public.evidence_cache set quarantined_at = now(), updated_at = now() where cache_key = p_cache_key;
      return query select 'pending'::text, null::jsonb, null::text, v.model_served, v.ready_at, v.cost_usd, v.fetch_generation; return;
    end if;
    update public.evidence_cache set status = 'pending',
      fetch_claimed_until = now() + make_interval(secs => p_claim_seconds),
      error_at = null, error_detail = null, updated_at = now() where cache_key = p_cache_key;
    return query select 'claimed'::text, null::jsonb, v.provider_task_id, v.model_served, v.ready_at, v.cost_usd, v.fetch_generation; return;
  end if;
  insert into public.evidence_cache (cache_key, endpoint, endpoint_version, input_hash,
    input_summary, location_code, language_code, device, model_requested, status,
    fetch_claimed_until, expires_at) values (p_cache_key, p_endpoint, p_endpoint_version,
    p_input_hash, p_input_summary, p_location_code, p_language_code, p_device,
    p_model_requested, 'pending', now() + make_interval(secs => p_claim_seconds),
    now() + make_interval(secs => p_claim_seconds));
  return query select 'claimed'::text, null::jsonb, null::text, null::text, null::timestamptz, 0::numeric, 1;
end;
$$;

alter table public.spend_reservations enable row level security;
alter table public.spend_reservations force row level security;
alter table public.cohort_spend_holds enable row level security;
alter table public.cohort_spend_holds force row level security;
alter table public.spend_policy enable row level security;
alter table public.spend_policy force row level security;
revoke all on table public.spend_reservations from public, anon, authenticated;
revoke all on table public.cohort_spend_holds from public, anon, authenticated;
revoke all on table public.spend_policy from public, anon, authenticated;
-- Existing Supabase projects can carry default service-role CRUD privileges on newly created public tables.
-- Narrowing with GRANT does not remove them, so explicitly close every direct mutation door before reopening reads.
revoke all on table public.spend_reservations from service_role;
revoke all on table public.cohort_spend_holds from service_role;
revoke all on table public.spend_policy from service_role;
grant select on table public.spend_reservations to service_role;
grant select on table public.cohort_spend_holds to service_role;
grant select on table public.spend_policy to service_role;

create or replace function public.set_cohort_spend_hold(
  p_tenant_id text,
  p_hold_usd numeric
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_day date := (now() at time zone 'America/Los_Angeles')::date;
  v_cap numeric;
  v_spent numeric;
  v_open numeric;
  v_cohort_committed numeric;
begin
  if p_tenant_id is null or p_tenant_id = '' or p_hold_usd is null or p_hold_usd < 0 then
    return false;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('spend:' || p_tenant_id, 0));
  select daily_budget_usd into v_cap from public.tenants where id = p_tenant_id;
  if v_cap is null or p_hold_usd > v_cap then return false; end if;

  update public.spend_reservations as r
     set state = 'released', released_at = now(), updated_at = now()
   where r.tenant_id = p_tenant_id and r.reporting_day = v_day
     and r.state = 'reserved' and r.transport_started_at is null and r.lease_expires_at < now();

  select coalesce(sum(spent_usd), 0) into v_spent
    from public.llm_budget_ledger where tenant_id = p_tenant_id and date_utc = v_day;
  select coalesce(sum(estimated_usd), 0) into v_open
    from public.spend_reservations where tenant_id = p_tenant_id and reporting_day = v_day
     and state in ('reserved', 'transmitted', 'ambiguous');
  select coalesce(sum(case when state = 'reconciled' then accounted_usd else estimated_usd end), 0)
    into v_cohort_committed from public.spend_reservations
   where tenant_id = p_tenant_id and reporting_day = v_day and cohort_member
     and state in ('reserved', 'transmitted', 'ambiguous', 'reconciled');
  if p_hold_usd < v_cohort_committed
     or v_spent + v_open + greatest(p_hold_usd - v_cohort_committed, 0) > v_cap then
    return false;
  end if;
  insert into public.cohort_spend_holds (tenant_id, reporting_day, hold_usd)
  values (p_tenant_id, v_day, p_hold_usd)
  on conflict (tenant_id, reporting_day) do update
    set hold_usd = excluded.hold_usd, updated_at = now();
  return true;
end;
$$;

create or replace function public.release_unused_cohort_spend_hold(p_tenant_id text)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_day date := (now() at time zone 'America/Los_Angeles')::date;
  v_committed numeric;
begin
  if p_tenant_id is null or p_tenant_id = '' then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended('spend:' || p_tenant_id, 0));
  select coalesce(sum(case when state = 'reconciled' then accounted_usd else estimated_usd end), 0)
    into v_committed from public.spend_reservations
   where tenant_id = p_tenant_id and reporting_day = v_day and cohort_member
     and state in ('reserved', 'transmitted', 'ambiguous', 'reconciled');
  update public.cohort_spend_holds set hold_usd = v_committed, updated_at = now()
   where tenant_id = p_tenant_id and reporting_day = v_day;
  return true;
end;
$$;

create or replace function public.reserve_spend(
  p_tenant_id text,
  p_platform text,
  p_purpose text,
  p_logical_key text,
  p_request_fingerprint text,
  p_estimated_usd numeric,
  p_global_monthly_cap_usd numeric,
  p_monthly_cap_usd numeric default null,
  p_lifetime_cap_usd numeric default null,
  p_cohort_member boolean default false,
  p_recovery_kind text default 'none',
  p_proposal_work_key text default null,
  p_research_run_id uuid default null,
  p_research_run_owner text default null,
  p_lease_seconds integer default 900
) returns table (
  outcome text,
  attempt_id text,
  attempt_ordinal integer,
  reservation_state text,
  reporting_day date,
  estimated_usd numeric,
  accounted_usd numeric,
  provider_task_id text,
  accounting_basis text,
  result_payload jsonb
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_day date := (now() at time zone 'America/Los_Angeles')::date;
  v_cap numeric;
  v_spent numeric;
  v_open numeric;
  v_month_spent numeric;
  v_month_open numeric;
  v_global_spent numeric;
  v_global_open numeric;
  v_month_start date := date_trunc('month', v_day::timestamp)::date;
  v_lifetime_spent numeric;
  v_lifetime_open numeric;
  v_policy_global numeric;
  v_policy_monthly numeric;
  v_policy_lifetime numeric;
  v_global_cap numeric;
  v_monthly_cap numeric;
  v_lifetime_cap numeric;
  v_door_cap numeric;
  v_hold numeric;
  v_cohort_committed numeric;
  v_ordinal integer;
  v_row public.spend_reservations%rowtype;
begin
  if p_tenant_id is null or p_tenant_id = '' or p_platform is null or p_platform = ''
     or p_purpose is null or p_purpose = '' or p_logical_key is null or p_logical_key = ''
     or p_request_fingerprint is null or p_request_fingerprint = ''
     or p_estimated_usd is null or p_estimated_usd < 0
     or p_global_monthly_cap_usd is null or p_global_monthly_cap_usd <= 0
     or (p_monthly_cap_usd is not null and p_monthly_cap_usd < 0)
     or (p_lifetime_cap_usd is not null and p_lifetime_cap_usd < 0)
     or ((p_research_run_id is null) <> (p_research_run_owner is null))
     or (p_research_run_id is not null and not exists (select 1 from public.research_runs rr
           where rr.id = p_research_run_id and rr.tenant_id = p_tenant_id and rr.status = 'running'
             and rr.lease_owner = p_research_run_owner and rr.lease_expires_at >= now()))
     or p_recovery_kind not in ('none', 'provider_task_listing', 'provider_exact_required')
     or p_lease_seconds is null or p_lease_seconds < 1 then
    return query select 'invalid'::text, null::text, null::integer, null::text,
      v_day, null::numeric, null::numeric, null::text, null::text, null::jsonb;
    return;
  end if;

  -- The global/month lock is always acquired before the tenant lock. It makes
  -- the outer cap one atomic door even when different tenants reserve at once.
  perform pg_advisory_xact_lock(hashtextextended('spend:global:' || v_month_start::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('spend:' || p_tenant_id, 0));

  select monthly_cap_usd into v_policy_global from public.spend_policy where policy_key = 'global' for share;
  if v_policy_global is null or v_policy_global <= 0 then
    return query select 'refused_global'::text, null::text, null::integer, null::text,
      v_day, p_estimated_usd, null::numeric, null::text, null::text, null::jsonb; return;
  end if;
  select monthly_cap_usd, lifetime_cap_usd into v_policy_monthly, v_policy_lifetime
    from public.spend_policy where policy_key = 'platform:' || p_platform for share;
  if not found then
    return query select 'invalid'::text, null::text, null::integer, null::text,
      v_day, p_estimated_usd, null::numeric, null::text, null::text, null::jsonb; return;
  end if;
  v_global_cap := least(p_global_monthly_cap_usd, v_policy_global);
  v_monthly_cap := case when p_monthly_cap_usd is null then v_policy_monthly
    when v_policy_monthly is null then p_monthly_cap_usd else least(p_monthly_cap_usd, v_policy_monthly) end;
  v_lifetime_cap := case when p_lifetime_cap_usd is null then v_policy_lifetime
    when v_policy_lifetime is null then p_lifetime_cap_usd else least(p_lifetime_cap_usd, v_policy_lifetime) end;

  -- A response lost after transmission stays
  -- conservative for the rest of its reporting day, then settles at the held
  -- estimate before this tenant can reserve anything on a later day. The row
  -- and aggregate ledger move in this transaction under the same tenant lock,
  -- so a retry can neither forget the possible charge nor remain poisoned for
  -- ever. Only a Standard task carrying a durable provider-listing recovery tag
  -- remains unresolved: its free lookup can still recover the exact receipt.
  with stale as (
    update public.spend_reservations as r
       set state = 'reconciled', accounted_usd = r.estimated_usd,
           accounting_basis = 'reservation_estimate',
           reconciled_at = now(), updated_at = now()
     where r.tenant_id = p_tenant_id and r.state in ('transmitted', 'ambiguous')
       and r.recovery_kind = 'none'
       and r.reporting_day < v_day and r.lease_expires_at < now()
    returning r.reporting_day, r.platform, r.estimated_usd, r.attempt_id
  ), totals as (
    select s.reporting_day, s.platform, sum(s.estimated_usd) as spent_usd,
           count(*)::integer as call_count,
           max(s.attempt_id) as last_attempt_id
      from stale as s group by s.reporting_day, s.platform
  )
  insert into public.llm_budget_ledger (
    tenant_id, date_utc, platform, spent_usd, call_count, metadata
  )
  select p_tenant_id, t.reporting_day, t.platform, t.spent_usd, t.call_count,
         jsonb_build_object('last_spend_attempt_id', t.last_attempt_id,
                            'settled_from_ambiguous_estimate', true)
    from totals as t
  on conflict (tenant_id, date_utc, platform) do update
    set spent_usd = public.llm_budget_ledger.spent_usd + excluded.spent_usd,
        call_count = public.llm_budget_ledger.call_count + excluded.call_count,
        metadata = coalesce(public.llm_budget_ledger.metadata, '{}'::jsonb)
          || excluded.metadata,
        updated_at = now();

  update public.spend_reservations as r
     set state = 'released', released_at = now(), updated_at = now()
   where r.tenant_id = p_tenant_id and r.state = 'reserved'
     and r.transport_started_at is null and r.lease_expires_at < now();

  select * into v_row from public.spend_reservations r
   where r.tenant_id = p_tenant_id and r.logical_key = p_logical_key
     and r.state in ('reserved', 'transmitted', 'ambiguous')
   order by r.reporting_day desc, r.attempt_ordinal desc limit 1 for update;
  if found then
    if v_row.request_fingerprint <> p_request_fingerprint
       or v_row.platform <> p_platform or v_row.purpose <> p_purpose
       or v_row.cohort_member <> p_cohort_member or v_row.recovery_kind <> p_recovery_kind
       or v_row.proposal_work_key is distinct from p_proposal_work_key
       or v_row.research_run_id is distinct from p_research_run_id
       or v_row.research_run_owner is distinct from p_research_run_owner
       or v_row.estimated_usd is distinct from p_estimated_usd
       or v_row.global_monthly_cap_usd is distinct from v_global_cap
       or v_row.monthly_cap_usd is distinct from v_monthly_cap
       or v_row.lifetime_cap_usd is distinct from v_lifetime_cap then
      return query select 'conflict'::text, null::text, null::integer, null::text,
        v_day, p_estimated_usd, null::numeric, null::text, null::text, null::jsonb;
      return;
    end if;
    return query select 'resumed'::text, v_row.attempt_id, v_row.attempt_ordinal,
      v_row.state, v_row.reporting_day, v_row.estimated_usd, v_row.accounted_usd,
      v_row.provider_task_id, v_row.accounting_basis, v_row.result_payload;
    return;
  end if;

  select * into v_row from public.spend_reservations r
   where r.tenant_id = p_tenant_id and r.logical_key = p_logical_key
     and r.request_fingerprint = p_request_fingerprint and r.state = 'reconciled'
     and r.result_payload is not null
   order by r.reporting_day desc, r.attempt_ordinal desc limit 1;
  if found then
    return query select 'replayed'::text, v_row.attempt_id, v_row.attempt_ordinal,
      v_row.state, v_row.reporting_day, v_row.estimated_usd, v_row.accounted_usd,
      v_row.provider_task_id, v_row.accounting_basis, v_row.result_payload;
    return;
  end if;

  -- A transmission lost without a provider result is at-most-once. Once its
  -- conservative estimate is settled, the same logical operation remains a
  -- tombstone instead of silently buying the request again.
  select * into v_row from public.spend_reservations r
   where r.tenant_id = p_tenant_id and r.logical_key = p_logical_key
     and r.state = 'reconciled' and r.accounting_basis = 'reservation_estimate'
     and r.result_payload is null
   order by r.reporting_day desc, r.attempt_ordinal desc limit 1;
  if found then
    if v_row.request_fingerprint <> p_request_fingerprint
       or v_row.platform <> p_platform or v_row.purpose <> p_purpose
       or v_row.cohort_member <> p_cohort_member or v_row.recovery_kind <> p_recovery_kind
       or v_row.proposal_work_key is distinct from p_proposal_work_key
       or v_row.research_run_id is distinct from p_research_run_id
       or v_row.research_run_owner is distinct from p_research_run_owner
       or v_row.estimated_usd is distinct from p_estimated_usd
       or v_row.global_monthly_cap_usd is distinct from v_global_cap
       or v_row.monthly_cap_usd is distinct from v_monthly_cap
       or v_row.lifetime_cap_usd is distinct from v_lifetime_cap then
      return query select 'conflict'::text, null::text, null::integer, null::text,
        v_day, p_estimated_usd, null::numeric, null::text, null::text, null::jsonb;
      return;
    end if;
    return query select 'resumed'::text, v_row.attempt_id, v_row.attempt_ordinal,
      v_row.state, v_row.reporting_day, v_row.estimated_usd, v_row.accounted_usd,
      v_row.provider_task_id, v_row.accounting_basis, v_row.result_payload;
    return;
  end if;

  -- A provider charge above its estimate stops the rest of this reporting day.
  -- It remains permanently auditable on the row, but cannot brick the tenant
  -- for all future months after pricing or estimates are corrected.
  if exists (select 1 from public.spend_reservations r where r.tenant_id = p_tenant_id
      and r.reporting_day = v_day and r.cap_breached) then
    return query select 'refused_overrun'::text, null::text, null::integer, null::text,
      v_day, p_estimated_usd, null::numeric, null::text, null::text, null::jsonb;
    return;
  end if;

  select coalesce(sum(spent_usd), 0) into v_global_spent
    from public.llm_budget_ledger where date_utc >= v_month_start;
  select coalesce(sum(r.estimated_usd), 0) into v_global_open
    from public.spend_reservations r where r.reporting_day >= v_month_start
     and r.state in ('reserved', 'transmitted', 'ambiguous');
  if v_global_spent + v_global_open + p_estimated_usd > v_global_cap then
    return query select 'refused_global'::text, null::text, null::integer, null::text,
      v_day, p_estimated_usd, null::numeric, null::text, null::text, null::jsonb;
    return;
  end if;

  select daily_budget_usd into v_cap from public.tenants where id = p_tenant_id;
  if v_cap is null then
    return query select 'refused_daily'::text, null::text, null::integer, null::text,
      v_day, p_estimated_usd, null::numeric, null::text, null::text, null::jsonb;
    return;
  end if;
  select coalesce(sum(spent_usd), 0) into v_spent
    from public.llm_budget_ledger where tenant_id = p_tenant_id and date_utc = v_day;
  select coalesce(sum(r.estimated_usd), 0) into v_open
    from public.spend_reservations r where r.tenant_id = p_tenant_id
     and r.reporting_day = v_day and r.state in ('reserved', 'transmitted', 'ambiguous');
  if v_spent + v_open + p_estimated_usd > v_cap then
    return query select 'refused_daily'::text, null::text, null::integer, null::text,
      v_day, p_estimated_usd, null::numeric, null::text, null::text, null::jsonb;
    return;
  end if;
  v_door_cap := v_cap;
  if p_purpose = 'fact_check' then
    v_door_cap := case when v_spent + v_open >= v_cap * 0.92 - 0.000000001 then v_cap else v_cap * 0.50 end;
  elsif p_purpose = 'bulk' then
    v_door_cap := v_cap * case when p_platform = 'dataforseo-serp' then 0.77 else 0.92 end;
  end if;
  if v_spent + v_open + p_estimated_usd > v_door_cap then
    return query select 'refused_daily'::text, null::text, null::integer, null::text,
      v_day, p_estimated_usd, null::numeric, null::text, null::text, null::jsonb;
    return;
  end if;

  if v_monthly_cap is not null then
    select coalesce(sum(spent_usd), 0) into v_month_spent
      from public.llm_budget_ledger where tenant_id = p_tenant_id and platform = p_platform
       and date_utc >= date_trunc('month', v_day::timestamp)::date;
    select coalesce(sum(r.estimated_usd), 0) into v_month_open
      from public.spend_reservations r where r.tenant_id = p_tenant_id and r.platform = p_platform
       and r.reporting_day >= date_trunc('month', v_day::timestamp)::date
       and r.state in ('reserved', 'transmitted', 'ambiguous');
    if v_month_spent + v_month_open + p_estimated_usd > v_monthly_cap then
      return query select 'refused_monthly'::text, null::text, null::integer, null::text,
        v_day, p_estimated_usd, null::numeric, null::text, null::text, null::jsonb;
      return;
    end if;
  end if;

  if v_lifetime_cap is not null then
    select coalesce(sum(spent_usd), 0) into v_lifetime_spent
      from public.llm_budget_ledger where tenant_id = p_tenant_id and platform = p_platform;
    select coalesce(sum(r.estimated_usd), 0) into v_lifetime_open
      from public.spend_reservations r where r.tenant_id = p_tenant_id and r.platform = p_platform
       and r.state in ('reserved', 'transmitted', 'ambiguous');
    if v_lifetime_spent + v_lifetime_open + p_estimated_usd > v_lifetime_cap then
      return query select 'refused_lifetime'::text, null::text, null::integer, null::text,
        v_day, p_estimated_usd, null::numeric, null::text, null::text, null::jsonb;
      return;
    end if;
  end if;

  select coalesce(h.hold_usd, 0) into v_hold from public.cohort_spend_holds h
   where h.tenant_id = p_tenant_id and h.reporting_day = v_day;
  v_hold := coalesce(v_hold, 0);
  select coalesce(sum(case when r.state = 'reconciled' then r.accounted_usd else r.estimated_usd end), 0)
    into v_cohort_committed from public.spend_reservations r
   where r.tenant_id = p_tenant_id and r.reporting_day = v_day and r.cohort_member
     and r.state in ('reserved', 'transmitted', 'ambiguous', 'reconciled');
  if p_cohort_member and v_cohort_committed + p_estimated_usd > v_hold then
    return query select 'refused_cohort'::text, null::text, null::integer, null::text,
      v_day, p_estimated_usd, null::numeric, null::text, null::text, null::jsonb;
    return;
  end if;
  if not p_cohort_member and v_spent + v_open + p_estimated_usd
       > v_cap - greatest(v_hold - v_cohort_committed, 0) then
    return query select 'refused_cohort'::text, null::text, null::integer, null::text,
      v_day, p_estimated_usd, null::numeric, null::text, null::text, null::jsonb;
    return;
  end if;

  select coalesce(max(r.attempt_ordinal), 0) + 1 into v_ordinal
    from public.spend_reservations r where r.tenant_id = p_tenant_id
     and r.reporting_day = v_day and r.logical_key = p_logical_key;
  insert into public.spend_reservations (
    tenant_id, reporting_day, logical_key, request_fingerprint, attempt_ordinal, platform, purpose, proposal_work_key, research_run_id, research_run_owner,
    recovery_kind, cohort_member, estimated_usd, global_monthly_cap_usd, monthly_cap_usd, lifetime_cap_usd, lease_expires_at
  ) values (
    p_tenant_id, v_day, p_logical_key, p_request_fingerprint, v_ordinal, p_platform, p_purpose, p_proposal_work_key, p_research_run_id, p_research_run_owner,
    p_recovery_kind, p_cohort_member, p_estimated_usd, v_global_cap, v_monthly_cap, v_lifetime_cap,
    now() + make_interval(secs => p_lease_seconds)
  ) returning * into v_row;
  return query select 'reserved'::text, v_row.attempt_id, v_row.attempt_ordinal,
    v_row.state, v_row.reporting_day, v_row.estimated_usd, v_row.accounted_usd,
    v_row.provider_task_id, v_row.accounting_basis, v_row.result_payload;
end;
$$;

create or replace function public.claim_spend_transmission(p_attempt_id text)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_row public.spend_reservations%rowtype;
  v_month_start date;
  v_policy_global numeric; v_policy_monthly numeric; v_policy_lifetime numeric;
  v_global_cap numeric; v_monthly_cap numeric; v_lifetime_cap numeric;
  v_daily_cap numeric; v_door_cap numeric;
  v_spent numeric; v_open numeric; v_global_spent numeric; v_global_open numeric;
  v_month_spent numeric; v_month_open numeric; v_lifetime_spent numeric; v_lifetime_open numeric;
  v_hold numeric; v_cohort_committed numeric; v_refused boolean := false;
begin
  select * into v_row from public.spend_reservations where attempt_id = p_attempt_id;
  if not found then return 'unavailable'; end if;
  v_month_start := date_trunc('month', v_row.reporting_day::timestamp)::date;
  -- Same fixed lock order as reserve/reconcile. This is the last gate before
  -- the provider wire, so an earlier reservation is not a license to spend
  -- after another call trips the day or a policy is lowered.
  perform pg_advisory_xact_lock(hashtextextended('spend:global:' || v_month_start::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('spend:' || v_row.tenant_id, 0));
  if v_row.proposal_work_key is not null then
    perform pg_advisory_xact_lock(hashtextextended('proposal-work:' || v_row.tenant_id || ':' || v_row.proposal_work_key, 0));
  end if;
  select * into v_row from public.spend_reservations where attempt_id = p_attempt_id for update;
  if v_row.state <> 'reserved' then return case when v_row.state in ('transmitted', 'ambiguous', 'reconciled') then 'already_started' else 'unavailable' end; end if;
  if (now() at time zone 'America/Los_Angeles')::date <> v_row.reporting_day then
    update public.spend_reservations set state = 'released', released_at = now(), updated_at = now()
      where attempt_id = p_attempt_id and state = 'reserved';
    return 'stale_day';
  end if;
  if v_row.research_run_id is not null then
    perform 1 from public.research_runs rr
     where rr.id = v_row.research_run_id and rr.tenant_id = v_row.tenant_id
       and rr.status = 'running' and rr.lease_owner = v_row.research_run_owner
       and rr.lease_expires_at >= now()
     for share;
    if not found then
      update public.spend_reservations set state = 'released', released_at = now(), updated_at = now()
       where attempt_id = p_attempt_id and state = 'reserved';
      return 'run_inactive';
    end if;
  end if;
  if v_row.proposal_work_key is not null and exists (
       select 1 from public.proposal_work_tombstones t
        where t.tenant_id = v_row.tenant_id and t.work_key = v_row.proposal_work_key
     ) then
    update public.spend_reservations set state = 'released', released_at = now(), updated_at = now()
      where attempt_id = p_attempt_id and state = 'reserved';
    return 'work_retired';
  end if;

  select monthly_cap_usd into v_policy_global from public.spend_policy where policy_key = 'global' for share;
  select monthly_cap_usd, lifetime_cap_usd into v_policy_monthly, v_policy_lifetime
    from public.spend_policy where policy_key = 'platform:' || v_row.platform for share;
  if v_policy_global is null or not found then v_refused := true; end if;
  v_global_cap := least(v_row.global_monthly_cap_usd, coalesce(v_policy_global, 0));
  v_monthly_cap := case when v_row.monthly_cap_usd is null then v_policy_monthly
    when v_policy_monthly is null then v_row.monthly_cap_usd else least(v_row.monthly_cap_usd, v_policy_monthly) end;
  v_lifetime_cap := case when v_row.lifetime_cap_usd is null then v_policy_lifetime
    when v_policy_lifetime is null then v_row.lifetime_cap_usd else least(v_row.lifetime_cap_usd, v_policy_lifetime) end;

  if exists (select 1 from public.spend_reservations r where r.tenant_id = v_row.tenant_id
      and r.reporting_day = v_row.reporting_day and r.cap_breached) then v_refused := true; end if;
  select coalesce(sum(spent_usd), 0) into v_global_spent from public.llm_budget_ledger where date_utc >= v_month_start;
  select coalesce(sum(estimated_usd), 0) into v_global_open from public.spend_reservations
    where reporting_day >= v_month_start and state in ('reserved', 'transmitted', 'ambiguous');
  if v_global_spent + v_global_open > v_global_cap then v_refused := true; end if;

  select daily_budget_usd into v_daily_cap from public.tenants where id = v_row.tenant_id;
  select coalesce(sum(spent_usd), 0) into v_spent from public.llm_budget_ledger
    where tenant_id = v_row.tenant_id and date_utc = v_row.reporting_day;
  select coalesce(sum(estimated_usd), 0) into v_open from public.spend_reservations
    where tenant_id = v_row.tenant_id and reporting_day = v_row.reporting_day
      and state in ('reserved', 'transmitted', 'ambiguous');
  v_door_cap := v_daily_cap;
  if v_row.purpose = 'fact_check' then
    v_door_cap := case when v_spent + v_open >= v_daily_cap * 0.92 - 0.000000001 then v_daily_cap else v_daily_cap * 0.50 end;
  elsif v_row.purpose = 'bulk' then
    v_door_cap := v_daily_cap * case when v_row.platform = 'dataforseo-serp' then 0.77 else 0.92 end;
  end if;
  if v_daily_cap is null or v_spent + v_open > v_door_cap then v_refused := true; end if;

  if v_monthly_cap is not null then
    select coalesce(sum(spent_usd), 0) into v_month_spent from public.llm_budget_ledger
      where tenant_id = v_row.tenant_id and platform = v_row.platform and date_utc >= v_month_start;
    select coalesce(sum(estimated_usd), 0) into v_month_open from public.spend_reservations
      where tenant_id = v_row.tenant_id and platform = v_row.platform and reporting_day >= v_month_start
        and state in ('reserved', 'transmitted', 'ambiguous');
    if v_month_spent + v_month_open > v_monthly_cap then v_refused := true; end if;
  end if;
  if v_lifetime_cap is not null then
    select coalesce(sum(spent_usd), 0) into v_lifetime_spent from public.llm_budget_ledger
      where tenant_id = v_row.tenant_id and platform = v_row.platform;
    select coalesce(sum(estimated_usd), 0) into v_lifetime_open from public.spend_reservations
      where tenant_id = v_row.tenant_id and platform = v_row.platform
        and state in ('reserved', 'transmitted', 'ambiguous');
    if v_lifetime_spent + v_lifetime_open > v_lifetime_cap then v_refused := true; end if;
  end if;

  select coalesce(hold_usd, 0) into v_hold from public.cohort_spend_holds
    where tenant_id = v_row.tenant_id and reporting_day = v_row.reporting_day;
  v_hold := coalesce(v_hold, 0);
  select coalesce(sum(case when state = 'reconciled' then accounted_usd else estimated_usd end), 0)
    into v_cohort_committed from public.spend_reservations where tenant_id = v_row.tenant_id
      and reporting_day = v_row.reporting_day and cohort_member
      and state in ('reserved', 'transmitted', 'ambiguous', 'reconciled');
  if v_row.cohort_member and v_cohort_committed > v_hold then v_refused := true; end if;
  if not v_row.cohort_member and v_spent + v_open > v_daily_cap - greatest(v_hold - v_cohort_committed, 0) then v_refused := true; end if;

  if v_refused then
    update public.spend_reservations set state = 'released', released_at = now(), updated_at = now()
      where attempt_id = p_attempt_id and state = 'reserved';
    return 'cap_refused';
  end if;
  update public.spend_reservations set state = 'transmitted', transport_started_at = now(),
    lease_expires_at = greatest(lease_expires_at, now() + interval '15 minutes'), updated_at = now()
   where attempt_id = p_attempt_id;
  return 'claimed';
end;
$$;

drop function if exists public.mark_spend_ambiguous(text, text);
create or replace function public.mark_spend_ambiguous(
  p_attempt_id text,
  p_provider_task_id text default null,
  p_result_payload jsonb default null
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_tenant text; v_state text; v_task text;
begin
  select tenant_id into v_tenant from public.spend_reservations where attempt_id = p_attempt_id;
  if v_tenant is null then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended('spend:' || v_tenant, 0));
  select state, provider_task_id into v_state, v_task from public.spend_reservations where attempt_id = p_attempt_id for update;
  if v_state in ('ambiguous', 'reconciled') and (p_provider_task_id is null or v_task = p_provider_task_id) then
    if p_result_payload is not null then
      update public.spend_reservations set result_payload = coalesce(result_payload, p_result_payload), updated_at = now()
       where attempt_id = p_attempt_id and (result_payload is null or result_payload = p_result_payload);
      if not found then return false; end if;
    end if;
    return true;
  end if;
  if v_state = 'ambiguous' and v_task is null and p_provider_task_id is not null then
    update public.spend_reservations set provider_task_id = p_provider_task_id, updated_at = now() where attempt_id = p_attempt_id; return true;
  end if;
  if v_state not in ('reserved', 'transmitted') then return false; end if;
  update public.spend_reservations set state = 'ambiguous',
    provider_task_id = coalesce(p_provider_task_id, provider_task_id),
    result_payload = coalesce(p_result_payload, result_payload),
    transport_started_at = coalesce(transport_started_at, now()),
    lease_expires_at = greatest(lease_expires_at, now() + interval '15 minutes'), updated_at = now()
   where attempt_id = p_attempt_id;
  return true;
end;
$$;

create or replace function public.release_spend(
  p_attempt_id text,
  p_zero_cost_proven boolean default false
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_tenant text; v_state text;
begin
  select tenant_id into v_tenant from public.spend_reservations where attempt_id = p_attempt_id;
  if v_tenant is null then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended('spend:' || v_tenant, 0));
  select state into v_state from public.spend_reservations where attempt_id = p_attempt_id for update;
  if v_state = 'released' then return true; end if;
  if v_state = 'ambiguous' or v_state = 'reconciled'
     or (v_state = 'transmitted' and not p_zero_cost_proven) then return false; end if;
  update public.spend_reservations set state = 'released', released_at = now(), updated_at = now()
   where attempt_id = p_attempt_id;
  return true;
end;
$$;

create or replace function public.reconcile_spend(
  p_attempt_id text,
  p_accounted_usd numeric,
  p_provider_task_id text default null,
  p_accounting_basis text default 'provider_reported',
  p_result_payload jsonb default null
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_row public.spend_reservations%rowtype; v_tenant text; v_reporting_day date; v_delta numeric;
begin
  if p_accounted_usd is null or p_accounted_usd < 0
     or p_accounting_basis not in ('provider_reported', 'provider_advance', 'usage_estimate', 'reservation_estimate') then return false; end if;
  select tenant_id, reporting_day into v_tenant, v_reporting_day
    from public.spend_reservations where attempt_id = p_attempt_id;
  if v_tenant is null then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended('spend:global:' || date_trunc('month', v_reporting_day::timestamp)::date::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('spend:' || v_tenant, 0));
  select * into v_row from public.spend_reservations where attempt_id = p_attempt_id for update;
  if v_row.provider_task_id is not null and p_provider_task_id is not null
     and v_row.provider_task_id <> p_provider_task_id then return false; end if;
  if v_row.state = 'reconciled' then
    if v_row.accounted_usd = p_accounted_usd
       and v_row.accounting_basis = p_accounting_basis
       and (p_provider_task_id is null or v_row.provider_task_id = p_provider_task_id)
       and v_row.result_payload is null and p_result_payload is not null then
      update public.spend_reservations set result_payload = p_result_payload, updated_at = now()
       where attempt_id = p_attempt_id;
      return true;
    end if;
    -- A late provider receipt may arrive after an expired ambiguous hold was
    -- conservatively settled. Correct the ledger by the delta and attach the
    -- result atomically; never throw away a paid answer because midnight or a
    -- recovery pass got there first.
    if v_row.accounting_basis in ('reservation_estimate', 'provider_advance')
       and p_accounting_basis <> v_row.accounting_basis then
      v_delta := p_accounted_usd - v_row.accounted_usd;
      update public.llm_budget_ledger
         set spent_usd = spent_usd + v_delta,
             metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
               'last_spend_attempt_id', v_row.attempt_id,
               'accounting_basis', p_accounting_basis,
               'corrected_from_provisional_basis', v_row.accounting_basis,
               'cap_breached', p_accounted_usd > v_row.estimated_usd + 0.000001),
             updated_at = now()
       where tenant_id = v_row.tenant_id and date_utc = v_row.reporting_day
         and platform = v_row.platform;
      if not found then return false; end if;
      update public.spend_reservations
         set accounted_usd = p_accounted_usd, accounting_basis = p_accounting_basis,
             cap_breached = p_accounted_usd > estimated_usd + 0.000001,
             result_payload = coalesce(p_result_payload, result_payload),
             provider_task_id = coalesce(p_provider_task_id, provider_task_id),
             updated_at = now()
       where attempt_id = p_attempt_id;
      if v_row.research_run_id is not null then
        update public.research_runs rr set spend_usd = greatest(
          case when jsonb_typeof(rr.progress #> '{funnel,spendUsd}') = 'number'
            then greatest(0, (rr.progress #>> '{funnel,spendUsd}')::numeric) else 0 end,
          (select coalesce(sum(case when s.state = 'reconciled' then s.accounted_usd
                              when s.state in ('transmitted', 'ambiguous') then s.estimated_usd else 0 end), 0)
             from public.spend_reservations s
            where s.tenant_id = v_row.tenant_id and s.research_run_id = v_row.research_run_id)
        ), updated_at = now()
        where rr.id = v_row.research_run_id and rr.tenant_id = v_row.tenant_id;
      end if;
      return true;
    end if;
    return v_row.accounted_usd = p_accounted_usd
      and v_row.accounting_basis = p_accounting_basis
      and (p_provider_task_id is null or v_row.provider_task_id = p_provider_task_id)
      and (p_result_payload is null or v_row.result_payload = p_result_payload);
  end if;
  if v_row.state not in ('transmitted', 'ambiguous') then return false; end if;

  insert into public.llm_budget_ledger (
    tenant_id, date_utc, platform, spent_usd, call_count, metadata
  ) values (
    v_row.tenant_id, v_row.reporting_day, v_row.platform, p_accounted_usd, 1,
    jsonb_build_object('last_spend_attempt_id', v_row.attempt_id,
      'accounting_basis', p_accounting_basis,
      'cap_breached', p_accounted_usd > v_row.estimated_usd + 0.000001)
  ) on conflict (tenant_id, date_utc, platform) do update
    set spent_usd = public.llm_budget_ledger.spent_usd + excluded.spent_usd,
        call_count = public.llm_budget_ledger.call_count + 1,
        metadata = coalesce(public.llm_budget_ledger.metadata, '{}'::jsonb)
          || excluded.metadata,
        updated_at = now();
  update public.spend_reservations set state = 'reconciled', accounted_usd = p_accounted_usd,
    accounting_basis = p_accounting_basis,
    cap_breached = p_accounted_usd > estimated_usd + 0.000001,
    result_payload = coalesce(p_result_payload, result_payload),
    provider_task_id = coalesce(p_provider_task_id, provider_task_id),
    transport_started_at = coalesce(transport_started_at, now()),
    reconciled_at = now(), updated_at = now()
   where attempt_id = p_attempt_id;
  if v_row.research_run_id is not null then
    update public.research_runs rr set spend_usd = greatest(
      case when jsonb_typeof(rr.progress #> '{funnel,spendUsd}') = 'number'
        then greatest(0, (rr.progress #>> '{funnel,spendUsd}')::numeric) else 0 end,
      (select coalesce(sum(case when s.state = 'reconciled' then s.accounted_usd
                          when s.state in ('transmitted', 'ambiguous') then s.estimated_usd else 0 end), 0)
         from public.spend_reservations s
        where s.tenant_id = v_row.tenant_id and s.research_run_id = v_row.research_run_id)
    ), updated_at = now()
    where rr.id = v_row.research_run_id and rr.tenant_id = v_row.tenant_id;
  end if;
  return true;
end;
$$;

create or replace function public.authorize_evidence_task_repost(
  p_cache_key text,
  p_detail text
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_row public.evidence_cache%rowtype;
begin
  if p_cache_key is null or p_cache_key = '' then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended('evidence_cache:' || p_cache_key, 0));
  select * into v_row from public.evidence_cache where cache_key = p_cache_key for update;
  if not found or v_row.provider_task_id is null then return false; end if;
  if v_row.spend_attempt_id is not null and exists (
    select 1 from public.spend_reservations r where r.attempt_id = v_row.spend_attempt_id
      and r.state not in ('reconciled', 'released')
  ) then return false; end if;
  if v_row.provider_repost_count >= 1 then
    update public.evidence_cache set quarantined_at = now(), error_at = now(),
      error_detail = 'blocked:repost_limit', fetch_claimed_until = null, updated_at = now()
      where cache_key = p_cache_key;
    return false;
  end if;
  update public.evidence_cache set provider_repost_count = 1, status = 'error',
    provider_task_id = null, posted_at = null, posted_attempt_at = null,
    quarantined_at = null, fetch_claimed_until = null, error_at = now(),
    error_detail = left('dead_task:' || coalesce(p_detail, 'missing'), 200), updated_at = now()
    where cache_key = p_cache_key;
  return true;
end;
$$;

-- The credit stop shares the ledger table so every provider gate can read one
-- durable source, but it is not spend.  Give the application exactly the one
-- zero-cost metadata mutation it needs instead of leaving the whole spend
-- ledger writable by service_role.
create or replace function public.set_credit_breaker_state(
  p_tenant_id text,
  p_platform text,
  p_state jsonb
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_saved text; v_stamp timestamptz;
begin
  if nullif(p_tenant_id, '') is null or nullif(p_platform, '') is null
     or p_platform not in ('openai', 'dataforseo-serp')
     or not exists (select 1 from public.tenants t where t.id = p_tenant_id) then
    return false;
  end if;
  if p_state is not null then
    if jsonb_typeof(p_state) <> 'object'
       or (select count(*) from jsonb_object_keys(p_state)) <> 2
       or not (p_state ? 'trippedAt') or not (p_state ? 'probeAt')
       or jsonb_typeof(p_state->'trippedAt') <> 'string'
       or jsonb_typeof(p_state->'probeAt') not in ('string', 'null')
       or nullif(p_state->>'trippedAt', '') is null then
      return false;
    end if;
    begin
      v_stamp := (p_state->>'trippedAt')::timestamptz;
      if jsonb_typeof(p_state->'probeAt') = 'string' then
        v_stamp := (p_state->>'probeAt')::timestamptz;
      end if;
    exception when others then
      return false;
    end;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'credit-breaker:' || p_tenant_id || ':' || p_platform, 0));
  insert into public.llm_budget_ledger (
    tenant_id, date_utc, platform, spent_usd, call_count, metadata, updated_at
  ) values (
    p_tenant_id, date '1970-01-01', p_platform, 0, 0,
    jsonb_build_object('creditBreaker', coalesce(p_state, 'null'::jsonb)), now()
  )
  on conflict (tenant_id, date_utc, platform) do update
     set metadata = jsonb_set(
           coalesce(public.llm_budget_ledger.metadata, '{}'::jsonb),
           '{creditBreaker}', coalesce(p_state, 'null'::jsonb), true),
         updated_at = now()
   -- A corrupt/non-state row at the sentinel date is never silently rewritten
   -- into a breaker row or allowed to erase accounted spend.
   where public.llm_budget_ledger.spent_usd = 0
     and public.llm_budget_ledger.call_count = 0
  returning tenant_id into v_saved;
  return v_saved is not null;
end;
$$;

do $$
declare f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'set_cohort_spend_hold', 'release_unused_cohort_spend_hold', 'reserve_spend',
      'claim_spend_transmission', 'mark_spend_ambiguous', 'release_spend', 'reconcile_spend',
      'authorize_evidence_task_repost', 'claim_evidence_fetch', 'set_credit_breaker_state'
    )
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;

-- Close a run and stamp its pass-level spend in the same lease-guarded update.
-- The five-argument function remains during the additive rollout for the old
-- hosted SHA; the new caller uses only this overload.
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
declare v_rows integer; v_attributed numeric;
begin
  if p_outcome not in ('paused', 'completed') then return false; end if;
  if p_spend_usd is not null and p_spend_usd < 0 then return false; end if;
  -- Close the lease door before taking the final sum. A transmitter takes this run FOR SHARE immediately before
  -- the wire; therefore this lock either waits for that transmission to become visible or makes the later claim
  -- observe an inactive run and refuse the wire. The completed row can never freeze a pre-claim $0 snapshot.
  perform 1 from public.research_runs r
   where r.id = p_run_id and r.tenant_id = p_tenant_id
     and r.lease_owner = p_owner and r.lease_expires_at >= now()
     and r.status in ('running', 'paused')
   for update;
  if not found then return false; end if;
  select coalesce(sum(case when s.state = 'reconciled' then s.accounted_usd
                      when s.state in ('transmitted', 'ambiguous') then s.estimated_usd else 0 end), 0)
    into v_attributed from public.spend_reservations s
   where s.tenant_id = p_tenant_id and s.research_run_id = p_run_id;
  update public.research_runs r
     set status = p_outcome,
         current_phase = case when p_outcome = 'completed' then 'done' else r.current_phase end,
         completed_at = case when p_outcome = 'completed' then now() else null end,
         last_error = case when p_outcome = 'completed' then null else p_error end,
         spend_usd = greatest(
           coalesce(r.spend_usd, 0),
           case when jsonb_typeof(r.progress #> '{funnel,spendUsd}') = 'number'
             then greatest(0, (r.progress #>> '{funnel,spendUsd}')::numeric) else 0 end,
           coalesce(v_attributed, 0),
           coalesce(p_spend_usd, 0)
         ),
         lease_owner = null,
         lease_expires_at = null,
         updated_at = now()
   where r.id = p_run_id and r.tenant_id = p_tenant_id
     and r.lease_owner = p_owner and r.lease_expires_at >= now()
     and r.status in ('running', 'paused');
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

revoke all on function public.finish_research_run(text, uuid, text, text, jsonb, numeric) from public, anon, authenticated;
grant execute on function public.finish_research_run(text, uuid, text, text, jsonb, numeric) to service_role;

-- Remove the application role from every superseded spend mutation and from
-- the five-argument run finisher. Funding is currently off, so the short
-- migration-before-deploy window fails closed instead of keeping parallel cap
-- and receipt doors alive after cutover.
do $cleanup$
declare fn record;
begin
  for fn in
    select p.oid::regprocedure::text as signature
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and (
       p.proname in ('increment_llm_spend', 'reserve_provider_spend', 'adjust_provider_spend')
       or (p.proname = 'finish_research_run' and p.pronargs = 5)
     )
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', fn.signature);
  end loop;
end;
$cleanup$;

-- Spend can move only through the reservation/reconciliation functions above.
-- The breaker RPC is the single non-spend metadata door; reads remain available
-- to the server-side caps and diagnostics.
revoke insert, update, delete, truncate, references, trigger
  on table public.llm_budget_ledger from anon, authenticated, service_role;
grant select on table public.llm_budget_ledger to service_role;

do $privileges$
declare v_role text;
begin
  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    if has_table_privilege(v_role, 'public.llm_budget_ledger', 'INSERT')
       or has_table_privilege(v_role, 'public.llm_budget_ledger', 'UPDATE')
       or has_table_privilege(v_role, 'public.llm_budget_ledger', 'DELETE')
       or has_table_privilege(v_role, 'public.llm_budget_ledger', 'TRUNCATE')
       or has_table_privilege(v_role, 'public.llm_budget_ledger', 'REFERENCES')
       or has_table_privilege(v_role, 'public.llm_budget_ledger', 'TRIGGER') then
      raise exception '% retains direct llm_budget_ledger mutation', v_role;
    end if;
  end loop;
  if not has_table_privilege('service_role', 'public.llm_budget_ledger', 'SELECT') then
    raise exception 'service_role cannot read llm_budget_ledger';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'set_credit_breaker_state'
       and p.prosecdef
  ) then
    raise exception 'set_credit_breaker_state must be SECURITY DEFINER';
  end if;
end;
$privileges$;
