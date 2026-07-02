-- outreach_pipeline (BEACON_500 item 57, 2026-07-02) - the get-cited/link-reclaim
-- pitch pipeline. Leads come from the wiki-gap citing contexts, keyword-gap
-- competitor domains, and profound citation domains Beacon already mines; a
-- pitch is drafted per lead through the budgeted structured LLM path and tracked
-- here until it is sent, replied to, won, or dead. Additive + idempotent.
--
-- CRITICAL SAFETY RULE: no code path may set status='sent' or sent_at except the
-- operator's explicit Send click (see outreach-store.ts markSent + the
-- architecture pin in outreach-pipeline.test.ts). Follow-ups are queued as new
-- draft rows, never auto-sent.
--
-- Written/read by src/domains/outreach/outreach-store.ts. RLS mirrors the
-- current sibling convention (is_tenant_member; see retrieval_chunks /
-- gsc_monthly_archive).

CREATE TABLE IF NOT EXISTS public.outreach_pipeline (
  tenant_id      text        NOT NULL,
  id             text        NOT NULL,
  target_domain  text        NOT NULL,
  target_url     text        NOT NULL,
  contact_email  text,
  pitch_subject  text        NOT NULL,
  pitch_body     text        NOT NULL,
  status         text        NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft', 'ready', 'sent', 'replied', 'won', 'dead')),
  lead_source    text        NOT NULL,   -- wiki_gap | keyword_gap_competitor | profound_citation
  sent_at        timestamptz,
  last_event_at  timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS outreach_pipeline_tenant_status_idx
  ON public.outreach_pipeline (tenant_id, status);

CREATE INDEX IF NOT EXISTS outreach_pipeline_tenant_last_event_idx
  ON public.outreach_pipeline (tenant_id, last_event_at DESC);

ALTER TABLE public.outreach_pipeline ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deny_anon ON public.outreach_pipeline;
CREATE POLICY deny_anon ON public.outreach_pipeline AS PERMISSIVE FOR ALL TO anon USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS tenant_authenticated_rw ON public.outreach_pipeline;
CREATE POLICY tenant_authenticated_rw ON public.outreach_pipeline AS PERMISSIVE FOR ALL TO authenticated
  USING (is_tenant_member(tenant_id)) WITH CHECK (is_tenant_member(tenant_id));
