-- 2026-08-01  V1 Closure: proposal supersession is one database operation.
--
-- The store superseded in three writes: mark the predecessor superseded, upsert the
-- successor, and on a failed upsert write the predecessor's disposition back. A crash
-- between the first two left the hypothesis with no current answer until the
-- compensating write ran, and the compensation itself could fail. This function does
-- the handover in one transaction: the status guard, the step-aside and the landing
-- either all happen or none do.
--
-- Returns 'saved', 'blocked' (the predecessor is not waiting on the operator, so it
-- is not Beacon's to retire), or 'failed'. Reversible: drop the function and the
-- store's previous multi-write path can be restored from git.

create or replace function public.supersede_change_proposal(
  p_tenant_id       text,
  p_predecessor_id  text,
  p_row             jsonb
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pred public.change_proposals%rowtype;
begin
  select * into v_pred
    from public.change_proposals
   where tenant_id = p_tenant_id and id = p_predecessor_id
   for update;
  if not found then
    return 'failed';
  end if;

  -- A change the operator already made is not Beacon's to retire: only a row still
  -- waiting on them may step aside. Same rule the store enforces, held here too so
  -- no future caller can skip it.
  if v_pred.terminal_disposition is not null
     or v_pred.status not in ('proposed', 'needs_review') then
    return 'blocked';
  end if;

  update public.change_proposals
     set terminal_disposition = 'superseded',
         superseded_by        = p_row->>'id',
         updated_at           = now()
   where tenant_id = p_tenant_id and id = p_predecessor_id;

  insert into public.change_proposals
    (id, tenant_id, site, case_id, page_key, action_family, proposal_version, basis,
     status, terminal_disposition, superseded_by, payload, decision_receipt,
     ranking_receipt, updated_at)
  values
    (p_row->>'id', p_tenant_id,
     coalesce(p_row->>'site', ''), coalesce(p_row->>'case_id', ''),
     coalesce(p_row->>'page_key', ''), p_row->>'action_family',
     coalesce((p_row->>'proposal_version')::int, 1), p_row->>'basis',
     p_row->>'status', null, null,
     p_row->'payload', p_row->'decision_receipt', p_row->'ranking_receipt',
     coalesce((p_row->>'updated_at')::timestamptz, now()))
  on conflict (id) do update set
    site = excluded.site, case_id = excluded.case_id, page_key = excluded.page_key,
    action_family = excluded.action_family, proposal_version = excluded.proposal_version,
    basis = excluded.basis, status = excluded.status,
    terminal_disposition = excluded.terminal_disposition,
    superseded_by = excluded.superseded_by, payload = excluded.payload,
    decision_receipt = excluded.decision_receipt, ranking_receipt = excluded.ranking_receipt,
    updated_at = excluded.updated_at;

  return 'saved';
exception when others then
  -- The block rolls back both writes: the predecessor keeps its place and the
  -- successor never half-landed.
  return 'failed';
end;
$$;
