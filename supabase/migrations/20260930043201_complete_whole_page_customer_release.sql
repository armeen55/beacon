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
declare v_prior text; v_slug text; v_rows integer; v_size integer; v_manifest jsonb; v_proposal jsonb; v_parts jsonb; v_bank jsonb; v_n integer; v_i integer; v_piece jsonb; v_units jsonb; v_heading text;
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
     or jsonb_typeof(p_content) is distinct from 'array' or jsonb_array_length(p_content) <> 1
     or jsonb_typeof(p_content->0) is distinct from 'object'
     or p_content->0->>'releaseId' is distinct from p_release
     or p_content->0->>'tenantId' is distinct from p_tenant_id
     or v_size < 0
     or jsonb_typeof(p_content#>'{0,changes,proposals}') is distinct from 'array'
     or jsonb_typeof(p_content#>'{0,changes,ready}') is distinct from 'array'
     or jsonb_typeof(p_content#>'{0,changes,toDo}') is distinct from 'array'
     or jsonb_typeof(p_content#>'{0,changes,research}') is distinct from 'array'
     or jsonb_typeof(p_content#>'{0,today,today,nextOpportunities}') is distinct from 'array' then
    raise exception 'publish_customer_release: release identity or lane is invalid';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('customer-release:' || p_tenant_id, 0));
  -- Producers lock proposal rows on save. Hold the exact ranked rows through
  -- validation and stamping so a later draft cannot replace displayed copy.
  perform c.id from public.change_proposals c
    join jsonb_array_elements(v_manifest) m on m->>'id' = c.id
   where c.tenant_id = p_tenant_id order by c.id for update of c;
  if exists (select 1 from jsonb_array_elements(v_manifest) m
              where jsonb_typeof(m) is distinct from 'object' or nullif(m->>'id', '') is null
                 or coalesce(m->>'lane', '') not in ('ready', 'todo', 'research'))
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
  -- Whole-page work is admitted through the same exact-source release. Incomplete
  -- banks remain private; Decision owns current capture and preservation review.
  for v_proposal in
    select c.payload->'proposal' from public.change_proposals c
      join jsonb_array_elements(v_manifest) m on m->>'id' = c.id
     where c.tenant_id = p_tenant_id and (
       c.payload#>>'{proposal,changeFamily}' = 'full_rewrite'
       or c.payload#>>'{proposal,recommendedChange,target,mode}' = 'whole_body'
       or jsonb_path_exists(coalesce(c.payload#>'{proposal,bundle,components}', '[]'::jsonb),
         '$[*] ? (@.kind == "full_rewrite" || @.target.mode == "whole_body")'))
  loop
    v_parts := v_proposal#>'{bundle,components}';
    v_bank := nullif(v_proposal->'newPageDraft', 'null'::jsonb);
    if v_proposal->>'kind' is distinct from 'existing_edit'
       or v_proposal#>>'{recommendedChange,kind}' is distinct from 'existing_edit'
       or (v_proposal ? 'researchOnly' and v_proposal->'researchOnly' is distinct from 'false'::jsonb)
       or (v_proposal->>'status' is distinct from 'ready' and v_proposal->>'status' is distinct from 'needs_review')
       or coalesce(v_proposal#>>'{recommendedChange,field}', '') not in ('section', 'answer_block')
       or (v_bank is not null and (v_bank#>>'{brief,kind}' is distinct from 'full_rewrite'
       or coalesce(v_bank#>>'{brief,identity}', '') !~ '^[a-f0-9]{64}$'
       or jsonb_typeof(v_bank#>'{brief,headings}') is distinct from 'array'
       or jsonb_typeof(v_bank#>'{brief,owed}') is distinct from 'array'
       or jsonb_typeof(v_bank->'pieces') is distinct from 'array'))
       or jsonb_typeof(v_parts) is distinct from 'array' then
      raise exception 'publish_customer_release: whole-page bank is incomplete';
    end if;
    v_n := case when v_bank is null then -1 else jsonb_array_length(v_bank#>'{brief,headings}') end;
    if (v_bank is not null and (v_n < 1 or jsonb_array_length(v_bank#>'{brief,owed}') <> 0
       or jsonb_array_length(v_bank->'pieces') <> v_n + 1))
       or (select count(*) from jsonb_array_elements(v_parts) c where c->>'kind' = 'full_rewrite') <> 1
       or exists (select 1 from jsonb_array_elements(v_parts) c
          where (c->>'kind' = 'full_rewrite' or c#>>'{target,mode}' = 'whole_body') and (
            c->>'kind' is distinct from 'full_rewrite' or c#>>'{target,mode}' is distinct from 'whole_body'
            or nullif(trim(c->>'before'), '') is null or nullif(trim(c->>'after'), '') is null
            or case when jsonb_typeof(c->'units') = 'array' then jsonb_array_length(c->'units') = 0 else true end
            or c->>'before' is distinct from v_proposal#>>'{recommendedChange,before}'
            or c->>'after' is distinct from v_proposal#>>'{recommendedChange,after}'
            or c->'units' is distinct from v_proposal#>'{recommendedChange,units}'
            or c->'target' is distinct from v_proposal#>'{recommendedChange,target}'))
       or (v_proposal->>'status' = 'ready' and (
         case when jsonb_typeof(v_proposal->'reviewedCaptures') = 'array' then jsonb_array_length(v_proposal->'reviewedCaptures') = 0 else true end
         or v_proposal#>>'{semanticReview,scope}' is distinct from 'whole_page'
         or v_proposal#>>'{semanticReview,version}' is distinct from '7'
         or nullif(v_proposal#>>'{semanticReview,of}', '') is null
         or not coalesce(v_proposal#>'{semanticReview,editor}' @>
           '{"pageFit":true,"placementCorrect":true,"resolvesDiagnosis":true,"implementableNow":true,"improvesPage":true,"wouldHandToCustomer":true}'::jsonb, false)
         or v_proposal#>>'{semanticReview,editor,contested}' = 'true')) then
      raise exception 'publish_customer_release: whole-page copy or review is incomplete';
    end if;
    if v_bank is not null then
    v_units := '[]'::jsonb;
    for v_i in 0..v_n loop
      if (select count(*) from jsonb_array_elements(v_bank->'pieces') piece
          where piece->>'slot' = v_i::text
            and nullif(trim(piece->>'after'), '') is not null
            and case when jsonb_typeof(piece->'units') = 'array' then jsonb_array_length(piece->'units') > 0 else false end
            and jsonb_typeof(piece->'assignment') = 'object'
            and ((v_i = 0 and piece->>'heading' is null)
              or (v_i > 0 and nullif(trim(v_bank#>>array['brief','headings',(v_i-1)::text]), '') is not null
                and nullif(trim(piece->>'heading'), '') is not null))) <> 1 then
        raise exception 'publish_customer_release: whole-page planned piece is incomplete';
      end if;
      select piece into v_piece from jsonb_array_elements(v_bank->'pieces') piece where piece->>'slot' = v_i::text;
      v_heading := v_piece->>'heading';
      if v_i > 0 then
        if v_piece#>>'{units,0,kind}' = 'heading'
           and lower(regexp_replace(trim(translate(v_piece#>>'{units,0,text}', '“”’ ', '""'' ')), '\s+', ' ', 'g')) = lower(regexp_replace(trim(translate(v_heading, '“”’ ', '""'' ')), '\s+', ' ', 'g')) then
          v_units := v_units || jsonb_set(v_piece->'units', '{0,level}', '2'::jsonb);
        else
          v_units := v_units || jsonb_build_array(jsonb_build_object('kind', 'heading', 'level', 2, 'text', v_heading)) || (v_piece->'units');
        end if;
      else v_units := v_units || (v_piece->'units'); end if;
    end loop;
    if v_units is distinct from v_proposal#>'{recommendedChange,units}' then
      raise exception 'publish_customer_release: whole-page copy differs from its ordered piece bank';
    end if;
    end if;
  end loop;
  select count(*) into v_rows from public.change_proposals c
   join jsonb_array_elements(v_manifest) m on m->>'id' = c.id
   where c.tenant_id = p_tenant_id and c.terminal_disposition is null
     and c.payload#>>'{proposal,id}' = c.id
     and c.payload#>>'{proposal,tenantId}' = p_tenant_id
     and ((c.payload#>>'{proposal,kind}' = 'existing_edit'
       and c.payload#>>'{proposal,recommendedChange,kind}' is distinct from 'new_page'
       and not jsonb_path_exists(coalesce(c.payload#>'{proposal,bundle,components}', '[]'::jsonb),
         '$[*] ? (@.kind == "new_page")'))
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
           and card.payload#>>'{recommendedChange,kind}' is distinct from 'new_page'
           and not jsonb_path_exists(coalesce(card.payload#>'{bundle,components}', '[]'::jsonb),
             '$[*] ? (@.kind == "new_page")'))
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
