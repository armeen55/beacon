# Beacon Architecture

## What Beacon Is

Beacon is an attribution-triage system for AEO/SEO visibility.
It ingests changes (what you did), results (what happened), and uses deterministic logic to connect cause and effect.

## Data Flow

```
Workbook/CSV Import
    ↓
Changes + Results + Opportunities + Competitors
    ↓
Candidate Discovery (change × result scoring)
    ↓
Auto-Triage (confirm/reject/review)
    ↓
Outcome Events (derived from result time series)
    ↓
Event Resolution (attributed / no_cause / pending)
    ↓
Action Clusters (grouped events + changes)
    ↓
Patterns (normalized change strategies)
    ↓
Action Queue (prioritized operator tasks)
    ↓
Proposed Briefs (execution plans)
```

## Core Domains

| Domain | Purpose | Type |
|--------|---------|------|
| `results/` | Daily visibility snapshots | Imported |
| `changelog/` | Changes made (what you did) | Imported |
| `opportunities/` | What to pursue | Imported + System |
| `competitors/` | Who you compete with | Imported |
| `attribution/` | Cause-effect scoring + triage | Computed |
| `action-clusters/` | Grouped events + changes | Computed |
| `actions/` | Prioritized operator tasks | Computed + Persisted state |
| `patterns/` | Repeatable change strategies | Computed (diagnostic) |
| `product/` | Recommendation, priority, and feedback engines | Computed |
| `opportunity-candidates/` | System-derived expansion ideas | Computed (deferred) |
| `brief-generation/` | Execution plans from actions | Computed |
| `briefs/` | Accepted execution plans | Persisted |

## Attribution Config (Single Source of Truth)

All weights live in `src/domains/attribution/config.ts`:

- **Weights**: platform=20, topic=25, url=5, geo=15, temporal=20, sourceCategory=15
- **Strength values**: strong=1.0, partial=0.5, unknown=0, none=0
- **Confidence bands**: high≥70, medium≥45, low≥20

These are referenced by `compute.ts` and `diagnostics.ts` — no duplication.

## Pattern Success Rate

Denominator = **all relevant events** (not just resolved ones).
This prevents artificial inflation. A pattern with 3 attributed events out of 10 total shows 30%, not 100%.

## Navigation (pilot spine)

Default loop:
- **Today** — **KPI strip** (`KpiCard`: citations with delta, mentions, platforms, snapshots) + **PlatformSplit** when multi-platform + **DO THIS NOW** (Priority Engine) + **track record** (`MiniBarChart` when data qualifies) + **watchlist** + **what changed** (`ConfidenceBadge` on impact rows) + **other opportunities** (`ConfidenceBadge` on cards) + work queue + **system details** (expanded: crawl + visibility blocks use **KpiCard** grids for scanned/changed/errors/alerts and topic/rollup/citation/domain counts)
- **Pages** — **KPI + composition strip** (`KpiCard` grid: tracked, cited, need work, crawled + optional **`DonutRing`** for status mix) + split panel (page list → health card, FAQ/schema chips, progressive disclosure). **Phase 16:** evidence internals in details.
- **Competitors** — **KPI strip** (`KpiCard`: AI share, citations, tracked count, ahead-of-you) + **ranked list** with inline **share bars** + topic signals (including **bar readout** on thinnest share) + **co-mention** (`FilterChips`, `ViewToggle` table/chart, `MiniBarChart`, row bars) + **source trust** (expandable tables + per-source citation bars) + **local pressure** (`ComparisonBar` + `ViewToggle` chart/table) + battlecards (`ThreatMeter`). Universe CRUD in collapsed settings.
- **Gap ledger** (`/topics`) — typed gaps

Work:
- **Changes** — log + verification + **change impact** (`computeScorecard` → `enrichWithImpact`: confidence, direction, why, next action). **Phase 6:** URL matching normalized; decline events → `negative` verdicts real. **Phase 10:** `/changes/[id]` runs recommendation engine inline — validated changes show "Apply this pattern" with specific target pages; weak-evidence changes show "Strengthen this entry" nudges. **Phase 12:** `/changes` list runs pattern mining + track record; scorecard table shows "Beacon" badge + "N replicable" per row; "Beacon recommended" toggle filter; "Impact" sortable column; impact snapshot shows Beacon-recommended count + total replication targets.

