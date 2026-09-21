-- change_proposals.payload is a versioned envelope: { v, proposal }. The seat-permanence functions read a
-- derived root workKey so Postgres can lock a generation without decoding the business record. The application
-- now writes that projection; backfill every live row once and require it to stay equal to the canonical key.

update public.change_proposals
   set payload = case
     when nullif(payload #>> '{proposal,workKey}', '') is null then payload - 'workKey'
     else jsonb_set(payload, '{workKey}', to_jsonb(payload #>> '{proposal,workKey}'), true)
   end
 where terminal_disposition is null
   and (payload->>'workKey') is distinct from nullif(payload #>> '{proposal,workKey}', '');

-- Terminal rows are immutable. Seed their real generation tombstones from the canonical nested record without
-- rewriting history; the earlier __legacy_unkeyed__ markers remain harmless provenance and match no real key.
insert into public.proposal_work_tombstones (tenant_id, work_key, proposal_id, disposition, retired_at)
select tenant_id, payload #>> '{proposal,workKey}', id, terminal_disposition, updated_at
  from public.change_proposals
 where terminal_disposition is not null
   and nullif(payload #>> '{proposal,workKey}', '') is not null
on conflict do nothing;

alter table public.change_proposals
  drop constraint if exists change_proposals_work_key_projection_check;
alter table public.change_proposals
  add constraint change_proposals_work_key_projection_check
  check (terminal_disposition is not null or
    (payload->>'workKey') is not distinct from nullif(payload #>> '{proposal,workKey}', '')) not valid;
alter table public.change_proposals validate constraint change_proposals_work_key_projection_check;
