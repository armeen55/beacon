-- Capture revisions bind the actual reviewed frame; all Ready doors check that frame atomically.
create sequence public.page_capture_revision_seq as bigint;
alter table public.page_snapshots add column capture_version bigint;
update public.page_snapshots set capture_version = nextval('public.page_capture_revision_seq');
alter table public.page_snapshots alter column capture_version set not null;
alter sequence public.page_capture_revision_seq owned by public.page_snapshots.capture_version;
alter table public.page_snapshots add constraint page_capture_revision_positive check (capture_version > 0);
-- Only the existing www/trailing-slash aliases merge. Protocol, port, path and query stay exact.
create function public.reviewed_capture_address(raw text) returns text
language sql immutable strict set search_path = pg_catalog as $function$
  select lower(m[1]) || '://' || lower(m[3]) || coalesce(m[4], '') ||
    coalesce(nullif(regexp_replace(coalesce(m[5], '/'), '/+$', ''), ''), '/') || coalesce(m[6], '')
  from regexp_match(case when raw !~ '^[A-Za-z][A-Za-z0-9+.-]*://' and raw not like '/%' then 'https://' || raw else raw end, '^(https?)://(www\.)?([^/?#:@]+)(:[0-9]+)?(/[^?#]*)?(\?[^#]*)?$','i') m;
$function$;
revoke all on function public.reviewed_capture_address(text) from public, anon, authenticated, service_role;

create function public.assign_page_capture_revision() returns trigger
language plpgsql security definer set search_path = pg_catalog, public set lock_timeout = '2s' as $function$
declare latest public.page_snapshots%rowtype; same_latest boolean := false;
begin
  if tg_op = 'INSERT' or (to_jsonb(new) - array['capture_version','fetched_at','updated_at','created_at'])
      is distinct from (to_jsonb(old) - array['capture_version','fetched_at','updated_at','created_at']) then
    perform pg_advisory_xact_lock(hashtextextended('page-capture:' || new.tenant_id || ':' || public.reviewed_capture_address(new.url),0));
    if tg_op = 'INSERT' then
      select ps.* into latest from public.page_snapshots ps where ps.tenant_id = new.tenant_id
        and public.reviewed_capture_address(ps.url) = public.reviewed_capture_address(new.url)
        order by ps.fetched_at desc, ps.id desc limit 1;
      same_latest := found and (to_jsonb(new) - array['id','capture_version','fetched_at','updated_at','created_at'])
        is not distinct from (to_jsonb(latest) - array['id','capture_version','fetched_at','updated_at','created_at']);
    end if;
    new.capture_version := case when same_latest then latest.capture_version else nextval('public.page_capture_revision_seq') end;
  else new.capture_version := old.capture_version; end if;
  return new;
end;
$function$;
revoke all on function public.assign_page_capture_revision() from public, anon, authenticated, service_role;
revoke all on sequence public.page_capture_revision_seq from public, anon, authenticated, service_role;
create trigger trg_page_capture_revision before insert or update on public.page_snapshots
for each row execute function public.assign_page_capture_revision();

create function public.guard_ready_page_captures() returns trigger
language plpgsql security definer set search_path = pg_catalog, public set lock_timeout = '2s' as $function$
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
       or captured.capture_version <> (bound->>'captureVersion')::numeric
       or (captured.content_capture->>'complete' = 'true' and nullif(btrim(captured.content_capture->>'mainHtml'), '') is not null
         and captured.content_capture->>'version' = '1'
         and captured.fetched_at >= inspected_at - interval '7 days' and captured.fetched_at <= inspected_at
         and public.reviewed_capture_address(captured.url) = public.reviewed_capture_address(captured.final_url)) is not true
       or nullif(captured.content_capture->>'sourceRevision','') is distinct from nullif(bound->>'sourceRevision','') then
      raise exception using errcode = '23514', message = 'page_changed';
    end if;
  end loop;
  return new;
end;
$function$;
revoke all on function public.guard_ready_page_captures() from public, anon, authenticated, service_role;
create trigger trg_ready_page_captures before insert or update on public.change_proposals
for each row execute function public.guard_ready_page_captures();

