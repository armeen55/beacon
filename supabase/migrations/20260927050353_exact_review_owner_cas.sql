-- Exact review ownership uses the existing active-runtime CAS; paused proof admission remains separate.
create or replace function public.save_change_proposal_cas(
  p_tenant_id text,
  p_row jsonb,
  p_expect_absent boolean,
  p_expected_version integer,
  p_expected_status text,
  p_expected_disposition text,
  p_expected_current jsonb
) returns text
language plpgsql
security definer
set search_path = pg_catalog, public
set lock_timeout = '2s'
as $function$
declare
  v_saved text;
  v_work_key text;
  v_old_work_key text;
  v_lock_key text;
  v_existing public.change_proposals%rowtype;
  v_expected_page jsonb;
  v_current_page jsonb;
  v_exact jsonb;
  v_has_exact boolean;
begin
  if p_tenant_id is null or p_tenant_id = '' or nullif(p_row->>'id', '') is null
     or nullif(p_row->>'mutation_key', '') is null
     or jsonb_typeof(p_expected_current) <> 'array' then return 'failed'; end if;
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
  perform pg_advisory_xact_lock(hashtextextended(
    'proposal-seat:' || p_tenant_id || ':' || (p_row->>'id'), 0));
  v_work_key := nullif(p_row->'payload'->>'workKey', '');
  select * into v_existing from public.change_proposals
   where tenant_id = p_tenant_id and id = p_row->>'id';
  select x->'payload', x ? 'payload' into v_exact, v_has_exact from jsonb_array_elements(p_expected_current) x where x->>'id' = p_row->>'id';
  if v_has_exact and (p_expect_absent or v_existing.tenant_id is distinct from p_tenant_id or v_existing.payload is distinct from v_exact) then return 'blocked'; end if;
  v_old_work_key := case when v_existing.id is not null then nullif(v_existing.payload->>'workKey', '') else null end;
  -- A generation replacement and the final provider door share both identities. Lock them in lexical order so a
  -- reserved old generation cannot transmit after this row starts meaning a new generation.
  for v_lock_key in select distinct x from unnest(array[v_old_work_key, v_work_key]) as keys(x)
      where x is not null order by x loop
    perform pg_advisory_xact_lock(hashtextextended('proposal-work:' || p_tenant_id || ':' || v_lock_key, 0));
  end loop;
  if v_work_key is not null and exists (select 1 from public.proposal_work_tombstones
      where tenant_id = p_tenant_id and work_key = v_work_key) then return 'blocked'; end if;
  if exists (select 1 from public.change_proposals
      where id = p_row->>'id' and tenant_id <> p_tenant_id) then return 'blocked'; end if;

  if p_expect_absent then
    insert into public.change_proposals
      (id, tenant_id, site, case_id, page_key, action_family, mutation_key, proposal_version, basis,
       status, terminal_disposition, superseded_by, withdrawn_reason, payload, decision_receipt,
       ranking_receipt, updated_at)
    values
      (p_row->>'id', p_tenant_id, coalesce(p_row->>'site', ''), coalesce(p_row->>'case_id', ''),
       coalesce(p_row->>'page_key', ''), p_row->>'action_family', p_row->>'mutation_key',
       coalesce((p_row->>'proposal_version')::int, 1), p_row->>'basis', p_row->>'status', null, null,
       null, p_row->'payload', p_row->'decision_receipt', p_row->'ranking_receipt',
       coalesce((p_row->>'updated_at')::timestamptz, now()))
    on conflict (id) do nothing returning id into v_saved;
  else
    update public.change_proposals
       set site = coalesce(p_row->>'site', ''), case_id = coalesce(p_row->>'case_id', ''),
           page_key = coalesce(p_row->>'page_key', ''), action_family = p_row->>'action_family',
           proposal_version = (p_row->>'proposal_version')::int, basis = p_row->>'basis',
           status = p_row->>'status', terminal_disposition = null, superseded_by = null,
           withdrawn_reason = null, payload = p_row->'payload',
           decision_receipt = p_row->'decision_receipt', ranking_receipt = case when v_has_exact then ranking_receipt else p_row->'ranking_receipt' end,
           updated_at = coalesce((p_row->>'updated_at')::timestamptz, now())
     where tenant_id = p_tenant_id and id = p_row->>'id'
       and mutation_key = p_row->>'mutation_key'
       and proposal_version = p_expected_version and status = p_expected_status
       and p_expected_disposition is null and terminal_disposition is null
       and (not coalesce(v_has_exact, false) or payload = v_exact)
    returning id into v_saved;
  end if;
  if v_saved is null then return 'blocked'; end if;
  if v_old_work_key is not null and v_old_work_key is distinct from v_work_key then
    insert into public.proposal_work_tombstones
      (tenant_id, work_key, proposal_id, disposition, retired_at)
    values (p_tenant_id, v_old_work_key, p_row->>'id', 'superseded', now())
    on conflict do nothing;
  end if;
  return 'saved';
end;
$function$;
