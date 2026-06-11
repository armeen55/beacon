-- 2026-06-11 — citation_evidence_index per-tenant (night-shift item 1).
-- APPLIED to production via MCP 2026-06-11 ~07:00 UTC.
--
-- The nightly rebuild blended ALL tenants' observations into one global
-- row (id='current') and hosted reads served that single row to every
-- tenant. Additive: add tenant_id, stamp legacy contents to the founder
-- tenant (pre-2026-06-10 data was Ritz-only), re-key the PK to
-- (tenant_id, id) so each tenant owns one 'current' row. Deliberately
-- fail-closed against the pre-fix writer: its upsert (no tenant_id,
-- onConflict id) errors instead of blending.
ALTER TABLE public.citation_evidence_index ADD COLUMN IF NOT EXISTS tenant_id text;
UPDATE public.citation_evidence_index SET tenant_id = 'tenant-ritz-founder' WHERE tenant_id IS NULL;
ALTER TABLE public.citation_evidence_index ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.citation_evidence_index DROP CONSTRAINT IF EXISTS citation_evidence_index_pkey;
ALTER TABLE public.citation_evidence_index ADD CONSTRAINT citation_evidence_index_pkey PRIMARY KEY (tenant_id, id);
