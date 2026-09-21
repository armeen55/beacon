-- Slice 5 onboarding + 50-core-prompt approval flow (2026-07-24).
-- See migrations/2026-07-24_slice5_onboarding.sql in the repo for full context.
-- a. tenants.growth_goal; b. onboarding-openai ledger platform; c. active-only
-- claim guard; d. additive tracked_prompts repair (preflighted: both no-ops today).

alter table public.tenants add column if not exists growth_goal text;
alter table public.tenants drop constraint if exists tenants_growth_goal_check;
alter table public.tenants add constraint tenants_growth_goal_check
  check (growth_goal is null or growth_goal in ('recover', 'grow', 'balanced'));

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

  perform pg_advisory_xact_lock(hashtextextended('research_runs:' || p_tenant_id, 0));

  select * into v_run
    from public.research_runs
   where tenant_id = p_tenant_id
     and status in ('running', 'paused')
   order by started_at desc
   limit 1;

  if found then
    if v_run.lease_owner is not null
       and v_run.lease_owner <> p_owner
       and v_run.lease_expires_at >= now() then
      return;
    end if;

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

  if exists (
    select 1 from public.research_runs
     where tenant_id = p_tenant_id
       and status = 'completed'
       and (completed_at at time zone 'utc')::date = (now() at time zone 'utc')::date
  ) then
    return;
  end if;

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
    return;
  end;
end;
$$;

revoke all on function public.claim_research_run(text, text, int) from public;
revoke all on function public.claim_research_run(text, text, int) from anon;
revoke all on function public.claim_research_run(text, text, int) from authenticated;
grant execute on function public.claim_research_run(text, text, int) to service_role;

update public.tracked_prompts p
   set account_id = p.tenant_id,
       updated_at = now()
  from public.tenants t
 where t.id = p.tenant_id
   and p.account_id <> p.tenant_id
   and p.account_id = t.slug;

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
   );;
