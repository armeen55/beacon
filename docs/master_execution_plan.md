# Beacon Master Context Vault

> **PURPOSE:** Full-depth context preservation. All history, all ideas, all backlog, all audit details.
> This is where nothing gets lost.
>
> **NOT FOR:** Current state (→ `HANDOFF_VERIFIED_STATE.md`), active execution steps (→ `NEXT_PHASE_EXECUTION_PLAN.md`), system diagrams (→ `architecture.md`), verification proof (→ `VERIFICATION_LOG.md`).
>
> **ORGANIZATION:**
> - § 1 — Repo identity + current repo truth
> - § 2–11 — Domain model, systems, surface specs (REFERENCE)
> - § 12–20 — Infrastructure phases: 0 through 3E (HISTORICAL — all COMPLETE)
> - § Phase 5–37 — Product phases (HISTORICAL — all COMPLETE)
> - § Intelligence 24–31C — Intelligence expansion (HISTORICAL — all SHIPPED)
> - § **Tiered product stack — research-led nano-phases (1.1a–2.3h)** — full mini-prompt ladder (Tier 1 then Tier 2); appears in this file **before** “AUDIT SUMMARY”. Summary tables + launch phases: `NEXT_PHASE_EXECUTION_PLAN.md`.
> - § Upgrade path — Profound → Native data transition plan (FUTURE)
>
> ---
>
> **Phase completion summary (all COMPLETE):**
> Phase 0 — COMPLETE (commit `74605b1`)
> Phase 0.5 — COMPLETE — audit locked minimum Phase 1 scope (15 stores → 12 tables)
> Phase 1A — COMPLETE — Supabase client + 5-table core schema
> Phase 1B — COMPLETE — repositories, seed-data wiring, backfill, validation
> Phase 1C — COMPLETE — 10 remaining tables created + applied via MCP + full backfill verified
> Phase 1D — COMPLETE — repository wiring for attribution, issues, contracts + key mapper
> Phase 1E — COMPLETE — remaining 6 stores wired via centralized modules + route rewires
> Phase 1F — COMPLETE — dual-write engine for 7 import-path entity tables
> Phase 1G — COMPLETE — file-vs-Supabase parity comparison script
> Phase 2 — COMPLETE — progressive cutover to Supabase default
> Phase 3A — COMPLETE — supplementary + visibility + import reads behind repository
> Phase 3B — COMPLETE — operator/pages json-store arrays + Profound bridge importRuns unified
> Phase 3C — COMPLETE — observation-runs file/DB alignment, 15/15 parity achieved
> **Master Product Plan Phase 33** — COMPLETE — Product truth stabilization (Since last scan, finding timestamps, scan terminology, Pages guards + diff confirmation, normalized URL lookups)
> **Master Product Plan Phase 34** — COMPLETE — Today simplification (three-section layout, collapsed visibility/momentum/queue, system status retained)
> **Master Product Plan Phase 35** — COMPLETE — Pages ship-status verdicts; Changes outcome tabs; History ↔ Changes cross-links
> **Master Product Plan Phase 36** — COMPLETE — `business-config.ts`, configurable extractors, `postImportSetup()` automation, competitor type badges
> **Master Product Plan Phase 37** — COMPLETE — `tenant.ts` + `BEACON_TENANT`, per-tenant `.data/tenants/{slug}/`, `/setup` wizard + actions + nav

---

## 1. Current Repo Truth

### Autonomous operating model decision (2026-07-13)

Beacon must not hide its core intelligence behind a sequence of research buttons or depend on cron
for a single-user product. A normal signed-in visit schedules a bounded, once-per-tenant/day
post-response cycle that acquires fresh connector, SEO, AEO, competitor, question, claim and link
evidence before final ranking and draft preparation. Research remains inspectable through a
structured visible receipt, paid work remains cache/ledger/cap guarded, and publishing always
requires its separate safety path. Cron may remain a backup/warm optimization, never the only path.
The receipt should collapse to one calm global status across navigation, while the detailed audit
remains available on Today. Real query evidence must survive into the prepared move; no downstream
intent or draft step may silently replace loaded GSC queries with a guessed label.

### Continuous execution-loop decision (2026-07-15)

Beacon's daily product loop is Today → Changes → Results. Supporting research and receipt surfaces
remain reachable through command search, but they do not compete in the primary sidebar. Changes is
an execution queue, not a second analytics or research dashboard: its visible states are To do and
Ready, exact copy leads, and evidence machinery is collapsed. Measurement and settled outcomes live
on Results.

The ready queue maintains a tenant-scoped floor of five through ordinary signed-in navigation and
after any handled change. Maintenance consumes the already-ranked, already-cached evidence graph,
scans the full authoritative Changes order, prepares only missing capacity under a hard cost cap,
does no live SERP work, and republishes one atomic customer release. The deeper competitor,
DataForSEO, AI, source, and keyword pipeline keeps its once-daily resumable cadence. A rejected
cached draft is preserved for deep or explicit repair rather than regenerated on every visit.

The 2026-07-16 hardening pass extends that same ordinary-use guarantee to owned-site inventory:
unfinished crawl frontiers continue after a response, and a completed crawl re-queues after seven
days. Operator feedback stays inside the single compact Not now menu; a fixed dismissal reason is
persisted through the existing recommendation-response learning path, while deferral is one
truthfully labeled week. Scheduling background preparation must never be presented as completed
work; only a subsequent server surface may claim a new edit is ready.

Deadline recovery follows the same autonomy rule. If a server section misses its bounded deadline,
Beacon retries the current page once automatically after the abandoned load has had time to warm
the durable cache. A per-page session cooldown prevents retry loops. Cold or failed Changes reads
must never assign “refresh and wait” work back to the user.

Results settlement follows the same rule: opening the authenticated Results surface schedules the
existing bounded, zero-paid-call measurement and reverification pass whenever work is due. This
safe maintenance is a product behavior, not an operator-mode feature. Manual proof mutations and
restore actions retain their independent protections. Registration failures must not advance a
throttle for work that never started.

Strict unused-code diagnostics are an audit signal, not deletion authority. Remove proven imports
and locals in bounded batches; review public parameters and algorithm inputs against all callers
before changing them. The 2026-07-16 baseline was 231 diagnostic lines across 113 source-tree files;
the first reviewed batch reduced it to 201 lines and 97 files.
The second reviewed batch examined algorithm-adjacent values rather than deleting by compiler
label, removed only proven residue, and reduced the output to 185 lines across 85 source-tree files.

### Production artifact boundary decision (2026-07-16)

Production server traces may contain compiled Next output, runtime dependencies, and the root
package manifest only. They must not package `.data`, backups, source, tests, docs, scripts,
migrations, Supabase development files, or temporary operator material. Hosted persistence is
Supabase; repository/workstation artifacts are neither runtime dependencies nor deployable data.
This boundary reduced the representative Vercel function from 14.02 MB to 2.18 MB and is pinned by
the `server-trace-local-state-boundary` architecture invariant.

### Identity
- **Name:** `beacon`, private, version 0.1.0
- **Framework:** Next.js 16.2.10, React 19.2.4, App Router
- **Persistence:** `.data/*.json` via `src/lib/persistence/json-store.ts` (comment: "NOT the long-term production architecture"); optional per-tenant roots `.data/tenants/{slug}/` when `BEACON_TENANT` is set (`src/lib/tenant.ts`)
- **Mode:** Single-user first; lightweight tenant isolation for early external users (env-selected slug). No auth/billing/teams in product rules unless explicitly requested.

### Navigation spine (from `src/lib/navigation.ts`)
| Group | Surface | Route | Status |
|-------|---------|-------|--------|
| Default | Today | `/` | Active |
| Default | Your Website | `/pages` | Active |
| Default | Gap ledger | `/topics` | Active |
| Work | Changes | `/changes` | Active |
| Advanced | Review | `/review` | Active |
| Advanced | Sample history | `/results` | Active |
| Advanced | Import | `/import` | Active |
| Advanced | Diagnostics (analyst) | `/diagnostics` | Active |
| Experimental | Draft ideas | `/expansion` | Active |
| Legacy redirect | — | `/opportunities` → `/topics` | Redirect |
| Legacy redirect | — | `/opportunities/[id]` → `/topics/opportunity/[id]` | Redirect |
| Legacy redirect | — | `/actions` → `/` | Redirect |
| System | Setup | `/setup` | Active — business onboarding (Phases 36–37) |

**Multi-tenant disk layout (Phase 37):** when `BEACON_TENANT` is set, route-critical JSON stores resolve under `.data/tenants/{slug}/` via `src/lib/tenant.ts` (see `architecture.md`).

### Persistence stores (all `.data/{name}.json` via `readStore`/`writeStore`)
| Store basename | Domain | Written by |
|----------------|--------|------------|
| `pages` | Page registry | `adapters/profound/import-orchestrator` |
| `page-snapshots` | Crawl snapshots | `scripts/scan-owned-pages.ts` (direct fs) |
| `page-snapshots-prev` | Prior crawl baseline | `scripts/scan-owned-pages.ts` (direct fs) |
| `page-snapshot-diffs` | Snapshot diffs | `scripts/scan-owned-pages.ts` (direct fs) |
| `page-guardrails` | Guardrail alerts | `scripts/scan-owned-pages.ts` (direct fs) |
| `page-issues` | Persisted issues | `domains/pages/issues.ts` |
| `render-checks` | Render check results | `scripts/scan-owned-pages.ts` (direct fs) |
| `observation-runs` | Website crawl runs | `scripts/scan-owned-pages.ts` (direct fs) + `storage/canonical-store.ts` |
| `scan-runs` | Legacy crawl runs | `scripts/scan-owned-pages.ts` (direct fs) |
| `citation-evidence-index` | Citation rollup | `scripts/build-page-registry.ts` (direct fs) |
| `sitemap-reconciliation` | Sitemap reconciliation | `scripts/scan-owned-pages.ts` (direct fs) |
| `imported-results` | Imported result rows | `lib/import/actions.ts` |
| `imported-changes` | Imported changelog | `lib/import/actions.ts` |
| `imported-opportunities` | Imported opportunities | `lib/import/actions.ts` |
| `imported-competitors` | Imported competitors | `lib/import/actions.ts` |
| `import-runs` | Import run records | `lib/import/actions.ts` |
| `candidate-links` | Attribution candidates | `domains/attribution/store.ts` |
| `truth-labels` | Attribution truth labels | `domains/attribution/store.ts` |
| `event-decisions` | Review decisions | `domains/attribution/store.ts` **AND** `storage/canonical-store.ts` |
| `action-states` | Action state | `domains/actions/store.ts` |
| `brief-states` | Brief generation state | `domains/brief-generation/store.ts` |
| `change-contracts` | Change contracts | `domains/changelog/change-contract.ts` |
| `asset-responses` | Asset response records | `domains/pages/asset-response.ts` |
| `frontier-opportunities` | Frontier gaps | `domains/pages/frontier-planner.ts` |
| `frontier-attack-packages` | Attack packages | `domains/pages/frontier-compiler.ts` |
| `tracked-missing-pages` | Missing page plans | `domains/pages/frontier-compiler.ts` |
| `competitor-page-evidence` | Competitor evidence | `domains/pages/competitor-evidence.ts` |
| `source-pattern-evidence` | Source patterns | `domains/pages/competitor-evidence.ts` |
| `rollout-executions` | Rollout tracking | `domains/pages/issues.ts` |
| `pattern-evidence` | Pattern evidence | `domains/pages/issues.ts` |
| `rollout-waves` | Wave planner | `domains/pages/wave-planner.ts` |
| `outcome-observations` | Outcome watch | `domains/pages/outcome-watch.ts` |
| `recommendation-responses` | Rec accept/dismiss/defer | `domains/product/recommendation-response-store.ts` |
| `competitor-universe` | Competitor config | read via `readDotDataJson` in `universe-read.ts` |

### Cold stores (`.data/` non-json-store paths)
| Path | Content | Access |
|------|---------|--------|
| `.data/answer-texts.json` | ~9,596 entries, ~27 MB | `cold-store.ts` on-demand |
| `.data/citations-by-date/{date}.json` | ~85,004 citation rows | `cold-store.ts` sharded |

### Known structural issues
| Issue | Location | Severity |
|-------|----------|----------|
| **Dual `ObservationRun` types** | `domains/observations/types.ts` (run_id, pages_scanned, website_crawl) vs `domains/observation-runs/types.ts` (id, account_id, platform, prompt_count) — different shapes, same store basename | BLOCKING |
| **Dual `event-decisions` writers** | `domains/attribution/store.ts` and `storage/canonical-store.ts` both read/write `event-decisions` | MEDIUM — same cached array at runtime, but conceptually fragile |
| **`docs/architecture.md` weights stale** | Documents weights as platform=25, topic=25, url=20, temporal=20, geo=10. Actual in `config.ts`: platform=20, topic=25, url=5, geo=15, temporal=20, sourceCategory=15 | LOW — doc drift only |

### Attribution system status (from HANDOFF_VERIFIED_STATE.md)
- 6-factor scoring: platform(20), topic(25), url(5), geo(15), temporal(20), sourceCategory(15)
- Evidence tiers: exact(+8 bonus), probable(cap 85), weak(cap 55), inferred
- Triage: primary(≥65, gap≥15), suppress(≤45), contributing(≥55)
- Auto-resolved: 13/45 events (29%)
- Review candidates: 77 (down from ~196)
- Citation topic bonus: +12
- Page registry: 5,297 pages (42 owned)

---

## 2. Target Product / System Truth

### What Beacon is becoming
A trust-first AI visibility operating system for builder/home-services businesses and the operators serving them. Not a dashboard, not vanity analytics, not fake attribution theater.

### Core operator loop
1. Observations — what did the site **scan** / visibility **sample** find?
2. Inventory — what pages, topics, competitors exist?
3. Deltas — what changed since last run?
4. Work queue — what matters next?
5. Change + verification — log the change, verify it shipped, check structural outcome
6. Attribution — bookkeeping, not proof. What correlates, with what honesty level?

### Default layer answers
- What changed?
- What broke?
- What matters next?
- What can we verify?
- Where are competitors winning?

### Target architecture (selected from roadmap, classified)

| Component | Decision | Rationale |
|-----------|----------|-----------|
| PostgreSQL via Supabase | **ADOPT WITH MODIFICATION** | json-store explicitly temporary; but single-workspace first, no RLS/workspaces yet |
| Inngest orchestration | **ADOPT WITH MODIFICATION** | Good fit for Next.js; adopt when there's a pipeline to orchestrate (Phase 2, not Phase 0) |
| Crawlee/Playwright crawl | **ADOPT WITH MODIFICATION** | Incremental upgrade from existing puppeteer-core+cheerio; keep existing `extractor.ts` |
| Native API visibility sampling | **ADOPT WITH MODIFICATION** | Start with Perplexity (1 engine, 3-5 samples/query); replace Profound dependency over time |
| ≥30 samples per query per platform | **DEFER** | Expensive; start with 3-5 samples after pipeline proven |
| SCD Type 2 competitor membership | **DEFER** | Current universe versioning + fingerprinting + pinning works for single-user |
| Bayesian attribution (CausalImpact, PELT, DiD) | **DEFER** | Needs 90+ days of time series; current 6-factor scoring is calibrated and working |
| Dempster-Shafer evidence fusion | **REJECT** | Complexity exceeds precision gain for single-operator tool |
| Multi-workspace / RLS / auth | **DEFER** | Explicitly single-user per rules and PRD |
| Materialized views | **DEFER** | No database exists yet; premature |
| 6-tier evidence taxonomy (observed/verified/imported/derived/heuristic/stale) | **ADOPT WITH MODIFICATION** | Use as data-provenance labels, NOT to replace current 4-tier scoring evidence |
| Cross-platform audience-weighted SOV | **DEFER** | No calibration data for platform weights |
| Repository pattern with feature flags | **ADOPT** | Right migration strategy for file→DB |
| Staleness decay functions | **ADOPT** | Simple exponential decay; wire into Today dashboard |
| Zone-based fingerprinting | **ADOPT** | Add `meta_hash` and `link_hash` to existing 4-zone hashes |

---

## 3. Current vs Target Delta Matrix

| Subsystem | Current | Target | Delta | Phase |
|-----------|---------|--------|-------|-------|
| **Observation model** | Two incompatible `ObservationRun` types | Single unified type | Resolve dual types | **Phase 0** |
| **event-decisions store** | Two modules write same store | Single writer | Consolidate | **Phase 0** |
| **Architecture docs** | Stale weights, missing current state | Updated docs match code | Update docs | **Phase 0** |
| **Test infrastructure** | None | Vitest + golden files + invariant tests | Add test framework | **Phase 0** |
| **Persistence** | `.data/*.json` files | PostgreSQL via Supabase | Repository pattern migration | Phase 1 |
| **Website crawl** | Manual CLI `npm run data:scan` | Inngest-scheduled nightly crawl | Automate | Phase 2 |
| **Visibility data** | Imported from Profound | Native API sampling (Perplexity first) | New capability | Phase 3 |
| **SOV calculation** | Not computed natively | `citations / total_slots` per platform with CI | Implement with native sampling | Phase 3 |
| **Competitor universe** | File-based versioning + pinning | DB-backed with history | Migrate | Phase 2 |
| **Gap ledger** | File-backed frontier/attack stores | DB-backed | Migrate stores | Phase 2 |
| **Attribution scoring** | 6-factor, calibrated, working | Keep as-is | None needed | — |
| **Change contracts** | File-backed, working | DB-backed | Migrate store | Phase 1 |
| **Review / triage** | Working, calibrated thresholds | Keep as-is | None needed | — |

---

## 4. Core Objects / Domain Model

### Primary domain types (current, canonical)

| Type | File | Key Fields | Persisted In |
|------|------|-----------|-------------|
| `ObservationRun` (website) | `domains/observations/types.ts` | run_id, run_type, pages_scanned, competitor_universe_pin fields | `observation-runs` store |
| `VisibilityObservationRun` | `domains/observations/visibility-types.ts` | run_id, run_type, is_synthetic_wrapper, counts, competitor pin fields | `visibility-observation-runs` dotdata or synthetic |
| `PageEntity` | `domains/pages/types.ts` | id, url, domain, path, page_type, ownership_tier, is_owned, topics | `pages` store |
| `PageSnapshot` | `domains/pages/types.ts` | id, page_id, observation_run_id, content_hash, headings_hash, faq_hash, schema_hash | `page-snapshots` file |
| `PersistedIssue` | `domains/pages/issues.ts` | issueId, status (7 states), verificationObservationRunId, verifyResult | `page-issues` store |
| `Result` | `domains/results/types.ts` | id, platform, metric fields, topic, visibility_observation_run_id | `imported-results` store |
| `ChangelogEntry` | `domains/changelog/types.ts` | id, signal_type, asset_type, topic_targeted, source_system | `imported-changes` store |
| `ChangeContract` | `domains/changelog/change-contract.ts` | contractId, changeType (30 types), attributionReadiness, expectedVerification | `change-contracts` store |
| `Opportunity` | `domains/opportunities/types.ts` | id, query_text, platforms, status (10 states), priority, source | `imported-opportunities` store |
| `Competitor` | `domains/competitors/types.ts` | id, domain, source_of_truth (imported_entity \| demo_seed) | `imported-competitors` store |
| `ConfiguredCompetitorEntry` | `domains/competitors/universe-types.ts` | id, domain, display_name, status | `competitor-universe` dotdata |
| `CandidateLink` | `domains/attribution/types.ts` | id, result_id, change_id, status, attribution | `candidate-links` store |
| `EventDecision` | `domains/attribution/types.ts` | id, event_id, cause_type, primary_change_id, rejected_change_ids | `event-decisions` store |
| `FrontierOpportunity` | `domains/pages/frontier-planner.ts` | frontierOpportunityId, topic, citationOpportunity, recommendedMoveType | `frontier-opportunities` store |
| `FrontierAttackPackage` | `domains/pages/frontier-compiler.ts` | frontierAttackPackageId, pagesToRepair, pagesToCreate, executionSteps | `frontier-attack-packages` store |
| `Brief` | `domains/briefs/types.ts` | id, status, checklist, expected_outcomes, retrospective | seed only |
| `GuardrailAlert` | `domains/pages/guardrails.ts` | page_id, severity, category, message, observation_run_id | `page-guardrails` file |

### Deprecated / to-unify types
| Type | File | Issue | Resolution |
|------|------|-------|------------|
| `ObservationRun` (prompt-centric) | `domains/observation-runs/types.ts` | Different shape from website `ObservationRun`; used only by `storage/canonical-store.ts` and Profound adapters | Phase 0: rename to `ProfoundObservationRun` or unify |

---

## 5. Observation System

**CURRENT FACT:** Two observation spines exist.

1. **Website observations** — `domains/observations/types.ts` → `ObservationRun` with `run_id`, `run_type` (website_crawl, website_verify), artifact counts. Read via `observations/read.ts` → `SeedDataRepository.getObservationRuns()`. On file backend, that merges typed rows from `.data/observation-runs.json` with legacy `.data/scan-runs.json` (Profound-shaped objects in the same file are skipped — see Phase 3C).

2. **Visibility observations** — `domains/observations/visibility-types.ts` → `VisibilityObservationRun` with `run_type` (citation_sample_import, prompt_results_import, composite). Read via `visibility-read.ts` from `.data/visibility-observation-runs.json`, plus synthetic wrappers from citation index and seed walkthrough.

3. **Profound observations** — `domains/observation-runs/types.ts` → different `ObservationRun` shape (id, account_id, platform, prompt_count). Used only by `storage/canonical-store.ts` and `adapters/profound/`.

**TARGET STATE:** Single unified run model. All runs are rows in one collection (later one DB table). Run types distinguish website crawl, website verify, visibility sample, profound import, etc.

**DELTA:** The Profound `ObservationRun` type must be renamed or merged so it doesn't collide with the website `ObservationRun`. Since only `storage/canonical-store.ts` and `adapters/profound/` import it, the blast radius is small.

**DECISION:** Phase 0 — rename `domains/observation-runs/types.ts::ObservationRun` to `ProfoundImportRun`. Update the 3 files that import it.

---

## 6. Crawl System

**CURRENT FACT:** `scripts/scan-owned-pages.ts` is a CLI script using `puppeteer-core` + `cheerio`. Extraction is in `domains/pages/extractor.ts` (cheerio-based, produces `PageSnapshot` with 4 zone hashes). Script writes directly to `.data/` files (not via `json-store`). Produces: snapshots, diffs, guardrails, render checks, sitemap reconciliation, observation runs.

**TARGET STATE:** Crawlee-wrapped crawl with Playwright, scheduled via Inngest. Existing `extractor.ts` kept as extraction layer inside Crawlee request handler. Results written to DB.

**DELTA:** Phase 2. Not touched in Phase 0 or 1.

---

## 7. Visibility System

**CURRENT FACT:** All visibility data is imported from Profound CSV via adapters. `VisibilityObservationRun` wrappers are synthetic (built from citation index or seed walkthrough). `Result` rows carry optional `visibility_observation_run_id`. No native API sampling exists.

**TARGET STATE:** Native API sampling via Perplexity (first), then ChatGPT/Gemini. SOV calculation with confidence intervals. Synthetic wrappers eliminated.

**DELTA:** Phase 3. Large new capability. Not touched until DB and crawl automation are stable.

---

## 8. Competitor System

**CURRENT FACT:** Competitor universe stored in `.data/competitor-universe.json` (v1 or v2 schema). Resolved at runtime by `universe-read.ts` into `CompetitorUniverseRuntime` with `origin` (configured_file, empty_import_mode, demo_defaults_explicit). Observation runs stamped with competitor universe version/fingerprint/scope/pin_status at write time.

**TARGET STATE:** DB-backed competitor storage. Keep current universe versioning + fingerprint + pinning model (it works). Defer SCD Type 2.

**DELTA:** Phase 2 (migrate store to DB). Current system is functional.

---

## 9. Gap Ledger / Opportunity Engine

**CURRENT FACT:** `domains/product/gap-ledger.ts` defines 5 evidence classes (observed_page_gap, competitor_asset_gap, coverage_gap, technical_gap, inferred_draft_idea). Frontier planner computes `FrontierOpportunity` per topic. Frontier compiler produces `FrontierAttackPackage`. Wave planner prioritizes rollouts. Playbook mines patterns from validated changes and generates briefs. All file-backed.

**TARGET STATE:** Same logic, DB-backed stores. Add simplified RICE priority formula when native citations available.

**DELTA:** Phase 2 (migrate stores). Phase 3 (wire native citation data).

---

## 10. Change / Verify / Review / Attribution System

**CURRENT FACT:**
- Attribution: 6-factor scoring calibrated to real data. Evidence tiers wired into scoring with caps. Auto-resolve at 29%.
- Triage: primary/contributing/needs_review/suppressed with tuned thresholds.
- Scorecard: per-change verdicts with event attributions and trust sources.
- Review: operator decides events via `EventDecision` persisted to `event-decisions` store.
- Changes: `ChangelogEntry` imported + `ChangeContract` system for verification tracking.
- Verification: `PersistedIssue` with 7-status lifecycle, verify run stamping, baseline linkage.

**TARGET STATE:** Same logic, DB-backed. No changes to scoring formulas, thresholds, or attribution approach.

**DECISION:** The attribution system is working and calibrated. Do not replace with Bayesian methods, Dempster-Shafer, or new scoring formulas until 90+ days of native sampling data exists. **DEFER** all statistical attribution upgrades.

---

## 11. Surface-by-Surface Product Spec

