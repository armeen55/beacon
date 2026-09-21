-- 2026-06-26 — additive revenue columns on ga4_url_traffic (GA4 revenue migration).
-- Additive only; nullable; no defaults; NULL=unknown, observed-0 via revenue_synced_at.
ALTER TABLE public.ga4_url_traffic
  ADD COLUMN IF NOT EXISTS total_revenue      numeric,
  ADD COLUMN IF NOT EXISTS purchase_revenue   numeric,
  ADD COLUMN IF NOT EXISTS transactions       integer,
  ADD COLUMN IF NOT EXISTS revenue_currency   text,
  ADD COLUMN IF NOT EXISTS revenue_source     text,
  ADD COLUMN IF NOT EXISTS revenue_synced_at  timestamptz;

COMMENT ON COLUMN public.ga4_url_traffic.total_revenue IS 'GA4 metric "totalRevenue" — all revenue, in revenue_currency. NULL = not fetched / no ecommerce (see revenue_synced_at).';
COMMENT ON COLUMN public.ga4_url_traffic.purchase_revenue IS 'GA4 metric "purchaseRevenue" — ecommerce purchase revenue (preferred over total). NULL = unknown.';
COMMENT ON COLUMN public.ga4_url_traffic.transactions IS 'GA4 metric "transactions" (purchase count). NULL = unknown.';
COMMENT ON COLUMN public.ga4_url_traffic.revenue_currency IS 'ISO 4217 currency for the revenue figures. NULL when unknown — UI must not assume USD.';
COMMENT ON COLUMN public.ga4_url_traffic.revenue_source IS 'Which GA4 metric populated revenue (ga4_purchase_revenue | ga4_total_revenue) or NULL.';
COMMENT ON COLUMN public.ga4_url_traffic.revenue_synced_at IS 'When a revenue fetch SUCCEEDED for this row. NULL = never fetched (unknown); NOT NULL = fetched (a 0 alongside is an OBSERVED zero). Distinct from last_synced_at (traffic).';;
