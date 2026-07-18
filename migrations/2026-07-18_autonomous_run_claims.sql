-- Autonomous run claims (cross-instance atomic daily lock for the on-visit
-- autonomous research cycle).
--
-- WHY: the post-response autonomous cycle (src/domains/ops/on-visit-refresh.ts)
-- is scheduled from the (shell) layout on every navigation. Its only guards were
-- a per-process `const scheduled = new Set()` (worthless across Vercel instances)
-- and a read-then-write daily receipt check with two awaited network calls in
-- between - so two concurrent requests on different lambdas could both pass the
-- check and both run the PAID pipeline (DataForSEO + LLM). This table is the
-- cross-instance mutual-exclusion lock: an INSERT of (tenant_id, day_key) is
-- atomic, so exactly one instance wins the day's cycle and every concurrent
-- request loses on the unique-violation and exits quietly.
--
-- LIFECYCLE (see autonomous-run-claim.ts): the row is a short-lived lock held
-- only for the duration of one owning instance's cycle. The winner releases it
-- (DELETE) in a finally, whatever the outcome. Daily idempotency ("a successful
-- pass does not rerun today") is enforced by the durable warm receipt
-- (shouldRunAutonomousResearch), NOT by this row - so releasing on success is
-- correct and a failed run can still retry after its cooldown (the receipt
-- gates that), while the row guarantees no two instances run the paid pipeline
-- at the same time.
--
-- ADDITIVE + tenant-scoped. Matches the RLS posture of the sibling per-tenant
-- tables (migrations/2026-07-11_refresh_runs.sql, 2026-07-13_confirmation_reads.sql):
-- deny anon entirely, authenticated access gated to tenant members via
-- is_tenant_member(tenant_id). Service-role writes (the on-visit cycle) bypass
-- RLS as usual. The store fails soft to its in-memory + receipt behavior until
-- this is applied (PGRST205 / 42P01), so deploy order (code before migration)
-- never breaks the product.

create table if not exists public.autonomous_run_claims (
  tenant_id   text not null,
  day_key     text not null,
  claimed_at  timestamptz not null default now(),
  primary key (tenant_id, day_key)
);

alter table public.autonomous_run_claims enable row level security;

drop policy if exists deny_anon on public.autonomous_run_claims;
create policy deny_anon on public.autonomous_run_claims
  as permissive for all to anon
  using (false) with check (false);

drop policy if exists tenant_authenticated_rw on public.autonomous_run_claims;
create policy tenant_authenticated_rw on public.autonomous_run_claims
  as permissive for all to authenticated
  using (is_tenant_member(tenant_id))
  with check (is_tenant_member(tenant_id));
