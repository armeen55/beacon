-- 2026-08-03  Daily AI tracking runs every calendar day, with or without a visit.
--
-- WHY. Research only ever advanced because somebody opened the app: every pass was claimed
-- inside a request (src/domains/runtime/ops/on-visit-refresh.ts). An operator who did not
-- visit on Tuesday simply had no Tuesday reading, and the product promises a daily one. One
-- global pg_cron job (configured separately at the hosted approval) POSTs through pg_net to
-- ONE guarded non-customer endpoint, and that endpoint drives the SAME canonical cycle a
-- visit drives. This function is the only new database mechanism it needs: enumerate the
-- accounts whose current Pacific day still owes work, and claim them through the EXISTING
-- claim_research_run so the one-open-run index and the per-account advisory lock stay the
-- single mechanism deciding who advances a run.
--
-- TWO ADDITIVE CHANGES, no data touched, forward-only, idempotent:
--   1. tenants.research_paused - the operator's own off switch for daily research. It is a
--      SEPARATE column on purpose: tenants.status is the account lifecycle (pending / active /
--      paused / cancelled) and overloading it would suspend the whole account to stop a
--      nightly run. Default false, so every existing account keeps running.
--   2. claim_due_research_work(p_owner, p_limit, p_lease_seconds) - the fleet enumeration.
--
-- WHAT COUNTS AS DUE, per account, in the one reporting timezone the product speaks:
--   * no run has COMPLETED during the current America/Los_Angeles day (the identical
--     predicate shape claim_research_run itself uses), or
--   * a run is open and nobody is driving it (paused, or running with an expired/absent
--     lease). A running row under a LIVE lease is somebody else's work and is left alone.
--
-- SAFE UNDER DUPLICATE CONCURRENT INVOCATION. Two dispatchers firing at once both call
-- claim_research_run per account; that function takes a per-account advisory transaction lock
-- and refuses a foreign live lease, and the partial unique index research_runs_one_open_per_tenant
-- allows at most one unfinished run per account regardless. The loser simply gets zero rows
-- for that account and its receipt says so.
--
-- FAIRNESS. Accounts are ordered by how long they have gone without a run starting, oldest
-- first, so a bounded per-invocation limit rotates the fleet instead of always serving the
-- same alphabetical head.
--
-- NOT YET APPLIED TO PROD - apply via MCP apply_migration (operator-approved). Idempotent.

alter table public.tenants
  add column if not exists research_paused boolean not null default false;

comment on column public.tenants.research_paused is
  'Operator switch for the daily research run. True = the scheduler and the visit path both skip this account. Distinct from status: an account can be fully active with research paused. Resume never backfills a missed day.';

create or replace function public.claim_due_research_work(
  p_owner         text,
  p_limit         int,
  p_lease_seconds int
) returns setof public.research_runs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant  text;
  v_claimed int := 0;
begin
  if p_limit is null or p_limit < 1 then
    return;
  end if;

  for v_tenant in
    select t.id
      from public.tenants t
     where t.status = 'active'
       and coalesce(t.research_paused, false) = false
       and (
         not exists (
           select 1 from public.research_runs r
            where r.tenant_id = t.id
              and r.status = 'completed'
              and (r.completed_at at time zone 'America/Los_Angeles')::date
                = (now() at time zone 'America/Los_Angeles')::date
         )
         or exists (
           select 1 from public.research_runs r
            where r.tenant_id = t.id
              and (r.status = 'paused'
                   or (r.status = 'running'
                       and (r.lease_owner is null or r.lease_expires_at < now())))
         )
       )
     order by (select max(r2.started_at) from public.research_runs r2 where r2.tenant_id = t.id)
              asc nulls first, t.id
  loop
    exit when v_claimed >= p_limit;
    -- The claim itself stays the ONE mechanism: same advisory lock, same resume-first rule,
    -- same refusal on a foreign live lease, same one-open-run index. Zero rows back means
    -- another dispatcher (or a visit) already holds that account, and this one moves on.
    return query select * from public.claim_research_run(v_tenant, p_owner, p_lease_seconds);
    if found then
      v_claimed := v_claimed + 1;
    end if;
  end loop;
end;
$$;

-- SECURITY DEFINER with no tenant argument at all: it enumerates the fleet, so it must never
-- be reachable from a browser-shipped key. Only the server's service role may dispatch work.
revoke all on function public.claim_due_research_work(text, int, int) from public;
revoke all on function public.claim_due_research_work(text, int, int) from anon;
revoke all on function public.claim_due_research_work(text, int, int) from authenticated;
grant execute on function public.claim_due_research_work(text, int, int) to service_role;
