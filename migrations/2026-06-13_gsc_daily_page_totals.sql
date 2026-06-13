-- 2026-06-13 — per-page GSC totals (true page-level metrics).
--
-- gsc_daily_rows stores the page+QUERY grain. GSC withholds anonymized
-- low-volume queries from that breakdown, so summing it UNDERCOUNTS a page's
-- impressions (and inflates CTR, since clicks survive better than impressions).
-- For Iranopedia, persian-male-names summed to ~69.5k impr from page+query vs
-- the GSC UI's 136.9k page total. This table holds the dimensions=[page] pull
-- (which INCLUDES the anonymized queries) so card clicks/impressions/CTR/
-- position match the GSC UI. Mirrors gsc_daily_totals (property-level) + a page.

CREATE TABLE IF NOT EXISTS public.gsc_daily_page_totals (
  tenant_id   text NOT NULL,
  property    text NOT NULL,
  date        date NOT NULL,
  page        text NOT NULL,
  clicks      integer NOT NULL DEFAULT 0,
  impressions integer NOT NULL DEFAULT 0,
  ctr         double precision NOT NULL DEFAULT 0,
  position    double precision NOT NULL DEFAULT 0,
  is_final    boolean NOT NULL DEFAULT true,
  pulled_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, property, date, page)
);

CREATE INDEX IF NOT EXISTS gsc_daily_page_totals_tenant_date_idx
  ON public.gsc_daily_page_totals (tenant_id, date);

ALTER TABLE public.gsc_daily_page_totals ENABLE ROW LEVEL SECURITY;
