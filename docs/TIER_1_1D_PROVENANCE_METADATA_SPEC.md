# Provenance Metadata Spec — Tier 1.1d

> **PURPOSE:** Defines the minimum provenance / lineage metadata Beacon needs so proof surfaces, scope notes, denominators, and "How we know this" UI can be grounded in explicit fields, not implied context.
>
> **Grounded in:** `TIER_1_1A_SIGNAL_TAXONOMY.md` (Signal Provenance Map), `TIER_1_1C_METHODOLOGY_SHELL_IA.md` (data dependencies table, §9).
>
> **NOT FOR:** Implementation code (→ 1.1f), UI wiring (→ 1.1g), prompt-bank governance (→ 1.1d per master plan), stale/partial escalation rules (→ 1.1i).

**Produced:** 2026-04-12

---

## 1. Purpose

### What provenance metadata is for

Provenance metadata answers: "Where did this number come from, how fresh is it, and how much data is behind it?" It lets proof-layer UI surfaces (denominator lines, scope notes, methodology panels, freshness strips) render grounded, dynamic text instead of hardcoded copy.

### What this spec enables in-product

- **Denominator disclosure** (1.1c Layer 1): "18% of 1,179 observations" — requires `denominator_value` and `denominator_label` to be available at the component level.
- **Scope notes** (1.1c Layer 1): "Based on N attribution matches across M changes" — requires `match_count`, `topic_count` to exist on scorecard-level payloads.
- **Sample quality indicators** (1.1c §6): "Small sample — treat as early signal" — requires `sample_size` with computable thresholds.
- **Methodology destination** (1.1c §7, section 2 "Your data"): dynamic section showing sample size, source, universe, last crawl, coverage tone — requires provenance fields to be queryable in one place.
- **Freshness/staleness escalation** (1.1c §6): stale warnings on Market and Changes — requires `computed_at` or `built_at` to propagate beyond Today.

### What this spec is NOT trying to do

- Build a full lineage graph or DAG
- Add database migrations or Supabase schema changes
- Create a versioned audit trail
- Implement any UI changes
- Solve prompt-bank governance or sample representativeness

---

## 2. Design Principles

1. **Minimum viable lineage.** Add the fewest fields that unblock the most proof surfaces. Every field must serve at least one concrete UI need from 1.1c.
2. **No fake precision.** Don't add fields that imply a precision the data doesn't support. A `sample_quality_tier` derived from row count + thresholds is acceptable. A `statistical_confidence_interval` is not — Beacon has no statistical model to back it.
3. **Source before score.** Provenance should describe where data came from (source system, import batch, observation window) before describing how confident the system is. Confidence is an interpretation of provenance, not a substitute.
4. **Support progressive disclosure.** Some provenance fields are shown inline (denominators). Others are shown in collapsed panels (scope notes). Others appear only in the methodology destination (full provenance chain). The field set must support all three layers without requiring different schemas.
5. **Preserve current behavior until implemented.** Every proposed field either already exists (reuse it), is derivable from existing data (compute it), or is additive (add it later without breaking anything). No field requires removing existing behavior.

---

## 3. Provenance Field Inventory

### Core provenance fields

