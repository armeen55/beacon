-- A material change cannot keep the rank of an older proposal generation. The
-- release writer changes only queue_lane/queue_rank, so its atomic stamp survives.
create or replace function public.clear_changed_proposal_stamp()
returns trigger language plpgsql set search_path = pg_catalog, public as $function$
begin
  if old.payload is distinct from new.payload or old.status is distinct from new.status
     or old.basis is distinct from new.basis or old.terminal_disposition is distinct from new.terminal_disposition
     or old.proposal_version is distinct from new.proposal_version then
    new.queue_lane := null; new.queue_rank := null;
  end if;
  return new;
end;
$function$;
revoke all on function public.clear_changed_proposal_stamp() from public, anon, authenticated, service_role;
drop trigger if exists trg_clear_changed_proposal_stamp on public.change_proposals;
create trigger trg_clear_changed_proposal_stamp before update on public.change_proposals
for each row execute function public.clear_changed_proposal_stamp();

-- A page may enter the one ranked release only after the public copy matches its
-- private section bank. This is a database backstop; Decision still validates
-- source support and editorial acceptance before assigning a Ready lane.
create or replace function public.customer_release_new_page_complete(p jsonb)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public
as $function$
declare components jsonb; outline jsonb; pieces jsonb; section_count integer; i integer;
begin
  if p is null or p->>'kind' is distinct from 'new_page' or p->>'changeFamily' is distinct from 'new_page'
     or p#>>'{recommendedChange,kind}' is distinct from 'new_page'
     or p->>'researchOnly' is distinct from 'false'
     or (p->>'status' is distinct from 'ready' and p->>'status' is distinct from 'needs_review')
     or p#>>'{newPageDraft,brief,kind}' is distinct from 'new_page'
     or p#>>'{informationGain,pageWhole}' is distinct from 'true'
     or nullif(p#>>'{newPageDraft,brief,identity}', '') is null
     or nullif(p#>>'{newPageDraft,brief,material}', '') is null
     or (p->>'status' = 'ready' and (
       p#>>'{semanticReview,scope}' is distinct from 'whole_page'
       or p#>>'{semanticReview,version}' is distinct from '7'
       or nullif(p#>>'{semanticReview,of}', '') is null
       or p#>>'{semanticReview,editor,pageFit}' is distinct from 'true'
       or p#>>'{semanticReview,editor,placementCorrect}' is distinct from 'true'
       or p#>>'{semanticReview,editor,resolvesDiagnosis}' is distinct from 'true'
       or p#>>'{semanticReview,editor,implementableNow}' is distinct from 'true'
       or p#>>'{semanticReview,editor,improvesPage}' is distinct from 'true'
       or p#>>'{semanticReview,editor,wouldHandToCustomer}' is distinct from 'true'
       or p#>>'{semanticReview,editor,contested}' = 'true'))
     or jsonb_typeof(p#>'{recommendedChange,outline}') <> 'array'
     or jsonb_typeof(p#>'{newPageDraft,brief,sections}') is distinct from 'array'
     or jsonb_typeof(p#>'{bundle,components}') <> 'array'
     or jsonb_typeof(p#>'{newPageDraft,pieces}') <> 'array'
     or jsonb_typeof(p->'claims') <> 'array'
     or jsonb_typeof(p->'supportFacts') <> 'array' then return false; end if;
  components := p#>'{bundle,components}'; outline := p#>'{recommendedChange,outline}'; pieces := p#>'{newPageDraft,pieces}';
  section_count := jsonb_array_length(outline);
  if section_count < 1 or jsonb_array_length(components) <> section_count + 4
     or jsonb_array_length(p#>'{newPageDraft,brief,sections}') <> section_count
     or jsonb_array_length(pieces) <> section_count + 1
     or jsonb_array_length(p->'claims') = 0 or jsonb_array_length(p->'supportFacts') = 0
     or coalesce(jsonb_array_length(p#>'{recommendedChange,faqQuestions}'), 0) <> 0
     or coalesce(jsonb_array_length(p#>'{newPageDraft,brief,internalLinks}'), 0) <> 0
     or components#>>'{0,kind}' is distinct from 'title'
     or nullif(trim(components#>>'{0,after}'), '') is null
     or components#>>'{0,after}' is distinct from p#>>'{recommendedChange,proposedTitle}'
     or components#>>'{1,kind}' is distinct from 'meta'
     or nullif(trim(components#>>'{1,after}'), '') is null
     or components#>>'{1,after}' is distinct from p#>>'{recommendedChange,metaDescription}'
     or components#>>'{2,kind}' is distinct from 'h1'
     or nullif(trim(components#>>'{2,after}'), '') is null
     or components#>>'{2,after}' is distinct from p#>>'{newPageDraft,brief,pageHeading}'
     or components#>>'{3,kind}' is distinct from 'opening_answer'
     or nullif(trim(components#>>'{3,after}'), '') is null
     or components#>>'{3,after}' is distinct from p#>>'{recommendedChange,openingAnswer}'
     or exists (select 1 from jsonb_array_elements(components) c
                 where c->>'kind' in ('new_page', 'full_rewrite') or c#>>'{target,mode}' = 'whole_body')
     then return false; end if;
  for i in 0..section_count - 1 loop
    if nullif(trim(outline->>i), '') is null
       or p#>>array['newPageDraft', 'brief', 'sections', i::text, 'heading'] is distinct from outline->>i
       or components#>>array[(i + 4)::text, 'kind'] is distinct from 'section'
       or components#>>array[(i + 4)::text, 'label'] is distinct from outline->>i
       or nullif(trim(components#>>array[(i + 4)::text, 'after']), '') is null
       or not exists (select 1 from jsonb_array_elements(pieces) piece
                      where piece->>'slot' = (i + 1)::text
                        and piece->>'heading' = outline->>i
                        and nullif(trim(piece->>'after'), '') is not null
                        and components#>>array[(i + 4)::text, 'after'] in
                          (piece->>'after', (outline->>i) || E'\n\n' || (piece->>'after'), '## ' || (outline->>i) || E'\n\n' || (piece->>'after')))
       then return false; end if;
  end loop;
  return exists (select 1 from jsonb_array_elements(pieces) piece
                 where piece->>'slot' = '0' and nullif(trim(piece->>'after'), '') is not null
                   and piece->>'after' = components#>>'{3,after}');
end;
$function$;

revoke all on function public.customer_release_new_page_complete(jsonb) from public, anon, authenticated;
grant execute on function public.customer_release_new_page_complete(jsonb) to service_role;

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
  perform pg_advisory_xact_lock(hashtextextended('customer-release:' || p_tenant_id, 0));
  -- Producers lock proposal rows on save. Hold the exact ranked rows through
  -- validation and stamping so a later draft cannot replace displayed copy.
  perform c.id from public.change_proposals c
    join jsonb_array_elements(v_manifest) m on m->>'id' = c.id
   where c.tenant_id = p_tenant_id order by c.id for update of c;
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
     and ((c.payload#>>'{proposal,kind}' = 'existing_edit'
       and c.payload#>>'{proposal,changeFamily}' is distinct from 'full_rewrite'
       and c.payload#>>'{proposal,recommendedChange,kind}' is distinct from 'new_page'
       and c.payload#>>'{proposal,recommendedChange,target,mode}' is distinct from 'whole_body'
       and not jsonb_path_exists(coalesce(c.payload#>'{proposal,bundle,components}', '[]'::jsonb),
         '$[*] ? (@.kind == "full_rewrite" || @.kind == "new_page" || @.target.mode == "whole_body")'))
       or public.customer_release_new_page_complete(c.payload->'proposal'));
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
       or card.payload is not null and not (
         (card.payload->>'kind' = 'existing_edit'
           and card.payload->>'changeFamily' is distinct from 'full_rewrite'
           and card.payload#>>'{recommendedChange,kind}' is distinct from 'new_page'
           and card.payload#>>'{recommendedChange,target,mode}' is distinct from 'whole_body'
           and not jsonb_path_exists(coalesce(card.payload#>'{bundle,components}', '[]'::jsonb),
             '$[*] ? (@.kind == "full_rewrite" || @.kind == "new_page" || @.target.mode == "whole_body")'))
         or public.customer_release_new_page_complete(card.payload))
  ) then
    raise exception 'publish_customer_release: release cards conflict with the manifest';
  end if;
  if exists (
    select 1 from (
      select card from jsonb_array_elements(p_content#>'{0,changes,ready}') card
      union all select card from jsonb_array_elements(p_content#>'{0,changes,toDo}') card
      union all select card from jsonb_array_elements(p_content#>'{0,changes,research}') card
      union all select card from jsonb_array_elements(p_content#>'{0,changes,proposals}') card
    ) shown join public.change_proposals c
      on c.tenant_id = p_tenant_id and c.id = shown.card->>'id'
    where c.payload#>'{proposal,recommendedChange}' is distinct from shown.card->'recommendedChange'
       or c.payload#>'{proposal,bundle,components}' is distinct from shown.card#>'{bundle,components}'
       or c.payload#>'{proposal,supportFacts}' is distinct from shown.card->'supportFacts'
       or c.payload#>'{proposal,claims}' is distinct from shown.card->'claims'
       or c.payload#>>'{proposal,basis}' is distinct from shown.card->>'basis'
       or c.payload#>>'{proposal,status}' is distinct from shown.card->>'status'
  ) then
    raise exception 'publish_customer_release: displayed proposal changed before publication';
  end if;

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

-- The old eight-argument writer has no application caller and targets the
-- guarded legacy blob. Remove its service-role execution path without dropping
-- the historical function or any stored release.
do $revoke_legacy_customer_publisher$
begin
  if to_regprocedure('public.publish_customer_release(text,text,text,text[],text[],text,text,jsonb)') is not null then
    revoke all on function public.publish_customer_release(text,text,text,text[],text[],text,text,jsonb)
      from public, anon, authenticated, service_role;
  end if;
end;
$revoke_legacy_customer_publisher$;

do $assert_release_writer_grants$
begin
  if has_function_privilege('anon', 'public.publish_customer_release(text,text,text,text,text,jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.publish_customer_release(text,text,text,text,text,jsonb)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.publish_customer_release(text,text,text,text,text,jsonb)', 'EXECUTE')
     or has_function_privilege('anon', 'public.customer_release_new_page_complete(jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.customer_release_new_page_complete(jsonb)', 'EXECUTE')
     or to_regprocedure('public.publish_customer_release(text,text,text,text[],text[],text,text,jsonb)') is not null
        and has_function_privilege('service_role', 'public.publish_customer_release(text,text,text,text[],text[],text,text,jsonb)', 'EXECUTE') then
    raise exception 'customer release writer grants are unsafe';
  end if;
end;
$assert_release_writer_grants$;
