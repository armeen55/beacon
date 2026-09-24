-- One manual press checks the exact selected proposal and writes its Shipment in
-- the same transaction. A changed or retired proposal cannot leave an orphan.
create function public.record_change_implementation(
  p_tenant_id text, p_proposal_id text, p_expected_row_version integer, p_expected_payload jsonb,
  p_shipment jsonb, p_complete boolean, p_prior_shipment_ids text[], p_component_ids text[]
) returns text language plpgsql security definer
set search_path = '' as $function$
declare
  v_row public.change_proposals%rowtype;
  v_existing public.shipped_change_proof%rowtype;
  v_saved text;
  v_work_key text;
  v_has_existing boolean;
  v_components jsonb;
  v_part jsonb;
  v_expected jsonb;
  v_index integer;
  v_covered integer[] := '{}';
  v_prior_id text;
  v_prior public.shipped_change_proof%rowtype;
  v_site text;
  v_page text;
  v_redirect text;
  v_anchor text;
  v_kind text;
begin
  if nullif(p_tenant_id, '') is null or nullif(p_proposal_id, '') is null
     or p_expected_row_version is null or p_expected_row_version < 1
     or p_expected_payload is null or p_shipment is null or p_complete is null or p_prior_shipment_ids is null or p_component_ids is null
     or coalesce(array_length(p_prior_shipment_ids, 1), 0) > 100
     or p_proposal_id not like p_tenant_id || '::%'
     or p_expected_payload#>>'{proposal,tenantId}' is distinct from p_tenant_id
     or p_expected_payload#>>'{proposal,id}' is distinct from p_proposal_id
     or p_shipment->>'tenant_id' is distinct from p_tenant_id
     or p_shipment->>'proposal_id' is distinct from p_proposal_id
     or nullif(p_shipment->>'id', '') is null
     or nullif(p_shipment->>'proposal_version', '') is null
     or nullif(p_shipment->>'implemented_at', '') is null
     or nullif(p_shipment->>'page', '') is null
     or nullif(p_shipment->>'path', '') is null then return 'blocked'; end if;

  select nullif(payload->>'workKey', '') into v_work_key from public.change_proposals
   where tenant_id = p_tenant_id and id = p_proposal_id;
  if v_work_key is not null then
    perform pg_advisory_xact_lock(hashtextextended('proposal-work:' || p_tenant_id || ':' || v_work_key, 0));
  end if;
  select * into v_row from public.change_proposals
   where tenant_id = p_tenant_id and id = p_proposal_id for update;
  if not found or v_row.proposal_version <> p_expected_row_version
     or v_row.terminal_disposition is not null
     or v_row.payload is distinct from p_expected_payload then return 'stale'; end if;
  v_site := nullif(v_row.site, '');
  if v_site is null then
    select domain into v_site from public.tenants where id::text = p_tenant_id;
  end if;
  if lower(regexp_replace(split_part(regexp_replace(p_shipment->>'page', '^https?://', ''), '/', 1), '^www[.]', ''))
     is distinct from lower(regexp_replace(v_site, '^www[.]', ''))
     or p_shipment->>'basis' is distinct from v_row.basis
     or p_shipment->>'action_type' is distinct from v_row.payload#>>'{proposal,changeFamily}'
     or (v_row.payload#>>'{proposal,kind}' = 'existing_edit'
         and p_shipment->>'path' is distinct from v_row.payload#>>'{proposal,pagePath}')
     then return 'blocked'; end if;
  v_components := v_row.payload#>'{proposal,bundle,components}';
  if jsonb_typeof(p_shipment->'components_applied') <> 'array'
     or jsonb_array_length(p_shipment->'components_applied') = 0 then return 'blocked'; end if;
  if jsonb_typeof(v_components) = 'array' and cardinality(p_component_ids) <> jsonb_array_length(v_components)
     or jsonb_typeof(v_components) <> 'array' and (cardinality(p_component_ids) <> 0
       or jsonb_array_length(p_shipment->'components_applied') <> 1 or not p_complete)
     then return 'blocked'; end if;
  for v_part in select value from jsonb_array_elements(p_shipment->'components_applied') loop
    if jsonb_typeof(v_components) = 'array' then
      if (v_part->>'id') !~ '^[0-9]+:[a-z_]+:[a-z0-9]+$' then return 'blocked'; end if;
      v_index := split_part(v_part->>'id', ':', 1)::integer;
      v_expected := v_components->v_index;
      v_page := coalesce(v_expected->>'page', case when v_row.payload#>>'{proposal,kind}' = 'new_page'
        then p_shipment->>'page' else coalesce(v_row.payload#>>'{proposal,pageUrl}', v_row.payload#>>'{proposal,pagePath}') end);
      v_redirect := coalesce(v_expected->>'redirectTo', case when v_expected->>'kind' in ('internal_link_add','internal_links','anchor_text')
        then v_row.payload#>>'{proposal,recommendedChange,linkTo}' end);
      v_anchor := coalesce(v_expected->>'anchorAfter', case when v_expected->>'kind' in ('internal_link_add','internal_links','anchor_text')
        then v_row.payload#>>'{proposal,recommendedChange,anchorText}' end);
      if v_expected is null or v_part->>'id' is distinct from p_component_ids[v_index + 1]
         or v_part->>'kind' is distinct from v_expected->>'kind'
         or v_part->>'after' is distinct from v_expected->>'after'
         or v_part->>'before' is distinct from v_expected->>'before'
         or v_part->>'where' is distinct from v_expected->>'where'
         or v_part->>'page' is distinct from v_page
         or v_part->>'redirectTo' is distinct from v_redirect
         or v_part->>'anchorAfter' is distinct from v_anchor
         or coalesce(v_part->'units', 'null'::jsonb) is distinct from coalesce(v_expected->'units', 'null'::jsonb)
         or coalesce(v_part->'target', 'null'::jsonb) is distinct from coalesce(v_expected->'target', 'null'::jsonb)
         then return 'blocked'; end if;
      v_covered := array_append(v_covered, v_index);
    elsif v_row.payload#>>'{proposal,kind}' = 'existing_edit' then
      v_kind := case when nullif(v_row.payload#>>'{proposal,recommendedChange,linkTo}', '') is not null then 'internal_link_add'
        when v_row.payload#>>'{proposal,recommendedChange,field}' = 'schema' and nullif(v_row.payload#>>'{proposal,recommendedChange,before}', '') is not null then 'schema_replace'
        when v_row.payload#>>'{proposal,recommendedChange,field}' = 'schema' then 'schema_add'
        else v_row.payload#>>'{proposal,changeFamily}' end;
      if v_part->>'id' is not null
         or v_part->>'kind' is distinct from v_kind
         or v_part->>'after' is distinct from v_row.payload#>>'{proposal,recommendedChange,after}'
         or v_part->>'before' is distinct from v_row.payload#>>'{proposal,recommendedChange,before}'
         or v_part->>'where' is distinct from v_row.payload#>>'{proposal,recommendedChange,where}'
         or v_part->>'page' is distinct from coalesce(v_row.payload#>>'{proposal,pageUrl}', v_row.payload#>>'{proposal,pagePath}')
         or v_part->>'redirectTo' is distinct from v_row.payload#>>'{proposal,recommendedChange,linkTo}'
         or v_part->>'anchorAfter' is distinct from (case when v_kind = 'internal_link_add'
              then v_row.payload#>>'{proposal,recommendedChange,anchorText}' end)
         or coalesce(v_part->'units', 'null'::jsonb) is distinct from coalesce(v_row.payload#>'{proposal,recommendedChange,units}', 'null'::jsonb)
         or coalesce(v_part->'target', 'null'::jsonb) is distinct from coalesce(v_row.payload#>'{proposal,recommendedChange,target}', 'null'::jsonb)
         then return 'blocked'; end if;
    else return 'blocked'; end if;
  end loop;

  select * into v_existing from public.shipped_change_proof
   where tenant_id = p_tenant_id and id = p_shipment->>'id';
  v_has_existing := found;
  if v_has_existing and (v_existing.proposal_id is distinct from p_proposal_id
     or v_existing.proposal_version is distinct from p_shipment->>'proposal_version'
     or v_existing.page is distinct from p_shipment->>'page'
     or v_existing.path is distinct from p_shipment->>'path'
     or v_existing.action_type is distinct from p_shipment->>'action_type'
     or v_existing.basis is distinct from p_shipment->>'basis'
     or v_existing.components_applied is distinct from p_shipment->'components_applied')
     then return 'blocked'; end if;
  if v_row.status = 'implemented_pending_verification' and v_has_existing then return 'already'; end if;
  if v_row.status <> 'ready' then return 'stale'; end if;

  -- Only the source-version-matched IDs supplied by the server may contribute earlier
  -- pieces. Re-read each durable row under the locked proposal and reject a missing,
  -- foreign, or different-copy component before considering the bundle complete.
  for v_prior_id in select distinct unnest(p_prior_shipment_ids) loop
    select * into v_prior from public.shipped_change_proof
     where tenant_id = p_tenant_id and id = v_prior_id and proposal_id = p_proposal_id;
    if not found or v_prior.basis is distinct from v_row.basis
       or v_prior.page is distinct from p_shipment->>'page'
       or v_prior.path is distinct from p_shipment->>'path'
       or v_prior.action_type is distinct from p_shipment->>'action_type'
       or jsonb_typeof(v_prior.components_applied) <> 'array' then return 'blocked'; end if;
    for v_part in select value from jsonb_array_elements(v_prior.components_applied) loop
      if jsonb_typeof(v_components) <> 'array'
         or (v_part->>'id') !~ '^[0-9]+:[a-z_]+:[a-z0-9]+$' then return 'blocked'; end if;
      v_index := split_part(v_part->>'id', ':', 1)::integer;
      v_expected := v_components->v_index;
      v_page := coalesce(v_expected->>'page', coalesce(v_row.payload#>>'{proposal,pageUrl}', v_row.payload#>>'{proposal,pagePath}'));
      v_redirect := coalesce(v_expected->>'redirectTo', case when v_expected->>'kind' in ('internal_link_add','internal_links','anchor_text')
        then v_row.payload#>>'{proposal,recommendedChange,linkTo}' end);
      v_anchor := coalesce(v_expected->>'anchorAfter', case when v_expected->>'kind' in ('internal_link_add','internal_links','anchor_text')
        then v_row.payload#>>'{proposal,recommendedChange,anchorText}' end);
      if v_expected is null or v_part->>'id' is distinct from p_component_ids[v_index + 1]
         or v_part->>'kind' is distinct from v_expected->>'kind'
         or v_part->>'after' is distinct from v_expected->>'after'
         or v_part->>'before' is distinct from v_expected->>'before'
         or v_part->>'where' is distinct from v_expected->>'where'
         or v_part->>'page' is distinct from v_page
         or v_part->>'redirectTo' is distinct from v_redirect
         or v_part->>'anchorAfter' is distinct from v_anchor
         or coalesce(v_part->'units', 'null'::jsonb) is distinct from coalesce(v_expected->'units', 'null'::jsonb)
         or coalesce(v_part->'target', 'null'::jsonb) is distinct from coalesce(v_expected->'target', 'null'::jsonb)
         then return 'blocked'; end if;
      v_covered := array_append(v_covered, v_index);
    end loop;
  end loop;
  if p_complete and jsonb_typeof(v_components) = 'array' and exists (
    select 1 from generate_series(0, jsonb_array_length(v_components) - 1) as i
     where not i = any(v_covered)) then return 'blocked'; end if;
  if v_row.payload#>>'{proposal,kind}' = 'new_page' and not p_complete then return 'blocked'; end if;

  if not v_has_existing then
    insert into public.shipped_change_proof
      select s.* from jsonb_populate_record(null::public.shipped_change_proof, p_shipment) s
      on conflict do nothing returning id into v_saved;
    if v_saved is null then
      select * into v_existing from public.shipped_change_proof
       where tenant_id = p_tenant_id and id = p_shipment->>'id';
      if not found or v_existing.proposal_id is distinct from p_proposal_id
         or v_existing.proposal_version is distinct from p_shipment->>'proposal_version'
         or v_existing.page is distinct from p_shipment->>'page'
         or v_existing.path is distinct from p_shipment->>'path'
         or v_existing.action_type is distinct from p_shipment->>'action_type'
         or v_existing.basis is distinct from p_shipment->>'basis'
         or v_existing.components_applied is distinct from p_shipment->'components_applied'
         then return 'blocked'; end if;
      v_has_existing := true;
    end if;
  end if;

  if p_complete then
    v_work_key := nullif(v_row.payload->>'workKey', '');
    update public.change_proposals
       set status = 'implemented_pending_verification',
           payload = jsonb_set(v_row.payload, '{proposal,status}', '"implemented_pending_verification"'::jsonb),
           terminal_disposition = null, superseded_by = null,
           withdrawn_reason = null, updated_at = now()
     where tenant_id = p_tenant_id and id = p_proposal_id
       and proposal_version = v_row.proposal_version and status = 'ready'
       and terminal_disposition is null and payload = v_row.payload
    returning id into v_saved;
    if v_saved is null then raise exception 'proposal changed during atomic implementation'; end if;
    if v_work_key is not null then
      insert into public.proposal_work_tombstones (tenant_id, work_key, proposal_id, disposition, retired_at)
      values (p_tenant_id, v_work_key, p_proposal_id, 'settled', now()) on conflict do nothing;
    end if;
  end if;
  return case when v_has_existing then 'already' else 'inserted' end;
end;
$function$;

revoke all on function public.record_change_implementation(text,text,integer,jsonb,jsonb,boolean,text[],text[]) from public, anon, authenticated;
grant execute on function public.record_change_implementation(text,text,integer,jsonb,jsonb,boolean,text[],text[]) to service_role;
