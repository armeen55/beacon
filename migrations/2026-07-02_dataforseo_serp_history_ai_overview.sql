-- 2026-07-02 - dataforseo_serp_history: add Google AI Overview citation columns
-- (BEACON_500 item 20). Additive follow-up to
-- migrations/2026-07-02_dataforseo_serp_history.sql - no existing column changes,
-- no data mutated, no rows deleted.
--
-- The SERP runner switched from live/regular to live/advanced (same documented
-- Live-mode price, item 20 - see dataforseo-serp.ts) so the response can include
-- an ai_overview item. parseAiOverview() reads its top-level `references` array
-- (verified against 2 real live probe calls on 2026-07-02) into a plain
-- { domain, url, position } list. These two columns persist that per-snapshot:
--   ai_overview_present  - did Google render an AI Overview for this query at all
--   ai_overview_domains  - the domains it cited, in order ([] when absent or
--                          references were withheld by the response)
--
-- Both default honestly to "no overview seen" so every pre-existing history row
-- (written before this column existed) reads as present=false / domains=[]
-- rather than fabricating data the original capture never had.

ALTER TABLE public.dataforseo_serp_history
  ADD COLUMN IF NOT EXISTS ai_overview_present boolean NOT NULL DEFAULT false;

ALTER TABLE public.dataforseo_serp_history
  ADD COLUMN IF NOT EXISTS ai_overview_domains jsonb NOT NULL DEFAULT '[]';

-- Cheap partial index for "which of my tracked queries currently have an AI
-- Overview at all" scans (the gap-diff module's main read pattern).
CREATE INDEX IF NOT EXISTS dataforseo_serp_history_ai_overview_present_idx
  ON public.dataforseo_serp_history (tenant_id, query, captured_at DESC)
  WHERE ai_overview_present;
