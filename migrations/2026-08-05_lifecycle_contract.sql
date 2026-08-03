-- 2026-08-05  Dream V1: STEP 3 OF 3, the union closes on the three words the operator is shown.
--
-- ORDER IS THE WHOLE POINT. Apply this ONLY after migrations/2026-08-05_lifecycle_data.sql has run and
-- its AFTER notices showed zero rows and zero payloads on 'proposed', 'applied' and 'rejected'. Applied
-- any earlier, this constraint rejects rows that still exist and writes that still happen.
--
-- Once this lands, an old word is not a value the database will accept, which is what finally makes the
-- stored lifecycle the same lifecycle the operator reads. THE BRIDGE IS DELETED IN THE SAME STEP: the
-- proposal store's read-time normalization has nothing left to normalize, and a decoder that quietly
-- accepts a word the database can no longer hold is a second vocabulary hiding in the application.
--
-- The guard drops the old spelling with it: only 'ready' and 'needs_review' are a row still waiting on
-- the operator, and only such a row is Beacon's to retire.
--
-- Reversible: re-apply migrations/2026-08-04_lifecycle_expand.sql to reopen the union and the guard.

begin;

alter table public.change_proposals drop constraint if exists change_proposals_status_check;
alter table public.change_proposals add constraint change_proposals_status_check
  check (status in ('needs_review', 'ready', 'implemented_pending_verification'));

-- Same function as 2026-08-04_lifecycle_expand.sql in every respect (foreign-successor refusal, FOR
-- UPDATE lock, "saved" only on a RETURNING id), with the guard narrowed to the new vocabulary.
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
