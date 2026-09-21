ALTER TABLE public.llm_budget_ledger DROP CONSTRAINT llm_budget_ledger_platform_chk;
ALTER TABLE public.llm_budget_ledger ADD CONSTRAINT llm_budget_ledger_platform_chk CHECK (platform = ANY (ARRAY['perplexity'::text, 'openai'::text, 'adjudicator-openai'::text, 'dataforseo-serp'::text, 'other'::text]));;