| # | Field name | Type | Meaning | Example | Signal classes | Status |
|---|-----------|------|---------|---------|----------------|--------|
| 1 | `source_system` | `string \| null` | External tool that produced the source data | `"profound"` | 3 (Imported visibility), 4 (Citation index) | **Exists** on `Result.source_system` (optional). Missing on citation index, benchmark, recommendations |
| 2 | `observed_at` | `string` (ISO) | When the underlying observation was made | `"2026-03-15T00:00:00Z"` | 3, 4, 5, 7, 8, 12 | **Exists** on `Result.snapshot_date` / `observed_at`. Missing as a propagated field on aggregates |
| 3 | `computed_at` | `string` (ISO) | When Beacon computed this derived signal | `"2026-04-12T10:30:00Z"` | 5, 6, 7, 8, 9, 10, 11, 12 | **Partially exists**: `MarketBenchmark.createdAt`, `CoMentionMatrix.computed_at`, `SourceTrustIndex.computed_at`. Missing on recommendations, scorecard, attribution |
| 4 | `sample_size` | `number` | Count of input observations behind this signal | `1179` | 3, 4, 5, 7, 8, 9, 10, 12 | **Partially exists**: `resultsRowCount` (proof context), `trackedCitationObservations` (benchmark), `total_answers_analyzed` (co-mention), `total_citations_analyzed` (source trust), `total_answers_checked` (entity). Missing on attribution, scorecard, recommendations |
| 5 | `sample_quality_tier` | `"small" \| "adequate" \| "robust"` | Interpreted quality of sample size | `"robust"` | 3, 4, 7 | **Missing** — derivable from `sample_size` + thresholds (1.1c §6: <200 small, 200–1000 adequate, >1000 robust) |
| 6 | `denominator_value` | `number` | The divisor behind a percentage metric | `1179` | 4, 7, 8, 9 | **Partially exists**: `trackedCitationObservations` serves this for Market. Missing as a named field on co-mention %, topic share %, geo coverage % |
| 7 | `denominator_label` | `string` | Human-readable label for the denominator | `"tracked observations"` | 4, 7, 8, 9 | **Missing** — currently hardcoded in UI copy. Should be a computable string or static map |
| 8 | `scope_note` | `string` | One-line scope qualifier for a section | `"Directional — based on your tracked prompt sample"` | 7, 8, 9 | **Missing** — currently hardcoded in 1.1e changes. Should be derivable or static per signal class |
| 9 | `run_id` | `string \| null` | Unique identifier for the computation run | `"scan-1712930000000"` | 1, 2, 3, 13 | **Exists** on findings (`scanRunId`), scan state, some results (`visibility_observation_run_id`). Missing on attribution, scorecard, benchmark |
| 10 | `import_batch_id` | `string \| null` | Identifier for the import batch that sourced the data | `"import-2026-03-15"` | 3, 4 | **Exists** on `Result.import_batch_id` (optional). Missing on citation index |
| 11 | `window_start` | `string \| null` (ISO) | Start of the observation window | `"2026-01-01T00:00:00Z"` | 3, 4, 5, 7, 8, 11 | **Missing** — derivable from `min(observed_at)` across result rows |
| 12 | `window_end` | `string \| null` (ISO) | End of the observation window | `"2026-03-31T00:00:00Z"` | 3, 4, 5, 7, 8, 11 | **Partially exists** as `resultsThrough` on proof context. Missing as a named field on aggregates |

### Attribution / impact provenance fields

| # | Field name | Type | Meaning | Example | Signal classes | Status |
|---|-----------|------|---------|---------|----------------|--------|
| 13 | `match_count` | `number` | Count of attribution matches behind a scorecard or verdict | `12` | 5, 6 | **Missing** — derivable from `eventAttributions.length` on `ScorecardRow` |
| 14 | `topic_count` | `number` | Count of distinct topics involved | `5` | 5, 6, 7, 8 | **Missing** — derivable from `ScorecardRow.topics.length`, `benchmark.strongestAreas.length`, etc. |
| 15 | `platform_count` | `number` | Count of distinct platforms involved | `3` | 5, 6, 7, 8 | **Missing** — derivable from `ScorecardRow.platforms.length` |
| 16 | `confidence_basis` | `string` | What the confidence label is based on | `"12 matches across 3 platforms, 5 topics"` | 5, 10 | **Missing** — should be a computed summary string for tooltip/disclosure |
| 17 | `evidence_basis` | `string` | What evidence tier is based on | `"Exact URL match in registry + temporal alignment"` | 5, 6 | **Partially exists** as `TIER_LABELS` in changes detail. Missing as a per-row computed field |

### Coverage / freshness provenance fields

| # | Field name | Type | Meaning | Example | Signal classes | Status |
|---|-----------|------|---------|---------|----------------|--------|
| 18 | `coverage_state` | `CoverageTone` | Current data coverage classification | `"ok"` | 13 | **Exists** — `deriveCoverageTone()` in `today-proof-context.ts` |
| 19 | `coverage_note` | `string` | Human-readable coverage explanation | `"Crawl completed 2 days ago; visibility sample through Mar 31"` | 13 | **Partially exists** — constructed inline in `TodayVisibilitySnapshot`. Not a standalone computed field |
| 20 | `freshness_basis` | `string` | What the freshness assessment is based on | `"Last crawl: 2d ago. Last import: 5d ago."` | 13 | **Missing** — derivable from `DataFreshnessStrip` props but not available as a standalone string |
| 21 | `lineage_summary` | `string` | End-to-end provenance chain in one line | `"Profound import → citation index → market benchmark"` | 4, 7, 10 | **Missing** — aspirational; useful for methodology destination but not required for v1 |

