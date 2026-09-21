CREATE TABLE IF NOT EXISTS public.opportunity_dismissals (
  tenant_id     text        NOT NULL,
  opp_key       text        NOT NULL,
  status        text        NOT NULL DEFAULT 'skip',
  dismissed_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, opp_key)
);

CREATE INDEX IF NOT EXISTS opportunity_dismissals_tenant_idx
  ON public.opportunity_dismissals (tenant_id);

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
END $$;;
