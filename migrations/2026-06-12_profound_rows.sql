-- 2026-06-12 — Profound connector: nightly answer-engine truth.
-- profound_citation_rows: which AI models cite which URLs/domains for
-- the tenant's tracked category (POST /v1/reports/citations).
-- profound_visibility_rows: per-model visibility + share-of-voice per
-- asset — the tenant's brand AND competitors (POST /v1/reports/visibility).
-- Trailing 3-day EST window re-pulled nightly; idempotent UPSERTs on
-- the natural keys below. Additive; RLS mirrors peers.
-- (Applied to prod via MCP on 2026-06-12.)

create table if not exists profound_citation_rows (
  tenant_id text not null,
  category_id text not null,
  date date not null,
  model text not null default '',
  root_domain text not null default '',
  url text not null,
  citation_count double precision not null default 0,
  citation_share double precision not null default 0,
  pulled_at timestamptz not null default now(),
  primary key (tenant_id, category_id, date, model, root_domain, url)
);

alter table profound_citation_rows enable row level security;

drop policy if exists profound_citation_rows_tenant_rw on profound_citation_rows;
create policy profound_citation_rows_tenant_rw on profound_citation_rows
  for all to authenticated
  using (is_tenant_member(tenant_id))
  with check (is_tenant_member(tenant_id));

create table if not exists profound_visibility_rows (
  tenant_id text not null,
  category_id text not null,
  date date not null,
  model text not null default '',
  asset_name text not null default '',
  visibility_score double precision not null default 0,
  share_of_voice double precision not null default 0,
  mentions_count double precision not null default 0,
  executions double precision not null default 0,
  pulled_at timestamptz not null default now(),
  primary key (tenant_id, category_id, date, model, asset_name)
);

alter table profound_visibility_rows enable row level security;

drop policy if exists profound_visibility_rows_tenant_rw on profound_visibility_rows;
create policy profound_visibility_rows_tenant_rw on profound_visibility_rows
  for all to authenticated
  using (is_tenant_member(tenant_id))
  with check (is_tenant_member(tenant_id));
