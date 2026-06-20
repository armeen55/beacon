-- GSC Proof ledger — manually-shipped change records + measured outcome (Phase 5, Path B, 2026-06-19).
-- One row per (tenant, shipped change). Stores the before/after, the ship time, a
-- GSC baseline snapshot, the target queries + control pages, and the rolling
-- 7/14/28-day measured outcome (treated-vs-controls click lift) + verdict.
--
-- SEPARATE from the citation proof engine (public.change_outcomes_v2) — its own
-- table, its own verdict enum. This measures Search (GSC) impact of changes the
-- operator shipped MANUALLY (works even when Wix publishing is manual). It never
-- publishes anything.
--
-- Operator-substrate only: RLS enabled with NO policies → denies anon/auth; the
-- server reads/writes via the service-role client (getSupabaseAdmin). Additive +
-- idempotent (create-if-not-exists). The app degrades to a per-tenant file store
-- until this is applied, so a deploy window stays functional.
create table if not exists public.shipped_change_proof (
  tenant_id      text        not null,
  id             text        not null,
  page           text        not null,
  path           text        not null,
  action_type    text        not null,
  before_text    text,
  after_text     text,
  shipped_at     timestamptz not null,
  baseline       jsonb       not null default '{}'::jsonb,
  target_queries jsonb       not null default '[]'::jsonb,
  control_pages  jsonb       not null default '[]'::jsonb,
  windows        jsonb       not null default '[]'::jsonb,
  verdict        text        not null default 'measuring'
                   check (verdict in ('measuring', 'won', 'lost', 'inconclusive', 'insufficient_data')),
  confidence     text        not null default 'low'
                   check (confidence in ('high', 'medium', 'low')),
  measured_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (tenant_id, id)
);

alter table public.shipped_change_proof enable row level security;

-- Per-tenant ledger reads (newest ship first handled in app).
create index if not exists shipped_change_proof_tenant_idx
  on public.shipped_change_proof (tenant_id, shipped_at desc);
