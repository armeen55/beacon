CREATE TABLE IF NOT EXISTS public.retrieval_chunks (
  tenant_id   text        NOT NULL,
  id          text        NOT NULL,
  source      text        NOT NULL CHECK (source IN ('owned', 'competitor')),
  page_url    text        NOT NULL,
  chunk_text  text        NOT NULL CHECK (char_length(chunk_text) <= 1200),
  embedding   jsonb       NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS retrieval_chunks_tenant_source_idx
  ON public.retrieval_chunks (tenant_id, source);

CREATE INDEX IF NOT EXISTS retrieval_chunks_tenant_url_idx
  ON public.retrieval_chunks (tenant_id, page_url);

ALTER TABLE public.retrieval_chunks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deny_anon ON public.retrieval_chunks;
CREATE POLICY deny_anon ON public.retrieval_chunks AS PERMISSIVE FOR ALL TO anon USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS tenant_authenticated_rw ON public.retrieval_chunks;
CREATE POLICY tenant_authenticated_rw ON public.retrieval_chunks AS PERMISSIVE FOR ALL TO authenticated
  USING (is_tenant_member(tenant_id)) WITH CHECK (is_tenant_member(tenant_id));
;
