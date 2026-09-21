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

alter table public.semrush_pull_receipts enable row level security;;
