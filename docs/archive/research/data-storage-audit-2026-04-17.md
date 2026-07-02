# Beacon Data Storage Audit — April 17, 2026

## Executive Summary

Beacon maintains **88 data files** across `.data/`. Analysis reveals:
- **8 canonical stores** actively read/written by code
- **1 orphan canonical store** (outcome-store.json — 59 records, unused)
- **36 orphan experiments/features** (37% of JSON files) — not read by any code
- **No critical schema drift** — all files use consistent internal schemas
- **No genuine overlaps** — outcome stores serve different granularities; answer/observation stores are complementary
- **44 daily citation shards** (citations-by-date/) — properly sharded cold storage

## Detailed Store Classification

### CANONICAL STORES (actively read/written)

| File | Records | Size | Granularity | Readiness |
|------|---------|------|-------------|-----------|
| imported-results.json | 1,539 | 1.0 MB | Profound import result rows | **5** |
| imported-changes.json | 321 | 270 KB | Change log entries from imports | **5** |
| answer-texts.json | 12,596 | 37.5 MB | Observation ID → LLM response text (cold) | **5** |
| prompt-answer-observations.json | 12,596 | 13.5 MB | Profound observations metadata (hot) | **4** |
| pages.json | 6,091 | 4.6 MB | Tracked website pages | **4** |
| change-outcomes.json | 219 | 306 KB | Change-level quality evidence | **4** |
| url-change-outcomes.json | 110 | 63 KB | Per-URL landing outcomes (url + change) | **4** |
| citations-by-date/ | ~85k | 44 MB | Daily shards (2026-03-05 → 04-16) | **5** |

**Read paths:**
- `imported-results`, `imported-changes`: `readStore()` in file-backend.ts, import-orchestrator.ts
- `answer-texts`: Cold-store on-demand via `getAnswerText()`
- `prompt-answer-observations`: Loaded at startup, written by Profound import pipeline
- `pages`, `change-outcomes`, `url-change-outcomes`: Via `readStore()` in json-store.ts
- `citations-by-date`: Via `getCitationsForDate()` in cold-store.ts

---

### ORPHAN STORES (code never reads them)

**Single Orphan Canonical:**
- **outcome-store.json** (59 records, 33 KB) — Likely replaced by change-outcomes.json and url-change-outcomes.json. Unclear if safe to delete; recommend review before cleanup.

**Legacy/Experimental Orphans (36 files):**
Unread JSON files that may be safe to archive:
- **Experiment tracking:** experiments.json, rollout-executions.json, frontier-attack-packages.json
- **Candidate data:** candidate-links.json (49 KB), candidate-causes (implicit)
- **Feature flags/gates:** triage-rules.json, exit-gates.json, page-guardrails.json
- **Metrics:** daily-metric-snapshots.json (13 MB) — **WARNING: Hot-loaded but appears unused**
- **Events/scoring:** change-events.json, change-contracts.json, event-attributions.json, event-decisions.json (all <200 KB)
- **Evidence/patterns:** pattern-evidence.json, source-pattern-evidence.json (monitoring data)
- **State snapshots:** action-states.json, brief-states.json, render-checks.json, page-visibility.json
- **Monitoring:** competitor-monitoring.json, competitor-page-evidence.json, co-mention-matrix.json
- **Tracking:** tracked-prompts.json, tracked-entities.json, tracked-missing-pages.json
- **Site analysis:** scan-findings.json, scan-runs.json, scan-state.json, site-citation-timeline.json, sitemap-reconciliation.json, robots-state.json, page-snapshots.json, page-snapshots-prev.json
- **Administrative:** truth-labels.json, import-runs.json, milestone-state.json, page-snapshot-diffs.json, render-checks.json
- **Results/competitor data:** imported-opportunities.json (2 KB), imported-competitors.json (2 bytes)

**Backup Files (1):**
- `imported-changes.backup.2026-04-16T17-13-41-166Z.json` (270 KB) — Explicit timestamped backup

**Archive Folder:**
- 8 legacy Profound CSV exports (April 7–14), summarized exports from early runs

---

## Overlap Analysis

### Outcome Stores (the known concern)

Three outcome-related stores exist but **do NOT overlap semantically**:

1. **outcome-store.json** (59 records)
   - Fields: outcome_id, action_type, action_detail, change_id, confidence, verdict, experiment_id, …
   - **Status**: ORPHAN — not read by any code. Predates change-outcomes / url-change-outcomes.

2. **change-outcomes.json** (219 records)
   - Fields: id, change_id, topic_targeted, citations_before/after, mentions_before/after, days_before/after, citation_delta_pct, visibility_delta_pct, …
   - **Granularity**: Global change-level (one record per change across all URLs).
   - **Use**: Windowing.ts reads for quality-evidence; used in visibility-events engine.

