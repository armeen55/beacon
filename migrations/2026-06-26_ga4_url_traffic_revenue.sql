-- Migration: 2026-06-26_ga4_url_traffic_revenue.sql
-- Author:    Claude (GA4 revenue migration sprint) — operator-approved scope.
-- Status:    NOT YET APPLIED — operator-gated. Branch claude/ga4-revenue-migration.
--            Apply only after operator review (see the sprint's final report).
-- Project:   vlxwevsdvwxvopkjsewo (beacon-main — current prod, cut over 2026-06-18).
--
-- Why this migration exists:
--   Beacon's value/ranking treats a GA4 conversion COUNT as if it were a
--   dollar value (demand-graph load-graph.ts:255 → build-graph.ts:407
--   `dollarMult = 1 + log10(dollar+1)/2`, which expects MONETARY value).
--   That conflates "100 newsletter signups" with "$100 of revenue". This
--   migration adds the REAL GA4 revenue metrics so scoring can become
--   revenue-aware while keeping conversions as a separate signal + fallback.
--
-- ADDITIVE ONLY — extends the existing `ga4_url_traffic` table with nullable
-- revenue columns. NO new table is needed: revenue is the same grain as the
-- existing rows (per-tenant, per-URL, per-day) and shares the same composite
-- PK (tenant_id, url, date) + RLS posture, so a sibling table would only force
-- a join on every read for zero benefit. (A sibling table would be justified
-- if revenue had a DIFFERENT grain — it does not.)
--
-- Constraints (operator-locked, mirrors 2026-05-19_ga4_url_traffic.sql):
--   * ADDITIVE ONLY — ADD COLUMN, no ALTER/DROP of existing columns, no type
--     changes, no constraint changes on the existing schema.
--   * Every new column is NULLABLE with NO DEFAULT. A missing/unfetched revenue
--     value stays NULL ("unknown") — never silently 0. GA4 reporting an explicit
--     0 is stored as 0 WITH `revenue_synced_at` set, which is how the read layer
--     distinguishes "observed zero" from "never fetched / no ecommerce".
--   * No data mutation. Existing rows get NULL revenue until the next sync run
--     enriches them. Existing SELECTs (which name specific columns, e.g.
--     ga4-page-values.ts selects `url, sessions, engaged_sessions, conversions`)
--     are unaffected by added columns.
--   * RLS unchanged — inherited from the table (deny-all authenticated;
--     service_role bypasses). No new policy needed.
--   * Reversible: each column DROPs cleanly (rollback at the bottom). No FK
--     references, no dependent views.
--
-- The "unknown vs zero" contract (enforced by the normalization layer, grounded
-- in these columns):
--   * revenue_synced_at IS NULL                       → UNKNOWN (never fetched,
--                                                        or property has no
--                                                        ecommerce revenue).
--   * revenue_synced_at IS NOT NULL AND revenue = 0   → OBSERVED ZERO (GA4
--                                                        explicitly reported $0).
--   * revenue_synced_at IS NOT NULL AND revenue > 0   → REAL REVENUE.

ALTER TABLE public.ga4_url_traffic
  ADD COLUMN IF NOT EXISTS total_revenue      numeric,
  ADD COLUMN IF NOT EXISTS purchase_revenue   numeric,
  ADD COLUMN IF NOT EXISTS transactions       integer,
  ADD COLUMN IF NOT EXISTS revenue_currency   text,
  ADD COLUMN IF NOT EXISTS revenue_source     text,
  ADD COLUMN IF NOT EXISTS revenue_synced_at  timestamptz;

COMMENT ON COLUMN public.ga4_url_traffic.total_revenue IS
  'GA4 metric "totalRevenue" for this (tenant,url,date) — all revenue (purchases + ads + in-app), in revenue_currency. NULLABLE: NULL = revenue not fetched / property has no ecommerce (see revenue_synced_at). numeric (not integer) — GA4 returns fractional currency.';

COMMENT ON COLUMN public.ga4_url_traffic.purchase_revenue IS
  'GA4 metric "purchaseRevenue" — ecommerce purchase revenue only (the cleaner "this page drove a sale" signal; preferred over total_revenue by the normalization layer). NULLABLE: NULL = unknown.';

COMMENT ON COLUMN public.ga4_url_traffic.transactions IS
  'GA4 metric "transactions" (a.k.a. ecommerce purchase count) for this row. Answers "drives purchases but not revenue" (transactions>0 with revenue 0/NULL). integer. NULLABLE: NULL = unknown.';

COMMENT ON COLUMN public.ga4_url_traffic.revenue_currency IS
  'ISO 4217 currency code for total_revenue/purchase_revenue (from the GA4 property''s reporting currency / metric metadata). NULLABLE: NULL when unknown — the UI must not assume USD.';

COMMENT ON COLUMN public.ga4_url_traffic.revenue_source IS
  'Provenance of the revenue figure: which GA4 metric populated it (e.g. "ga4_purchase_revenue" | "ga4_total_revenue") or NULL when no revenue was observed. Lets the read layer + UI explain where the number came from.';

COMMENT ON COLUMN public.ga4_url_traffic.revenue_synced_at IS
  'When a revenue fetch SUCCEEDED for this row. THE unknown-vs-zero discriminator: NULL = revenue never fetched (unknown); NOT NULL = revenue was fetched (a 0 alongside it is an OBSERVED zero, not a missing value). Distinct from last_synced_at, which tracks the traffic fetch.';

-- ───────────────────────────────────────────────────────────────────────────
-- ROLLBACK (reversible — additive columns drop cleanly, no data loss beyond the
-- revenue values themselves; traffic columns + existing rows are untouched):
--
--   ALTER TABLE public.ga4_url_traffic
--     DROP COLUMN IF EXISTS total_revenue,
--     DROP COLUMN IF EXISTS purchase_revenue,
--     DROP COLUMN IF EXISTS transactions,
--     DROP COLUMN IF EXISTS revenue_currency,
--     DROP COLUMN IF EXISTS revenue_source,
--     DROP COLUMN IF EXISTS revenue_synced_at;
--
-- After rollback, the revenue sync writes become no-ops against the missing
-- columns (PostgREST returns a column-not-found error → the persist layer's
-- existing fail-soft treats revenue as unavailable; traffic sync is unaffected).
-- ───────────────────────────────────────────────────────────────────────────
