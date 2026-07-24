-- Slice 5 connected onboarding state (2026-07-24).
--
-- ADDITIVE follow-on to 2026-07-24_slice5_onboarding.sql (immutable). It carries
-- ONE idempotent change: the website-replacement invalidation RPC. Do NOT apply
-- from an agent; the orchestrator applies it. Safe to re-run.
--
-- SECURITY: the function is SECURITY DEFINER, tenant-scoped by its explicit
-- p_tenant_id argument, revoked from public / anon / authenticated, granted to
-- service_role only. It writes ONLY while the account is still onboarding.
--
-- WHY: changing the website mid-onboarding used to invalidate nothing downstream
-- (the old path updated tenants.domain alone), so a stale goal, stale profile,
-- and prompts built for the OLD site survived into the new one. This RPC makes a
-- real replacement atomic: new domain, cleared goal, deactivated prompts, and a
-- reset profile, all in one transaction, so no old-site artifact can activate.

-- ─────────────────────────────────────────────────────────────────────────────
-- replace_onboarding_website: atomic, status-guarded website replacement.
--   returns 'not_pending' (no writes) when the account is not pending_onboarding
--   returns 'unchanged'    (no writes) when the saved domain already equals p_domain
--   returns 'replaced'                 after the one-transaction invalidation
-- ─────────────────────────────────────────────────────────────────────────────
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
grant execute on function public.replace_onboarding_website(text, text) to service_role;
