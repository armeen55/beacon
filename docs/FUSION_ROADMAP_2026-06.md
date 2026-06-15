# Fusion Roadmap — 2026-06

*Research + design doc. No product code changed. Author: Claude (Opus). Date: 2026-06-14.*

---

## Thesis: what "the best merge of all these tools" means for Beacon

Every tool Beacon sits on top of answers exactly one question and stops:

- **GSC** — what real searchers want from *you* (first-party demand, CTR, position, decay).
- **GA4** — what those visits are *worth* (sessions, engaged sessions, conversions/key events).
- **SEMrush** — what the *market* wants and where rivals beat you (third-party volume, difficulty, gaps, cannibalization).
- **Profound** — whether *AI answer engines* cite you (per-URL, per-model citations + share-of-voice + AI-bot crawl + AI-referred visits).
- **Clarity** — whether the page *frustrates humans once they land* (rage/dead clicks, quickbacks, script errors).
- **Wix** — the *only* one that can actually change the live site (publish the fix).

The product's edge is **not re-displaying any one of these** — Profound already has a prettier citation dashboard, SEMrush a deeper keyword tool. The edge is the **join**: ranking *which single edit, on which page, will move money* by fusing demand × value × friction × AI-citation-gap, then **shipping it through Wix and proving the lift with a control group**. No single vendor closes that loop because no single vendor has all six signals *and* a write path *and* a causal proof engine. Beacon already does the spine of this (see `priority-score.ts` and `proof-engine.ts`); the roadmap below is about widening the join where the highest-value signals are currently synced-but-unused or unfused.

The honest north star: **fewer, higher-confidence recommendations, each backed by 2+ independent signals and a dollar estimate, each provable after it ships.**

---

## Per-source: top API capabilities, and what Beacon uses vs. leaves on the table

### Google Search Console API
**Top capabilities (verified):** `searchAnalytics.query` at page/query/date grain, ~16 months history, up to 25,000 rows/request, CTR + impressions-weighted position; `urlInspection.index.inspect` for live index status; `sites.list`; sitemaps. The 2025-26 UI added natural-language report config and (June 3, 2026) **dedicated generative-AI performance reports** isolating AI Overviews / AI Mode impressions.

**Beacon uses:** page+query and page-totals aggregation over 90d (`gsc-page-signals.ts` via `gsc_page_signals_v1`/`gsc_page_totals_v1` RPCs), split-window decay (`gsc_decay_v1`), property auto-pick (`pickGscPropertyForDomain`), 401 self-heal + 429 backoff (`search-analytics.ts`). Drives `gsc_low_ctr`, `gsc_striking_distance`, `gsc_decay`, and the demand half of `answer-block-readiness`.

**Left on the table:**
- **AI Overviews / AI Mode impressions are NOT in the API** (confirmed 2026-06: UI-only, no `aiOverview` `type`, no BigQuery export). Honest gap — cannot be fused programmatically yet; revisit when Google ships it.
- **`urlInspection` live index state** is pulled for indexability triggers but is not fused with *demand* — a high-impression page that's `Crawled - currently not indexed` is a top-priority loss Beacon doesn't surface as such.
- **Query-level striking distance** (a single query on pos 8–20 with high impressions on an otherwise-fine page) — Beacon aggregates to page grain, so per-query opportunities are flattened.