Advanced:
- **Review** — hypothesis locks (attribution bookkeeping)
- **Sample history** (`/results`) — imported snapshots; **KpiCard** strip + **`PlatformSplit`** (when multiple platforms) + **`DonutRing`** (attribution trust mix when counts exist); existing platform + driver filters unchanged
- **Import**
- **Diagnostics (analyst)** — pipeline debug, outside daily loop; **StatBlock** tiles match KPI visual language; cluster status + verdict blocks use **`StackedBar`**; journey/geo/score use existing viz (`DonutRing`, `MiniBarChart`, `CoverageTrellis`, `BeaconScoreVisual`)

Experimental:
- **Draft ideas** (`/expansion`) — model backlog only

Secondary (accessible but not in main spine):
- Competitors, Briefs/Proposed, `/opportunities` legacy routes if present

Removed:
- Weekly (dead surface)
- Coverage (dead surface)

## Persistence

**Default:** Route-critical data is read through `SeedDataRepository` with **`DATA_SOURCE=supabase`** (see `src/lib/persistence/repositories/`). **`DUAL_WRITE=true`** keeps file-first writes and best-effort Supabase upserts so rollback stays trivial.

**Rollback:** Set **`DATA_SOURCE=file`** in `.env.local` and restart — reads return to `.data/*.json` via the same repository interface; no code change.

**Disk:** Supplementary operator state and large JSON blobs still live under `.data/` (read through repository getters or thin domain stores). The file **`.data/observation-runs.json` is shared**: Profound import rows (`ProfoundImportRun`, `canonical-store.ts`) coexist with website crawl/verify rows (`ObservationRun`); `file-backend` merges website-typed rows with legacy `scan-runs.json` and skips Profound-shaped objects (see `docs/master_execution_plan.md`, Phase 3C).

Underlying file cache and mutations still use `src/lib/persistence/json-store.ts` where applicable. Server-only — enforced by `import "server-only"`.

## Persistence boundaries (locked — Phase 3E)

| Layer | Role |
|--------|------|
| **Postgres (Supabase)** | Canonical **read** source for route-critical tables when `DATA_SOURCE=supabase`. |
| **`.data/*.json` + `json-store`** | On-disk truth and in-process mutation cache; always written first on mutating paths; enables instant rollback via `DATA_SOURCE=file`. |
| **`SeedDataRepository` (`getRepository`)** | **Default read path** for app/domain code — switches backend from env. |
| **Thin domain stores** | Wrap repository data for a single domain (citation index, snapshots, etc.); no second source of truth. |
| **`storage/canonical-store.ts`** | **Profound import pipeline only** — hot/cold Profound stores; not for website `ObservationRun` (those go through `domains/observations/read.ts`). |

**Documented bypasses (do not copy without updating this doc):**

- `topics/page.tsx` server action — `readDotDataJson` for citation index + snapshots at action time (freshness vs module cache).
- `universe-read.ts` — `readDotDataJson("competitor-universe")` only when `DATA_SOURCE=file` (file pin metadata).
- **`import-orchestrator.ts`** — `readStore("imported-changes")` for CLI/batch (policy decision; not swapped to repo blindly).
- **Scripts** (`scripts/*`) — may use `readStore` / disk directly.

Naming cheat sheet: **website** observation runs = `ObservationRun` + `observation_runs` table / merged file sources; **Profound** “observation” rows = `ProfoundImportRun` in `observation-runs.json` via canonical-store; **visibility** runs = separate types + `visibility-observation-runs.json` (+ synthetic wrappers).

## Server/Client Boundary

- `seed-data.server.ts`: Server-only data layer, imports `json-store.ts`
- `seed-data.ts`: Pure data arrays, no Node.js dependencies
- Pages are server components that pass serialized props to client components

