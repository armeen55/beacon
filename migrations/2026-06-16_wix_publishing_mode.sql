-- 2026-06-16 — Armed publishing mode (per-site one-click publish).
--
-- Purpose: store, per tenant, whether the site is `staged` (the default,
-- review-gated two-click: Accept → Approve & Push) or `armed` (the operator
-- explicitly opted in, so Accept on a SAFE, MAPPED, high-confidence field edit
-- publishes LIVE in one click). Operator directive "Option 1: per-site arming,
-- then 1-click" — informed consent without forcing a second click forever.
--
-- SAFETY: the default (no row) is `staged`. Losing this state (lambda recycle,
-- table absent) fails SAFE back to `staged` — never to an unexpected live
-- write. The structural write authority stays in code (executePush:
-- Ritz hard-refuse, daily cap, snapshot-before-write, field-merge only,
-- non-destructive patch, mapping required); arming only changes ROUTING.
--
-- Mirrors the wix_mappings posture (migrations/2026-06-16_wix_mappings.sql):
-- tenant_id PK, RLS enabled, a single `_tenant_rw` policy TO authenticated,
-- anon default-denied (no anon policy). ADDITIVE new table; the code
-- (src/domains/push/publishing-mode-store.ts) ALSO falls back to the file store
-- when Supabase is unavailable (getSupabaseAdmin() no-env throws → file
-- fallback; PostgREST `42P01` undefined_table → file fallback), so local dev
-- and the pre-apply deploy window keep working (defaulting safely to `staged`).
--
-- APPLIED TO PROD 2026-06-16 via MCP apply_migration (name=wix_publishing_mode),
-- operator-approved. Verified: table exists; columns tenant_id/mode/armed_at/
-- armed_by/updated_at correct; PK (tenant_id); check mode IN (staged,armed);
-- RLS enabled; one tenant_rw policy (is_tenant_member, using+check); 0 rows;
-- security advisor shows NO new lints vs baseline. Recorded here for repo /
-- fresh-env parity. (Project beacon / jdegznovgysxyweknewh.)

create table if not exists public.wix_publishing_mode (
  tenant_id  text not null,
  -- 'staged' (default, two-click) | 'armed' (one-click live publish opted in).
  mode       text not null default 'staged'
             check (mode in ('staged', 'armed')),
  armed_at   timestamptz,
  armed_by   text,
  updated_at timestamptz not null default now(),
  primary key (tenant_id)
);

alter table public.wix_publishing_mode enable row level security;

create policy wix_publishing_mode_tenant_rw
  on public.wix_publishing_mode
  for all
  to authenticated
  using (is_tenant_member(tenant_id))
  with check (is_tenant_member(tenant_id));
