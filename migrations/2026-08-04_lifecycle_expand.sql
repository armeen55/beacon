-- 2026-08-04  Dream V1: STEP 1 OF 3, the lifecycle vocabulary widens. NOTHING IS REWRITTEN HERE.
--
-- THE HAZARD THIS REPLACES. The first version of this change rewrote every row AND narrowed the check
-- constraint in one transaction. Production runs the OLD code for as long as it takes a deploy to roll,
-- and the old code reads 'proposed' and 'applied' and WRITES them back. Applied before that release, it
-- broke every read; applied after, the first old-code write hit the new constraint and failed. There is
-- no safe moment for a one-shot. So the change is a sequence, and each step is safe on its own:
--
--   1. THIS FILE (expand). The constraint allows BOTH vocabularies at once, and the supersede guard
--      treats both spellings of "still waiting on the operator" as waiting. Old code keeps working
--      exactly as it does today. No row is touched. Apply this BEFORE the bridge release ships.
--      EVERY word production writes today is named, 'applied' included. It is the word the live code
--      writes when the operator says they made a change, and rows already carry it, so a union that
--      left it out would have failed its own validation on this table and refused the operator's
--      primary write for the whole bridge window. Widening a union may never narrow one.
--   2. migrations/2026-08-05_lifecycle_data.sql (rewrite). Runs ONLY after the bridge release is
--      verified healthy in production. Moves the rows and the stored payloads onto the new words.
--   3. migrations/2026-08-05_lifecycle_contract.sql (narrow). Runs ONLY after step 2's counts verify.
--      The union becomes the three new words and the guard drops the old spelling.
--
-- THE BRIDGE, which is application code and not this file's business, is what makes step 1 to step 2
-- survivable: the proposal store's decode path normalizes 'proposed' to 'ready' and 'applied' to
-- 'implemented_pending_verification' AT READ TIME, reads a 'rejected' row as the withdrawn disposition
-- it always meant, and WRITES only the new words. It is deleted at step 3.
--
-- The operator-approved lifecycle is five stages:
--   needs_review -> ready -> implemented_pending_verification -> measuring -> result
-- Only the first three are STATUS. `measuring` and `result` stay DERIVED from the shipment ledger; a
-- column duplicating them would be a second answer to a question the ledger already answers.
--
-- Reversible: restore the previous constraint and the guard from 2026-08-02_supersede_saved_proof.sql.

begin;

-- The union, held open. Every value either vocabulary can write is legal for the length of the rollout.
alter table public.change_proposals drop constraint if exists change_proposals_status_check;
alter table public.change_proposals add constraint change_proposals_status_check
  check (status in (
    'proposed', 'applied', 'needs_review', 'rejected',  -- the words production writes today
    'ready', 'implemented_pending_verification'         -- the words the bridge release writes
  ));

-- The supersession function, carried forward from 2026-08-02_supersede_saved_proof.sql, which is the
-- LAST version applied (committed after 2026-08-02_supersede_tenant_guard.sql, whose filename sorts
-- later than its content is). Those semantics, unchanged: the foreign-successor refusal, the FOR UPDATE
-- lock, the status guard, and "saved" only when the insert RETURNS the id it wrote. The ONLY edit is the
-- guard's list, which now names BOTH spellings of a row still waiting on the operator, so a predecessor
-- written by either release may step aside. 'applied' is deliberately NOT in that list even though the
-- constraint above accepts it: it is the word for a change the operator already made, which is never
-- Beacon's to retire. Grants restated.
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

  -- A change the operator already made is not Beacon's to retire: only a row still waiting on them may
  -- step aside. Both vocabularies, for the length of the rollout.
  if v_pred.terminal_disposition is not null
     or v_pred.status not in ('proposed', 'needs_review', 'ready') then
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
