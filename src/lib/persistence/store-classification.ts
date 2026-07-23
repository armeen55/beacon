/**
 * Sprint 7 Phase 7.8b-0 (2026-04-25) — single source of truth for which
 * `.data/*.json` stores are per-tenant, per-tenant singleton, or global.
 *
 * Consumer: the runtime persistence layer (Phase 7.8b-1 / 7.8b-2):
 *       `src/lib/persistence/dotdata-json.ts`
 *       `src/lib/persistence/json-store.ts`
 *     Routes reads/writes to the correct subdirectory based on the
 *     classification.
 *
 * (The Phase 7.8a migration CLI, `scripts/migrate-flat-to-tenant-data.ts`,
 * was the second consumer; it was executed and deleted — 2026-07-21 note.)
 *
 * Keeping a single source prevents drift — a store accidentally
 * promoted to global elsewhere but still tenant-routed at
 * runtime would silently leak across tenants. The shared classification
 * makes that class of bug structurally impossible.
 *
 * Classification rules (verified by Phase 7.8a.1 audit):
 *
 *   - per-tenant array store    → `.data/tenants/{slug}/{name}.json`
 *                                  filtered to ritz-tenant rows in the
 *                                  flat → tenant migration; written
 *                                  per-tenant in 7.8b runtime.
 *
 *   - per-tenant singleton      → `.data/tenants/{slug}/{name}.json`
 *                                  copied verbatim (single object, not
 *                                  an array of rows).
 *
 *   - global                    → `.data/global/{name}.json`
 *                                  cross-tenant: registry, singleton
 *                                  config, operator-shared learning.
 *
 *   - unknown                   → not migrated; runtime falls through
 *                                  to flat (7.8b read-only fallback)
 *                                  or returns null/empty.
 */

