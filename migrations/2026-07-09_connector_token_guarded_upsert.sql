-- Per-tenant OAuth hardening (operator guardrails, 2026-07-09).
--
-- WHY DATABASE-SIDE: the never-erase rule ("an empty refresh_token must never
-- replace a stored non-empty one") was previously enforced by an app-side
-- read-then-merge, which two concurrent callbacks (or two Vercel instances)
-- can still race: both read, both decide, last write wins. Moving the rule
-- into ONE SQL statement makes it atomic under any concurrency. Likewise,
-- refresh persistence becomes a conditional UPDATE (only when the incoming
-- expiry is strictly newer), which is the cross-instance compare-and-swap: an
-- in-process single-flight only dedupes within one lambda, so concurrent
-- refreshes from different instances must resolve here, losers no-op.
--
-- Modes:
--   'connect' (OAuth callback): atomic upsert on (tenant_id, provider).
--     * incoming refresh_token empty + stored non-empty -> the stored
--       refresh_token is preserved INSIDE the upsert statement.
--     * incoming AND stored refresh_token both empty -> RAISE EXCEPTION
--       (fail-closed; the whole statement rolls back, nothing is written).
--   'refresh' (persistRefreshedGoogleToken): UPDATE only, never inserts.
--     * applies access_token/expires_at (and refresh_token only when the
--       incoming one is non-empty, i.e. Google rotated it)
--     * ONLY where the incoming expires_at is strictly newer than the stored
--       one; a staler concurrent write updates zero rows ({updated:false}).
--
-- Follows the proven RPC contract (gsc_page_totals_v1 / ga4_monthly_sessions_v1):
-- search_path pinned, EXECUTE revoked from public/anon/authenticated, granted
-- to service_role only. Additive + reversible (DROP FUNCTION); touches no data.

create or replace function public.save_connector_token_guarded_v1(
  p_tenant text,
  p_provider text,
  p_payload jsonb,
  p_mode text
) returns jsonb
language plpgsql
volatile
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_final_refresh text;
  v_retained boolean := false;
  v_updated integer := 0;
begin
  if p_mode = 'connect' then
    insert into connector_tokens (tenant_id, provider, payload, updated_at)
    values (p_tenant, p_provider, p_payload, now())
    on conflict (tenant_id, provider) do update
      set payload = case
            when coalesce(excluded.payload->>'refresh_token', '') = ''
                 and coalesce(connector_tokens.payload->>'refresh_token', '') <> ''
              then jsonb_set(excluded.payload, '{refresh_token}',
                             connector_tokens.payload->'refresh_token')
            else excluded.payload
          end,
          updated_at = now()
    returning coalesce(payload->>'refresh_token', ''),
              (coalesce(p_payload->>'refresh_token', '') = ''
               and coalesce(payload->>'refresh_token', '') <> '')
      into v_final_refresh, v_retained;
    if v_final_refresh = '' then
      -- Neither the new grant nor the stored row has a usable refresh token.
      -- A row like this dies in about an hour with no self-heal, so nothing
      -- may be written; raising aborts (rolls back) this statement's insert.
      raise exception 'save_connector_token_guarded_v1: refused connect write for provider=% with no usable refresh token (incoming and stored both empty)', p_provider
        using errcode = 'P0001';
    end if;
    return jsonb_build_object('ok', true, 'retained_stored_refresh', v_retained);
  elsif p_mode = 'refresh' then
    update connector_tokens
      set payload = payload
            || jsonb_build_object(
                 'access_token', p_payload->'access_token',
                 'expires_at',   p_payload->'expires_at')
            || case when coalesce(p_payload->>'refresh_token', '') <> ''
                 then jsonb_build_object('refresh_token', p_payload->'refresh_token')
                 else '{}'::jsonb
               end,
          updated_at = now()
      where tenant_id = p_tenant
        and provider = p_provider
        and coalesce((payload->>'expires_at')::numeric, 0)
              < (p_payload->>'expires_at')::numeric;
    get diagnostics v_updated = row_count;
    -- updated:false = the CAS lost (a fresher token is already stored) or no
    -- row exists; either way the correct outcome is a silent no-op.
    return jsonb_build_object('ok', true, 'updated', v_updated > 0);
  end if;
  raise exception 'save_connector_token_guarded_v1: unknown mode %', p_mode
    using errcode = 'P0001';
end
$function$;

revoke execute on function public.save_connector_token_guarded_v1(text, text, jsonb, text) from public;
revoke execute on function public.save_connector_token_guarded_v1(text, text, jsonb, text) from anon;
revoke execute on function public.save_connector_token_guarded_v1(text, text, jsonb, text) from authenticated;
grant execute on function public.save_connector_token_guarded_v1(text, text, jsonb, text) to service_role;
