-- Slice 6D: quarantine truth for the evidence cache (2026-07-26).
-- ADDITIVE + IDEMPOTENT. See migrations/2026-07-26_slice6d_quarantine.sql.
alter table public.evidence_cache add column if not exists quarantined_at timestamptz;

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
    -- QUARANTINED: we may already be paying for a task we cannot name. Nothing
    -- below may touch this row; the client clears it from the free listing.
    if v.quarantined_at is not null then
      return query select 'pending'::text, null::jsonb, v.provider_task_id, v.model_served, v.ready_at, v.cost_usd;
      return;
    end if;
    -- Expired task identity: results purged by the provider; clear once, reclaim.
    if v.provider_task_id is not null and v.expires_at <= now() and v.quarantined_at is null then
      update public.evidence_cache c
         set provider_task_id = null, posted_at = null, posted_attempt_at = null,
             status = 'pending',
             fetch_claimed_until = now() + make_interval(secs => p_claim_seconds),
             error_at = null, error_detail = null,
             updated_at = now()
       where c.cache_key = p_cache_key;
      return query select 'claimed'::text, null::jsonb, null::text, v.model_served, null::timestamptz, 0::numeric;
      return;
    end if;
    if v.status = 'pending' and (v.fetch_claimed_until is null or v.fetch_claimed_until > now()) and v.provider_task_id is not null and v.expires_at > now() then
      return query select 'pending'::text, null::jsonb, v.provider_task_id, v.model_served, v.ready_at, v.cost_usd;
      return;
    end if;
    if v.status = 'pending' and v.fetch_claimed_until is not null and v.fetch_claimed_until > now() then
      return query select 'pending'::text, null::jsonb, v.provider_task_id, v.model_served, v.ready_at, v.cost_usd;
      return;
    end if;
    -- A pre-post receipt with NO task id and NO quarantine mark means the poster
    -- crashed mid-POST: the provider may hold a paid task we cannot name. Honor
    -- the receipt by quarantining the row durably instead of reclaiming it, so a
    -- crash can never buy the same task twice.
    if v.posted_attempt_at is not null and v.provider_task_id is null and v.quarantined_at is null and v.status = 'pending' then
      update public.evidence_cache c
         set quarantined_at = now(), updated_at = now()
       where c.cache_key = p_cache_key;
      return query select 'pending'::text, null::jsonb, null::text, v.model_served, v.ready_at, v.cost_usd;
      return;
    end if;
    if v.quarantined_at is null then
      update public.evidence_cache c
         set status = 'pending',
             fetch_claimed_until = now() + make_interval(secs => p_claim_seconds),
             error_at = null, error_detail = null,
             updated_at = now()
       where c.cache_key = p_cache_key;
      return query select 'claimed'::text, null::jsonb, v.provider_task_id, v.model_served, v.ready_at, v.cost_usd;
      return;
    end if;
    return query select 'pending'::text, null::jsonb, v.provider_task_id, v.model_served, v.ready_at, v.cost_usd;
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
grant execute on function public.claim_evidence_fetch(text, text, text, text, text, int, text, text, text, int) to service_role;;
