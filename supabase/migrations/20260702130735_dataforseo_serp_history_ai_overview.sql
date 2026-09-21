ALTER TABLE public.dataforseo_serp_history
  ADD COLUMN IF NOT EXISTS ai_overview_present boolean NOT NULL DEFAULT false;

ALTER TABLE public.dataforseo_serp_history
  ADD COLUMN IF NOT EXISTS ai_overview_domains jsonb NOT NULL DEFAULT '[]';

CREATE INDEX IF NOT EXISTS dataforseo_serp_history_ai_overview_present_idx
  ON public.dataforseo_serp_history (tenant_id, query, captured_at DESC)
  WHERE ai_overview_present;
;
