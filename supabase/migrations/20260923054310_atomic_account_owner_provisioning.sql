-- The MVP permits one owner per user and one owner per account. Existing
-- unexpected rows make this migration fail without changing stored evidence.
create unique index if not exists tenant_members_one_account_per_user
  on public.tenant_members (user_id);
create unique index if not exists tenant_members_one_owner_per_account
  on public.tenant_members (tenant_id);

-- A function call is one database transaction. Advisory locking makes
-- simultaneous callbacks for the same user return the same membership.
create or replace function public.provision_account_owner(
  p_user_id uuid,
  p_business_name text
) returns table(tenant_id text, created boolean)
language plpgsql security invoker set search_path = ''
as $$
declare
  v_existing text;
  v_role text;
  v_slug text;
  v_id text;
begin
  if p_user_id is null or nullif(pg_catalog.btrim(p_business_name), '') is null then
    raise exception 'invalid provisioning input' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('beacon-owner:' || p_user_id::text, 0));
  select tm.tenant_id, tm.role into v_existing, v_role
    from public.tenant_members tm where tm.user_id = p_user_id;
  if found then
    if v_role <> 'owner' then
      raise exception 'membership is not an owner' using errcode = '42501';
    end if;
    return query select v_existing, false;
    return;
  end if;

  v_slug := pg_catalog.replace(p_user_id::text, '-', '');
  v_id := 'tenant-' || v_slug;
  -- An ownerless existing row is not evidence that this user created it.
  if exists (select 1 from public.tenants t where t.id = v_id or t.slug = v_slug) then
    raise exception 'unowned tenant identity collision' using errcode = '23505';
  end if;

  insert into public.tenants
    (id, slug, business_name, domain, signup_date, tos_accepted_at,
     daily_budget_usd, growth_goal, status, created_at, updated_at)
  values
    (v_id, v_slug, p_business_name, '', pg_catalog.now(), null,
     5, null, 'pending_onboarding', pg_catalog.now(), pg_catalog.now());
  insert into public.tenant_members (user_id, tenant_id, role, created_at)
  values (p_user_id, v_id, 'owner', pg_catalog.now());
  return query select v_id, true;
end;
$$;

revoke all on function public.provision_account_owner(uuid, text)
  from public, anon, authenticated;
grant execute on function public.provision_account_owner(uuid, text)
  to service_role;