## Product Direction (2026-04-09)

### Positioning
Beacon is the AI visibility attribution and action system for high-value businesses. Premium pricing ($249–999+/month). NOT a budget monitoring dashboard.

### Target surfaces (navigation — shipped through Shell Phase F3 shell pass)
Primary: **Today**, **Pages**, **Changes**, **Competitors**, **Opportunities** (route: `/topics`)
Data: **Import**, **Review**, **History** (route: `/results`)
System: **Diagnostics**

**Related routes not in primary nav:** `/briefs/*`, `/results/[id]`, `/changes/[id]`, `/competitors/[id]`, `/topics/opportunity/[id]`, `/observations/[id]`, `/expansion` (**Expansion backlog** — quarantined speculative hypotheses, not primary nav).

### Presentation layer (Shell A–H + visual terminal pass)
Shell **Phases A–H shipped** (2026-04-10): design-system + nav/IA + Today (including **Follow-through** / watchlist) + **Pages** + **Changes** + **Competitors** + **Opportunities** (`/topics`) + **Review** + **Import** + **History** + **Diagnostics** + **`/expansion`** — without changing core intelligence or persistence.

**Visual terminal pass (2026-04-10):** Shared primitives under `src/components/viz/` (see Phase 31 below); major routes saturated with KPIs, toggles, and composition charts where data exists. **Swap architecture:** `chart-types.ts` + `src/lib/view-models/*` + `src/lib/data-adapters/*` (`getAdapters()` / `createProfoundAdapters()`) so chart libraries and data backends can change without rewriting domain logic. Further polish is normal roadmap work.

### Build sequence
Phases 14–16: Internal daily tool (surface compression, visibility story, import simplification)
Phases 17–18: Premium product surfaces (page intelligence, competitive clarity)
Phase 19: Daily habit loop (email briefing)
Phases 20–22: External product (auth, billing, polish, agency/multi-tenant)

See `master_execution_plan.md` for full roadmap details, including **Master UI/UX product shell overhaul — PLANNED**.

---

## Intelligence Expansion Data Models (Phase 24+)

### New Domain Stores

| Store / Table | Domain | Type | Key Fields | Persisted In | Written By | Read By |
|---------------|--------|------|------------|-------------|-----------|---------|
| `answer_snapshots` | answer-snapshots | Captured | id, prompt_id, prompt_text, platform, model, answer_text, citations (JSONB), entities_mentioned (JSONB), sampled_at, run_id, source_system | `.data/answer-snapshots.json` + Supabase `answer_snapshots` | `scripts/sample-visibility.ts`, `lib/querying/perplexity-client.ts` | Genealogy, discrepancy, entity extraction, per-model analysis |
| `prompt_library` | prompts | Managed | id, prompt_text, topic, city, service_type, journey_stage, source (profound/mined/manual), is_active, created_at | `.data/prompt-library.json` + Supabase `prompt_library` | Prompt library init, prompt miner | Sampling runner, journey analysis, coverage computation |
| `co_mention_matrix` | competitors | Computed | domain_a, domain_b, co_occurrence_count, topics (JSONB), platforms (JSONB), last_computed | `.data/co-mention-matrix.json` | `competitors/co-mention.ts` | Competitors page, battlecard engine |
| `outcome_store` | product | Unified | outcome_id, action_type, action_detail, rec_id, experiment_id, target_page, target_topic, started_at, resolved_at, verdict, citation_delta, confidence, source_signal_tier | `.data/outcome-store.json` + Supabase `outcomes` | Outcome logger (on rec response, experiment change, scorecard verdict) | Priority engine, what-if simulator, Beacon Score, track record |
| `genealogy_evidence` | attribution | Computed | id, citation_url, answer_snapshot_id, matched_page_url, matched_content_segment, match_type (exact/paraphrase/topical/unknown), confidence, computed_at | `.data/genealogy-evidence.json` | `attribution/citation-genealogy.ts` | Pages detail, diagnostics |
| `trust_index` | competitors | Computed | source_domain, platform, citation_count, trust_score, topic_coverage (JSONB), last_computed | `.data/trust-index.json` | `competitors/source-trust.ts` | Competitors page, recommendation engine |
| `citation_decay` | attribution | Computed | page_url, topic, freshness_score, decay_rate, last_citation_date, citation_trajectory (JSONB), alert_level | `.data/citation-decay.json` | `attribution/citation-decay.ts` | Today alerts, Pages warnings, recommendation engine |
| `business_truth` | entity | Configured | key, value, category (name/address/phone/hours/services/credentials/people), verified_at | `.data/business-truth.json` | Operator configuration (server action) | Discrepancy engine, entity resolution, founder tracking |
| `entity_store` | entity | Computed | id, entity_name, entity_type (business/person/location/service), canonical_form, variants (JSONB), sources (JSONB), consistency_score | `.data/entity-store.json` | `entity/entity-store.ts` | Discrepancy engine, founder tracking, pages |
| `geographic_coverage` | geography | Computed | city_normalized, state, metro, citation_count, platform_coverage (JSONB), service_pages (JSONB), gap_flag | `.data/geographic-coverage.json` | `geography/geographic-coverage.ts` | Opportunities, Today |
| `beacon_score` | product | Computed | computed_at, composite_score, dimensions (JSONB: citation_coverage, platform_breadth, content_readiness, competitive_position, evidence_quality, outcome_track_record), data_points_per_dimension | `.data/beacon-score.json` | `product/beacon-score.ts` | Today hero metric |
| `notifications` | product | Managed | id, type, title, body, severity, read, created_at, related_entity_id | `.data/notifications.json` | Computation triggers (decay, spike, competitor, experiment) | Today notification badge |

