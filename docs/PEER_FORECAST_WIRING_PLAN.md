# Peer Move-Forecast wiring — turnkey build plan (the dream's stage-3 for NEW businesses)

> Code-grounded design from the 2026-06-12 night shift. The Proof Engine now
> FIRES (PRs #57–#61: derive→track→recommend→ship→**prove**, 167 persisted
> outcomes for Ritz, verified on the cron). The single biggest remaining gap
> to the DREAM — *"forecast an edit's citation lift from real PEER outcomes
> BEFORE shipping, for ANY business"* — is the **cross-tenant peer forecast**.
> Its pieces are all BUILT but the chain has **zero runtime callers**, so it
> never fires even at n≥2 + gate-on. This note is the verified design so the
> daylight build is turnkey and **cannot silently mis-aggregate**. It is NOT
> rushed at the deadline because the matchKey-alignment crux below is a
> silent-failure risk + the path is privacy-sensitive (operator-review-gated).

## What exists (verified in code)

- `src/domains/recommendations/cross-tenant-brain/producer.ts` — `computeCrossTenantPatterns(args, deps)`: gate-first (`isCrossTenantProducerEnabled` → `[]` when `BEACON_CROSS_TENANT_BRAIN` off), excludes the requester (n=1 → `[]`), reads each OTHER tenant's edit outcomes, delegates to `aggregateCrossTenantPatterns`. **Dependency-injected** — needs real `deps` in production. **No runtime caller passes real deps.**
- `aggregate.ts` — exclude-self + per-`matchKey` rollup + **sample-gate** + scrub(blocklist) + cap. Output `CrossTenantPattern = { patternId, matchKey, helpingRate, sampleSize }` — **structurally anonymous** (closed-vocab matchKey + two numbers; no names, URLs, or free-text leave a tenant).
- `src/domains/product/move-forecast.ts` — `buildPeerMoveForecast({actionType, thisTenantResult, patterns})`: PURE composer, fills in ONLY when this-tenant evidence is thin (`simulateAction` → `insufficient_data`), suppress < `FORECAST_SUPPRESS_BELOW` (3), `seeded` caveat < `FORECAST_SEEDED_BELOW` (10). Returns `MoveForecast | null`.
- `src/domains/attribution/causal-self-forecast.ts` + `forecast-for-recommended-edit.ts` — the this-tenant self-forecast, already surfaced on `/recommendations/[id]` (#42/#43), computed-only reference class via the SHARED `deriveTaxonomyTarget(signal_type, asset_type, url)`.
- `change_outcomes_v2` — now populated (167 Ritz rows). Each `StoredChangeOutcome` carries `primary_bucket`, `child_tags`, `url_type`, `status`, `computed.overall.adjusted_lift`.

## THE crux (must get right, else silent failure): matchKey alignment

The brain aggregates by `matchKey` strings like `edit_type:add_h2_section|intent:cost_question` (`aggregate.ts:51,105`). The proof outcomes are tagged with `primary_bucket` + `child_tags` + `url_type` (the `TaxonomyTarget` from the SHARED `deriveTaxonomyTarget`). These are **two vocabularies for the same concept**. `loadOutcomesForTenant` must map an outcome → `{ matchKey, helped }` using the **exact same token composition** the recommendation/edit side uses when it records a brain outcome — otherwise the brain rolls up by keys that never match the recs, and `buildPeerMoveForecast`'s `patterns.filter(p => p.matchKey.includes(actionType))` finds nothing, **forever, with no error**.

**Verified the specific mismatch (the trap):** `buildPeerMoveForecast` filters `patterns.filter(p => p.matchKey.includes(args.actionType))` where `actionType` is a `SimulationActionType` — a **closed 9-value vocab**: `refresh_content`, `strengthen_structure`, `improve_internal_links`, `expand_page_coverage`, `strengthen_extractability`, `add_faq`, `add_schema`, `add_city_page`, `competitive_displacement` (`whatif-types.ts`). But the proof outcome's `primary_bucket` comes from `SIGNAL_MAP[signal_type].bucket` (`changelog-classifier.ts:146`) — a **different vocab keyed by the changelog `signal_type`**. They do NOT coincide (e.g. a `signal_type:"content"` edit → `primary_bucket` ≠ the string `"add_faq"`). So a naive `matchKey = primary_bucket` would make `.includes(actionType)` match nothing.

**Required before wiring:** (a) build an explicit, total `primaryBucket → SimulationActionType` map (or derive both sides from one source); (b) extract a single shared `composeMatchKey` used on BOTH the rec/forecast side and `loadOutcomesForTenant`; (c) pin alignment with a test asserting a rec's matchKey === the matchKey derived from that rec's eventual proof outcome (the #43 "zero drift" invariant, extended to the brain). Without (a)+(c) the build silently surfaces zero patterns — do not ship without them.

## Turnkey build (daylight, in order)

1. **`composeMatchKey` shared helper** + the drift test above. (correctness foundation)
2. **Production deps factory** `crossTenantProducerDeps()`:
   - `listTenants` → the tenant registry (`ops/active-tenants.json` / tenants table).
   - `loadOutcomesForTenant(t)` → `getRepository().forTenant(t)` read of `change_outcomes_v2` → keep `status==="computed"` (causal-grade only) → map to `{ matchKey: composeMatchKey(...), helped: adjusted_lift > 0 }`.
   - `buildBlocklist` → tenant business-config names + tracked competitor names + owned/competitor domains (defense-in-depth even though patterns are structurally anonymous).
3. **Loader** `loadPeerMoveForecast({tenantId, actionType, thisTenantResult})` → `computeCrossTenantPatterns({tenantId, actionTypes:[actionType]}, deps)` (gated → `[]` until on) → `buildPeerMoveForecast(...)` → `MoveForecast | null`.
4. **Surface** — on `/recommendations/[id]`, when the self-forecast is `insufficient_data`, render the peer line (reuse the existing before-you-ship banner; new `peer_forecast` tone). Honest seeded caveat already in the copy.
5. **Tests:** gate-off → null; gate-on + synthetic 2-tenant fixture → forecast; n=1 → null; matchKey drift pin.

## Privacy posture (why this is gate-first + operator-review-gated)

- `CrossTenantPattern` has **no free-text/name/URL field** — only `matchKey` (closed vocab), `helpingRate`, `sampleSize`. The cross-tenant read in `loadOutcomesForTenant` extracts only `{matchKey, helped}` — structurally anonymous by construction.
- `aggregate.ts` enforces a **sample-gate** (suppress small cohorts — a k-anonymity-style floor) + exclude-self + blocklist scrub + cap.
- Default **`BEACON_CROSS_TENANT_BRAIN` = off** → `[]`, byte-identical to today. Flipping it live is the operator's call (USA-only, CCPA — anonymous patterns only). This matches the locked privacy model.

## Research backing (≥5)

1. Kahneman & Tversky (1979), *Intuitive Prediction: Biases and Corrective Procedures* — the "outside view" / reference-class forecasting that the peer line operationalizes.
2. Flyvbjerg (2006), *From Nobel Prize to Project Management: Getting Risks Right* — reference-class forecasting applied; why peer base rates beat first-party intuition when own-data is thin.
3. Sweeney (2002), *k-anonymity: A Model for Protecting Privacy* — the cohort sample-gate as a minimum-cohort anonymity floor.
4. Dwork (2006), *Differential Privacy* — aggregate-only release + suppression of small groups as the defense for cross-org benchmarking.
5. Google Search Central — *AI features and your website / AI Overviews* guidance — the citation-behavior context the helpingRate forecasts against (AEO).
6. Internal: `cross-tenant-brain/aggregate.ts` + `move-forecast.ts` + the #43 shared-`deriveTaxonomyTarget` "zero drift" invariant — the in-repo mechanisms this plan extends.

**Capability for this build: Max** — cross-tenant data flow + a privacy boundary + a silent-failure correctness crux.
