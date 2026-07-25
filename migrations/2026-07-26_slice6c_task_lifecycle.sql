-- Slice 6C: task-lifecycle truth for the evidence cache (2026-07-26).
--
-- ADDITIVE + IDEMPOTENT. Does NOT touch the applied 2026-07-25 files. Two pieces:
--
--   1. evidence_cache.posted_attempt_at column. The Standard-task money path
--      persists a pre-post receipt (posted_attempt_at + a short ambiguity lease)
--      BEFORE it calls the provider, so an uncertain post is never silently
--      reposted. The column was referenced by the client but never created, so
--      the receipt write failed; the client now fails closed on that write, which
--      makes the column mandatory. Additive and safe to re-run.
--
--   2. claim_evidence_fetch with ONE change in semantics: a provider task id is
--      IMMORTAL in our row, but the provider purges task RESULTS after ~a month
--      (it then answers a GET with 40403 Results Expired / 40401 Task Not Found).
--      Without this change an expired task id would keep routing every visit into
--      a free GET that can never succeed - an eternal, useless wait. Now the
--      pending branch additionally requires the row to be unexpired
--      (v.expires_at > now()); when a row still carries a provider_task_id but has
--      expired, we clear the stale task identity (provider_task_id, posted_at,
--      posted_attempt_at, fetch_claimed_until) and fall through to a fresh claim,
--      so an expired task becomes reclaimable exactly once and is re-posted clean.
--
-- SECURITY: unchanged. SECURITY DEFINER, search_path pinned to public, execute
-- revoked from public/anon/authenticated and granted only to service_role. The
-- exact signature and per-cache-key advisory lock are preserved.
--
-- Apply via MCP apply_migration (orchestrator only). Idempotent: safe to re-run.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Pre-post receipt column (additive; the client fails closed without it).
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.evidence_cache add column if not exists posted_attempt_at timestamptz;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Single-flight claim, now expiry-aware. Outcomes unchanged:
--    'ready'   - a fresh ready row exists; caller uses payload at $0.
--    'claimed' - the caller now owns the fetch (row is pending, lease set).
--    'pending' - another invocation holds a live claim, OR an UNEXPIRED provider
--                task is in flight; caller treats it as resumable waiting state.
--    A stale-ready, errored, expired-claim, expired-row, or expired-TASK row is
--    re-claimable (the expired task has its dead identity cleared first).
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
    -- Expired task identity: the id is immortal in our row but its results have
    -- been purged by the provider, so stop GETting a dead task forever. Clear the
    -- stale identity once and fall through to a fresh claim (re-post clean).
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
      -- A durable, UNEXPIRED provider task is in flight; the caller may GET it
      -- (free) but must never repost. Surface the task id.
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
