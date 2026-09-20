-- A proposal id is a permanent address for one mutation. Production historically allowed an upsert to replace
-- mutation_key under the same id, including after that row was withdrawn, dismissed or superseded. Shipments and
-- measurement point at (proposal_id, proposal_version), so changing what the id means corrupts the audit chain.

alter table public.change_proposals drop constraint if exists change_proposals_disposition_check;
alter table public.change_proposals add constraint change_proposals_disposition_check
  check (terminal_disposition is null or terminal_disposition in ('dismissed', 'withdrawn', 'superseded', 'settled'));

create table if not exists public.proposal_work_tombstones (
  tenant_id text not null references public.tenants(id) on delete cascade,
  work_key text not null check (work_key <> ''),
  proposal_id text not null,
  disposition text not null check (disposition in ('dismissed', 'withdrawn', 'superseded', 'settled')),
  retired_at timestamptz not null default now(),
  primary key (tenant_id, work_key, proposal_id)
);
create index if not exists proposal_work_tombstones_scan
  on public.proposal_work_tombstones (tenant_id, work_key);
alter table public.proposal_work_tombstones enable row level security;
alter table public.proposal_work_tombstones force row level security;
revoke all on table public.proposal_work_tombstones from public, anon, authenticated;
revoke all on table public.proposal_work_tombstones from service_role;
grant select on table public.proposal_work_tombstones to service_role;

insert into public.proposal_work_tombstones (tenant_id, work_key, proposal_id, disposition, retired_at)
select tenant_id, coalesce(nullif(payload->>'workKey', ''), '__legacy_unkeyed__:' || id), id, terminal_disposition, updated_at
  from public.change_proposals
 where terminal_disposition is not null
on conflict do nothing;

create or replace function public.guard_change_proposal_seat_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  if old.terminal_disposition is null and new.terminal_disposition is not null then
    if new.payload is distinct from old.payload or new.status is distinct from old.status
       or new.proposal_version is distinct from old.proposal_version then
      raise exception 'terminal transition for change proposal % may not rewrite its generation', old.id
        using errcode = '23514';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(
      'proposal-work:' || old.tenant_id || ':' || coalesce(nullif(old.payload->>'workKey', ''), '__legacy_unkeyed__:' || old.id), 0));
    insert into public.proposal_work_tombstones
      (tenant_id, work_key, proposal_id, disposition, retired_at)
    values (old.tenant_id, coalesce(nullif(old.payload->>'workKey', ''), '__legacy_unkeyed__:' || old.id), old.id, new.terminal_disposition, now())
    on conflict do nothing;
  end if;
  if old.mutation_key is distinct from new.mutation_key then
    raise exception 'change proposal seat % is already bound to mutation %, refused %',
      old.id, old.mutation_key, new.mutation_key
      using errcode = '23514';
  end if;
  if old.terminal_disposition is not null and (
       new.terminal_disposition is distinct from old.terminal_disposition
       or new.status is distinct from old.status
       or new.payload is distinct from old.payload
       or new.proposal_version is distinct from old.proposal_version
       or new.withdrawn_reason is distinct from old.withdrawn_reason
       or new.superseded_by is distinct from old.superseded_by
     ) then
    raise exception 'terminal change proposal % is immutable', old.id
      using errcode = '23514';
  end if;
  return new;
end;
$function$;

revoke all on function public.guard_change_proposal_seat_mutation() from public;
revoke all on function public.guard_change_proposal_seat_mutation() from anon;
revoke all on function public.guard_change_proposal_seat_mutation() from authenticated;

drop trigger if exists trg_change_proposal_seat_permanence on public.change_proposals;
create trigger trg_change_proposal_seat_permanence
before update on public.change_proposals
for each row execute function public.guard_change_proposal_seat_mutation();

