-- Slice 6 integrity closure: basis-scoped durable research state (2026-07-25).
--
-- ADDITIVE. Replaces the funnel's legacy "research-funnel" JSON-store blob with
-- ONE explicit Supabase row per (tenant, onboarding basis). The basis fingerprint
-- (account + domain + confirmed profile + goal + generation version) scopes every
-- tenant-DERIVED research conclusion: a website/profile/goal change mints a new
-- basis, so fresh derived research starts clean while old basis rows remain inert
-- history and the PUBLIC evidence_cache stays reusable across bases and accounts.
--
-- row_version powers optimistic concurrency in the repository (.eq check on
-- update); the Research Run lease already serializes writers, so this is a
-- belt-and-suspenders guard, not a lock.
--
-- SECURITY: server-only. RLS denies anon and authenticated entirely; all access
-- is through the service-role admin client. Apply via MCP (orchestrator only).
-- Idempotent: safe to re-run.

create table if not exists public.research_state (
  tenant_id      text not null,
  basis_tag      text not null,
  schema_version int  not null default 1,
  state          jsonb not null default '{}'::jsonb,
  row_version    int  not null default 1,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (tenant_id, basis_tag)
);

alter table public.research_state enable row level security;
drop policy if exists deny_all on public.research_state;
create policy deny_all on public.research_state
  as permissive for all to anon, authenticated
  using (false) with check (false);