### How New Stores Connect to Existing Domains

```
Results (imported) ─────────────────────┐
  │                                     │
  ├─ answer_snapshots (native capture)  │
  │   ├─ genealogy_evidence             │
  │   ├─ entity_store                   │
  │   └─ discrepancy detection          │
  │                                     │
  ├─ citation-by-date (cold store) ─────┤
  │   ├─ co_mention_matrix              │
  │   ├─ trust_index                    │
  │   ├─ citation_decay                 │
  │   └─ geographic_coverage            │
  │                                     │
Pages (snapshots) ──────────────────────┤
  │   ├─ genealogy (content matching)   │
  │   ├─ llms.txt generation            │
  │   └─ visual readiness               │
  │                                     │
Changes (scorecard) ────────────────────┤
  │   └─ outcome_store (verdicts)       │
  │                                     │
Recommendations ────────────────────────┤
  │   └─ outcome_store (responses)      │
  │                                     │
Experiments ────────────────────────────┘
      └─ outcome_store (experiment outcomes)
```

### Persistence Pattern for New Stores

All new stores follow the established persistence pattern:

1. **File-first write** via `json-store.ts` (`.data/{name}.json`)
2. **Dual-write to Supabase** when `DUAL_WRITE=true` (best-effort)
3. **Read via `SeedDataRepository`** — `DATA_SOURCE` env var switches backend
4. **Rollback** by setting `DATA_SOURCE=file`

Computed stores (co-mention, trust, decay, genealogy, geographic, beacon score) are **recomputable** — they can be regenerated from source data at any time. Persistence is for caching, not durability.

Managed stores (prompt library, business truth, notifications) are **operator-owned** — they contain configuration and must be durable.

### Native Querying Architecture

```
Prompt Library ──→ Sampling Runner (script) ──→ AI Platform API
                                                    │
                                            Answer + Citations
                                                    │
                                            answer_snapshots store
                                                    │
                              ┌──────────────┬──────┴───────┬────────────┐
                              │              │              │            │
                        genealogy_evidence  entity_store  co_mention  trust_index
                              │              │              │            │
                              └──────────────┴──────────────┴────────────┘
                                                    │
                                           Recommendation Engine
                                           Priority Engine
                                           Today / Pages / Competitors
```

