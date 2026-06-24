-- Rank-&-Revenue Engine · Step 3 — competitor page audit (deterministic teardown).
-- ADDITIVE + idempotent. NOT applied automatically — apply with operator approval.
-- v1 persists to the `competitor-page-audit` tenant-scoped json-store (file
-- fallback, per the competitor-page-snapshots posture). This table backs the
-- same data on Vercel (where .data is ephemeral) once applied; the loader
-- treats a missing table as empty (PGRST205/42P01 file-fallback).

CREATE TABLE IF NOT EXISTS public.competitor_page_audit (
  tenant_id        text        NOT NULL,
  url              text        NOT NULL,
  domain           text        NOT NULL,
  fetch_status     text        NOT NULL,   -- ok | blocked_robots | http_error | fetch_failed | empty
  http_status      integer,
  content_hash     text,
  audited_at       timestamptz NOT NULL DEFAULT now(),
  error            text,
  -- deterministic extracted facts (NULL when fetch_status != 'ok')
  facts            jsonb,
  PRIMARY KEY (tenant_id, url)
);

CREATE INDEX IF NOT EXISTS competitor_page_audit_tenant_idx
  ON public.competitor_page_audit (tenant_id);

-- Tenant-isolation: deny anon; service-role only (matches sibling tables).
ALTER TABLE public.competitor_page_audit ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'competitor_page_audit'
      AND policyname = 'deny_anon_competitor_page_audit'
  ) THEN
    CREATE POLICY deny_anon_competitor_page_audit
      ON public.competitor_page_audit
      FOR ALL TO anon USING (false) WITH CHECK (false);
  END IF;
END $$;
