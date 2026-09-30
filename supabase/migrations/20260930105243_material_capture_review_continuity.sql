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
    if nullif(inspected.content_capture->>'sourceRevision','') is null
       or nullif(inspected.content_capture->>'sourceRevision','') is distinct from nullif(bound->>'sourceRevision','')
       or nullif(captured.content_capture->>'sourceRevision','') is null
       or (inspected.content_capture->>'complete' = 'true' and inspected.content_capture->>'version' = '1'
         and nullif(btrim(inspected.content_capture->>'mainHtml'), '') is not null
         and inspected.fetched_at <= captured.fetched_at
         and public.reviewed_capture_address(inspected.url) = public.reviewed_capture_address(inspected.final_url)) is not true
       -- Compare every stored material field, including unknown future fields. Client asset revisions
       -- are acquisition retry identity; the complete observed publication frame is review identity.
       or (to_jsonb(captured) - array['id','capture_version','fetched_at','updated_at','created_at','url','final_url','content_capture'])
         is distinct from (to_jsonb(inspected) - array['id','capture_version','fetched_at','updated_at','created_at','url','final_url','content_capture'])
       or (captured.content_capture - array['sourceRevision','renderedAttempt'])
         is distinct from (inspected.content_capture - array['sourceRevision','renderedAttempt']) then
      raise exception using errcode = '23514', message = 'page_changed';
    end if;
  end loop;
  return new;
end;
$function$;
revoke all on function public.guard_ready_page_captures() from public, anon, authenticated, service_role;
