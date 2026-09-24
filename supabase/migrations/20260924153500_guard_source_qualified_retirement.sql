-- A source-qualified withdrawal and its captured page are one database decision.
-- The brief lock also blocks a crawl insert or update until the proposal CAS completes.
create or replace function public.retire_change_proposal_guarded(
  p_tenant_id text, p_id text, p_expected_version integer, p_expected_status text,
  p_disposition text, p_superseded_by text, p_reason text, p_expected_capture jsonb
) returns boolean
language plpgsql security definer set search_path = pg_catalog, public set lock_timeout = '2s'
as $function$
declare
  v_latest_id text;
  v_actual jsonb;
  v_checked jsonb;
begin
  if p_disposition <> 'withdrawn' or jsonb_typeof(p_expected_capture) is distinct from 'object'
     or jsonb_typeof(p_expected_capture->'id') is distinct from 'string'
     or jsonb_typeof(p_expected_capture->'page_id') is distinct from 'string'
     or length(btrim(p_expected_capture->>'id')) = 0
     or length(btrim(p_expected_capture->>'page_id')) = 0
     or jsonb_typeof(p_expected_capture->'content_hash') is distinct from 'string'
     or jsonb_typeof(p_expected_capture->'body_text') is distinct from 'string'
     or p_expected_capture #>> '{content_capture,complete}' is distinct from 'true'
     or p_expected_capture->>'extraction_certainty' is distinct from 'confirmed'
     or not (p_expected_capture ?& array['url','final_url','fetched_at','word_count','content_capture'])
  then return false; end if;
  lock table public.page_snapshots in share mode;
  select ps.id::text, to_jsonb(ps) into v_latest_id, v_actual
    from public.page_snapshots ps
   where ps.tenant_id = p_tenant_id and ps.page_id::text = p_expected_capture->>'page_id'
   order by ps.fetched_at desc, ps.id desc limit 1;
  if not found or v_latest_id is distinct from p_expected_capture->>'id' then return false; end if;
  select jsonb_object_agg(k, v_actual->k) into v_checked
    from jsonb_object_keys(p_expected_capture) k;
  if v_checked is distinct from p_expected_capture then return false; end if;
  return public.retire_change_proposal(
    p_tenant_id, p_id, p_expected_version, p_expected_status,
    p_disposition, p_superseded_by, p_reason
  );
end;
$function$;
revoke all on function public.retire_change_proposal_guarded(text, text, integer, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.retire_change_proposal_guarded(text, text, integer, text, text, text, text, jsonb) to service_role;