---

## 4. Signal-Class Mapping

For each of the 14 signal classes, the minimum provenance payload needed for Tier-1 proof surfaces.

### 1. Crawl Findings

| Requirement | Field(s) | Status |
|------------|----------|--------|
| **Minimum required** | `run_id` (`scanRunId`), `observed_at` (`detectedAt`), `computed_at` (implicit — same as `detectedAt`) | ✓ Exists |
| **Optional later** | `scope_note` ("Compared consecutive HTML snapshots"), `lineage_summary` | Static today |
| **Current gap** | No link to the observation run on findings where `scanRunId` exists but the crawl's `observationRunId` is separate | Low priority |

### 2. Guardrail Alerts

| Requirement | Field(s) | Status |
|------------|----------|--------|
| **Minimum required** | `observed_at` (via `snapshot.fetched_at`), `run_id` (via `snapshot.observation_run_id` — optional) | Partial |
| **Optional later** | `scope_note` (guardrail basis) | Static today |
| **Current gap** | `observation_run_id` is optional on `PageSnapshot` — some guardrail alerts lack a run id | Low priority |

### 3. Imported Visibility (Results)

| Requirement | Field(s) | Status |
|------------|----------|--------|
| **Minimum required** | `source_system`, `observed_at` (`snapshot_date`), `import_batch_id`, `sample_size` (`resultsRowCount`), `window_end` (`resultsThrough`) | ✓ Exists (all available via `TodayProofContext` or `Result` fields) |
| **Optional later** | `window_start` (derivable from `min(snapshot_date)`), `sample_quality_tier`, `run_id` (`visibility_observation_run_id`) | Derivable / Missing |
| **Current gap** | `visibility_observation_run_id` often null for legacy imports. `window_start` not computed | Medium — v1 can use `resultsThrough` as "through" without start |

### 4. Citation Evidence Index

| Requirement | Field(s) | Status |
|------------|----------|--------|
| **Minimum required** | `computed_at` (`built_at`), `sample_size` (`total_citations_processed`) | ✓ Exists |
| **Optional later** | `import_batch_id` (link to source import), `source_system`, `window_start` / `window_end` | Missing |
| **Current gap** | No link from citation index to the import batch that produced it | Medium — useful for "Your data" methodology section |

### 5. Attribution Scoring

| Requirement | Field(s) | Status |
|------------|----------|--------|
| **Minimum required** | `computed_at` (`created_at` on `CandidateLink`), `match_count` (derivable from `eventAttributions.length`), `topic_count` (derivable), `platform_count` (derivable) | Partially derivable |
| **Optional later** | `sample_size` (how many result rows were scanned for attribution), `confidence_basis` (summary string), `run_id` | Missing |
| **Current gap** | No aggregate provenance on the scorecard as a whole — each `EventAttribution` has provenance but the scorecard doesn't summarize | **High priority** — needed for Changes scope line |

### 6. Change Verdicts & Impact

| Requirement | Field(s) | Status |
|------------|----------|--------|
| **Minimum required** | `match_count` (`totalEventsLinked` — exists), `evidence_basis` (partially via `TIER_LABELS`), `confidence_basis` | Partial |
| **Optional later** | `computed_at` (when verdict was assessed), `run_id` | Missing |
| **Current gap** | Verdict assessment has no timestamp of its own — it's computed on demand. `confidence_basis` not available as a field | Medium |

### 7. Market Benchmark

| Requirement | Field(s) | Status |
|------------|----------|--------|
| **Minimum required** | `computed_at` (`createdAt`), `sample_size` (`trackedCitationObservations`), `denominator_value` (= `trackedCitationObservations`), `sample_quality_tier` (derivable) | ✓ Exists / Derivable |
| **Optional later** | `window_start` / `window_end`, `source_system`, `scope_note`, `topic_count` (derivable from topic arrays) | Derivable / Missing |
| **Current gap** | `sample_quality_tier` not computed. `topic_count` derivable but not propagated. `scope_note` is static copy (1.1e) | **High priority** — main consumer of denominator disclosure |

### 8. Competitor Intelligence

