alter table public.page_source_facts add column if not exists page_content_hash text;
alter table public.page_source_facts add column if not exists source_quote text;
alter table public.page_source_facts add column if not exists source_class text;
alter table public.page_source_facts add column if not exists evidence_basis text;
alter table public.page_source_facts add column if not exists page_locator text;
alter table public.page_source_facts add column if not exists source_read_at timestamptz;
create index if not exists page_source_facts_coverage_idx on public.page_source_facts (tenant_id, checked_at);
alter table public.research_runs drop constraint if exists research_runs_current_phase_check;
alter table public.research_runs add constraint research_runs_current_phase_check
  check (current_phase = any (array[
    'refresh_sources', 'gsc_backfill_chunk', 'crawl_pages', 'keyword_discovery',
    'prompt_observations', 'serp_analysis', 'winning_pages', 'fact_check', 'publish_surface', 'done'
  ]));;
