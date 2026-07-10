-- Per-tenant OAuth hardening, patch mode (operator guardrails, 2026-07-09).
--
-- WHY A THIRD MODE: 'connect' and 'refresh' cover the two token-writing paths,
-- but the app also PATCHES non-token fields onto an existing row (last_synced_at,
-- ga4_property_id, disconnected_at, auth_failed_at, selected_location_*). Those
-- were persisted through an app-side read-then-merge-then-full-upsert. Two Vercel
-- instances can race that sequence: instance A reads the row, instance B rotates
-- the refresh_token (mints a fresh one at consent/refresh) and writes it, then A
-- writes back the STALE row it read, resurrecting the dead refresh_token and
-- dropping B's rotation. That is adversarial review finding P1-1 (cross-instance
-- patch-path race). Moving the patch into ONE SQL statement makes it atomic, and
-- stripping refresh_token from the patch payload in SQL makes it IMPOSSIBLE for a
-- patch to touch the refresh_token at all, regardless of what the caller sends.
--
-- WHY 'patch' STRIPS refresh_token (payload - 'refresh_token'): a patch must
-- never carry the refresh_token forward. Rotations belong to 'refresh' mode (the
-- cross-instance compare-and-swap on strictly-newer expires_at). By subtracting
-- the key here, even a caller that accidentally includes a stale (or empty)
-- refresh_token cannot overwrite the stored one; the stored refresh_token is
-- left exactly as it was and only the other fields merge in.
--
-- WHY 'patch' DOES NOT RAISE on an empty refresh token (review finding P2-3):
-- 'connect' fails closed when neither side has a usable refresh_token, because a
-- fresh connect with no refresh token is a dead grant. A PATCH is different: a
-- legacy row whose refresh_token is already empty (authorized before the guard
-- landed) must still accept a last_synced_at / disconnected_at / auth_failed_at
-- update — those are exactly the signals the UI needs to tell the operator to
-- reconnect. Raising here would make a dead legacy row un-patchable and freeze
-- its honest state. 'patch' is UPDATE-only, so it never CREATES such a row.
--
-- Modes (unchanged 'connect' + 'refresh', new 'patch'):
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
--   'patch' (updateConnectorToken, non-token fields): UPDATE only, never inserts.
--     * payload = payload || (p_payload - 'refresh_token'), so the refresh_token
--       can NEVER be touched by a patch; all other keys merge in.
--     * no raise on an empty refresh token (legacy dead rows must stay patchable).
--     * returns {ok, updated} where updated = a row matched (rowcount > 0).
--
-- Follows the proven RPC contract (gsc_page_totals_v1 / ga4_monthly_sessions_v1):
-- search_path pinned, EXECUTE revoked from public/anon/authenticated, granted
-- to service_role only. Additive + reversible (DROP FUNCTION); touches no data.
-- CREATE OR REPLACE keeps the identical signature the applied guarded-upsert
-- migration installed; 'connect' and 'refresh' behavior is byte-identical below.

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
  elsif p_mode = 'patch' then
    -- Non-token field merge (last_synced_at, ga4_property_id, disconnected_at,
    -- auth_failed_at, selected_location_*). UPDATE only (never inserts) and the
    -- refresh_token key is subtracted from the incoming payload so a patch can
    -- NEVER touch it (review finding P1-1). No expiry CAS and no raise: a patch
    -- carries no token to lose, and a legacy empty-refresh row must stay
    -- patchable (review finding P2-3). Matching zero rows is a silent no-op,
    -- mirroring the app-side "row missing -> return" behavior.
    update connector_tokens
      set payload = payload || (p_payload - 'refresh_token'),
          updated_at = now()
      where tenant_id = p_tenant
        and provider = p_provider;
    get diagnostics v_updated = row_count;
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
