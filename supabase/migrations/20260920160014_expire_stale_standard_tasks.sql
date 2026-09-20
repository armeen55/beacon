-- A provider task repost must be a new spend generation. The original function
-- cleared the task id but left both the old spend receipt and generation behind,
-- so its advertised one clean retry could resolve back to the old purchase.
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
  update public.evidence_cache set provider_repost_count = 1, fetch_generation = fetch_generation + 1,
    status = 'error', provider_task_id = null, spend_attempt_id = null, posted_at = null,
    posted_attempt_at = null, quarantined_at = null, fetch_claimed_until = null, error_at = now(),
    error_detail = left('dead_task:' || coalesce(p_detail, 'missing'), 200), updated_at = now()
    where cache_key = p_cache_key;
  return true;
end;
$$;

revoke all on function public.authorize_evidence_task_repost(text, text) from public, anon, authenticated;
grant execute on function public.authorize_evidence_task_repost(text, text) to service_role;
