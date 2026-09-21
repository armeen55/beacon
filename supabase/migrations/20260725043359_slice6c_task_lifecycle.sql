-- Slice 6C: task-lifecycle truth for the evidence cache (2026-07-26).
-- ADDITIVE + IDEMPOTENT. See migrations/2026-07-26_slice6c_task_lifecycle.sql.
alter table public.evidence_cache add column if not exists posted_attempt_at timestamptz;

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
    -- Expired task identity: results purged by the provider; clear once, reclaim.
    if v.provider_task_id is not null and v.expires_at <= now() then
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
grant execute on function public.claim_evidence_fetch(text, text, text, text, text, int, text, text, text, int) to service_role;;
