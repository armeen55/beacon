-- 2026-08-18 SOURCE-BACKED PAGE FACTS + THE fact_check RESEARCH PHASE.
--
-- WHY THIS FILE EXISTS: the table and the phase were created by hand against production, so a clean
-- environment could not reproduce the schema and the checked-in constraint still rejected the phase
-- (Codex, 2026-08-18). Production must never depend on an unrecorded dashboard mutation.
--
-- IDEMPOTENT AND NON-DESTRUCTIVE by construction: it reconciles the table that already exists, keeps every
-- row already banked, and drops nothing. Safe to run against today's production and against an empty database.

-- ── the evidence: one row per checked statement ──────────────────────────────
create table if not exists public.page_source_facts (
  tenant_id text not null,
  page_key text not null,
  statement_key text not null,
  page_content_hash text,
  subject text not null,
  current_wording text not null,
  proposed text,
  literal text,
  usage text,
  source_url text,
  source_quote text,
  source_class text,
  sources jsonb not null default '[]',
  agreement text not null,
  confidence text not null,
  verdict text not null,
  also_at jsonb not null default '[]',
  note text,
  evidence_basis text,
  checked_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, page_key, statement_key)
);

-- Columns added after the first hand-made version, each additive so an existing row keeps what it holds.
alter table public.page_source_facts add column if not exists page_content_hash text;
alter table public.page_source_facts add column if not exists source_quote text;
alter table public.page_source_facts add column if not exists source_class text;
alter table public.page_source_facts add column if not exists evidence_basis text;
-- WHERE ON THE PAGE the statement sits: part of a statement's identity, so two different claims about one
-- subject cannot overwrite each other. Nullable for the rows banked before identity carried it.
alter table public.page_source_facts add column if not exists page_locator text;
-- WHEN THE SOURCE ITSELF WAS READ, as opposed to when the comparison ran. Null = never fetched, which is
-- exactly the state that may not authorize replacing published words.
alter table public.page_source_facts add column if not exists source_read_at timestamptz;

create index if not exists page_source_facts_tenant_page_idx on public.page_source_facts (tenant_id, page_key);
create index if not exists page_source_facts_actionable_idx on public.page_source_facts (tenant_id, confidence, verdict);
-- The rotation read: which page has the oldest coverage, so a pass can advance past page one.
create index if not exists page_source_facts_coverage_idx on public.page_source_facts (tenant_id, checked_at);

-- Tenant protection: the service role reads and writes; nothing anonymous ever sees another account's
-- evidence. RLS with no permissive policy denies every anon/authenticated request outright.
alter table public.page_source_facts enable row level security;

-- ── the phase: research_runs must be allowed to hold it ──────────────────────
-- The checked-in constraint listed eight phases, so a run entering fact_check would have failed its write.
alter table public.research_runs drop constraint if exists research_runs_current_phase_check;
alter table public.research_runs add constraint research_runs_current_phase_check
  check (current_phase = any (array[
    'refresh_sources', 'gsc_backfill_chunk', 'crawl_pages', 'keyword_discovery',
    'prompt_observations', 'serp_analysis', 'winning_pages', 'fact_check', 'publish_surface', 'done'
  ]));
