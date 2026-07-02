-- 2026-07-01 - ga4_ai_referral_daily: AI-referral attribution (BEACON_500 item 6).
--
-- One row per (tenant, page, day, AI source) of REAL GA4 sessions whose
-- sessionSource is an AI assistant (chatgpt.com, perplexity.ai,
-- gemini.google.com, copilot.microsoft.com, claude.ai, you.com, meta.ai).
-- Written nightly by src/lib/connectors/ga4/sync-ai-referrals.ts (a SEPARATE
-- Data API report from the traffic sync, so a failure here never touches
-- ga4_url_traffic). Read by src/domains/ai-visibility/ai-referrals.ts for the
-- Today AI band line: "AI assistants sent you 214 visitors these 30 days".
--
-- source_domain stores the CANONICAL assistant domain (variants like
-- chat.openai.com collapse into chatgpt.com at sync time), so per-assistant
-- rollups are a plain GROUP BY. key_events is numeric because GA4 can report
-- fractional key events under some counting methods.
--
-- Additive + idempotent. RLS mirrors the peer tables (deny anon; authenticated
-- via is_tenant_member; the service-role client bypasses RLS).

CREATE TABLE IF NOT EXISTS public.ga4_ai_referral_daily (
  tenant_id        text        NOT NULL,
  page_path        text        NOT NULL,
  day              date        NOT NULL,
  source_domain    text        NOT NULL,
  sessions         integer     NOT NULL DEFAULT 0,
  engaged_sessions integer     NOT NULL DEFAULT 0,
  key_events       numeric     NOT NULL DEFAULT 0,
  last_synced_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, page_path, day, source_domain)
);

CREATE INDEX IF NOT EXISTS ga4_ai_referral_daily_tenant_day_idx
  ON public.ga4_ai_referral_daily (tenant_id, day);

ALTER TABLE public.ga4_ai_referral_daily ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deny_anon ON public.ga4_ai_referral_daily;
CREATE POLICY deny_anon ON public.ga4_ai_referral_daily AS PERMISSIVE FOR ALL TO anon USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS tenant_authenticated_rw ON public.ga4_ai_referral_daily;
CREATE POLICY tenant_authenticated_rw ON public.ga4_ai_referral_daily AS PERMISSIVE FOR ALL TO authenticated
  USING (is_tenant_member(tenant_id)) WITH CHECK (is_tenant_member(tenant_id));
