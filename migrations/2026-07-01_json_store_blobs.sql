-- json_store_blobs (2026-07-01) - durable Supabase mirror for registered research-cache
-- json-stores (dataforseo-keywords-cache, dataforseo-serp-cache, research-serp-patterns,
-- competitor-page-audit). One jsonb blob per resolved scope key, matching the file store's
-- whole-array read/write semantics. Fixes: hosted prod (VERCEL=1) skips disk writes, so
-- these caches previously did not exist in prod at all (empty evidence + re-spend risk).
--
-- ADDITIVE + idempotent. scope_key format (from resolve-data-path):
--   per-tenant: "<store>::tenant:<slug>"   global: "<store>::global"

CREATE TABLE IF NOT EXISTS public.json_store_blobs (
  scope_key   text        PRIMARY KEY,
  store_name  text        NOT NULL,
  content     jsonb       NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS json_store_blobs_store_name_idx
  ON public.json_store_blobs (store_name);

-- Deny anon; service-role only (matches sibling tables).
ALTER TABLE public.json_store_blobs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'json_store_blobs' AND policyname = 'deny_anon_json_store_blobs'
  ) THEN
    CREATE POLICY deny_anon_json_store_blobs ON public.json_store_blobs
      FOR ALL TO anon USING (false) WITH CHECK (false);
  END IF;
END $$;
