# Beacon Audit Reconciliation

> Verified 2026-04-11 against branch `claude/amazing-shamir` at commit `dd121be`
> All claims checked against actual file contents, build output, and test results.

---

## Build & Test Health

| Claim | Verdict | Evidence |
|-------|---------|----------|
| TypeScript compiles clean | **TRUE** | `npm run typecheck` exits 0, zero errors |
| All tests pass | **TRUE** | 16 files, 77 tests, all passing in 652ms |
| Production build succeeds | **TRUE** | `npm run build` generates 23 static + 6 dynamic routes |
| No lint errors block build | **TRUE** | Build completes without lint gate failure |

---

## Route Map

| Claim | Verdict | Evidence |
|-------|---------|----------|
| /settings exists and works | **TRUE** | `src/app/(shell)/settings/page.tsx` redirects to `/settings/import`. Settings layout at `settings/layout.tsx` provides Import/Config/Health/History tabs. All 4 sub-routes render real pages via re-export. |
| Diagnostics is still in nav | **FALSE** | `src/lib/navigation.ts` contains exactly 5 items: Today, Pages, Market, Changes, Settings. No diagnostics, expansion, briefs, or review in nav. |
| Expansion is still in nav | **FALSE** | Same as above. `/expansion` exists as a route but is not in sidebar navigation. |
| Briefs are still in nav | **FALSE** | `/briefs` route exists but is not in sidebar. Accessible programmatically from Pages. |
| Review is still in nav | **FALSE** | `/review` route exists but is not in sidebar. Accessible from Changes tab via `InlineReviewQueue`. |
| /results is still a standalone nav item | **FALSE** | `/results` exists as a route and is re-exported at `/settings/history`, but is not in the sidebar. |
| Routes still 404 | **FALSE** | All 29 routes in the build output resolve. No 404s. Legacy routes (`/actions`, `/opportunities`) redirect properly. |
| Current nav has stale/dead items | **FALSE** | Navigation is clean: 5 items, all functional, all pointing to real pages. |

---

## Scan System

| Claim | Verdict | Evidence |
|-------|---------|----------|
| Today still triggers scan during render | **TRUE** | `src/app/(shell)/page.tsx:120-132` — `if (scanOverdue) { await runWebsiteScan({ trigger: "today" }); }` runs inside the server component render function. This blocks page render for up to 120s (CLI timeout). |
| Scan orchestration was unified | **TRUE** | `src/domains/scanning/orchestrate-scan.ts` is the single entry point. CLI runs via `execAsync`, findings generated via `regenerateScanFindings()`, scan state written atomically. No duplicate orchestrators found. |
| Findings regenerate consistently after scan | **TRUE** | `regenerateScanFindings()` at `orchestrate-scan.ts:61-95` always reads fresh disk data via `readDotDataJson()`, generates findings via `generateFindings()`, and persists via `addFindings()`. Called after every non-aborted, non-dry-run scan. |
| Fresh reads replaced import-time frozen data for scan outputs | **TRUE** | `getPageSnapshots()` at `src/domains/pages/snapshot-store.ts` uses `readDotDataJson("page-snapshots")` — no cache. Same for `getGuardrailAlerts()` at `guardrail-store.ts`. These are always fresh disk reads. |
| Structured scan result replaced regex parsing | **TRUE** | `src/domains/scanning/last-scan-result.ts` reads/writes `last-scan-result.json` as typed `LastScanResultPayload`. CLI writes structured JSON, orchestrator reads it. No regex parsing of CLI output found. |
| File-mode truth is stronger now | **TRUE** | Scan outputs are all file-based (`.data/page-snapshots.json`, `.data/page-guardrails.json`, etc.). Fresh reads via `readDotDataJson()`. Finding generation always uses fresh disk state. |
| Stale-running recovery exists | **PARTIALLY TRUE** | `writeRunningScanState()` writes `phase: "running"` at scan start. If CLI fails, `defaultFailedPayload()` is written and state transitions to idle. However, if the Node process crashes mid-scan, the state file remains "running" with no recovery mechanism. No watchdog or stale-lock detection. |

---

## Data Layer

| Claim | Verdict | Evidence |
|-------|---------|----------|
| Import-time frozen caches still exist | **TRUE** | `src/lib/seed-data.server.ts:29-75` — `const repo = getRepository(); const _importRuns = await repo.getImportRuns();` is top-level await. Arrays `results`, `changelogEntries`, `opportunities`, `competitors` are module-scoped and populated once at module load. Mutations within the same request are visible (in-place array push), but new requests in a long-running process see the cached reference until module is re-evaluated. |
| Supabase parity is incomplete | **TRUE** | Scan CLI always writes to `.data/` files. No automatic sync from `.data/page-snapshots.json` → Supabase `page_snapshots` table after CLI runs. Dual-write exists for import entities but not for scan outputs. `compare-parity.ts` script exists but is manual. |
| Seed/demo data is still potentially misleading | **TRUE** | When `_importRuns.length === 0`, all routes show hardcoded Ritz Builders demo data from `src/lib/seed-data.ts`. There is no UI indicator that the user is seeing demo data vs real imported data. The `hasActiveExperiment()` function exists but is only used on `/diagnostics` and `/expansion` pages, not on the main routes. |

