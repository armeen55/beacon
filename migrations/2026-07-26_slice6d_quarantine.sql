-- Slice 6D: quarantine truth for the evidence cache (2026-07-26).
--
-- ADDITIVE + IDEMPOTENT. Does NOT touch the applied 2026-07-25 / 6C files.
--
-- WHY QUARANTINE EXISTS. Two moments leave us holding a task we may already have
-- PAID for but cannot name:
--   a. an uncertain POST - the transport threw after the reservation, so the
--      provider may or may not have created the task; and
--   b. an accepted POST whose provider_task_id write did not persist - the task
--      certainly exists and was certainly charged, and we lost its id.
-- Before this migration both cases were guarded only by a 15 minute ambiguity
-- lease. When that lease lapsed the claim reclaimed the row and REPOSTED it: a
-- second paid task for the same work. That is the defect this closes.
--
-- A quarantined row (quarantined_at is not null) is now inert to every branch of
-- the claim: it is never reclaimed, never expiry-cleared, never reposted. The
-- claim always answers 'pending' and hands back whatever provider_task_id it has,
-- so the caller can only ever do FREE work on it. The single sanctioned way out is
-- the provider's FREE tasks_ready listing, matched on our own deterministic tag
-- (= cache_key): the client persists the recovered id and clears quarantined_at.
-- Zero automatic paid reposts, ever. We would rather stall a row visibly than pay
-- twice for the same task.
--
-- SPEND NOTE (accuracy, not a change here): the monthly cap is RESERVATION based.
-- reserve_provider_spend refuses any call whose ESTIMATE would cross the cap, and
-- adjust_provider_spend may later reconcile recorded spend upward to the
-- provider's actual. So recorded spend can overshoot the cap by at most
-- (actual minus estimate) on the single last call that got through. It is a
-- bounded overshoot, not a hard per-dollar ceiling.
--
-- SECURITY: unchanged. SECURITY DEFINER, search_path pinned to public, execute
-- revoked from public/anon/authenticated and granted only to service_role. The
-- exact signature and the per-cache-key advisory lock are preserved.
--
-- Apply via MCP apply_migration (orchestrator only). Idempotent: safe to re-run.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Quarantine marker (additive).
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.evidence_cache add column if not exists quarantined_at timestamptz;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Single-flight claim, now quarantine-aware. Outcomes unchanged:
--    'ready'   - a fresh ready row exists; caller uses payload at $0.
--    'claimed' - the caller now owns the fetch (row is pending, lease set).
--    'pending' - the row is QUARANTINED, or another invocation holds a live claim,
--                or an UNEXPIRED provider task is in flight; the caller treats all
--                three as resumable waiting state and does only free work.
--    A stale-ready, errored, expired-claim, expired-row, or expired-TASK row is
--    re-claimable ONLY while it is not quarantined.
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
    -- QUARANTINED: we may already be paying for a task we cannot name. Nothing
    -- below may touch this row. Answer 'pending' forever until the client clears
    -- quarantined_at from the provider's free finished-task listing.
    if v.quarantined_at is not null then
      return query select 'pending'::text, null::jsonb, v.provider_task_id, v.model_served, v.ready_at, v.cost_usd;
      return;
    end if;
    -- Expired task identity: the id is immortal in our row but its results have
    -- been purged by the provider, so stop GETting a dead task forever. Clear the
    -- stale identity once and fall through to a fresh claim (re-post clean).
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
    -- A pre-post receipt with NO task id and NO quarantine mark means the poster
    -- crashed mid-POST: the provider may hold a paid task we cannot name. Honor
    -- the receipt by quarantining the row durably instead of reclaiming it, so a
    -- crash can never buy the same task twice. The client recovers it for free
    -- via tasks_ready, or releases it for one clean repost after the window.
    if v.posted_attempt_at is not null and v.provider_task_id is null and v.quarantined_at is null and v.status = 'pending' then
      update public.evidence_cache c
         set quarantined_at = now(), updated_at = now()
       where c.cache_key = p_cache_key;
      return query select 'pending'::text, null::jsonb, null::text, v.model_served, v.ready_at, v.cost_usd;
      return;
    end if;
    -- Stale ready, errored, or dead claim: reclaim for a fresh fetch. Never a
    -- quarantined row (guarded above and asserted again here).
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
grant execute on function public.claim_evidence_fetch(text, text, text, text, text, int, text, text, text, int) to service_role;
