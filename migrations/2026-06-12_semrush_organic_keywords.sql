-- 2026-06-12 — Insight Graph slice 2: SEMrush domain_organic keyword→URL rows.
-- Additive. PK (tenant, domain, keyword): one row per keyword with its
-- top-ranking URL (Ur), volume (Nq), difficulty (Kd), intent (In).
-- ToS NOTE: SEMrush permits caching raw API data for at most ONE MONTH —
-- rows carry fetched_at and the sync purges rows older than 30 days.
-- (Applied to prod via MCP on 2026-06-12.)

create table if not exists semrush_organic_keywords (
  tenant_id text not null,
  domain text not null,
  keyword text not null,
  position integer not null default 0,
  prev_position integer,
  volume integer not null default 0,
  cpc double precision,
  url text not null default '',
  traffic_pct double precision,
  difficulty double precision,
  intent text,
  fetched_at timestamptz not null default now(),
  primary key (tenant_id, domain, keyword)
);

create index if not exists semrush_organic_keywords_tenant_url_idx
  on semrush_organic_keywords (tenant_id, url);

alter table semrush_organic_keywords enable row level security;

drop policy if exists semrush_organic_keywords_tenant_rw on semrush_organic_keywords;
create policy semrush_organic_keywords_tenant_rw on semrush_organic_keywords
  for all to authenticated
  using (is_tenant_member(tenant_id))
  with check (is_tenant_member(tenant_id));
