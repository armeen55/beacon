-- Confirmation reads (Lane P2, protocol Section 4.2 repeated-looks structure).
--
-- WHY: the verdict enum is set exactly ONCE at the 28 day primary close. Later
-- windows (7/14 context, 56 demote-only, 84 context) are re-read on every load,
-- and each read must be recorded WITHOUT ever mutating a prior read or the
-- verdict. A mutable jsonb column would let a later look silently overwrite an
-- earlier one; an append-only table keyed by (tenant, proof, window,
-- computation_version) cannot. Idempotent upsert on that key means a re-run of
-- the same window under the same computation version is a no-op (first result
-- wins), which is what closes operator Decision 4's concurrency requirement: the
-- nightly measure pass, an on-use re-measure, and a manual "Measure now" can all
-- race the same (proof, window) and never produce two conflicting rows.
--
-- ADDITIVE + tenant-scoped. Mirrors the RLS posture of the sibling per-tenant
-- table migrations/2026-07-11_refresh_runs.sql: deny anon entirely, authenticated
-- access gated to tenant members via is_tenant_member(tenant_id). Service-role
-- writes (the measure/classifier paths) bypass RLS as usual. The store
-- (src/domains/proof-gsc/confirmation-reads-store.ts) fails soft to a file mirror
-- until this is applied (PGRST205 / 42P01), so deploy order (code before
-- migration) never breaks a measurement pass.

create table if not exists public.confirmation_reads (
  tenant_id            text not null,
  proof_id             text not null,
  window_days          integer not null,
  computation_version  text not null,
  read_at              timestamptz not null default now(),
  result               jsonb not null,
  primary key (tenant_id, proof_id, window_days, computation_version)
);

-- The per-proof read history (all windows for one shipped change) and the
-- per-tenant sweep both key off (tenant_id, proof_id).
create index if not exists confirmation_reads_tenant_proof_idx
  on public.confirmation_reads (tenant_id, proof_id);

alter table public.confirmation_reads enable row level security;

drop policy if exists deny_anon on public.confirmation_reads;
create policy deny_anon on public.confirmation_reads
  as permissive for all to anon
  using (false) with check (false);

drop policy if exists tenant_authenticated_rw on public.confirmation_reads;
create policy tenant_authenticated_rw on public.confirmation_reads
  as permissive for all to authenticated
  using (is_tenant_member(tenant_id))
  with check (is_tenant_member(tenant_id));
