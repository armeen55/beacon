-- Customer-visible queue releases are not generic cache blobs. Keep every
-- release as an immutable generation, let the server read it, and reserve all
-- mutation for the transaction that stamps the matching proposal ranking.
create table public.customer_surface_releases (
  generation bigint generated always as identity primary key,
  tenant_id text not null references public.tenants(id) on delete cascade,
  scope_key text not null,
  release_id text not null check (release_id <> ''),
  content jsonb not null,
  published_at timestamptz not null default now(),
  unique (tenant_id, release_id),
  unique (scope_key, release_id),
  check (
    jsonb_typeof(content) = 'array'
    and jsonb_array_length(content) = 1
    and jsonb_typeof(content->0) = 'object'
    and content->0->>'tenantId' = tenant_id
    and content->0->>'releaseId' = release_id
  )
);
create index customer_surface_releases_current
  on public.customer_surface_releases (scope_key, generation desc);

alter table public.customer_surface_releases enable row level security;
alter table public.customer_surface_releases force row level security;
revoke all on table public.customer_surface_releases from public, anon, authenticated, service_role;
grant select on table public.customer_surface_releases to service_role;

-- Copy the one legacy current release per tenant into the append-only release
-- ledger. The source row stays in place as immutable history; no migration may
-- silently skip a malformed customer release and make a live queue disappear.
do $validate_legacy_customer_surfaces$
begin
  if exists (
    select 1
      from public.json_store_blobs b
     where (b.store_name = 'customer-surface'
            or b.scope_key like 'customer-surface::tenant:%')
       and not exists (
         select 1
           from public.tenants t
          where b.store_name = 'customer-surface'
            and b.scope_key = 'customer-surface::tenant:' || t.slug
            and jsonb_typeof(b.content) = 'array'
            and jsonb_array_length(b.content) = 1
            and jsonb_typeof(b.content->0) = 'object'
            and nullif(b.content->0->>'releaseId', '') is not null
            and b.content->0->>'tenantId' = t.id
       )
  ) then
    raise exception 'customer-surface legacy row is malformed; refusing to lose it during migration';
  end if;
end;
$validate_legacy_customer_surfaces$;

insert into public.customer_surface_releases
  (tenant_id, scope_key, release_id, content, published_at)
select t.id, b.scope_key, b.content->0->>'releaseId', b.content, b.updated_at
  from public.json_store_blobs b
  join public.tenants t
    on b.scope_key = 'customer-surface::tenant:' || t.slug
 where b.store_name = 'customer-surface'
on conflict (tenant_id, release_id) do nothing;

-- Generic cache DML remains available for actual caches, but it can no longer
-- insert, rewrite, rename, or delete a legacy customer-surface row. This closes
-- the database-level bypass even for service_role code that ignores the
-- application writer guard.
create or replace function public.guard_legacy_customer_surface_blob()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  if (tg_op <> 'INSERT' and (
        old.store_name = 'customer-surface'
        or old.scope_key like 'customer-surface::tenant:%'
      ))
     or (tg_op <> 'DELETE' and (
        new.store_name = 'customer-surface'
        or new.scope_key like 'customer-surface::tenant:%'
      )) then
    raise exception 'customer-surface releases may only be written through publish_customer_release'
      using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;

revoke all on function public.guard_legacy_customer_surface_blob() from public, anon, authenticated, service_role;
drop trigger if exists trg_guard_legacy_customer_surface_blob on public.json_store_blobs;
create trigger trg_guard_legacy_customer_surface_blob
before insert or update or delete on public.json_store_blobs
for each row execute function public.guard_legacy_customer_surface_blob();
revoke truncate, references, trigger on table public.json_store_blobs
  from anon, authenticated, service_role;