export const TENANT_SCOPED_STORES = new Set<string>([
  // Inherited from scripts/backfill-tenant-id.ts (38 stores).
  "imported-results",
  "imported-changes",
  "imported-opportunities",
  "imported-competitors",
  "import-runs",
  "event-decisions",
  "candidate-links",
  "pages",
  "page-snapshots",
  "page-snapshots-prev",
  "page-guardrails",
  "page-issues",
  "scan-findings",
  "observation-runs",
  "scan-runs",
  "daily-metric-snapshots",
  "experiments",
  "change-outcomes",
  "change-contracts",
  "tracked-prompts",
  "tracked-entities",
  "prompt-answer-observations",
  "local-reviews",
  "page-visibility",
  "recommendation-responses",
  "pattern-evidence",
  "asset-responses",
  "outcome-store",
  "competitor-page-evidence",
  // T-CompPageBlueprints (2026-05-08) — per-tenant store of HTML
  // snapshots of TOP-N competitor pages, captured manually by
  // `scripts/scan-competitor-pages.ts`. Used by the LLM packet
  // builder to populate `competitorPageBlueprints[].h1/topH2s/
  // faqQuestions/metaDescription` (replacing the prior hardcoded
  // null/[] producer). Lifecycle is decoupled from
  // `competitor-page-evidence` (citation-derived, frequent) so
  // structural fetches stay rare and bounded.
  "competitor-page-snapshots",
  // 2026-06-24 Rank-&-Revenue Step 3 — deterministic teardown of the competitor
  // pages AI cites instead of the tenant (structure/schema/links/word-count/etc.).
  "competitor-page-audit",
  // 2026-06-29 PageResearchPack DataForSEO producer — per-tenant cache of the SERP
  // "what wins" pattern (format/title/winning-domains) per query, populated by the
  // operator-triggered enrichResearchPacks; read by the research module on the card.
  "research-serp-patterns",
  // 2026-07-01 R4 - per-tenant cache of "which domains do LLM answers cite for a
  // topic" (domains/serp/dataforseo-llm-mentions.ts), the owned AI-visibility feed.
  "dataforseo-llm-mentions",
  // Autonomous, cache-only synthesis of citation phrasing, answer drift, and
  // second-order citation targets. One compact snapshot per explicit tenant.
  "citation-intelligence-snapshot",
  // 2026-06-29 /changes stale-while-revalidate surface cache — the fully-computed
  // TodayMovesHeroData snapshot per tenant. Cold render serves this instantly + refreshes
  // in the background, so the ~32s demand-graph rebuild no longer floors every visit.
  "worklist-surface",
  // 2026-07-15 - atomic customer-visible release shared by Today and Changes
  // (since the 2026-07-21 loader consolidation, the ONLY persisted Today+Changes
  // snapshot; the today-surface / changes-surface shadow blobs are retired).
  // Contains the complete ranked Changes view, Today composite, and New Pages
  // board under one release id so visible state never mixes build generations.
  "customer-surface",
  // 2026-07-03 R4 - /results stale-while-revalidate surface (the RE-MEASURED proof
  // ledger snapshot per tenant), same discipline as worklist-surface. Presentation
  // cache only: measurement history stays in shipped_changes, never here.
  "results-surface",
  // 2026-06-29 cross-request Demand Graph SWR snapshot — the computed LoadGraphResult per
  // tenant. The ~6s graph build is shared across requests (New Pages, Today, Recs, Drafts,
  // page-factory, enrichment) instead of each surface rebuilding it. Versioned + bounded.
  "demand-graph-snapshot",
  "wix-url-map",
  "wix-collection-config",
  // 2026-06-19 Phase 5 — GSC Proof ledger: manually-shipped change records +
  // their measured 7/14/28-day outcome (file fallback before the migration).
  "proof-gsc-ledger",
  "source-pattern-evidence",
  "render-checks",
  "page-snapshot-diffs",
  "page-element-inventory", // Sprint 6A.1 P6; rows already carry tenant_id
  "recommended-edits", // Sprint 6A.1 P11; rows already carry tenant_id
  "url-change-outcomes", // Tier A; rows already carry tenant_id
  // Phase 7.8d-1 (2026-04-26) — flat-fallback removal exposed runtime
  // calls to these stores. Classified now (no migration since flat
  // files weren't on disk for any of them).
  "outcome-events", // canonical-store array of per-tenant event detections
  "rollout-waves", // operator-managed pattern rollouts; single-operator scoped
  "candidate-causes", // canonical-store per-tenant cause-candidate array
  "outcome-observations", // per-tenant outcome-watch row array
  "visibility-observation-runs", // per-tenant visibility import runs (disk-backed)
  // Phase 7.8e-4b follow-up (2026-04-26) — production build prerender of
  // `/settings/health` (which re-exports `/diagnostics`) failed on Vercel
  // because these two stores were referenced by runtime code paths but
  // missing from every classification Set. Pre-7.8d-1 the flat-fallback
  // hid the misconfiguration; post-7.8d-1 it throws fail-loud. Both rows
  // are conceptually per-tenant (answer-snapshots references per-tenant
  // prompt_ids; frontier-opportunities is computed per-tenant from a
  // tenant's pages and citations). Single-operator Ritz today, so any
  // classification routes correctly; per-tenant matches future scaling.
  "answer-snapshots",
  // Phase A.3 (post-A.3.5, 2026-05-15) — sitemap-reconciliation moved
  // from GLOBAL → TENANT_SCOPED. Previously a single
  // `.data/global/sitemap-reconciliation.json` shared across tenants;
  // now per-tenant. Paired with the Supabase mirror
  // (`public.sitemap_reconciliation`) and the loader's repository
  // read path. Retires the cross-tenant hazard the A.3.3b loader's
  // tenant-domain filter defended against — that filter remains as
  // defense-in-depth.
  "sitemap-reconciliation",
  // Wikidata entity grounding (2026-07-02, master plan item 73). Per-entity cache of
  // wbsearchentities lookups keyed by queried person name (src/lib/connectors/wikidata/
  // client.ts). Written from the schema-move build path (a request/build context that
  // already knows the tenant), not a cron fan-out with no ambient context — tenant-scoped,
  // not global like the Wikipedia/DataForSEO market-data caches.
  "wikidata-entity-cache",
  // IndexNow ping receipts (2026-07-02, BEACON_500 item 75). Per-tenant append-only log
  // of every IndexNow ping attempt fired from the verify-live path (src/lib/connectors/
  // indexnow/receipts-store.ts). Written from a request context that already knows the
  // tenant (the push/verify-live call sites), so it belongs here, not in GLOBAL_STORES.
  "indexnow-receipts",
  // On-visit refresh throttle marker (operator spec 2026-07-09, I-59). One tiny row
  // per tenant recording the last time an on-visit auto-refresh fired, so rapid
  // revisits can't trigger a refresh storm (src/domains/ops/on-visit-refresh.ts).
  // Written from the Today render context (ambient tenant), so file-routed
  // tenant-scoped, not a cron-fan-out GLOBAL store.
  "on-visit-refresh-marker",
  // 2026-07-18 cross-tenant leak hardening (finding A) — answer_texts is the
  // per-observation AI answer body, read by discrepancy-detect inside a
  // per-tenant brand/competitor loop. It was GLOBAL, so `.data/answer-texts.json`
  // was one flat cross-tenant blob (Ritz + Iranopedia answer text merged). The
  // consumer only ever looked up its OWN observation ids (globally unique, one
  // tenant each), so the practical leak was bounded, but a flat cross-tenant
  // file is exactly the structural hazard this file exists to remove. Now
  // per-tenant: cold-store routes reads/writes to `.data/tenants/{slug}/
  // answer-texts.json` (with a temporary legacy-flat read fallback in
  // cold-store.ts until every environment re-imports). NOTE: the Supabase
  // `answer_texts` mirror is keyed by observation_id only (no tenant_id column),
  // so on that side isolation still rests on observation-id uniqueness; a
  // tenant_id column would be the follow-up if answer_texts is ever read from
  // Supabase (today cold-store reads the file, never the table).
  // LEGACY (2026-07-21): the ONLY writer of `.data/tenants/{slug}/
  // answer-texts.json` was the Profound CSV import path (cold-store
  // writeAnswerTexts), now deleted with the adapter island. Kept
  // registered because historical `answer_texts` rows live in Supabase
  // and are read directly (by observation id) in
  // domains/citability/mine-answer-patterns; store-classification must
  // still recognize the key for PGRST205 file-fallback + mirroring.
  "answer-texts",
]);

