-- An exact, paused-tenant proof may demote Ready to held review under full payload CAS.
-- Existing needs_review proof saves retain their current semantics; no Ready promotion is added.
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
set search_path = pg_catalog, public
as $function$
declare
  v_saved text;
  v_expected_page jsonb;
  v_current_page jsonb;
begin
  if p_tenant_id is null or p_tenant_id = '' or nullif(p_row->>'id', '') is null
     or nullif(p_row->>'mutation_key', '') is null or jsonb_typeof(p_expected_current) <> 'array'
     or not (p_expected_status = 'needs_review'
       or (p_expected_status = 'ready' and p_row->>'status' = 'needs_review'
         and p_row->'payload' #>> '{proposal,status}' = 'needs_review'
         and p_expected_payload #>> '{proposal,status}' = 'ready'
         and p_row->>'id' = p_row->'payload' #>> '{proposal,id}'
         and p_row->>'id' = p_expected_payload #>> '{proposal,id}'
         and p_tenant_id = p_row->'payload' #>> '{proposal,tenantId}'
         and p_tenant_id = p_expected_payload #>> '{proposal,tenantId}'
         and (p_row->>'proposal_version')::integer = p_expected_version + 1))
     then return 'failed'; end if;

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
         decision_receipt = p_row->'decision_receipt', ranking_receipt = p_row->'ranking_receipt',
         updated_at = coalesce((p_row->>'updated_at')::timestamptz, now())
   where tenant_id = p_tenant_id and id = p_row->>'id'
     and mutation_key = p_row->>'mutation_key'
     and proposal_version = p_expected_version and status = p_expected_status
     and terminal_disposition is null and payload = p_expected_payload
  returning id into v_saved;
  if v_saved is null then return 'blocked'; end if;
  return 'saved';
end;
$function$;

revoke all on function public.save_change_proposal_proof_cas(text, jsonb, integer, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.save_change_proposal_proof_cas(text, jsonb, integer, text, jsonb, jsonb) to service_role;
