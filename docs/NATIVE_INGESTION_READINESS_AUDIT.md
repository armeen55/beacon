# Native ingestion readiness — system audit (2026-04-12)

Audience: operator + engineering. Focus: **data**, **pipeline**, **truth quality**. Not UI.

---

## Executive summary

| Area | Verdict | Confidence |
|------|---------|------------|
| **Your recent `april7-12*.csv` files** | **Now ingested** (2026-04-13): discovery is **header-based**; multiple raw/citation/prompt files are **merged** with stable keys (mtime order = conflict winner). | **High** (implemented) |
| **Full-replace semantics** | **Mitigated (2026-04-13):** prompts, observations, answer texts, benchmark rows, and citation **shards** are **merge-upserted** with existing stores; **derived** snapshots are recomputed from the merged observation set. Changelog CSVs merge into existing `imported-changes` when present. | **High** |
| **Supabase parity (Profound path)** | **Fixed in this change:** `writeLegacyBridge` now calls `syncResults` / `syncChangelogEntries` / `syncImportRuns` when `DUAL_WRITE=true`. Previously Profound bridge wrote **files only** for results/changes/runs. | **High** |
| **Native-ready architecture** | **Far** from “swap transport only” — need **stable natural keys**, **idempotent upserts**, **append** strategy for observations/citations, **explicit `source` + `ingestion_batch_id`**, and **API ingest service** separate from Next request cycle | **Medium** (industry-aligned) |
| **Workbook path** | **Removed** — Settings → Import is **CSV batch + manual advanced** only, aligned with “no workbook” directive | **High** |

---

## 1. Data integrity (what the code actually does)

### 1.1 How Profound batch finds files (updated 2026-04-13)

`discoverProfoundCsvFiles()` in `src/adapters/profound/csv-discovery.ts` scans **every** top-level `*.csv` in `.data/`, reads the **header row**, and classifies into:

- `prompts` — columns include `id`, `prompt`, `topic`, no `run_id`
- `raw_executions` — `run_id`, `date`, `platform`, `prompt`, plus `response` / `citation_1` / `mentioned?`
- `citations` — `run_id`, `date`, `url`, `hostname`, plus citation category columns
- `benchmark` — `date`, `asset`, `platform`, plus visibility / share-of-voice style columns
- `changelog` — signal / asset type columns and “exact change made” style headers

**Multiple files per kind:** all are parsed and **merged** (`merge-ingest.ts`): same natural `id` → last file by **mtime** wins; citations dedupe per date by `(prompt_answer_id, normalized url)`; changelog rows dedupe by content key.

**Unclassified** CSVs are listed in import **warnings** and skipped.

**Legacy filename prefixes** are no longer required.

### 1.2 Replace vs merge (loss risk) — 2026-04-13

| Store / artifact | Behavior |
|------------------|----------|
| `tracked-prompts`, `observation-runs`, `prompt-answer-observations` | **Merge by stable `id`**, then **persist** (still one JSON file per store, but contents are union + upsert). |
| `answer-texts.json` | **Read existing map → merge** incoming observation ids → **atomic write** (no silent wipe of unrelated ids). |
| `daily-metric-snapshots` | **Replace file** with `[…buildDerivedSnapshots(mergedObs), …mergedBenchmark]` — derived slice always matches merged obs; benchmark rows **merge** with prior benchmark snapshots on disk. |
| `citations-by-date/*.json` | **Per-date merge** (existing shard + all incoming files for that date), dedupe, renumber `citation_order`. |
| `imported-results` | Still **replaced** from current merged snapshots (projection, not raw row store). |
| `imported-changes` | **Merged** when one or more changelog CSVs are discovered; otherwise **unchanged** (no wipe). |

**Nothing verifies row-count parity** with source CSVs after parse (only counts in `ProfoundImportResult`).

### 1.3 Dual-write (Supabase)

`dual-write.ts` wraps: `import_runs`, `results`, `changelog_entries`, `opportunities`, `competitors`, `attribution_decisions`, `candidate_links`.

**Canonical Profound hot stores** (prompts, prompt-answer observations, daily metric snapshots in `canonical-store`) are **not** in that list — native Postgres would need **new tables + mappers** or an expanded dual-write surface.

---

## 2. Data utilization (signal vs waste)

### 2.1 What drives Today / recommendations

- **Results** used for coverage, deltas, and `recommendation-engine` inputs come largely from **bridged** `DailyMetricSnapshot` → `Result` projection (`canonicalSnapshotsToResults`), **topic scope**, limited fields (mentions, citations, position, etc.).
- **Raw prompt answers** power citation index build + page discovery; **not every CSV column** is guaranteed mapped — `execution-adapter` / `citation-adapter` define the contract.
- **36 citation URL columns** per row are aggregated into counts/domains; **full list** is not all surfaced in product copy.

### 2.2 Likely underutilized (hypotheses for follow-up)

- **Non–topic-level** snapshots (if produced) may be filtered out of bridge → fewer Result rows than theoretically possible.
- **Benchmark / summarized** path only enriches when optional file matches; competitor narrative may be thin without it.
- **Attribution bridge:** many bridged results have **empty** `attributed_changelog_ids` — limits “change-grounded” recommendations unless changelog CSV is present and aligned.

**Exact improvements (engineering backlog):**

1. **Column inventory** — auto-diff Profound CSV header vs parser expected columns; log **unmapped** columns once per import (not silent drop).
2. **Ingestion report artifact** — write `.data/last-profound-import-report.json` with `{ input_files, row_counts_raw, row_counts_parsed, dropped_rows_reason }`.
3. **Wire more snapshot dimensions** only where `recommendation-engine` can consume them (no new product metrics without spec).

---

## 3. Architecture for native ingestion (target state)

