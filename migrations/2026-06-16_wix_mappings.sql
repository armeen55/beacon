-- 2026-06-16 — MAX_SEO_AEO audit P0 PHASE 1: durable Wix mappings.
--
-- Purpose: move the Wix url-map + Wix collection config OUT of ephemeral
-- file storage (`.data/*.json` via json-store) INTO durable, tenant-scoped
-- Supabase tables. On Vercel the file store only updates an in-process
-- cache (lost on lambda recycle), so a connected tenant's collection
-- mappings + derived url-map were EPHEMERAL — blocking safe Wix publishing
-- (the push service resolves a card's target_url through the url-map before
-- any write; an empty map means every field-edit card refuses).
--
-- Audit refs: #1 (durable tenant-scoped mappings), #301, #454, #453, #492.
--
-- Mirrors the connector_tokens posture (migrations/2026-05-16_connector_tokens.sql):
-- composite primary key threading tenant_id, RLS enabled, a single
-- `_tenant_rw` policy TO authenticated, anon default-denied (no anon policy).
-- The PK already indexes tenant_id, so the tenant-scoped reads are covered.
--
-- APPLIED TO PROD via MCP apply_migration (name=wix_mappings) on 2026-06-16,
-- with operator approval. Verified: both tables RLS-enabled, one tenant_rw
-- policy each, content_field_roles jsonb present; security advisor shows no new
-- lints from these tables. (Recorded here for repo/fresh-env parity.)
-- These are ADDITIVE new tables; the code
-- (src/lib/connectors/wix/mappings-store.ts) ALSO falls back to the file store
-- when Supabase is unavailable: getSupabaseAdmin() with no env throws → file
-- fallback; PostgREST `42P01` undefined_table → file fallback. So local dev
-- (no Supabase env) keeps today's behavior; the hosted app uses these tables.

-- ── Per-collection mapping config (operator-edited on /diagnostics/wix) ──
create table if not exists public.wix_collection_config (
  tenant_id          text not null,
  data_collection_id text not null,
  slug_field         text not null,
  url_prefix         text not null,
  label_field        text,
  -- Operator-configured page-ROLE → CMS-FIELD map ({title?,heading?,
  -- description?}) that enables LIVE content push (deriveWixContentFieldKey).
  -- jsonb, nullable; UNSET → those edits stay paste-ready (today's behavior).
  content_field_roles jsonb,
  updated_at         timestamptz not null default now(),
  primary key (tenant_id, data_collection_id)
);

-- ── Derived url → CMS (collection, item) map (rebuilt on operator sync) ──
create table if not exists public.wix_url_map (
  tenant_id          text not null,
  url                text not null,
  data_collection_id text not null,
  data_item_id       text not null,
  slug_field         text not null,
  label              text,
  synced_at          timestamptz not null default now(),
  primary key (tenant_id, url)
);

-- ── RLS: tenant-scoped read/write to authenticated; anon default-denied ──
alter table public.wix_collection_config enable row level security;
alter table public.wix_url_map           enable row level security;

create policy wix_collection_config_tenant_rw
  on public.wix_collection_config
  for all
  to authenticated
  using (is_tenant_member(tenant_id))
  with check (is_tenant_member(tenant_id));

create policy wix_url_map_tenant_rw
  on public.wix_url_map
  for all
  to authenticated
  using (is_tenant_member(tenant_id))
  with check (is_tenant_member(tenant_id));