export const SINGLETON_STORES = new Set<string>([
  "citation-evidence-index",
  "robots-state", // per-tenant parsed robots.txt for the tenant's domain
  "url-daily-citations", // per-tenant daily citation series (single-entry)
  "url-watcher-state", // per-tenant watcher throttle/phase state
  // 2026-07-01 BEACON 500 item 1 - trust-budget autopilot: per-tenant config +
  // daily-run marker + receipts (one state object; Supabase-mirrored blob).
  "autopilot-state",
  // 2026-07-02 BEACON_500 item 75 - IndexNow per-tenant config (opaque key +
  // optional host/keyLocation override + optional Bing Webmaster API key). One
  // object per tenant, same singleton convention as autopilot-state. Absent ->
  // the whole lane self-hides (no ping fires, no quota check runs).
  "indexnow-config",
]);

export const GLOBAL_STORES = new Set<string>([
  "tenants",
  "change-patterns",
  "triage-rules",
  "confidence-calibration",
  "business-config",
  "competitor-universe",
  "scan-state",
  // NOTE: "sitemap-reconciliation" was moved to TENANT_SCOPED_STORES
  // as part of Phase A.3 (post-A.3.5, 2026-05-15). See the entry
  // above + the migration in `migrations/<date>_phase_a3_sitemap_reconciliation_mirror.sql`.
  "prompt-library",
  // NOTE: "answer-texts" was moved GLOBAL → TENANT_SCOPED (finding A,
  // 2026-07-18). See the entry + rationale in TENANT_SCOPED_STORES above.
  "cost-ledger",
  // Phase 7.8a.1 (2026-04-25) — globals added from the live dry-run.
  // Each is operator-shared / cross-tenant by design.
  "adjudicator-cache", // LLM dedup cache, no tenant_id; operator-shared
  // 2026-07-03 R16 (P6 LLM engine pack) - the structured-drafter call cache:
  // content-hash (promptId + version + kind + prompts) -> validated output, so
  // an identical regeneration request costs $0. Keyed by content hash, never by
  // tenant path (same posture as adjudicator-cache); capped at 300 entries.
  "llm-call-cache",
  // DataForSEO market-data caches (2026-06-25): public keyword volume / SERP
  // results keyed by location+lang+query — no tenant secrets, identical across
  // tenants, so operator-shared/global maximizes reuse + minimizes spend. WITHOUT
  // this entry readStore/writeStore THROW ("unknown store"), the cache read/write
  // is swallowed, and every paid call re-spends. Registering them makes the
  // 14-day cache actually persist (the cost-discipline guarantee).
  "dataforseo-serp-cache", // SERP top-10 cache (domains/serp/dataforseo-serp.ts)
  "dataforseo-keywords-cache", // keyword-volume cache (domains/serp/dataforseo-keywords.ts)
  // Competitor keyword gap engine (2026-07-02, master plan item 16). The Labs
  // cache is public market data (keyed by endpoint+location+lang+domain, no
  // tenant secrets) - global like the other DataForSEO caches so its 30-day
  // TTL actually prevents re-spend. The results store carries tenant_id rows
  // (ai-engine-gap-summary precedent: the precompute path reads it with no
  // ambient request context, so per-tenant path routing would misfile it).
  "dataforseo-labs-cache", // ranked_keywords/domain_intersection 30d cache (domains/serp/dataforseo-labs.ts)
  "keyword-gap-results", // latest per-tenant gap run (domains/serp/keyword-gap-store.ts)
  // Nightly AI-engines poll (2026-07-01, master plan item 4). Single files whose
  // rows carry tenant_id; the cron fans out across tenants with no ambient
  // request context, so per-tenant path routing would misfile them.
  "ai-engine-answers", // 20h DataForSEO llm_responses answer cache (cost discipline)
  "ai-engine-poll-runs", // per-night already-ran guard (idempotency)
  "ai-engine-gap-summary", // latest per-tenant engine-gap summary ($0 Today + candidate reads)
  // Pipeline invariant watchdog (2026-07-02, master plan item 10). Same cron
  // fan-out rationale as the ai-engine stores: rows carry tenant_id.
  "pipeline-violations", // latest per-tenant pipeline invariant check (Ops card on Today)
  // Cron health ledger (2026-07-03, BEACON_500 item 85). File-fallback mirror of
  // the `cron_runs` table for pre-migration / no-Supabase-env windows. Fleet-level
  // rows (tenant_id nullable) with no ambient request context - same rationale as
  // the peers above.
  "cron-runs",
  // Source-by-source refresh ledger (2026-07-11, refresh-reliability BUG 3).
  // File-fallback mirror of the `refresh_runs` table for pre-migration /
  // no-Supabase-env windows. Rows carry tenant_id in-row; written by the cron
  // fan-out (no ambient request context) AND the manual/on-use refresh paths,
  // so GLOBAL is the safe classification - same rationale as cron-runs.
  "refresh-runs",
  // Site uptime probes (2026-07-03, BEACON_500 T0c). Rows carry tenant_id;
  // written by the nightly sync's uptime phase (no ambient request context,
  // same cron fan-out rationale as the peers above). One HEAD/GET status +
  // TTFB row per tenant per night; the deadman verdict on Today reads the
  // latest two to say "your site did not answer" when down twice in a row.
  "site-uptime-probes",
  // Cold-start crawl frontier (2026-07-03, BEACON_500 R12 / T0e). One state
  // row per tenant (queue + cursor + per-page audit facts) carrying
  // tenant_id, because the nightly sync continues batches with no ambient
  // request context (same cron fan-out rationale as site-uptime-probes).
  // Supabase-mirrored in json-store.ts so the cursor survives Vercel lambdas.
  "crawl-frontier",
  // Idempotent publish outbox (2026-07-03, BEACON_500 R22a / N41). Rows carry
  // tenant_id; written on the push path (a lambda, no ambient request context
  // guarantee for a cron-retry write), so it belongs in the GLOBAL + mirrored
  // set alongside site-uptime-probes rather than the file-routed TENANT_SCOPED
  // set. Supabase-mirrored in json-store.ts so the terminal per-key row
  // survives Vercel lambdas and a retry can never double-publish.
  "publish-outbox",
  // Backup-verification receipts (2026-07-03, BEACON_500 R22a / T0d).
  // LEGACY (2026-07-21, Phase 4A Lane 2): the producer (domains/ops/backup-verify.ts,
  // a final phase of the nightly cron) was deleted with the rest of the cron-era
  // fleet producers - nothing writes new receipts and nothing reads this store on
  // any live surface anymore. Kept registered (not removed) because a real historical
  // blob (backup-verify-receipts::global) still exists in prod; this entry just keeps
  // it classifying correctly if anything ever reads it again. Do not resurrect the
  // producer without re-wiring it to something live.
  "backup-verify-receipts",
  // Release-level blind evaluation receipts. These certify an immutable
  // application SHA rather than a tenant, so they are global. The store is
  // Supabase-mirrored and bounded; failed/spent attempts remain honest evidence
  // but can never grant eligibility (domains/eval/blind-holdout-store.ts).
  "blind-holdout-receipts",
  "blind-holdout-case-events",
  // Nightly precompute warm pass (2026-07-02, master plan item 13). Same cron
  // fan-out rationale: rows carry tenant_id. Per-day run marker (double-fire
  // idempotency) + the "last warmed" receipts /diagnostics shows.
  "precompute-warm-receipts",
  // Trend radar (2026-07-02, master plan item 14). Same cron fan-out rationale:
  // rows carry tenant_id. Latest per-tenant week-over-week query-spike list
  // ($0 Today Demand band + daily plan hint reads).
  "trend-query-spikes",
  // Seasonality engine (2026-07-02, master plan item 21). Same cron fan-out
  // rationale: rows carry tenant_id. Latest per-tenant detected seasonal
  // windows over the permanent GSC monthly archive ($0 Today Demand band +
  // daily plan hint reads).
  "seasonal-windows",
  // Peak calendar (2026-07-02, master plan item 63). Same cron fan-out
  // rationale: rows carry tenant_id. The proven-vs-one_season peak calendar
  // (seasonal windows cross-checked against DataForSEO Labs historical
  // volume) the daily plan candidate feed + any operator calendar surface read.
  "seasonal-peak-calendar",
  // Seasonality engine, family profiles + event calendar (2026-07-02, master
  // plan item 69). Same cron fan-out rationale: rows carry tenant_id. Latest
  // per-tenant per-pageFamily weekly+annual demand profiles (family-demand-
  // profile.ts), read by the event-calendar deriver and the measurement-read
  // seasonal-inflection flag at $0.
  "seasonal-family-profiles",
  // The tenant's own event calendar (BEACON_500 item 69): named recurring
  // windows per page family, either operator-entered or derived from this
  // tenant's own annual GSC peak. Rows carry tenant_id so the derive pass
  // (which runs alongside the seasonality pass, no ambient request context)
  // can merge freshly-derived entries without clobbering operator edits.
  // Beat-Wikipedia finder (2026-07-02, master plan item 23). The article-facts
  // cache is public Wikipedia data (keyed by article title, no tenant secrets) -
  // global like the DataForSEO caches so its 30-day TTL prevents re-fetching the
  // same free API. The results store carries tenant_id rows (keyword-gap-results
  // precedent: New Pages reads it with no ambient request context).
  "wiki-gap-article-cache", // Wikipedia action-API 30d cache (domains/wiki-gap/wikipedia-client.ts)
  "wiki-gap-results", // latest per-tenant beat-Wikipedia run (domains/wiki-gap/wiki-gap-store.ts)
  // Refresh production line (2026-07-02, master plan item 56). Same cron
  // fan-out rationale: rows carry tenant_id. Latest per-tenant ranked refresh
  // queue (pages losing clicks quarter over quarter + evidence briefs; $0
  // Today Demand band + daily plan candidate reads).
  "refresh-queue",
  // Citability rewriter (2026-07-02, master plan item 26). Rows carry
  // tenant_id; a future nightly mining pass would fan out across tenants
  // with no ambient request context, same rationale as the stores above.
  // The mined "what AI actually quotes" pattern profile the daily card +
  // citability hint feed read at $0.
  // Forecast calibration ledger (2026-07-02, master plan items 27/28). Rows carry
  // tenant_id; written from the day-28 measure pass (no ambient request context,
  // same fan-out rationale as the stores above). Append-only per-pick forecast vs
  // actual records the /results "how honest are my forecasts" card and the
  // bias-correction factor in pick-expectations.ts both read at $0.
  "forecast-calibration",
  // Winner memory (2026-07-02, master plan item 30). Rows carry tenant_id;
  // harvested from the measure-pass tail (no ambient request context), same
  // fan-out rationale as the stores above. Retained mature-won before/after
  // text + structural features per actionFamily, read by structured-drafter's
  // few-shot injection at $0 (same LLM calls, richer prompts).
  "winner-memory",
  // A/A calibration harness (2026-07-02, master plan item 31). Rows carry
  // tenant_id; written from the nightly placebo pass (no ambient request
  // context, same fan-out rationale as the stores above). Latest per-tenant
  // measured false-positive rate + per-traffic-tier derived floors, read by
  // measure.ts's readFloorsFor and the /results explainer's honesty sentence.
  "aa-calibration",
  // Algorithm-weather guard (2026-07-02, master plan item 32). Rows carry
  // tenant_id; written from the nightly CUSUM changepoint pass over sitewide
  // daily GSC totals (no ambient request context, same fan-out rationale as
  // the stores above). Latest per-tenant detected shocks, read by the Results
  // page caveat line and the prior/lesson exclusion gate at $0.
  "algorithm-weather-shocks",
  // External-event ledger (2026-07-03, BEACON_500 N32). Rows carry tenant_id;
  // written from the nightly pass that merges algorithm-weather shocks +
  // deadman outages + own-site change clusters into ONE honest-context ledger
  // (no ambient request context, same fan-out rationale as the stores above).
  // Latest per-tenant events, read by the Results caveat line at $0.
  "external-event-ledger",
  // Pooled batch verdicts (2026-07-02, master plan item 34). Rows carry
  // tenant_id; written from the measure-pass tail (no ambient request context,
  // same fan-out rationale as the stores above). One row per (plan, action
  // family) batch that reached the pooling floor, read by /results's compact
  // batch line at $0. Computed-only - never mutates a per-page ledger row.
  "pooled-verdicts",
  // Team scoreboard (2026-07-02, master plan item 38). Rows carry tenant_id;
  // written from the measure-pass tail (no ambient request context, same
  // fan-out rationale as the stores above). Full recompute every time
  // (idempotent, no incremental state) of per-specialist and per (specialist,
  // actionFamily) Brier scores and won/flat/lost tallies, joined from settled
  // proof-ledger verdicts back to the TeamReview voices frozen on the plan
  // pick that shipped them. Read by the Today standup strip's honest
  // best-forecaster footer at $0.
  "team-scoreboard",
  "adjudicator-history", // LLM call audit log; operator-shared
  "llm-budget", // operator-paid monthly LLM spend cap
  "llm-history-specific-edits", // Sprint 6A.2c (2026-04-26) — Specific
  // Weekly strategy review (2026-07-02, master plan item 51). Rows carry
  // tenant_id; written by the Sunday-night cron (no ambient request context,
  // same fan-out rationale as the stores above). Append-only per-week history
  // (last 12 weeks) of the proposed lever mix + focus families + signed memo,
  // read by build-today-preview.ts's multiplier and the Monday recap band.
  "strategy-mix-history",
  // Forensic investigation (2026-07-02, master plan item 53). Rows carry
  // tenant_id; written from the nightly cron's isolated investigation phase
  // (no ambient request context, same fan-out rationale as the stores
  // above). One row per (family, week) diagnosis card: ranked causes for a
  // high-severity page-family collapse, read by the Today investigation
  // card at $0. Idempotent per (tenant_id, family, week) via the row's key.
  "forensic-investigations",
  // Page factory production line (2026-07-02, master plan item 62). Rows carry
  // tenant_id; written by the weekly cron (no ambient request context, same
  // fan-out rationale as the stores above). One row per (tenant, weekOf)
  // batch of demand-validated, drafted-but-staged candidates awaiting the
  // operator's per-page approve/skip on the New Pages board. Idempotent per
  // (tenant_id, weekOf) via the row's key.
  "page-factory-batches",
  // Clone-and-beat briefs (2026-07-02, master plan item 60). Rows carry
  // tenant_id; same keyword-gap-results rationale (the operator-triggered
  // producer has no ambient request context guarantee, and a future cron fan-out
  // would misfile per-tenant paths). Latest per-tenant "their best page, our
  // better version" briefs, read by /competitors at $0 (no live fetch on render).
  "clone-brief-results",
  // Shadow portfolio (2026-07-02, master plan item 65). Rows carry tenant_id;
  // captured at plan time (build-today-preview.ts, no ambient per-tenant
  // request context). Each night's top rejected-but-eligible candidates, kept
  // append-only so the drift measurement pass can compare many nights' worth
  // of "skipped" pages against the pages Beacon actually shipped.
  "shadow-portfolio-candidates",
  // Publish-path canary (2026-07-02, master plan item 86). Rows carry
  // tenant_id; written by the nightly cron (no ambient request context, same
  // fan-out rationale as the stores above). One row per tenant per night:
  // whether the Wix token still authenticates, whether the url-map still
  // resolves a real page, and whether a dry-run push still passes. Read by
  // the publishing-mode card so a dead token or stale url-map surfaces
  // before an operator-accepted change actually fails to push.
  "publish-health",
  // Production error spine (2026-07-03, BEACON_500 R7 / N39). Rows carry
  // tenantId (nullable for fleet-level failures); the highest-value writers
  // are cron fan-outs and next/after background refreshes with NO ambient
  // request context, so per-tenant path routing would throw - same rationale
  // as cron-runs / pipeline-violations above. Capped at 200 rows per tenant
  // bucket on every write (src/lib/obs/error-ledger.ts).
  "app-errors",
  // Opportunity hypothesis log (2026-07-02, DREAM SITE V1 item D7). Rows carry
  // tenant_id; written the moment opportunity-math.ts renders a forecast to the
  // operator (page render has ambient request context today, but a future nightly
  // digest/batch render would not — same fan-out rationale as the stores above).
  // Append-only per (tenant, page, lever, day) log of every forecast Beacon ever
  // showed, so forecast-calibration-store.ts's day-28 settle can be joined back to
  // the exact hypothesis that was on screen when the operator acted (or didn't).
  "opportunity-hypotheses",
  // Demand-ranked question universe (2026-07-03, BEACON_500 R11 / N30). Rows
  // carry tenant_id; rebuilt + written by the nightly cron fan-out (no ambient
  // request context - same rationale as app-errors / publish-health above).
  // Capped at 300 rows per tenant on every rebuild
  // (src/domains/research/question-universe-loader.ts).
  "question-universe",
  // Claim-level provenance graph (2026-07-03, BEACON_500 R13 / N3). Rows
  // carry tenant_id; rebuilt + written by the nightly cron fan-out (no
  // ambient request context - same rationale as question-universe above)
  // AND appended from the ship path when a draft's checked facts register.
  // Capped at 500 rows per tenant on every rebuild
  // (src/domains/provenance/claim-graph-loader.ts).
  "claim-graph",
  // Fact-propagation plans (2026-07-03, BEACON_500 R13b / N26). Rows carry
  // tenant_id; appended from the ship path (same lambda rationale as
  // claim-graph above). Capped at 100 plans per tenant
  // (src/domains/provenance/claim-graph-loader.ts).
  "fact-propagation-plans",
  // Weekly GSC dimension snapshots (2026-07-03, BEACON_500 R17b, v1 136+268).
  // Rows carry tenant_id; written by the nightly cron fan-out with no ambient
  // request context (same rationale as question-universe above). One
  // searchAppearance + one device aggregate per tenant per week, capped at 26
  // snapshots per tenant (src/lib/connectors/gsc/weekly-dimensions-sync.ts).
  "gsc-weekly-dimensions",
  // Fresh-tail volatile presentation cache (2026-07-03, BEACON_500 R17b,
  // v1 264). Rows carry tenant_id; one row per tenant, 3h TTL. Holds Google's
  // EARLY (dataState all) per-day counts for the final-lag window ONLY -
  // never written to the final daily tables (the is_final discipline is
  // inviolable; src/domains/gsc/load-fresh-tail.ts).
  "gsc-fresh-tail",
  // Discover-probe volatile presentation cache (2026-07-03, BEACON_500 R17c,
  // v1 493). Rows carry tenant_id; one row per tenant, 12h TTL. Holds only the
  // aggregate Google Discover totals (a separate feed most properties never
  // receive); a null totals is cached so an unavailable feed does not re-probe.
  // Read-only, never written to the final daily tables
  // (src/domains/gsc/load-footprint.ts).
  "gsc-discover-probe",
]);

