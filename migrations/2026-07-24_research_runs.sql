-- Durable visit-driven Research Runs (Slice 4, 2026-07-24).
--
-- WHY: the on-visit maintenance cycle (src/domains/runtime/ops/on-visit-refresh.ts)
-- was a fire-and-forget after() with a per-process `const scheduled = new Set()`
-- (worthless across Vercel instances) and a Pacific-day warm receipt as its only
-- durable state. A crash or lambda timeout mid-cycle lost all progress, and two
-- instances could both run the work. This table makes the cycle a DURABLE,
-- resumable Research Run: one row per (tenant, cycle_key = "<tenant>:<UTC day>"),
-- a leased owner so exactly one invocation advances it at a time, an explicit
-- phase + cursor so a crash resumes at the phase it left off, and evidence-based
-- progress counters. The DATABASE lease is the correctness mechanism; there is no
-- scheduler, cron, heartbeat, or job queue.
--
-- SEMANTICS: an existing COMPLETED row for today's cycle_key makes the claim
-- return empty (research is current for today), so a re-visit does no duplicate
-- work; source-specific staleness still governs tomorrow's phases. running/paused
-- rows are re-claimable when the lease is unheld, expired, or already ours.
--
-- ADDITIVE + tenant-scoped. Mirrors the RLS posture of the sibling per-tenant
-- tables (migrations/2026-07-18_autonomous_run_claims.sql,
-- 2026-07-11_refresh_runs.sql): deny anon entirely, authenticated may only SELECT
-- rows for tenants it belongs to via is_tenant_member(tenant_id). All writes go
-- through the service-role admin client (which bypasses RLS) and the claim
-- function below. The store fails soft (no background work) until this is applied,
-- so deploy order (code before migration) never breaks a render.
--
-- NOT YET APPLIED TO PROD - apply via MCP apply_migration (operator-approved).
-- Idempotent: safe to re-run.

create table if not exists public.research_runs (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      text not null references public.tenants(id),
  cycle_key      text not null,                                  -- "<tenant_id>:<UTC yyyy-mm-dd>": the permitted daily opportunity
  status         text not null check (status in ('running','paused','completed','failed')),
  current_phase  text not null check (current_phase in ('refresh_sources','gsc_backfill_chunk','publish_surface','done')),
  phase_cursor   jsonb,
  progress       jsonb not null default '{}'::jsonb,             -- evidence-based counters only
  spend_usd      numeric not null default 0,                     -- accumulator for future paid phases (unused now)
  last_error     jsonb,
  lease_owner    text,
  lease_expires_at timestamptz,
  started_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  completed_at   timestamptz
);

-- One live cycle per (tenant, UTC day). A completed/failed row for the key blocks
-- re-creation, so "research is current today" is enforced by the unique index.
create unique index if not exists research_runs_cycle
  on public.research_runs (tenant_id, cycle_key);
-- Newest-first per tenant: the Today status line reads the latest row.
create index if not exists research_runs_latest
  on public.research_runs (tenant_id, started_at desc);

alter table public.research_runs enable row level security;

drop policy if exists deny_anon on public.research_runs;
create policy deny_anon on public.research_runs
  as permissive for all to anon
  using (false) with check (false);

-- Authenticated members may READ their tenant's runs (the Today status line, if
-- ever read with the anon key). All writes are service-role only.
drop policy if exists tenant_authenticated_select on public.research_runs;
create policy tenant_authenticated_select on public.research_runs
  as permissive for select to authenticated
  using (is_tenant_member(tenant_id));

-- Atomic claim/create for one (tenant, cycle_key), using DATABASE time and a
-- unique owner token. Returns the claimed row, or NO ROWS when the caller did not
-- win (a foreign unexpired lease, or a completed/failed cycle for today). The
-- caller treats an empty result as "no claim - do nothing".
create or replace function public.claim_research_run(
  p_tenant_id     text,
  p_cycle_key     text,
  p_owner         text,
  p_lease_seconds int
) returns setof public.research_runs
language plpgsql
security definer
set search_path = public
as $$
begin
  -- 1) Reclaim/claim the existing cycle row when it is unclaimed, its lease has
  --    expired, or it is already ours - and it is not finished.
  return query
  update public.research_runs r
     set lease_owner = p_owner,
         lease_expires_at = now() + make_interval(secs => p_lease_seconds),
         status = case when r.status = 'paused' then 'running' else r.status end,
         updated_at = now()
   where r.tenant_id = p_tenant_id
     and r.cycle_key = p_cycle_key
     and r.status in ('running','paused')
     and (r.lease_owner is null or r.lease_expires_at < now() or r.lease_owner = p_owner)
  returning r.*;
  if found then
    return;
  end if;

  -- 2) Create today's cycle if none exists. A completed/failed row for the key
  --    blocks this via the unique index → the caller gets no rows and does
  --    nothing (research is current for today).
  begin
    return query
    insert into public.research_runs
      (tenant_id, cycle_key, status, current_phase, lease_owner, lease_expires_at)
    values
      (p_tenant_id, p_cycle_key, 'running', 'refresh_sources', p_owner,
       now() + make_interval(secs => p_lease_seconds))
    returning research_runs.*;
  exception when unique_violation then
    return; -- someone else holds/completed today's cycle
  end;
end;
$$;

-- SECURITY DEFINER + tenant-scoped by the explicit p_tenant_id arg (the app calls
-- it with the service-role admin client, which bypasses RLS). Deny direct
-- anon/authenticated execution - only the server may claim a Research Run.
revoke all on function public.claim_research_run(text, text, text, int) from public;
revoke all on function public.claim_research_run(text, text, text, int) from anon;
revoke all on function public.claim_research_run(text, text, text, int) from authenticated;

-- Belt and suspenders (adversarial review 2026-07-24): make the service-role
-- grant explicit rather than relying on default privileges. Without EXECUTE the
-- claim would fail closed forever (no run ever starts) with no crash to notice.
grant execute on function public.claim_research_run(text, text, text, int) to service_role;
