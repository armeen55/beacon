ALTER TABLE public.dataforseo_serp_history
  ADD COLUMN IF NOT EXISTS snippet_owner jsonb;

ALTER TABLE public.dataforseo_serp_history
  ADD COLUMN IF NOT EXISTS paa_questions jsonb NOT NULL DEFAULT '[]';

CREATE INDEX IF NOT EXISTS dataforseo_serp_history_snippet_owner_idx
  ON public.dataforseo_serp_history (tenant_id, query, captured_at DESC)
  WHERE snippet_owner IS NOT NULL;
;
