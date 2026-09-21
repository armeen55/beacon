CREATE TABLE IF NOT EXISTS public.move_drafts (
  id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   text        NOT NULL,
  rec_id      text        NOT NULL,
  kind        text        NOT NULL,
  content     text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS move_drafts_tenant_created_idx
  ON public.move_drafts (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS move_drafts_lookup_idx
  ON public.move_drafts (tenant_id, rec_id, kind);

ALTER TABLE public.move_drafts ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'move_drafts'
      AND policyname = 'deny_anon_move_drafts'
  ) THEN
    CREATE POLICY deny_anon_move_drafts
      ON public.move_drafts
      FOR ALL TO anon USING (false) WITH CHECK (false);
  END IF;
END $$;;