| Surface | Route | Role | Key data sources |
|---------|-------|------|-----------------|
| **Today** | `/` | **Findings inbox** (“Since last scan”, always visible) → **Top recommendation** → **System status** (data sources); visibility/KPI/momentum/queue behind one toggle | Findings store, `today-summary.ts`, recommendations, snapshots, citation index |
| **Your Website** | `/pages` | Execution workbench: ship-status verdict, guarded recommendations, normalized URL lookups, scan terminology, diff confirmation when unchanged | Page snapshots, findings, guardrails, `business-config` (extractor terms) |
| **Gap ledger** | `/topics` | Typed opportunity gaps. Frontier list + detail drilldown | Frontier planner, compiler, citation index, competitor evidence |
| **Gap detail** | `/topics/opportunity/[id]` | Single frontier detail with attack package + provenance | Frontier compiler, citation evidence, pages, competitor universe |
| **Changes** | `/changes` | Change log + contracts + **impact table** + **outcome category tabs**; cross-link to History | Change contracts, `computeScorecard`, `enrichWithImpact` |
| **Change detail** | `/changes/[id]` | Single change: verdict + **impact assessment** + **"Apply this pattern"** (replicate recs for this change) + **"Strengthen this entry"** (evidence nudges) + event attributions | Scorecard row, `change-impact.ts`, `computeRecommendations`, event attributions |
| **Review** | `/review` | Attribution decisions queue. Lock/reject/confirm per event | Events, candidates, triage, decisions |
| **Sample history** | `/results` | Imported rows + **KPI strip** + **platform / trust composition** visuals + filters; tab to **Measurement detail** ↔ Changes | Results, drivers, visibility observation runs |
| **Result detail** | `/results/[id]` | Single result with event linkage + match factors | Results, candidates, attributions |
| **Import** | `/import` | Workbook/CSV import with progress | Import engine, workbook parser |
| **Diagnostics** | `/diagnostics` | Pipeline debug. Full attribution/pattern/cluster analysis | All attribution + pattern + cluster + candidate domains |
| **Draft ideas** | `/expansion` | Experimental. System-derived opportunity candidates | Opportunity candidates compute |
| **Competitors** | `/competitors` | Citation benchmark + KPI strip + ranked threats + topic signals + co-mention / source trust / local pressure / battlecards (viz primitives) | Citation index, `computeMarketBenchmark`, co-mention, trust index, geo coverage, battlecards |
| **Observations** | `/observations/[id]` | Run detail (website or visibility) | `resolveObservationById` → website or visibility run |

### Intelligence expansion + visual terminal (Phases 24–31) — status as of 2026-04-10

**Domains 24–30:** Shipped per `HANDOFF_VERIFIED_STATE.md` (sampling, co-mention, outcome store, genealogy, decay, source trust, entity/discrepancy, geo coverage, journey, Beacon Score, extractability, battlecards, snippet intel, advanced scaffolds).

**Phase 31 — Visual intelligence + Pulse + reports:** Shipped — `src/components/viz/*` primitives (inline SVG/CSS, `"use client"`), Pulse (`pulse.ts`), report generator (`report-generator.ts`), Diagnostics/Today/Competitors battlecard wiring.

**Phase 31B — Additional primitives + Today/Diagnostics polish:** Shipped — `AreaChart`, `KpiCard`, `ComparisonBar`, `RadialScore`, `ViewToggle`, `FilterChips`, `VizSection` / `ChartTableSection`, `BeaconScoreVisual` (bars↔radial).

**Phase 31C — Route visual saturation (same checkpoint):** Shipped — consistent KPI + chart/table toggles + distribution visuals across major routes without changing domain logic or data:
- **Competitors** (`page.tsx`, sections): KPI strip; leaderboard share bars; “Thinnest share” bars; co-mention `FilterChips` + `ViewToggle` + `MiniBarChart`; local pressure `ComparisonBar` + `ViewToggle`; source-trust per-row citation bars.
- **Pages** (`pages-client.tsx`): top summary → `KpiCard` grid + `DonutRing` status mix.
- **History** (`results-client.tsx`): “At a glance” → `KpiCard` strip; `PlatformSplit` + `DonutRing` for platform and trust mix (replaces prior StatCard-only row where data supports it).
- **Today** (`today-client.tsx`): system details crawl + visibility counts → `KpiCard` grids; secondary opportunities use `ConfidenceBadge`.
- **Diagnostics** (`page.tsx`): `StatBlock` restyled to align with KPI visual language; cluster status + verdict distributions use `StackedBar`.

**Abstraction for future swaps (shipped):** `chart-types.ts` (prop contracts), `src/lib/view-models/*` (domain → chart props), `src/lib/data-adapters/*` (`getAdapters()` swap point; `createProfoundAdapters()` today). Routes may incrementally adopt view-models; charts remain swappable behind interfaces.

**Opportunities route:** `/opportunities` redirects to `/topics` — no standalone visual surface.

### Master Product Plan — Phases 33–37 (COMPLETE, 2026-04-11)

| Phase | Theme | Shipped highlights |
|-------|--------|-------------------|
| **33** | Product truth stabilization | Always-visible “Since last scan” on Today (`FindingRow` shows `detectedAt`); user-facing **scan** terminology on Today/Pages; removed dead `onVerify` from Pages; “No changes since last scan” in Pages diff; recommendation block guarded when page has pending findings; `pages/page.tsx` lookups use normalized URLs |
| **34** | Today simplification | Three sections: **Findings inbox** → **Top recommendation** → **System status**; KPIs/momentum/experiments/what-changed/secondary opportunities/work queue behind **“Visibility, momentum & queue”**; **“Since last scan”** always visible (**All clear** when empty; **pending** counts + queue when findings exist); accepted findings awaiting promotion kept; data sources at bottom |
| **35** | Verdict layer | Pages detail: ship status line (“Verified live · date”, changes detected, not scanned, N changes — verify in Today); Changes: outcome tabs (All / Proven winners / Mixed signals / No measurable impact / Too early); History ↔ Changes companion tabs (Outcomes ↔ Measurement detail) |
| **36** | Business abstraction + launch prep | `src/lib/business-config.ts` (`BusinessConfig`: name, domain, industry, locations, services, competitors, directoryDomains, scanSettings); `extractor.ts` reads location/service terms from config; `postImportSetup()` after workbook import (registry + scan); `classify-type.ts` + Competitors badges |
| **37** | First external users (infra) | `src/lib/tenant.ts` + `BEACON_TENANT` + `.data/tenants/{slug}/`; `/setup` two-step form; `setup/actions.ts`; Setup under **System** in `navigation.ts` |

**New / touched files (reference):** `business-config.ts`, `classify-type.ts`, `tenant.ts`, `app/(shell)/setup/page.tsx`, `app/(shell)/setup/actions.ts`; updates across `today-client.tsx`, `pages-client.tsx`, `pages/page.tsx`, `changes/*`, `competitors/page.tsx`, `results-client.tsx`, `import/page.tsx`, `import/actions.ts`, `navigation.ts`, `extractor.ts`.

**Next:** prioritize feedback from first external users; keep Phase 31 partial items (PDF export, notification badge, geo Stage-2) and intelligence **execution** Phase 33+ (native multi-model — see `NEXT_PHASE_EXECUTION_PLAN.md`) as normal backlog, not blockers for the product track above.

---

## 12. Jobs / Orchestration

**CURRENT STATE (Phase 32B + Product Phases 33–37):** Auto-scan on Today load when overdue. Findings prioritized by citation volume, homepage status, severity, and type. Actions have consequences (suppression, false-positive tracking, promotion). **Product Phase 33–34:** “Since last scan” always visible on Today (including empty “All clear”); finding rows show `detectedAt`; operator copy uses **scan** (not crawl) on Today/Pages; Pages shows a warning before recommendations when pending findings exist; page detail lookups use normalized URLs. **Product Phase 35:** Pages detail shows ship/scan verdict line; Changes adds outcome category tabs; History and Changes cross-link with companion tabs. **Product Phase 36–37:** Business profile in `src/lib/business-config.ts` drives extractor terms; `postImportSetup()` runs registry + scan after import; competitors classified Direct/Directory/Editorial/Other; optional `BEACON_TENANT` + `/setup` onboarding. CLI scripts remain manual fallbacks.

| Script / Trigger | Command / Mechanism | Writes |
|--------|---------|--------|
| `scan-owned-pages.ts` | `npm run data:scan` (manual) or auto via `triggerPageScan()` on Today load | snapshots, diffs, guardrails, render checks, observation runs, scan runs, reconciliation |
| Auto-scan trigger | `isScanOverdue()` in `page.tsx` → `triggerPageScan()` → `generateFindings()` | `scan-findings.json` (findings with priority, approval, promotion statuses) |
| `build-page-registry.ts` | `npm run data:registry` | pages.json, citation-evidence-index.json |
| `score-snapshot.ts` | `npm run data:score-snapshot` | stdout diagnostics only |

**Scan settings:** `.data/scan-settings.json` — `preferredHour` (default 9), `timezone` (default America/Los_Angeles), `scope`, `enabled`. No external cron — overdue check runs on Today page load.

**FUTURE STATE:**
- Inngest or external scheduler for fully background scans (when deployed)
- CLI scripts kept as manual fallbacks

---

## 13. Persistence / Storage Evolution

**CURRENT FACT:** `json-store.ts` — in-process cache, atomic write via temp+rename. `readDotDataJson` — uncached reads. `cold-store.ts` — sharded citation data.

**TARGET STATE:** PostgreSQL via Supabase, repository pattern, feature flag (`DATA_SOURCE` env var).

**IMPLEMENTATION ORDER:**
1. Phase 0: No persistence changes. Fix code-level issues only.
2. Phase 1: Supabase project + core tables + repository pattern + dual-write + backfill + cut over.
3. Phase 2: Crawl pipeline writes to DB. Remaining stores migrated.
4. Phase 3: Visibility data in DB. Cold citation store migrated.

---

## 14. Evidence Taxonomy

**CURRENT FACT — attribution scoring evidence (4 tiers):**
| Tier | Scoring effect | Source |
|------|---------------|--------|
| exact | +8 bonus, no cap | `has_structural_url` + `snapshot_verified` in page registry |
| probable | cap at 85 | structural URL match without snapshot verification |
| weak | cap at 55 | no structural URL match |
| inferred | no bonus | fallback |

**CURRENT FACT — gap evidence classes (5 classes):**
| Class | Description |
|-------|------------|
| observed_page_gap | Scanner/citation vs owned HTML |
| competitor_asset_gap | External domains win more citations |
| coverage_gap | No suitable owned URL for theme |
| technical_gap | Crawl/render/index blockers |
| inferred_draft_idea | Heuristic, weaker than observed |

**TARGET STATE:** Keep both taxonomies. Add data-provenance labels (observed, imported, derived, heuristic, stale) as metadata on data rows — NOT as replacements for scoring evidence tiers.

**DECISION:** **ADOPT WITH MODIFICATION** — provenance labels are additive, not a replacement. Phase 3+.

---

## 15. Formulas / Scoring

### Active (keep as-is)
| Formula | Location | Values |
|---------|----------|--------|
| Attribution composite | `config.ts` | `score = Σ(weight_i × strength_value(match_i))` — weights sum to 100 |
| Evidence tier adjustments | `candidates.ts` + `compute.ts` | exact: +8 bonus; probable: cap 85; weak: cap 55; no-content: cap 45; citation bonus: +12 |
| Triage thresholds | `triage.ts` | PRIMARY_MIN=65, GAP=15, SUPPRESS_MAX=45, CONTRIBUTING_MIN=55 |
| Confidence bands | `config.ts` | high≥70, medium≥45, low≥20 |

### To implement (Phase 3, with native sampling)
| Formula | Definition |
|---------|-----------|
| SOV | `citation_rate = citations_for_domain / total_citation_slots` per platform per period |
| SOV CI | `CI = SOV ± 1.96 × √(SOV(1-SOV)/n)` |
| Staleness | `freshness = exp(-ln(2) × age_days / half_life)` — crawl: 7d, citations: 14d, competitors: 30d |

### Deferred
| Formula | Why |
|---------|-----|
| CausalImpact / PELT changepoint | Needs 90+ days of continuous time series |
| Cross-platform weighted SOV | No calibration data for platform audience weights |
| Extractability score | Signals not yet captured (factual density, domain authority) |
| Dempster-Shafer fusion | **REJECTED** — complexity exceeds benefit |

---

## 16. Testing / Replay / Validation

**CURRENT FACT:** No test framework configured. `score-snapshot.ts` provides ad-hoc diagnostics.

**PHASE 0 DELIVERABLES:**
1. Add `vitest` as dev dependency
2. `vitest.config.ts` at root
3. `tests/domains/attribution/invariants.test.ts`:
   - Score boundedness: all scores in [0, 100]
   - Idempotency: same inputs → same output
   - Evidence tier caps enforced
   - No-content cap enforced
   - Zero inputs → valid result (no NaN/Infinity)
4. `tests/domains/attribution/golden.test.ts`:
   - Capture `score-snapshot.ts` output as fixture
   - Verify key metrics match golden values (auto-resolved count, score quartiles)

---

## 17. Phased Implementation Roadmap

### Phase 0 — Consolidate & Stabilize ← CURRENT
**Goal:** Fix structural inconsistencies. Add test foundation. No feature changes.
- Rename `domains/observation-runs/types.ts::ObservationRun` → `ProfoundImportRun`
- Update 3 importers: `storage/canonical-store.ts`, `adapters/types.ts`, `adapters/profound/execution-adapter.ts`
- Audit `storage/canonical-store.ts` — document that only `adapters/profound/import-orchestrator.ts` consumes it
- Update `docs/architecture.md` weights to match `config.ts` actual values
- Add vitest + 2 test files (invariants + golden)
- Verify: `npm run check` passes, tests pass, no functional regressions

### Phase 1 — PostgreSQL Foundation
**Goal:** Migrate core persistence to Supabase.
- Supabase project setup
- Core schema: 8 tables (runs, pages, page_snapshots, page_issues, changelog_entries, competitors, import_runs, attribution_decisions)
- Repository pattern: interfaces + file + DB implementations + `DATA_SOURCE` env var
- Dual-write, backfill from `.data/`, validate, cut over
- All surfaces render correctly from DB

### Phase 2 — Automated Crawl
**Goal:** Replace manual CLI crawl with nightly Inngest pipeline.
- Inngest route handler + crawl job
- Crawlee wrapper around existing `extractor.ts`
- Post-crawl: page registry build + citation index rebuild
- Competitor universe migrated to DB
- Diagnostics: pipeline run history

### Phase 3 — API Visibility Sampling
**Goal:** Native AI visibility measurement via Perplexity API.
- Perplexity engine client
- Inngest visibility sampling job
- SOV calculation with CI
- `visibility_observations` + `citation_rows` tables
- Wire into Today + Sample history

### Phase 4+ — Deferred
- Additional visibility engines (ChatGPT, Gemini, Claude)
- Statistical attribution (CausalImpact, changepoint)
- Competitor auto-discovery
- Multi-workspace / auth (only if explicitly requested)

---

## 18. Smallest Current Executable Phase

### Phase 0 — Consolidate & Stabilize

**Duration:** 1-2 working sessions

**Changes:**

#### 1. Rename conflicting `ObservationRun` type
- **File:** `src/domains/observation-runs/types.ts`
- **Change:** Rename `ObservationRun` → `ProfoundImportRun`, `RunStatus` → `ProfoundRunStatus`, `RunSourceType` → `ProfoundRunSourceType`
- **Downstream updates:**
  - `src/storage/canonical-store.ts` — update import
  - `src/adapters/types.ts` — update import
  - `src/adapters/profound/execution-adapter.ts` — update import

#### 2. Document canonical-store scope
- **File:** `src/storage/canonical-store.ts`
- Add file-level comment: "Used exclusively by Profound import pipeline. App routes use `domains/attribution/store.ts` for event-decisions. Do not import in route pages."
- No code change needed — the dual-writer is safe at runtime because `json-store` returns same cached array, but the intent boundary must be documented.

#### 3. Update stale docs
- **File:** `docs/architecture.md`
- Update `Attribution Config` section: weights to platform=20, topic=25, url=5, geo=15, temporal=20, sourceCategory=15
- Update confidence bands: high≥70, medium≥45, low≥20
- Add note about sourceCategory factor (missing from current docs)

#### 4. Add test infrastructure
- **Add dependency:** `vitest` (dev)
- **New file:** `vitest.config.ts`
- **New file:** `tests/domains/attribution/invariants.test.ts`
- **New file:** `tests/domains/attribution/golden.test.ts`
- **Add script:** `"test": "vitest run"` to `package.json`

#### Acceptance criteria
- `npm run check` passes (typecheck + lint + build)
- `npm test` passes with ≥5 attribution invariant tests
- No `ObservationRun` name collision between modules
- `docs/architecture.md` weights match `src/domains/attribution/config.ts`

---

## 19. Cursor Delegation Notes

### Phase 0 brief for Cursor

> **Task:** Consolidate Beacon's observation model and add test foundation.
>
> **Step 1:** In `src/domains/observation-runs/types.ts`, rename `ObservationRun` to `ProfoundImportRun`, `RunStatus` to `ProfoundRunStatus`, `RunSourceType` to `ProfoundRunSourceType`. Update all files that import from this module: `src/storage/canonical-store.ts`, `src/adapters/types.ts`, `src/adapters/profound/execution-adapter.ts`. Do NOT touch `src/domains/observations/types.ts` — that is the canonical `ObservationRun`.
>
> **Step 2:** Add a documentation comment to the top of `src/storage/canonical-store.ts` explaining it is used exclusively by the Profound import pipeline and should not be imported by app route pages.
>
> **Step 3:** In `docs/architecture.md`, update the Attribution Config section. Change weights to: platform=20, topic=25, url=5, geo=15, temporal=20, sourceCategory=15. Change confidence bands to: high≥70, medium≥45, low≥20. Add sourceCategory as a listed factor.
>
> **Step 4:** Add `vitest` as a dev dependency. Create `vitest.config.ts` at root. Add `"test": "vitest run"` to package.json scripts. Create two test files:
> - `tests/domains/attribution/invariants.test.ts` — test that `computeAttribution` always returns scores in [0,100], that same inputs produce same outputs, that evidence tier caps are respected (weak ≤ 55, probable ≤ 85), and that zero/empty inputs don't produce NaN.
> - `tests/domains/attribution/golden.test.ts` — capture current auto-resolve count and score distribution quartiles as a snapshot baseline.
>
> **Verify:** `npm run check` and `npm test` both pass. No changes to any route page, UI component, or domain logic.

---

## 20. Known Unknowns / Open Questions

| Question | Impact | When to resolve |
|----------|--------|----------------|
| Should `storage/canonical-store.ts` and `domains/attribution/store.ts` be merged into one module? | Low — they serve different code paths | Phase 1 (during repository pattern work) |
| What Supabase plan tier is needed? Free tier = 500MB DB. Citation cold store alone could be 50-100MB. | Determines Phase 1 scope | Before Phase 1 starts |
| Perplexity API pricing and rate limits for the target query set? | Determines Phase 3 sample count | Before Phase 3 starts |
| Should `docs/prd.md` core modules list be updated to match actual navigation? It lists Coverage and Weekly Summary (both removed). | Low — doc maintenance | Phase 0 or anytime |
| How many of the 25+ json-store basenames are actively read by live surfaces vs only written by scripts? | Affects Phase 1 migration scope | Phase 1 planning |
| Is the Profound import path still actively used, or is it historical? | Determines whether to maintain `canonical-store.ts` | Before Phase 1 |

---

## Status Footer

**CURRENT PHASE:** Phase 0.5 — Audit live persistence dependencies

**PHASE 0 STATUS:** COMPLETE — commit `74605b1`

**FILES TO TOUCH NOW:**
- `docs/master_execution_plan.md` only (append audit findings)

**DO NOT TOUCH YET:**
- Any persistence layer changes (Phase 1)
- Any route pages or UI components
- Supabase setup or schema (Phase 1)
- Inngest integration (Phase 2)
- Crawl pipeline refactoring (Phase 2)
- Visibility/sampling code (Phase 3)
- Any scoring formula changes
- Any new domain modules

**NEXT DECISION AFTER THIS:**
After Phase 0.5 audit is complete, lock the minimum Phase 1 schema scope and begin Supabase setup.

---

## Phase 0.5 Audit — Live Persistence Dependency Map

### Store audit table

Legend:
- **RC** = route-critical (directly needed for a live route to render)
- **RS** = route-supporting (needed by calculations that power live routes)
- **SO** = script-only (only written/read by CLI scripts, not live routes)
- **PI** = Profound import only (only used by Profound adapter pipeline)
- **LO** = legacy-only (dead path, redirect, or compatibility shim)

| # | Store / file basename | Mechanism | Writer(s) | Reader(s) — live routes | Classification | Phase 1 migrate? | Target |
|---|----------------------|-----------|-----------|------------------------|----------------|-------------------|--------|
| 1 | `imported-results` | json-store | `lib/import/actions.ts` | `seed-data.server.ts` → layout, Today, Changes, Review, Results, Diagnostics, Expansion, Topics | **RC** | Yes | `results` table |
| 2 | `imported-changes` | json-store | `lib/import/actions.ts` | `seed-data.server.ts` → layout, Today, Changes, Review, Results, Diagnostics, Topics | **RC** | Yes | `changelog_entries` table |
| 3 | `imported-opportunities` | json-store | `lib/import/actions.ts` | `seed-data.server.ts` → Today, Changes, Review, Topics, Diagnostics | **RC** | Yes | `opportunities` table |
| 4 | `imported-competitors` | json-store | `lib/import/actions.ts` | `seed-data.server.ts` → Competitors, Topics | **RC** | Yes | `competitors` table |
| 5 | `import-runs` | json-store | `lib/import/actions.ts` | `seed-data.server.ts` (`hasActiveExperiment`) → gates ALL entity loading | **RC** | Yes | `import_runs` table |
| 6 | `event-decisions` | json-store | `attribution/store.ts`, `canonical-store.ts` | layout (badge), Today, Changes, Review, Results, Topics, Diagnostics | **RC** | Yes | `attribution_decisions` table |
| 7 | `candidate-links` | json-store | `attribution/store.ts` | Review, Diagnostics, Expansion, Briefs/proposed | **RC** | Yes | `candidate_links` table |
| 8 | `page-issues` | json-store | `pages/issues.ts` | layout (badge), Today, `/pages`, Topics | **RC** | Yes | `page_issues` table |
| 9 | `change-contracts` | json-store | `changelog/change-contract.ts` | `/changes` list, contract actions | **RC** | Yes | `change_contracts` table |
| 10 | `pages` | json-store | `profound/import-orchestrator.ts` | Today (`readStore`), `/pages` (`readStore`), `candidates.ts` (page registry for evidence tiers) | **RC** | Yes | `pages` table |
| 11 | `page-snapshots` | direct fs (dotdata) | `scripts/scan-owned-pages.ts` | Today (`readDotDataJson`), `/pages` (`readDotDataJson`), Topics | **RC** | Yes | `page_snapshots` table |
| 12 | `page-guardrails` | direct fs (dotdata) | `scripts/scan-owned-pages.ts` | Today (`readDotDataJson`), `/pages` (`readDotDataJson`) | **RC** | Yes | `guardrail_alerts` table |
| 13 | `citation-evidence-index` | direct fs (dotdata) | `scripts/build-page-registry.ts` | Today, `/pages`, Results, Topics, `visibility-read.ts` (synthetic wrapper) | **RC** | Yes | `citation_evidence` table or computed view |
| 14 | `observation-runs` | direct fs (dotdata) + json-store (canonical-store) | `scripts/scan-owned-pages.ts`, `canonical-store.ts` | `observations/read.ts` → Today, `/pages`, Topics, Results, Observations | **RC** | Yes | `runs` table |
| 15 | `competitor-universe` | dotdata (file v1/v2) | `competitors/universe-write.ts` | `universe-read.ts` → Today, Topics, Results, Competitors, Observations | **RC** | Yes | `competitor_universe` table |
| 16 | `truth-labels` | json-store | `attribution/store.ts` | Results detail | **RS** | Later | — |
| 17 | `action-states` | json-store | `actions/store.ts` | `/actions` (redirects to `/`) action-state.ts | **RS** | Later | — |
| 18 | `rollout-executions` | json-store | `pages/issues.ts` | `/pages`, Topics | **RS** | Later | — |
| 19 | `pattern-evidence` | json-store | `pages/issues.ts` | `/pages`, Topics | **RS** | Later | — |
| 20 | `rollout-waves` | json-store | `pages/wave-planner.ts` | Today, `/pages`, Topics | **RS** | Later | — |
| 21 | `frontier-opportunities` | json-store | `pages/frontier-planner.ts` | Topics (computed on-demand, store is cache) | **RS** | Later | — |
| 22 | `frontier-attack-packages` | json-store | `pages/frontier-compiler.ts` | Topics | **RS** | Later | — |
| 23 | `tracked-missing-pages` | json-store | `pages/frontier-compiler.ts` | Topics | **RS** | Later | — |
| 24 | `competitor-page-evidence` | json-store | `pages/competitor-evidence.ts` | Topics | **RS** | Later | — |
| 25 | `source-pattern-evidence` | json-store | `pages/competitor-evidence.ts` | Topics | **RS** | Later | — |
| 26 | `asset-responses` | json-store | `pages/asset-response.ts` | Topics | **RS** | Later | — |
| 27 | `brief-states` | json-store | `brief-generation/store.ts` | Not directly by routes | **RS** | Later | — |
| 28 | `outcome-observations` | json-store | `pages/outcome-watch.ts` | Not directly by routes | **RS** | Later | — |
| 29 | `page-snapshot-diffs` | direct fs (dotdata) | `scripts/scan-owned-pages.ts` | `/pages` | **RS** | Later | — |
| 30 | `render-checks` | direct fs (dotdata) | `scripts/scan-owned-pages.ts` | `/pages` | **RS** | Later | — |
| 31 | `sitemap-reconciliation` | direct fs (dotdata) | `scripts/scan-owned-pages.ts` | `/pages` | **RS** | Later | — |
| 32 | `scan-runs` | direct fs (dotdata) | `scripts/scan-owned-pages.ts` | `observations/read.ts` (legacy fallback only) | **LO** | No | Legacy compat — remove when observation-runs fully migrated |
| 33 | `visibility-observation-runs` | dotdata | `visibility-persist.ts` | `visibility-read.ts` → Today, Topics, Results | **RC** | Yes | part of `runs` table |
| 34 | `page-snapshots-prev` | direct fs | `scripts/scan-owned-pages.ts` | scan script only (prior-run diffing) | **SO** | No | stays file-backed |
| 35 | `tracked-prompts` | json-store | `canonical-store.ts` | `canonical-store.ts` (Profound pipeline only) | **PI** | No | Profound adapter scope |
| 36 | `tracked-entities` | json-store | `canonical-store.ts` | `canonical-store.ts` (Profound pipeline only) | **PI** | No | Profound adapter scope |
| 37 | `prompt-answer-observations` | json-store | `canonical-store.ts` | `canonical-store.ts` (Profound pipeline only) | **PI** | No | Profound adapter scope |
| 38 | `daily-metric-snapshots` | json-store | `canonical-store.ts` | `canonical-store.ts` (Profound pipeline only) | **PI** | No | Profound adapter scope |
| 39 | `outcome-events` | json-store | `canonical-store.ts` | `canonical-store.ts` (Profound pipeline only) | **PI** | No | Profound adapter scope |
| 40 | `candidate-causes` | json-store | `canonical-store.ts` | `canonical-store.ts` (Profound pipeline only) | **PI** | No | Profound adapter scope |
| 41 | `answer-texts.json` | cold-store | `cold-store.ts` | `import-orchestrator.ts` only | **PI** | No | stays file-backed |
| 42 | `citations-by-date/*.json` | cold-store shards | `cold-store.ts` | `import-orchestrator.ts` only | **PI** | No | stays file-backed |

