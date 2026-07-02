-- 2026-07-02 - dataforseo_serp_history: add featured-snippet owner + PAA question
-- columns (BEACON_500 item 25). Additive follow-up to
-- migrations/2026-07-02_dataforseo_serp_history.sql and its item-20 AI Overview
-- follow-up - no existing column changes, no data mutated, no rows deleted.
--
-- The live/advanced response already carries the featured_snippet and
-- people_also_ask items whenever they render; dataforseo-serp.ts previously only
-- flagged their presence as a boolean SerpFeature and threw away who owns the
-- snippet and what the PAA questions are. parseFeaturedSnippet()/parsePaaQuestions()
-- (dataforseo-serp.ts) now read them from the same paid-for body ($0 added spend)
-- into two lean, persisted shapes:
--   snippet_owner  - { ownerDomain, ownerUrl, textExcerpt (<= 300 chars), format }
--                    null when no featured snippet rendered at capture time.
--   paa_questions  - [{ question, answerDomain? }], [] when no PAA box rendered.
--
-- Both default honestly to "nothing observed" so every pre-existing history row
-- (written before these columns existed) reads as snippet_owner=null /
-- paa_questions=[] rather than fabricating data the original capture never had.

ALTER TABLE public.dataforseo_serp_history
  ADD COLUMN IF NOT EXISTS snippet_owner jsonb;

ALTER TABLE public.dataforseo_serp_history
  ADD COLUMN IF NOT EXISTS paa_questions jsonb NOT NULL DEFAULT '[]';

-- Cheap partial index for "which of my tracked queries currently have a
-- featured snippet at all" scans (the steal-detector's main read pattern).
CREATE INDEX IF NOT EXISTS dataforseo_serp_history_snippet_owner_idx
  ON public.dataforseo_serp_history (tenant_id, query, captured_at DESC)
  WHERE snippet_owner IS NOT NULL;
