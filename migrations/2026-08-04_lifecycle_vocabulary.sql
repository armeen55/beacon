-- 2026-08-04  Dream V1 Phase 6: the lifecycle the operator is shown is the lifecycle that is stored.
--
-- The stored words were Beacon's words, not the operator's. "proposed" said nothing about whether a
-- change was ready to act on, "applied" claimed a change was done when all Beacon really had was the
-- operator's word that they had pressed a button, and "rejected" was a status for a draft that never
-- entered the lifecycle at all. The operator-approved lifecycle is five stages:
--
--   needs_review -> ready -> implemented_pending_verification -> measuring -> result
--
-- Only the first three are STATUS. `measuring` and `result` stay DERIVED from the shipment ledger
-- (a verification landed, the windows are open or closed); duplicating them into a column here would
-- create a second answer to a question the ledger already answers, and the two would drift.
--
-- WHAT THIS FILE DOES. Renames the two stored words in place (rows AND the JSON payload each row
-- carries, because the payload is what the application re-validates on every load and a payload
-- still saying "proposed" would fail the new contract and read as no proposal at all). Moves
-- `rejected` off the status column and onto the disposition that always meant it: `withdrawn`,
-- Beacon took the draft back. Recreates the status check constraint over the three-word union, and
-- recreates supersede_change_proposal with its guard reading the renamed words.
--
-- A WITHDRAWN ROW'S STATUS IS INERT. Nothing reads the status of a row that carries a terminal
-- disposition: the queue reads current rows only. Those rows are set to 'ready' purely so the new
-- constraint holds; it is the least surprising of the three and it asserts nothing, because the
-- disposition beside it is what decides the row is history.
--
-- REVERSIBLE IN PRINCIPLE, forward-only in practice: the previous words are recoverable from this
-- file, and no row is deleted. NOT APPLIED AUTOMATICALLY. Apply it with the Phase 6 deploy.

begin;

-- 1. A draft the safety gates refused is not a lifecycle stage. It becomes history, with the
--    disposition that says Beacon withdrew it. Rows already carrying a disposition are untouched.
update public.change_proposals
   set terminal_disposition = 'withdrawn', updated_at = now()
 where status = 'rejected' and terminal_disposition is null;

-- 2. The rename, on the column.
update public.change_proposals set status = 'ready'
 where status in ('proposed', 'rejected');
update public.change_proposals set status = 'implemented_pending_verification'
 where status = 'applied';

-- 3. The rename, inside the stored payload. Same words, same rows: the payload is the record the
--    application re-validates, so a column renamed without its payload would serve nothing at all.
update public.change_proposals
   set payload = jsonb_set(payload, '{proposal,status}', '"ready"'::jsonb)
 where payload -> 'proposal' ->> 'status' in ('proposed', 'rejected');
update public.change_proposals
   set payload = jsonb_set(payload, '{proposal,status}', '"implemented_pending_verification"'::jsonb)
 where payload -> 'proposal' ->> 'status' = 'applied';

-- 4. The union itself.
alter table public.change_proposals drop constraint if exists change_proposals_status_check;
alter table public.change_proposals add constraint change_proposals_status_check
  check (status in ('needs_review', 'ready', 'implemented_pending_verification'));

-- 5. The supersession function, carried forward from 2026-08-02_supersede_saved_proof.sql, which is
--    the LAST version applied (committed after 2026-08-02_supersede_tenant_guard.sql, whose filename
--    sorts later than its content is). Those semantics, unchanged: the foreign-successor refusal, the
--    FOR UPDATE lock, the status guard, and "saved" only when the insert RETURNS the id it wrote.
--    The ONLY edit is the two status literals in the guard. Grants restated.
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

  -- A change the operator already made is not Beacon's to retire: only a row still waiting on them
  -- may step aside. The renamed words, same rule.
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
$$;

revoke all on function public.supersede_change_proposal(text, text, jsonb) from public;
revoke all on function public.supersede_change_proposal(text, text, jsonb) from anon;
revoke all on function public.supersede_change_proposal(text, text, jsonb) from authenticated;
grant execute on function public.supersede_change_proposal(text, text, jsonb) to service_role;

commit;
