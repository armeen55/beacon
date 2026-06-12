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

## Wix CMS dynamic pages — one-time SEO template setup (the owner guide)

Per the Wix write-path research above: CMS dynamic pages have NO
per-item SEO field (staff-confirmed) — their title/description/
structured data come from a PER-PAGE-TYPE template with variables
bound to collection fields, configured ONCE in the dashboard. After
this one-time setup, Beacon's per-item field pushes drive every
page's SEO values automatically.

Steps (Wix Dashboard, ~10 minutes per dynamic page type):
1. Dashboard → SEO → "Edit by page type" → choose the dynamic item
   page (e.g. the encyclopedia article page).
2. Title tag pattern: insert the collection's title field via
   "+ Add Variable" (e.g. `{Articles.title} | Iranopedia`).
3. Meta description pattern: bind a plain-text description field
   (add one to the collection if needed — rich text breaks JSON).
4. "Structured data markup" → "+ Add markup" → paste the Article
   template and bind variables:

   {
     "@context": "https://schema.org",
     "@type": "Article",
     "headline": "{Articles.title}",
     "description": "{Articles.seoDescription}",
     "mainEntityOfPage": { "@type": "WebPage", "@id": "{Page URL}" },
     "author": { "@type": "Organization", "name": "Iranopedia" },
     "publisher": { "@type": "Organization", "name": "Iranopedia" }
   }

   (Add a second markup for BreadcrumbList the same way if the
   collection carries category fields.)
5. Save. Wix renders the JSON-LD server-side on every dynamic page;
   limits: ≤5 markups/page, <7,000 chars, JSON-LD only.

After setup, Beacon's existing `field:` push path (Accept-gated)
writes the bound fields per item — i.e. content-page schema becomes
effectively auto-applied too, with zero further dashboard work.

---

## Profound API — verified implementation spec (night shift, 2026-06-12)

Digested from the OFFICIAL docs (publicly reachable, incl. raw `.md`
mirrors + llms.txt index). Implemented in `src/lib/connectors/profound/`.

- **Auth:** `X-API-Key` header (Bearer also accepted) on
  `https://api.tryprofound.com`. Keys are customer-minted in the
  Profound app, shown once, and EXPIRE → 401 means "re-paste your
  key" UX, not a bug. API is beta + Enterprise/on-request
  (support@tryprofound.com) — onboarding copy must say so.
- **Rate limit:** 600 requests/hour per key (official, confirms the
  operator's figure). Headers X-RateLimit-*; 429 carries Retry-After.
  Nightly sync ≈ 1 + 2·categories requests — trivial.
- **Envelope (load-bearing):** all reports return
  `{info:{total_rows}, data:[{dimensions:[...], metrics:[...]}]}`
  where `dimensions[i]`/`metrics[i]` are POSITIONAL to the request
  arrays. `decodeProfoundEnvelope` is the single owner of that rule;
  arity-broken rows are dropped, never misaligned.
- **Dates:** plain `YYYY-MM-DD`, inclusive both ends, interpreted as
  EST ("Incorrect timezone handling is the most common cause of
  missing or unexpected data"). Freshness UNDOCUMENTED → trailing
  3-day re-pull window with idempotent UPSERTs.
- **Setup deps:** every report call requires a `category_id` —
  discovery via GET /v1/org/categories (+ /v1/org/assets for
  own-vs-competitor via `is_owned`, /v1/org/models for platform
  UUIDs). No query-by-domain for answer-engine data.
- **Endpoints used:** POST /v1/reports/citations (count,
  citation_share × date/model/root_domain/url) + POST
  /v1/reports/visibility (visibility_score, share_of_voice,
  mentions_count, executions × date/model/asset_name). Future:
  /v1/reports/sentiment, /v1/reports/query-fanouts,
  /v1/prompts/answers (per-answer citation_details), /v2/reports/
  {bots,referrals} (these take a raw `domain`).
- **Deprecations:** /v1/logs/raw* sunset 2026-06-10 — use /v2/reports/*.

Sources (≥5, official primary): rest-api/{introduction,
authentication, response-format, date-ranges, changelog};
api-reference/reports/{query-citations, query-visibility};
api-reference/organization/{get-categories, get-assets, get-models};
PyPI `profound` SDK v0.48.0; cooper-square-technologies TS SDK.
(thatmarketingbuddy.com writeup REJECTED — claims OAuth, contradicted
by official docs.)
