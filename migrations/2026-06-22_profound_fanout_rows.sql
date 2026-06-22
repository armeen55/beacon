-- 2026-06-22 — Profound Query Fanouts capture (Iranopedia AEO wedge).
--
-- The /v1/reports/query-fanouts report is brand-agnostic: it returns the hidden
-- sub-queries an AI engine expands each tracked PROMPT into, regardless of which
-- brand the workspace tracks. For Iranopedia these sub-queries ARE the exact
-- answer-blocks / FAQs to add per page — Beacon's #1 AEO lever.
--
-- We store the DECODED dims + mets as JSONB (not narrow typed columns) on
-- purpose: Profound's fanout response field names aren't fully documented, so
-- capturing the raw envelope means a first real pull can't silently lose a
-- field — the mapper (summarizeFanouts) reads it defensively, and we can re-map
-- from stored rows WITHOUT re-spending the API. Replace-per-(tenant,category)
-- semantics on each pull (delete-then-insert), so there's no fragile jsonb PK.
--
-- Mirrors profound_citation_rows / profound_visibility_rows posture: RLS on,
-- one tenant_rw policy TO authenticated, anon denied. src/.../sync-nightly.ts
-- treats a missing table (42P01/PGRST205) as "not provisioned" and skips
-- fail-soft, so the deploy is safe before this is applied.
--
-- NOT YET APPLIED TO PROD — apply via MCP apply_migration (operator-approved).
-- Idempotent.

create table if not exists public.profound_fanout_rows (
  id           bigint generated always as identity primary key,
  tenant_id    text not null,
  category_id  text not null,
  pulled_at    timestamptz not null default now(),
  -- The full decoded envelope row: dims (date/prompt/query/model/region/…) and
  -- mets (total_fanouts/fanouts_per_execution/share/…). Field names are read
  -- defensively downstream.
  dims         jsonb not null default '{}'::jsonb,
  mets         jsonb not null default '{}'::jsonb
);

create index if not exists profound_fanout_rows_tenant_cat_idx
  on public.profound_fanout_rows (tenant_id, category_id);

alter table public.profound_fanout_rows enable row level security;

create policy profound_fanout_rows_tenant_rw
  on public.profound_fanout_rows
  for all
  to authenticated
  using (is_tenant_member(tenant_id))
  with check (is_tenant_member(tenant_id));
