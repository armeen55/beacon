create table if not exists public.autonomous_run_claims (
  tenant_id   text not null,
  day_key     text not null,
  claimed_at  timestamptz not null default now(),
  primary key (tenant_id, day_key)
);

alter table public.autonomous_run_claims enable row level security;

drop policy if exists deny_anon on public.autonomous_run_claims;
create policy deny_anon on public.autonomous_run_claims
  as permissive for all to anon
  using (false) with check (false);

drop policy if exists tenant_authenticated_rw on public.autonomous_run_claims;
create policy tenant_authenticated_rw on public.autonomous_run_claims
  as permissive for all to authenticated
  using (is_tenant_member(tenant_id))
  with check (is_tenant_member(tenant_id));;
