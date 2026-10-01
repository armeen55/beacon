-- A new pending generation has no provider provenance or served-model receipt.
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
        payload = null, provenance = '{}'::jsonb, model_served = null, ready_at = null,
        cost_usd = 0, content_hash = null, posted_at = null,
        posted_attempt_at = null, provider_repost_count = 0,
        status = 'pending', fetch_claimed_until = now() + make_interval(secs => p_claim_seconds),
        fetch_generation = v.fetch_generation + 1,
        error_at = null, error_detail = null, updated_at = now() where cache_key = p_cache_key;
      return query select 'claimed'::text, null::jsonb, null::text, null::text, null::timestamptz, 0::numeric, v.fetch_generation + 1; return;
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

revoke all on function public.claim_evidence_fetch(text, text, text, text, text, integer, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.claim_evidence_fetch(text, text, text, text, text, integer, text, text, text, integer) to service_role;