### Minimum Phase 1 migration set (route-critical stores only)

These 15 stores are directly required for live route rendering. They must be the Phase 1 scope:

| Store | Target table |
|-------|-------------|
| `imported-results` | `results` |
| `imported-changes` | `changelog_entries` |
| `imported-opportunities` | `opportunities` |
| `imported-competitors` | `competitors` |
| `import-runs` | `import_runs` |
| `event-decisions` | `attribution_decisions` |
| `candidate-links` | `candidate_links` |
| `page-issues` | `page_issues` |
| `change-contracts` | `change_contracts` |
| `pages` | `pages` |
| `page-snapshots` | `page_snapshots` |
| `page-guardrails` | `guardrail_alerts` |
| `citation-evidence-index` | `citation_evidence` (or computed view) |
| `observation-runs` + `visibility-observation-runs` | `runs` (unified) |
| `competitor-universe` | `competitor_config` |

**Count: 15 stores → ~12 DB tables** (some merge into `runs`).

### Defer / later set (route-supporting, not blocking)

These stores power derived computations but are either computed on-demand or are secondary to rendering. They can stay file-backed through Phase 1:

`truth-labels`, `action-states`, `rollout-executions`, `pattern-evidence`, `rollout-waves`, `frontier-opportunities`, `frontier-attack-packages`, `tracked-missing-pages`, `competitor-page-evidence`, `source-pattern-evidence`, `asset-responses`, `brief-states`, `outcome-observations`, `page-snapshot-diffs`, `render-checks`, `sitemap-reconciliation`

### Dead or Profound-only set (do not migrate in Phase 1)

| Store | Why |
|-------|-----|
| `scan-runs` | Legacy fallback for `observation-runs`. Will be eliminated when runs table exists. |
| `page-snapshots-prev` | Script working file only. Not read by any route. |
| `tracked-prompts` | Profound import pipeline only. Not read by any route. |
| `tracked-entities` | Profound import pipeline only. |
| `prompt-answer-observations` | Profound import pipeline only. |
| `daily-metric-snapshots` | Profound import pipeline only. |
| `outcome-events` | Profound import pipeline only (stored by canonical-store; live events are computed by `detectOutcomeEvents` from results). |
| `candidate-causes` | Profound import pipeline only. |
| `answer-texts.json` | Cold store, Profound pipeline only. |
| `citations-by-date/*.json` | Cold store shards, Profound pipeline only. |

### Recommended Phase 1 schema scope

**12 tables, single-tenant, no workspaces/RLS:**

1. `runs` — unified: website crawl, website verify, visibility import, Profound import
2. `pages` — page registry
3. `page_snapshots` — per-crawl extraction
4. `guardrail_alerts` — per-crawl guardrails
5. `results` — imported visibility result rows
6. `changelog_entries` — imported changes
7. `opportunities` — imported opportunities
8. `competitors` — imported + configured competitors
9. `import_runs` — import tracking
10. `attribution_decisions` — review decisions (event-decisions)
11. `candidate_links` — attribution candidates
12. `page_issues` — persisted issue tracking
13. `change_contracts` — change verification contracts
14. `citation_evidence` — citation rollup index

Plus: `competitor_config` may merge into `competitors` table with a `source` column distinguishing imported entities from configured universe entries.

**Total: 13-14 tables.**

### Phase 1 migration order (smallest steps)

1. **Supabase project setup** — create project, get connection string, add `@supabase/supabase-js` dependency, create `src/lib/persistence/supabase.ts` client singleton
2. **Schema migration 001** — create tables for `import_runs`, `results`, `changelog_entries`, `opportunities`, `competitors` (the seed-data.server entities)
3. **Repository interfaces** — `IResultRepository`, `IChangelogRepository`, etc. in `src/lib/persistence/repositories/`
4. **Wire seed-data.server.ts** — feature-flagged dual-read from file or DB via `DATA_SOURCE` env var
5. **Backfill script** — read existing `.data/` files, insert into DB
6. **Schema migration 002** — `runs`, `pages`, `page_snapshots`, `guardrail_alerts`, `citation_evidence`
7. **Schema migration 003** — `attribution_decisions`, `candidate_links`, `page_issues`, `change_contracts`
8. **Wire remaining stores** — route pages read from DB via repository, file writes kept as fallback
9. **Validate** — all surfaces render identically from DB source
10. **Cut over** — set `DATA_SOURCE=supabase` as default

### What you (Armeen) need to do for Supabase setup

This is the non-technical part. Here is exactly what to do, in order:

1. **Go to [supabase.com](https://supabase.com)** and sign up (use your email, not GitHub OAuth — simpler to manage)
2. **Create a new project** — name it `beacon`, pick a region close to you (e.g., `us-west-1`), set a strong database password (save it somewhere safe like 1Password — never paste it into code files)
3. **After the project is created**, go to **Settings → API** in the Supabase dashboard
4. **Copy these two values** (they are NOT secrets that can hack you — they are project identifiers):
   - `Project URL` — looks like `https://abcdefgh.supabase.co`
   - `anon public` key — a long string starting with `eyJ...`
5. **Also copy the database connection string** from **Settings → Database → Connection string → URI** (this one IS sensitive — treat it like a password)
6. **Create a `.env.local` file** in the Beacon repo root (it's already `.gitignore`-d so it won't get committed):
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://abcdefgh.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...your-key...
   SUPABASE_SERVICE_ROLE_KEY=eyJ...your-service-key...
   DATA_SOURCE=file
   ```
7. **Tell Cursor** you're ready — it will create the schema migrations and repository code

**Security note:** The `.env.local` file is in `.gitignore` by default in Next.js projects. Your database password and service role key never leave your machine. The `anon` key is safe to expose (it's designed for client-side use with Row Level Security). Since Beacon is single-user with no auth, the `service_role` key is used server-side only (enforced by `import "server-only"`).

### Exact next implementation step

After Supabase project is created and `.env.local` is populated:
1. Install `@supabase/supabase-js`
2. Create `src/lib/persistence/supabase.ts` client
3. Create `supabase/migrations/001_core_schema.sql` with the 5 seed-data entity tables
4. Run migration
5. Create repository interfaces
6. Wire `seed-data.server.ts` behind `DATA_SOURCE` flag

---

## Phase 1A Status — PostgreSQL Bootstrap

**Status:** COMPLETE
**Date:** 2026-04-09

### What was done

| Deliverable | File | Notes |
|-------------|------|-------|
| Supabase client singleton | `src/lib/persistence/supabase.ts` | Server-only, lazy init, env validation, service role key |
| Core schema migration | `supabase/migrations/001_core_schema.sql` | 5 tables + 3 indexes |
| Supabase JS dependency | `package.json` | `@supabase/supabase-js` added |
| Feature flag env var | `.env.local` | `DATA_SOURCE=file` (Phase 1B will read this) |

### Tables created in 001_core_schema.sql

| Table | Columns | Maps to store | Primary index |
|-------|---------|---------------|---------------|
| `import_runs` | 11 | `import-runs` | `id` (PK) |
| `results` | 21 | `imported-results` | `id` (PK) + `(platform, snapshot_date)` |
| `changelog_entries` | 18 | `imported-changes` | `id` (PK) + `(timestamp desc)` |
| `opportunities` | 34 | `imported-opportunities` | `id` (PK) + `(current_status)` |
| `competitors` | 11 | `imported-competitors` | `id` (PK) |

### Migration not yet applied

The SQL file exists but has **not** been run against the Supabase project.
Apply it via the Supabase dashboard **SQL Editor** (paste contents of `supabase/migrations/001_core_schema.sql` and click Run).

### What Phase 1B should do next

1. Apply the migration SQL to the live Supabase project
2. Create repository interfaces (`src/lib/persistence/repositories/`) for the 5 entity types
3. Implement Supabase-backed repository classes
4. Wire `seed-data.server.ts` with `DATA_SOURCE` flag: `file` = current behavior, `supabase` = read from DB
5. Create a backfill script to seed existing `.data/` file contents into the DB
6. Validate all route surfaces render identically from both sources

### What must NOT be touched in Phase 1B

- No route/UI changes beyond the `DATA_SOURCE` branch in `seed-data.server.ts`
- No deletion of `json-store.ts` or existing `.data/` files
- No schema beyond the 5 seed-data entity tables
- No auth, RLS, workspaces, or multi-tenant design
- No crawl pipeline changes
- No scoring logic changes

---

## Phase 1B Status — Repository Wiring, Backfill & Dual-Read

**Status:** COMPLETE
**Date:** 2026-04-09

### What was done

| Deliverable | File(s) | Notes |
|-------------|---------|-------|
| Repository interface | `src/lib/persistence/repositories/types.ts` | `SeedDataRepository` with 5 async getters |
| File backend | `src/lib/persistence/repositories/file-backend.ts` | Wraps `readStore()`, preserves cache reference semantics |
| Supabase backend | `src/lib/persistence/repositories/supabase-backend.ts` | Queries tables via `getSupabaseAdmin()` |
| Factory | `src/lib/persistence/repositories/index.ts` | Returns backend based on `DATA_SOURCE` env var |
| Seed-data wiring | `src/lib/seed-data.server.ts` | Uses repository + top-level `await`; zero route changes |
| Backfill script | `scripts/backfill-to-supabase.ts` | Idempotent upsert, self-loads `.env.local` |
| Backfill npm script | `package.json` | `data:backfill-db` command |

### Backfill results

| Table | Rows | Status |
|-------|------|--------|
| `import_runs` | 1 | ✓ verified |
| `results` | 1,179 | ✓ verified |
| `changelog_entries` | 85 | ✓ verified |
| `opportunities` | 1 | ✓ verified |
| `competitors` | 0 | empty on disk |

### How dual-read works

`seed-data.server.ts` calls `getRepository()` which checks `DATA_SOURCE`:
- `supabase` → `supabaseBackend` → Postgres for route-critical tables (**committed default** since Phase 2)
- `file` → `fileBackend` → `readStore` / `readDotDataJson` from `.data/*.json` (**rollback**)

No route files were changed. The module export API is identical.
Top-level `await` is used for async Supabase queries; file backend resolves synchronously.

### Validation

| Check | Result |
|-------|--------|
| `typecheck` | ✓ pass |
| `lint` | ✓ 0 errors |
| `build` | ✓ 17/17 pages |
| `test` | ✓ 26/26 tests |
| DB row counts | ✓ match file stores |

### What Phase 1C should do next

1. **Schema migration 002** — add remaining route-critical tables: `attribution_decisions`, `candidate_links`, `page_issues`, `change_contracts`, `pages`, `page_snapshots`, `guardrail_alerts`, `citation_evidence`, `runs`, `competitor_config`
2. **Extend repository interface** — add getters for the new entity types
3. **Wire remaining store consumers** — `attribution/store.ts`, `pages/issues.ts`, etc. behind `DATA_SOURCE` flag
4. **Dual-write for import actions** — when `DATA_SOURCE=supabase`, import actions write to both file and DB
5. **Validation** — compare route rendering between `file` and `supabase` modes

### What must NOT be touched yet

- No deletion of file-backed stores
- ~~No full cutover to `DATA_SOURCE=supabase` as default~~ **Done (Phase 2).**
- No auth, RLS, workspaces
- No crawl pipeline changes
- No Inngest or job orchestration
- No visibility sampling or scoring changes

---

## Phase 1C Status — Full Schema + Backfill

**Status:** COMPLETE
**Date:** 2026-04-09

### What was done

Created and applied migration `002_remaining_core.sql` via Supabase MCP for the remaining 10 route-critical stores. Ran full backfill of all 15 tables.

### Tables created in 002_remaining_core.sql

| # | Table | Rows | Maps to store | Notes |
|---|-------|------|---------------|-------|
| 6 | `attribution_decisions` | 27 | `event-decisions` | snake_case, direct match |
| 7 | `candidate_links` | 133 | `candidate-links` | `attribution` column nullable (all nulls in current data) |
| 8 | `page_issues` | 6 | `page-issues` | camelCase TS → snake_case DB (key mapping needed in repo) |
| 9 | `change_contracts` | 85 | `change-contracts` | camelCase TS → snake_case DB (key mapping needed in repo) |
| 10 | `pages` | 5,288 | `pages` | page registry from import pipeline |
| 11 | `page_snapshots` | 35 | `page-snapshots` | dotdata format, direct |
| 12 | `guardrail_alerts` | 6 | `page-guardrails` | serial PK (no natural ID), delete+insert on backfill |
| 13 | `citation_evidence_index` | 1 | `citation-evidence-index` | single document, JSONB columns |
| 14 | `observation_runs` | 0 | `observation-runs` / `visibility-observation-runs` | unified wide table; no matching data on disk yet (file has ProfoundImportRun schema) |
| 15 | `competitor_config` | 5 | `competitor-universe` | v2 file wrapper parsed |

**Total: 15 tables, 6,852 rows backfilled.**

### Naming convention decision

All DB columns use **snake_case** (PostgreSQL convention). Two TS types use camelCase:
- `PersistedIssue` (page_issues) — `issueId` → `issue_id`, `pageUrl` → `page_url`, etc.
- `ChangeContract` (change_contracts) — `contractId` → `contract_id`, `accountId` → `account_id`, etc.

Repository layer must map between naming conventions when these consumers are wired.

### Discovery: observation-runs file (mixed use; resolved for reads)

The physical `.data/observation-runs.json` file is **shared**: it holds **ProfoundImportRun** rows (Profound pipeline via `canonical-store.ts` / json-store) and may also hold website **`ObservationRun`** rows appended by scan/verify. **`SeedDataRepository` / `file-backend.ts`** merges website-typed rows from that file with legacy `.data/scan-runs.json`, skipping Profound-shaped objects (Phase 3C). The `observation_runs` Postgres table holds website + visibility-aligned runs; ProfoundImportRun rows remain file-backed per Phase 0.5 (stores #35–42 are "do not migrate").

### Phase 1D — COMPLETE — repository wiring for centralized store consumers

**Scope:** Extended the repository interface and wired the 3 centralized store modules that export mutable arrays through module-level `readStore()` calls.

**Stores wired through repository (4 total, via 3 modules):**
| Store file | TS type | DB table | Key mapping |
|---|---|---|---|
| event-decisions | EventDecision | attribution_decisions | none (already snake_case) |
| candidate-links | CandidateLink | candidate_links | none (already snake_case) |
| page-issues | PersistedIssue | page_issues | snake→camel via mapRowToEntity |
| change-contracts | ChangeContract | change_contracts | snake→camel via mapRowToEntity |

**Files created:**
- `src/lib/persistence/repositories/key-mapper.ts` — `snakeToCamel()` + `mapRowToEntity<T>()` for DB→TS mapping

**Files modified:**
- `src/lib/persistence/repositories/types.ts` — added 4 new getters to `SeedDataRepository`
- `src/lib/persistence/repositories/file-backend.ts` — file-backed implementations (returns cache references)
- `src/lib/persistence/repositories/supabase-backend.ts` — added `queryMapped<T>()` for camelCase types
- `src/domains/attribution/store.ts` — `candidateLinks` + `eventDecisions` via repo (truthLabels stays file-backed)
- `src/domains/pages/issues.ts` — `pageIssues` via repo (rolloutExecutions + patternEvidence stay file-backed)
- `src/domains/changelog/change-contract.ts` — `changeContracts` via repo

**Pattern:** Top-level `await` on repository getters, matching the seed-data.server.ts pattern from Phase 1B. Persist functions remain file-backed. Non-migrated stores (truthLabels, rolloutExecutions, patternEvidence) still use direct `readStore()`.

**Validation:**
- typecheck ✓, lint ✓ (0 errors), build ✓ (17/17 pages), tests ✓ (26/26)
- DB row counts match file stores: attribution_decisions=27, candidate_links=133, page_issues=6, change_contracts=85
- DB column names confirmed compatible with snakeToCamel mapping

**What was NOT touched:**
- Route pages (no UI changes)
- dotdata consumers (page-snapshots, page-guardrails, citation-evidence-index, observation-runs, competitor-universe)
- `readStore("pages")` calls (scattered in route pages, not a centralized store)
- Persist/write functions (stay file-backed)
- truthLabels, rolloutExecutions, patternEvidence (route-supporting, deferred)
- Scoring logic, crawl pipeline, Inngest, visibility sampling

### Phase 1E — COMPLETE — remaining 6 stores wired via centralized modules

**Historical snapshot:** Access patterns below reflect Phase 1E ship. **Current** observation merge, parity, and store routing are documented in Phases **3A–3C** and **3E** (`docs/architecture.md`).

**Scope:** Wired the 6 remaining route-critical stores through the repository layer using thin centralized access modules, then rewired route page imports.

**Stores wired (6 total):**
| Store file | TS type | DB table | Access pattern |
|---|---|---|---|
| pages | PageEntity | pages | Module-cached (readStore) |
| page-snapshots | PageSnapshot | page_snapshots | Module-cached (readDotDataJson) |
| page-guardrails | GuardrailAlert | guardrail_alerts | Module-cached (readDotDataJson) |
| citation-evidence-index | CitationEvidenceIndex | citation_evidence_index | Module-cached (document) |
| observation-runs | ObservationRun | observation_runs | Module-cached; **Phase 3C:** merge in `file-backend`, no reader fallback |
| competitor-universe | ConfiguredCompetitorEntry | competitor_config | Conditional: supabase=repo, file=readDotDataJson (pin metadata) |

**New centralized modules created (4):**
- `src/domains/pages/page-store.ts` — exports `allPages`
- `src/domains/pages/snapshot-store.ts` — exports `pageSnapshots`
- `src/domains/pages/guardrail-store.ts` — exports `guardrailAlerts`
- `src/domains/pages/citation-evidence-store.ts` — exports `citationEvidenceIndex`

**Existing modules modified (2):**
- `src/domains/observations/read.ts` — uses repo only; **Phase 3C:** merge lives in `file-backend`
- `src/domains/competitors/universe-read.ts` — supabase mode queries competitor_config + reconstructs pin; file mode uses existing readDotDataJson→parseUniverseFile path unchanged

**Route pages rewired (4):**
- `src/app/(shell)/page.tsx` (Today) — pages, snapshots, guardrails, citation-evidence
- `src/app/(shell)/pages/page.tsx` — pages, snapshots, guardrails, citation-evidence
- `src/app/(shell)/topics/page.tsx` — snapshots, citation-evidence
- `src/app/(shell)/results/page.tsx` — citation-evidence

**Domain consumers rewired (1):**
- `src/domains/attribution/candidates.ts` — pages (allPages import replaces readStore)

**Repository additions (6 getters):**
- `getPages()`, `getPageSnapshots()`, `getGuardrailAlerts()`, `getCitationEvidenceIndex()`, `getObservationRuns()`, `getCompetitorConfigEntries()`

**Total repository getters: 15** — covers all route-critical stores.

**Validation:**
- typecheck ✓, lint ✓ (0 errors), build ✓ (17/17 pages), tests ✓ (26/26)
- DB row counts: pages=5288 ✓, page_snapshots=35 ✓, guardrail_alerts=6 ✓, citation_evidence_index=1 ✓, competitor_config=5 ✓
- **At Phase 1E:** `observation_runs` empty in DB (pre–Phase 3C). **Current:** aligned — Phase 3C.

**Superseded by Phases 3A+:** `import/actions.ts` and `visibility-read.ts` no longer use `readDotDataJson` for the stores listed above; they use repository-backed / thin store modules.

**Still intentionally direct (see Phase 3E / architecture):**
- `topics/page.tsx` server action — dynamic `readDotDataJson` (freshness)
- Scripts (scan-owned-pages.ts, score-snapshot.ts) — CLI `readStore` / disk
- Persist/write functions — file-first + dual-write where enabled

### Milestone: All 15 route-critical stores now read through the repository layer

The `SeedDataRepository` interface has 15 getters covering all stores identified in the Phase 0.5 audit. Both file and Supabase backends implement all 15. **`DATA_SOURCE=supabase` is the committed default** (Phase 2); **`DATA_SOURCE=file`** is instant rollback with the same API.

### Phase 1F — Dual-Write Engine (COMPLETE)

**Flag:** `DUAL_WRITE=true` env var (independent of `DATA_SOURCE`; **on** in committed pilot config).

**Mechanism:** File writes always execute first (rollback safety). When `DUAL_WRITE=true`, the same rows are upserted to Supabase best-effort — errors are logged to console but never propagate. Partial-write risk is documented: DB may lag file, never the reverse.

**New module:**
- `src/lib/persistence/dual-write.ts` — centralized engine with `dualWriteUpsert()`, `dualWriteTruncate()`, and 7 typed sync helpers

**Modified modules (2):**
- `src/domains/attribution/store.ts` — `persistCandidateLinks()` and `persistEventDecisions()` now dual-write
- `src/lib/import/actions.ts` — `executeImport()`, `importWorkbook()`, and `resetExperiment()` now dual-write

**Tables covered (7):**

| File store key | DB table | Trigger |
|---|---|---|
| import-runs | import_runs | executeImport, importWorkbook |
| imported-results | results | executeImport, importWorkbook |
| imported-changes | changelog_entries | executeImport, importWorkbook |
| imported-opportunities | opportunities | executeImport, importWorkbook |
| imported-competitors | competitors | executeImport, importWorkbook |
| candidate-links | candidate_links | persistCandidateLinks (store.ts) |
| event-decisions | attribution_decisions | persistEventDecisions (store.ts) |

**Reset behavior:** `resetExperiment()` clears all 7 DB tables when `DUAL_WRITE=true` (truncate). Re-run backfill to repopulate seed data after a reset.

**Validation:**
- typecheck ✓, lint ✓ (0 new errors), build ✓ (17/17 pages), tests ✓ (26/26)

**What was NOT touched:**
- truthLabels (route-supporting, not route-critical — file-only persist)
- Page issues, change contracts, pages, snapshots, guardrails, citation-evidence, observation-runs, competitor-config (no active import write paths)
- visibility-read.ts, scan scripts (later partially rewired in 3A+)
- UI, scoring, crawl, auth, RLS
- ~~DATA_SOURCE default (still `file`)~~ **Superseded:** default `supabase`; `file` = rollback

### Phase 1G — Parity Comparison Tooling (COMPLETE)

**New script:** `scripts/compare-parity.ts` (`npm run data:parity`)

Reads all 15 route-critical stores from file (`.data/*.json`) and Supabase in parallel. Reports:
- Row count per store for both backends
- Match/mismatch status
- ID-level drift details (which IDs exist only in file or only in DB)

**Latest run (2026-04-09):** **15/15** stores in exact parity after Phase 3C (`observation_runs` alignment — merged file + scan sources, DB backfill, dual-write on new runs).

**Validation:** typecheck ✓, lint ✓ (0 new), build ✓ (17/17), tests ✓ (26/26)

### Phase 1 — Summary and Status

Phase 1 is **COMPLETE**. All subphases (1A–1G) are done:
- 15 route-critical stores read through `SeedDataRepository` (file or Supabase)
- 7 import-path entities dual-write to Supabase when `DUAL_WRITE=true`
- Parity validation tooling exists and runs clean
- File-backed persistence is fully intact for rollback

---

## Phase 2 — Progressive Cutover (COMPLETE)

### Cutover Decision

**Decision: CUTOVER ACCEPTED — Beacon now defaults to Supabase.**

**Date:** 2026-04-09

**Rationale:**
1. 15/15 route-critical stores have exact row parity between file and Supabase (post–Phase 3C)
2. `observation_runs` parity is no longer an exception: file-backend merge + DB backfill + dual-write keep file and Supabase aligned; `observations/read.ts` has no `scan-runs.json` fallback (repository owns merge)
3. All 17 route pages build and render correctly under `DATA_SOURCE=supabase`
4. Supplementary data (`page-snapshot-diffs`, `render-checks`, `sitemap-reconciliation`, `visibility-observation-runs`) still lives on disk only — Phase 3A routes reads through `SeedDataRepository`, but **both** backends call `readDotDataJson` so Supabase-default behavior matches the prior direct-file behavior
5. Rollback is trivial and verified

### Current Configuration

```
# .env.local
DATA_SOURCE=supabase
DUAL_WRITE=true
```

- **Reads:** Route-critical data loaded from Supabase via repository layer
- **Writes:** Import/attribution write paths write to file first, then upsert to Supabase (best-effort)
- **Supplementary data:** Still sourced from `.data/*.json` on disk (no DB tables); accessed via repository getters + thin store modules so consumers do not call `readDotDataJson` directly

### Rollback Instructions

To instantly revert to file-backed reads:
1. Change `.env.local`: `DATA_SOURCE=file`
2. Restart the dev server or rebuild
3. All route pages will read from `.data/*.json` files again
4. `DUAL_WRITE=true` can remain (harmlessly writes to both backends)

No code changes needed. No database changes needed. No data loss.

### Known Exceptions

| Exception | Impact | Status |
|-----------|--------|--------|
| `observation_runs` | 3 rows in DB (backfilled from scan-runs.json), dual-write on new crawls/verifies | **Resolved** in Phase 3C — 15/15 parity |
| `import/actions.ts` `importRuns` | Uses shared `importRuns` from `seed-data.server` (repo-backed at init) | **Resolved** in Phase 3A |
| `visibility-read.ts` | Uses `citationEvidenceIndex` store + `visibilityObservationRunsExplicit` store | **Resolved** in Phase 3A (explicit runs still disk-only in both backends) |
| Supplementary stores (`page-snapshot-diffs`, etc.) | No Supabase tables yet; both repo backends read disk | **Routed** in Phase 3A — DB migration deferred |

### Validation Results (2026-04-09)

**Under `DATA_SOURCE=supabase`:**
- typecheck ✓ (0 errors)
- lint ✓ (0 errors, 72 pre-existing warnings)
- build ✓ (17/17 pages)
- tests ✓ (26/26)

**Rollback (`DATA_SOURCE=file`):**
- build ✓ (17/17 pages)
- Instant, no code changes needed

### Phase 3A — Mechanical read consolidation (COMPLETE)

**Scope:** Largest safe mechanical chunk — no new DB tables, no observation_runs schema work.

**Repository additions (4 getters, disk-backed in both backends until tables exist):**
- `getPageSnapshotDiffs()` → `page-snapshot-diffs.json`
- `getRenderChecks()` → `render-checks.json`
- `getSitemapReconciliation()` → `sitemap-reconciliation.json`
- `getVisibilityObservationRunsExplicit()` → `visibility-observation-runs.json`

**New thin store modules:**
- `src/domains/pages/page-snapshot-diff-store.ts` — `pageSnapshotDiffs`
- `src/domains/pages/render-check-store.ts` — `renderCheckResults`
- `src/domains/pages/sitemap-reconciliation-store.ts` — `sitemapReconciliation`
- `src/domains/observations/visibility-observation-explicit-store.ts` — `visibilityObservationRunsExplicit`

**Types:** `SitemapReconciliation` (+ canonical/stale row types) in `domains/pages/types.ts`

**Rewired consumers:**
- `src/app/(shell)/pages/page.tsx` — imports supplementary stores; removes direct `readDotDataJson`
- `src/domains/observations/visibility-read.ts` — `citationEvidenceIndex` + explicit visibility store
- `src/lib/import/actions.ts` — shared `importRuns` from `seed-data.server`; `citationEvidenceIndex` from `citation-evidence-store`; drops `readStore` for import runs

**Explicitly deferred (not in 3A):**
- `topics/page.tsx` server action — keeps dynamic `readDotDataJson` for **fresh** citation + snapshot reads at action time (avoid module-cache staleness)
- `universe-read.ts` file branch for pin metadata — unchanged
- Profound `import-orchestrator.ts` `readStore("imported-changes")` — unchanged (CLI path; repo vs file timing risk if switched blindly)
- Supabase tables for supplementary JSON — deferred to a later Phase 3 chunk

**Note (post–3C):** `observations/read.ts` **no longer** falls back to `scan-runs.json`; merge lives in `file-backend.getObservationRuns()`.

**Validation:** `npm run check`, `npm run test`, `npm run data:parity` — all pass; **15/15** parity after Phase 3C

---

### Phase 3B — json-store domain arrays behind repository (COMPLETE)

**Scope:** Thirteen `SeedDataRepository` getters for json-store-only operator/pages state. **Both** `file-backend` and `supabase-backend` delegate to `readStore(...)` (same in-process cache + mutation semantics as before). No new Postgres tables.

**New repository methods:**
`getRolloutExecutions`, `getPatternEvidence`, `getRolloutWaves`, `getFrontierOpportunities`, `getFrontierAttackPackages`, `getTrackedMissingPages`, `getAssetResponses`, `getOutcomeObservations`, `getCompetitorPageEvidence`, `getSourcePatternEvidence`, `getActionStates`, `getBriefStates`, `getTruthLabels`

**Domain modules rewired:** `issues.ts`, `wave-planner.ts`, `frontier-planner.ts`, `frontier-compiler.ts`, `asset-response.ts`, `outcome-watch.ts`, `competitor-evidence.ts`, `actions/store.ts`, `brief-generation/store.ts`, `attribution/store.ts`

**Adapter:** `adapters/profound/bridge.ts` — `writeLegacyBridge` appends to shared `importRuns` from `seed-data.server` (same array as `import/actions.ts`); removes duplicate `readStore("import-runs")`.

**Cleanup:** removed dead `readStore`/`writeStore` import from `builder-benchmark.ts`.

**Explicitly deferred (not in 3B):** topics dynamic action, `universe-read` pin file path, `import-orchestrator` changelog read, `canonical-store.ts` / Profound containment policy, new DB tables. (`observation_runs` alignment → Phase 3C.)

**Validation (2026-04-09):** `npm run check`, `npm run test`, `npm run data:parity` — pass; **15/15** parity after Phase 3C.

---

### Phase 3C — Observation Runs Alignment (COMPLETE)

**Blocker resolved:** The 99-vs-0 `observation_runs` parity mismatch was caused by `.data/observation-runs.json` containing **`ProfoundImportRun`** data (wrong type), NOT `ObservationRun` data. The actual website crawl data lived in `.data/scan-runs.json` (3 legacy rows) and was only accessible via a fragile fallback in the reader.

**Root cause:** The file `observation-runs.json` is shared between two unrelated concerns:
1. **`canonical-store.ts`** reads it as `ProfoundImportRun[]` (Profound pipeline — correct)
2. **`file-backend.ts`** read it as `ObservationRun[]` (website crawl reader — wrong type, all rows filtered out)

**Fix:**
1. **`file-backend.ts` `getObservationRuns()`** — now reads BOTH `observation-runs.json` (filtering for valid `ObservationRun` rows with `run_type`) AND `scan-runs.json` (converting legacy rows), merging into a unified array. ProfoundImportRun rows are silently skipped.
2. **`observations/read.ts`** — simplified; the `scan-runs.json` fallback is removed because the repository layer now handles merging at the backend level.
3. **DB backfill** — 3 legacy scan-runs rows inserted into `observation_runs` table via MCP `execute_sql`.
4. **Dual-write** — `appendObservationRunSync` now upserts to `observation_runs` when `DUAL_WRITE=true` (best-effort, errors logged).
5. **Parity script** — `observation-runs` comparison now counts valid `ObservationRun` rows (filtered by `run_type`) + `scan-runs.json` legacy rows, matching the file-backend logic.

**Result:** `npm run data:parity` → **15/15 parity**.

**What was NOT touched:**
- `canonical-store.ts` — still reads `observation-runs.json` as `ProfoundImportRun[]` (correct, isolated)
- `ProfoundImportRun` type / schema — untouched
- `VisibilityObservationRun` — separate concern, already working
- `scan-owned-pages.ts` CLI script — still writes to both `scan-runs.json` and `observation-runs.json`
- `visibility-persist.ts` — untouched

**Validation (2026-04-09):** typecheck ✓, lint ✓, build ✓ (17/17), tests ✓ (26/26), parity ✓ (15/15)

---

### Phase 3D — Post-parity stabilization (COMPLETE)

**Scope:** Documentation and containment only — no new tables, no behavior change.

**Done:**
- Aligned `master_execution_plan.md` with **15/15** parity and post–3C observation-run facts (removed stale 14/15 / reader-fallback language).
- Updated `docs/architecture.md` persistence section: Supabase-default reads, `DATA_SOURCE` rollback, dual-write summary.
- Clarified shared `.data/observation-runs.json` in `canonical-store.ts` (Profound slice) and `domains/observations/types.ts` (website rows + repository merge).
- Corrected `scripts/backfill-to-supabase.ts` comment for `observation_runs` (mixed file; script path still visibility-led).

**Deferred:** Carried forward — documented and bounded in **Phase 3E** (below).

**Validation:** Same suite as Phase 3C (`typecheck`, `lint`, `build`, `check`, `test`, `data:parity`).

---

### Phase 3E — Final stabilization + ambiguity elimination (COMPLETE)

**Scope:** Lock the persistence mental model in docs and code comments only — **no** new tables, **no** behavior change, **no** rewiring of topics or import-orchestrator.

**Done:**
- **`docs/architecture.md`:** “Persistence boundaries” table — canonical vs file, repository as default read path, Profound-only `canonical-store`, documented `readStore` / `readDotDataJson` exceptions, naming cheat sheet (website vs Profound vs visibility).
- **`docs/master_execution_plan.md`:** Corrected stale Phase 1 text (`DATA_SOURCE` default, dual-read diagram, Phase 1E validation / “NOT touched” vs current 3A+ reality).
- **Code guardrails (comments):** `json-store.ts`, `dotdata-json.ts`, `repositories/index.ts`, `types.ts`, `file-backend.ts`, `supabase-backend.ts`, `seed-data.server.ts`, `universe-read.ts`, `topics/page.tsx` (server action), `import-orchestrator.ts`, `canonical-store.ts`.

**Guarantees (locked):**
- Postgres = canonical **read** layer when `DATA_SOURCE=supabase`; files = durability, dual-write target, and **`DATA_SOURCE=file`** rollback.
- App logic reads through **`getRepository()`** unless listed in architecture “Documented bypasses.”
- **Profound** data stays behind `canonical-store` / adapters; **website** runs use `observations/read.ts` → repository.

**Explicitly NOT done (requires product/schema work — Opus-scale if pursued):**
- Rewiring topics server action to repo-only reads
- Rewiring `import-orchestrator` to `SeedDataRepository`
- Postgres migration for supplementary / json-store-only domains
- Splitting shared `observation-runs.json` file
- Crawl / real-time / Inngest / auth / RLS

**Validation:** `npm run check`, `npm run test`, `npm run data:parity` — **15/15** parity unchanged.

**Status:** **Persistence layer work for this track is complete.** Further changes = new features or schema design, not stabilization.

---

### Phase 5 — Change Impact Engine (COMPLETE)

**Scope:** First product layer on top of attribution — turn per-change scorecard rows into **confidence**, **direction**, **human “why”**, and **next action** (no persistence changes, no scoring redesign).

**Code:**
- `src/domains/attribution/change-impact.ts` — `computeChangeImpact`, `enrichWithImpact`; uses existing `ScorecardRow` from `scorecard.ts`
- `src/domains/attribution/types.ts` — `ImpactConfidence`, `ImpactDirection`, `ChangeImpact`; `ChangeVerdict` extended with `negative` (**now assigned** by scorecard when all linked events are negative — Phase 6)

**UI:**
- `/changes` — impact summary strip, confidence badge beside verdict, **What to do** column, table open by default
- `/changes/[id]` — **Impact assessment** block (confidence, direction, why, next action)
- `change-verdict-badge.tsx` — label for `negative` verdict

**Validation:** `npm run check`, `npm run test`, `npm run data:parity` — unchanged expectations (15/15).

**Follow-ups:** ~~decline/regression events~~ DONE Phase 6; ~~URL normalization~~ DONE Phase 6; opportunity-to-change recommendations (Track B).

---

### Post–Phase 3E backlog (product / schema — do not start as “cleanup”)

1. Topics server action freshness vs repository-cached stores
2. `import-orchestrator` read path — explicit file-vs-DB policy for CLI
3. Migrate supplementary + json-store domains to Postgres — schema + backfill
4. `canonical-store` / Profound file stores — split or containment policy
5. Real-time / crawl pipeline — separate program

### Phase 6 — Measurement Honesty: URL + Decline (COMPLETE)

**Scope:** Fix two attribution blind spots — URL matching (100% unknown) and negative event detection (didn't exist). No persistence, no schema, no new UI surfaces.

**URL normalization (`compute.ts`):** `matchUrl` now pipes through `normalizePageUrl` + `canonicalizeOwnedUrl` (from `classify.ts`). Handles path-only, full URLs, legacy domains, UTM stripping, www/m prefix removal. Directory-level partial match when same domain + parent path.

**Decline/loss event detection (`events.ts`):** `visibility_lost` (mentions to 0 after 2+ days, mirroring `visibility_regained`) and `mention_decline` (sharp rate drop, inverse of `mention_surge`). `isNegativeEvent()` helper exported.

**Scorecard (`scorecard.ts`):** All-negative-events + primary = `negative` verdict. Positive flow unchanged.

**Impact Engine (`change-impact.ts`):** `eventDirection` uses event type system; explanation calls out negative events.

**UI:** `/review` — "Dropped off", "Mentions fell"; `/changes/[id]` — "Visibility Lost", "Mention Decline"

**Validation:** `npm run check`, tests 26/26, parity 15/15, build 17/17.

### Phase 7 — Today Decision Surface (COMPLETE)

**Scope:** Surface Impact Engine output on the operator landing page — no new computation, no persistence.

**Server (`page.tsx`):** Calls `enrichWithImpact` on existing `scorecardRows`. Sorts by verdict priority (validated > negative > partial > inconclusive > no_impact > too_early > pending), then confidence, then score. Filters out `too_early`, `pending`, and zero-event rows. Passes top 5 as `impactSignals` prop.

**Client (`today-client.tsx`):** `TodayImpactItem` type; "Change impact signals" section between "Next best move" and "Work queue". Each card: verdict dot (green/red/yellow/gray), asset name, confidence badge, next-action text, match score, event count, link to `/changes/[id]`. Validated/negative cards get colored borders.

**Validation:** `npm run check`, tests 26/26, parity 15/15, build 17/17.

### Phase 8 — Recommendation Engine (COMPLETE)

**Scope:** Synthesis layer connecting attribution-backed impact to structural page gaps. No persistence, no scoring changes.

**New module:**
- `src/domains/product/recommendation-engine.ts` — `computeRecommendations()` takes impact rows, mined patterns, and playbook briefs; outputs ranked `BeaconRecommendation[]`

**Algorithm:**
1. Find proven positive changes (validated/partial + positive direction + events > 0)
2. Match each to a structural pattern via URL-in-source-pages or URL-path heuristic (/locations/ -> city pattern, /services/ -> service pattern, description mentions FAQ/schema -> faq pattern)
3. For each matched pattern, find playbook briefs targeting that pattern on OTHER pages (excluding pages already changed)
4. Generate "replicate" recommendations with proven change as evidence
5. Generate "strengthen" recommendations for weak-evidence changes with linked events (suggests specific topic/URL from event data)
6. Generate "investigate" recommendations for negative-direction changes
7. Fallback: top playbook briefs when no proven patterns exist

**Three recommendation types:**
- **replicate** — "Apply this proven pattern to this specific page" (evidence: validated change + structural gap)
- **strengthen** — "Improve this changelog entry" (evidence: linked events + weak tier + specific field gaps)
- **investigate** — "Check this regression" (evidence: negative events after change)

**Today page integration:**
- `page.tsx` calls `computeRecommendations`, serializes top 5 for client
- High-confidence replicate recommendation inserted as first "next best move" candidate (system becomes proactive, not just reactive)
- `today-client.tsx` renders "Recommended moves" section between impact signals and work queue
- Cards colored by type (green=replicate, yellow=strengthen, red=investigate), confidence badge, evidence summary

**Validation:** `npm run check` (17/17), `npm run test` (26/26), `npm run data:parity` (15/15).

### Phase 9 — Priority Engine (COMPLETE)

**Scope:** Rank all possible actions, select the single highest-leverage move, enforce execution focus. No persistence, no scoring formula changes.

**New module:**
- `src/domains/product/priority-engine.ts` — `rankAndSelect()` takes recommendations + impact context, produces prioritized actions

**Scoring model (0-100, 6 dimensions):**
- Impact confidence (0-25): high=25, medium=15, low=5
- Evidence strength (0-20): exact=20, probable=14, weak=6, inferred=2
- Pattern strength (0-15): validated=15, probable=9, speculative=4
- Replication potential (0-15): scaled by number of pages the pattern applies to (capped at 10)
- Type urgency (0-15): investigate=15, replicate=8, strengthen=3
- Recency (0-10): exponential decay over 90 days from source change

**Buckets:**
- CRITICAL (>=72): must act now
- HIGH_LEVERAGE (>=50): strong ROI
- OPPORTUNISTIC (>=25): useful but not urgent
- NOISE (<25): filtered out

**Primary action selection:** Highest-scored non-noise recommendation becomes THE one action. All others are secondary.

**Expected outcome generation:** Per-type text explaining what happens if the operator acts (visibility lift for replicate, evidence upgrade for strengthen, loss prevention for investigate).

**Today page UI:**
- "DO THIS NOW" block replaces "Next best move" when a primary action exists (bold border, score badge, bucket label, headline, why, expected outcome, CTA)
- Secondary recommendations collapse into "Other opportunities (N)" toggle
- Graceful fallback to existing next-move logic when no primary action qualifies

**Validation:** `npm run check` (17/17), `npm run test` (26/26), `npm run data:parity` (15/15).

### Phase 10 — Changes Detail Action Generation (COMPLETE)

**Scope:** Surface recommendation engine output on `/changes/[id]` so validated changes generate specific next actions in-place. No new modules, no persistence.

**What was added to `/changes/[id]/page.tsx`:**
- Full recommendation pipeline: `enrichWithImpact` on all scorecard rows → build citation map → `minePatterns` → `generateBriefs` → `computeRecommendations`
- Filter: `replicateRecs` where `sourceChangeId === id` (pages this change's pattern applies to)
- Filter: `strengthenRec` where `sourceChangeId === id` (evidence quality nudge for this change)
- Page URL → page ID lookup for `/pages?p=` deep links

**UI sections added (between "Impact assessment" and "Hypothesis"):**
- "Apply this pattern (N pages)" — green-bordered section, one row per target page with headline + citation count + link to Website
- "Strengthen this entry" — yellow-bordered section with gap rationale (missing URL/topic/hypothesis)

**What was NOT touched:**
- Today page, Changes list page, recommendation engine, priority engine, attribution scoring
- No new modules, no new types, no new stores
- Existing impact assessment block unchanged

**Validation:** `npm run check` (17/17), `npm run test` (26/26), `npm run data:parity` (15/15).

### Phase 11 — Recommendation Feedback Loop (COMPLETE)

**Scope:** Beacon learns from its own recommendations. Retroactive matching of changes to recommendation patterns, per-pattern track record, priority engine reinforcement, surface-level feedback display. No new persistence.

**New module:**
- `src/domains/product/recommendation-tracker.ts` — `computeTrackRecord()` + `wasChangeRecommended()`

**Algorithm:**
1. For each change in the scorecard, find which structural pattern it matches (via `matchChangeToPattern`)
2. For each match, check if OTHER changes for the same pattern were proven-positive AND had earlier timestamps
3. If yes → this change "likely fulfilled" a recommendation (a prior proven change would have generated a replicate rec)
4. Match confidence: `likely` (same URL path prefix) / `possible` (pattern match only)
5. Aggregate by pattern: actedOn, validated/partial/inconclusive/noImpact/negative/tooEarly, successRate

**Types:**
- `TrackedOutcome`: changeId, patternId, matchConfidence, priorProvenChangeId, verdict, direction
- `PatternTrackRecord`: patternId, patternName, actedOn, validated, ..., successRate
- `TrackRecordSummary`: outcomes, patternRecords, totalActedOn, totalValidated, overallSuccessRate

**Priority engine enhancement:**
- 7th scoring dimension: pattern track record (-5 to +10)
- successRate >=70% → +10, >=50% → +6, >=30% → +2, poor + negative → -5
- Only activates when pattern has >=2 acted-on changes (avoids noise from single data points)

**Today page:**
- "Beacon track record" summary line between primary action and impact signals
- Shows: N acted on, M validated, success rate %

**Changes detail:**
- "Beacon recommended" badge on changes matching a recommendation pattern
- Shows match confidence and pattern name

**What was NOT touched:**
- Recommendation engine logic unchanged
- Attribution scoring unchanged
- No new stores, no new persistence, no new tables
- Today page layout structure unchanged beyond the new line

**Validation:** `npm run check` (17/17), `npm run test` (26/26), `npm run data:parity` (15/15).

### Phase 12 — Changes List Intelligence Surface (COMPLETE)

**Scope:** Wire recommendation tracker and replication intelligence into the `/changes` scorecard table. Transform the primary work surface from a passive log into an intelligence surface. No new modules, no persistence.

**What was added to `/changes/page.tsx` (server):**
- Full pattern mining + brief generation pipeline: `minePatterns` → `generateBriefs` → `computeTrackRecord`
- Per-change intelligence map: for each row, compute `wasChangeRecommended` and replication count (briefs matching the change's proven pattern)
- Aggregate stats: `beaconRecommendedCount`, `totalReplicationTargets` for the impact snapshot strip
- Pass `changeIntel` record to `ScorecardTable`

**What was added to `scorecard-client.tsx` (client):**
- New `ChangeIntelEntry` type: `{ beaconRecommended, matchConfidence?, patternName?, replicationCount }`
- "Beacon" badge on rows matching a recommendation pattern (inline below change name, with confidence qualifier)
- "N replicable" badge on validated/partial changes with proven patterns that have additional target pages
- "Beacon recommended" toggle filter: operator can filter the table to only Beacon-recommended changes
- "Impact" sortable column: sort by impact confidence (high/medium/low)
- Impact snapshot strip updated: shows Beacon-recommended count and total replication targets alongside existing stats

**What was NOT touched:**
- Recommendation engine logic unchanged
- Priority engine unchanged
- Recommendation tracker unchanged
- Attribution scoring unchanged
- Today page unchanged
- Change detail page unchanged
- No new modules, no new types beyond `ChangeIntelEntry`, no new stores

**Validation:** `npm run check` — pass.

### Phase 13 — Recommendation Response (COMPLETE)

**Scope:** Explicit operator response to recommendations — accept, dismiss, defer. Persisted via json-store. Dismissed recs filtered from future display. Deferred recs suppressed for 7 days. Accepted recs shown with status badge.

**New module:**
- `src/domains/product/recommendation-response-store.ts` — `RecommendationResponse` type, `readStore`/`writeStore`, `recordResponse()`, `isRecSuppressed()`, `getResponse()`
- Store name: `recommendation-responses` (`.data/recommendation-responses.json`)

**New server action:**
- `src/app/(shell)/recommendation-actions.ts` — `respondToRecommendation(recId, status)` — records response, persists, revalidates

**Types:**
- `RecommendationResponseStatus`: `"accepted" | "dismissed" | "deferred"`
- `RecommendationResponse`: `{ recId, status, respondedAt, deferUntil }`

**Today page changes:**
- `page.tsx` (server): imports response store, filters recommendations via `isRecSuppressed()` before `rankAndSelect()`, adds `id` and `responseStatus` to serialized primary action and secondary recs, passes `onRespondToRec` to client
- `today-client.tsx`: new `RecResponseStatus` type, `onRespondToRec` prop, Accept/Not now/Dismiss buttons on primary action and secondary opportunities, "Accepted" badge shown on accepted recs

**Response behavior:**
- **Accept**: recommendation stays visible with "Accepted" badge, buttons removed
- **Dismiss**: recommendation removed from display on next load (filtered before ranking)
- **Not now (defer)**: recommendation suppressed for 7 days, then re-emerges

**What was NOT touched:**
- Recommendation engine logic unchanged
- Priority engine scoring unchanged
- Recommendation tracker retroactive matching unchanged
- Attribution scoring unchanged
- Changes list / Changes detail pages unchanged
- No Supabase schema changes

**Validation:** `npm run check` — pass.

---

## Product Strategy — Corrected (2026-04-09)

### Positioning

Beacon is NOT a budget monitoring dashboard. Beacon is NOT "Profound for the rest of us."

Beacon is **the AI visibility attribution and action system for high-value businesses.** It connects content changes to AI visibility outcomes deterministically and tells operators exactly what to do next.

**Core value proposition:** One qualified lead from AI search pays for a year of Beacon. For businesses where a single client is worth $10K–500K, knowing whether AI is sending or losing them customers — and what to do about it — is worth hundreds per month.

### Target Buyer

Local high-value service businesses: luxury home builders, specialty law firms, medical specialists, wealth advisors, boutique agencies. These buyers:
- Have client LTV of $10K–500K (subscription pays for itself with 1 lead per year)
- Already spend $2K–20K/month on marketing
- Are underserved by enterprise AEO tools (too expensive) and generic SEO tools (too complex, no attribution)
- Need simple answers: "Is AI helping or hurting my business? What should I do?"

### Pricing Tiers

| Tier | Price | What's included | Target |
|------|-------|-----------------|--------|
| Free Preview | $0 | 5 queries, 1 platform, weekly snapshot, no attribution/recs | Top of funnel |
| Professional | $249/mo | 100+ queries, all platforms, daily tracking, full attribution, recs, 3 competitors, email briefing | Operator/marketer |
| Premium | $499/mo | Unlimited queries/competitors, page audits, pattern analysis, custom reports, API, priority support | Serious operator, boutique agency |
| Enterprise | $999+/mo | Multi-user, white-label, multi-workspace, dedicated support | Agency with clients |

### Strategic Moat

No competitor below $399/month offers deterministic attribution (connecting specific content changes to specific visibility outcomes). This capability is Beacon's core differentiator and the foundation of premium pricing.

### Strategic Sequence

1. Internal daily tool (Phases 14–16)
2. Premium product surfaces (Phases 17–18)
3. Habit loop / trigger (Phase 19)
4. External product (Phases 20–22)

Each step must be complete before the next. Do not optimize for broad market before internal daily loop is irrefutable.

---

## Master Roadmap — Phases 14–22

### Phase 14 — Daily Surface Compression + Visibility Story (COMPLETE)

**Objective:** Make the Today page a complete 30-second daily experience with a clear AI visibility summary.

**What was shipped:**
- **Visibility summary strip** on Today: total citations with trend %, per-platform breakdown (ChatGPT, Perplexity, Google AIO, Gemini, Claude), data freshness indicator (>7d stale warning with import link)
- **Navigation compressed**: Primary group: Today, Pages, Changes, Competitors, Topics. Advanced group: Review, Import, Sample history, Diagnostics, Draft ideas. Removed Work and Experimental groups.
- **Impact signals reduced** from 5 to 3, renamed "What changed"
- **Work queue collapsed** by default (toggle to expand)
- **System details collapsed** by default (crawl observation, visibility sample, attribution line, verified fixes behind "System details" toggle)
- **Today layout reordered**: Visibility strip → DO THIS NOW → Track record → What changed → Other opportunities → Work queue (collapsed) → System details (collapsed)

**Files changed:**
- `src/lib/navigation.ts` — regrouped nav items, added Competitors, removed Experimental group
- `src/app/(shell)/page.tsx` — visibility summary computation (citations, platforms, trend, freshness), impact signals reduced to 3
- `src/app/(shell)/today-client.tsx` — new `VisibilitySummary` type, restructured layout with collapsed sections

**What was NOT touched:** Attribution engine, recommendation engine, priority engine, Supabase schema, import pipeline, persistence, changes pages, all domain modules.

**Validation:** `npm run check` — pass (0 errors, 71 warnings — all pre-existing).

### Phase 15 — Import Simplification + Freshness Loop (COMPLETE)

**Objective:** Make refreshing data a simple daily action, not a project.

**What was shipped:**
- **Coverage strip** on `/import`: result count, change count, date range, platform count, data freshness, last import time
- **Drag-and-drop upload zone** for .xlsx with clear "Beacon will import only new data" messaging
- **Delta-aware import result**: new vs. updated counts (results + changes), post-import date range
- **Return-to-Today CTA** replaces "Open Review Queue" as primary post-import action
- **Advanced sections collapsed**: Profound CSV, Manual paste, Reset, Import history behind "Advanced import options" toggle
- **Page title simplified**: "Import" (was "Import Historical Data")
- **`getDataCoverage()` server action**: returns current counts, dates, platforms, last import time
- **`WorkbookImportResult.delta`**: new field tracking `results_new`, `results_updated`, `changes_new`, `changes_updated`, `date_range_after`

**Files changed:**
- `src/app/(shell)/import/page.tsx` — full restructure
- `src/lib/import/actions.ts` — `getDataCoverage()` action, delta tracking in `importWorkbook`
- `src/lib/import/types.ts` — `delta` field on `WorkbookImportResult`

**What was NOT touched:** Import engine logic, workbook parser, Profound import pipeline, attribution, recommendations, priority, Supabase schema, all domain modules.

**Validation:** `npm run check` — pass (0 errors).

### Phase 16 — Page Intelligence Surface (COMPLETE)

**Objective:** Transform `/pages` from an execution workbench into a page intelligence surface.

**What was shipped:**
- **Page health summary strip**: total pages, winning (green), needs action (red), building (blue), cited count + total citations, structure warnings (pages missing FAQ/schema)
- **Page health card** at top of detail panel: prominent status badge (Winning/Building/Unresolved/Dormant), citation count + platform list, structure health (FAQ/Schema indicators), next action in highlighted block
- **Structure health in list items**: "no FAQ" / "no schema" warnings visible in page list without expanding
- **Evidence internals moved to progressive disclosure**: observation runs, evidence mix, scanner details behind "Show details" toggle
- **Page title simplified**: "Pages" / "Page-level AI visibility health and actions" (was "Your Website" / "Primary workbench")
- **7 lint warnings resolved**: previously unused summary stat variables now wired to client

**Files changed:**
- `src/app/(shell)/pages/page.tsx` — `pageSummary` computation + prop passing, title change
- `src/app/(shell)/pages/pages-client.tsx` — `PageSummary` type, summary strip, health card, structure indicators in list items

**What was NOT touched:** Page computation logic (770-line server unchanged), attribution, recommendations, priority engine, import, Supabase, persistence, all domain modules. All fix/playbook/wave/verify functionality preserved in progressive disclosure.

**Validation:** `npm run check` — pass (0 errors, 64 warnings — down from 71, 7 resolved).

### Phase 17 — Competitive Clarity Surface (COMPLETE)

**Objective:** Transform `/competitors` from a configuration surface into a competitive intelligence surface.

**What was shipped:**
- **Competitive summary strip**: your AI share %, your citation count, tracked competitor count, observation basis
- **Top competitors ranked**: each with citation count, share %, "Ahead of you" badge, link to detail page
- **Competitive gap visualization**: "Where you are strongest" (green bars) vs "Biggest competitive gaps" (red bars with competitor % vs your %)
- **Weakest areas**: topics where your share is lowest
- **Next moves**: action links derived from `computeMarketBenchmark` (fix pages, strengthen weak topics)
- **No-data fallback**: clear guidance when citation evidence is missing
- **Settings collapsed**: universe CRUD editor and imported entity list behind "Competitor settings" toggle

**Files changed:**
- `src/app/(shell)/competitors/page.tsx` — full rewrite: wired `computeMarketBenchmark`, rendered competitive intelligence, collapsed settings

**What was NOT touched:** Competitor detail page, competitor domain modules (16 files), attribution, recommendations, priority engine, import, Supabase, persistence.

**Validation:** `npm run check` — pass (0 errors, 64 warnings).

### Phase 18 — Track Record Enhancement (COMPLETE)

**Objective:** Feed explicit operator responses (accept/dismiss) into the recommendation tracker for stronger learning signals.

**What was shipped:**
- **`SignalTier`** type (`"explicit" | "inferred"`) on `TrackedOutcome` — outcomes now distinguish operator-confirmed vs retroactively-inferred signals
- **`computeTrackRecord` enhanced** — accepts optional `responses` + `recommendations` params; bridges rec IDs → pattern IDs; maps accepted rec target pages to explicit outcomes
- **`PatternTrackRecord` enhanced** — `explicitAccepted` and `explicitDismissed` counts per pattern
- **`TrackRecordSummary` enhanced** — `totalExplicitAccepted` and `totalExplicitDismissed`
- **Priority engine enhanced** — explicit acceptance bonus (+2/+4), explicit dismissal penalty (-3/-7); dismissal penalty applies without actedOn threshold
- **Today surface** — track record line shows "N accepted" / "N dismissed" alongside inferred stats

**Signal flow:**
1. Operator accepts/dismisses rec on Today → persisted in recommendation-response-store
2. On next page load, `computeTrackRecord` receives responses + recommendations
3. Accepted recs bridged to patterns via rec ID → patternId lookup
4. Outcomes for pages that were explicitly accepted targets get `signalTier: "explicit"` (stronger than inferred)
5. Per-pattern explicit counts flow into priority engine scoring
6. Dismissed patterns get penalized in priority scoring

**Files changed:**
- `src/domains/product/recommendation-tracker.ts` — types, signal tier, explicit counts, response params
- `src/domains/product/priority-engine.ts` — explicit acceptance bonus, dismissal penalty
- `src/app/(shell)/page.tsx` — wire responses + allRecommendations into computeTrackRecord, enhanced trackRecordSummary
- `src/app/(shell)/today-client.tsx` — display explicit counts in track record line

**What was NOT touched:** Recommendation engine, recommendation response store, import, Supabase, persistence, all surfaces except Today track record display.

**Validation:** `npm run check` — pass (0 errors, 64 warnings).

### Phase 19 — Multi-Dimensional Recommendation Expansion (COMPLETE)

**Objective:** Expand recommendations from 3 narrow types to 7 diverse, evidence-grounded action classes.

**What was shipped:**
- **4 new recommendation types** added to the engine:
  - `strengthen_structure` — cited pages missing FAQ or schema (refine before expand)
  - `improve_internal_links` — cited pages with < 5 internal links
  - `refresh_content` — cited but thin pages (< 800 words or < 2 H2s)
  - `competitive_displacement` — topics where competitors have ≥2x our citation share
- **Evidence thresholds** prevent spam: citation minimums, structural gap requirements, per-type caps (2-3 max each)
- **Priority engine** scores new types with distinct urgency weights
- **Expected outcome generation** for all new types
- **Today client** shows new types with distinct accent colors and labels

**Anti-spam design:**
- Recommendations require real evidence (citations + gaps), not templated cloning
- Each type capped to prevent flooding (max 2-3 per class)
- City/service expansion remains just one class among seven
- Refinement types (`strengthen_structure`, `refresh_content`) prioritized over duplication

**Files changed:**
- `src/domains/product/recommendation-engine.ts` — 4 new rec generation blocks, expanded type + inputs
- `src/domains/product/priority-engine.ts` — urgency scoring + outcome generation for 4 new types
- `src/app/(shell)/today-client.tsx` — accent colors for new types, widened type fields
- `src/app/(shell)/page.tsx` — wire pageSnapshots/citMap/citationIndex into rec engine

**Validation:** `npm run check` — pass (0 errors, 64 warnings).

### Phase 20 — In-App Trust Layer + Evidence Explainability (COMPLETE)

**Objective:** Make Beacon's intelligence more inspectable and trustworthy so the operator can act on it daily with confidence.

**What was shipped:**
- **Evidence block on DO THIS NOW**: structured section with evidence basis, confidence level + reason, data freshness, and "after acting" watch guidance
- **Confidence reasons**: server-computed from evidence tier, citation count, pattern track record %
- **Watch-after guidance**: per-recommendation-type instructions for what to look for post-action
- **Data freshness**: "Based on data through [date]" on primary action card
- **Secondary rec evidence**: inline evidence + confidence reason visible without expanding
- **Pages status reason**: `statusReason` field computed server-side — explains WHY a page is Winning/Building/Unresolved/Dormant

**Files changed:**
- `src/app/(shell)/page.tsx` — `buildConfidenceReason`, `buildWatchAfter`, `dataFreshness` computation; added to primary + secondary serialization
- `src/app/(shell)/today-client.tsx` — evidence block rendering, type updates, evidence line in secondary recs
- `src/app/(shell)/pages/page.tsx` — `statusReason` computation
- `src/app/(shell)/pages/pages-client.tsx` — `statusReason` in `PageRow` type + health card rendering

**What was NOT touched:** Recommendation engine, priority engine, tracker, response store, import, Supabase, persistence, competitor surface, changes surfaces.

**Validation:** `npm run check` — pass (0 errors, 64 warnings).

### Phase 21 — Topic-Similarity / Adjacent Opportunity Expansion (COMPLETE)

**Objective:** Expand recommendations with cross-page and topic-cluster adjacency logic that avoids city-page spam.

**What was shipped:**
- **`cross_page_pattern`** — proven pattern on page type A → apply to different page type B with shared topic/term overlap. Requires different page types (anti-spam by design).
- **`topic_cluster_gap`** — topic with ≥15 owned citations but only transactional pages. Recommends guide/comparison content.
- Priority engine scoring + expected outcomes + watch-after for both types
- Today accent colors for both new types
- `allPages` wired into recommendation engine for page-type resolution

**Anti-spam constraints:**
- `cross_page_pattern` REQUIRES different page types — cannot clone city pages
- `topic_cluster_gap` recommends MISSING content types, not more of what exists
- Capped at 3 + 2 recs respectively

**Files changed:**
- `src/domains/product/recommendation-engine.ts` — 2 new rec generation blocks, expanded type + `allPages` input
- `src/domains/product/priority-engine.ts` — urgency scoring + outcome gen for 2 new types
- `src/app/(shell)/today-client.tsx` — accent colors for new types
- `src/app/(shell)/page.tsx` — wire `allPages` + watch-after for new types

**Validation:** `npm run check` — pass (0 errors, 64 warnings).

### Phase 22 — In-App Experiment Loop / Watchlist (COMPLETE)

**Objective:** Close the gap between "Beacon recommended it" and "I can track whether it worked."

**What was shipped:**
- **Experiment store** (`experiment-store.ts`): lightweight persistence for recommendation→action→outcome tracking
- **Server actions** (`experiment-actions.ts`): start experiment, update status, update note
- **Start experiment flow**: "Start testing" button on accepted DO THIS NOW → operator note prompt → experiment created
- **Watchlist on Today**: active experiments with headline, note, status, days elapsed, citation delta, watch-after guidance
- **Auto-outcome detection**: citation counts refreshed on page load; status auto-updates based on citation delta and time elapsed
- **Store**: `.data/experiments.json` via json-store

**Experiment lifecycle:**
1. Accept rec → "Start testing" button appears
2. Click → enter what you changed → experiment created with citation baseline
3. Experiment appears in Today watchlist
4. After next import: citations auto-refresh, status updates (promising/inconclusive/negative/watching)
5. Operator can drop experiments manually

**Files changed:**
- `src/domains/product/experiment-store.ts` — NEW: types, store, helpers
- `src/app/(shell)/experiment-actions.ts` — NEW: server actions
- `src/app/(shell)/page.tsx` — wire experiments, auto-update citations, serialize for client
- `src/app/(shell)/today-client.tsx` — watchlist section, "Start testing" button, experiment types

**Validation:** `npm run check` — pass (0 errors, 64 warnings).

### Phase 23 — Nightly Usage Hardening (COMPLETE)

**Objective:** Remove friction from the real nightly operating loop.

**What was shipped:**
- **Combined "Accept & test"**: one-click flow accepts rec + creates experiment with note prompt + citation baseline
- **Button hierarchy fixed**: clean state separation (not accepted vs accepted vs testing). "Not now" / "Dismiss" hidden after acceptance.
- **Target data flows through**: experiments capture `targetPageUrl`, `targetPagePath`, `baselineCitations` from the recommendation
- **Post-import messaging**: tells user watchlist experiments will refresh with new data

**Friction fixes:**
1. Accept + Start testing was 2 steps → now 1 ("Accept & test")
2. "Do it now →" appeared first and sent user away → now "Accept & test" is primary
3. "Not now" / "Dismiss" showed after accepting → now hidden
4. Experiments started with null target/citations → now captures real data
5. Post-import didn't mention watchlist → now does

**Files changed:**
- `src/app/(shell)/today-client.tsx` — button hierarchy restructure, target data fields
- `src/app/(shell)/page.tsx` — pass `targetPageUrl`, `targetPagePath`, `baselineCitations` to serialized primary
- `src/app/(shell)/import/page.tsx` — watchlist refresh messaging

**Validation:** `npm run check` — pass (0 errors, 64 warnings).

### Phase 24 — Daily Habit Loop (Email Briefing)

**Objective:** Pull the user into Beacon daily without requiring them to remember.

**What gets built:**
- Email infrastructure (Resend or equivalent)
- Morning briefing: visibility changes, one competitor insight, one action, link into Beacon
- Weekly digest option
- Frequency controls

**Value:** Beacon comes to you.

### Phase 20 — Auth & Onboarding

**Objective:** Let external users create accounts and use Beacon.

**What gets built:**
- Supabase Auth (email + password, Google OAuth)
- RLS policies on existing tables
- User-scoped data isolation
- Simple onboarding flow: connect data → first insight → competitor → briefing

**Value:** Other people can use Beacon.

### Phase 21 — Premium Billing

**Objective:** Revenue via Stripe.

**What gets built:**
- Stripe subscription integration
- Tier enforcement (Free/Professional/Premium/Enterprise)
- Usage metering, upgrade/downgrade flows
- Billing management

**Value:** Beacon is a real business.

### Phase 22 — External Product Polish

**Objective:** Premium look and feel for external users.

**What gets built:**
- Landing page / marketing site
- Help/explanation layer (tooltips, progressive disclosure)
- Empty state handling, error handling
- Performance optimization (sub-2s loads)
- Mobile responsiveness

**Value:** External users trust and understand Beacon.

### Phase 23 — Agency & Multi-Tenant

**Objective:** Support agencies managing multiple clients.

**What gets built:**
- Multi-workspace support
- White-label reporting
- Client-facing dashboards
- Per-client data isolation

**Value:** Revenue expansion into agency segment.

---

## Master UI/UX product shell overhaul — PLANNED (research + roadmap only, 2026-04-09)

**Status:** Research audit and documentation complete. **No implementation in this pass.** Next agent implements in the phased sequence below.

**Why this exists:** Intelligence through Phase 23 + Product Premiumization Pass improved copy and some hierarchy, but parallel codebase audits still show **admin/console density**, **competing heroes** (e.g. visibility strip vs primary action), **overlapping status/badge languages**, **URL/label/shortcut drift** (e.g. Opportunities vs `/topics`, History vs `/results`), **list/detail patterns that read as QA tooling**, and **interaction choices that break premium trust** (e.g. `prompt()` for notes). Premium B2B products (see external references below) converge on: **chrome that recedes**, **one primary story per view**, **progressive disclosure**, **consistent navigation IA**, **command palette as discoverability + shortcut teaching**, and **calm structure over border proliferation**.

**External pattern references (sources, not copy-paste):**
- [Linear — How we redesigned the Linear UI (part II)](https://linear.app/now/how-we-redesigned-the-linear-ui): alignment, hierarchy, density without clutter, sidebar/chrome refresh.
- [Linear — A calmer interface for a product in motion](https://linear.app/now/behind-the-latest-design-refresh): “Don’t compete for attention you haven’t earned”; softer borders; sidebar recedes so main content leads.
- [Stripe Dashboard basics](https://stripe.com/docs/dashboard/basics) + [Stripe Apps design / view types](https://docs.stripe.com/stripe-apps/design): Home vs list vs detail surfaces; ContextView / FocusView / SettingsView pattern language for “meet the user in workflow.”
- [Amplitude — Evolution of Amplitude Charts](https://amplitude.com/blog/evolution-of-amplitude-charts): guided top-down structure, side-by-side feedback, progressive disclosure, modularity.
- [Superhuman — How to build a remarkable command palette](https://blog.superhuman.com/how-to-build-a-remarkable-command-palette/): palette everywhere, shortcuts visible for learning.
- [Ramp / Fast Company — interface simplification narrative](https://www.fastcompany.com/91381134/ramp-fintech-startup-interface-of-the-future): encode complexity under the hood; default path minimal (product philosophy, not a UI clone).

**Non-negotiables for implementation agents:**
- **Do not** change attribution, recommendation, priority, tracker, experiment stores, or import/persistence semantics unless a UI bug forces a display-only fix.
- **Do** treat this as **shell + IA + design system + interaction**: layout, spacing, typography scale, disclosure, nav grouping, status vocabulary, empty states, motion restraint, list/detail rhythm.

### Shell Phase A — Design system + chrome baseline — COMPLETE (2026-04-10)

**Shipped:** Sidebar tokens receded (background, foreground, border); global `--border` softened; ~153 `uppercase tracking-wider/widest` instances purged across 27 files; `text-[9px]` section labels bumped to `text-[11px]`; StatCard, FormField, command palette labels de-admin-ified; PageHeader title size raised to `text-lg` with better spacing; header border softened; stale “Gap ledger” vocabulary fixed in breadcrumbs + palette.

**Not touched:** Domain logic, persistence, attribution, recommendation, priority, experiments.

### Shell Phase B — Navigation + information architecture — COMPLETE (2026-04-10)

**Shipped:** “Advanced” group split into “Data” (Import, Review, History) + “System” (Diagnostics); keyboard shortcuts realigned — `G P` Pages, `G C` Changes, `G X` Competitors, `G I` Import added; `G S`/`G H` duplicates removed; `G E` ghost shortcut for hidden `/expansion` removed; help-panel labels updated to short product names; “Sample history” vocabulary purged from page titles and user-facing strings (~10 instances across 8 files); “Diagnostics (analyst)” title simplified; stale “Gap ledger” / “Website” labels cleaned from remaining surfaces.

**Not touched:** Domain logic, persistence, attribution, recommendation, priority, experiments, page content.

### Shell Phase C — Today (operator home) — COMPLETE (2026-04-10)

**Shipped:** Primary action card sculpted — "Why"/"Expected outcome" labels removed, rationale flows as prose with inline outcome; confidence/freshness/watch-after consolidated into two compact support lines; CTA hierarchy simplified (dominant "Accept & test" button, secondary actions as text links instead of bordered buttons); track record reframed as momentum line (dropped raw "% success" and dismissed count); watchlist section tightened (proper heading, compact cards, operator note moved below metrics); "What changed" cards raised to `text-[13px]`, redundant "All changes →" link removed; all collapsed sections given consistent `text-[11px]` treatment; visibility strip date range removed (freshness link covers it); fallback action card cleaned of internal jargon ("evidence scope", "ObservationRun"); stale "Website" vocabulary cleaned from queue detail strings.

**Not touched:** `rankAndSelect`, `computeRecommendations`, priority engine, experiment store, attribution.


### Shell Phase D — Pages (list/detail) — COMPLETE (2026-04-10)

**Shipped:** Summary strip recast (strong / need work / mentions, calm structure-health line); filter tabs as `text-xs` with primary selection; wider list column; rows use `text-[13px]` titles, muted structure chips (No Q&A / No schema) vs warning spam; status labels productized (Strong, Follow up, Low signal); server `statusReason` copy cleaned (“needs review” removed); detail panel reframed as page brief — path as `text-xs`, status+reason top-right, mention count + platform string + Q&A/structured data chips; “Next step” card; “Why it matters” / “Recommended move” / “Opportunity” headings; primary CTA “Hand off to dev”; details disclosure renamed “Evidence & technical detail”; fix-brief grids Target/Live page; issue lifecycle badges (Open, With dev, Live, Checked); removed duplicate next-move footer inside details; empty states and stale section copy softened; one-line Pages subtitle on route.

**Not touched:** Page registry, snapshot computation, scoring logic, issue actions.

### Shell Phase E — Changes (scorecard + contracts) — COMPLETE (2026-04-10)

**Shipped:** `changes/page.tsx` — PageHeader subtitle reframed (outcome-first, records second); **At a glance** strip leads; scorecard before records; **Records & verification** section labels the lower ledger. `scorecard-client.tsx` — outcome verdict pills moved into a default-closed **Outcome mix** disclosure (deduped vs strip: no duplicate “You confirmed” row); filters relabeled **Refine**; calmer table chrome; column headers shortened (**When / Work / Linked / Match / Lift / Next step**); denser row padding; linked-attribution chips softened (dot + Primary/Also/Maybe vs loud degree badges); long change descriptions use disclosure; **Beacon picks only** toggle label. `change-contract-client.tsx` — action bar leads; **How scan check works** in disclosure; contract cards split into compact header (summary, URL, type, statuses, **Run check**) + one-line **verification summary** when a result exists; goals + line-by-line checks under **Context & check detail**; toned labels (**Why it mattered** / **Expected lift**); planned checks without checkbox glyphs.

**Not touched:** Scorecard computation, attribution math, recommendation/priority/experiment logic, persistence, `[id]` change detail layout (list + ledger only in this pass).

### Shell Phase F1 — Competitors page — COMPLETE (2026-04-10)

**Shipped:** `competitors/page.tsx` — premium header line; **At a glance** strip (share, citations, ranking size, **ahead** count); removed duplicate “your position” footnote under the list; **Who leads in citations** as list-first ranked table (shared chrome, row tint for ahead-of-you, mobile inline metrics); **Next moves** elevated immediately after threats with single divided list (less per-row card chrome); **Topic signals** — one bordered frame with three columns (**Where you lead** / **Highest pressure** / **Thinnest share**) replacing three equal-weight cards; settings disclosure retitled **Universe & data setup** with chevron pattern; imported-entity list uses divided rows; empty state copy calmed.

**Not touched:** `computeMarketBenchmark`, citation index math, `[id]` competitor detail, Topics (Review shipped in F3).

### Shell Phase F2 — Opportunities (`/topics`) — COMPLETE (2026-04-10)

**Shipped:** `topics/page.tsx` — **PageHeader** + **At a glance** strip (topics, shifts, Review pressure, quick wins); long competitor-universe / sample framing moved into **Workspace & competitor list context** disclosure. `topics-client.tsx` — list column titled **Topics**; plain-language **PRODUCT_GAP_HEADLINE** map for gap evidence class (replaces internal class names in the shell); detail opens with **Suggested next step** (same `evidenceLine` + primary CTA + calmer handoff button **Copy plan text**); **How Beacon knows** disclosure for dimensions + provenance + links (renamed away from “ObservationRun”); one-line **Beacon suggests** rationale before deep panels; **Full plan, competitors & activity** disclosure wraps frontier, citation winners, content-shape, execution plan, and activity grids; internal labels softened (**Strength** vs rank, **Citation winners**, **Content shape**, **Execution plan**, **Why this sequence**, **Linked edits** / **Recent visibility shifts**).

**Not touched:** `computeFrontiers`, `deriveGapLedgerFields` / gap-ledger computation, package server actions, `/topics/opportunity/[id]` entity page (not this pass).

### Shell Phase F3 — Review — COMPLETE (2026-04-10)

**Shipped:** `review/page.tsx` — **PageHeader** + specialist subtitle; **At a glance** strip (awaiting count, quick clears, locked total). `review-queue-client.tsx` — calmer queue (**Open items**, softer row chrome, decisionability labels **Likely clear / Needs your read / Tight race**); judgment card leads with **what happened** + calm queue badge; **Why Beacon ordered it here** disclosure (moves internal `decisionabilityReason` + score separation out of the hero); main panel copy **What do you attribute this to?** with clearer subtext; softer accent border (not heavy `border-2`); candidate rows split so **Match factors** sit in per-row disclosure (valid structure, no `button` nesting); **Leading match** vs “Rank 1 (score)”; confidence chips **Confident / Balanced / Tentative**; primary CTA **Save decision**; **Platform** + keyboard help aligned; footer link **Open full result**; resolved **Locked in Review** + calmer cards; auto-cleared disclosure chevron pattern.

**Not touched:** `computeDecisionability` inputs/outputs (same `reason` strings stored in UI disclosure only), `lockDecision`, scoring/triage domain code.

### Shell Phase G1 — Import + History — COMPLETE (2026-04-10)

**Shipped:** `import/page.tsx` — **PageHeader** + measurement-layer description; cross-links to **History** / **Today**; **At a glance** strip (aligned with other shell pages); calmer drop zone border; merge copy clarified; success panel softer border + **View History** alongside Today; advanced toggle reframed **Advanced paths**; **Import log** (renamed from “Import history”) with note vs History timeline; Profound CSV + manual success links include History. `results-client.tsx` — **PageHeader** + brief description; **Import** / **Today** cross-links; **At a glance** strip (sample rows, run-linked, primary run, crawl); stale warning stays visible; **Runs, stamps & technical notes** disclosure (synthetic, rollup, run mix, legacy unstamped); **Competitor sample context** wraps prior universe strip; evidence-scope callout calmed (no warning fill); **StatCard** labels shortened (**Sample rows**, **Run-linked**, **With cause signal**, **Review pending**); table row label **Sample row**.

**Not touched:** Import actions, `getDataCoverage`, results computation, persistence.

### Shell Phase G2 — Diagnostics — COMPLETE (2026-04-10)

**Shipped:** `diagnostics/page.tsx` — **PageHeader** + specialist **system brief** description (not “not daily workflow” dismissal); **At a glance** strip (**StatCard**: changes, snapshots, outcome events, Review pending); operator paragraph with **Today / Review / History / Import** links; **How to read system metrics** callout (layers + honesty); **Recorded / Open** cards with calmer **border-border/60**; **DisclosureBlock** pattern for entity inventory, event breakdown tables, cluster/pattern tables + expansion candidate sample, imported change IDs on rows, **stored-ID pair scoring** bundle (confidence, factors, inflation, verdicts, temporal), candidate distribution + calibration, truth-set, factor-lift table; prominent **Event + Review drivers** + **Linkage gaps** + candidate linking summary stats + **Model gaps** stat row + recommendations; **StatBlock** chrome aligned (`border-border/60`); reduced **uppercase** micro-labels on cluster/pattern/confidence chips; section titles sentence case; Expansion subsection on Diagnostics reframed as **system inspection** copy only (route untouched).

**Not touched:** `computeDiagnostics`, `computeCandidateDiagnostics`, `computeModelReport`, or any attribution/diagnostics computation.

### Shell Phase G3 — Expansion quarantine / reframing — COMPLETE (2026-04-10)

**Shipped:** `expansion/page.tsx` — **PageHeader** **Expansion backlog** + explicit **not recommendations** framing; operator links (**Today**, **Opportunities** `/topics`, **Review**, **Import**); **Quarantined surface** callout (anti–page-factory); **At a glance** **StatCard** strip (total / new / stronger / moderate fit) with **Counts by hypothesis shape** disclosure (nearby geography demoted out of hero grid); **non-adjacent** hypotheses listed first by model fit + **Pattern gaps**; **low** fit collapsed; **all adjacent** rows in default-**closed** `<details>` with misuse-risk copy; per-row **Why Beacon surfaced this** disclosure (reasoning, evidence, caveats, pattern, query — not dumped by default); expansion-only type labels (**hypothesis** language); `promote-candidate.tsx` optional labels — Expansion uses **Stage draft in Opportunities** / **Staging…** / **Staged — validate before use**; inactive experiment state aligned with same shell framing.

**Not touched:** `computeOpportunityCandidates`, selectors, scoring, `promoteToOpportunity` behavior (copy-only props on button).

### Shell Phase H — Experiments / watchlist polish — COMPLETE (2026-04-10)

**Shipped:** `today-client.tsx` — **Follow-through** section framing + **Experiments on your watchlist** subtitle (nightly loop, import-driven status honesty); **`WatchlistExperimentCard`** mini-brief layout: calm **status pill** (human labels: actively testing, collecting signal, promising signal, unclear so far, trending down); **Day N of watch** + short started date; **headline** lead; **rec type** via existing `REC_ACCENT` map + **readable path** (no mono); **Citation readout** strip (baseline / latest / delta / waiting-for-import copy); **Your note** inline when present; **`watchAfter`** under **What Beacon is watching for** `<details>`; **Adjust outcome (optional)** disclosure with manual status chips (**testing / watching / promising / inconclusive / negative**) + honesty note that imports may still auto-move status + **Remove from watchlist** (replaces bare **Drop**).

**Not touched:** `experiment-store.ts` (including `updateExperimentCitations` auto-status rules), `updateExperimentAction` contract, persistence semantics.

### Success metrics (holistic)

- **Premium:** Chrome recedes; one clear primary per screen; borders and uppercase micro-labels reduced.
- **Simple first:** Defaults show story + one action; evidence and internals are one click away, not zero clicks.
- **Cohesive:** Same header, filter, and list/detail patterns across Today, Pages, Changes, Competitors.
- **Trust:** Evidence visible without sounding like a changelog of the algorithm; uncertainty explicit but calm.

**Verification (when implemented):** `npm run check`; visual regression pass on 17 static routes; keyboard/palette smoke test.

---

## BEACON FULL PRODUCT PLAN — INTELLIGENCE EXPANSION (2026-04-10)

### Vision

Beacon is an AI visibility operating system that **sees, remembers, and reasons**. The shell overhaul (Phases A–H) made every surface premium and calm. The persistence layer (Phases 0–3E) made data durable and switchable. The intelligence core (Phases 5–23) built attribution, recommendations, priority, track record, and experiments.

The next expansion gives Beacon its own senses (query ownership), deeper memory (outcome flywheel), and sharper reasoning (genealogy, entity resolution, per-model intelligence). Every feature is designed in three stages: **Stage 1** works on current Profound-imported data; **Stage 2** mixes inferred and native signals; **Stage 3** runs on fully owned query data.

No new top-level navigation items. No shell redesign. Intelligence layers first, surfaced through existing routes via progressive disclosure.

---

### CLUSTER 1 — QUERY INTELLIGENCE

#### 1.1 Native LLM Querying

**Purpose:** Own the data pipeline. Capture full answer text, citations, entities, framing, model-specific history directly from AI platforms.

**Why it matters:** Every downstream feature (genealogy, discrepancy detection, entity extraction, per-model intelligence) improves when Beacon captures its own answers instead of relying on static Profound imports.

**Stage 1 (Current — Profound):** All visibility data from Profound CSV/workbook imports. `answer-texts.json` (9,596 entries, cold store), `citations-by-date/` (85K rows, sharded cold store). Static snapshots, no freshness control.

**Stage 2 (Hybrid):** Perplexity API sampling supplements Profound imports. Beacon-sampled answers stored in `answer_snapshots`. New results carry `source_system: "beacon_native"`. Today shows mixed freshness ("Beacon-sampled X hours ago" alongside "Imported"). Profound data remains the historical baseline.

**Stage 3 (Native):** Multi-model sampling (Perplexity + ChatGPT + Gemini). Nightly automated runs via script or Inngest. Profound imports become optional historical archive. Full answer diffs between sampling runs. Model-specific citation tracking.

**Dependencies:** Perplexity API key. `answer_snapshots` table/store. Prompt library (1.2).

**Where it lives:** Infrastructure layer. No new route. `source_system` field on Results. Freshness indicator on Today visibility strip.

**Feeds:** Every downstream feature. Co-mention, genealogy, discrepancy, entity extraction, decay, trust index, per-model intelligence.

#### 1.2 Prompt Library

**Purpose:** Formalize the prompt corpus as a managed, expandable, journey-tagged collection instead of a static CSV import.

**Stage 1:** Extract and normalize the 100 tracked prompts from Profound import into a typed `prompt_library` store. Tag with topic, city, service type, journey stage (awareness/consideration/decision/support). Combinatorial expansion generates candidate prompts from topic × city × service matrices.

**Stage 2:** Validate expanded prompts against native sampling — keep prompts that produce meaningful answers, archive those that don't.

**Stage 3:** Prompt library becomes the sampling scheduler's input. Auto-expansion from discovered prompt patterns in answer text.

**Dependencies:** Existing `tracked-prompts` from canonical store (100 rows).

**Where it lives:** Import/System layer. Accessible from Diagnostics. Prompt counts in Today "At a glance."

**Feeds:** Native querying target list, journey mapping, prompt mining, adversarial testing.

#### 1.3 Real Prompt Mining

**Purpose:** Discover actual prompts users ask — not guessed ones — by mining language patterns, topic/city/service combinations, and answer text patterns.

**Stage 1:** Combinatorial mining from existing data: 12 topics × N cities × M service types × 4 journey stages. Pattern templates from the 100 Profound prompts (question structures, modifiers, qualifiers). Output: candidate prompt corpus ranked by expected coverage.

**Stage 2:** Validate mined prompts against native sampling. Prompts that produce answers with owned citations are confirmed. Prompts that produce zero relevant results are archived. Confidence scoring per prompt.

**Stage 3:** Continuous mining from answer text — extract question patterns that models answer, reverse-engineer likely user prompts. Feedback loop with outcome database.

**Dependencies:** Prompt library (1.2). Topic/city/service data from existing Results.

**Where it lives:** Intelligence layer → surfaces as expanded prompt coverage in Diagnostics. Mined prompts feed into Opportunities as coverage gaps.

**Feeds:** Native querying expansion, coverage analysis, journey mapping.

---

### CLUSTER 2 — ATTRIBUTION / GENEALOGY

#### 2.1 Citation Genealogy

**Purpose:** Trace likely source ancestry of AI citations by comparing cited phrasing against owned + earned content corpus. Attribution for AI citations themselves.

**Stage 1:** Fuzzy text matching between cold-store answer texts (9,596 entries) and owned page content (from 42 page snapshots). Confidence scoring: `exact_match` (verbatim phrase), `paraphrase` (high semantic overlap), `topical` (same topic, different wording), `unknown`. Output stored in `genealogy_evidence` keyed by citation URL + answer snapshot.

**Stage 2:** Native answer text replaces cold-store texts. Owned content corpus expands with each crawl. Matching engine improves with more data points.

**Stage 3:** Real-time genealogy on fresh native samples. Track genealogy drift over time (did the model change where it sources from?). Cross-model genealogy comparison.

**Dependencies:** Answer text corpus (cold store now, native later). Page snapshot content (exists in `extractor.ts`). Text similarity computation.

**Where it lives:** Intelligence layer → Pages detail disclosure ("Citation source evidence"). Diagnostics for system-wide genealogy stats.

**Feeds:** Recommendation engine (strengthen source content), attribution confidence, steal-the-snippet analysis.

#### 2.2 Citation Decay Model

**Purpose:** Detect and predict citation freshness decline. Alert when owned pages are losing citations before it becomes visible in aggregate metrics.

**Stage 1:** Exponential decay computation from `citations-by-date/` time series. Per-page citation trajectory using `freshness = exp(-ln(2) × age_days / half_life)`. Half-life defaults: citations 14d, content 30d. Decay alerts when freshness drops below 0.5 for pages with >5 historical citations.

**Stage 2:** Decay predictions enriched with native sampling frequency. Faster detection from owned query cadence.

**Stage 3:** Predictive decay model using historical decay patterns + content age + competitive pressure. "This page will likely lose its citation in ~N days" with confidence interval.

**Dependencies:** `citations-by-date/` cold store (exists, 85K rows). Time series computation.

**Where it lives:** Intelligence layer → Today "What changed" (decay alerts). Pages list (freshness indicator). Recommendation engine (`refresh_stale_citation` type).

**Feeds:** Priority engine (decay urgency factor), recommendation engine, page health scoring.

#### 2.3 Steal the Snippet Engine

**Purpose:** Competitive extractability analysis. Show what models seem to pull from competitors, compare to owned copy, suggest stronger extractable alternatives.

**Stage 1:** From existing citation data, identify competitor URLs cited for topics where the business competes. Compare competitor citation frequency to owned citation frequency per topic. Flag topics where competitors are cited 2x+ more. Cross-reference with page snapshot content to identify structural gaps (FAQ, schema, content depth).

**Stage 2:** With native answer text, analyze what phrasing models extract from competitor citations. Compare sentence-level extractability between competitor and owned content.

**Stage 3:** Full extractability scoring per paragraph. "This competitor paragraph scores 0.8 extractability; your equivalent scores 0.3. Suggested rewrite: [specific improvement]."

**Dependencies:** Citation data (exists). Competitor URLs (exists in citations). Page snapshots for owned content (exists). Competitor content crawl (Stage 2+).

**Where it lives:** Competitors page disclosure → "Citation intelligence" section. Pages detail → "Competitive extractability" for specific pages.

**Feeds:** Recommendation engine (`improve_extractability` type), competitive gap analysis.

---

### CLUSTER 3 — COMPETITIVE INTELLIGENCE

#### 3.1 Co-mention Graph

**Purpose:** Reveal true AI-era competitors and adjacency relationships based on citation co-occurrence in AI answers.

**Stage 1:** Co-occurrence matrix from `citations-by-date/` (85K rows). For each answer, collect all cited domains. Build domain-pair co-occurrence counts. Rank domains by co-mention frequency with the owned domain. Identify "AI competitors" not in configured universe. Compute co-mention strength (co-occurrences / total appearances).

**Stage 2:** Native sampling provides fresh co-mention data. Trend tracking: is co-mention increasing or decreasing with a specific competitor?

**Stage 3:** Full temporal co-mention graph with adjacency drift detection. Cross-model co-mention comparison. Topic-specific co-mention networks.

**Dependencies:** `citations-by-date/` cold store (exists). `cold-store.ts` sharded reader (exists).

**Where it lives:** Competitors page → "AI-era competitors" section. Co-mention data enriches `computeMarketBenchmark`.

**Feeds:** Competitor discovery, AEO battlecards, competitive gap analysis.

#### 3.2 AI Source Trust Index

**Purpose:** Determine which sources each AI engine trusts by vertical, geography, and query type, based on citation frequency.

**Stage 1:** From existing citation data, compute citation frequency by source domain per platform. Rank sources by "trust level" (citation_count / total_citation_slots) per platform. Identify platform preferences — which platform cites which sources most.

**Stage 2:** Native sampling provides per-model granularity (ChatGPT vs GPT-4o vs Perplexity vs Gemini). Trust scores become model-specific.

**Stage 3:** Trust index with temporal trends. Trust drift alerts. Vertical-specific trust benchmarks.

**Dependencies:** Citation data with platform field (exists). Source domain extraction (exists in citation URLs).

**Where it lives:** Intelligence layer → Competitors "Source trust" section. Diagnostics for system-wide trust analysis.

**Feeds:** Recommendation engine (target high-trust patterns), competitive analysis.

#### 3.3 AEO Battlecards

**Purpose:** Competitive response playbooks showing how to displace specific competitors in AI answers.

**Stage 1:** Auto-generated from existing data: competitor citation topics, owned gaps, structural differences (FAQ/schema), recommendation history. Template: "Competitor X is cited for [topic] — you are not. Gap: [structural issue]. Recommended: [action from rec engine]."

**Stage 2:** Enriched with co-mention data, source trust intelligence, and extractability analysis.

**Stage 3:** Dynamic battlecards updated with native sampling. "Since last week, Competitor X gained 3 new citations for [topic]. Your response: [prioritized action]."

**Dependencies:** Competitive benchmark (exists). Recommendation engine (exists). Co-mention graph (3.1).

**Where it lives:** Competitors page disclosure → per-competitor battlecard.

**Feeds:** Operator decision-making, recommendation prioritization.

#### 3.4 Traditional vs AI Overlap

**Purpose:** Map where classic search visibility does and does not overlap with AI visibility.

**Stage 1:** If traditional ranking data exists in imported Results (some `metric_type` values may include traditional search metrics), compute overlap matrix. For pages with both traditional rank and AI citations, flag: "Visible in search but invisible to AI" and vice versa. If no traditional data exists, scaffold the import column and show empty state.

**Stage 2:** Add GSC CSV import support to workbook parser. Compute overlap from imported GSC + AI citation data.

**Stage 3:** Native GSC API integration. Real-time overlap monitoring.

**Dependencies:** Traditional ranking data (may exist partially in Results). Import pipeline column mapping.

**Where it lives:** Pages → overlap indicator. Opportunities → "Not visible in AI" filter. Today → overlap summary stat.

**Feeds:** Recommendation engine (AI-invisible pages with traditional rank are high-leverage targets).

---

### CLUSTER 4 — ENTITY / TRUST LAYER

#### 4.1 Entity Resolution (EntityForge)

**Purpose:** Cross-platform entity consistency. Identity confidence scoring. sameAs coherence. Disambiguation.

**Stage 1:** Entity extraction from existing data: business name, domain, addresses, phone numbers, service types from page snapshots + configured site metadata. Build `entity_store` with canonical entity records. Detect inconsistencies across owned pages (different addresses, different phone numbers, different business names).

**Stage 2:** Entity extraction from native answer text — how do models refer to the business? Build entity mention tracking across answers. Detect name variants and disambiguation issues.

**Stage 3:** Cross-platform entity resolution. NAP consistency scoring. Schema.org entity coherence. sameAs link validation.

**Dependencies:** Page snapshots (exists). Site config (exists). Business truth configuration (new).

**Where it lives:** Intelligence layer → Pages "Entity health" indicator. Diagnostics for entity consistency report.

**Feeds:** AI-says-vs-reality, founder tracking, structured data recommendations.

#### 4.2 AI Says vs Reality

**Purpose:** Nightly discrepancy engine between model claims and business truth. Hallucination and misrepresentation detection with repair suggestions.

**Stage 1:** Define `business_truth` configuration store — key facts: business name, address(es), phone(s), hours, services offered, credentials, founding year, owner name. Compare against page snapshot content for internal consistency. Flag pages where own content contradicts business truth.

**Stage 2:** Compare native answer text against business truth. Flag discrepancies: "ChatGPT says you're open until 9pm but your site says 6pm." Generate `correct_misrepresentation` recommendations.

**Stage 3:** Automated discrepancy monitoring across all sampled models. Severity scoring. Repair action generation with specific content/schema changes.

**Dependencies:** Business truth config (new, simple key-value). Answer text (cold store now, native later). Entity resolution (4.1).

**Where it lives:** Intelligence layer → Today alerts (critical discrepancies only). Pages → discrepancy warnings. Recommendation engine new type.

**Feeds:** Recommendation engine, page health, operator trust.

#### 4.3 Founder Authority Tracking

**Purpose:** Track person/entity authority as part of brand visibility in AI answers.

**Stage 1:** Configure founder/key-person names in `business_truth` config. Search existing answer texts (cold store) for name mentions. Count and track mentions per platform.

**Stage 2:** Native answer text provides fresher mention tracking. Trend analysis: is founder mention increasing or decreasing?

**Stage 3:** Cross-model founder visibility comparison. Authority score composite. Person-entity schema recommendations.

**Dependencies:** Business truth config (name entries). Answer text corpus. Entity resolution (4.1).

**Where it lives:** Intelligence layer → Today (mention count if configured). Diagnostics for authority analysis.

**Feeds:** Structured data recommendations (Person schema), content strategy.

---

### CLUSTER 5 — LOCAL / GEOGRAPHIC INTELLIGENCE

#### 5.1 Geographic Heat Map

**Purpose:** Visibility by city/area/service geography. Strategic geographic intelligence for local businesses.

**Stage 1:** Normalize existing `city` field on Results into a city taxonomy using the existing geo factor's metro→city hierarchy. Compute citation metrics per normalized city. Output: geographic coverage table showing citation density by city. Flag geographic gaps (cities with service pages but no citations).

**Stage 2:** Native sampling per-city provides fresher geographic data. Heat map visualization with relative intensity.

**Stage 3:** Interactive geographic visualization. Temporal geographic trends. Geographic competitive intelligence overlay.

**Dependencies:** City normalization (existing geo hierarchy in attribution). Results with city field (exists).

**Where it lives:** Intelligence layer → Opportunities geographic section (disclosure). Today → geographic summary stat.

**Feeds:** Recommendation engine (geographic gap recs), prompt mining (city-specific expansion).

#### 5.2 Neighborhood Pulse

**Purpose:** Local community question and signal mining relevant to the business's service geography.

**Stage 1:** Scaffold only. Define `neighborhood_signals` store schema. Identify community question patterns from existing prompt corpus (questions containing city/neighborhood names). Flag geographic prompts that the business should be visible for but isn't.

**Stage 2:** Integration with prompt mining — community-style questions (e.g., "best [service] near [neighborhood]") added to prompt library and validated via native sampling.

**Stage 3:** External signal sources (Reddit, local forums, Q&A sites) for community question discovery. Signal freshness and relevance scoring.

**Dependencies:** City normalization (5.1). Prompt library (1.2).

**Where it lives:** Intelligence layer → Opportunities (geographic coverage gaps). Not a standalone route.

**Feeds:** Prompt mining, geographic coverage analysis.

---

### CLUSTER 6 — OUTCOME / LEARNING SYSTEM

#### 6.1 Outcome Database / Collective Learning Flywheel

**Purpose:** Compounding action→result memory. Every recommendation response, experiment outcome, and scorecard verdict feeds a growing intelligence store.

**Stage 1:** Unify existing scattered outcome data into a structured `outcome_store`: recommendation responses (accept/dismiss/defer from `recommendation-response-store`), experiment outcomes (status changes from `experiment-store`), scorecard verdicts (validated/partial/negative from `scorecard.ts`), track record matches (from `recommendation-tracker`). Schema: `outcome_id, action_type, action_detail, target_page, target_topic, started_at, resolved_at, verdict, citation_delta, confidence, source_signal_tier`. Queryable by action type, time period, pattern, page.

**Stage 2:** Outcome store enriched with native sampling measurements. Pre/post citation comparisons become more precise with owned data.

**Stage 3:** Statistical significance testing on outcomes. Pattern-level ROI estimation. Action-type success rate benchmarks.

**Dependencies:** Existing stores: recommendation-response-store, experiment-store, scorecard, track record. No new external data.

**Where it lives:** Intelligence layer → feeds priority engine, recommendation engine. Diagnostics → outcome summary section. Today → track record enhanced with outcome depth.

**Feeds:** Priority engine (richer historical signal), recommendation engine (pattern confidence), what-if simulator (historical basis), Beacon Score (outcome dimension).

#### 6.2 What-If Simulator

**Purpose:** Simulate expected outcomes before acting, based on historical action→outcome patterns.

**Stage 1:** Scaffold only. When outcome database has ≥20 outcomes for a pattern type, show "Based on N similar past actions: X% showed improvement within Y days, average citation delta: +Z." No prediction — pure historical summary. Display only when data is sufficient. "Insufficient data" label otherwise.

**Stage 2:** Enriched with outcome store data. More patterns reach the 20-outcome threshold. Confidence intervals on historical summaries.

**Stage 3:** Predictive simulation using outcome store + decay model + competitive pressure. "If you [action], expected outcome: [range] based on [N] similar actions."

**Dependencies:** Outcome database (6.1) with sufficient volume (≥20 per pattern minimum).

**Where it lives:** Today → primary action card disclosure "Historical outcomes for this action type." Not a standalone route.

**Feeds:** Operator decision confidence. Priority engine validation.

---

### CLUSTER 7 — JOURNEY / CONVERSION LAYER

#### 7.1 Custom Journey / Synthetic Customer Journey

**Purpose:** Map the AI answer landscape across awareness, consideration, comparison, and decision prompt stages.

**Stage 1:** Journey stage taxonomy: `awareness` (what is X), `consideration` (best X options), `comparison` (X vs Y), `decision` (reviews of X / hire X), `support` (how to X). Tag existing 100 tracked prompts with journey stage based on keyword patterns. Compute citation coverage per stage. Flag journey gaps: "You have citations in consideration but none in decision."

**Stage 2:** Mined prompts expand each journey stage. Native sampling validates coverage per stage. Stage-transition analysis: are users likely to see you across the journey?

**Stage 3:** Full journey simulation: run representative prompts at each stage, track citation presence, identify journey dropout points.

**Dependencies:** Prompt library with journey tags (1.2). Citation data per prompt.

**Where it lives:** Intelligence layer → Opportunities "Journey coverage" section. Today → journey gap alerts when critical.

**Feeds:** Prompt mining (stage-specific expansion), recommendation engine (journey gap recs).

#### 7.2 Conversion Path (Scaffold)

**Purpose:** Map AI prompt → answer → citation → site visit → conversion chain. Honest about current measurement limitations.

**Stage 1:** Scaffold only. Define the data model: `conversion_events` (page_url, referrer, timestamp, conversion_type). Show empty state with explanation: "Beacon tracks AI visibility and citations. Conversion tracking requires analytics integration." Provide UTM parameter recommendations for AI-referred traffic.

**Stage 2:** If GA4 or analytics CSV import becomes available, ingest conversion data. Map citation pages to conversion pages. Compute citation→conversion correlation.

**Stage 3:** Direct attribution chain from native AI answer → citation click → page visit → conversion.

**Dependencies:** Analytics data (does not exist; scaffold only). UTM strategy documentation.

**Where it lives:** Scaffold in architecture docs. No visible UI until data exists.

**Feeds:** Future conversion-aware recommendation prioritization.

---

### CLUSTER 8 — STRUCTURED DATA / DELIVERY LAYER

#### 8.1 llms.txt / Structured Data Layer

**Purpose:** Make owned content maximally extractable by AI models through proper structured data and llms.txt.

**Stage 1:** Extend existing FAQ/schema detection from page snapshots. New recommendation type `add_llms_txt` for pages with high citation counts but no llms.txt. Generate draft llms.txt content from page snapshot data (title, description, key topics, FAQ entries). Schema recommendation specificity: suggest exact Schema.org types based on page type (LocalBusiness, Service, FAQPage, HowTo).

**Stage 2:** Monitor llms.txt adoption impact through citation changes post-implementation. Track schema deployment through crawl snapshots.

**Stage 3:** Auto-generated llms.txt from page content analysis. Schema validation against AI model expectations. A/B testing of structured data variations.

**Dependencies:** Page snapshots (exists). `extractor.ts` content extraction (exists). Recommendation engine (exists).

**Where it lives:** Pages detail → "Structured data recommendations" disclosure. Recommendation engine new types.

**Feeds:** Recommendation engine, page health scoring.

#### 8.2 Visual Readiness (LensReady-style)

**Purpose:** Assess image and visual content readiness for AI visual search and multimodal models.

**Stage 1:** Scaffold. Extend page snapshot extraction to capture image metadata (alt text presence, image count, structured image data). Score: images without alt text, images without structured data, pages without any images.

**Stage 2:** Visual readiness score per page. Recommendations for image optimization. Monitor visual search citation impact.

**Stage 3:** Multimodal AI model testing — do models reference visual content? Visual extractability scoring.

**Dependencies:** Page snapshot extraction (exists, needs image metadata extension).

**Where it lives:** Pages → "Visual readiness" indicator in structure health. Recommendation engine new type `improve_visual_readiness`.

**Feeds:** Page health, structured data recommendations.

#### 8.3 Video Citation Layer (Scaffold)

**Purpose:** Track and optimize YouTube and video content citations in AI answers.

**Stage 1:** Scaffold. In citation data, flag URLs with youtube.com/youtu.be domains. Count video citations vs page citations. Store video citation metadata.

**Stage 2:** Track video citation trends. Identify topics where video citations dominate.

**Stage 3:** YouTube API integration. Video content optimization recommendations.

**Dependencies:** Citation URL parsing (exists in citation data).

**Where it lives:** Intelligence layer → Pages/Competitors video citation counts.

**Feeds:** Content strategy recommendations.

---

### CLUSTER 9 — VISUALIZATION / REPORTING LAYER

#### 9.1 Election-Night Visualizations

**Purpose:** Premium data visualization that materially improves comprehension of visibility dynamics.

**Stage 1:** Sparkline components for citation trends (tiny, inline, on Today/Pages/Competitors). Competitive share bars with motion (already partially exist on Competitors). Decay curve visualization per page. All using existing computed data — no new intelligence needed.

**Stage 2:** Temporal comparison views. "Before/after" citation visualizations tied to changes. Co-mention network visualization (simple force graph).

**Stage 3:** Real-time visualization during sampling runs. Live citation delta tracking. Competitive position animation over time.

**Dependencies:** Charting component (lightweight — SVG sparklines, no heavy library). Existing computed data.

**Where it lives:** Inline on existing routes. Today sparklines, Pages trend indicators, Competitors share visualization.

**Feeds:** Operator comprehension. No computational value.

#### 9.2 Share / Report Generator

**Purpose:** Generate shareable report snapshots for stakeholders.

**Stage 1:** Scaffold. Define report template: visibility summary, top citations, competitive position, recent changes, recommendations. Server-rendered HTML snapshot exportable as PDF via Puppeteer (already a dependency).

**Stage 2:** Branded report templates. Scheduled report generation.

**Stage 3:** Interactive shareable reports with filtered views.

**Dependencies:** Puppeteer (exists in dependencies). Today summary data (exists).

**Where it lives:** Utility — "Export report" action on Today page.

**Feeds:** Stakeholder communication.

#### 9.3 AI Pulse Notifications

**Purpose:** Push notifications for significant visibility changes or alerts.

**Stage 1:** Scaffold. Define notification types: citation spike, citation drop, new competitor detected, experiment result, decay alert. In-app notification queue stored in `notifications` json-store. Badge on Today showing unread notification count.

**Stage 2:** Notifications generated from computation passes. Read/dismiss tracking.

**Stage 3:** External notifications (email, Slack webhook). Configurable thresholds.

**Dependencies:** Notification store (new json-store). Computation triggers from existing engines.

**Where it lives:** Today → notification badge + disclosure section.

**Feeds:** Operator attention management.

---

### CLUSTER 10 — AUTHORITY / FOUNDER / COMMUNITY

#### 10.1 Beacon Score

**Purpose:** Single composite metric for AI visibility health. Must be honest, multi-dimensional, and transparent about its basis.

**Stage 1:** Define dimensions and weights. Candidate dimensions: citation_coverage (% of tracked prompts with at least one citation), platform_breadth (% of platforms where cited), content_readiness (% of owned pages with FAQ + schema), competitive_position (share vs top competitor), evidence_quality (% of changes with exact evidence tier), outcome_track_record (% positive outcomes). Each dimension 0-100, composite weighted average. Display with dimension breakdown. "Based on N data points" transparency. "Insufficient data" for any dimension below minimum threshold (5 data points).

**Stage 2:** Trend tracking. Beacon Score delta over time. Dimension-specific improvement recommendations.

**Stage 3:** Industry benchmarking (when multi-vertical data exists). Predictive score trajectory.

**Dependencies:** Existing citation data, page snapshots, competitive benchmark, evidence tiers, outcome store (6.1).

**Where it lives:** Today → hero metric (replacing or alongside citation count). Disclosure shows dimension breakdown.

**Feeds:** Operator confidence, stakeholder communication, priority engine (score decline → urgency).

#### 10.2 Per-Model Optimization Intelligence

**Purpose:** Model-specific recommendations based on empirical evidence of what works differently across AI engines.

**Stage 1:** From existing platform-tagged citation data, compute per-platform citation rates, source preferences, topic coverage. Flag platform-specific gaps: "You're cited on Perplexity for [topic] but not on ChatGPT." Output: per-platform visibility profile.

**Stage 2:** Native multi-model sampling provides richer per-model data. Model-specific recommendation tags on existing recommendation types.

**Stage 3:** Empirical per-model optimization strategies. "ChatGPT prefers [content pattern]. Perplexity prefers [different pattern]. Your page uses neither."

**Dependencies:** Platform-tagged citation data (exists). Multi-model native sampling (Stage 2+).

**Where it lives:** Intelligence layer → Today/Pages per-platform badges. Diagnostics per-model analysis section.

**Feeds:** Recommendation engine (platform-specific tags), competitive analysis.

#### 10.3 Training Data Pipeline (Scaffold)

**Purpose:** Understand what enters model memory / crawl layers / source ecosystems.

**Stage 1:** Scaffold only. Document what is known about model training data cuts. Track `robots.txt` and crawl access status for owned pages via existing crawl infrastructure. Store `crawl_access_status` per page from page snapshot.

**Stage 2:** Monitor Common Crawl inclusion for owned domain. Track crawl frequency indicators.

**Stage 3:** Training data inclusion estimation based on crawl signals + citation patterns.

**Dependencies:** Page crawl data (exists in snapshots). robots.txt parsing (extends existing extractor).

**Where it lives:** Pages → "Crawl access" indicator. Diagnostics for crawl access summary.

**Feeds:** Page health, content accessibility scoring.

#### 10.4 Adversarial Prompt Stress Testing

**Purpose:** Test brand defense under negative, skeptical, or competitive prompts.

**Stage 1:** Scaffold. Define adversarial prompt templates: "[business] complaints", "[business] vs [competitor]", "worst [service] in [city]", "problems with [business]". Store in prompt library with `adversarial` journey stage tag. If answer texts exist in cold store for any adversarial-pattern prompts, analyze them.

**Stage 2:** Run adversarial prompts through native sampling. Score brand defense: positive mention, neutral, negative, absent. Track defense over time.

**Stage 3:** Automated adversarial testing suite. Defense score as Beacon Score dimension. Repair recommendations for negative responses.

**Dependencies:** Prompt library (1.2). Native querying (Stage 2+).

**Where it lives:** Diagnostics → "Brand defense" section. Not a primary surface.

**Feeds:** Beacon Score (defense dimension), content strategy.

#### 10.5 Industry Blueprints

**Purpose:** Vertical-specific AEO playbooks based on proven patterns.

**Stage 1:** Scaffold. Document home-services vertical blueprint from existing Beacon data: proven change patterns, effective content types, platform preferences, competitive dynamics. Single blueprint, manually authored from Beacon intelligence.

**Stage 2:** Blueprint generation from outcome database patterns. If sufficient data, auto-generate blueprint sections.

**Stage 3:** Multi-vertical blueprints when Beacon serves multiple verticals.

**Dependencies:** Outcome database (6.1). Sufficient pattern data.

**Where it lives:** Documentation / Diagnostics. Not a product route.

**Feeds:** Operator education, recommendation context.

#### 10.6 Ask Beacon (Conversational Intelligence)

**Purpose:** Natural language interface to Beacon's intelligence: "Why did my citations drop last week?" or "What should I fix on my roofing page?"

**Stage 1:** Scaffold. Define query types: status queries ("how am I doing"), diagnostic queries ("why did X happen"), action queries ("what should I do about X"). Map each to existing computed data sources. Prototype: command palette integration with canned query patterns.

**Stage 2:** LLM-powered query parsing. Natural language → structured Beacon data lookup → formatted response. Uses existing computed data, not raw LLM generation.

**Stage 3:** Full conversational interface with context memory. Follow-up questions. Exportable conversation summaries.

**Dependencies:** LLM API for query parsing. Existing computed data access layer.

**Where it lives:** Command palette extension. Not a standalone route.

**Feeds:** Operator productivity. No computational value.

#### 10.7 Review-to-AI Signal Mapping (Scaffold)

**Purpose:** Map how business reviews influence AI answer content.

**Stage 1:** Scaffold. Define `review_signals` store schema. If review platforms (Google, Yelp) are mentioned in citation URLs, flag them. Count review-platform citations per topic.

**Stage 2:** Review content import. Correlation between review themes and AI answer themes.

**Stage 3:** Review optimization recommendations based on AI citation patterns.

**Dependencies:** Citation URL analysis (exists). Review data import (scaffold).

**Where it lives:** Intelligence layer. Not a visible route until data exists.

**Feeds:** Content strategy.

#### 10.8 Content Syndication (Scaffold)

**Purpose:** Track content distribution across platforms that feed AI training.

**Stage 1:** Scaffold. Identify content syndication targets from citation source analysis. Which external platforms cite the business? Track "earned" citations by source type.

**Stage 2:** Syndication impact analysis. Does content on platform X lead to more AI citations?

**Stage 3:** Syndication recommendations and tracking.

**Dependencies:** Citation source analysis (exists).

**Where it lives:** Intelligence layer → Competitors/Pages disclosure.

**Feeds:** Content distribution strategy.

---

### UPGRADE PATH MAP — PROFOUND → NATIVE

The transition from Profound-imported data to native-owned data is designed as a **swap, not a rewrite.**

**Key principle:** Every computation module accepts a data source parameter (or reads from the repository layer). When native data arrives, it enters through the same schema — the `source_system` field distinguishes origin.

**Swap sequence:**

| Step | What changes | What stays the same |
|------|-------------|-------------------|
| 1. Perplexity client ships | New `answer_snapshots` store populated | All existing Profound data remains |
| 2. Native Results created | `source_system: "beacon_native"` on new Result rows | Import pipeline unchanged; Profound results kept |
| 3. Citation data refreshes | New citation rows from native sampling supplement `citations-by-date/` | Cold store format unchanged; sharding by date works for both sources |
| 4. Answer text freshens | `answer_snapshots` replaces cold-store `answer-texts.json` as primary source for genealogy/discrepancy | Cold store remains as historical archive |
| 5. Multi-model expands | `answer_snapshots` rows carry `model` field | Same schema; query filtering by model |
| 6. Profound retires | Historical archive only; `source_system: "profound_import"` stops growing | No deletion; gradual irrelevance |

**No store schema changes required.** The `source_system` field on Results, the `model` field on answer snapshots, and the `sampled_by` field on citations provide clean filtering at every computation boundary.

**Repository layer handles the swap:** `SeedDataRepository` getters already abstract the storage backend. Native data enters the same tables (Supabase) and files (`.data/`) through the same dual-write paths. Consumers never know the difference.

---

## Tiered product stack — research-led nano-phases (1.1a–2.3h)

**Purpose:** Executable **mini-prompt** slices (each completable in one focused session). Each row is **research-led first** (questions + spec), then implementation. **Numbering is independent** of historical “Phase 2–37” above.

**Priority law:** Finish **Tier 1** tracks **1.1 → 1.5** in order unless **Depends on** explicitly allows parallel work. **Tier 2** (2.1–2.3) starts only when Tier 1 exit criteria are met (see end of §1.5).

**Tier 1 — must build now:** Proof layer · Daily ritual perfection · Replication engine · Listings/reviews local layer · Milestones/ATH.  
**Tier 2 — after Tier 1:** Revenue bridge · Weekly export/proof summary · Stronger competitor attack.

---

### Track 1.1 — Proof layer

**1.1a — Signal taxonomy audit**  
- **Context:** Beacon blends crawl, import, synthetic wrappers, and heuristics.  
- **Research questions:** What signal classes exist today? Which are “observed” vs “inferred”? Where is provenance stored vs missing?  
- **Deliverable:** Markdown matrix: signal → source artifact → UI surfaces → user-facing claim allowed.  
- **Done when:** Matrix reviewed; “forbidden claims” list exists.  
- **Depends on:** none.

**1.1b — Competitor trust patterns (desk research)**  
- **Context:** AEO/GEO vendors vary in methodology transparency.  
- **Research questions:** How do Peec, Profound, SE Visible, Writesonic describe sampling? What disclaimers are common?  
- **Deliverable:** 1-page “industry bar” + list of patterns to adopt or avoid.  
- **Done when:** Doc linked from 1.1a matrix footnotes.  
- **Depends on:** 1.1a.

**1.1c — In-product methodology shell (IA)**  
- **Context:** Proof must be reachable without burying Today.  
- **Research questions:** Where do operators look when they doubt a number? (Settings vs Today vs per-card.)  
- **Deliverable:** Wireframe notes: entry points, depth (summary → detail), cross-links.  
- **Done when:** Agreed IA for “How we know this” for Tier-1 surfaces.  
- **Depends on:** 1.1a.

**1.1d — Prompt bank governance spec**  
- **Context:** Prompt-derived visibility is easy to attack.  
- **Research questions:** Versioning? Who edits? Retention? Per-tenant? Audit log fields?  
- **Deliverable:** Spec: `PromptSet` lifecycle, diff, rollback, display rules.  
- **Done when:** Spec + API shape (even if file-backed v1).  
- **Depends on:** 1.1a.

**1.1e — Confidence & uncertainty copy deck**  
- **Context:** Operators punish false precision.  
- **Research questions:** Which strings currently imply certainty? What’s the replacement lexicon (likely / observed / insufficient sample)?  
- **Deliverable:** Copy table: before → after, by surface (Today, Market, Changes).  
- **Done when:** Stakeholder pass on 10 highest-traffic strings.  
- **Depends on:** 1.1a.

**1.1f — Lineage fields (minimal schema)**  
- **Context:** Evidence needs machine-readable lineage for UI + export.  
- **Research questions:** Minimum fields: `source`, `observed_at`, `sample_id`, `coverage_note` — enough?  
- **Deliverable:** Type definitions + which entities get lineage first (findings, verdicts, chart points).  
- **Done when:** Schema merged as plan; first consumer chosen.  
- **Depends on:** 1.1d.

**1.1g — Wire lineage into top finding types**  
- **Context:** Findings are the trust-critical path.  
- **Research questions:** Which finding codes account for 80% of user decisions?  
- **Deliverable:** Implementation plan per finding family + test cases.  
- **Done when:** Each chosen family lists lineage in UI.  
- **Depends on:** 1.1f.

**1.1h — “Adversarial owner” FAQ**  
- **Context:** Skeptical owners ask the same 12 questions.  
- **Research questions:** What breaks trust fastest? (stale crawl, single prompt, etc.)  
- **Deliverable:** FAQ + short answers grounded in 1.1a matrix.  
- **Done when:** FAQ reachable from methodology shell (1.1c).  
- **Depends on:** 1.1c, 1.1e.

**1.1i — Stale / partial coverage escalation rules**  
- **Context:** Silent failure is worse than empty data.  
- **Research questions:** What thresholds? What’s blocking vs warning?  
- **Deliverable:** State machine: fresh → degrading → stale → action required.  
- **Done when:** Rules mapped to UI + copy (ties 1.2).  
- **Depends on:** 1.1a.

**1.1j — Proof layer exit gate**  
- **Deliverable:** Checklist: every Tier-1 surface has methodology link + lineage on primary claims + no forbidden strings.  
- **Done when:** Checklist signed off for ship.  
- **Depends on:** 1.1g, 1.1h, 1.1i.  
- **2026-04-12:** Follow-up **copy sweep** completed for 1.1j §8 items 1–11 (non-primary + generated copy + diagnostics labels + aligned attribution verdict phrasing). Methodology **route** (`/settings/methodology`), **1.1i v1** coverage state (`deriveCoverageState`), and **Layer-2** collapsed `<details>` on Market + Changes Outcomes are shipped.
- **2026-04-13:** **1.1i expansion** — `deriveCoverageState` now returns **aging** and **critical** using fixed fractions of `T=3` (aging `(0.7T, T]`, critical `>2T` or missing crawl when flagged); Today/Market/Changes wired; methodology `#coverage-states`.
- **2026-04-13:** **1.1j final trust pass** — methodology completeness (“How to read it” / “Beacon does not know”), FAQ expansion (coverage labels, continuous updates, full review coverage), standardized local proof footnote + connectors copy, Today/Market/Changes/`/local`/local-operator string alignment; `TIER_1_1J_EXIT_GATE_CHECKLIST.md` sign-off refresh; 280/280 tests.

---

### Track 1.2 — Daily ritual perfection

**1.2a — Ritual user journey map**  
- **Research questions:** Morning minutes available? Who skips days? What triggers return?  
- **Deliverable:** Journey: trigger → open → triage → assign → done → weekly proof.  
- **Done when:** Map approved.  
- **Depends on:** none.

**1.2b — “Inbox zero” definition for Beacon**  
- **Research questions:** What counts as “done for today” beyond findings? (imports, attribution, scans.)  
- **Deliverable:** Single definition + priority order when multiple queues non-empty.  
- **Done when:** Product agrees one stack rank.  
- **Depends on:** 1.2a.

**1.2c — Digest channel spec (email / SMS / Slack)**  
- **Research questions:** Which channel for which ICP? Frequency caps? Quiet days?  
- **Deliverable:** v1 channel matrix + payload outline (“3 actions”).  
- **Done when:** Legal/privacy notes captured (even if “later”).  
- **Depends on:** 1.2b.

**1.2d — Notification payload copy templates**  
- **Deliverable:** 5 template variants (critical, stale, win, nudge, all-clear).  
- **Done when:** Templates reviewed against proof layer (1.1e).  
- **Depends on:** 1.1e, 1.2c.

**1.2e — Assignment + ownership model**  
- **Research questions:** Single assignee vs team? Snooze reasons?  
- **Deliverable:** State + fields + UI placement (Today vs Pages).  
- **Done when:** Spec + empty states.  
- **Depends on:** 1.2b.

**1.2f — Mobile / job-site use case**  
- **Research questions:** What can be done on phone in 60s? What must wait for desktop?  
- **Deliverable:** Must-have mobile actions list vs deferred.  
- **Done when:** Scoped for v1.  
- **Depends on:** 1.2a.

**1.2g — Ritual metrics (instrumentation plan)**  
- **Deliverable:** Events: `ritual_opened`, `primary_action_*`, `digest_sent`, `time_to_clear`.  
- **Done when:** Event names + properties documented.  
- **Depends on:** 1.2b.

**1.2h — Daily ritual exit gate**  
- **Deliverable:** Checklist: digest + clear done-state + escalation + assignment + mobile scope.  
- **Done when:** Signed off.  
- **Depends on:** 1.2c–1.2g, 1.1j (proof strings in ritual).
- **2026-04-12 (persistence slice):** Settings → **Sign-offs** (`/settings/exit-gates`) + `.data/exit-gates.json` — operator records per-gate `status` / `note` / `updated_at` (`exit-gates-store.ts`, methodology `#exit-gates`). Keys: **`daily_ritual`** (this track), **`replication`** (Track 1.3), **`local_layer`** (Track 1.4l, **2026-04-13**). No workflow; does not change metrics, scores, freshness, or proof. Product checklist above remains the definition of “done.” **2026-04-13:** operator **`passed`** for **`daily_ritual`** + **`replication`** (notes on file) — together with **`local_layer`**, all three Sign-off rows **`passed`**.

**1.2i — Keyboard / power-user path**  
- **Deliverable:** Shortcuts spec for triage (align with command palette).  
- **Done when:** Documented; conflicts resolved.  
- **Depends on:** 1.2e.
- **2026-04-12 (product slice shipped):** Today-only minimal path — **A** focuses primary CTA, **J/K** moves among visible finding rows, **Enter** on a focused row triggers its first action; no global shortcut manager. See `VERIFICATION_LOG.md` (Track 1.2 Phase 3). Full 1.2i spec + command-palette alignment remains open.
- **2026-04-14:** Today **Next:** one-liner under the scan strip — `deriveTodayNextLine` routes on existing inputs only (no new scoring); `#today-findings` anchor; `tests/lib/today-next-line.test.ts`.
- **2026-04-14 (follow-up):** Truth blockers **outrank** local + primary + critical-queue **Next:** (`scanPhaseFailed` + same coverage/crawl gates as all-clear); aligned empty-findings label + digest + primary secondary styling when truth blocked.
- **2026-04-12 (Today stale visibility):** Hard **truth-blocker** when `isVisibilityCoverageStaleTruth` — keep scan strip green on success, but headline **Data is stale** + import-first copy + `/settings/import`; **Next:** concrete import line when `hasImportedVisibility`; local/primary/digest/findings visually deferred; empty queue uses warning frame + import note (not “healthy” closure); optional **Last visibility data:** from existing `proofContext.visibilityCompletedAt` inside the freshness box.
- **2026-04-12 (Today one decision):** `deriveTodayOneDecision` + `TodayOneDecisionCard` — single **Right now** block (yes/no, why, first step or defer); replaces parallel Next line + duplicate stale banner; `deriveTodayNextLine` kept for lib/tests.
- **2026-04-12 (Today primary card):** `buildPrimaryDecisionCopy` — sections **Why this matters** / **If you ignore it** / **If you ship it** / **Leverage & how sure Beacon is** from existing rec fields only; Basis block unchanged.
- **2026-04-14 (scan):** Website scan CLI inferred **`example.com`** without `BEACON_SITE_DOMAIN` while seed pages used the real domain → sitemap **fetch failed**; fixed with `scan-site-domain.ts` + `exec` env injection + `apply-scan-site-domain.cjs` preload (see `VERIFICATION_LOG.md`).

---

### Track 1.3 — Replication engine

**1.3a — “Winner” definition v2**  
- **Research questions:** Validated vs partial vs operator-confirmed — which counts as replication seed?  
- **Deliverable:** Decision tree + exclusions (e.g. one-off news).  
- **Done when:** Agreed with Changes/attribution owners.  
- **Depends on:** none.

**1.3b — Pattern library gap analysis**  
- **Context:** `minePatterns` / briefs / track record exist.  
- **Research questions:** What patterns are under-detected for local? (FAQ, LocalBusiness, service area, etc.)  
- **Deliverable:** Prioritized pattern backlog.  
- **Done when:** Top 10 patterns ranked.  
- **Depends on:** 1.3a.

**1.3c — Replication queue IA**  
- **Research questions:** Queue lives on Changes vs Today vs both?  
- **Deliverable:** Wireflow: pick winner → select targets → confirm → track experiment.  
- **Done when:** Approved flow.  
- **Depends on:** 1.3b.

**1.3d — Target selection rules**  
- **Deliverable:** Rules: same metro, same service, citation gap, not already shipped.  
- **Done when:** Pseudocode + edge cases.  
- **Depends on:** 1.3b.

**1.3e — Batch size & operator cognitive cap**  
- **Research questions:** Max simultaneous replications before noise?  
- **Deliverable:** Default cap + “show more”.  
- **Done when:** Product number chosen.  
- **Depends on:** 1.3c.

**1.3f — Experiment linkage spec**  
- **Deliverable:** How replication enqueue ties to `experiment-store` + success criteria.  
- **Done when:** One end-to-end example written on paper.  
- **Depends on:** 1.3c.

**1.3g — Replication metrics**  
- **Deliverable:** KPIs: suggested → accepted → shipped → validated rate.  
- **Done when:** Dashboard spec (even if internal first).  
- **Depends on:** 1.3f.

**1.3h — Replication engine exit gate**  
- **Deliverable:** Checklist: queue visible, one-click enqueue, tracking, proof strings.  
- **Done when:** Signed off.  
- **Depends on:** 1.3d–1.3g, 1.1j.
- **2026-04-12 (persistence slice):** Same **Sign-offs** page + store row `replication` — internal sign-off state only; does not satisfy checklist items until operator marks accordingly.
- **2026-04-13:** Operator **`replication`** = **`passed`** (see `.data/exit-gates.json`); static checklist pass logged in **`docs/TIER_1_DOGFOOD_WEEK_LOG.md`** (not a substitute for calendar dogfood week).

---

### Track 1.4 — Listings / reviews first-class local layer

- **2026-04-12 — Phase 1 (read-path foundation):** Route **`/local`** + `src/lib/local-presence.ts` (`getLocalPresenceSnapshot`). Shell nav **Local**; listing inferred from configured domain only; reviews explicitly not connected; simple health tier (weak / OK / strong); Layer-2 methodology `<details>`. No GBP API, no new persistence.
- **2026-04-12 — Phase 2B (manual review import):** Entity **`reviews`** on Settings → Import; `local-reviews-types` + `local-reviews-store` + `review-mapper`; `.data/local-reviews.json`; `/local` shows real counts, average rating, sentiment band (average only), import staleness; reset/clear paths; spec `TIER_1_4_PHASE_2_LOCAL_REVIEW_READ_PATH_SPEC.md`. Still no GBP API, no background sync.
- **2026-04-12 — Phase 2C (methodology / proof layer):** **`/settings/methodology`** — `#local-reviews` metric block + overview + boundaries + FAQ aligned with spec §6; **`/local`** disclosure points to that anchor.
- **2026-04-13 — Phase 3 (NAP consistency + listing health):** `BusinessConfig` gains `phone`, `address`; `checkNap()` 4-field completeness; `computeListingHealth()` 7-component weighted composite 0–100 (domain 25, name 15, phone 10, address 10, reviews 15, avg rating 15, freshness 10); tier weak/ok/strong from score. `/local` shows score + bars + missing fields. Config form adds phone + address. Methodology `#listing-health` + FAQ. 153 tests.
- **2026-04-13 — Phase 4 (Today + Market local surfacing):** `buildTodayLocalAttention` / `MarketLocalStrip` — passive strips from existing snapshot only; staleness binary uses last reviews import >30d; hidden when strong + full NAP + reviews + fresh. Vitest includes `*.test.tsx` for component smoke.
- **2026-04-12 — Per-source last sync on `/local`:** `LocalPresenceSnapshot.lastSync` — Google/Yelp from connector `last_synced_at`; manual from latest `ImportRun` with `entity_type: reviews` and `imported_count > 0` excluding `connector:google` / `connector:yelp` rows. `/local` **Data freshness** section (three rows always + disclosure); `#review-source-timestamps` methodology. No merged timestamp, no new freshness thresholds.
- **2026-04-13 — 1.4d Review monitoring v1 (spec + methodology):** `docs/TIER_1_4D_REVIEW_MONITORING_V1_SPEC.md` + `/settings/methodology#review-monitoring-v1` — bounded monitoring scope; **manual import + optional on-demand Google/Yelp connectors** (no auto-sync, no SLA); combined vs per-source freshness consistent with `#review-source-timestamps`. **2026-04-13 (doc pass):** 1.4d + `TIER_1_4E_REVIEW_CONNECTORS_SPEC.md` wording aligned with shipped connectors and methodology (no “import-only / not shipped” drift).

**1.4a — Scope boundary doc (not Yext)**  
- **Research questions:** Read vs write? GBP only first? Listings without full CRM?  
- **Deliverable:** “In / out” table vs BrightLocal/Moz.  
- **Done when:** Exec sign-off on boundary.  
- **Depends on:** none.

**1.4b — GBP data model (read path v1)**  
- **Deliverable:** Fields needed for health: hours, categories, attributes, posts cadence, Q&A.  
- **Done when:** API/source choice documented (manual import vs connector).  
- **Depends on:** 1.4a.

**1.4c — Listings health score methodology**  
- **Research questions:** Which mismatches matter for AI local answers?  
- **Deliverable:** Score components + weights + disclaimers.  
- **Done when:** Aligns with proof layer (1.1).  
- **Depends on:** 1.4b, 1.1b.

**1.4d — Review monitoring v1 scope**  
- **Deliverable:** Written scope + methodology mirror — sources (Google primary, Yelp secondary, `other` manual); **v1 = manual import path always available + optional additive on-demand connectors** (see 1.4e); coverage/freshness rules **without** polling, background sync, or alert SLAs; `docs/TIER_1_4D_REVIEW_MONITORING_V1_SPEC.md` + `/settings/methodology#review-monitoring-v1` (+ `#local-reviews`, `#review-source-timestamps`, `#review-connectors`).  
- **Done when:** Scope frozen and stays consistent with shipped product (2026-04-13+). *Legacy line:* “SLA for new review” applies only to a **future** phase if explicitly rescoped — **not** v1.  
- **Depends on:** 1.4a (conceptual); connector implementation is separate track **1.4e** (shipped).

**1.4e — Review connectors sub-spec + GBP + Yelp connectors (on-demand review sync)**
- **Deliverable:** Spec + methodology (`TIER_1_4E` + `#review-connectors`) **+ shipped connectors:** **Google** — OAuth, `/settings/connectors` Connect/Disconnect/Sync now, GBP v4 fetch→strict map→`mergeUpsertLocalReviews`, `last_synced_at`, import-run audit (`connector:google`), token refresh. **Yelp** — API key in server-only store, same page card, Fusion fetch→`mapYelpReviewToLocalReview`→merge, `connector:yelp` import runs, `yelp:` id prefix. **Shared:** local-presence `lastReviewImportAt` uses max(import runs, Google `last_synced_at`, Yelp `last_synced_at`); partial-fetch / invalid-key handling; **no** auto-sync / background jobs.
- **Done when:** On-demand sync merged to `local-reviews` and verified (2026-04-13).  
- **Depends on:** 1.4d.

**1.4e-legacy — Review response workflow** *(original 1.4e — relabeled; blocked by connectors)*  
- **Research questions:** AI draft + human approve vs templates only?  
- **Deliverable:** Workflow + liability note.  
- **Done when:** Legal/comms sign-off pattern.  
- **Depends on:** 1.4e (connector spec ships first; response workflow requires active platform connection).

**1.4f — Today / Market surfacing rules**  
- **Deliverable:** When listings/reviews appear on Today vs Settings vs Market.  
- **Done when:** IA doc.  
- **Depends on:** 1.4c, 1.4d.
- **2026-04-12 (shipped):** Today + Market + `/local` now use centralized `napState` (complete/incomplete/inconsistent/unknown) from `LocalPresenceSnapshot`. Today attention shows inconsistency fact line. Market strip applies NAP tone coloring. `/local` shows explicit label + factual explanation. No new connectors or scoring.

**1.4g — NAP consistency checks (lightweight)**  
- **Deliverable:** Compare GBP vs site footer vs schema; diff UI spec.  
- **Done when:** Rules + false-positive handling.  
- **Depends on:** 1.4b.
- **2026-04-12 (shipped):** `deriveNapConsistencyState` in `local-presence.ts` — 4 states; `inconsistent` detected when imported review `listing_name` values conflict with configured business name (case-insensitive). Methodology `#nap-consistency`. No live-directory verification, no auto-fixes. Tests: 15 new (derivation + boundary + precedence + attention + strip).

- **2026-04-13 — Listing completeness / GBP field coverage (read-only):** `LocalPresenceSnapshot.listingCompleteness` — audit of **name** (business config or Google connector selected-location label), **address**, **phone**, **website** (configured domain), **category** (config industry); **hours** omitted until a stored hours signal exists. Output: `present_fields` / `missing_fields` / `coverage_state` (`strong` / `partial` / `weak`) from simple present-count thresholds — **not** a second health score. `/local` **Listing completeness** UI; Today + Market optional surfacing when weak/partial; methodology `#listing-completeness`. No new connectors, no external validation language.

**1.4h — Competitive context for reviews**  
- **Deliverable:** “vs local pack competitors” framing research (data availability).  
- **Done when:** Feasibility verdict.  
- **Depends on:** 1.4d.

**1.4i — Import / connector fallback**  
- **Deliverable:** If no API: CSV/manual refresh cadence for GBP metrics.  
- **Done when:** Operator comms drafted.  
- **Depends on:** 1.4b.

**1.4j — Local layer privacy & retention**  
- **Deliverable:** Retention policy for review text, PII in logs.  
- **Done when:** Checklist for ship.  
- **Depends on:** 1.4d.

**1.4k — Permissions (future multi-user)**  
- **Deliverable:** Who can respond to reviews vs view financials.  
- **Done when:** Roles stub for v1 single-user.  
- **Depends on:** 1.4e.

**1.4l — Local layer exit gate**  
- **Deliverable:** v1 ship: health card + review alert + methodology links + boundary visible.  
- **Done when:** Signed off.  
- **Depends on:** 1.4f–1.4j, 1.1j.
- **2026-04-13 (operator sign-off mechanism shipped):** Third internal exit gate **`local_layer`** in `.data/exit-gates.json` (same `status` / `note` / `updated_at` as Daily Ritual + Replication). **Settings → Sign-offs** — static review checklist, status actions, note save; methodology **`#exit-gates`** documents Local layer + “does not affect metrics, scores, or freshness.” Optional Settings layout hint: on **`/settings/exit-gates`**, if Local layer is not `passed`, a one-line readiness strip appears even when the other two gates are already `passed` (low noise; no banners on Today/Market/`/local`). **2026-04-13 (operator judgment):** checklist review recorded — **`local_layer`** **`passed`** with note; minor **`/local`** header copy aligned to read-only truth (no live-directory implication).

---

### Track 1.5 — Milestones / all-time-high (ATH) system

**1.5a — ATH metric catalog**  
- **Research questions:** Which metrics motivate local owners without lying? (citations, share, rank, mentions.)  
- **Deliverable:** Allowed ATH dimensions + anti-gaming rules.  
- **Depends on:** 1.1a.

**1.5b — Rolling vs calendar windows for records**  
- **Deliverable:** Define window for “best week ever” vs ATH.  
- **Done when:** Spec avoids overlap with Today chart windows.  
- **Depends on:** 1.5a.

**1.5c — Milestone event types**  
- **Deliverable:** Enum: first_time_top3, ATH_citations, streak_7d, etc. + trigger conditions.  
- **Done when:** Backend plan matches UI slots.  
- **Depends on:** 1.5a, 1.5b.

**1.5d — Celebration UX (proportionality)**  
- **Research questions:** When is celebration annoying?  
- **Deliverable:** Intensity rules + “share” optional.  
- **Depends on:** 1.5c.

**1.5e — History store for milestones**  
- **Deliverable:** Persistence shape + dedupe (same ATH daily).  
- **Depends on:** 1.5c.

**1.5f — Today surfacing of milestones**  
- **Deliverable:** Placement + max noise per week.  
- **Depends on:** 1.5d, 1.2 (ritual).

**1.5g — Milestones exit gate**  
- **Deliverable:** Checklist: ATH truthful, deduped, linked to proof.  
- **Done when:** Signed off.  
- **Depends on:** 1.5e, 1.5f, 1.1j.

---

### Tier 1 completion criterion

Tier 1 is **closed** when **1.1j, 1.2h, 1.3h, 1.4l, 1.5g** are all signed off and one **internal dogfood week** completes without P0 trust regressions.

- **2026-04-13 (engineering):** Added **`docs/TIER_1_DOGFOOD_WEEK_LOG.md`** — daily-use protocol, log table, **static validation** pass for 1.2h/1.3h (code + copy review; minimal string fix in `replication-engine.ts`). This does **not** replace five to seven **consecutive calendar days** of operator use; the human operator fills the log table and pastes the **Final Tier 1 note** in that file when done. Until then, treat “Tier 1 closed” as **not** satisfied for downstream vault dependencies (e.g. Track 2.1).
- **2026-04-14 (verification):** Dogfood log reviewed for vault closure — **insufficient evidence** (no consecutive dated operator rows; Final note not completed). **Tier 1 remains open.** See **`docs/TIER_1_DOGFOOD_WEEK_LOG.md`** → **Verification record** and **`VERIFICATION_LOG.md`** (2026-04-14 entry).

---

### Track 2.1 — Revenue bridge / business-signal layer

**2.1a — Signal inventory beyond visibility**  
- **Deliverable:** Calls, forms, LSA, GBP actions — which exist for ICP?  
- **Depends on:** Tier 1 closed.

**2.1b — Integration priority matrix**  
- **Deliverable:** Build vs partner; effort vs impact chart.  
- **Depends on:** 2.1a.

**2.1c — Identity graph (visitor ↔ AI visibility)**  
- **Research questions:** Match rates realistic?  
- **Deliverable:** Honest feasibility tier (A/B/C).  
- **Depends on:** 2.1a.

**2.1d — Metric definitions for “AI-assisted revenue”**  
- **Deliverable:** Definitions that legal/marketing can defend.  
- **Depends on:** 2.1c.

**2.1e — UI: where revenue story lives**  
- **Deliverable:** Changes vs Today vs new “Outcomes” — placement.  
- **Depends on:** 2.1d.

**2.1f — v1 minimum lovable bridge**  
- **Deliverable:** Pick **one** signal (e.g. call clicks from GBP) for first bridge.  
- **Depends on:** 2.1b.

**2.1g — Revenue bridge exit gate**  
- **Deliverable:** One defended metric live + methodology.  
- **Depends on:** 2.1f, 1.1j.

---

### Track 2.2 — Weekly export / proof summary

**2.2a — Audience variants (owner vs agency client)**  
- **Deliverable:** Two outline templates.  
- **Depends on:** Tier 1 closed.

**2.2b — Data inclusion rules**  
- **Deliverable:** What proof objects export (screenshots? links? tables?).  
- **Depends on:** 1.1g, 2.2a.

**2.2c — PDF / deck layout spec**  
- **Deliverable:** Branding, page count cap, white-label fields.  
- **Depends on:** 2.2b.

**2.2d — Generation pipeline**  
- **Deliverable:** Server job vs on-demand; caching; failure modes.  
- **Depends on:** 2.2c.

**2.2e — Weekly cadence + email attachment**  
- **Deliverable:** Cron spec + unsubscribe.  
- **Depends on:** 2.2d.

**2.2f — Weekly export exit gate**  
- **Deliverable:** One real client packet generated from prod-like data.  
- **Depends on:** 2.2e, 1.1j.

---

### Track 2.3 — Stronger competitor attack system

**2.3a — “Attack” semantics research**  
- **Deliverable:** Ethical framing; avoid war metaphors in regulated verticals.  
- **Depends on:** Tier 1 closed.

**2.3b — Countermove taxonomy**  
- **Deliverable:** Map threat types → allowed actions (content, schema, PR, local).  
- **Depends on:** 2.3a.

**2.3c — One-click strategy spec**  
- **Research questions:** What does button do? (enqueue replication? open brief? schedule scan?)  
- **Deliverable:** Flow per competitor row.  
- **Depends on:** 1.3c, 2.3b.

**2.3d — Evidence pack for “why they win”**  
- **Deliverable:** Which artifacts prove topic-level gap.  
- **Depends on:** 1.1, citation index.

**2.3e — Competitive narrative QA**  
- **Deliverable:** 10 synthetic cases; expected output.  
- **Depends on:** 2.3d.

**2.3f — Market UI density review**  
- **Deliverable:** Reduce to top-N threats + progressive disclosure.  
- **Depends on:** 2.3e.

**2.3g — Attack system metrics**  
- **Deliverable:** Usage: strategies run → shipped → outcome.  
- **Depends on:** 2.3c.

**2.3h — Competitor attack exit gate**  
- **Deliverable:** One-click path live for ≥1 strategy class + proof.  
- **Depends on:** 2.3c–2.3g, 1.1j.

---

### Tier 2 completion criterion

Tier 2 is **closed** when **2.1g, 2.2f, 2.3h** are signed off and **one agency pilot** can run a week without manual spreadsheet side-channel.

---

## AUDIT SUMMARY (2026-04-11)

Full audit files are in `docs/archive/audits/` (9 documents). Key findings preserved here for vault completeness.

### Overall scores

| Composite | Score |
|-----------|-------|
| Product intelligence | 75/100 |
| Operator experience | 45/100 |
| Production safety | 25/100 |
| Overall | 53/100 |
| Launch readiness (current) | 38/100 |
| Launch readiness (after safety fixes) | 72/100 |

### 10 strongest aspects

1. Domain model depth (80) — 31 well-bounded, well-typed domains
2. Finding detection (78) — 15 types from real scan diffs, 5 dedicated tests
3. Proof layer (78) — Confidence badges, evidence tiers, trust sources, freshness dots
4. Architecture quality (76) — Clean separation, server/client boundary, consistent patterns
5. Pages route (75) — Page truth + fix briefs + verification workflow
6. Copy/wording (75) — Operator-focused, honest, avoids jargon
7. Attribution engine — Candidate discovery, triage, scoring, operator verification
8. Replication engine (72) — Pattern mining → target identification → rollout coordination
9. Changes scorecard (70) — Core "what worked" view with honest verdicts
10. Test quality (70) — Tests that exist are well-written

### 10 most dangerous weaknesses

1. No error boundaries (15/100) — Any error → white screen crash
2. No loading states (15/100) — Heavy computation → blank page
3. Today scan blocks render — Up to 120s blank page on morning visit
4. Empty states missing (30/100) — Most routes have no "no data yet" state
5. Production readiness (32/100) — No health checks, observability, monitoring
6. Test coverage (35/100) — Zero route, integration, E2E, or UI tests
7. Business consequence framing (35/100) — "business impact" but visibility-only data
8. Dead-weight surface (35/100) — PDFs, legacy adapters, redirect routes
9. Overall launch readiness (38/100) — Too many gaps for paying users
10. Cognitive load (42/100) — 15 Today sections, 10+ fields per Pages row

### Route audit summary

| Route | Score | Classification |
|-------|-------|---------------|
| Today | 60/100 | REAL BUT FRAGILE — scan blocks render, 15 sections, render-time side effects |
| Pages | 75/100 | REAL — strongest route, fix briefs + verification is differentiated |
| Market | 62/100 | REAL BUT DATA-DEPENDENT — empty without imports, no competitive trends |
| Changes | 70/100 | REAL — dense scorecard, core "what worked" view |
| Settings | 50/100 | REAL BUT FRAGMENTED — Import solid, Config/Health/History mismatched |

### Detailed audit files

| File | Content |
|------|---------|
| `docs/archive/audits/AUDIT_RECONCILIATION.md` | Every claim verified TRUE/FALSE/PARTIAL against current code |
| `docs/archive/audits/VERIFIED_CURRENT_AUDIT.md` | Full route-by-route + data + UX + engineering audit |
| `docs/archive/audits/SCORECARD_1_TO_100.md` | 37-category scoring with evidence |
| `docs/archive/audits/KEEP_HIDE_FIX_KILL_MATRIX.md` | Every route/component/domain classified |
| `docs/archive/audits/TOP_25_HIGHEST_LEVERAGE_FIXES.md` | Prioritized fixes with effort estimates |
| `docs/archive/audits/PHASED_PATH_TO_LAUNCH.md` | 7-phase roadmap with acceptance criteria |
| `docs/archive/audits/MICRO_STEP_EXECUTION_PLAN.md` | 71 discrete steps with file paths |
| `docs/archive/audits/CURSOR_PROMPTS_BY_PHASE.md` | 11 ready-to-paste Cursor prompts |
| `docs/archive/audits/FINAL_LAUNCH_VERDICT.md` | Launch verdict + definition of done |

---

## Dream-state convergence decision (active, 2026-07-13)

Do not build another producer, hidden packet, or parallel ranking system. The active architecture is
one tenant-explicit seam: `ResearchDossier -> UnifiedEntry -> PreparedMove`. It must converge GSC/GA4
signals, DataForSEO keyword and SERP evidence, top Google and AI-cited winner evidence, clone briefs,
factual sources, and existing learning/measurement state into the one allocator and one prepared
atomic move. The first slice reuses existing stores and threads the evidence currently displayed on
Today into the EvidencePacket and drafter; publishing remains operator-approved.

**Second slice implemented 2026-07-14:** graph-derived moves now receive the compact dossier from
the tenant-explicit cached research corpus. Material dossier evidence participates in the canonical
evidence hash; timestamp-only refreshes do not churn drafts. The drafter receives grounded SERP,
AI, keyword, competitor, and unanswered-question hints/references, while PreparedMove persists only
a compact evidence-source/count receipt. This preserves the decision above: no new producer, ranker,
page, button, cron, or publishing path.

**Third slice implemented 2026-07-14:** the final actionable Changes order now emits a compact
server-only `RankedUnifiedEntry` handoff. Allocator-only AEO, SERP-steal, and keyword gaps are adapted
into the existing EvidencePacket/PreparedMove path with exact instructions, competitor/fanout seeds,
ResearchDossier convergence, and measured-demand provenance; graph-backed worklist entries reuse
their canonical packets. Preparation preserves this final order instead of re-sorting. The handoff is
removed from the client payload, and no new surface, producer, scheduler, ranker, or publish path was
introduced. Remaining proof is operational: authenticate, run one real visit cycle, and inspect a
real allocator-only winner end to end.

**Fourth slice implemented 2026-07-14:** both winner-research lanes now cross the convergence seam
without data loss. Native AI cited-page teardown persists cited URLs/counts, exact questions,
fanouts, and multi-page structural consensus into the unified allocator and ResearchDossier. The
exact final Changes order receives one guarded/cache-first live Google read per top query, up to two
on-topic organic winners are torn down through the existing polite cache, and those facts enter the
EvidencePacket before drafting. New-page moves use the same check and stop before LLM spend on a
Google reject. This preserves one ranker and one prepared-move path; no new page, button, cron, or
publishing path exists. Remaining proof is operational and authenticated, not another architecture
slice.

**Fifth slice implemented 2026-07-14:** final candidate demand now closes inside the same visit-run
before the allocator's one final pass. Beacon prioritizes native AEO gaps, then SERP steals, then
graph move labels; excludes fresh exact cached demand; and sends at most 25 missing queries through
one existing guarded DataForSEO keyword-volume batch. Exact volume is attached across all allocator
lanes and may only break an otherwise-equal tie when both entries are honestly unsized. It does not
create expected clicks, override a sized opportunity, or introduce another formula/ranker. The
receipt exposes checked terms. The remaining proof is one authenticated hosted tenant run showing
the receipt and allocator-only winner through PreparedMove.

**Sixth slice implemented 2026-07-14:** ordinary navigation is now the repair surface. The existing
post-response visit cycle detects an abandoned weekly page-factory receipt and idempotently retries
or reconciles the tenant/week batch; no control, customer script, environment ceremony, or new cron
was introduced. Research depth is deliberately two-dimensional: up to 500 ranked keywords for each
selected exact winning page and, independently, the provider's 1,000-row per-call related-keyword
maximum for each selected final topic seed. Full responses are cached for 30 days behind the shared
spend gauntlet, while compact rows are promoted into the unified keyword library and dossier so the
paid corpus is reused. Winner structure becomes an observed content blueprint, source candidates
must survive the existing verification gate, unrelated fanout is suppressed, obvious topic siblings
merge, and redirects require an exact safe source URL. The remaining proof is one normal signed-in
Iranopedia visit followed by a refresh and inspection of the resulting top move.

**Authenticated-production correction implemented 2026-07-14:** autonomous work is a bounded,
continuable product state, not one enormous post-response promise. A visit attempt receives a
terminal receipt by 210 seconds; a partial pass resumes through the producers' caches after a short
cooldown, so the header cannot remain `running` indefinitely. Weekly page recovery is subordinate
to the primary research brain and is deliberately one brief without the full-page walker. New-page
source completion now runs automatically for up to five candidates using the exact pages already
returned by the paid SERP read plus the hydrated tenant authority allowlist. Same-request GSC page
aggregation is memoized to reduce statement-timeout instability. `/today` is a supported alias for
canonical Today, and an automatically repaired scheduler receipt is kept out of the red customer
alarm because it is neither operator-actionable nor a Google-data trust failure.

**Instant-autonomy decision, 2026-07-15:** research freshness and product availability are separate
contracts. Today and Changes always serve the last complete tenant-scoped snapshot; a mutation marks
that snapshot stale but never deletes it, and a replacement becomes visible only after the full new
surface is built. The autonomous runner must publish a usable cached-evidence surface before slow or
paid enrichment. Provider latency, a partial pass, or a continuation deadline may delay deeper
evidence, but may not turn normal navigation into a waiting ritual or erase the operator's usable
ranking. Customer instructions must never ask for timed waits or double refreshes to make Beacon work.

**P0 tenant-isolation decision, 2026-07-14:** every background or post-response builder that begins
with an explicit tenant must keep that tenant explicit through every nested recommendation and
research read. Request-ambient or process-default tenant selection is forbidden inside that graph.
Persisted recommendation surfaces must carry tenant identity and fail closed on missing or
mismatched identity; absolute edit targets receive a final owned-domain check before display. This
decision follows authenticated evidence of an Iranopedia Changes snapshot built from Ritz ambient
dependencies. It is a correctness boundary for the connected brain, not optional multi-tenant SaaS
scope, and it must remain intact before further autonomous proof is accepted.

**Customer-operation boundary, 2026-07-14:** the connected brain is judged through the normal
product journey: Today explains current state, Changes holds the one ranked worklist, Results shows
movement, and Activity shows what Beacon did. Filesystem reports, CLI scripts, environment setup,
feature flags, internal taxonomy, and alternative allocator dumps are engineering evidence, not
customer work. Old diagnostic URLs must return a signed-in user to the corresponding canonical
surface rather than teaching them to operate Beacon's implementation.

---

**Autonomous-ready customer-release decision, 2026-07-15:** a usable customer state is one atomic,
tenant-scoped release shared by Today, Changes, and New Pages. Producers may update their own caches
independently, but customer pages adopt a new version only after the whole release is assembled.
Normal navigation automatically prepares the first five ranked moves through the existing guarded
PreparedMove path; a CMS connection is never a prerequisite for copy-ready work. The intelligence
pipeline checkpoints dependency-ordered stages and stops at the first failed stage so resumption is
truthful and does not build downstream claims on missing evidence. This adds no customer control,
cron, publishing permission, or render-time paid call.

**Ready and result-compression decision, 2026-07-17:** To do is ranked evidence, not a promise that
an edit is publishable. Ready is reserved for exact copy or an exact safe redirect map that passed
the existing evidence and quality gates; a zero count must never imply a guaranteed draft is about
to appear. Background progress may show only durable completed pipeline stages, never invented time
remaining. Results is an answer surface, not a second worklist: lead with the evidence clock and the
nearest reads, keep later measuring rows accessible but collapsed, and place manual fallback paths
after the normal tracked journey.

**Compound-action boundary, 2026-07-17:** simultaneous edits cannot be causally separated from one
page-level outcome. Same-page edits shipped on the same date are one intentional package with a
stable sorted combo identity. Results may report the package outcome but must not credit or train
any member lever. A later edit inside the measurement window is accidental overlap and remains
quarantined. A future combo prior may learn only from repeated calibrated outcomes for that exact
package identity; it may never back-propagate the package result into its ingredients.

**Competitor-evidence tenant boundary, 2026-07-17:** competitor teardown evidence is owned by an
explicit tenant at every layer, including cache merge/write operations. Request context may resolve
the tenant once at a customer-facing boundary, but background research, final-ranked SERP teardown,
keyword-gap work, retrieval indexing, graph compilation, diagnostics, and downstream learning must
pass that ID through directly. An empty tenant fails closed; an ambient process default may never
select a different tenant's competitor cache.

## FUTURE IDEAS (not in current execution plan)

These are ideas, experiments, and dream-state features that are NOT in the active phases. They live here so they are never lost. Move to `NEXT_PHASE_EXECUTION_PLAN.md` only when they become active work.

### V1+ Ideas

- **Dark mode** — premium feel improvement (currently light-only)
- **PDF export** — weekly proof summary for clients/stakeholders (Phase 31 gap)
- **Notification badge queue** — real-time alerts system (Phase 31 gap)
- **Geo heat map Stage-2 UI** — visual geographic coverage (Phase 31 gap, data shape exists)
- **Onboarding guided tour** — step-by-step first-run experience beyond setup wizard
- **Playwright E2E tests** — browser-level route smoke testing
- **Module-cache invalidation** — TTL or per-request initialization for production data freshness
- **Profound-native ingestion (2026-04-12 prep)** — API → normalize → **Supabase** with idempotent upserts + source/run tags; product routes keep reading the same domain contracts. Readiness audit: `docs/NATIVE_INGESTION_READINESS_AUDIT.md`. CSV batch remains the bridge; **workbook import removed** from the app; **`writeLegacyBridge`** now calls **`syncResults` / `syncChangelogEntries` / `syncImportRuns`** when dual-write is on so the Profound path is not file-only.

### Post-V1 Ideas

- **Multi-model AI sampling** — native Perplexity/ChatGPT/GAIO querying (client exists, not wired to prod)
- **Revenue bridge** — calls, forms, LSA, GBP actions linked to visibility changes (Tier 2.1)
- **Weekly export / proof summary** — automated PDF/deck for clients (Tier 2.2)
- **Competitive attack system** — one-click countermove strategies (Tier 2.3)
- **Assignment + ownership model** — team workflow with snooze/delegate
- **Email/SMS/Slack digest** — push notifications for morning briefing
- **Mobile-optimized view** — job-site 60-second triage
- **Auth + billing** — multi-tenant SaaS (currently single-user, filesystem isolation only)
- **Agency multi-tenant** — proper RLS, per-client dashboards, white-label
- **Content syndication tracking** — which external platforms drive AI citations
- **Adversarial stress testing** — brand defense prompt testing (scaffold exists)
- **What-if simulator** — outcome prediction from action types (scaffold exists)
- **Conversion path tracking** — prompt → answer → citation → visit → conversion (scaffold exists, needs analytics integration)

### Experimental / Dream State

- **Founder authority tracking** — person-entity mentions in AI answers
- **Training data pipeline assessment** — content visibility channel scoring
- **Citation genealogy** — trace source ancestry of AI citations (module exists)
- **Prompt mining** — discover new prompts from competitor citations
- **Real-time competitive monitoring** — continuous competitor citation tracking
- **AI content optimization suggestions** — structure improvements for better AI pickup
