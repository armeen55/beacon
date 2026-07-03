# Profound May 10 Expiry — Readiness Checklist

**Date:** 2026-05-06 (4 days to expiry)
**Status:** 🟢 **GREEN — Profound's May 10 expiry is a non-event for daily operation.**
**CI guardrail:** [`tests/architecture/profound-runtime-isolation.test.ts`](../tests/architecture/profound-runtime-isolation.test.ts)
**Audit predecessor:** [`docs/HANDOFF_VERIFIED_STATE.md`](./HANDOFF_VERIFIED_STATE.md) "Profound May 10 audit (2026-05-06)"

---

## TL;DR

Beacon migrated to native polling (Perplexity + ChatGPT) on **2026-04-22**. Since then, no daily-running code path has touched Profound. The 2026-05-06 readiness audit (3 parallel Explore agents + manual cross-verification) found:

- **Daily 07:00 UTC cron**: 100% Profound-free.
- **Every `/api/*` route**: 100% Profound-free.
- **Every daily-routine script**: 100% Profound-free.
- **Every shell route except `/settings/import`**: zero Profound imports.
- **Zero `PROFOUND_*` env vars** in workflows, env examples, package scripts, or vercel.json.
- **Profound CSV fixtures** SHA-256-pinned in `.data/_backups/pre-w4-backfill-2026-05-04/csv-source/`.
- **22+ tests** that mention Profound either use static source-text invariants or local fixture CSVs — none call the API.

The new architecture invariant (`tests/architecture/profound-runtime-isolation.test.ts`) pins this posture forward. **Any PR that re-introduces a Profound runtime dependency fails CI.**

---

## What is Profound-free today

| Surface | State | Pinned by |
|---|---|---|
| 07:00 UTC daily-native-poll cron | Polls Perplexity + ChatGPT only; rebuilds citation index from native observations | `tests/architecture/profound-runtime-isolation.test.ts` Item 7 |
| 07:45 UTC poll-canary cron | Reads Supabase `prompt_answer_observations` + `observation_runs` only | Item 1 |
| 04:00 UTC daily-scan cron | Runs `run-scheduled-scan.ts` (website only) | Item 1 |
| `/api/poll/run` | Native polling adapters | Item 2 |
| `/api/cron/rebuild-citation-evidence-index` | Reads native observations + tracked_entities | Item 2 |
| `/api/cron/scan` | Subprocess to `run-scheduled-scan.ts` | Item 2 |
| `scripts/check-yesterday-poll.ts` | Supabase reads only | Item 3 |
| `scripts/canary-persistence-write.ts` | Native canary write | Item 3 |
| `scripts/run-scheduled-scan.ts` | Website crawl + diff | Item 3 |
| `scripts/verify-daily-poll.ts` | Supabase reads only | Item 3 |
| `scripts/poll-perplexity.ts`, `scripts/poll-openai.ts` | Native poll fallbacks | Item 3 |
| `scripts/rebuild-citation-evidence-index-native.ts` | Native observations only | Item 3 |
| All shell routes except `/settings/import` | Zero Profound imports | Item 4 |
| Recommendation engine | Reads `recommended_edits` + native observations only | Item 4 |
| Native polling pipeline (`src/adapters/perplexity/`, `src/adapters/openai/`) | Independent of Profound | Item 4 |

---

## What still exists and why it is safe

### Profound adapter directory — preserved, Advanced-gated

`src/adapters/profound/` contains 10 files:
- `actions.ts` — exports `importProfoundData()` server action.
- `import-orchestrator.ts` — `runProfoundImport()` master.
- `bridge.ts`, `merge-ingest.ts` — legacy-data transforms.
- `csv-discovery.ts`, `entity-seed.ts` — CSV file utilities.
- `prompt-adapter.ts`, `citation-adapter.ts`, `execution-adapter.ts`, `benchmark-adapter.ts` — CSV parsers.

**Why safe:** none of these files perform network I/O. They parse local CSV files. The single caller (`importProfoundData`) is reachable only from the Advanced-gated `/settings/import` button. The Advanced disclosure is collapsed by default (D2 contract, pinned by `tests/architecture/settings-import-customer-safe-default.test.ts`).

