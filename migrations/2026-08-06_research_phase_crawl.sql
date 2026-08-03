-- 2026-08-06  The phase union learns the word the pipeline already speaks: crawl_pages.
--
-- FOUND BY THE FIRST LIVE DISPATCH. The Dream pipeline reads one bounded batch of the account's own
-- website per pass, as the phase crawl_pages between gsc_backfill_chunk and keyword_discovery. The code
-- ships it; the July constraint on research_runs.current_phase never learned the word, so the very first
-- advance into it violated the check, the owner-guarded advance reported false, and every dispatch ended
-- the account's turn at gsc_backfill_chunk. Forward-only, additive: a widened union rejects nothing it
-- accepted before, so old rows and old code are untouched.
alter table public.research_runs drop constraint if exists research_runs_current_phase_check;
alter table public.research_runs add constraint research_runs_current_phase_check
  check (current_phase in (
    'refresh_sources', 'gsc_backfill_chunk', 'crawl_pages', 'keyword_discovery',
    'prompt_observations', 'serp_analysis', 'winning_pages', 'publish_surface', 'done'
  ));
