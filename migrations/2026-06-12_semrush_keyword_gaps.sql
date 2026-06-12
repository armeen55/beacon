-- 2026-06-12 — Keyword-gap slice: weekly domain_domains "Missing"
-- rows (competitor ranks top-10, tenant absent). Additive. Same
-- SEMrush ToS 30-day TTL discipline as semrush_organic_keywords.
-- (Applied to prod via MCP on 2026-06-12.)

create table if not exists semrush_keyword_gaps (
  tenant_id text not null,
  domain text not null,
  competitor_domain text not null,
  keyword text not null,
  competitor_position integer not null default 0,
  volume integer not null default 0,
  difficulty double precision,
  fetched_at timestamptz not null default now(),
  primary key (tenant_id, domain, competitor_domain, keyword)
);

alter table semrush_keyword_gaps enable row level security;

drop policy if exists semrush_keyword_gaps_tenant_rw on semrush_keyword_gaps;
create policy semrush_keyword_gaps_tenant_rw on semrush_keyword_gaps
  for all to authenticated
  using (is_tenant_member(tenant_id))
  with check (is_tenant_member(tenant_id));