**Verified:** the operator has to (a) navigate to `/settings/import`, (b) click "Advanced — legacy import paths", (c) click "Run batch import" — three deliberate clicks. There is no daily-cron, no /api/* route, no other UI surface that triggers the adapter.

### Dead `src/lib/data-adapters/`

`src/lib/data-adapters/` contains `index.ts` + `profound-adapter.ts`. Both are dead code (zero callers in production routes; `getAdapters()` returns empty stubs per file-top comment). Kept for now to avoid touching unrelated tests; queued for post-May-10 deletion.

### Profound CSV fixtures

| File | Location | Size | Pinned |
|---|---|---|---|
| `profound-prompts.csv` | `.data/` | 32 KB | SHA-256 manifest |
| `profound_citations_data(march5th-april21st).csv` | `.data/` | 77 MB | SHA-256 manifest |
| `profound_raw_data_with_citations(march5th-april21st).csv` | `.data/` | 61 MB | SHA-256 manifest |
| `profound_summarized_export_(march5th-april21st).csv` | `.data/` | 3.7 MB | SHA-256 manifest |

Backup location: `.data/_backups/pre-w4-backfill-2026-05-04/csv-source/`. SHA-256 manifests confirm content integrity.

### Pre-cutover Supabase rows

Pre-2026-04-22 daily metric snapshots were re-derived during the W4 backfill (commit-pinned 2026-05-04) from recovered Profound-source observations. They live in `daily_metric_snapshots` with `source_type = "benchmark"` (or, for re-derived rows, `source_type = "derived"`). The `MEASUREMENT_QUALITY_BOUNDARY` constant (`"2026-04-22"`) gates `/changes` Z-score logic so pre-cutover URLs render `too_early` honestly rather than mixed-source verdicts.

---

## What breaks on May 10

**Functionally: nothing.** The adapter parses local CSV files, not API responses. As long as the existing CSVs remain on disk, `Run batch import` continues to work.

**Operationally: the operator can no longer download a fresh CSV export from Profound's website.** The existing CSVs (Mar 5–Apr 21 window) are the final snapshot. New historical data must come through native polling.

**Indirect: nothing.** No daily code path depends on Profound API or website availability.

---

## What historical Profound data is preserved

- 4 Profound CSV files in `.data/` (~141 MB total, SHA-256-pinned).
- Backup copies in `.data/_backups/pre-w4-backfill-2026-05-04/csv-source/`.
- Re-derived `daily_metric_snapshots` in Supabase (covers pre-2026-04-22 dates).
- Recovered `prompt_answer_observations` in Supabase (W4 backfill artifacts; tagged `source_type = "historical_recovered"`).
- `imported_legacy` lifecycle entries in `changelog_entries` table.

**The pre-cutover history remains queryable indefinitely.** It is not dependent on Profound API uptime.

---

## May 10 checklist (operator)

These are the actions to take ON or NEAR the expiry date:

- [ ] **2026-05-09 (day before expiry):** Optional final CSV pull from Profound's website if you want a fresh snapshot. The W4 backfill already captured the Mar 5–Apr 21 window; only useful if Apr 22+ Profound data is wanted as a historical reference. *(Note: the operator brief said "do not start onboarding," "do not backfill" — this step is skippable.)*
- [ ] **2026-05-09:** Verify the morning cron runs cleanly:
  ```
  npm run verify:daily-poll -- --mode=post
  ```
  Expected: GREEN (199–200 obs landed; both platforms full sample).
- [ ] **2026-05-10 (cutover day):** Verify the morning cron is still green. The 07:00 UTC cron runs with no Profound dependency:
  ```
  npm run verify:daily-poll -- --mode=post
  ```
- [ ] **2026-05-10:** No code changes required. Profound API can disappear at any time on this date with zero operational impact.

**Roll-back signal:** if `verify:daily-poll` returns RED on 2026-05-10 morning, the `tests/architecture/profound-runtime-isolation.test.ts` invariant should ALSO have failed in CI on the latest deploy. If both surfaces simultaneously go red without a code change, that's the signal of a true Profound dependency the audit missed — investigate before remediation.

---

## May 11 morning verification checklist

The day after expiry, run a deeper sweep to confirm the cron is still healthy without Profound:

- [ ] **`npm run verify:daily-poll -- --mode=post`** — GREEN expected.
- [ ] **Inspect raw_poll_chunks** for 2026-05-11: all should be `verified_complete`. Inspect via `scripts/check-yesterday-poll.ts`.
- [ ] **Hosted /today smoke** — confirm /today renders fresh data with `latest_observation_date = 2026-05-11`.
- [ ] **`shasum -a 256 .data/global/llm-budget.json`** — confirm ledger byte-identical to its prior state (i.e., the morning verification did not clobber it via test re-run).
- [ ] **CI status on `origin/main`** — confirm the `tests/architecture/profound-runtime-isolation.test.ts` invariant is GREEN. If it's RED, a regression slipped in.
- [ ] **Optional: try the Advanced "Run batch import" button** at `/settings/import` to confirm it still parses local CSVs cleanly. This proves the adapter is fully Profound-API-independent.

If all checks pass, **the Profound expiry is officially a non-event.** Proceed to the post-May-10 cleanup queue.

---

## Post-May-10 cleanup queue

**DO NOT execute these before May 10.** The operator brief explicitly defers cleanup until ≥2026-05-11. This list is the queue, in order of priority.

| # | Task | Files / surface | Effort |
|---|---|---|---|
| 1 | Move `src/adapters/profound/` to `.data/_legacy/_pre-cli-migration-2026-04-28/profound-adapter/` (or delete outright if archived backup is sufficient) | 10 files | Fast |
| 2 | Delete dead `src/lib/data-adapters/` (3 files; zero callers) | 3 files | Fast |
| 3 | Remove the Advanced disclosure section from `src/app/(shell)/settings/import/import-page.tsx` (the Profound batch importer + `Bridged results` UI). Keep the customer-safe default surface and the manual paste / reset / log subsections | 1 file | Fast |
| 4 | Delete `src/app/(shell)/settings/import/import-page.tsx`'s `importProfoundData` import + state vars `profoundResult` / `setProfoundResult` | inline edit | Fast |
| 5 | Delete `tests/adapters/profound/` (csv-discovery + merge-ingest tests) | 2 files | Fast |
| 6 | Relax `tests/architecture/settings-import-customer-safe-default.test.ts`: drop the assertion that requires `importProfoundData` + "Run batch import" copy to exist (the gate becomes "no advanced legacy imports") | inline edit | Fast |
| 7 | Update `tests/architecture/profound-runtime-isolation.test.ts` to remove the Item-5 "/settings/import is the only caller" assertion (no caller = invariant trivially passes; delete or relax to "no caller exists") | inline edit | Fast |
| 8 | Update `tests/scripts/customer-one-backfill.test.ts` to skip Profound-CSV fixtures OR mark the test as historical-only (W4 backfill is one-shot; future re-runs unlikely) | 1 file | Fast |
| 9 | Move `.data/profound_*.csv` (4 files) to `.data/_legacy/_pre-cli-migration-2026-04-28/profound-finals/` | 4 files | Fast |
| 10 | ~~Move 4 one-off backfill scripts to `.data/_legacy/_scripts/` (or delete): `run-import.ts`, `test-import.ts`, `customer-one-backfill.ts`, `classify-historical-changes.ts`.~~ DONE 2026-07-02 (UX5 legacy sweep): `run-import.ts`, `test-import.ts`, `classify-historical-changes.ts` deleted outright (zero code/test references). `customer-one-backfill.ts` kept — `tests/scripts/customer-one-backfill.test.ts` still imports its functions directly. | 4 scripts | Fast |
| 11 | Update `docs/NEXT_PHASE_EXECUTION_PLAN.md` to mark the Profound deletion bundle complete | inline edit | Fast |
| 12 | Update `docs/architecture.md` to remove the Profound-adapter section (or move to "Historical context") | inline edit | Balanced |
| 13 | Add a `2026-05-11` entry to `docs/VERIFICATION_LOG.md` recording the post-cleanup state and invariant counts | inline edit | Fast |

**Estimated total effort:** ~1 hour Fast-tier work, ~30 file moves/deletions + a few inline edits.

**Acceptance criteria** (when the cleanup bundle ships):
- typecheck clean.
- All architecture invariants still pass (the Profound-related ones may be relaxed or deleted as a coordinated set).
- Full suite only known baseline failures.
- Build green.
- Ledger byte-identical pre/post-suite.
- No customer-facing route changes (the customer-safe default of `/settings/import` stays clean; only the Advanced disclosure is removed).
- Hosted Vercel smoke clean post-deploy.

---

## Explicit "do not delete before May 10" note

**HARD RULE — NO PROFOUND DELETION BEFORE 2026-05-11.**

Reasons:
1. The operator may want to pull one final CSV export from Profound's website on 2026-05-09 or 2026-05-10. The Advanced "Run batch import" button must still work to ingest it.
2. The audit was run on 2026-05-06 — 4 days before expiry. We have NOT yet observed a full daily cron cycle on or after 2026-05-10. Pre-emptive deletion would foreclose the rollback path if the audit missed something.
3. The cleanup bundle is bounded and Fast-tier. Waiting 5 days has zero cost.
4. The architecture invariant `tests/architecture/profound-runtime-isolation.test.ts` already prevents NEW Profound runtime dependencies. Existing isolated code is safe to leave in place.

**If a future PR proposes deleting Profound before 2026-05-11, REJECT it.**

---

## What this invariant protects (CI-enforced forward)

`tests/architecture/profound-runtime-isolation.test.ts` declares 7 invariant blocks:

1. **Item 1 — Daily cron workflows are Profound-free.** Walks `daily-native-poll.yml`, `poll-canary.yml`, `daily-scan.yml`. Fails if any contains `[Pp]rofound` or `PROFOUND_*`.
2. **Item 2 — Every `/api/*` route is Profound-free.** Walks `src/app/api/`, strips comments, fails if any file references `runProfoundImport` / `bridgeProfoundResults` / `importProfoundData` / `ProfoundImportResult`, or imports from `src/adapters/profound`.
3. **Item 3 — Every daily-routine script is Profound-free.** Iterates the explicit `DAILY_ROUTINE_SCRIPTS` allowlist (synced from `.github/workflows/`). Fails on any forbidden runtime reference.
4. **Item 4 — Shell routes outside `/settings/import` are Profound-free.** Walks `src/app/(shell)/`, skips files under `settings/import/`, fails on any forbidden runtime reference.
5. **Item 5 — `/settings/import/import-page.tsx` is the ONLY caller of `importProfoundData()`.** Greps all of `src/app/`, `src/components/`, `src/lib/`, `src/domains/` for the function-call shape `importProfoundData(`. The expected caller set is exactly `[src/app/(shell)/settings/import/import-page.tsx]`.
6. **Item 6 — Zero `PROFOUND_*` env vars.** Scans `.env.local.example`, `package.json` scripts, `vercel.json`, and every `.github/workflows/*.yml` for the regex `\bPROFOUND_[A-Z][A-Z0-9_]*\b`.
7. **Item 7 — `daily-native-poll.yml` is canonically Profound-free + invokes only native endpoints.** Pins the file's positive shape (`/api/poll/run`, `perplexity`, `openai`, `rebuild-citation-evidence-index`).

**Plus:** a cross-check that this very doc exists and references the invariant by name (so a future reader can find the CI guardrail that backs the GREEN status).

---

**Operator brief acceptance — checklist**

| Required | Status |
|---|---|
| Item 1 — runtime-isolation invariant created | ✅ `tests/architecture/profound-runtime-isolation.test.ts` |
| 7 invariant blocks pin all forbidden surfaces | ✅ |
| Item 2 — readiness doc created | ✅ `docs/PROFOUND_MAY_10_READINESS.md` (this file) |
| GREEN summary | ✅ |
| What's Profound-free today | ✅ |
| What still exists + why safe | ✅ |
| What breaks May 10 | ✅ (nothing functional) |
| Historical data preserved | ✅ |
| May 10 + May 11 checklists | ✅ |
| Post-May-10 cleanup queue | ✅ (13 items) |
| Explicit "do not delete before May 10" note | ✅ |
| typecheck clean | (verified by QGATE) |
| targeted invariant passes | (verified by QGATE) |
| full suite only baseline failures | (verified by QGATE) |
| build green | (verified by QGATE) |
| ledger byte-identical | (verified by QGATE) |
