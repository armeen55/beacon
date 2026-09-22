-- A Ready write and the saved page captures it was checked against are one transaction.
-- The table lock is held only for the final promotion statement; it prevents a crawl insert
-- from slipping between the capture comparison and the proposal CAS.
create or replace function public.answer_change_proposal_review_guarded(
  p_tenant_id text, p_id text, p_expected_version integer,
  p_expected_payload jsonb, p_payload jsonb, p_status text,
  p_expected_captures jsonb
) returns text
language plpgsql security definer set search_path = pg_catalog, public set lock_timeout = '2s'
as $function$
declare
  v_capture record;
  v_latest_id text;
  v_kind text;
  v_state jsonb;
  v_actual jsonb;
begin
  if p_status is null or p_status not in ('ready', 'needs_review') then return 'blocked'; end if;
  if p_status = 'ready' then
    if jsonb_typeof(p_expected_captures) is distinct from 'array' then return 'blocked'; end if;
    v_kind := p_payload #>> '{proposal,recommendedChange,kind}';
    if v_kind is null or v_kind not in ('existing_edit', 'new_page') then return 'blocked'; end if;
    if v_kind = 'existing_edit' and jsonb_array_length(p_expected_captures) = 0 then return 'page_changed'; end if;
    if exists (select 1 from jsonb_array_elements(p_expected_captures) c where
      jsonb_typeof(c) is distinct from 'object' or jsonb_typeof(c->'page_id') is distinct from 'string'
      or jsonb_typeof(c->'latest_capture_id') is distinct from 'string'
      or length(btrim(c->>'page_id')) = 0 or length(btrim(c->>'latest_capture_id')) = 0
      or jsonb_typeof(c->'states') is distinct from 'array') then return 'blocked'; end if;
    lock table public.page_snapshots in share mode;
    for v_capture in
      select page_id, latest_capture_id, states
      from jsonb_to_recordset(p_expected_captures) as x(page_id text, latest_capture_id text, states jsonb)
    loop
      select ps.id::text into v_latest_id
      from public.page_snapshots ps
      where ps.tenant_id = p_tenant_id and ps.page_id::text = v_capture.page_id
      order by ps.fetched_at desc, ps.id desc limit 1;
      if not found or v_latest_id is distinct from v_capture.latest_capture_id then return 'page_changed'; end if;
      if jsonb_array_length(v_capture.states) = 0 then return 'blocked'; end if;
      if not exists (select 1 from jsonb_array_elements(v_capture.states) s where s->>'id' = v_latest_id) then return 'blocked'; end if;
      for v_state in select value from jsonb_array_elements(v_capture.states) loop
        if jsonb_typeof(v_state) is distinct from 'object' or not (v_state ?& array['id','page_id','url','title','h1','meta_description','fetched_at','word_count','h2_list','h3_list','faqs','body_text','body_paragraph_sample','card_texts','schema_entity_names','internal_links','content_hash','extraction_certainty','content_capture']) then return 'blocked'; end if;
        select to_jsonb(ps) into v_actual
          from public.page_snapshots ps where ps.tenant_id = p_tenant_id and ps.page_id = v_capture.page_id and ps.id = v_state->>'id';
        if not found then return 'page_changed'; end if;
        select jsonb_object_agg(k, v_actual->k) into v_actual from jsonb_object_keys(v_state) k;
        if v_actual is distinct from v_state then return 'page_changed'; end if;
      end loop;
    end loop;
  end if;
  return public.answer_change_proposal_review(
    p_tenant_id, p_id, p_expected_version, p_expected_payload, p_payload, p_status
  );
end;
$function$;

revoke all on function public.answer_change_proposal_review_guarded(text, text, integer, jsonb, jsonb, text, jsonb) from public, anon, authenticated;
grant execute on function public.answer_change_proposal_review_guarded(text, text, integer, jsonb, jsonb, text, jsonb) to service_role;