**API client pattern:** Each AI platform has a dedicated client module in `src/lib/querying/`. All clients implement a shared `QueryClient` interface: `sample(prompt: string): Promise<AnswerSnapshot>`. The sampling runner iterates the prompt library, calls the active client(s), and stores results.

**Rate limiting:** Configurable concurrency and delay per client. Defaults: 2 concurrent, 1000ms delay between calls. Budget cap per run (max N calls per script execution).

**Source system tagging:** All native data carries `source_system: "beacon_native"` on derived Result rows and `sampled_by: "beacon"` on answer snapshots. This enables clean filtering at every computation boundary.

### Phase 25 — Attribution Intelligence Modules

**Citation Genealogy** (`src/domains/attribution/citation-genealogy.ts`)
Traces likely source ancestry of owned AI citations by matching citation URLs against owned page snapshots. Uses URL exact match, path match, title/heading/FAQ token overlap. Produces `GenealogyMatch` entries with confidence tiers (high/medium/low/unknown). Stage 1 uses page snapshot metadata only — no full body text matching. Does not attempt competitor-content genealogy.

**Citation Decay** (`src/domains/attribution/citation-decay.ts`)
Detects citation freshness decline from citation cold store date shards. Splits observation range into two halves, compares owned citation counts per page URL. Status: `stable` / `soft_decline` / `meaningful_decline` / `insufficient_history`. Configurable thresholds via `DecayConfig`. Feeds recommendation engine (`refresh_stale_citation`) and Today intelligence (decay alert in next-move candidates).

**Source Trust Index** (`src/domains/competitors/source-trust.ts`)
Per-platform domain citation frequency from citation cold store. Ranks most-cited sources per platform with owned rank/share. Exposed as progressive disclosure on Competitors page. Labeling is conservative: "frequently cited by" — not "trusted by." Dependent on prompt-answer-observation platform joins.

**Recommendation extension:** `refresh_stale_citation` type added to recommendation engine. Only fires on meaningful decline (≥30% drop) with ≥3 recent citations. Maximum 2 per computation. Anti-spam: skips pages with existing recs, caps confidence at "medium."

### Phase 26 — Entity + Representation Intelligence

**Entity Foundation** (`src/domains/entity/`)
Lightweight entity extraction from three existing sources: site config (brand name), page snapshots (location_terms, service_terms), and prompt-answer-observation mentions (brand entities from AI answers). Produces an `EntityIndex` with deduplicated `BeaconEntity` entries typed as brand/person/location/service. Frequency-counted and source-tagged. No knowledge graph, no cross-platform stitching — designed as the extensible base for EntityForge.

**AI Says vs Reality** (`src/domains/entity/discrepancy-detect.ts`)
Conservative discrepancy detection comparing AI answer content against owned entity data. Four detection types: location not in owned data, service not in owned data, brand omission, competitor overrepresentation. Requires minimum 20 answers before analysis runs. Language rules enforced: "possible discrepancy" / "may be missing" — never "wrong" or "hallucinated." Surfaced in Diagnostics (full view) and Today (notable only, as next-move candidate). Uses cold store answer texts (9,596 Profound entries) for content scanning.

### Phase 27 — Geographic Intelligence

**Geographic Normalization** (`src/domains/geo/normalize.ts`)
Deterministic city normalization for ~50 Bay Area cities. Maps raw location strings to canonical city names, assigns metro/sub-region (peninsula, south bay, east bay, etc.), labels confidence. Filters region-level terms (bay area, silicon valley) from city-level analysis. Designed for extensibility to other metros.

**Local Coverage + Gaps** (`src/domains/geo/coverage.ts`)
Per-city visibility analysis from page registry + citation rollups + prompt library. Computes owned/competitor page and citation counts, market share, and coverage status (strong/moderate/weak/absent). Concentration assessment via HHI index (healthy/concentrated/highly_concentrated). Gap detection identifies markets with competitor presence and limited owned visibility. `computeGeoHeatMap()` produces the data shape for future heat map visualization.

