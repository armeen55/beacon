-- 2026-06-12 — Insight Graph slice 1: GSC Search Analytics storage.
--
-- Per-tenant daily Search Analytics rows (page+query grain) + the
-- ungrouped per-day property totals. The grouped rows feed per-page
-- recommendation signals (high-impressions/low-CTR → title/meta);
-- the totals row exists because Google DROPS rows on grouped queries
-- ("our system may drop some data") — storing the ungrouped truth
-- makes the undercount measurable.
--
-- Sync contract (see src/lib/connectors/gsc/sync-search-analytics.ts):
-- day-sliced pulls (Google's recommendation), 25k-row pagination,
-- idempotent UPSERTs on the PK, re-pull window so late-finalizing
-- days self-heal. Dates are Search Console dates (Pacific Time).
--
-- ADDITIVE ONLY — no existing table is touched.

create table if not exists gsc_daily_rows (
  tenant_id text not null,
  property text not null,
  date date not null,
  page text not null,
  query text not null,
  clicks integer not null default 0,
  impressions integer not null default 0,
  ctr double precision not null default 0,
  position double precision not null default 0,
  is_final boolean not null default true,
  pulled_at timestamptz not null default now(),
  primary key (tenant_id, property, date, page, query)
);

create index if not exists gsc_daily_rows_tenant_page_idx
  on gsc_daily_rows (tenant_id, page, date desc);

create table if not exists gsc_daily_totals (
  tenant_id text not null,
  property text not null,
  date date not null,
  clicks integer not null default 0,
  impressions integer not null default 0,
  ctr double precision not null default 0,
  position double precision not null default 0,
  is_final boolean not null default true,
  pulled_at timestamptz not null default now(),
  primary key (tenant_id, property, date)
);

-- RLS mirrors peer tenant tables: deny anon entirely; authenticated
-- users read/write only their tenant's rows via tenant_members.
-- The service-role key (app layer + crons) bypasses RLS.
alter table gsc_daily_rows enable row level security;
alter table gsc_daily_totals enable row level security;

drop policy if exists gsc_daily_rows_tenant_rw on gsc_daily_rows;
create policy gsc_daily_rows_tenant_rw on gsc_daily_rows
  for all to authenticated
  using (is_tenant_member(tenant_id))
  with check (is_tenant_member(tenant_id));

drop policy if exists gsc_daily_totals_tenant_rw on gsc_daily_totals;
create policy gsc_daily_totals_tenant_rw on gsc_daily_totals
  for all to authenticated
  using (is_tenant_member(tenant_id))
  with check (is_tenant_member(tenant_id));