| Requirement | Field(s) | Status |
|------------|----------|--------|
| **Minimum required** | `computed_at`, `sample_size` (`total_answers_analyzed` on co-mention, `total_citations_analyzed` on source trust) | ✓ Exists |
| **Optional later** | `denominator_value` per section, `topic_count`, `platform_count` | Derivable |
| **Current gap** | Battlecard index lacks `computed_at` and `total_comparisons`. Discovery has `totalDomainsAnalyzed` (good) | Low priority |

### 9. Geo Coverage

| Requirement | Field(s) | Status |
|------------|----------|--------|
| **Minimum required** | `computed_at`, `sample_size` (number of prompts/cities analyzed) | Partial (`computed_at` exists) |
| **Optional later** | `scope_note` (prompt-based, not demand-based), `denominator_value` | Missing |
| **Current gap** | No `sample_size` or prompt count on `GeoCoverageIndex`. No demand-data caveat field | Low priority |

### 10. Recommendations

| Requirement | Field(s) | Status |
|------------|----------|--------|
| **Minimum required** | `confidence_basis` (what "Strong evidence" means for this specific recommendation) | Missing |
| **Optional later** | `computed_at`, `source_system`, `match_count` (number of supporting changes/patterns), `evidence_basis` | Missing |
| **Current gap** | `BeaconRecommendation` has no provenance fields at all — `sourceEvidence` is a narrative string, not structured provenance. `confidence` is the only quality signal | **High priority** — needed for Today primary action evidence-quality framing |

### 11. Milestones

| Requirement | Field(s) | Status |
|------------|----------|--------|
| **Minimum required** | `observed_at` (`achievedAt`), `evidence_basis` (`proofSummary` — exists) | ✓ Exists |
| **Optional later** | `sample_size`, `window_start` / `window_end`, `source_system` | Missing |
| **Current gap** | No link to the specific result rows that produced the peak. `proofSummary` compensates well | Low priority |

### 12. Entity Discrepancies

| Requirement | Field(s) | Status |
|------------|----------|--------|
| **Minimum required** | `computed_at`, `sample_size` (`total_answers_checked`) | ✓ Exists |
| **Optional later** | `window_start` / `window_end`, `source_system` | Missing |
| **Current gap** | No link to observation dates (which import batch produced the answers?) | Low priority |

### 13. Coverage & Freshness

| Requirement | Field(s) | Status |
|------------|----------|--------|
| **Minimum required** | All fields | ✓ **Exists** — `TodayProofContext` is the most complete provenance payload in the system |
| **Optional later** | `freshness_basis` as a standalone string | Derivable |
| **Current gap** | None significant. Well-covered | — |

### 14. Local Operator Signals

| Requirement | Field(s) | Status |
|------------|----------|--------|
| **Minimum required** | `observed_at` (import timestamps), `coverage_state` (via `stalenessNote`), `evidence_basis` (`dataSourceNote`) | ✓ Exists |
| **Optional later** | `sample_size`, `source_system` | Missing |
| **Current gap** | Import-dependent — when no import exists, provenance fields are empty but `LocalProof.dataGaps` handles this well | Low priority |

---

## 5. Surface-Driven Requirements

Mapping provenance fields to the actual UI needs defined in 1.1c.

### Today — Primary Action Card

| IA layer | What's needed | Provenance field(s) | Status |
|----------|--------------|--------------------|----|
| L1 inline | "Strong evidence" label | `confidence` (exists) | ✓ Done (1.1e) |
| L1 inline | Evidence-quality qualifier after label | **`confidence_basis`** | **Missing** — needed for "· 12 matches across 3 platforms" |
| L2 local | Basis bullets | `lineageBullets` (exists) | ✓ Exists |
| L2 local | Data freshness | `dataFreshness` (exists) | ✓ Exists |

**Minimum provenance for this surface:** Add `confidence_basis` to `TodayPrimaryAction` (or compute inline from recommendation provenance).

### Today — HowWeKnowPanel / Visibility Snapshot

| IA layer | What's needed | Provenance field(s) | Status |
|----------|--------------|--------------------|----|
| L1 inline | Row count, sample date, crawl date | `resultsRowCount`, `resultsThrough`, `crawlCompletedAt` | ✓ Exists |
| L2 local | Methodology text | `BEACON_METHODOLOGY` static copy | ✓ Exists |
| L1 inline | Coverage tone + warning | `coverage_state`, `visibilityStaleVsCrawl` | ✓ Exists |