---

## Today Route Specifics

| Claim | Verdict | Evidence |
|-------|---------|----------|
| Today latency/blocking is a problem | **TRUE** | `page.tsx:120-132`: When scan is overdue, `runWebsiteScan()` is awaited during render. CLI has 120s timeout (`orchestrate-scan.ts:130`). User sees blank page for up to 2 minutes on first morning visit. No streaming, no progressive rendering, no loading indicator during scan. |
| Today does too much computation in render | **TRUE** | `page.tsx` is 1087 lines. A single render computes: scorecard, impact enrichment, events, candidates, triage, recommendations, priority ranking, patterns, briefs, waves, citation decay, geo coverage, local operator surface, entity extraction, discrepancy detection, experiments, outcome backfill, milestone sync, performance timeseries, competitor ranking, and serializes all data for client. All synchronous in render. |
| Today client component is massive | **TRUE** | `today-client.tsx` is 1217 lines. Handles rendering of: primary action, findings, experiments, recommendations, replication cards, performance, visibility summary, milestones, local operator panel, attribution queue, all-clear state. |

---

## Navigation & IA

| Claim | Verdict | Evidence |
|-------|---------|----------|
| Route coherence may leak internal complexity | **PARTIALLY TRUE** | The 5-item nav is clean and coherent. However, the Today page exposes ~15 distinct sections (scan status, primary action, visibility summary, actionable changes, review queue, findings, experiments, recommendations, replication, performance, milestones, local market, entity discrepancies, next moves, verified fixes). This is a lot for a "morning briefing." The route hierarchy is sound but the Today surface is overloaded. |
| Revenue linkage is not yet honestly bridged | **TRUE** | No revenue, conversion, or business-outcome metrics exist. Attribution is visibility-only (citations, mentions, position). The "business consequence" framing exists in copy but has no data backing. The closest is `estimated_impact` on opportunities, which is a static label ("high"/"medium"/"low"), not measured. |

---

## Test Coverage

| Claim | Verdict | Evidence |
|-------|---------|----------|
| Test count is ~16 files / ~77 tests | **TRUE** | Verified via `npm test` output. |
| Tests are algorithmic/domain only | **TRUE** | All 16 test files are under `tests/domains/` or `tests/lib/`. Zero route tests, zero integration tests, zero UI tests, zero E2E tests. Tests cover: attribution scoring (golden + invariants), local operator surface, milestones (compute + apply), observation run merging, page extraction, replication engine, scanning (orchestration, delegation, revalidation, state, snapshots), today proof context/serialization/ritual. |
| No error boundaries exist | **TRUE** | `find src/app -name "error.tsx"` returns nothing. No error.tsx files at any route level. |
| No loading boundaries exist | **TRUE** | `find src/app -name "loading.tsx"` returns nothing. No loading.tsx files at any route level. |

---

## Architecture

| Claim | Verdict | Evidence |
|-------|---------|----------|
| 31 domain modules exist | **TRUE** | Verified: `ls src/domains/` shows 31 directories including pages, competitors, product, attribution, observations, scanning, opportunities, actions, brief-generation, briefs, patterns, opportunity-candidates, prompts, entity, action-clusters, changelog, results, geo, local-operator, answer-snapshots, observation-runs, tracked-prompts, tracked-entities, prompt-answer-observations, outcome-events, event-decisions, daily-metric-snapshots, citation-observations, changes, candidate-causes, milestones. |
| Server/client boundary is correct | **MOSTLY TRUE** | Server components fetch data and pass to client components via props. Server actions use `"use server"` correctly. `seed-data.server.ts` uses `import "server-only"`. However, the shell layout imports seed data at the top level, which means every route pays the cost of data initialization. |
| No API routes exist | **TRUE** | No `route.ts` files found under `src/app/`. All mutations go through server actions. |
| Dual persistence (file + Supabase) works | **TRUE** | `src/lib/persistence/repositories/index.ts` dispatches to file or Supabase backend based on `DATA_SOURCE` env. `dual-write.ts` handles file-first + Supabase-best-effort for import entities. |

---

## Summary Verdicts

| Area | Overall Status |
|------|---------------|
| Build health | **SOLID** — clean typecheck, tests, build |
| Route structure | **CLEAN** — no dead nav items, no 404s, proper redirects |
| Scan system | **FUNCTIONAL BUT RISKY** — works end-to-end but blocks render, no crash recovery |
| Data layer | **WORKS BUT FRAGILE** — module-level frozen arrays, incomplete Supabase parity |
| Today route | **OVERLOADED** — too much computation, too many sections, scan-blocking |
| Test coverage | **NARROW** — domain logic only, no route/integration/E2E tests |
| Error handling | **ABSENT** — no error boundaries, no loading states |
| Demo data | **MISLEADING** — no indicator when showing seed data vs real data |
| Architecture | **OVER-ENGINEERED BUT SOUND** — 31 domains is a lot, but boundaries are clean |
| Navigation | **EXCELLENT** — 5 items, clear, keyboard shortcuts, badges |