-- Signature retained; reviewed proposal metadata, not a promotion-time reread, is now universal authority.
create or replace function public.answer_change_proposal_review_guarded(
  p_tenant_id text, p_id text, p_expected_version integer, p_expected_payload jsonb,
  p_payload jsonb, p_status text, p_expected_captures jsonb
) returns text language plpgsql security definer set search_path = pg_catalog, public set lock_timeout = '2s' as $function$
begin
  if p_status is null or p_status not in ('ready','needs_review') then return 'blocked'; end if;
  return public.answer_change_proposal_review(p_tenant_id,p_id,p_expected_version,p_expected_payload,p_payload,p_status);
end;
$function$;

-- Exact paused proof saves can requalify Ready through the same universal source/capture gates.
create or replace function public.save_change_proposal_proof_cas(
  p_tenant_id text,
  p_row jsonb,
  p_expected_version integer,
  p_expected_status text,
  p_expected_payload jsonb,
  p_expected_current jsonb
) returns text
language plpgsql
security definer
set search_path = pg_catalog, public set lock_timeout = '2s'
as $function$
declare
  v_saved text;
  v_expected_page jsonb;
  v_current_page jsonb;
  p jsonb := p_row #> '{payload,proposal}';
  r jsonb := p #> '{semanticReview}';
  mechanical boolean := p #>> '{recommendedChange,kind}' = 'existing_edit' and p #>> '{recommendedChange,field}' = 'section'
    and p #>> '{recommendedChange,linkMode}' = 'in_place' and nullif(p #>> '{recommendedChange,linkTo}','') is not null
    and p #>> '{recommendedChange,before}' = p #>> '{recommendedChange,after}'
    and jsonb_typeof(p->'reviewedCaptures') = 'array' and jsonb_array_length(p->'reviewedCaptures') > 0
    and p->'reviewedCaptures' is distinct from p_expected_payload #> '{proposal,reviewedCaptures}'
    and coalesce(p->'assignment','null'::jsonb) = 'null'::jsonb and coalesce(p->'informationGain','null'::jsonb) = 'null'::jsonb
    and coalesce(p->'bundle','null'::jsonb) = 'null'::jsonb and coalesce(p->'obligation','null'::jsonb) = 'null'::jsonb
    and coalesce(p->'researchOnly','false'::jsonb) = 'false'::jsonb
    and coalesce(p->'faults','[]'::jsonb) = '[]'::jsonb and coalesce(p->'limitations','[]'::jsonb) = '[]'::jsonb
    and p #>> '{recommendedChange,target,mode}' = 'replace' and p #>> '{recommendedChange,target,anchorKind}' = 'passage'
    and p #>> '{recommendedChange,target,anchor}' = p #>> '{recommendedChange,before}'
    and jsonb_array_length(p #> '{recommendedChange,units}') = 1 and p #>> '{recommendedChange,units,0,kind}' = 'paragraph'
    and p #>> '{recommendedChange,units,0,text}' = p #>> '{recommendedChange,before}'
    and nullif(p #>> '{recommendedChange,anchorText}','') is not null and nullif(p #>> '{recommendedChange,linkSourceHash}','') is not null
    and jsonb_array_length(p->'claims') = 1 and p #>> '{claims,0,text}' = p #>> '{recommendedChange,anchorText}'
    and jsonb_array_length(p #> '{claims,0,supportedBy}') = 2 and (p #> '{claims,0,supportedBy}') @> '["page-copy-in-place"]'::jsonb
    and not exists (select 1 from jsonb_array_elements_text(p #> '{claims,0,supportedBy}') i where i <> 'page-copy-in-place' and i !~ '^owned-page-target-copy-[0-9]+$');
begin
  if (p_tenant_id <> '' and nullif(p_row->>'id', '') is not null and nullif(p_row->>'mutation_key', '') is not null
      and jsonb_typeof(p_expected_current) = 'array' and p_expected_status in ('needs_review','ready')
      and p_row->>'id' = p->>'id' and p_row->>'id' = p_expected_payload #>> '{proposal,id}'
      and p_tenant_id = p->>'tenantId' and p_tenant_id = p_expected_payload #>> '{proposal,tenantId}'
      and p->>'status' = p_row->>'status' and p_expected_payload #>> '{proposal,status}' = p_expected_status
      and p_row->>'status' in ('needs_review','ready') and (p_row->>'proposal_version')::integer = p_expected_version + 1) is not true then return 'failed'; end if;
  if p_expected_status = 'ready' and p_row->>'status' = 'ready' and not coalesce(mechanical,false) then
    if (jsonb_typeof(r) = 'object' and r is distinct from p_expected_payload #> '{proposal,semanticReview}'
        and nullif(r->>'of','') is not null and r->>'version' = '7' and jsonb_typeof(r->'claims') = 'array'
        and jsonb_typeof(p->'claims') = 'array' and jsonb_array_length(p->'claims') > 0
        and jsonb_array_length(r->'claims') = jsonb_array_length(p->'claims')
        and r #>> '{editor,contested}' is distinct from 'true'
        and (r->'editor') @> '{"pageFit":true,"placementCorrect":true,"resolvesDiagnosis":true,"implementableNow":true,"improvesPage":true,"wouldHandToCustomer":true}'::jsonb) is not true
      or exists (select 1 from jsonb_array_elements(r->'claims') c where c->>'entailed' is distinct from 'true'
        or c->>'i' !~ '^[0-9]+$' or (c->>'i')::integer >= jsonb_array_length(p->'claims')
        or jsonb_typeof(c->'by') is distinct from 'array' or jsonb_array_length(c->'by') = 0
        or exists (select 1 from jsonb_array_elements_text(c->'by') by_id
          where not (p->'claims'->((c->>'i')::integer)->'supportedBy') @> jsonb_build_array(by_id)))
      or (select count(distinct c->>'i') from jsonb_array_elements(r->'claims') c) <> jsonb_array_length(p->'claims') then return 'blocked'; end if;
  end if;

  perform 1 from public.tenants t where t.id = p_tenant_id and t.research_paused is true for update;
  if not found then return 'research_resumed'; end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'proposal-page:' || p_tenant_id || ':' || coalesce(p_row->>'case_id', '') || ':' || coalesce(p_row->>'page_key', ''), 0));

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', x.id, 'mutation_key', x.mutation_key, 'proposal_version', x.proposal_version, 'status', x.status
    ) order by x.id), '[]'::jsonb)
    into v_expected_page
    from jsonb_to_recordset(p_expected_current)
      as x(id text, mutation_key text, proposal_version integer, status text);
  if jsonb_array_length(p_expected_current) <> (
      select count(distinct x.id) from jsonb_to_recordset(p_expected_current)
        as x(id text, mutation_key text, proposal_version integer, status text)
    ) then return 'failed'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', cp.id, 'mutation_key', cp.mutation_key, 'proposal_version', cp.proposal_version, 'status', cp.status
    ) order by cp.id), '[]'::jsonb)
    into v_current_page
    from public.change_proposals cp
   where cp.tenant_id = p_tenant_id
     and cp.case_id = coalesce(p_row->>'case_id', '')
     and cp.page_key = coalesce(p_row->>'page_key', '')
     and cp.terminal_disposition is null;
  if v_current_page is distinct from v_expected_page then return 'stale_page'; end if;

  update public.change_proposals
     set proposal_version = (p_row->>'proposal_version')::int,
         basis = p_row->>'basis', status = p_row->>'status', payload = p_row->'payload',
         decision_receipt = p_row->'decision_receipt', -- Independent rank refreshes are not copy/version writes.
         updated_at = coalesce((p_row->>'updated_at')::timestamptz, now())
   where tenant_id = p_tenant_id and id = p_row->>'id'
     and mutation_key = p_row->>'mutation_key' and case_id = coalesce(p_row->>'case_id','')
     and page_key = coalesce(p_row->>'page_key','')
     and proposal_version = p_expected_version and status = p_expected_status
     and terminal_disposition is null and payload = p_expected_payload
  returning id into v_saved;
  if v_saved is null then return 'blocked'; end if;
  return 'saved';
end;
$function$;