**Minimum provenance for this surface:** Already well-served by `TodayProofContext`. No new fields required.

### Changes — List / Scorecard

| IA layer | What's needed | Provenance field(s) | Status |
|----------|--------------|--------------------|----|
| L1 inline | Scope line: "N matches across M changes" | **`match_count`**, **`topic_count`** (aggregated across scorecard) | **Missing** — derivable |
| L2 local | Methodology disclosure block | Static copy | Not yet wired |
| L1 inline | Per-row trust labels | `trustSource`, `evidenceTier` | ✓ Exists |

**Minimum provenance for this surface:** Compute `match_count` (sum of `totalEventsLinked` across rows) and `topic_count` (union of `topics` across rows) at the scorecard level.

### Changes — Detail

| IA layer | What's needed | Provenance field(s) | Status |
|----------|--------------|--------------------|----|
| L1 inline | "Strongest correlate" + explanation | `confidence` (exists), **`confidence_basis`** | **Partially exists** — `explanation` prop available on `ConfidenceBadge` but not populated with structured provenance |
| L1 inline | Evidence tier label | `evidenceTier` + `TIER_LABELS` | ✓ Exists |
| L1 inline | Impact confidence | `impact.confidence` | ✓ Done (1.1e) |

**Minimum provenance for this surface:** Populate `confidence_basis` or wire `explanation` prop on `ConfidenceBadge` from match metadata.

### Market — KPI Strip + Scope Line

| IA layer | What's needed | Provenance field(s) | Status |
|----------|--------------|--------------------|----|
| L1 inline | "X% of N observations" | `denominator_value` (= `trackedCitationObservations`) | ✓ Done (1.1e) |
| L1 inline | Directional scope line | `scope_note` | ✓ Done (1.1e — static) |
| L1 inline | "of N tracked competitors" | `topCompetitors.length` | ✓ Done (1.1e) |
| L1 conditional | "Small sample" warning | **`sample_quality_tier`** | **Missing** — derivable |
| L2 local | Methodology disclosure | Static copy | Not yet wired |

**Minimum provenance for this surface:** Compute `sample_quality_tier` from `trackedCitationObservations` or `resultsRowCount`.

### Market — Co-mention / Source Trust Sections

| IA layer | What's needed | Provenance field(s) | Status |
|----------|--------------|--------------------|----|
| L1 inline | "in N sampled answers" | `total_answers_analyzed` | ✓ Exists |
| L1 inline | "Citation frequency, not preference" | `scope_note` | Static — no field needed |

**Minimum provenance for this surface:** Already covered.

### Methodology Destination (`/settings/methodology`)

| Section | What's needed | Provenance field(s) | Status |
|---------|--------------|--------------------|----|
| "Your data" | Sample size, source, through date, universe size, coverage tone | `resultsRowCount`, `source_system`, `resultsThrough`, competitor universe length, `coverage_state` | ✓ All exist / derivable |
| Per-metric sections | Signal-class methodology text | Static copy per class | Not yet written |
| "What Beacon does not claim" | Forbidden claims | Static from 1.1a | Not yet written |

**Minimum provenance for this surface:** Collect existing provenance fields into a single query. No new fields required — just surface aggregation.

---

## 6. Minimum v1 Implementation Slice

### Prioritized surfaces for first provenance wiring

| # | Surface | What to add | New fields needed | Priority |
|---|---------|-------------|-------------------|----------|
| 1 | **Market KPI strip** | `sample_quality_tier` conditional warning | Derive from `trackedCitationObservations` + thresholds | P1 |
| 2 | **Changes scorecard header** | Scope line: "N matches across M topics" | Derive `match_count` + `topic_count` from scorecard rows | P1 |
| 3 | **Changes detail — ConfidenceBadge** | Wire `explanation` prop with structured provenance | Derive `confidence_basis` from `EventAttribution` metadata | P1 |
| 4 | **Today primary action** | Add evidence detail after "Strong evidence" | Derive `confidence_basis` from recommendation source data | P2 |
| 5 | **Methodology destination** | "Your data" section with dynamic provenance | Aggregate existing fields into one view | P2 |

### Absolutely required v1 fields

These 3 fields are the minimum that must be computable (not necessarily persisted) for v1:

