-- Byte-preserving lexical counterpart of scalarControlMaterial; no parser serialization or unknown-field projection.
create function public.scalar_control_material(html text) returns text
language plpgsql immutable strict set search_path = pg_catalog, public as $projection$
declare
  rest text := html; projected text := ''; at integer; marker_depth integer := 0; token text; tag text[]; closing text[];
  stack text[] := array[]::text[]; names text[]; a text[]; pair text[]; w jsonb; b jsonb;
begin
  loop
    at := strpos(rest, '<');
    if at = 0 then exit; end if;
    projected := projected || left(rest, at - 1); rest := substring(rest from at);
    token := substring(rest from '^<(?:[^"<>]|"[^"]*")*>');
    if token is null then return null; end if;
    closing := regexp_match(token, '^</([a-z][a-z0-9:-]*)>$');
    if token in ('<!--$-->', '<!--/$-->') then
      marker_depth := marker_depth + case when token = '<!--$-->' then 1 else -1 end;
      if marker_depth < 0 then return null; end if;
    elsif closing is not null then
      if cardinality(stack) = 0 or stack[cardinality(stack)] <> closing[1] then return null; end if;
      stack := stack[1:cardinality(stack)-1];
    else
      tag := regexp_match(token, '^<([a-z][a-z0-9:-]*)((?: [a-z][a-z0-9:-]*="[^"]*")*)>$');
      if tag is null or tag[1] ~ '^(script|style|noscript|textarea|title|xmp|iframe|plaintext|template|svg|form)$' then return null; end if;
      names := array[]::text[];
      token := '<' || tag[1];
      for a in select regexp_matches(tag[2], '( ([a-z][a-z0-9:-]*)="([^"]*)")', 'g') loop
        if a[2] = any(names) then return null; end if;
        names := array_append(names, a[2]);
        if a[2] not in ('data-testid','data-motion-part') then token := token || a[1]; end if;
      end loop;
      token := token || '>';
      if tag[1] <> all(array['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']) then stack := array_append(stack, tag[1]); end if;
    end if;
    projected := projected || token;
    rest := substring(rest from length(substring(rest from '^<(?:[^"<>]|"[^"]*")*>')) + 1);
  end loop;
  if cardinality(stack) <> 0 or marker_depth <> 0 then return null; end if;
  projected := projected || rest;
  for pair in select regexp_matches(projected, '(<div([^<>]*)><button([^<>]*)><span([^<>]*)>([^<>]+)</span></button></div>)', 'g') loop
    select coalesce(jsonb_object_agg(x[1], x[2]), '{}'::jsonb) into w from regexp_matches(pair[2], ' ([a-z][a-z0-9:-]*)="([^"]*)"', 'g') x;
    select coalesce(jsonb_object_agg(x[1], x[2]), '{}'::jsonb) into b from regexp_matches(pair[3], ' ([a-z][a-z0-9:-]*)="([^"]*)"', 'g') x;
    if pair[5] <> 'Next' or b->>'aria-label' is distinct from pair[5]
       or pair[2] || pair[3] || pair[4] ~ ' (on[a-z0-9:-]*|href|form|formaction|contenteditable|role)="'
       or b ? 'type' and b->>'type' <> 'button' then continue; end if;
    if w ? 'tabindex' and w->>'tabindex' <> '-1' or pair[3] || pair[4] ~ ' tabindex="'
       or w ? 'aria-disabled' and w->>'aria-disabled' not in ('true','false')
       or b ? 'aria-disabled' and b->>'aria-disabled' not in ('true','false')
       or b ? 'disabled' and b->>'disabled' <> '' then continue; end if;
    projected := replace(projected, pair[1], '<div' || regexp_replace(pair[2], ' (tabindex|aria-disabled)="[^"<>]*"', '', 'g') || '><button' || regexp_replace(pair[3], ' (disabled|aria-disabled)="[^"<>]*"', '', 'g') || '><span' || pair[4] || '>' || pair[5] || '</span></button></div>');
  end loop;
  return projected;
end;
$projection$;
revoke all on function public.scalar_control_material(text) from public, anon, authenticated, service_role;

-- Reuse the original reviewed capture only when its complete material survives in the latest qualified capture.
-- Stored capture history and review fingerprints stay unchanged; all Ready doors use the same locked guard.
CREATE OR REPLACE FUNCTION public.guard_ready_page_captures()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET lock_timeout TO '2s'
AS $function$
declare
  p jsonb := new.payload->'proposal'; refs jsonb := coalesce(p->'reviewedCaptures','[]'::jsonb);
  required text[] := array[]::text[]; raw text; owner text := public.reviewed_capture_address(p->>'pageUrl'); c jsonb; bound jsonb;
  captured public.page_snapshots%rowtype; inspected public.page_snapshots%rowtype; inspected_at timestamptz := clock_timestamp();
  scalar boolean := false; scalar_field text; prior jsonb; old_material jsonb; current_material jsonb; old_capture jsonb; current_capture jsonb;
