-- Slice 5 onboarding + 50-core-prompt approval flow (2026-07-24).
--
-- ADDITIVE follow-on to the Slice 4 Research Run migrations (all immutable). It
-- carries four independent, idempotent changes onboarding needs, and nothing
-- else. Do NOT apply from an agent; the orchestrator applies it. Safe to re-run.
--
-- SECURITY: unchanged posture. The claim function stays SECURITY DEFINER,
-- tenant-scoped by its explicit p_tenant_id argument, revoked from public / anon
-- / authenticated, granted to service_role only.
--
--   a. tenants.growth_goal            - the account's chosen goal (Step 4).
--   b. llm_budget_ledger platform     - add 'onboarding-openai' so the $2
--                                       pre-activation lifetime cap can track
--                                       onboarding spend in the durable ledger.
--   c. claim_research_run             - fail closed unless the account is active,
--                                       so no research work runs before activation.
--   d. data repair                    - additive ownership fix + deactivation of
--                                       provably-obsolete pre-approval seed rows.

-- ─────────────────────────────────────────────────────────────────────────────
-- a. tenants.growth_goal: the account's chosen goal.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.tenants add column if not exists growth_goal text;
alter table public.tenants drop constraint if exists tenants_growth_goal_check;
alter table public.tenants add constraint tenants_growth_goal_check
  check (growth_goal is null or growth_goal in ('recover', 'grow', 'balanced'));

-- ─────────────────────────────────────────────────────────────────────────────
-- b. Widen the llm_budget_ledger platform CHECK to allow 'onboarding-openai'.
--    Mirrors 2026-06-25_dataforseo_budget_platform.sql. Additive, no data lost.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.llm_budget_ledger drop constraint if exists llm_budget_ledger_platform_chk;
alter table public.llm_budget_ledger add constraint llm_budget_ledger_platform_chk
  check (platform = any (array[
    'perplexity'::text,
    'openai'::text,
    'adjudicator-openai'::text,
    'onboarding-openai'::text,
    'dataforseo-serp'::text,
    'other'::text
  ]));

-- ─────────────────────────────────────────────────────────────────────────────
-- c. claim_research_run: fail closed unless the account is active.
--    Byte-equivalent to 2026-07-24_research_runs_claim_semantics.sql EXCEPT for
--    the leading active-account guard. The advisory lock, resume-first logic,
--    same-day-completed block, database-time insert, unique_violation swallow,
--    revokes, and the service_role grant are all preserved exactly.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.claim_research_run(
  p_tenant_id     text,
  p_owner         text,
  p_lease_seconds int
) returns setof public.research_runs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run   public.research_runs%rowtype;
begin
  -- FAIL CLOSED unless the account is active. No research work (paid or
  -- otherwise) runs before activation. A missing or non-active account claims
  -- nothing, so onboarding never starts a recurring research pass.
  if not exists (
    select 1 from public.tenants t
     where t.id = p_tenant_id
       and t.status = 'active'
  ) then
    return;
  end if;

  -- Serialize the find-or-create decision per account so two concurrent visits
  -- cannot both decide "no open run exists" and both insert. The partial unique
  -- index is the durable invariant regardless; this just avoids a lost race.
  perform pg_advisory_xact_lock(hashtextextended('research_runs:' || p_tenant_id, 0));

  -- Find the single unfinished run for the account, regardless of cycle_key or
  -- start date. This is what fixes the cross-day duplicate-run bug: yesterday's
  -- paused/running run is resumed, never ignored.
  select * into v_run
    from public.research_runs
   where tenant_id = p_tenant_id
     and status in ('running', 'paused')
   order by started_at desc
   limit 1;

  if found then
    -- A foreign, still-live lease means another invocation is actively driving
    -- this run: do not disturb it, and never create a second run.
    if v_run.lease_owner is not null
       and v_run.lease_owner <> p_owner
       and v_run.lease_expires_at >= now() then
      return;
    end if;

    -- Otherwise the run is unleased, its lease expired, it is paused, or it is
    -- already ours: claim THAT row. id, cycle_key, current_phase, phase_cursor,
    -- progress, and last_error are all preserved (last_error clears only on a
    -- later successful finish_research_run).
    return query
    update public.research_runs r
       set lease_owner      = p_owner,
           lease_expires_at  = now() + make_interval(secs => p_lease_seconds),
           status            = case when r.status = 'paused' then 'running' else r.status end,
           updated_at        = now()
     where r.id = v_run.id
       and r.status in ('running', 'paused')
    returning r.*;
    return;
  end if;

  -- No unfinished run exists. If a run already completed during the current UTC
  -- day, research is current for today: do no redundant same-day maintenance pass.
  if exists (
    select 1 from public.research_runs
     where tenant_id = p_tenant_id
       and status = 'completed'
       and (completed_at at time zone 'utc')::date = (now() at time zone 'utc')::date
  ) then
    return;
  end if;

  -- Otherwise start today's cycle, with the cycle_key computed at DATABASE time.
  -- The begin/exception guard covers both the (tenant, cycle_key) unique index and
  -- the new partial unique index under any race the advisory lock did not serialize.
  begin
    return query
    insert into public.research_runs
      (tenant_id, cycle_key, status, current_phase, lease_owner, lease_expires_at)
    values
      (p_tenant_id,
       p_tenant_id || ':' || to_char(now() at time zone 'utc', 'YYYY-MM-DD'),
       'running', 'refresh_sources', p_owner,
       now() + make_interval(secs => p_lease_seconds))
    returning research_runs.*;
  exception when unique_violation then
    return; -- a concurrent visit already created today's cycle or an open run
  end;