Surfaced in: Today (gap next-move candidate), Competitors (local pressure disclosure), Diagnostics (full coverage table + concentration + gaps).

### Phase 28 — Journey + Score + Extractability

**Journey Coverage** (`src/domains/prompts/journey-coverage.ts`)
Stage-aware prompt distribution analysis using the existing `JourneyStage` classification. Computes per-stage coverage (strong/moderate/weak/absent), identifies gaps in core stages (awareness/consideration/comparison/decision), warns on concentration. Surfaced in Diagnostics (stat cards + missing stage warnings) and Today (absent stage next-move candidate).

**Beacon Score** (`src/domains/product/beacon-score.ts`)
Multi-dimensional visibility health: 6 dimensions computed independently. Each dimension has explicit `DimensionStatus` (sufficient/partial/insufficient). Composite only produced when ≥4 dimensions are sufficient. Dimensions: visibility strength (log-scaled citations), coverage breadth (topics × cities × stages), consistency (decay rate), competitive position (owned share), representation quality (discrepancy count), local strength (geo presence). The score never lies — reports "unavailable" when data is insufficient.

**Content Extractability** (`src/domains/pages/extractability.ts`)
Per-page AI-readiness analysis: 6 weighted factors (FAQ, schema, H2 structure, meta description, word count, direct answers). Pages graded good/fair/needs_work/poor. Priority-sorted by citation count × gap size. Includes `generateLlmsTxtDraft()` for draft llms.txt content from snapshot data. Surfaced in Diagnostics (aggregate + per-page disclosure).

### Phase 29 — Competitive Intelligence

**Competitive Battlecards** (`src/domains/competitors/battlecards.ts`)
Structured multi-dimensional comparison objects for top competitors. 5 dimensions: citation share (head-to-head), topic pressure (topics where competitor leads), co-mention frequency (from co-mention matrix), geographic presence (shared geo gaps), platform reliance (from source trust). Overall threat rated high/moderate/low. Max 8 cards, requires ≥10 citations. Surfaced on Competitors page as progressive disclosure with expandable per-competitor dimension bars.

**Snippet Intelligence** (`src/domains/competitors/snippet-intel.ts`)
Safe extractability comparison using owned page analysis + competitive citation context. 4 signal types: owned extractable patterns (pages with good structure that earn citations), extractability gaps (high-citation pages with poor structure), competitor citation context (topics where competitors dominate), strengthening opportunities (specific structural improvements). All signals labeled "grounded" or "inferred." Surfaced in Diagnostics (separate grounded/inferred disclosures) and Today (high-priority gaps only).

### Phase 30 — Advanced Intelligence Scaffolds

These are **foundations only** — not active features unless data supports them.

**Adversarial Stress** (`src/domains/prompts/adversarial.ts`) — Template system for brand defense testing. 6 categories, 10 seeded templates. Readiness assessment checks library + answer state. No testing has occurred — scaffold for native querying integration.

**What-If Simulator** (`src/domains/product/whatif-engine.ts`) — Maps 9 action types to outcome records. Requires ≥5 historical outcomes per action type for directional assessment. Reports "insufficient data" when evidence is thin. No fake forecasts.

**Founder Authority** (`src/domains/entity/founder-authority.ts`) — Optional person-entity tracking via `BEACON_FOUNDER_NAMES` env var. Checks PAO mentions. Four status levels: not_configured → configured_not_observed → observed_lightly → observed_repeatedly.

**Conversion Path** (`src/domains/product/conversion-path.ts`) — Placeholder for prompt → answer → citation → visit → conversion chain. Currently can observe steps 1-3. Steps 4-5 require external analytics integration.

**Training Data Pipeline** (`src/domains/product/training-data.ts`) — Assesses 6 content visibility channels (website pages, structured data, llms.txt, sitemap, social profiles, directory listings). Reports active/partial/missing/unknown per channel.

All surfaced in Diagnostics "Advanced intelligence readiness" section — calm, status-labeled, no fake readiness claims.

### Phase 31 — Visual Intelligence Layer

