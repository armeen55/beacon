-- 2026-06-11 — answer_intelligence_index per-tenant (night-shift item 2).
-- APPLIED to production via MCP 2026-06-11 ~07:12 UTC.
-- Same disease as citation_evidence_index: one global row (id='current')
-- written by the founder tenant's import and served to every tenant on
-- hosted reads. Additive: tenant_id + founder backfill + (tenant_id, id)
-- PK. Fail-closed against the pre-fix writer.
ALTER TABLE public.answer_intelligence_index ADD COLUMN IF NOT EXISTS tenant_id text;
UPDATE public.answer_intelligence_index SET tenant_id = 'tenant-ritz-founder' WHERE tenant_id IS NULL;
ALTER TABLE public.answer_intelligence_index ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.answer_intelligence_index DROP CONSTRAINT IF EXISTS answer_intelligence_index_pkey;
ALTER TABLE public.answer_intelligence_index ADD CONSTRAINT answer_intelligence_index_pkey PRIMARY KEY (tenant_id, id);