begin
  if new.status <> 'ready' or new.terminal_disposition is not null then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'ready' and old.terminal_disposition is null
     and new.tenant_id = old.tenant_id and new.id = old.id and new.page_key = old.page_key
     and new.case_id = old.case_id and new.mutation_key = old.mutation_key
     and new.basis is not distinct from old.basis and new.proposal_version = old.proposal_version
     and (new.payload #- '{proposal,rankingReceipt}') is not distinct from (old.payload #- '{proposal,rankingReceipt}') then return new; end if;
  if jsonb_typeof(p) is distinct from 'object' or p->>'tenantId' is distinct from new.tenant_id
     or p->>'id' is distinct from new.id or p->>'status' is distinct from 'ready' then
    raise exception using errcode = '23514', message = 'page_changed';
  end if;
  if p #>> '{recommendedChange,kind}' = 'existing_edit' then
    required := array_append(required, owner);
    raw := nullif(p #>> '{recommendedChange,linkTo}', '');
    if raw is not null then required := array_append(required, case when raw like '/%' then substring(owner from '^https?://[^/]+') || raw else raw end); end if;
  end if;
  for c in select value from jsonb_array_elements(coalesce(p #> '{bundle,components}', '[]'::jsonb)) loop
    if c->>'kind' in ('title','meta','h1','opening_answer','section','section_add','section_rewrite','full_rewrite','restructure','table_or_list_add','paragraph_correction','factual_correction','entity_expansion','source_update','internal_link_add','internal_links','schema')
       and p #>> '{recommendedChange,kind}' <> 'new_page' then
      raw := coalesce(nullif(c->>'page',''), owner);
      required := array_append(required, case when raw like '/%' then substring(owner from '^https?://[^/]+') || raw else raw end);
    end if;
    if c->>'kind' in ('internal_link_add','internal_links') then
      raw := coalesce(nullif(c->>'redirectTo',''), substring(c->>'after' from '\]\((https?://[^)]+|/[^)]+)\)'));
      if raw is null then raise exception using errcode = '23514', message = 'page_changed'; end if;
      required := array_append(required, case when raw like '/%' then substring(owner from '^https?://[^/]+') || raw else raw end);
    end if;
  end loop;
  if jsonb_typeof(refs) is distinct from 'array' or exists (select 1 from unnest(required) u where public.reviewed_capture_address(u) is null)
     or exists (select 1 from jsonb_array_elements(refs) r where r->>'tenantId' is distinct from new.tenant_id
       or public.reviewed_capture_address(r->>'url') is null or nullif(r->>'pageId','') is null
       or nullif(r->>'captureId','') is null or r->>'captureId' is distinct from r->>'latestCaptureId'
       or jsonb_typeof(r->'captureVersion') is distinct from 'number' or (r->>'captureVersion') !~ '^[1-9][0-9]*$')
     or (select count(*) from jsonb_array_elements(refs)) <> (select count(distinct public.reviewed_capture_address(r->>'url')) from jsonb_array_elements(refs) r)
     or exists (select 1 from unnest(required) u where not exists (select 1 from jsonb_array_elements(refs) r where public.reviewed_capture_address(r->>'url') = public.reviewed_capture_address(u))) then
    raise exception using errcode = '23514', message = 'page_changed';
  end if;
  -- Only an unchanged already-accepted scalar owner may retain its original reviewed frame through control drift.
  if tg_op = 'UPDATE' then
    prior := old.payload->'proposal';
    scalar := old.status = 'ready' and old.terminal_disposition is null and old.tenant_id = new.tenant_id
      and old.id = new.id and old.basis is not distinct from new.basis
      and (prior - array['rankingReceipt','faults','limitations','obligation']) = (p - array['rankingReceipt','faults','limitations','obligation'])
      and p#>>'{recommendedChange,kind}' = 'existing_edit' and p#>>'{recommendedChange,field}' in ('meta','title')
      and p->>'researchOnly' is distinct from 'true' and p->>'redraftRequested' is distinct from 'true'
      and coalesce(p->'bundle','null'::jsonb) = 'null'::jsonb and coalesce(p->'newPageDraft','null'::jsonb) = 'null'::jsonb
      and p#>>'{semanticReview,version}' = '7' and nullif(p#>>'{semanticReview,of}','') is not null
      and p#>>'{semanticReview,editor,contested}' is distinct from 'true'
      and p#>'{semanticReview,editor}' @> '{"pageFit":true,"placementCorrect":true,"resolvesDiagnosis":true,"implementableNow":true,"improvesPage":true,"wouldHandToCustomer":true}'::jsonb;
    scalar_field := case when p#>>'{recommendedChange,field}' = 'title' then 'title' else 'meta_description' end;
  end if;
  -- Includes newer INSERTs as well as same-row material changes; no writer can change selection during admission.
  if jsonb_array_length(refs) > 0 then lock table public.page_snapshots in share mode; end if;
  for bound in select value from jsonb_array_elements(refs) order by public.reviewed_capture_address(value->>'url') loop
    select ps.* into inspected from public.page_snapshots ps
      where ps.tenant_id = new.tenant_id and ps.id::text = bound->>'captureId'
        and ps.page_id::text = bound->>'pageId'
        and public.reviewed_capture_address(ps.url) = public.reviewed_capture_address(bound->>'url');
    if not found or inspected.capture_version::text is distinct from bound->>'captureVersion' then
      raise exception using errcode = '23514', message = 'page_changed';
    end if;
    select ps.* into captured from public.page_snapshots ps
      where ps.tenant_id = new.tenant_id and public.reviewed_capture_address(ps.url) = public.reviewed_capture_address(bound->>'url')
      order by ps.fetched_at desc, ps.id desc limit 1;
    if not found or captured.page_id::text is distinct from bound->>'pageId'
       or (captured.content_capture->>'complete' = 'true' and nullif(btrim(captured.content_capture->>'mainHtml'), '') is not null
         and captured.content_capture->>'version' = '1'
         and captured.fetched_at >= inspected_at - interval '7 days' and captured.fetched_at <= inspected_at
         and public.reviewed_capture_address(captured.url) = public.reviewed_capture_address(captured.final_url)) is not true then
      raise exception using errcode = '23514', message = 'page_changed';
    end if;
    if captured.capture_version = (bound->>'captureVersion')::numeric
       and nullif(captured.content_capture->>'sourceRevision','') is not distinct from nullif(bound->>'sourceRevision','') then
      continue;
    end if;
    old_material := to_jsonb(inspected) - array['id','capture_version','fetched_at','updated_at','created_at','url','final_url','content_capture'];
    current_material := to_jsonb(captured) - array['id','capture_version','fetched_at','updated_at','created_at','url','final_url','content_capture'];
    old_capture := inspected.content_capture - array['sourceRevision','renderedAttempt']; current_capture := captured.content_capture - array['sourceRevision','renderedAttempt'];
    if scalar and public.reviewed_capture_address(bound->>'url') = owner
       and old_material->scalar_field = coalesce(p#>'{recommendedChange,before}', 'null'::jsonb)
       and current_material->scalar_field in (coalesce(p#>'{recommendedChange,before}', 'null'::jsonb), p#>'{recommendedChange,after}') then
      old_material := jsonb_set(old_material, array[scalar_field], current_material->scalar_field);
      if public.scalar_control_material(old_capture->>'mainHtml') is not null and public.scalar_control_material(current_capture->>'mainHtml') is not null then
        old_capture := jsonb_set(old_capture, '{mainHtml}', to_jsonb(public.scalar_control_material(old_capture->>'mainHtml')));
        current_capture := jsonb_set(current_capture, '{mainHtml}', to_jsonb(public.scalar_control_material(current_capture->>'mainHtml')));
      end if;
    end if;
    if nullif(inspected.content_capture->>'sourceRevision','') is null
       or nullif(inspected.content_capture->>'sourceRevision','') is distinct from nullif(bound->>'sourceRevision','')
       or nullif(captured.content_capture->>'sourceRevision','') is null
       or (inspected.content_capture->>'complete' = 'true' and inspected.content_capture->>'version' = '1'
         and nullif(btrim(inspected.content_capture->>'mainHtml'), '') is not null
         and inspected.fetched_at <= captured.fetched_at
         and public.reviewed_capture_address(inspected.url) = public.reviewed_capture_address(inspected.final_url)) is not true
       -- Compare every stored material field, including unknown future fields. Client asset revisions
       -- are acquisition retry identity; the complete observed publication frame is review identity.
       or current_material is distinct from old_material
       or current_capture is distinct from old_capture then
      raise exception using errcode = '23514', message = 'page_changed';
    end if;
  end loop;
  return new;
end;
$function$;
revoke all on function public.guard_ready_page_captures() from public, anon, authenticated, service_role;
