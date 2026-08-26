-- 2026-08-26  THE HANDOVER NEVER WROTE THE COLUMN ITS OWN INDEX IS KEYED ON.
--
-- `ux_change_proposals_current` is (tenant_id, case_id, page_key, action_family, mutation_key) over the current
-- rows, and `supersede_change_proposal` is the path every redraft takes when a different id takes over an
-- identity. Its INSERT column list omits `mutation_key` entirely, so a successor landed carrying the column's
-- `''` default, and the `on conflict (id) do update` omits it too, so a row that already existed kept whatever
-- stale value it had. Verified against production: pg_get_functiondef does not contain the string at all.
--
-- It has been survivable only because the common save re-saves the SAME id and goes through the plain upsert,
-- which does write the column. It stops being survivable now that `mutation_key` carries the mutation FOOTPRINT
-- (src/domains/decision/mutation-footprint.ts): a blank key is a claim that a change writes nothing, and two
-- blanks on one page are an index collision that fails the save with only a log line to say so.
--
-- CREATE OR REPLACE only. No column, index, constraint or row is added, altered or dropped, and the function's
-- signature, guards, return words and exception handling are byte-for-byte what they were: the two column lists
-- are the whole change. Rolling back means replacing it with the previous definition.

create or replace function public.supersede_change_proposal(p_tenant_id text, p_predecessor_id text, p_row jsonb)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pred  public.change_proposals%rowtype;
  v_saved text;
begin
  -- A successor id living under another account is not a conflict to merge, it is a crafted call.
  if exists (
    select 1 from public.change_proposals
     where id = p_row->>'id' and tenant_id <> p_tenant_id
  ) then
    return 'failed';
  end if;

  select * into v_pred
    from public.change_proposals
   where tenant_id = p_tenant_id and id = p_predecessor_id
   for update;
  if not found then
    return 'failed';
  end if;

  -- A change the operator already made is not Beacon's to retire: only a row still waiting on them may
  -- step aside. The renamed words, same rule.
  if v_pred.terminal_disposition is not null
     or v_pred.status not in ('ready', 'needs_review') then
    return 'blocked';
  end if;

  update public.change_proposals
     set terminal_disposition = 'superseded',
         superseded_by        = p_row->>'id',
         updated_at           = now()
   where tenant_id = p_tenant_id and id = p_predecessor_id;

  insert into public.change_proposals
    (id, tenant_id, site, case_id, page_key, action_family, mutation_key, proposal_version, basis,
     status, terminal_disposition, superseded_by, payload, decision_receipt,
     ranking_receipt, updated_at)
  values
    (p_row->>'id', p_tenant_id,
     coalesce(p_row->>'site', ''), coalesce(p_row->>'case_id', ''),
     coalesce(p_row->>'page_key', ''), p_row->>'action_family',
     coalesce(p_row->>'mutation_key', ''),
     coalesce((p_row->>'proposal_version')::int, 1), p_row->>'basis',
     p_row->>'status', null, null,
     p_row->'payload', p_row->'decision_receipt', p_row->'ranking_receipt',
     coalesce((p_row->>'updated_at')::timestamptz, now()))
  on conflict (id) do update set
    site = excluded.site, case_id = excluded.case_id, page_key = excluded.page_key,
    action_family = excluded.action_family, mutation_key = excluded.mutation_key,
    proposal_version = excluded.proposal_version,
    basis = excluded.basis, status = excluded.status,
    terminal_disposition = excluded.terminal_disposition,
    superseded_by = excluded.superseded_by, payload = excluded.payload,
    decision_receipt = excluded.decision_receipt, ranking_receipt = excluded.ranking_receipt,
    updated_at = excluded.updated_at
  where public.change_proposals.tenant_id = p_tenant_id
  returning id into v_saved;

  -- ZERO ROWS IS NOT A SAVE. Raising here is deliberate: the handler below is what rolls the
  -- predecessor's retirement back, so the only honest exit is through it.
  if v_saved is null then
    raise exception 'supersede_change_proposal: successor % did not land for tenant %',
      p_row->>'id', p_tenant_id;
  end if;

  return 'saved';
exception when others then
  return 'failed';
end;
$function$;
