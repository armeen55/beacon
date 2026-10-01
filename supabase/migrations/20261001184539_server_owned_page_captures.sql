begin;

-- Captured evidence is written by the canonical server boundary, never a tenant client.
drop policy tenant_authenticated_rw on public.page_snapshots;
create policy tenant_authenticated_read on public.page_snapshots
  for select to authenticated using (public.is_tenant_member(tenant_id));
revoke insert, update, delete, truncate, references, trigger
  on public.page_snapshots from anon, authenticated;

do $check$
declare role_name text;
begin
  foreach role_name in array array['anon', 'authenticated'] loop
    if has_table_privilege(role_name, 'public.page_snapshots', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       or exists (select 1 from pg_attribute where attrelid = 'public.page_snapshots'::regclass and attnum > 0 and not attisdropped
         and (has_column_privilege(role_name, attrelid, attnum, 'INSERT,UPDATE,REFERENCES'))) then
      raise exception 'page capture client mutation privileges remain for %', role_name;
    end if;
  end loop;
  if not has_table_privilege('authenticated', 'public.page_snapshots', 'SELECT')
     or exists (select 1 from unnest(array['SELECT','INSERT','UPDATE','DELETE']) privilege
       where not has_table_privilege('service_role', 'public.page_snapshots', privilege)) then
    raise exception 'page capture server or tenant read privileges changed';
  end if;
end;
$check$;

commit;
