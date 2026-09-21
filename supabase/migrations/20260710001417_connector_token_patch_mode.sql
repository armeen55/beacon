-- oauth-patch-mode (adversarial review P1-1 + P2-3, 2026-07-09). Adds mode 'patch'
-- to save_connector_token_guarded_v1; 'connect' and 'refresh' are byte-identical to
-- the applied version. Full rationale in migrations/2026-07-09_connector_token_patch_mode.sql.

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
    return jsonb_build_object('ok', true, 'updated', v_updated > 0);
  elsif p_mode = 'patch' then
    -- Non-token field merge (last_synced_at, ga4_property_id, disconnected_at,
    -- auth_failed_at, selected_location_*). UPDATE only (never inserts) and the
    -- refresh_token key is subtracted from the incoming payload so a patch can
    -- NEVER touch it (review finding P1-1). No expiry CAS and no raise: a patch
    -- carries no token to lose, and a legacy empty-refresh row must stay
    -- patchable (review finding P2-3). Matching zero rows is a silent no-op,
    -- reported via updated:false.
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
grant execute on function public.save_connector_token_guarded_v1(text, text, jsonb, text) to service_role;;
