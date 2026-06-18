-- Page Surgeon SEMrush enrichment (2026-06-18)
-- Two tables for the capped diagnostic pull:
--   • semrush_keyword_expansions — phrase_related / phrase_questions rows tied
--     to a diagnostic page's seed query (broader QUERY context for the brief).
--   • semrush_pull_receipts — an exact, auditable record of each capped pull:
--     unit balance before/after, estimated vs actual spend, per-endpoint rows.
-- Both are server-only caches (service-role writes); RLS enabled with NO
-- policies so the anon/auth roles cannot read the cached third-party data
-- (matches semrush_organic_keywords + page_surgeon_briefs conventions).

create table if not exists public.semrush_keyword_expansions (
  tenant_id   text        not null,
  page_url    text        not null,
  seed_query  text        not null,
  kind        text        not null check (kind in ('related', 'question')),
  keyword     text        not null,
  volume      integer,
  difficulty  double precision,
  cpc         double precision,
  intent      text,
  fetched_at  timestamptz not null default now(),
  primary key (tenant_id, page_url, kind, keyword)
);

create index if not exists semrush_keyword_expansions_tenant_page_idx
  on public.semrush_keyword_expansions (tenant_id, page_url);

alter table public.semrush_keyword_expansions enable row level security;

create table if not exists public.semrush_pull_receipts (
  id              bigint generated always as identity primary key,
  tenant_id       text        not null,
  domain          text        not null,
  ran_at          timestamptz not null default now(),
  balance_before  integer,
  balance_after   integer,
  actual_spend    integer,
  est_total_units integer,
  steps           jsonb       not null default '[]'::jsonb
);

create index if not exists semrush_pull_receipts_tenant_ran_idx
  on public.semrush_pull_receipts (tenant_id, ran_at desc);

alter table public.semrush_pull_receipts enable row level security;

-- FIX (latent prod-schema bug): older copies of semrush_organic_keywords shipped
-- a 3-column PK (tenant_id, domain, keyword) with the url-widening left commented
-- out, so the SEMrush upsert (onConflict tenant_id,domain,keyword,url) always
-- failed and nothing ever persisted. Widen the PK to include url if it hasn't
-- been. Idempotent + safe (the table is keyword-cache only, ToS-purged).
do $$
begin
  if exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'semrush_organic_keywords'
      and c.conname = 'semrush_organic_keywords_pkey'
      and pg_get_constraintdef(c.oid) = 'PRIMARY KEY (tenant_id, domain, keyword)'
  ) then
    alter table public.semrush_organic_keywords drop constraint semrush_organic_keywords_pkey;
    alter table public.semrush_organic_keywords add primary key (tenant_id, domain, keyword, url);
  end if;
end $$;