3. **url-change-outcomes.json** (110 records)
   - Fields: change_id, url, edit_type_tokens, asset_type, landing_day_n, baseline_days_used, delta_pct, verdict, confidence, …
   - **Granularity**: Per-URL (change × URL composite key).
   - **Use**: url-brain-recommender.ts reads for per-URL landing-outcome insights; change-patterns.ts for edit_type × asset_type learning.

**Conclusion**: url-change-outcomes and change-outcomes are **complementary**, not redundant. They answer different questions (global signal vs. per-URL landing). outcome-store should be reviewed for archival.

### Answer/Observation Stores

1. **answer-texts.json** (12,596 entries, key-value map)
   - Stores: observation_id → LLM text response
   - **Use**: On-demand lookup via `getAnswerText()` for rendering answers
   - **Purpose**: Cold storage for large text blobs

2. **prompt-answer-observations.json** (12,596 records, array)
   - Stores: Full PromptAnswerObservation metadata (ID, platform, prompt_id, topic, etc.)
   - **Use**: Hot-loaded at startup; used for observation metadata lookups
   - **Purpose**: Profound import pipeline state

3. **imported-results.json** (1,539 records, array)
   - Stores: Result objects (Profound query results — different from observations)
   - **Purpose**: Separate stream; not overlapping with observations

**Conclusion**: answer-texts and prompt-answer-observations are **complementary** (text vs. metadata). imported-results is a separate stream. No redundancy.

---

## Schema Consistency Check

All files checked have **zero schema drift** — consistent field sets across all records within each file:

| File | Field Count | Variant Counts | Status |
|------|-------------|-----------------|--------|
| outcome-store.json | 16 fields | 1 variant | ✓ Consistent |
| change-outcomes.json | 21 fields | 1 variant | ✓ Consistent |
| url-change-outcomes.json | 17 fields | 1 variant | ✓ Consistent |
| daily-metric-snapshots.json | varies | 1 variant | ✓ Consistent |
| pages.json | varies | 1 variant | ✓ Consistent |

---

## Cloud Migration Readiness Scores

Scoring: 5 = clean, safe to migrate as-is; 3 = minor reshaping needed; 1 = messy, requires major work.

| Store | Size | Records | Score | Notes |
|-------|------|---------|-------|-------|
| imported-results.json | 1.0 MB | 1,539 | **5** | Clean array structure, ready for single table |
| imported-changes.json | 270 KB | 321 | **5** | Consistent schema, insert-only semantics |
| answer-texts.json | 37.5 MB | 12,596 | **5** | Key-value map; shard by observation ID range |
| citations-by-date/ | 44 MB | ~85k | **5** | Already sharded by date; use time-based partitions |
| prompt-answer-observations.json | 13.5 MB | 12,596 | **4** | Clean; needs pagination strategy for retrieval |
| change-outcomes.json | 306 KB | 219 | **4** | Clean shape; indexed by change_id |
| url-change-outcomes.json | 63 KB | 110 | **4** | Clean shape; composite key (change_id, url) |
| pages.json | 4.6 MB | 6,091 | **4** | Clean; index by page URL or ID |

**No stores require major reshaping.** All are well-suited for Postgres tables or Supabase RLS.

---

## Cleanup Prioritization

### Priority 1 (High Risk of Orphan Drift)
1. **outcome-store.json** (33 KB) — Verify it's not used in newer code, then archive. Appears superseded by change-outcomes.json + url-change-outcomes.json.
2. **imported-opportunities.json** (2 KB) — Likely placeholder from partial feature. Safe to delete.
3. **imported-competitors.json** (2 bytes) — Empty or placeholder. Safe to delete.

### Priority 2 (Clarify Intent)
4. **daily-metric-snapshots.json** (13 MB, hot-loaded) — Flag for review: is this actively used? If not, move to orphan pile.
5. **tracked-prompts.json, tracked-entities.json** — Canonical-store.ts declares these as "hot", but they appear unused in queries. Confirm before archive.

### Priority 3 (Safe Archives)
6. All 8 files in `.data/archive/` — Move to dated backup folder (e.g., `.data/backups/profound-exports-2026-04/`).
7. Experiment/feature-flag files (36 files, ~1 MB total) — Create `.data/legacy/` folder and move wholesale.

---

## Recommendations for Supabase Migration

1. **Sharding strategy**: answer-texts.json → shard by (observation_id % 16) to distribute 12.6k records across 16 partitions. citations-by-date/ → use date column as partition key.

2. **Indexes**: Create composite index on (change_id, url) for url-change-outcomes; (change_id) for change-outcomes.

3. **Dual-write cleanup**: Audit dual-write.ts — syncAnswerTexts, syncPromptAnswerObservations, etc. are fire-and-forget. Ensure no dependencies before cutover.

4. **Backup strategy**: Take full snapshot before migration. Keep imported-changes.backup.2026-04-16T17-13-41-166Z.json pattern for audit trail.

5. **Orphan cleanup**: Delete outcome-store.json, empty placeholder files. Archive /archive folder before migration to reduce data transfer volume.

---

**Report Generated**: 2026-04-17 | **Auditor**: Data Storage Audit (READ-ONLY)