1. **`sample_quality_tier`** — derived from `resultsRowCount` or `trackedCitationObservations` using thresholds from 1.1c §6
2. **`match_count`** (scorecard-level) — derived from `sum(row.totalEventsLinked)` across scorecard rows
3. **`topic_count`** (scorecard-level) — derived from `union(row.topics)` across scorecard rows

### What can wait

- `window_start` / `window_end` on aggregates (useful but not required for any v1 UI surface)
- `lineage_summary` end-to-end chain (aspirational — methodology destination can use static copy)
- `source_system` propagation to citation index and benchmark (useful for "Your data" but derivable from import context)
- `confidence_basis` as a persisted field (can be computed at render time for v1)
- `run_id` on attribution and scorecard (no UI consumer in v1)

---

## 7. Current-State Gap Map

### Fields already present and reusable

| Field concept | Existing field | Where | Reusable as-is |
|--------------|---------------|-------|----------------|
| Source system | `Result.source_system` | `results/types.ts` | Yes — optional, available on imported rows |
| Observation timestamp | `Result.snapshot_date`, `Finding.detectedAt` | Multiple | Yes |
| Import batch | `Result.import_batch_id` | `results/types.ts` | Yes — optional |
| Sample size (results) | `resultsRowCount` | `TodayProofContext` | Yes |
| Sample size (citations) | `trackedCitationObservations` | `MarketBenchmark` | Yes |
| Sample size (co-mention) | `total_answers_analyzed` | `CoMentionMatrix` | Yes |
| Sample size (source trust) | `total_citations_analyzed` | `SourceTrustIndex` | Yes |
| Sample size (entity) | `total_answers_checked` | `DiscrepancyReport` | Yes |
| Computed-at (benchmark) | `createdAt` | `MarketBenchmark` | Yes |
| Computed-at (co-mention) | `computed_at` | `CoMentionMatrix` | Yes |
| Computed-at (source trust) | `computed_at` | `SourceTrustIndex` | Yes |
| Computed-at (citation index) | `built_at` | `CitationEvidenceIndex` | Yes |
| Scan run ID | `scanRunId` | `Finding` | Yes |
| Crawl age | `crawlAgeDays` | `TodayProofContext` | Yes |
| Coverage tone | `CoverageTone` | `today-proof-context.ts` | Yes |
| Window end | `resultsThrough` | `TodayProofContext` | Yes |
| Milestone evidence | `proofSummary` | `MilestoneEvent` | Yes |
| Local operator source | `dataSourceNote` | `LocalOperatorSurface` | Yes |
| Events linked count | `totalEventsLinked` | `ScorecardRow` | Yes |
| Evidence tier | `evidenceTier` | `ScorecardRow` | Yes |
| Trust source | `topTrust` / `trustSource` | `ScorecardRow`, `EventAttribution` | Yes |

### Fields derivable without schema changes

| Field concept | How to derive | Compute location |
|--------------|--------------|------------------|
| `sample_quality_tier` | `resultsRowCount < 200 ? "small" : resultsRowCount <= 1000 ? "adequate" : "robust"` | Inline in Market page or as utility function |
| `match_count` (scorecard) | `rows.reduce((sum, r) => sum + r.totalEventsLinked, 0)` | Changes list page |
| `topic_count` (scorecard) | `new Set(rows.flatMap(r => r.topics)).size` | Changes list page |
| `platform_count` (scorecard) | `new Set(rows.flatMap(r => r.platforms)).size` | Changes list page |
| `confidence_basis` (attribution) | `"${ea.length} matches across ${platforms.size} platforms, ${topics.size} topics"` | Changes detail page |
| `confidence_basis` (recommendation) | From `sourceEvidence` + `confidence` + `priority` | Today page |
| `window_start` | `min(results.map(r => r.snapshot_date))` | Import action or proof context builder |
| `coverage_note` | From `TodayProofContext` fields inline | Visibility snapshot component |
| `freshness_basis` | From `DataFreshnessStrip` props | Inline in shell or methodology destination |
| `topic_count` (benchmark) | `benchmark.strongestAreas.length + benchmark.weakestAreas.length + benchmark.biggestLosses.length` (deduplicated) | Market page |

### Fields that truly require schema / type additions

