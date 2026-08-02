-- 2026-08-02  V1 Final Truth Repair: "saved" now requires proof that the successor row landed.
--
-- THE HOLE. The tenant pre-check reads without a lock, so a successor id inserted under ANOTHER
-- account in the moment between that read and this insert makes the ON CONFLICT ... WHERE clause
-- match zero rows. The insert then does nothing, silently, and the function returned 'saved' with
-- the predecessor already stepped aside: one proposal retired, no proposal to replace it, and the
-- caller told the handover worked. A guard that only reads cannot close a race; the write's own
-- landing is the only proof there is.
--
-- WHAT THIS DOES. The insert RETURNS the id it actually wrote. Nothing returned means nothing
-- landed, so it raises, the block's subtransaction unwinds BOTH writes (the predecessor keeps its
-- place) and the handler returns 'failed'. The caller then behaves exactly as it does for the
-- crafted-id case it already handles. Replaces the function in place; grants restated.

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
    updated_at = excluded.updated_at
  where public.change_proposals.tenant_id = p_tenant_id
  returning id into v_saved;

  -- ZERO ROWS IS NOT A SAVE. Raising here (rather than returning) is deliberate: the handler below
  -- is what rolls the predecessor's retirement back, so the only honest exit is through it.
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