### GA4 Data API
**Top capabilities (verified):** 200+ dimensions/metrics via `runReport`; sessions, engagedSessions, engagementRate, bounceRate, conversions/**key events**, eventValue, purchaseRevenue; landing-page + pagePath + channel grouping + source/medium; 2026 added **cross-channel conversion reporting** in the Data API.

**Beacon uses:** `date`+`pagePath` × `sessions`/`engagedSessions`/`conversions` only (`ga4/data-api.ts::buildRunReportBody`), aggregated 28d into a bounded **page-value multiplier** that weights the priority score (`ga4-page-values.ts::ga4ValueWeight` → `promotion-writer.ts:224` → `promote-to-queue.ts`).

**Left on the table:**
- **`purchaseRevenue` / `eventValue`** — Beacon weights by *conversion count*, not *dollar value*. Revenue is the single most persuasive ranking input and it's one extra metric in the same request.
- **Conversions are never used as proof.** The proof engine measures AI-citation lift only; it does not ask "did GA4 conversions on the edited page rise vs. controls?"
- **Channel grouping / source-medium / landingPage** — no segmentation of organic vs. AI-referred vs. paid; can't isolate the traffic Beacon actually influences.

### SEMrush API
**Top capabilities (verified):** domain organic keywords (`Ph,Po,Pp,Nq,Cp,Ur,Tr,Kd,In` — phrase, position, prev-position, volume, CPC, URL, traffic %, difficulty, intent), keyword gap vs. competitors, backlinks (referring domains, anchors, authority, new/lost), position tracking, SERP features incl. AI Overview presence.

**Beacon uses:** domain organic (`domain-organic.ts`, nightly limit 150 keywords), keyword gap, cannibalization detection. Drives `semrush_striking_distance`, `semrush_keyword_gap`, `semrush_cannibalization`. Third-party signals are deliberately scored *below* first-party GSC (priority-score header).

**Left on the table:**
- **Backlinks / authority** — not pulled at all. Off-site authority is a domain in Beacon (`src/domains/off-site-authority`) but no SEMrush backlink feed reaches it. This is the missing input for "why does my rival outrank me on a page where my content is better."
- **SERP-feature / AI-Overview presence per keyword** — SEMrush flags which of your keywords trigger an AI Overview; never pulled. Could pre-target AEO work where Google is *already* answering with AI.
- **CPC** (`Cp`) is fetched but unused — it's a free proxy for query commercial value where GA4 revenue is absent.

### Profound API
**Top capabilities (verified):** `/v1/reports/citations` (per-date/model/root_domain/url citation count + share), `/v1/reports/visibility` (visibility score, share-of-voice, mentions, executions per model per asset incl. competitors), `/v1/reports/sentiment`, **query-fanouts** (the actual sub-queries an answer engine generates for a tracked prompt), `/v2/reports/bots` (AI-crawler hits per path), `/v2/reports/referrals` (AI-referred human visits per path). Auth `X-API-Key`, 600 req/hr.

**Beacon uses:** nightly sync of citations, visibility, bots, referrals into Supabase (`profound/sync-nightly.ts` + `client.ts`). The proof engine consumes *owned-URL* citations as a gap-fill for native polling (`attribution/profound-proof-observations.ts`).

**Left on the table — the single biggest gap in the product:**
- **No recommendation trigger consumes any Profound data.** Confirmed: `grep profound src/domains/recommendation-intelligence/` is empty. Citations, share-of-voice, query-fanouts, bots, and referrals are all synced into tables that the queue never reads. The owner pays for the best AEO signal in the market and it produces zero recommendations.
- **Query-fanouts are not synced at all** — `queryProfoundReport` supports the `query-fanouts` report name (client.ts:212) but the nightly sync only requests citations + visibility. Fanouts are the literal list of questions to answer for AEO.
- **AI-bot crawl gaps** (`profound_bot_rows`) — a page humans/Google see but GPTBot/PerplexityBot never crawl is an AEO dead zone; synced, unused.

### Microsoft Clarity Data Export API
**Top capabilities (verified):** metrics for ScrollDepth, EngagementTime, Traffic, PopularPages, DeadClickCount, ExcessiveScroll, **RageClickCount**, QuickbackClick; up to 3 dimensions (Browser/Device/Country/OS/Source/Medium/Campaign/Channel/URL). **Hard limit: 10 requests/project/day, only last 1–3 days per call.** JWT token auth, project-admin only. (Rage/dead/quickback/excessive-scroll are API-only — not in CSV export.)

**Beacon uses:** daily per-URL accumulation of sessions, rage/dead/quickback/excessive-scroll/script-errors (`clarity/sync-daily-metrics.ts` → `clarity_daily_url_metrics`), summed 28d into per-page rates (`clarity-page-signals.ts`). Drives `clarity_friction`.

**Left on the table:**
- **EngagementTime / ScrollDepth** — Clarity exposes them; Beacon only fuses *frustration* signals, not *engagement-quality* signals. Low scroll-depth on a long answer page is an AEO/extractability signal (the answer is buried).
- **Source/Channel dimension** — Clarity friction is not segmented by traffic source, so "AI-referred visitors rage-click more than organic" is invisible.

### Wix API (the write path)
**Top capabilities (verified):** Data Items v2 (query/get/insert/**full-replace** PUT update), Data Collections (schema), Blog v3 draft-posts + publish, Site-Media import, **Stores products `seoData.tags`** (writable JSON-LD/title/meta that overrides templates and renders in `<head>`).

**Beacon uses:** field-merge CMS item update with full-field preservation + slug guard (`wix/client.ts::wixUpdateDataItem`), Stores `seoData` PATCH for live BreadcrumbList JSON-LD, blog draft create/publish, media import. The publish layer is real and shipping.

**Left on the table:**
- **CMS dynamic-page SEO is template-based, not per-item** (confirmed in client.ts header) — so per-page title/meta on dynamic pages cannot be written via API; only Stores products have a writable per-item `seoData`. Honest platform ceiling; affects which fixes are auto-shippable vs. handoff-only.
- **Wix has no "what changed on the live site" read** — there's no webhook/audit feed, so shipped-edit verification relies on Beacon's own re-crawl. Fine, but worth noting for the proof loop.

---

## The prioritized roadmap — top fusions, ranked by leverage

Each item fuses 2+ sources into something no single vendor tool does. Effort is rough (S < 1 day, M ≈ 1–3 days, L ≈ 1 week+). "Operator-gated" = needs a Supabase migration or a live write the owner must approve.

### 1. Profound citation-gap × GSC query demand → "write this AEO answer-block first" *(HIGHEST leverage)*
- **What:** For each tracked prompt/category, take Profound's **query-fanouts** + the questions where competitors are cited and *you aren't* (`profound_citation_rows`/`profound_visibility_rows` share-of-voice), intersect with GSC question-shaped queries that already have impressions, and emit a ranked "answer-block to write/expand on page X" recommendation.
- **Why high-leverage:** This is the product's entire reason to exist for AEO, and **the data is already synced but completely unused** — zero net-new API cost. It directly upgrades the existing `answer-block-readiness` trigger from "this page looks question-shaped" to "AI is answering this question *with someone else* and you have the demand to win it."
- **Sources:** Profound (citations + visibility + fanouts) × GSC (`gsc-page-signals.ts` question queries).
- **Effort:** M. Sync already runs; needs (a) add `query-fanouts` to `profound/sync-nightly.ts` (the client already supports it, client.ts:212), (b) a new `profound-citation-gap.ts` loader mirroring `clarity-page-signals.ts`, (c) a new trigger consuming both signals.
- **Seam:** new `src/domains/recommendation-intelligence/triggers/profound-aeo-gap.ts` + loader `profound-page-signals.ts`; wire into `load-trigger-candidates-for-tenant.ts` (the same pre-load → per-snapshot pattern as `gsc`/`clarity`). New `SEVERITY_BY_TRIGGER_SIGNAL` entry in `priority-score.ts`.
- **Gated:** query-fanouts may need a small `profound_query_fanouts` table (migration).

### 2. GA4 revenue × shipped-edit attribution → real-dollar ROI proof
- **What:** Extend the proof engine so that, for every shipped edit, it runs the same diff-in-diff it runs on citations **on GA4 conversions and revenue** for the edited page vs. comparable untreated pages — outputting "this edit drove +$X/mo, p=Y" not just "+N citations."
- **Why high-leverage:** ROI in dollars is the one claim that closes a sale and renews a subscription. The causal machinery already exists (`attribution/natural-controls.ts`, `proof-engine.ts`) and already accepts a per-URL time series; it just needs a GA4 conversions/revenue series alongside the citation series.
- **Sources:** GA4 (conversions + **add `purchaseRevenue`/`eventValue`** to `buildRunReportBody`) × Beacon changelog/shipped-edits.
- **Effort:** M–L. Add revenue metric to the GA4 request (S), persist a per-URL daily conversions/revenue series, feed it into `buildUrlCitationHistory`'s pattern as a second measured series.
- **Seam:** `ga4/data-api.ts::buildRunReportBody` (+1 metric); new `ga4-outcome-observations.ts` mirroring `profound-proof-observations.ts`; `proof-engine.ts` to attribute a second metric.
- **Gated:** likely a `ga4_url_daily` revenue column or new table (migration); GA4 must be connected.

### 3. GSC striking-distance × Clarity friction × GA4 value → "rank the rewrite that will actually convert"
- **What:** When a page is in striking distance (GSC pos 8–20, real impressions) **and** has high Clarity friction (rage/dead/quickback) **and** high GA4 value, fuse all three into one top-priority "rewrite this page" card — because moving it up will send more traffic to a page that currently frustrates valuable visitors. Rank above a striking-distance page with no friction.
- **Why high-leverage:** All three loaders already exist and run in the same pass; today they fire as *separate* cards. Fusing them turns three medium signals into one high-confidence card and prevents recommending a rank push to a page that leaks the traffic.
- **Sources:** GSC (`gsc-page-signals`) × Clarity (`clarity-page-signals`) × GA4 (`ga4-page-values`).
- **Effort:** S–M. All three maps are already loaded in `load-trigger-candidates-for-tenant.ts`; this is a co-occurrence boost in `priority-score.ts` (a new additive term when a page carries 2+ signal classes) or a new fused trigger.
- **Seam:** `priority-score.ts` (add a `fusion_corroboration_bonus`, bounded, below the index-blocker ceiling) consuming flags already available at promotion time in `promote-to-queue.ts`.
- **Gated:** no — pure scoring change on existing data.

### 4. SEMrush backlinks/authority × GSC under-performance → "why your rival outranks you here"
- **What:** Pull SEMrush backlink/authority data (not currently fetched) for the tenant and the rivals SEMrush already names, and for pages stuck below striking distance despite good content, emit "rival X outranks you on this query primarily on links, not content — here's the authority gap."
- **Why high-leverage:** It answers the question every SEO owner actually asks ("why am I losing?") and reframes some content recs as off-site recs — preventing wasted rewrites on pages that are losing on authority, not copy. Feeds the dormant `off-site-authority` domain.
- **Sources:** SEMrush (new backlinks endpoint) × GSC (position/impressions) × `competitor-intel`.
- **Effort:** M. New SEMrush endpoint client + nightly sync + table; a comparative loader.
- **Seam:** new `src/lib/connectors/semrush/backlinks.ts` + `persist-*`; consume in `off-site-authority` and a new diagnostic trigger.
- **Gated:** SEMrush API units cost (backlinks are billable lines); new table (migration). Budget-gated.

### 5. Profound AI-bot crawl gaps × site inventory → "AI engines can't see this page"
- **What:** Cross `profound_bot_rows` (which paths GPTBot/PerplexityBot/etc. actually crawled) against Beacon's page inventory + `robots-blocks-ai-bots` trigger. Pages with real demand/value that AI bots have *never crawled* get a high-priority "make this AI-crawlable" card.
- **Why high-leverage:** A page no AI engine crawls can never be cited — this is the AEO equivalent of `noindex`. The bot data is synced and unused; pairs naturally with the existing `robots-blocks-ai-bots` trigger to move it from "robots.txt looks wrong" to "robots.txt *is* costing you crawls on a page that matters."
- **Sources:** Profound (`profound_bot_rows`) × Beacon inventory × GSC/GA4 value.
- **Effort:** M. New loader + trigger; promote `robots-blocks-ai-bots` out of diagnostic-only when corroborated by real crawl absence.
- **Seam:** new loader; `triggers/robots-blocks-ai-bots.ts` confidence upgrade when bot-gap corroborates.
- **Gated:** Profound Agent Analytics plan required (already fail-soft).

### 6. GSC index-state × demand → "high-demand page Google won't index"
- **What:** Fuse `urlInspection` index verdict (already pulled for indexability) with GSC impressions/demand: a page with real impression demand but a `Crawled - currently not indexed` / `Discovered - not indexed` verdict is a top loss.
- **Why high-leverage:** Indexation failures on demand pages are pure lost revenue and currently the indexability triggers fire *regardless of demand*, so they're not ranked by what they cost. This makes the index-blocker bonus *demand-weighted*.
- **Sources:** GSC (`urlInspection` + search analytics demand).
- **Effort:** S–M. Both signals already load; combine in scoring/trigger.
- **Seam:** `priority-score.ts` `upsideBonus` already exists for clicks — extend index-blocker bonus to scale with demand; or a fused trigger.
- **Gated:** no.

### 7. Clarity scroll-depth/engagement × AEO extractability → "your answer is buried"
- **What:** Add ScrollDepth + EngagementTime to the Clarity sync. On answer/content pages where users barely scroll, fuse with `answer-block-readiness` to recommend moving the direct answer above the fold (the #1 AEO formatting rule: lead every section with the answer).
- **Why high-leverage:** Directly operationalizes the dominant 2026 AEO best practice (answer-first formatting) with *behavioral evidence* that the current answer is too deep. Turns a generic "add an answer block" into "users leave before reaching your answer — move it up."
- **Sources:** Clarity (new metrics) × `answer-block-readiness`.
- **Effort:** M. Add metrics to `clarity/sync-daily-metrics.ts` (mind the 10 req/day cap) + table columns; fuse in the trigger.
- **Seam:** `clarity/sync-daily-metrics.ts`, `clarity-page-signals.ts`, `triggers/answer-block-readiness.ts`.
- **Gated:** new columns (migration); Clarity's 10-req/day budget must be respected.

### 8. SEMrush AI-Overview SERP-feature × content → "Google already AI-answers this — go win the citation"
- **What:** Pull SEMrush's per-keyword SERP-feature flag for AI Overview presence; on pages targeting those keywords, prioritize AEO answer-block + schema work, since Google is *already* synthesizing an answer there.
- **Why high-leverage:** Pre-targets AEO effort to the exact queries where AI answers are live, instead of guessing. Bridges the gap left by GSC not exposing AI Overview data in the API (item is the workaround).
- **Sources:** SEMrush (SERP features) × Beacon content pages.
- **Effort:** M. Add the SERP-feature column to the domain-organic export + a flag in `semrush-page-signals.ts`.
- **Seam:** `semrush/domain-organic.ts::exportColumns`, `semrush-page-signals.ts`, AEO triggers.
- **Gated:** verify the column is in the tenant's SEMrush plan; small unit cost.

### 9. CPC / revenue-aware ranking → weight by dollars, not conversion count
- **What:** Upgrade `ga4ValueWeight` to incorporate GA4 `purchaseRevenue` (and SEMrush `Cp`/CPC as a fallback proxy where revenue is absent) so the priority score ranks by *value*, not raw conversion count.
- **Why high-leverage:** Small change, broad effect — every recommendation gets dollar-aware ranking. CPC is *already fetched* (unused) and revenue is one metric away.
- **Sources:** GA4 (revenue) × SEMrush (CPC).
- **Effort:** S–M. Revenue needs the GA4 request change (item 2 shares this); CPC is already in `domain-organic.ts`.
- **Seam:** `ga4-page-values.ts::ga4ValueWeight`, `semrush-page-signals.ts`.
- **Gated:** revenue needs the GA4 migration from item 2.

### 10. Profound share-of-voice × Wix publish → close the loop on AEO, automatically
- **What:** When Profound share-of-voice for a category drops or a competitor overtakes you, and Beacon has a high-confidence answer-block/schema fix, route it through the existing Wix Stores `seoData` / blog-draft publish path — making Beacon the only tool that *detects* an AEO loss and *ships* the fix.
- **Why high-leverage:** This is the literal "best merge" — sense (Profound) → decide (priority score) → act (Wix). The publish path already exists and is proven for BreadcrumbList JSON-LD.
- **Sources:** Profound (visibility) × Wix (`wixUpdateProductSeoData` / `wixCreateDraftPost`).
- **Effort:** L. Depends on items 1 + 5; the new piece is the SoV-drop → queue → push wiring.
- **Seam:** `promotion-writer.ts` + the Wix push layer; SoV-drop detector loader.
- **Gated:** **Live write — operator-gated by design.** Caps + approval already enforced in `wix/client.ts`.

---

## Quick wins — buildable in < 1 day on data Beacon already has

1. **Fusion corroboration bonus (item 3, scoring-only).** A bounded additive term in `priority-score.ts` when a page already carries 2+ signal classes (GSC + Clarity + GA4 maps are all loaded in `load-trigger-candidates-for-tenant.ts`). No new data, no migration. Immediately surfaces the highest-confidence cards.
2. **Demand-weight the index-blocker bonus (item 6, scoring-only).** Scale the existing `+25` index-blocker bonus by GSC demand using the existing `upsideBonus` log-damping. Pure `priority-score.ts` change.
3. **Add `query-fanouts` to the Profound nightly sync.** The client already supports the report name (`client.ts:212`); the sync just doesn't request it. Even before a trigger consumes it, it starts accumulating the AEO question list for free (needs one small table — borderline same-day).
4. **Use SEMrush CPC as a value proxy.** `Cp` is already fetched in `domain-organic.ts` and dropped on the floor; surface it in `semrush-page-signals.ts` and feed `ga4ValueWeight` as a fallback when GA4 isn't connected. No new API call.
5. **Surface the Profound "unused tables" honestly in the operator diagnostic.** A one-screen read of `profound_citation_rows`/`visibility`/`bots`/`referrals` row counts confirms the data is landing and quantifies exactly how much signal the queue is ignoring — the evidence base for prioritizing item 1.

---

## Honest caveats / unverifiable items

- **GSC AI Overviews / AI Mode data is NOT in the API** (verified 2026-06): the UI added generative-AI performance reports on 2026-06-03, but there is no `aiOverview`/`aiMode` `type`, no `searchAppearance` value, and no BigQuery export. Any "track our AI Overview impressions" fusion is blocked at the source until Google ships it; SEMrush SERP-feature flags (item 8) are the available workaround.
- **Profound API report names beyond citations/visibility/bots/referrals** (sentiment, query-fanouts) are referenced in Beacon's own client (`client.ts:212`) and Profound's public blog, but the exact request/response schema for `sentiment` and `query-fanouts` was **not fully verified** from public docs in this pass — confirm against the live API before building item 1's fanout sync.
- **SEMrush backlinks unit cost** (item 4) — backlink lines are billable; confirm the tenant plan's unit budget before enabling the nightly sync.
- **Clarity's 10-requests/project/day cap** is a hard constraint on items 5/7 — adding metrics/dimensions must stay within the existing daily request budget.

---

*Grounding index (files cited): `priority-score.ts`, `load-trigger-candidates-for-tenant.ts`, `ga4-page-values.ts`, `gsc-page-signals.ts`, `clarity-page-signals.ts`, `semrush-page-signals.ts`, `promote-to-queue.ts`, `promotion-writer.ts`, `proof-engine.ts`, `attribution/profound-proof-observations.ts`, `triggers/answer-block-readiness.ts`, `lib/connectors/{gsc/search-analytics,ga4/data-api,semrush/domain-organic,profound/{client,sync-nightly},clarity/sync-daily-metrics,wix/client}.ts`.*