### 3.1 Gaps vs “API → transform → Supabase, zero product change”

| Gap | Today | Native target |
|-----|--------|---------------|
| **Trigger** | Button + files on disk | Scheduled job / webhook / queue consumer |
| **Idempotency** | Full replace arrays / overwrite shards | **Upsert on stable key** (e.g. `(source, external_run_id, prompt_id, date)` or hash of row) |
| **Partial feeds** | Dangerous for observations & answer-texts | **Append-only fact table** + materialized view for “latest by key” |
| **Source tagging** | Mixed `source_system` strings | **`ingestion_source` + `pipeline_version`** on every row |
| **File-specific logic** | `findFile` prefix, CSV quirks | **Versioned normalizer** per vendor API version |

### 3.2 Proposed pipeline (clean)

1. **Ingest** — HTTP payload or object storage pointer → validate schema version.
2. **Normalize** — map to **Beacon canonical row types** (same as today’s internal structs).
3. **Stage** — load into **staging** tables (Supabase) or temp JSON with batch id.
4. **Merge** — SQL `INSERT … ON CONFLICT` or MERGE job keyed by natural id.
5. **Publish** — refresh materialized aggregates / rebuild `citation-evidence-index` in a **background job**, not in HTTP handler.
6. **Read path** — keep `SeedDataRepository` as single abstraction; file vs Supabase already exists — extend repository for new tables.

### 3.3 “Zero product behavior change”

Achievable **if and only if** the normalized rows **match current structs** and the same downstream jobs (`writeLegacyBridge` equivalent, citation index, page registry) read from **repository** instead of “whatever was last written to json-store.” That is a **deliberate consolidation** project, not a rename.

---

## 4. Industry benchmark (condensed)

- **Segment-style ingestion:** client-defined **`messageId`** for dedup within 24h; warehouses dedup on `id`. Lesson: **explicit stable event id** per ingested row, not “filename order.”
- **ELT vs ETL:** modern stacks **land raw** then transform in warehouse; Beacon today is closer to **ETL in-process** (parse → replace arrays). Native path should **land raw** (or minimally validated JSON) then **merge**.
- **SEO / visibility tools (Ahrefs, SEMrush, Profound-class):** frequent snapshots + **append-only history** + **latest view** for UI. Lesson: separate **history** from **current truth** for operator views.

**Where Beacon is weak:** partial-file **destructive replace** for hot paths; **no** ingest-run **checksum** report; **prefix filename** coupling.

**Where Beacon is OK:** sharded citations by date; bridge pattern to legacy `Result`; dual-write for main entity tables (now includes post-bridge sync).

**Overcomplicated:** dual paths (canonical-store + json-store + bridge) without a single **ingestion version** artifact.

---

## 5. Performance & scale (10× data)

| Risk | Why |
|------|-----|
| **Full-array replace in memory** | `replaceAll` on large arrays — memory spikes and long blocking writes |
| **Rebuilding citation index** | Full scan of all citation dates + observations on each import — **O(all data)** |
| **Today page** | Heavy `loadTodayPageData` — more rows → slower SSR unless paginated or pre-aggregated |
| **answer-texts single JSON** | One huge JSON file — parse/stringify cost grows superlinearly |

**Mitigations:** move observations + answer texts to **per-batch files or Postgres partitions**; incremental citation index; **background job** for index + `postImportSetup` style work; cap in-process arrays in dev only.

---

## 6. Structured answers (required format)

### Broken or risky

1. **Filename prefix discovery** — wrong file picked silently; custom names ignored.
2. **Full replace** of observations / answer-texts — **partial export = data loss**.
3. **Dual-write blind spot** (mitigated for bridge outputs in this PR; canonical tables still file-only).
4. **`findFile` non-determinism** if multiple `profound_raw…` files exist.

### Underutilized

- Unmapped CSV columns (unknown without header diff).
- Benchmark / summarized file when not present.
- Changelog → `attributed_changelog_ids` linkage underused when CSV missing.

### Must change before native ingestion

1. **Stable ids + upsert merge** for every ingested entity type used by Today.
2. **Ingestion batch record** with file hashes / API cursor, row counts, errors — persisted.
3. **Repository-only read path** for hot visibility data (no direct `canonical-store` mutation from routes).
4. **Background worker** for index rebuild + scan triggers (decouple from Next.js request).
5. **Remove filename coupling** — config manifest or DB row pointing to `storage_path` + `format_version`.

### Confidence

- **Close** on *product* behavior if you treat “native” as “same JSON shapes written by a worker instead of CSV.”
- **Far** on *production* ingestion until idempotency, staging, and observability land.

---

## 7. Questions for you (unlimited — please answer when you can)

1. After your upload, did you **rename** files to the required prefixes, or only add `april7-12*.csv` alongside existing `profound_*.csv`?
2. Does your **raw** export contain **full history** or only the new week? (Determines whether current replace semantics are safe.)
3. Is **`DUAL_WRITE=true`** in the environment where you run imports? If yes, did you **verify rows in Supabase** for `results` / `changelog_entries` after import?
4. For native v1, will the vendor expose **webhooks**, **S3 drops**, or **pull API** — and what is the **natural primary key** per “answer row” they guarantee stable?
5. Do you need **multi-tenant** isolation in Postgres before native, or single-tenant is enough for v1?

---

## 8. Code changes shipped with this audit

- **Removed** workbook parser and `importWorkbook` server action; **deleted** `src/lib/import/workbook.ts`.
- **Settings → Import** primary path is **Profound batch** with explicit filename rules, warnings, post-import setup after success.
- **`writeLegacyBridge`** now **dual-writes** bridged `results`, `changelog_entries`, and `import_runs` when enabled.

See `VERIFICATION_LOG.md` entry dated 2026-04-12 for verification commands.
