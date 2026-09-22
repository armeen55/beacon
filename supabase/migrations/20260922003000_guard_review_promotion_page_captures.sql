-- A Ready write and the saved page captures it was checked against are one transaction.
-- The table lock is held only for the final promotion statement; it prevents a crawl insert
-- from slipping between the capture comparison and the proposal CAS.
create or replace function public.answer_change_proposal_review_guarded(
  p_tenant_id text, p_id text, p_expected_version integer,
  p_expected_payload jsonb, p_payload jsonb, p_status text,
  p_expected_captures jsonb
) returns text
language plpgsql security definer set search_path = pg_catalog, public
as $function$
declare
  v_capture record;
  v_latest_id text;
  v_kind text;
begin
  if p_status = 'ready' then
    if jsonb_typeof(p_expected_captures) is distinct from 'array' then return 'blocked'; end if;
    v_kind := p_payload #>> '{proposal,recommendedChange,kind}';
    if v_kind not in ('existing_edit', 'new_page') then return 'blocked'; end if;
    if v_kind = 'existing_edit' and jsonb_array_length(p_expected_captures) = 0 then return 'page_changed'; end if;
    lock table public.page_snapshots in share mode;
    for v_capture in
      select page_id, latest_capture_id
      from jsonb_to_recordset(p_expected_captures) as x(page_id text, latest_capture_id text)
    loop
      select ps.id::text into v_latest_id
      from public.page_snapshots ps
      where ps.tenant_id = p_tenant_id and ps.page_id::text = v_capture.page_id
      order by ps.fetched_at desc, ps.id desc limit 1;
      if v_latest_id is distinct from v_capture.latest_capture_id then return 'page_changed'; end if;
    end loop;
  end if;
  return public.answer_change_proposal_review(
    p_tenant_id, p_id, p_expected_version, p_expected_payload, p_payload, p_status
  );
end;
$function$;

revoke all on function public.answer_change_proposal_review_guarded(text, text, integer, jsonb, jsonb, text, jsonb) from public, anon, authenticated;
grant execute on function public.answer_change_proposal_review_guarded(text, text, integer, jsonb, jsonb, text, jsonb) to service_role;
