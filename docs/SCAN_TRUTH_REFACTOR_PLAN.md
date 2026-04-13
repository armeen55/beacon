# Scan truth refactor — plan and outcomes

**New / changed modules**

- `src/domains/scanning/orchestrate-scan.ts` — `runWebsiteScan`, `regenerateScanFindings`
- `src/domains/scanning/last-scan-result.ts` — payload type + atomic read/write
- `src/domains/scanning/scan-state.ts` — `ScanPhase`, `writeRunningScanState`, `writeIdleScanStateFromLastResult`
- `src/domains/observations/observation-runs-merge.ts` — shared merge for file reads + repository
- `.data/last-scan-result.json`, `.data/scan-state.json` — written by CLI + orchestrator

## Problem statement (before)

- **Three entry points** (Today auto-scan, Pages manual `triggerPageScan`, `postImportSetup`) invoked the same CLI with **different wrappers** and **stdout regex** parsing; only Today ran **`generateFindings` + `addFindings`** after a scan.
- **`pageSnapshots` / `guardrailAlerts` / `pageSnapshotDiffs` / `renderCheckResults` / `sitemapReconciliation`** were exported as **import-time constants** from `*-store.ts`, so the Node module could serve **stale arrays** after `.data/*.json` was updated on disk until process restart.
- **`listObservationRuns()`** used a **frozen** `await repo.getObservationRuns()` snapshot at module load for **all** backends; file-backed runs could appear stale after a crawl appended to `observation-runs.json`.
- **No explicit scan lifecycle** in persisted state for operators or future UI to read “running vs failed” without inferring from logs.

## Solution (after)

1. **`src/domains/scanning/last-scan-result.ts`** — versioned **`LastScanResultPayload`**, `readLastScanResult()`, `mapPayloadToPhase()` for orchestration. The CLI writes **`.data/last-scan-result.json`** atomically on every exit path (including failure and dry-run/no-op).
2. **`src/domains/scanning/scan-state.ts`** — **`ScanPhase`**: `idle` | `running` | `success` | `partial` | `failed` | `aborted`. Persisted **`.data/scan-state.json`** updated around each orchestrated run.
3. **`src/domains/scanning/orchestrate-scan.ts`** — Single **`runWebsiteScan({ trigger })`**: capture previous snapshots/guardrails → set `running` → `exec` CLI (always `mock-server-only.cjs` + same argv as before) → read structured **`last-scan-result`** → **`regenerateScanFindings()`** (always) → set terminal phase. **No `revalidatePath`** here (render-safe); **`pages/scan-action.ts`** and **`postImportSetup`** call Next cache invalidation after successful scans only.
4. **Entry points** — Today (`page.tsx`), **`triggerPageScan`** (`scan-action.ts`), **`postImportSetup`** all call **`runWebsiteScan`** only.
5. **Fresh reads** — `snapshot-store`, `guardrail-store`, `page-snapshot-diff-store`, `render-check-store`, `sitemap-reconciliation-store` expose **`get*()`** sync functions using **`readDotDataJson`** each call (no import-time snapshot). All former **`pageSnapshots`** imports replaced with **`getPageSnapshots()`** (and equivalents).
6. **Observation runs** — **`readObservationRunsMergedSync()`** in **`observation-runs-merge.ts`** shared with **`file-backend`**; **`listObservationRuns()`** uses it on **file** `DATA_SOURCE` so each call reflects disk. **Supabase** still uses a **one-time** module cache (same limitation as before; document only).

## Dead / duplicate config (flagged, not all removed)

| Item | Action |
|------|--------|
| **`ScanSettings.scope`** (`full` / `priority`) | Still **unused** by the scanner CLI — product gap, not fixed here. |
| **`business-config.json` → `scanSettings`** | **Duplicate** of `.data/scan-settings.json` / `getScanSettings()` — runtime scan uses **`scan-settings.json`** only; business-config copy can drift. |
| **Finding types** `page_added`, `page_removed`, `stale_visibility` | Still **never emitted** by `generateFindings` — reserved / incomplete. |
| **`getFindingSummary`** in `finding-actions.ts` | **Removed** (no callers). |
| **`saveScanSettings`** | **Kept** (server action for future UI); removed **dead import** from Today `page.tsx`. |

## Tests added

- **`tests/domains/scanning/orchestrate-render-safe.test.ts`** — source-level guard: orchestrator + Today shell stay free of forbidden cache APIs; **`scanRoutesShouldRevalidate`** behavior.
- **`tests/domains/scanning/scan-action-revalidate-after-scan.test.ts`** — `triggerPageScan` calls Next cache invalidation after a successful scan (mocked).
- **`tests/domains/scanning/scan-action-delegates.test.ts`** — scan action delegates to orchestrator; **`next/cache`** mocked in tests.
- **`tests/domains/scanning/scan-state.test.ts`**, **`tests/domains/scanning/snapshot-fresh.test.ts`** — scan state + fresh snapshot reads.

## What is still not “perfect”

- **Today** still **awaits** the full scan in-request when overdue (correctness over latency). Deferring scan to a background worker is a **separate** change.
- **Supabase** `DATA_SOURCE`: observation list and some stores may still prefer **repository** patterns; file mode is now **truth-first** for snapshots/guardrails/diffs/render/sitemap and merged observation JSON on disk.
- **Regex stdout**: **removed** from the happy path; orchestrator reads **`last-scan-result.json`**. CLI still prints human logs for operators running `npm run data:scan`.

## Ratings (after refactor, subjective)

| Aspect | Score /100 | Note |
|--------|------------|------|
| Single orchestration | 95 | One module, three triggers. |
| Findings parity | 98 | Always regenerated post-scan when orchestrator completes. |
| Fresh UI reads (file) | 95 | Per-request disk read for snapshots/guardrails/diffs/render/sitemap. |
| Structured results | 92 | JSON payload + scan-state; CLI logs retained. |
| Scan lifecycle visibility | 88 | `scan-state.json` + phases; no new UI. |
| Supabase parity | 70 | Unchanged staleness model for runs list. |
| Blocking Today | 65 | Intentionally unchanged (truth before async). |
| Build / static correctness | 92 | Today stays static; `runWebsiteScan` does not call `revalidatePath` during RSC render. |

## Before vs after (operator-visible)

| Area | Before | After |
|------|--------|--------|
| Findings after Pages scan | Often **missing** (only Today path ran `generateFindings`). | **Same pipeline** as Today/import via `runWebsiteScan`. |
| Counts after import | Regex on stdout (`scanned`) often **wrong**. | **`last-scan-result.json`** fields. |
| Snapshots on `/pages` after scan | Could look **stale** (import-time `pageSnapshots` const). | **`getPageSnapshots()`** reads disk each request. |
| Observation “last crawl” | Frozen at process load (file mode). | **Merged runs re-read from disk** each `listObservationRuns()` when `DATA_SOURCE` is file. |
| Scan failure visibility | Mostly stderr / logs. | **`last-scan-result`** + **`scan-state`** terminal `failed`. |
