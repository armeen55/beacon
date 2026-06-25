-- Rank-&-Revenue Engine · cockpit — operator-curated worklist dismissals.
-- ADDITIVE + idempotent. Backs `opportunity-dismissal-store.ts`: lets the operator
-- dismiss a site-wide opportunity (feed row) so it stays gone across reloads. The
-- feed is recomputed from live GSC every render, so without this a dismissed row
-- reappears forever. The store treats a missing table as "nothing dismissed"
-- (PGRST205/42P01) so the cockpit works before this is applied — it just won't
-- persist dismissals until then. One row per (tenant, opp_key); upsert on conflict.

CREATE TABLE IF NOT EXISTS public.opportunity_dismissals (
  tenant_id     text        NOT NULL,
  opp_key       text        NOT NULL,   -- `kind|page|query` (normalized)
  status        text        NOT NULL DEFAULT 'skip',   -- skip | done
  dismissed_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, opp_key)
);

-- Read path: all dismissed keys for a tenant.
CREATE INDEX IF NOT EXISTS opportunity_dismissals_tenant_idx
  ON public.opportunity_dismissals (tenant_id);

-- Tenant-isolation: deny anon; service-role only (matches sibling tables).
ALTER TABLE public.opportunity_dismissals ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'opportunity_dismissals'
      AND policyname = 'deny_anon_opportunity_dismissals'
  ) THEN
    CREATE POLICY deny_anon_opportunity_dismissals
      ON public.opportunity_dismissals
      FOR ALL TO anon USING (false) WITH CHECK (false);
  END IF;
END $$;