-- One release and its proposal ranking commit together or neither changes.
-- The advisory lock covers the cold-start case where no release row exists yet;
-- the expected-prior comparison then makes publication a tenant-scoped CAS.
create or replace function public.publish_customer_release(
  p_tenant_id text,
  p_expected_prior text,
  p_release text,
  p_scope_key text,
  p_store_name text,
  p_content jsonb
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare v_prior text; v_slug text; v_rows integer; v_size integer; v_manifest jsonb;
begin
  if nullif(p_tenant_id, '') is null or nullif(p_release, '') is null
     or nullif(p_scope_key, '') is null or nullif(p_store_name, '') is null then
    raise exception 'publish_customer_release: invalid release payload';
  end if;
  select t.slug into v_slug from public.tenants t where t.id = p_tenant_id;
  v_manifest := p_content->0->'manifest';
  v_size := case when jsonb_typeof(v_manifest) = 'array' then jsonb_array_length(v_manifest) else -1 end;
  if v_slug is null or p_store_name <> 'customer-surface'
     or p_scope_key <> 'customer-surface::tenant:' || v_slug
     or jsonb_typeof(p_content) <> 'array' or jsonb_array_length(p_content) <> 1
     or jsonb_typeof(p_content->0) <> 'object'
     or p_content->0->>'releaseId' is distinct from p_release
     or p_content->0->>'tenantId' is distinct from p_tenant_id
     or v_size < 0
     or jsonb_typeof(p_content#>'{0,changes,proposals}') <> 'array'
     or jsonb_typeof(p_content#>'{0,changes,ready}') <> 'array'
     or jsonb_typeof(p_content#>'{0,changes,toDo}') <> 'array'
     or jsonb_typeof(p_content#>'{0,changes,research}') <> 'array'
     or jsonb_typeof(p_content#>'{0,today,today,nextOpportunities}') <> 'array' then
    raise exception 'publish_customer_release: release identity or lane is invalid';
  end if;
  if exists (select 1 from jsonb_array_elements(v_manifest) m
              where jsonb_typeof(m) <> 'object' or nullif(m->>'id', '') is null
                 or m->>'lane' not in ('ready', 'todo', 'research'))
     or (select count(distinct m->>'id') from jsonb_array_elements(v_manifest) m) <> v_size
     or (select count(distinct card->>'id') from jsonb_array_elements(p_content#>'{0,changes,proposals}') card)
        <> (select count(*) from jsonb_array_elements(p_content#>'{0,changes,proposals}'))
     or (select count(distinct id) from (
           select card->>'id' id from jsonb_array_elements(p_content#>'{0,changes,ready}') card
           union all select card->>'id' from jsonb_array_elements(p_content#>'{0,changes,toDo}') card
           union all select card->>'id' from jsonb_array_elements(p_content#>'{0,changes,research}') card
         ) lanes) <> (select count(*) from (
           select card->>'id' from jsonb_array_elements(p_content#>'{0,changes,ready}') card
           union all select card->>'id' from jsonb_array_elements(p_content#>'{0,changes,toDo}') card
           union all select card->>'id' from jsonb_array_elements(p_content#>'{0,changes,research}') card
         ) lane_rows)
     or exists (
       select 1 from jsonb_array_elements(p_content#>'{0,changes,proposals}') proposal
       where not exists (
         select 1 from (
           select card->>'id' id from jsonb_array_elements(p_content#>'{0,changes,ready}') card
           union all select card->>'id' from jsonb_array_elements(p_content#>'{0,changes,toDo}') card
           union all select card->>'id' from jsonb_array_elements(p_content#>'{0,changes,research}') card
         ) lanes where lanes.id = proposal->>'id'
       )
     ) then
    raise exception 'publish_customer_release: every global card must appear once in its matching lane';
  end if;
  select count(*) into v_rows from public.change_proposals c
   join jsonb_array_elements(v_manifest) m on m->>'id' = c.id
   where c.tenant_id = p_tenant_id and c.terminal_disposition is null
     and c.payload#>>'{proposal,id}' = c.id
     and c.payload#>>'{proposal,tenantId}' = p_tenant_id
     and c.payload#>>'{proposal,kind}' = 'existing_edit'
     and c.payload#>>'{proposal,changeFamily}' is distinct from 'full_rewrite'
     and c.payload#>>'{proposal,recommendedChange,kind}' is distinct from 'new_page'
     and c.payload#>>'{proposal,recommendedChange,target,mode}' is distinct from 'whole_body'
     and not jsonb_path_exists(coalesce(c.payload#>'{proposal,bundle,components}', '[]'::jsonb),
       '$[*] ? (@.kind == "full_rewrite" || @.kind == "new_page" || @.target.mode == "whole_body")');
  if v_rows <> v_size then
    raise exception 'publish_customer_release: every manifest id must name one current allowed proposal';
  end if;
  if exists (
    select 1 from (
      select card->>'id' id, 'ready' lane, card payload from jsonb_array_elements(p_content#>'{0,changes,ready}') card
      union all select card->>'id', 'todo', card from jsonb_array_elements(p_content#>'{0,changes,toDo}') card
      union all select card->>'id', 'research', card from jsonb_array_elements(p_content#>'{0,changes,research}') card
      union all select card->>'id', null, card from jsonb_array_elements(p_content#>'{0,changes,proposals}') card
      union all select card->>'changeId', 'ready', null from jsonb_array_elements(p_content#>'{0,today,today,nextOpportunities}') card
    ) card left join jsonb_array_elements(v_manifest) m on m->>'id' = card.id
    where nullif(card.id, '') is null or m->>'id' is null or card.lane is not null and m->>'lane' is distinct from card.lane
       or card.payload is not null and (card.payload->>'kind' is distinct from 'existing_edit'
         or card.payload->>'changeFamily' = 'full_rewrite'
         or card.payload#>>'{recommendedChange,kind}' = 'new_page'
         or card.payload#>>'{recommendedChange,target,mode}' = 'whole_body'
         or jsonb_path_exists(coalesce(card.payload#>'{bundle,components}', '[]'::jsonb),
           '$[*] ? (@.kind == "full_rewrite" || @.kind == "new_page" || @.target.mode == "whole_body")'))
  ) then
    raise exception 'publish_customer_release: release cards conflict with the manifest';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('customer-release:' || p_tenant_id, 0));
  select r.release_id into v_prior
    from public.customer_surface_releases r
   where r.scope_key = p_scope_key
   order by r.generation desc
   limit 1;
  if v_prior is distinct from p_expected_prior then
    raise exception 'release conflict: expected prior %, found %', p_expected_prior, v_prior;
  end if;

  update public.change_proposals set queue_lane = null, queue_rank = null
    where tenant_id = p_tenant_id and queue_lane is not null;
  update public.change_proposals c
     set queue_lane = p_release || '::' || t.lane, queue_rank = t.ord
    from (select m->>'id' id, m->>'lane' lane, ord
            from jsonb_array_elements(v_manifest) with ordinality as x(m, ord)) t
   where c.tenant_id = p_tenant_id and c.id = t.id
     and c.terminal_disposition is null;
  get diagnostics v_rows = row_count;
  if v_rows <> v_size then
    raise exception 'publish_customer_release: ranking changed before commit';
  end if;

  insert into public.customer_surface_releases
    (tenant_id, scope_key, release_id, content)
  values (p_tenant_id, p_scope_key, p_release, p_content);
  return p_release;
end;
$function$;

revoke all on function public.publish_customer_release(text, text, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.publish_customer_release(text, text, text, text, text, jsonb)
  to service_role;

-- Confirmation and soft invalidation change only the freshness clock of the
-- latest release. They cannot alter its cards, order, identity, or material.
-- This replaces the old generic blob overwrite used for those two operations.
create or replace function public.set_customer_surface_freshness(
  p_tenant_id text,
  p_expected_release text,
  p_computed_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare v_generation bigint; v_changed integer;
begin
  if nullif(p_tenant_id, '') is null or nullif(p_expected_release, '') is null
     or p_computed_at is null then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'customer-release:' || p_tenant_id, 0));
  select r.generation into v_generation
    from public.customer_surface_releases r
   where r.tenant_id = p_tenant_id
   order by r.generation desc
   limit 1;
  update public.customer_surface_releases r
     set content = jsonb_set(
       jsonb_set(r.content, '{0,computedAt}', to_jsonb(p_computed_at), false),
       '{0,today,surfaceComputedAt}', to_jsonb(p_computed_at), false
     )
   where r.generation = v_generation
     and r.tenant_id = p_tenant_id
     and r.release_id = p_expected_release;
  get diagnostics v_changed = row_count;
  return v_changed = 1;
end;
$function$;

revoke all on function public.set_customer_surface_freshness(text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.set_customer_surface_freshness(text, text, timestamptz)
  to service_role;

-- Fail migration replay if a default grant or function replacement reopens the
-- release ledger. RLS does not constrain service_role, so privileges are the
-- durable write boundary here.
do $assert_customer_surface_boundary$
declare v_role text;
begin
  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    if has_table_privilege(v_role, 'public.customer_surface_releases', 'INSERT')
       or has_table_privilege(v_role, 'public.customer_surface_releases', 'UPDATE')
       or has_table_privilege(v_role, 'public.customer_surface_releases', 'DELETE')
       or has_table_privilege(v_role, 'public.customer_surface_releases', 'TRUNCATE')
       or has_table_privilege(v_role, 'public.customer_surface_releases', 'REFERENCES')
       or has_table_privilege(v_role, 'public.customer_surface_releases', 'TRIGGER') then
      raise exception '% retains direct customer-surface mutation', v_role;
    end if;
  end loop;
  if not has_table_privilege('service_role', 'public.customer_surface_releases', 'SELECT') then
    raise exception 'customer-surface service-role read privilege is missing';
  end if;
  if has_function_privilege('anon',
       'public.publish_customer_release(text,text,text,text,text,jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated',
       'public.publish_customer_release(text,text,text,text,text,jsonb)', 'EXECUTE')
     or not has_function_privilege('service_role',
       'public.publish_customer_release(text,text,text,text,text,jsonb)', 'EXECUTE') then
    raise exception 'customer-surface publisher execute grants are unsafe';
  end if;
  if has_function_privilege('anon',
       'public.set_customer_surface_freshness(text,text,timestamptz)', 'EXECUTE')
     or has_function_privilege('authenticated',
       'public.set_customer_surface_freshness(text,text,timestamptz)', 'EXECUTE')
     or not has_function_privilege('service_role',
       'public.set_customer_surface_freshness(text,text,timestamptz)', 'EXECUTE') then
    raise exception 'customer-surface freshness execute grants are unsafe';
  end if;
  if not coalesce((
    select p.prosecdef
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'publish_customer_release' and p.pronargs = 6
  ), false) then
    raise exception 'customer-surface publisher is not SECURITY DEFINER';
  end if;
  if has_table_privilege('service_role', 'public.json_store_blobs', 'TRUNCATE') then
    raise exception 'service_role can truncate immutable legacy customer-surface history';
  end if;
end;
$assert_customer_surface_boundary$;