| Field concept | What's needed | Likely location | Priority |
|--------------|---------------|-----------------|----------|
| `confidence_basis` on `BeaconRecommendation` | Add `confidenceBasis?: string` to the type | `src/domains/product/recommendation-engine.ts` | P2 |
| `computed_at` on `BeaconRecommendation` | Add `computedAt?: string` to the type | Same | P3 |
| `import_batch_id` on `CitationEvidenceIndex` | Add `source_import_batch_id?: string` to the type | `src/domains/pages/types.ts` | P3 |
| `computed_at` on `ScorecardRow` (optional) | Add `computedAt?: string` if scorecard caching is added | `src/domains/attribution/scorecard.ts` | P3 — only if caching |

### Places where current wording outruns available provenance

| Surface | Current wording | Provenance gap |
|---------|----------------|----------------|
| Changes detail — ConfidenceBadge | "Strongest correlate" (1.1e) — with empty `explanation` prop | `confidence_basis` not computed or wired to `explanation` |
| Today primary action | "Strong evidence" — no detail on what evidence | `confidence_basis` not available on `TodayPrimaryAction` |
| Market KPI | "of N observations" (1.1e) — no "small sample" warning | `sample_quality_tier` not computed |
| Changes scorecard | No scope line at all yet | `match_count` + `topic_count` not computed at scorecard level |

---

## 8. Deferred / Out of Scope

| Item | Why deferred | When relevant |
|------|-------------|---------------|
| Full lineage UI (graph, trace, drill-down) | No v1 UI consumer; proof-layer needs are met by inline scope notes | Tier 2+ |
| Deep history / versioning of provenance | No operator use case yet; `.data` files are not versioned | Tier 3 |
| Prompt-bank governance | Separate concern (sample representativeness vs. provenance) | 1.1d per master plan, separate track |
| FAQ implementation | Methodology destination content is a separate task (1.1h) | 1.1h |
| Database migration / Supabase schema | No schema changes until dual-write parity confirms field utility | 1.1f implementation |
| `lineage_summary` end-to-end chain | Useful but can be static copy in v1; dynamic version needs all provenance fields wired | Tier 2 |
| `window_start` computation | Useful but `resultsThrough` (window end) is sufficient for v1 scope notes | 1.1f optional |
| Provenance on per-row basis (Pages, Changes) | Row-level trust labels already exist; per-row provenance would add density | Tier 2 |

---

## 9. Implementation Handoff Notes

### Likely files/types to be touched (1.1f)

| File | Change | Safe? |
|------|--------|-------|
| `src/domains/product/recommendation-engine.ts` | Add `confidenceBasis?: string` to `BeaconRecommendation`, compute during recommendation generation | Safe — additive optional field |
| `src/app/(shell)/changes/page.tsx` | Compute `match_count` + `topic_count` from scorecard rows; pass to scope-line component | Safe — computation only |
| `src/app/(shell)/changes/[id]/page.tsx` | Compute `confidence_basis` string from `EventAttribution` metadata; pass to `ConfidenceBadge` `explanation` prop | Safe — UI prop wiring |
| `src/app/(shell)/competitors/page.tsx` | Compute `sample_quality_tier`; conditionally render warning | Safe — additive UI |
| `src/components/today/today-primary-action.tsx` | Wire `confidenceReason` with structured basis (if field added to recommendation) | Safe — already has `confidenceReason` prop |
| `src/lib/today-proof-context.ts` | Potentially add `sampleQualityTier` to `TodayProofContext` if needed globally | Safe — additive |
| `src/domains/pages/types.ts` | Add `source_import_batch_id?: string` to `CitationEvidenceIndex` type | Safe — optional |

### Safe first targets

1. **Derivable fields first:** `sample_quality_tier`, `match_count`, `topic_count` — these require zero schema changes, just inline computation at the page level.
2. **Prop wiring second:** `confidence_basis` → `ConfidenceBadge.explanation` on Changes detail — the prop already exists, just needs a value.
3. **Type additions last:** `confidenceBasis` on `BeaconRecommendation` — only after the derived approach proves insufficient.

### Tests / guardrails for future implementation

- **Snapshot test:** Market smoke test should verify scope line text is present after wiring
- **Type safety:** All new optional fields must be `| null` or `?:` — never break existing callsites
- **Threshold test:** `sample_quality_tier` thresholds (200 / 1000) should be exported constants, not magic numbers, so they can be tested and tuned
- **No false precision:** Any `confidence_basis` string must avoid percentages or statistical language. Use counts and qualitative labels only
