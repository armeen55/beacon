# Beacon Master Execution Plan

> Living document. Single source of truth for implementation sequence.
> Updated: 2026-04-09
> Current phase: **Phase 0 — Consolidate & Stabilize**

---

## 1. Current Repo Truth

### Identity
- **Name:** `beacon`, private, version 0.1.0
- **Framework:** Next.js 16.2.2, React 19.2.4, App Router
- **Persistence:** `.data/*.json` via `src/lib/persistence/json-store.ts` (comment: "NOT the long-term production architecture")
- **Mode:** Single-user, single-workspace, no auth/billing/teams

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
1. Observations — what did the crawl / sample find?
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

1. **Website observations** — `domains/observations/types.ts` → `ObservationRun` with `run_id`, `run_type` (website_crawl, website_verify), artifact counts. Read via `observations/read.ts` from `.data/observation-runs.json` with fallback to legacy `scan-runs.json`.

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
| **Today** | `/` | Default home. Observation strip + queue + next move + verified fixes | `today-summary.ts`, page issues, events, decisions, guardrails, snapshots, citation index, competitor universe |
| **Your Website** | `/pages` | Execution workbench. Page list + issue tracking + verify actions | Page snapshots, issues, guardrails, render checks, frontier context |
| **Gap ledger** | `/topics` | Typed opportunity gaps. Frontier list + detail drilldown | Frontier planner, compiler, citation index, competitor evidence |
| **Gap detail** | `/topics/opportunity/[id]` | Single frontier detail with attack package + provenance | Frontier compiler, citation evidence, pages, competitor universe |
| **Changes** | `/changes` | Change log + contract list | Change contracts, changelog entries, scorecard |
| **Change detail** | `/changes/[id]` | Single change with contract, scorecard verdict, evidence | Change contract, scorecard, event attributions |
| **Review** | `/review` | Attribution decisions queue. Lock/reject/confirm per event | Events, candidates, triage, decisions |
| **Sample history** | `/results` | Imported result rows with visibility run context | Results, visibility observation runs |
| **Result detail** | `/results/[id]` | Single result with event linkage + match factors | Results, candidates, attributions |
| **Import** | `/import` | Workbook/CSV import with progress | Import engine, workbook parser |
| **Diagnostics** | `/diagnostics` | Pipeline debug. Full attribution/pattern/cluster analysis | All attribution + pattern + cluster + candidate domains |
| **Draft ideas** | `/expansion` | Experimental. System-derived opportunity candidates | Opportunity candidates compute |
| **Competitors** | `/competitors` | Competitor entity list | Competitors, competitor snapshots |
| **Observations** | `/observations/[id]` | Run detail (website or visibility) | `resolveObservationById` → website or visibility run |

---

## 12. Jobs / Orchestration

**CURRENT FACT:** All jobs are manual CLI scripts.
| Script | Command | Writes |
|--------|---------|--------|
| `scan-owned-pages.ts` | `npm run data:scan` | snapshots, diffs, guardrails, render checks, observation runs, scan runs, reconciliation |
| `build-page-registry.ts` | `npm run data:registry` | pages.json, citation-evidence-index.json |
| `score-snapshot.ts` | `npm run data:score-snapshot` | stdout diagnostics only |
| `backfill-result-visibility-runs.ts` | manual tsx | visibility-observation-runs.json |
| `backfill-change-contracts.ts` | manual tsx | change-contracts store |

**TARGET STATE (phased):**
- Phase 2: Inngest nightly crawl pipeline (replaces `data:scan` + `data:registry`)
- Phase 3: Inngest visibility sampling pipeline
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

**CURRENT PHASE:** Phase 0 — Consolidate & Stabilize

**FILES TO TOUCH NOW:**
- `src/domains/observation-runs/types.ts` (rename types)
- `src/storage/canonical-store.ts` (update import + add doc comment)
- `src/adapters/types.ts` (update import)
- `src/adapters/profound/execution-adapter.ts` (update import)
- `docs/architecture.md` (update weights + confidence bands)
- `package.json` (add vitest, add test script)
- `vitest.config.ts` (new)
- `tests/domains/attribution/invariants.test.ts` (new)
- `tests/domains/attribution/golden.test.ts` (new)

**DO NOT TOUCH YET:**
- Any persistence layer changes (Phase 1)
- Any route pages or UI components (not needed for Phase 0)
- Supabase setup or schema (Phase 1)
- Inngest integration (Phase 2)
- Crawl pipeline refactoring (Phase 2)
- Visibility/sampling code (Phase 3)
- Any scoring formula changes (not needed — system is calibrated)
- Any new domain modules

**NEXT DECISION AFTER THIS:**
After Phase 0 passes (`npm run check` + `npm test`), decide:
1. Whether to start Phase 1 with Supabase, or
2. Whether to do a Phase 0.5 that audits which json-store basenames are actively read by live surfaces (to scope the Phase 1 migration precisely)
