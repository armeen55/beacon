-- Per-tenant OAuth hardening (operator guardrails, 2026-07-09).
-- See migrations/2026-07-09_connector_token_guarded_upsert.sql in the repo for
-- the full rationale. Modes: 'connect' = atomic never-erase upsert (raises on
-- both-empty refresh token); 'refresh' = conditional UPDATE, the cross-instance
-- compare-and-swap (staler expires_at no-ops, refresh_token only when rotated).

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
  end if;
  raise exception 'save_connector_token_guarded_v1: unknown mode %', p_mode
    using errcode = 'P0001';
end
$function$;

revoke execute on function public.save_connector_token_guarded_v1(text, text, jsonb, text) from public;
revoke execute on function public.save_connector_token_guarded_v1(text, text, jsonb, text) from anon;
revoke execute on function public.save_connector_token_guarded_v1(text, text, jsonb, text) from authenticated;
grant execute on function public.save_connector_token_guarded_v1(text, text, jsonb, text) to service_role;;
