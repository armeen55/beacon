-- retrieval_chunks (BEACON_500 item 50, 2026-07-02) - the retrieval twin's embedded-chunk
-- cache. Stores OpenAI text-embedding-3-small vectors for owned page chunks and competitor
-- teardown chunks, keyed by a content hash so re-embedding only happens when a chunk's text
-- actually changes. Additive + idempotent. NOT applied automatically.
--
-- The embedding column is jsonb (a plain float array), not pgvector - this repo has no
-- pgvector precedent/extension enabled yet, and at the small per-tenant chunk counts this
-- feature bounds itself to (a few thousand rows), an in-process cosine scan over jsonb-decoded
-- arrays is fast enough; adopting pgvector is a future upgrade if chunk volume grows.
--
-- Written by src/domains/retrieval-twin/embeddings.ts (cache read/write) and
-- src/domains/retrieval-twin/build-index.ts (the operator-triggered indexer). RLS mirrors the
-- current sibling convention (is_tenant_member; see gsc_monthly_archive / shipped_change_proof).

CREATE TABLE IF NOT EXISTS public.retrieval_chunks (
  tenant_id   text        NOT NULL,
  -- content hash of embedText (sha256, hex) - the cache key. Re-embedding only happens on a
  -- hash miss (the chunk text changed or is new).
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
