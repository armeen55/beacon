-- Slice 5 connected onboarding state (2026-07-24). See the repo migration file
-- migrations/2026-07-24_slice5_connected_state.sql for full context. ONE
-- idempotent change: the atomic website-replacement invalidation RPC.

create or replace function public.replace_onboarding_website(
  p_tenant_id text,
  p_domain    text
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_domain text;
  v_status text;
begin
  select t.domain, t.status into v_domain, v_status
    from public.tenants t
   where t.id = p_tenant_id;

  -- Only a still-onboarding account may be replaced; anything else writes nothing.
  if v_status is distinct from 'pending_onboarding' then
    return 'not_pending';
  end if;

  -- Idempotent: re-submitting the SAME domain invalidates nothing.
  if v_domain is not distinct from p_domain then
    return 'unchanged';
  end if;

  -- The domain truly changed: invalidate every downstream artifact in one
  -- transaction so no prompt or profile built for the old site survives.
  update public.tenants
     set domain      = p_domain,
         growth_goal = null,
         updated_at  = now()
   where id = p_tenant_id;

  update public.tracked_prompts
     set is_active  = false,
         updated_at = now()
   where tenant_id = p_tenant_id
     and is_active = true;

  -- Reset the profile to the canonical empty row (a missing row stays missing).
  update public.business_config
     set data       = jsonb_build_object('schemaVersion', 2),
         updated_at = now()
   where id = p_tenant_id;

  return 'replaced';
end;
$$;

revoke all on function public.replace_onboarding_website(text, text) from public;
revoke all on function public.replace_onboarding_website(text, text) from anon;
revoke all on function public.replace_onboarding_website(text, text) from authenticated;
grant execute on function public.replace_onboarding_website(text, text) to service_role;;
