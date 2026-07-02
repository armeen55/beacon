-- 2026-07-02 - dataforseo_serp_history: append-only SERP time series (BEACON_500 item 17).
--
-- Every OK live DataForSEO SERP read ALSO appends one row here, at $0 marginal cost
-- (the read was already paid for). The 14-day cache row keeps being overwritten as
-- before (freshness semantics unchanged); THIS table is the durable time dimension:
-- what Google's top results looked like for a query on a given day, and where the
-- tenant's own domain sat in them (own_rank / own_url, null when absent from the
-- top results). Surfaces can then show a literal observed Google position next to
-- the blended GSC average, and a real "you moved 9 to 6" line once two snapshots exist.
--
-- APPEND-ONLY CONTRACT: writers insert with ON CONFLICT DO NOTHING (never update,
-- never delete). id = normalized query + '|' + captured_at ISO, so one row per
-- (tenant, query, capture instant) by construction.
--
-- Additive + idempotent. RLS mirrors the peer tables (deny anon; authenticated via
-- is_tenant_member; the service-role client bypasses RLS).

CREATE TABLE IF NOT EXISTS public.dataforseo_serp_history (
  tenant_id     text        NOT NULL,
  -- normalized query + '|' + captured_at ISO (see buildSerpHistoryRow)
  id            text        NOT NULL,
  query         text        NOT NULL,
  -- "locationCode|languageCode", e.g. "2840|en"
  location      text        NOT NULL DEFAULT '',
  captured_at   timestamptz NOT NULL DEFAULT now(),
  -- The tenant's own organic position in this snapshot (1-based), null when the
  -- tenant's domain is not in the captured top results. Never guessed.
  own_rank      int,
  own_url       text,
  -- Ranked array of { rank, domain, url } for the organic top results.
  top_domains   jsonb       NOT NULL DEFAULT '[]',
  serp_features jsonb       NOT NULL DEFAULT '[]',
  raw_cost_usd  numeric     NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS dataforseo_serp_history_tenant_query_captured_idx
  ON public.dataforseo_serp_history (tenant_id, query, captured_at DESC);

ALTER TABLE public.dataforseo_serp_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deny_anon ON public.dataforseo_serp_history;
CREATE POLICY deny_anon ON public.dataforseo_serp_history AS PERMISSIVE FOR ALL TO anon USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS tenant_authenticated_rw ON public.dataforseo_serp_history;
CREATE POLICY tenant_authenticated_rw ON public.dataforseo_serp_history AS PERMISSIVE FOR ALL TO authenticated
  USING (is_tenant_member(tenant_id)) WITH CHECK (is_tenant_member(tenant_id));
