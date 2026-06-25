-- Rank-&-Revenue Engine · cockpit — persisted AI move drafts.
-- ADDITIVE + idempotent. NOT applied automatically — apply with operator approval.
-- Backs `move-draft-store.ts`: the answer-block / FAQ-schema drafts an operator
-- generates on a Today's Moves card. Each draft costs a (small) real LLM spend;
-- persisting them means they survive reload instead of being regenerated. The
-- store treats a missing table as "no drafts" (PGRST205/42P01) so the cockpit
-- works before this migration is applied — it just won't persist until then.
-- Append-only (latest row per (tenant, rec, kind) wins on read).

CREATE TABLE IF NOT EXISTS public.move_drafts (
  id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   text        NOT NULL,
  rec_id      text        NOT NULL,
  kind        text        NOT NULL,   -- answer_block | faq
  content     text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Read path: latest per (tenant, rec, kind), newest first.
CREATE INDEX IF NOT EXISTS move_drafts_tenant_created_idx
  ON public.move_drafts (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS move_drafts_lookup_idx
  ON public.move_drafts (tenant_id, rec_id, kind);

-- Tenant-isolation: deny anon; service-role only (matches sibling tables).
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
END $$;
