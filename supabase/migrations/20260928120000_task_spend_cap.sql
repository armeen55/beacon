-- A task approval is an additional tenant-wide ceiling. The account's daily
-- limit and every existing platform/global/cohort limit remain in force.
alter table public.tenants
  add column task_spend_cap_usd numeric(12,6),
  add column task_spend_since timestamptz,
  add constraint tenants_task_spend_pair check (
    (task_spend_cap_usd is null and task_spend_since is null)
    or (task_spend_cap_usd >= 0 and task_spend_since is not null)
  );

-- Both paid transports already pass through reserve_spend and
-- claim_spend_transmission. Their existing tenant advisory lock serializes this
-- check across providers, workers and Pacific-day rollover. A trigger keeps
-- replay and free collection on those same canonical RPCs without rewriting
-- their immutable migration definitions or adding another spending path.
create function public.enforce_task_spend_cap()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_cap numeric;
  v_since timestamptz;
  v_used numeric;
  v_exclude text;
begin
  if tg_op = 'UPDATE' then
    if old.state <> 'reserved' or new.state not in ('transmitted', 'ambiguous') then return new; end if;
    v_exclude := old.attempt_id;
  elsif new.state <> 'reserved' then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('spend:' || new.tenant_id, 0));
  select task_spend_cap_usd, task_spend_since into v_cap, v_since
    from public.tenants where id = new.tenant_id for share;
  if not found then
    raise exception using errcode = 'P0001', message = 'task_spend_policy_unreadable';
  end if;
  if v_cap is null and v_since is null then return new; end if;
  if v_cap is null or v_since is null or v_since > now() then
    raise exception using errcode = 'P0001', message = 'task_spend_policy_unreadable';
  end if;
  -- A free reservation and the proof admission claim buy no provider work.
  -- Other zero-estimate transmissions cannot bypass a capped paid transport.
  if new.estimated_usd = 0 then
    if tg_op = 'INSERT' then return new; end if;
    if new.platform = 'other' and new.purpose = 'atomic_proof_admission' then return new; end if;
    raise exception using errcode = 'P0001', message = 'task_spend_cap_refused';
  end if;

  -- Reconciled rows carry actual/usage-estimated charges; unresolved rows keep
  -- their full reservation. Older unresolved attempts are included because an
  -- approval cannot make a request already in flight disappear from exposure.
  select coalesce(sum(case when r.state = 'reconciled'
      then r.accounted_usd else r.estimated_usd end), 0) into v_used
    from public.spend_reservations r
   where r.tenant_id = new.tenant_id
     and r.state in ('reserved', 'transmitted', 'ambiguous', 'reconciled')
     and (r.created_at >= v_since or r.transport_started_at >= v_since
       or r.state in ('reserved', 'transmitted', 'ambiguous'))
     and (v_exclude is null or r.attempt_id <> v_exclude);
  if v_used >= v_cap or v_used + new.estimated_usd > v_cap then
    raise exception using errcode = 'P0001', message = 'task_spend_cap_refused';
  end if;
  return new;
end;
$$;

create trigger spend_reservations_task_cap
before insert or update of state on public.spend_reservations
for each row execute function public.enforce_task_spend_cap();

revoke all on function public.enforce_task_spend_cap() from public, anon, authenticated, service_role;