/**
 * Scope of a `.data` store. Used by both the migration script (Phase
 * 7.8a) and the runtime persistence layer (Phase 7.8b).
 *
 *   - `per-tenant`: array of rows, each carrying `tenant_id` (or
 *     stamped at the helper boundary). Lives in
 *     `.data/tenants/{slug}/{name}.json`.
 *   - `singleton`:  single object scoped to one tenant. Same path
 *     as per-tenant; the helper does NOT array-filter.
 *   - `global`:     cross-tenant data. Lives in
 *     `.data/global/{name}.json`.
 *   - `unknown`:    not in any of the three Sets. Phase 7.8b runtime
 *     falls back to flat `.data/{name}.json` (read-only, logged).
 *     Phase 7.8a migration leaves these alone.
 */
export type StoreScope = "per-tenant" | "singleton" | "global" | "unknown";

/**
 * Pure / no I/O. Single classification dispatch shared by every
 * caller. Returns `unknown` for any store name not in the three Sets.
 *
 * Fail-loud contract (finding E, 2026-07-18): `classifyStore` deliberately
 * stays PURE and keeps returning `unknown` rather than throwing, because
 * legitimate callers depend on that value:
 *   - ~20 store tests assert a specific scope for their store name (the
 *     executed-and-deleted migration CLI was the other such caller —
 *     2026-07-21 note).
 * The fail-loud guarantee lives at the RUNTIME chokepoints instead, where an
 * unclassified store can actually leak: `readStore`/`writeStore`
 * (json-store.ts) and `readDotDataJson`/`writeDotDataJson` (dotdata-json.ts)
 * all THROW on `scope === "unknown"`, and `resolveDataPath` logs loudly before
 * returning the (never-used-at-runtime) flat shape. So no runtime read/write
 * can silently fall through to a tenant-blind flat path — an unclassified
 * store surfaces immediately as a thrown error, never a cross-tenant leak.
 */
export function classifyStore(name: string): StoreScope {
  if (TENANT_SCOPED_STORES.has(name)) return "per-tenant";
  if (SINGLETON_STORES.has(name)) return "singleton";
  if (GLOBAL_STORES.has(name)) return "global";
  return "unknown";
}