-- One advisory seat lock makes an absent successor lockable: row locks cannot
-- serialize two writers when the row does not exist yet. A handover is
-- INSERT-only; an already occupied successor is never rewritten here.
create or replace function public.supersede_change_proposal(
  p_tenant_id text, p_predecessors jsonb, p_expected_current jsonb, p_row jsonb
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_pred         public.change_proposals%rowtype;
  v_saved        text;
  v_expected     record;
  v_expected_count integer;
  v_moved integer;
  v_work_key text;
  v_lock_key text;
  v_expected_page jsonb;
  v_current_page jsonb;
begin
  if nullif(p_row->>'id', '') is null or nullif(p_row->>'mutation_key', '') is null
     or jsonb_typeof(p_predecessors) <> 'array' or jsonb_typeof(p_expected_current) <> 'array' then
    return 'failed';
  end if;

  -- The app decides semantic footprint overlap, but the database owns the instant at which that decision becomes
  -- true. Lock and compare the complete current page set before any seat/work lock or mutation. Two writers that
  -- both observed an empty page therefore cannot both land distinct overlapping seats.
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
  -- Take every generation lock before any predecessor row lock. Retirement takes work then row too, so the two
  -- doors can serialize without the predecessor-row/work-lock inversion that would deadlock a dismissal race.
  for v_lock_key in
    select distinct keys.work_key from (
      select v_work_key as work_key
      union all
      select nullif(cp.payload->>'workKey', '')
        from public.change_proposals cp
        join jsonb_to_recordset(p_predecessors) as x(id text, proposal_version integer, status text)
          on x.id = cp.id
       where cp.tenant_id = p_tenant_id
    ) as keys where keys.work_key is not null order by keys.work_key
  loop
    perform pg_advisory_xact_lock(hashtextextended('proposal-work:' || p_tenant_id || ':' || v_lock_key, 0));
  end loop;
  if v_work_key is not null then
    if exists (select 1 from public.proposal_work_tombstones
        where tenant_id = p_tenant_id and work_key = v_work_key) then return 'blocked'; end if;
    if exists (select 1 from public.change_proposals cp
        join jsonb_to_recordset(p_predecessors) as x(id text, proposal_version integer, status text)
          on x.id = cp.id
        where cp.tenant_id = p_tenant_id and cp.payload->>'workKey' = v_work_key) then return 'blocked'; end if;
  end if;

  if exists (
    select 1 from public.change_proposals
     where id = p_row->>'id' and tenant_id <> p_tenant_id
  ) then
    return 'failed';
  end if;

  select count(*) into v_expected_count from jsonb_to_recordset(p_predecessors)
    as x(id text, proposal_version integer, status text);
  if v_expected_count < 1 or v_expected_count <> (
      select count(distinct x.id) from jsonb_to_recordset(p_predecessors)
        as x(id text, proposal_version integer, status text)
    ) then return 'failed'; end if;
  if exists (select 1 from jsonb_to_recordset(p_predecessors)
      as x(id text, proposal_version integer, status text) where x.id = p_row->>'id') then return 'seat_taken'; end if;
  if exists (select 1 from public.change_proposals
      where tenant_id = p_tenant_id and id = p_row->>'id') then
    return 'seat_taken';
  end if;

  -- Deterministic row-lock order prevents two bundles from deadlocking while
  -- they overlap the same atomic cards in opposite orders.
  for v_expected in select * from jsonb_to_recordset(p_predecessors)
      as x(id text, proposal_version integer, status text) order by x.id loop
    select * into v_pred from public.change_proposals
      where tenant_id = p_tenant_id and id = v_expected.id for update;
    if not found or v_pred.terminal_disposition is not null
       or v_pred.status not in ('ready', 'needs_review')
       or v_pred.proposal_version <> v_expected.proposal_version
       or v_pred.status <> v_expected.status then return 'blocked'; end if;
  end loop;

  update public.change_proposals as cp
     set terminal_disposition = 'superseded', superseded_by = p_row->>'id', updated_at = now()
   from jsonb_to_recordset(p_predecessors) as x(id text, proposal_version integer, status text)
   where cp.tenant_id = p_tenant_id and cp.id = x.id
     and cp.proposal_version = x.proposal_version and cp.status = x.status
     and cp.terminal_disposition is null;
  get diagnostics v_moved = row_count;
  if v_moved <> v_expected_count then
    raise exception 'supersede_change_proposal: predecessor set moved during handover';
  end if;

  insert into public.change_proposals
    (id, tenant_id, site, case_id, page_key, action_family, mutation_key, proposal_version, basis,
     status, terminal_disposition, superseded_by, payload, decision_receipt,
     ranking_receipt, updated_at)
  values
    (p_row->>'id', p_tenant_id,
     coalesce(p_row->>'site', ''), coalesce(p_row->>'case_id', ''),
     coalesce(p_row->>'page_key', ''), p_row->>'action_family',
     p_row->>'mutation_key',
     coalesce((p_row->>'proposal_version')::int, 1), p_row->>'basis',
     p_row->>'status', null, null,
     p_row->'payload', p_row->'decision_receipt', p_row->'ranking_receipt',
     coalesce((p_row->>'updated_at')::timestamptz, now()))
  on conflict (id) do nothing
  returning id into v_saved;

  if v_saved is null then
    raise exception 'supersede_change_proposal: successor seat was taken during handover';
  end if;

  return 'saved';
end;
$function$;

revoke all on function public.supersede_change_proposal(text, jsonb, jsonb, jsonb) from public;
revoke all on function public.supersede_change_proposal(text, jsonb, jsonb, jsonb) from anon;
revoke all on function public.supersede_change_proposal(text, jsonb, jsonb, jsonb) from authenticated;
grant execute on function public.supersede_change_proposal(text, jsonb, jsonb, jsonb) to service_role;

-- Funding and proposal production are paused for this migration-first window.
-- Remove the old single-predecessor door outright: it cannot represent an
-- atomic bundle and must fail closed on the previous application SHA.
drop function if exists public.supersede_change_proposal(text, text, jsonb);

-- Ordinary same-seat saves are compare-and-set too. A producer that read vN
-- cannot overwrite an operator flip, dismissal, or successor that landed while
-- it was still composing vN+1.
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
as $function$
declare
  v_saved text;
  v_work_key text;
  v_old_work_key text;
  v_lock_key text;
  v_existing public.change_proposals%rowtype;
  v_expected_page jsonb;
  v_current_page jsonb;
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
  v_old_work_key := case when found then nullif(v_existing.payload->>'workKey', '') else null end;
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
           decision_receipt = p_row->'decision_receipt', ranking_receipt = p_row->'ranking_receipt',
           updated_at = coalesce((p_row->>'updated_at')::timestamptz, now())
     where tenant_id = p_tenant_id and id = p_row->>'id'
       and mutation_key = p_row->>'mutation_key'
       and proposal_version = p_expected_version and status = p_expected_status
       and p_expected_disposition is null and terminal_disposition is null
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

revoke all on function public.save_change_proposal_cas(text, jsonb, boolean, integer, text, text, jsonb) from public;
revoke all on function public.save_change_proposal_cas(text, jsonb, boolean, integer, text, text, jsonb) from anon;
revoke all on function public.save_change_proposal_cas(text, jsonb, boolean, integer, text, text, jsonb) from authenticated;
grant execute on function public.save_change_proposal_cas(text, jsonb, boolean, integer, text, text, jsonb) to service_role;

-- The operator's answer cancels the exact generation they read before changing its row. A redraft carries a new
-- key in p_payload, so the old reservation is retired while the requested successor remains independently fundable.
create or replace function public.answer_change_proposal_review(
  p_tenant_id text, p_id text, p_expected_version integer,
  p_expected_payload jsonb, p_payload jsonb, p_status text
) returns text
language plpgsql security definer set search_path = pg_catalog, public
as $function$
declare
  v_row public.change_proposals%rowtype;
  v_changed integer;
  v_old_work_key text;
  v_new_work_key text;
  v_lock_key text;
begin
  if p_status not in ('needs_review', 'ready') or p_expected_payload is null or p_payload is null then return 'blocked'; end if;
  perform pg_advisory_xact_lock(hashtextextended('proposal-seat:' || p_tenant_id || ':' || p_id, 0));
  select * into v_row from public.change_proposals where tenant_id = p_tenant_id and id = p_id;
  if not found then return 'blocked'; end if;
  v_old_work_key := nullif(v_row.payload->>'workKey', '');
  v_new_work_key := nullif(p_payload->>'workKey', '');
  for v_lock_key in select distinct x from unnest(array[v_old_work_key, v_new_work_key]) as keys(x)
      where x is not null order by x loop
    perform pg_advisory_xact_lock(hashtextextended('proposal-work:' || p_tenant_id || ':' || v_lock_key, 0));
  end loop;
  update public.change_proposals
     set status = p_status, payload = p_payload, proposal_version = proposal_version + 1,
         queue_lane = case when p_status = 'ready' then null else queue_lane end,
         queue_rank = case when p_status = 'ready' then null else queue_rank end,
         updated_at = now()
   where tenant_id = p_tenant_id and id = p_id and proposal_version = p_expected_version
     and status = 'needs_review' and terminal_disposition is null and payload = p_expected_payload;
  get diagnostics v_changed = row_count;
  if v_changed <> 1 then return 'blocked'; end if;
  if v_old_work_key is not null then
    insert into public.proposal_work_tombstones (tenant_id, work_key, proposal_id, disposition, retired_at)
    values (p_tenant_id, v_old_work_key, p_id, 'settled', now()) on conflict do nothing;
  end if;
  return 'answered';
end;
$function$;
revoke all on function public.answer_change_proposal_review(text, text, integer, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.answer_change_proposal_review(text, text, integer, jsonb, jsonb, text) to service_role;

-- Repair is a lifecycle transition, not a direct table patch. Both the final settlement and the exceptional reopen
-- take the same seat/work locks as production and spending before touching the row. A reopen must carry a new work
-- identity, because Mark implemented already retired the generation the operator acted on.
create or replace function public.repair_implemented_change_proposal(
  p_tenant_id text, p_id text, p_expected_version integer, p_expected_payload jsonb,
  p_action text, p_payload jsonb, p_reason text
) returns text
language plpgsql security definer set search_path = pg_catalog, public
as $function$
declare
  v_row public.change_proposals%rowtype;
  v_old_work_key text;
  v_new_work_key text;
  v_lock_key text;
  v_changed integer;
begin
  if p_action not in ('settle', 'reopen') or p_expected_payload is null or p_payload is null then return 'blocked'; end if;
  perform pg_advisory_xact_lock(hashtextextended('proposal-seat:' || p_tenant_id || ':' || p_id, 0));
  select * into v_row from public.change_proposals where tenant_id = p_tenant_id and id = p_id;
  if not found then return 'blocked'; end if;
  v_old_work_key := nullif(v_row.payload->>'workKey', '');
  v_new_work_key := nullif(p_payload->>'workKey', '');
  for v_lock_key in select distinct x from unnest(array[v_old_work_key, v_new_work_key]) as keys(x)
      where x is not null order by x loop
    perform pg_advisory_xact_lock(hashtextextended('proposal-work:' || p_tenant_id || ':' || v_lock_key, 0));
  end loop;
  if p_action = 'reopen' and (v_new_work_key is null or v_new_work_key is not distinct from v_old_work_key
      or exists (select 1 from public.proposal_work_tombstones
          where tenant_id = p_tenant_id and work_key = v_new_work_key)) then return 'blocked'; end if;

  if p_action = 'settle' then
    update public.change_proposals set terminal_disposition = 'settled', withdrawn_reason = p_reason, updated_at = now()
     where tenant_id = p_tenant_id and id = p_id and proposal_version = p_expected_version
       and status = 'implemented_pending_verification' and terminal_disposition is null and payload = p_expected_payload;
  else
    update public.change_proposals set status = 'needs_review', payload = p_payload,
        proposal_version = proposal_version + 1, queue_lane = null, queue_rank = null, updated_at = now()
     where tenant_id = p_tenant_id and id = p_id and proposal_version = p_expected_version
       and status = 'implemented_pending_verification' and terminal_disposition is null and payload = p_expected_payload;
  end if;
  get diagnostics v_changed = row_count;
  if v_changed <> 1 then return 'blocked'; end if;
  if v_old_work_key is not null then
    insert into public.proposal_work_tombstones (tenant_id, work_key, proposal_id, disposition, retired_at)
    values (p_tenant_id, v_old_work_key, p_id, 'settled', now()) on conflict do nothing;
  end if;
  return case when p_action = 'settle' then 'settled' else 'reopened' end;
end;
$function$;
revoke all on function public.repair_implemented_change_proposal(text, text, integer, jsonb, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.repair_implemented_change_proposal(text, text, integer, jsonb, text, jsonb, text) to service_role;

-- Every direct retirement shares the work-key lock with proposal landing, so
-- an operator dismissal that races a paid response either wins and tombstones
-- the exact generation, or loses its stale CAS; it can never be resurrected in
-- a new seat after both operations report success.
create or replace function public.retire_change_proposal(
  p_tenant_id text, p_id text, p_expected_version integer, p_expected_status text,
  p_disposition text, p_superseded_by text, p_reason text
) returns boolean
language plpgsql security definer set search_path = pg_catalog, public
as $function$
declare v_row public.change_proposals%rowtype; v_changed integer; v_work_key text;
begin
  if p_disposition not in ('dismissed', 'withdrawn', 'superseded') then return false; end if;
  select * into v_row from public.change_proposals
   where tenant_id = p_tenant_id and id = p_id;
  if not found then return false; end if;
  v_work_key := nullif(v_row.payload->>'workKey', '');
  if v_work_key is not null then
    perform pg_advisory_xact_lock(hashtextextended('proposal-work:' || p_tenant_id || ':' || v_work_key, 0));
  end if;
  update public.change_proposals set terminal_disposition = p_disposition,
      superseded_by = p_superseded_by, withdrawn_reason = p_reason, updated_at = now()
   where tenant_id = p_tenant_id and id = p_id and proposal_version = p_expected_version
     and status = p_expected_status and terminal_disposition is null
     and status <> 'implemented_pending_verification';
  get diagnostics v_changed = row_count;
  return v_changed = 1;
end;
$function$;
revoke all on function public.retire_change_proposal(text, text, integer, text, text, text, text) from public, anon, authenticated;
grant execute on function public.retire_change_proposal(text, text, integer, text, text, text, text) to service_role;

-- Closing operator work and proving that its Shipment exists are one database
-- decision. A nonempty or even real Shipment id is insufficient: it must name
-- this tenant, this proposal and the exact applied-copy version handed back by
-- the Shipment writer. The row must also still contain byte-for-byte the jsonb
-- payload the operator acted on; an integer version alone is not a copy lock.
create or replace function public.transition_change_proposal_implemented(
  p_tenant_id text,
  p_proposal_id text,
  p_expected_version integer,
  p_expected_status text,
  p_expected_disposition text,
  p_shipment_id text,
  p_shipment_version text,
  p_expected_payload jsonb,
  p_payload jsonb
) returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare v_saved text; v_row public.change_proposals%rowtype; v_work_key text;
begin
  if nullif(p_tenant_id, '') is null or nullif(p_proposal_id, '') is null
     or nullif(p_shipment_id, '') is null or nullif(p_shipment_version, '') is null
     or p_expected_payload is null or p_payload is null then return 'blocked'; end if;

  if not exists (
    select 1 from public.shipped_change_proof
     where tenant_id = p_tenant_id and id = p_shipment_id
       and proposal_id = p_proposal_id and proposal_version = p_shipment_version
       and implemented_at is not null
  ) then return 'shipment_mismatch'; end if;

  select * into v_row from public.change_proposals
   where tenant_id = p_tenant_id and id = p_proposal_id;
  if not found then return 'blocked'; end if;
  v_work_key := nullif(v_row.payload->>'workKey', '');
  if v_work_key is not null then
    perform pg_advisory_xact_lock(hashtextextended('proposal-work:' || p_tenant_id || ':' || v_work_key, 0));
  end if;

  update public.change_proposals
     set status = 'implemented_pending_verification', payload = p_payload,
         terminal_disposition = null, superseded_by = null,
         withdrawn_reason = null, updated_at = now()
   where tenant_id = p_tenant_id and id = p_proposal_id
     and proposal_version = p_expected_version and status = p_expected_status
     and p_expected_disposition is null and terminal_disposition is null
     and payload = p_expected_payload
  returning id into v_saved;

  if v_saved is null then return 'blocked'; end if;
  if v_work_key is not null then
    insert into public.proposal_work_tombstones (tenant_id, work_key, proposal_id, disposition, retired_at)
    values (p_tenant_id, v_work_key, p_proposal_id, 'settled', now()) on conflict do nothing;
  end if;
  return 'implemented';
end;
$function$;

revoke all on function public.transition_change_proposal_implemented(text, text, integer, text, text, text, text, jsonb, jsonb) from public;
revoke all on function public.transition_change_proposal_implemented(text, text, integer, text, text, text, text, jsonb, jsonb) from anon;
revoke all on function public.transition_change_proposal_implemented(text, text, integer, text, text, text, text, jsonb, jsonb) from authenticated;
grant execute on function public.transition_change_proposal_implemented(text, text, integer, text, text, text, text, jsonb, jsonb) to service_role;

-- Queue publication is an intended mutation, but it may not require broad table
-- UPDATE privilege. Serialize on the surface key before reading the expected
-- prior release: a row lock alone cannot protect the cold-start (absent-row)
-- case, and two builders that both read the same prior release must not both
-- publish successfully.
create or replace function public.publish_customer_release(
  p_tenant_id text,
  p_expected_prior text,
  p_release text,
  p_ids text[],
  p_lanes text[],
  p_scope_key text,
  p_store_name text,
  p_content jsonb
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare v_prior text; v_slug text; v_rows integer; v_size integer;
begin
  if nullif(p_tenant_id, '') is null or nullif(p_release, '') is null
     or nullif(p_scope_key, '') is null or nullif(p_store_name, '') is null
     or p_ids is null or p_lanes is null
     or coalesce(array_length(p_ids, 1), 0) <> coalesce(array_length(p_lanes, 1), 0) then
    raise exception 'publish_customer_release: invalid release payload';
  end if;
  select t.slug into v_slug from public.tenants t where t.id = p_tenant_id;
  v_size := coalesce(array_length(p_ids, 1), 0);
  if v_slug is null or p_store_name <> 'customer-surface'
     or p_scope_key <> 'customer-surface::tenant:' || v_slug
     or jsonb_typeof(p_content) <> 'array' or jsonb_array_length(p_content) <> 1
     or jsonb_typeof(p_content->0) <> 'object'
     or p_content->0->>'releaseId' is distinct from p_release
     or p_content->0->>'tenantId' is distinct from p_tenant_id
     or exists (select 1 from unnest(p_lanes) lane where lane not in ('ready', 'todo', 'research')) then
    raise exception 'publish_customer_release: release identity or lane is invalid';
  end if;
  select count(*) into v_rows from public.change_proposals c
   where c.tenant_id = p_tenant_id and c.id = any(p_ids)
     and c.terminal_disposition is null;
  if v_rows <> v_size then
    raise exception 'publish_customer_release: every ranked id must name one current proposal';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('customer-release:' || p_scope_key, 0));
  select content->0->>'releaseId' into v_prior
    from public.json_store_blobs where scope_key = p_scope_key;
  if v_prior is distinct from p_expected_prior then
    raise exception 'release conflict: expected prior %, found %', p_expected_prior, v_prior;
  end if;
  update public.change_proposals set queue_lane = null, queue_rank = null
    where tenant_id = p_tenant_id and queue_lane is not null;
  update public.change_proposals c
     set queue_lane = p_release || '::' || t.lane, queue_rank = t.ord
    from unnest(p_ids, p_lanes) with ordinality as t(id, lane, ord)
   where c.tenant_id = p_tenant_id and c.id = t.id
     and c.terminal_disposition is null;
  get diagnostics v_rows = row_count;
  if v_rows <> v_size then
    raise exception 'publish_customer_release: ranking changed before commit';
  end if;
  insert into public.json_store_blobs(scope_key, store_name, content, updated_at)
    values (p_scope_key, p_store_name, p_content, now())
    on conflict (scope_key) do update
      set content = excluded.content, store_name = excluded.store_name, updated_at = excluded.updated_at;
  return p_release;
end;
$function$;

revoke all on function public.publish_customer_release(text, text, text, text[], text[], text, text, jsonb) from public, anon, authenticated;
grant execute on function public.publish_customer_release(text, text, text, text[], text[], text, text, jsonb) to service_role;

-- Ranking explanation is the only proposal-column refresh that is not a
-- lifecycle transition. It is still compare-and-set against the exact live
-- generation, so a stale ranking pass cannot annotate a replacement or a
-- terminal row.
create or replace function public.refresh_change_proposal_ranking_receipt(
  p_tenant_id text,
  p_id text,
  p_expected_version integer,
  p_expected_status text,
  p_expected_payload jsonb,
  p_ranking_receipt jsonb
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare v_changed integer;
begin
  if nullif(p_tenant_id, '') is null or nullif(p_id, '') is null
     or p_expected_version is null or p_expected_status is null
     or p_expected_payload is null then return false; end if;
  update public.change_proposals
     set ranking_receipt = p_ranking_receipt
   where tenant_id = p_tenant_id and id = p_id
     and proposal_version = p_expected_version
     and status = p_expected_status
     and terminal_disposition is null
     and payload = p_expected_payload;
  get diagnostics v_changed = row_count;
  return v_changed = 1;
end;
$function$;

revoke all on function public.refresh_change_proposal_ranking_receipt(text, text, integer, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.refresh_change_proposal_ranking_receipt(text, text, integer, text, jsonb, jsonb) to service_role;

-- Reads remain available to the server, but every write now enters through one
-- of the narrow SECURITY DEFINER functions above. RLS cannot enforce this
-- boundary for service_role because that role bypasses RLS.
revoke insert, update, delete, truncate, references, trigger
  on table public.change_proposals from anon, authenticated;
revoke all on table public.change_proposals from service_role;
grant select on table public.change_proposals to service_role;

-- Native migration assertions: fail the migration rather than deploy a partial
-- privilege boundary or accidentally recreate either invoker-rights door.
do $assert_boundary$
declare v_role text;
begin
  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    if has_table_privilege(v_role, 'public.change_proposals', 'INSERT')
       or has_table_privilege(v_role, 'public.change_proposals', 'UPDATE')
       or has_table_privilege(v_role, 'public.change_proposals', 'DELETE')
       or has_table_privilege(v_role, 'public.change_proposals', 'TRUNCATE')
       or has_table_privilege(v_role, 'public.change_proposals', 'REFERENCES')
       or has_table_privilege(v_role, 'public.change_proposals', 'TRIGGER') then
      raise exception '% retains direct change_proposals mutation', v_role;
    end if;
  end loop;
  if not has_table_privilege('service_role', 'public.change_proposals', 'SELECT') then
    raise exception 'change_proposals service-role read privilege is missing';
  end if;
  if not coalesce((select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'publish_customer_release'
        and p.pronargs = 8), false)
     or not coalesce((select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'refresh_change_proposal_ranking_receipt'
        and p.pronargs = 6), false) then
    raise exception 'change_proposals narrow mutation function is not SECURITY DEFINER';
  end if;
end;
$assert_boundary$;
