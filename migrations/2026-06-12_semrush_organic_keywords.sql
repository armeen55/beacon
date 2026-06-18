-- 2026-06-12 — Insight Graph slice 2: SEMrush domain_organic keyword→URL rows.
-- Additive. PK (tenant, domain, keyword, url): MULTIPLE rows per keyword when
-- several of the domain's URLs rank (the cannibalization signal) — the url is
-- part of the key so the upsert (onConflict tenant_id,domain,keyword,url) keeps
-- every (keyword, url) pair instead of collapsing them.
-- ToS NOTE: SEMrush permits caching raw API data for at most ONE MONTH —
-- rows carry fetched_at and the sync purges rows older than 30 days.

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
  primary key (tenant_id, domain, keyword, url)
);

create index if not exists semrush_organic_keywords_tenant_url_idx
  on semrush_organic_keywords (tenant_id, url);

alter table semrush_organic_keywords enable row level security;

drop policy if exists semrush_organic_keywords_tenant_rw on semrush_organic_keywords;
create policy semrush_organic_keywords_tenant_rw on semrush_organic_keywords
  for all to authenticated
  using (is_tenant_member(tenant_id))
  with check (is_tenant_member(tenant_id));

-- NOTE: the 4-column PK above (incl. url) is the intended schema. Earlier copies
-- of this file shipped a 3-column PK (tenant_id, domain, keyword) with this
-- widening left COMMENTED OUT — so on any DB created from those, the SEMrush
-- upsert (onConflict ...,url) fails with "no unique or exclusion constraint
-- matching the ON CONFLICT specification" and NOTHING ever persists. The
-- idempotent fix for existing DBs lives in
-- 2026-06-18_semrush_diagnostic_enrichment.sql.
