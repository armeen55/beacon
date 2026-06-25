-- Widen llm_budget_ledger platform CHECK to allow the DataForSEO spend ledger.
-- Additive + non-destructive (no data dropped). APPLIED to beacon-main
-- (vlxwevsdvwxvopkjsewo) 2026-06-25 — the DataForSEO connector records SERP spend
-- under platform 'dataforseo-serp'; without this the durable insert was rejected
-- and the $/month cap couldn't track DataForSEO spend.
ALTER TABLE public.llm_budget_ledger DROP CONSTRAINT llm_budget_ledger_platform_chk;
ALTER TABLE public.llm_budget_ledger ADD CONSTRAINT llm_budget_ledger_platform_chk
  CHECK (platform = ANY (ARRAY['perplexity'::text, 'openai'::text, 'adjudicator-openai'::text, 'dataforseo-serp'::text, 'other'::text]));
