# Connector → Recommendation research digests (2026-06-12)

Implementation-grade specs from the day-run research fleet (4 agents,
each ≥4–11 sources, primary docs first). Full source lists live in the
slice commits; this note preserves the actionable contracts.

## GSC Search Analytics — SHIPPED (Insight Graph slice 1)

- `POST .../webmasters/v3/sites/{enc(siteUrl)}/searchAnalytics/query`;
  `webmasters.readonly` authorizes it (no re-consent). rowLimit max
  25,000; grouped data hard-capped 50k rows/day; 16-month history;
  final data lags ~2–3 days; ALL DATES PACIFIC TIME; ctr is a 0–1
  fraction; grouped page+query sums UNDERCOUNT (Google drops rows) —
  store the ungrouped daily total alongside.
- Nightly sync: one day per query (Google's stated best practice),
  FINAL_LAG=3d, re-pull trailing 4d, 28d first backfill.
- Trigger thresholds (sourced): positional CTR benchmarks (Semrush
  Dec 2025) pos1 39.8% / 2 18.7% / 3 10.2% / 4 7.2% / 5 5.1%; flag
  ctr < ½ benchmark at impressions ≥200/28d. Striking distance bands
  in credible use: 4–20 (SEJ), 8–20 (Backlinko), 11–30 (Semrush) —
  Rule B (not yet shipped) should use 4–15 + query-in-title/H1 checks.

## SEMrush — SPEC BANKED (next slice)

- THE per-page join: `domain_organic` with `Ur` column (ranking URL)
  at 10 units/line — one 150-line call (1,500 units) maps a small
  site's keyword→page graph WITH `Nq` volume, `Kd` difficulty, `In`
  intent inline. `url_organic` = on-demand page drill-down (10/line).
  `domain_domains` gap report = 80 units/line — weekly only,
  display_limit≤6. `phrase_*` reports are deprecated-but-live; v4
  Keyword Metrics (20 units/request, no batch) is the fallback.
- Budget: ≤2,000 units/tenant/night fits nightly domain_organic +
  one rotating weekly slot. Limits: 10 rps / 10 concurrent
  ACCOUNT-WIDE → global limiter, per-tenant ledgers.
- ToS: raw rows cacheable MAX 1 MONTH → fetched_at + 30d TTL on
  stored rows; display rights to paying tenants need a ToS §3.3 read
  before GA.
- Plays: striking distance (4–20, rank by Nq×traffic-upside);
  cannibalization (same Ph, >1 Ur, same intent → 301/canonical/
  internal-link); keyword gap (competitor top-10, our P0 absent,
  Kd 0–49 for small domains) → new-content brief.

## Microsoft Clarity — VERDICT: DEFER (hedge: install tag at onboarding)

- Data Export API exists but: 10 requests/day, 72h lookback MAX, no
  backfill, 1,000 rows, no pagination; recordings/heatmaps NOT in the
  API. Unique signal vs GA4: per-URL rage/dead clicks, excessive
  scroll, quickbacks, true scroll depth (GA4 scroll = one 90% event).
- v1: skip the integration (no history on day one, sparse-data noise
  for small sites). Hedge: add the free Clarity Wix App at customer
  onboarding so weeks of history exist when v1.x ships the trivially
  small nightly harvester (1 GET/day fits the quota).

## Wix per-page SEO/schema write path — research IN FLIGHT

- Question: can the existing API-key Data/Stores APIs write per-page
  SEO (title/meta/structured data) so the new add_schema/fix_schema
  cards become one-click pushes instead of paste-ready text? Agent
  digesting dev.wix.com now; findings land in the next slice commit.

## Fusion math (ONE ranked rec per page) — research IN FLIGHT

- Frameworks under evaluation: ICE/PIE/RICE applied to SEO, CTR-gap ×
  impressions expected-value math, first-party-over-third-party
  weighting. Output becomes the priority-score upgrade.
