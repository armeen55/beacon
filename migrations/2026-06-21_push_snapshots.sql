-- 2026-06-21 — Durable pre-push snapshots (ship-path audit, rollback durability).
--
-- Purpose: executePush captures {field, previous_text} BEFORE every live Wix
-- write so a push can be reverted. That snapshot used to live ONLY in the file
-- store (json-store), which on Vercel writes an in-process cache LOST on lambda
-- recycle — so the "fail-closed" snapshot vanished the moment a different lambda
-- served the revert, and the advertised rollback could not restore the prior
-- value. This durable table makes snapshots survive recycles so revert works.
--
-- Mirrors the push_ledger / wix_publishing_mode posture: composite PK
-- (tenant_id, id), RLS enabled, one `_tenant_rw` policy TO authenticated, anon
-- default-denied. ADDITIVE; src/domains/push/push-snapshots.ts ALSO falls back
-- to the file store when Supabase is unavailable (no-env throw / 42P01 /
-- PGRST205), and stays fail-closed: if NEITHER store persists, the push refuses.
--
-- NOT YET APPLIED TO PROD — apply via MCP apply_migration (operator-approved)
-- before arming live Wix publishing; until then the code uses the file fallback.

create table if not exists public.push_snapshots (
  tenant_id          text not null,
  id                 text not null,
  edit_id            text not null,
  target_url         text not null,
  data_collection_id text not null,
  data_item_id       text not null,
  field              text not null,
  previous_text      text not null,
  captured_at        timestamptz not null default now(),
  primary key (tenant_id, id)
);

-- Revert lookup: newest snapshot WHERE tenant_id = ? AND edit_id = ?.
create index if not exists push_snapshots_tenant_edit_captured_idx
  on public.push_snapshots (tenant_id, edit_id, captured_at desc);

alter table public.push_snapshots enable row level security;

create policy push_snapshots_tenant_rw
  on public.push_snapshots
  for all
  to authenticated
  using (is_tenant_member(tenant_id))
  with check (is_tenant_member(tenant_id));