**Visual primitives** (`src/components/viz/`) — **19 React components** (`.tsx`) **plus** `chart-types.ts` (shared TypeScript prop contracts, no UI). All chart-style components are `"use client"`, Beacon tokens, inline SVG/CSS (no external chart library dependency in-tree).

| Component | Purpose | Interaction |
|-----------|---------|-------------|
| `AreaChart` | Multi-series / stacked area | Grid, hover readout |
| `Sparkline` | Compact trend line | Optional tooltip |
| `MiniBarChart` | Horizontal labeled bars | Hover expand + metadata |
| `DonutRing` | Proportional ring segments | Hover segment highlight |
| `HeatGrid` | Matrix of values | Hover cell highlight |
| `ScoreRail` | Multi-dimension score bars | Per-segment hover; insufficient-data patterns |
| `StackedBar` | Stacked proportional segments | Hover segment + % |
| `RankLadder` | Ranked list with proportional bars | Expand/collapse list |
| `DeltaStrip` | Before→after delta rows | Color-coded deltas |
| `PlatformSplit` | Platform strip + legend | Hover focus |
| `CoverageTrellis` | Small-multiples grid | Status cells + hover |
| `ThreatMeter` | Segmented threat meter | Inline meter |
| `ConfidenceBadge` | Confidence / grounding pill | Static levels |
| `KpiCard` | KPI tile + optional sparkline/delta | Hover border |
| `ComparisonBar` | Owned vs competitor split bar | Hover + meta |
| `RadialScore` | Radar-style multi-axis score | Per-axis hover |
| `ViewToggle` | Pill tablist for modes | Keyboard-friendly tabs |
| `FilterChips` | Toggleable filter row | Single or multi-select |
| `VizSection` / `ChartTableSection` | Section chrome + chart/table toggle | Collapsible / mode switch |

**Design rules:** `cn()` for classes; empty or zero-total data returns `null` where appropriate; no fabricated series.

**Pulse System** (`src/domains/product/pulse.ts`)
Aggregates signals from decay, discrepancy, geo, journey, extractability, and sampling freshness into a deduplicated, severity-sorted event list. 3 severity levels (high/medium/info). Surfaced as a compact banner on Diagnostics.

**Report Generator** (`src/domains/product/report-generator.ts`)
Structured report objects for visibility snapshots and competitive overviews. JSON-serializable. No marketing PDFs — clean data payloads.

### Abstraction Layers — Visual + Data Swappability

**Three-layer architecture:**

```
  Data Adapters          View Models           Chart Components
  ┌─────────────┐       ┌──────────────┐      ┌──────────────┐
  │ Profound     │──────▶│ visibility   │─────▶│ KpiCard      │
  │ (current)    │       │ score        │      │ AreaChart    │
  │              │       │ geo          │      │ RadialScore  │
  │ Native       │       │ journey      │      │ DonutRing    │
  │ (future)     │──────▶│ competitors  │─────▶│ MiniBarChart │
  └─────────────┘       └──────────────┘      │ etc.         │
                                               └──────────────┘
```

**Data Adapters** (`src/lib/data-adapters/`)
Interface per domain: `VisibilityAdapter`, `GeoAdapter`, `JourneyAdapter`, `ScoreAdapter`, `CompetitiveAdapter`, `EntityAdapter`, `AttributionAdapter`, `OutcomeAdapter`, `SnippetAdapter`, `PulseAdapter`. Bundled as `BeaconDataAdapters`. Current implementation: `profound-adapter.ts`. Swap point: `index.ts` → change import.

**View Models** (`src/lib/view-models/`)
Pure functions: domain data → chart-ready props conforming to `chart-types.ts`. 5 domain modules: visibility, score, geo, journey, competitors. Routes call view-model functions with adapter outputs. Charts receive clean props. No business logic crosses this boundary.

**Chart Prop Interfaces** (`src/components/viz/chart-types.ts`)
Canonical interfaces for all chart types. Any implementation (current inline SVG, future Visx/Recharts/D3) must conform to these shapes. Consumers never depend on implementation details.
