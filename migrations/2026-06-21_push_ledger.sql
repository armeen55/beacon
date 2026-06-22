-- 2026-06-21 — Durable push ledger (ship-path audit, daily-cap durability).
--
-- Purpose: the per-tenant DAILY PUSH CAP (≤10 live Wix writes/day, Invariant 3)
-- counts a tenant's "pushed" rows for the UTC day. That ledger used to live ONLY
-- in the file store (json-store), which on Vercel writes an in-process cache LOST
-- on lambda recycle — so every cold lambda saw 0 prior pushes and re-allowed the
-- full quota: the cap was structurally FAIL-OPEN in production. This durable
-- table makes the count survive recycles so the cap actually holds.
--
-- Mirrors the wix_publishing_mode / wix_mappings posture: composite PK
-- (tenant_id, id), RLS enabled, one `_tenant_rw` policy TO authenticated,
-- anon default-denied. ADDITIVE new table; src/domains/push/caps.ts ALSO falls
-- back to the file store when Supabase is unavailable (getSupabaseAdmin() no-env
-- throw → file; PostgREST 42P01/PGRST205 → file), so local dev + the pre-apply
-- deploy window behave exactly as before.
--
-- NOT YET APPLIED TO PROD — apply via MCP apply_migration (operator-approved)
-- before arming live Wix publishing; until then the code uses the file fallback.

create table if not exists public.push_ledger (
  tenant_id   text not null,
  id          text not null,
  edit_id     text not null,
  target_url  text not null,
  adapter     text not null,
  pushed_at   timestamptz not null default now(),
  -- UTC day (YYYY-MM-DD) the cap counts against.
  day         date not null,
  result      text not null check (result in ('pushed', 'push_failed')),
  detail      text,
  primary key (tenant_id, id)
);

-- The cap query: count WHERE tenant_id = ? AND day = ? AND result = 'pushed'.
create index if not exists push_ledger_tenant_day_result_idx
  on public.push_ledger (tenant_id, day, result);

alter table public.push_ledger enable row level security;

create policy push_ledger_tenant_rw
  on public.push_ledger
  for all
  to authenticated
  using (is_tenant_member(tenant_id))
  with check (is_tenant_member(tenant_id));