end;
$$;

revoke all on function public.claim_research_run(text, text, int) from public;
revoke all on function public.claim_research_run(text, text, int) from anon;
revoke all on function public.claim_research_run(text, text, int) from authenticated;
grant execute on function public.claim_research_run(text, text, int) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- d. Data repair. Additive updates only; NO deletes.
--
--    Preflight queries used to size this before applying (read-only):
--      -- rows whose ownership is provable because account_id equals the owning
--      -- tenant's slug (the old launch-flow bug wrote account_id = tenant.slug):
--      select count(*) from public.tracked_prompts p
--        join public.tenants t on t.id = p.tenant_id
--       where p.account_id <> p.tenant_id and p.account_id = t.slug;
--      -- provably-obsolete pre-approval seeds on accounts that never activated:
--      select count(*) from public.tracked_prompts p
--        join public.tenants t on t.id = p.tenant_id
--       where t.status = 'pending_onboarding' and p.is_active = true
--         and (p.tags ? 'starter_v0' or exists (
--           select 1 from jsonb_array_elements_text(p.tags) tg where tg like 'seed\_%'));
-- ─────────────────────────────────────────────────────────────────────────────

-- (1) Repair ONLY rows whose ownership is provable: account_id currently equals
--     the owning tenant's slug (the retired launch-flow / url-first bug), so we
--     can safely rewrite account_id to the canonical tenant id. Anything
--     ambiguous is left untouched.
update public.tracked_prompts p
   set account_id = p.tenant_id,
       updated_at = now()
  from public.tenants t
 where t.id = p.tenant_id
   and p.account_id <> p.tenant_id
   and p.account_id = t.slug;

-- (2) Deactivate provably-obsolete pre-approval seeds: active rows on accounts
--     that never finished onboarding whose tags mark them as starter/seed rows.
--     Nothing is deleted; the row simply stops being tracked.
update public.tracked_prompts p
   set is_active = false,
       updated_at = now()
  from public.tenants t
 where t.id = p.tenant_id
   and t.status = 'pending_onboarding'
   and p.is_active = true
   and (
     p.tags ? 'starter_v0'
     or exists (
       select 1 from jsonb_array_elements_text(p.tags) tg where tg like 'seed\_%'
     )
   );
