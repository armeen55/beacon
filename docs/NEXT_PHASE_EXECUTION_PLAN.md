# Beacon Execution Plan

> ⚠️ **STALE — last updated 2026-04-16.** The "/changes Phase 2" next-step
> below is superseded. Native polling shipped 2026-04-22 and the active phase
> is now "Replace Profound in 2 weeks while compounding the moat" (v4).
>
> - **Active plan:** `/Users/armeen/.claude/plans/you-are-taking-over-floofy-giraffe.md`
> - **Latest verification:** `docs/VERIFICATION_LOG.md` — 2026-04-24 entry covers Phase v4 Commits 1–4 (poll-health canary, truth-surface sweep, schema v2 migration, extraction v1 + backfill)
> - **Remaining commits in this phase:** Commit 5 (Today KPI flip to derived), Commit 6 (extraction v2 — descriptor_window / co-mentions / domain classes / answer structure), Commit 7 (full mixed-source Z-score math + enrichment badges + copy audit)

> **PURPOSE:** The only active execution plan. What to do, in what order, with what acceptance criteria.
> This file answers: "What do I work on next?"
>
> **NOT FOR:** System architecture (→ `architecture.md`), historical phase details (→ `master_execution_plan.md`), verification proof (→ `VERIFICATION_LOG.md`).

**Last updated (legacy content below, superseded 2026-04-24):** 2026-04-16

---

## Sprint 6A.1 — Phase 15 (page_element_inventory populated) COMPLETE 2026-04-25

**Done:** New `scripts/run-orchestrated-scan.ts` wrapper, scanned 35 owned URLs, wrote **4312 page_element_inventory rows** to production Supabase. Zero unintended writes to `recommended_edits` or `changelog_entries` (verified). All 13 active extractors fired and persisted clean rows. Took ~42s scan + ~5s dual-write.

**Phase 6A.1.13 (hosted UI verification) is finally unblocked.** Steps:
1. `npx tsx --require ./scripts/mock-server-only.cjs scripts/build-edits-for-queue.ts --list` — pick a stableKey from today's queue.
2. `npx tsx --require ./scripts/mock-server-only.cjs scripts/build-edits-for-queue.ts --rec-id=<stableKey>` — DRY-RUN, confirm `target_element_count > 0`.
3. `DUAL_WRITE=true npx tsx --require ./scripts/mock-server-only.cjs scripts/build-edits-for-queue.ts --rec-id=<stableKey> --write` — persist.
4. Visit `https://beacon-bice.vercel.app/recommendations`, find that rec, confirm **Specific edits (N)** renders.

After Phase 6A.1.13 passes, **Sprint 6A.1 is done end-to-end on hosted.**

Capability for Phase 6A.1.13: **Fast** — three CLI commands + visual confirmation.

---

## Sprint 6A.1 — Phase 14 (orchestration extract + CLI) COMPLETE 2026-04-24

**Why this exists:** Phase 6A.1.13 (hosted UI verification) blocked because no script bridged `/recommendations` queue → EvidencePacket → Phase 11 CLI. Phase 14 closes that bridge.

**Done:** `src/domains/recommendations/load-queue.ts` exports `loadLiveRecommendationQueue` + `buildPacketForRec`. `/recommendations/page.tsx` now calls it (render unchanged). New `scripts/build-edits-for-queue.ts` CLI: `--list / --rec-id=<...> / --all / --write`, default DRY-RUN, honest empty-inventory reporting. New `getPageElementInventory()` repository method. 18 new tests, 2061 passing total.

**Next Sprint 6A.1 step (P15):** Populate `page_element_inventory` on hosted. Two viable paths:

**Path A — Run a scan locally with dual-write enabled (~10 min):**
```
DATA_SOURCE=supabase DUAL_WRITE=true npm run data:scan
```
This invokes `scripts/scan-owned-pages.ts` which already wired Phase 6's inventory persistence. The CLI fetches the live site, extracts inventory rows for each page, writes `.data/page-element-inventory.json`, and after the CLI exits `orchestrate-scan.ts` would call `syncPageElementInventory` — but `npm run data:scan` runs the standalone CLI, not the orchestrate-scan flow. **Path A actually has a gap**: the CLI writes `.data/page-element-inventory.json` but doesn't dual-write to Supabase itself. Need to verify whether the `data:scan` script invokes the orchestrator or runs raw.

**Path B — Trigger hosted scan via the UI (operator action, ~5 min on Vercel):**
Visit `/today` (or wherever the scan trigger lives) and hit the "Scan now" button. The hosted scan runs `orchestrate-scan.ts` which DOES dual-write inventory rows.

**Recommended:** Path B if available — it exercises the production path the cron uses. Otherwise verify Path A's dual-write behavior and use it.

After Phase 6A.1.15: rerun Phase 6A.1.13 against a real live-queue stableKey:
1. `npx tsx --require ./scripts/mock-server-only.cjs scripts/build-edits-for-queue.ts --list` — pick a stableKey.
2. Same with `--rec-id=<stableKey>` to dry-run.
3. Same with `--rec-id=<stableKey> --write` to persist.
4. Refresh `https://beacon-bice.vercel.app/recommendations` — confirm the **Specific edits (N)** section appears.

Capability: **Fast** for Phase 6A.1.15 (one scan invocation + verification) — once that's done, Sprint 6A.1 is truly closed.

---

## Sprint 6A.1 — Original 12-phase scope COMPLETE 2026-04-24

**Phases shipped end-to-end:**

| Phase | Deliverable | Commit |
|-------|-------------|--------|
| P1 | Migrations (page_element_inventory + recommended_edits + llm_rejections + changelog ext) | f947a6f |
| P2 | ActionType registry (22 types, 3 active) | 7b0c7b3 |
| P3 | ElementType registry (31 types, 13 active) | 1e421cf |
| P4 | element_key helpers + element-type domain wire-up | c917a71 |
| P5 | 13 active extractors + dispatcher | b2f8623 |
| P6 | page_element_inventory persistence wired into scan + verify | 2da6639 |
| P7 | EvidencePacket builder (pure) + revision flatten cluster | e183704 / 39cf277 |
| P8 | SpecificEditProvider interface + 3 implementations (1 shell, 2 stubs) | bd9354a |
| P9 | Deterministic generators (edit_title / add_h2_section / add_faq) | c36d5dd |
| P10 | Output validation layer | 794b51b |
| P11 | recommended_edits persistence + generate-specific-edits CLI | 1523cbc |
| P12 | /recommendations UI surfacing + per-edit Accept fan-out | (current) |

**End-to-end loop is closed.** From a snapshot crawl → page_element_inventory → cluster-aware EvidencePacket → deterministic provider → validator → recommended_edits row → /recommendations renders a `Specific edits (N)` panel → Accept stamps N changelog entries with `action_type` + `target_element_key` + `source_rec_id`.

**Operator: pick the next sprint.** Two viable directions:

**Direction A — Sprint 6A.2 (LLM activation).** Replace the `not_implemented` openai/anthropic stubs with real implementations behind the existing `SpecificEditProvider` interface. Add evidence-hash cache (Supabase-backed), per-tenant LLM budget gate, llm_rejections persistence, optional per-edit Accept UX. Capability: **Max** — touches budget control, structured-output schemas, cost accounting; high blast radius if mis-wired.

**Direction B — Sprint 7 (multi-tenant hardening).** Tenant-scope every store + path + cron + adjudicator. Add the central tenant resolver. Pick deployment topology (one Vercel project per tenant vs. host-based). Onboard the two beta testers waiting. Capability: **Max** — touches every subsystem.

**Recommendation:** Direction B first. Beta testers are blocked on multi-tenant; their usage will stress-test stores that today only Ritz touches. Sprint 6A.2 is high-value but the LLM behavior depends on cluster + competitor data that beta tester usage will surface — running 6A.2 against three real tenants gives much better signal than running it solo.

Either way, the Sprint 6A.1 data layer is locked + tested + production-ready.

---

## Next best step — Phase 2 of /changes rebuild (2026-04-16)

**Phase 1 shipped today (see `VERIFICATION_LOG.md` 2026-04-16):**
- `/changes` is now one list, newest first — every confirm lands at the top
- `/changes/dedupe` review flow (38 pairs identified)
- Auto-stamped hypothesis on scan confirmation + editable on detail page

**Phase 2 (next):** Replace the hardcoded `"Check after 7 days"` experiment watch window with pattern-learned progressive checkpoints (1d / 3d / 7d / 14d / 30d). First checkpoint with statistically meaningful movement = `landedAtDays: N`, stored back into the change pattern's `median_days_to_impact`. Dynamic "Expected outcome" strings pulled from the rec engine's pattern data (`computeTrackRecord` + `minePatterns`). Smarter per-day status phrases on each `/changes` row.

Touches `src/domains/product/experiment-store.ts` (add `checkpoints` array), `src/domains/product/experiment-citation-sync.ts` (checkpoint scheduler), `src/domains/learning/change-patterns.ts` (feedback into median_days_to_impact), `src/app/(shell)/changes/scorecard-client.tsx` (smarter status cell). Ship behind existing experiment infra — no new routes.

**Out of scope for Phase 2:** backfilling checkpoints for experiments that are already watching (leave as-is, new experiments get the new schedule).

**Capability:** Max — the feedback loop from actual observed `landedAtDays` into future predictions is a wedge feature and touches three domains.

---

**Prior last-updated:** 2026-04-12
**Current status:** **Launch Phases 0–5 COMPLETE. Tier 1.1 + 1.1i + 1.1j COMPLETE** (1.1i: `coverage-state.ts` aging/critical; **1.1j 2026-04-13:** proof-layer copy + `/settings/methodology` completeness + cross-surface phrasing + FAQ). **Track 1.2 Phases 1–3 COMPLETE** (+ Today **one decision** card + truth-first precedence + aligned findings/digest/primary; **2026-04-12** hard **stale visibility** demotion + import path when prior import exists). **Track 1.3 Phases 1–2 COMPLETE. Track 1.4** Phases 1–4 + 1.4e + 1.4f–g + per-source `/local` last sync + listing completeness **+ 1.4l Local layer Sign-off (`local_layer` in exit gates) COMPLETE (2026-04-13).** Track 1.4d SPEC COMPLETE (written spec + **1.4e** copy aligned with shipped connectors). Sign-offs: **`daily_ritual`**, **`replication`**, **`local_layer`**. **`lastSync`** + **`listingCompleteness`** on `LocalPresenceSnapshot`; methodology `#review-source-timestamps`, `#listing-completeness`, `#exit-gates`. **319 tests.** **Sign-offs (2026-04-13):** **`daily_ritual`**, **`replication`**, **`local_layer`** all **`passed`**. **Dogfood / vault Tier 1:** `docs/TIER_1_DOGFOOD_WEEK_LOG.md` — protocol + **2026-04-13 static validation** entry; **operator must log 5–7 consecutive usage days** + paste **Final Tier 1 note** there before vault “Tier 1 closed” (and thus Track **2.1** dependency) is literally satisfied. **2026-04-14:** Closure verification attempted — **failed** (log incomplete); Tier 1 **still active** for vault purposes. **Next:** complete dogfood log → re-verify → **Tier 2**; optional vault **1.4h–1.4k** research. Full nano-phase breakdown: `master_execution_plan.md` §"Tiered product stack — research-led nano-phases (1.1a–2.3h)".
**Overall score:** 53/100. Launch readiness: 38/100 → 72/100 after Phases 0–3 safety + settings coherence.

---

## What's Done (summary only — details in `master_execution_plan.md`)

- **Phase 0 (this plan):** Foundation Safety — error boundaries, `loading.tsx` (shell + Pages + Changes), dead-route/asset cleanup, full `typecheck`/`test`/`build` gate (`VERIFICATION_LOG.md` 2026-04-11)
- **Phases 0–3E:** Supabase foundation, repository wiring, dual-write, parity (15/15 stores)
- **Phases 5–23:** Attribution engine, impact, recommendations, priority, replication, experiments, premiumization
- **Phases 24–31C:** Intelligence expansion (entity, geo, competitive, journey, score, extractability, viz layer)
- **Phase 32/32B:** Daily detection + approval loop, finding triage + workflow
- **Phases 33–37:** Product truth, Today simplification, verdicts, business config, tenant + setup
- **Scan refactor:** Render-safe orchestrator, fresh disk reads, structured results (see `SCAN_TRUTH_REFACTOR_PLAN.md`)

---

## Launch Plan — 6 Phases to Production

### Phase 0: Foundation Safety (1-2 days) — LAUNCH BLOCKER — **COMPLETE**

**Goal:** Prevent crashes and clean dead weight.

**Progress:** **Phase 0 closed** (hygiene gate logged `VERIFICATION_LOG.md` → **2026-04-11** Phase 0C-5). 0A (error boundaries + verify), 0B (`loading.tsx` shell + Pages + Changes), 0C-1..0C-4 (dead weight + legacy redirects removed), **0C-5** — `npm run typecheck` + `npm run test` (77/77) + `npm run build` all pass.

| Step | Task | Est | Acceptance |
|------|------|-----|------------|
| ~~0A-1~~ | ~~Create `src/app/(shell)/error.tsx` — shell error boundary~~ | 30m | Route errors show recovery UI, not white screen |
| ~~0A-2~~ | ~~Create `src/app/(shell)/settings/error.tsx`~~ | 15m | Settings errors caught |
| ~~0A-3~~ | ~~Test error boundary (throw in Today, verify catch)~~ | 15m | No white screen |
| ~~0B-1~~ | ~~Create `src/app/(shell)/loading.tsx` — shell loading skeleton~~ | 30m | Heavy routes show skeleton during load |
| ~~0B-2~~ | ~~Create `src/app/(shell)/pages/loading.tsx`~~ | 15m | Pages shows list skeleton |
| ~~0B-3~~ | ~~Create `src/app/(shell)/changes/loading.tsx`~~ | 15m | Changes shows table skeleton |
| ~~0C-1~~ | ~~Delete `changelogpdf/` directory (39 unused PDFs)~~ | 5m | Gone, build passes |
| ~~0C-2~~ | ~~Delete `src/adapters/legacy/` (README-only stub)~~ | 5m | Gone, build passes |
| ~~0C-3~~ | ~~Delete `/actions` redirect route~~ | 5m | Gone, build passes |
| ~~0C-4~~ | ~~Delete `/opportunities` redirect route~~ | 5m | Gone, build passes |
| ~~0C-5~~ | ~~Run `npm run typecheck && npm test && npm run build`~~ | 5m | All pass |

### Phase 1: Morning Experience (2-3 days) — LAUNCH BLOCKER — **COMPLETE**

**Goal:** Today loads fast, scan runs in background, morning page is focused.

#### Track 1A: Non-blocking scan

| Step | Task | Files | Acceptance |
|------|------|-------|------------|
| ~~1A-1~~ | ~~Create scan status server action~~ | `src/app/(shell)/scan-status-action.ts` | ~~Returns current scan state~~ — `getScanStatus()` → `readScanState()` |
| ~~1A-2~~ | ~~Create trigger-scan server action~~ | `src/app/(shell)/trigger-scan-action.ts` | ~~Triggers scan, returns immediately~~ — `triggerScan()` → `runWebsiteScan({ trigger: "today" })` + `revalidatePath` when `scanRoutesShouldRevalidate` |
| ~~1A-3~~ | ~~Remove `await runWebsiteScan()` from Today `page.tsx` render~~ | `src/app/(shell)/page.tsx` | ~~Today renders immediately even when overdue~~ — no scan in RSC; `shouldTriggerScan` → client for 1A-5 |
| ~~1A-4~~ | ~~Create `ScanStatusBanner` client component~~ | `src/components/today/scan-status-banner.tsx` | ~~Shows "Scanning..." + polls + refreshes on complete~~ — banner with triggering/running/complete/failed states, 5s poll, `router.refresh()` |
| ~~1A-5~~ | ~~Wire banner into `today-client.tsx`~~ | `src/app/(shell)/today-client.tsx` | ~~Scan triggers on load if overdue~~ — banner at top of Today, `shouldTriggerScan` wired; dead `scanRanThisLoad`/`scanResult` code removed |
| ~~1A-6~~ | ~~Test full morning flow~~ | — | ~~Page loads fast → banner → scan → refresh~~ — verified: SSR returns `shouldTriggerScan:true` instantly, banner renders "Starting scan…", client fires `triggerScan()` once, scan resolves (failed in dev — no target site), banner shows terminal state. No temporary forcing needed; no fixes required |

#### Track 1B: Today simplification

**Target Today:** 5 sections max: scan status → primary action + next moves → findings queue → visibility KPIs → milestone teaser.

| Step | Task | Acceptance |
|------|------|------------|
| ~~1B-1~~ | ~~Map current Today sections, classify KEEP / MOVE / COLLAPSE~~ | ~~Decision doc~~ — 14 sections mapped; KEEP 8, REMOVE 3 (secondary recs, replication cards, morning order text), COLLAPSE 2 (accepted findings, performance), MOVE 1 (HowWeKnowPanel). See `VERIFICATION_LOG.md` |
| ~~1B-2~~ | ~~Remove inline attribution review queue → compact link to `/changes?tab=attribution`~~ | ~~Queue gone~~ — **NO-OP 2026-04-12:** no inline attribution review list on Today; only System-line link to `/changes?tab=attribution` when `reviewHeuristicLine` yields a pending count (see `VERIFICATION_LOG.md`) |
| ~~1B-3~~ | ~~Remove secondary recommendation cards (keep primary only)~~ | ~~One action card~~ — `SecondaryOpportunities` + `secondaryRecommendations` / `topRecs` wiring removed |
| ~~1B-4~~ | ~~Remove replication cards → compact note with link~~ | ~~Cards gone~~ — `ReplicationCardsClient` removed; one-line link to `/changes?tab=replicate` when at least one unique beneficiary page; `serializeReplicationCards` dropped from Today path |
| ~~1B-5~~ | ~~Remove performance trend (lives on Changes)~~ | ~~Section gone~~ — `TodayPerformance` + `performanceData` removed from Today; `buildPerformanceTimeseries` dropped from `page.tsx` (`buildCompetitorRank` kept for milestones) |
| ~~1B-6~~ | ~~Remove entity discrepancies~~ | ~~Section gone~~ — **NO-OP:** no dedicated entity-discrepancy UI on Today; `page.tsx` only adds a `nextCandidates` item (generic `summary.nextMove` if selected); `FindingRow` “Mismatch” is changelog/crawl for findings, not entity domain |
| ~~1B-7~~ | ~~Collapse accepted findings to count only~~ | ~~Compact~~ — full accepted list removed; `acceptedAwaitingPromotionCount` + one-line link to `/pages`; `serializedAcceptedFindings` removed from Today path |
| ~~1B-8~~ | ~~Collapse experiments to summary line~~ | ~~Compact~~ — **NO-OP:** no standalone experiments list on Today; `serializedExperiments` is computed in `page.tsx` but not passed to `TodayClient`; `WatchlistExperimentCard` exists in `today-client.tsx` but is never rendered (experiments = primary “Accept & test” only) |
| ~~1B-9~~ | ~~Remove verified fixes (past-tense, not morning-facing)~~ | ~~Section gone~~ — **NO-OP:** `verifiedFixes` is passed into `buildTodaySummary` but `TodayClient` never renders `summary.verifiedFixes`; no standalone verified-fixes block on Today |
| ~~1B-10~~ | ~~Remove unused server computation from `page.tsx`~~ | ~~`page.tsx` < 600 lines~~ — removed dead `serializedExperiments`, `trackRecordSummary`/`outcomeSummary`, unused imports (`computeOutcomeSummary`, `outcomeRecords`, `updateExperimentAction`); experiment citation sync unchanged |
| ~~1B-11~~ | ~~Verify simplified Today renders correctly~~ | ~~5 focused sections~~ — **verified 2026-04-12** (+ same-day follow-up re-run with full `typecheck`/`test`/`build` + `GET /` — see `VERIFICATION_LOG.md` Phase 1B-11 entries): `GET /` HTTP 200, no error boundary; SSR shows Since last scan, primary action, coverage/safety strip (when stale), System line; `ScanStatusBanner` mounted (hidden when `shouldTriggerScan:false` per design); milestone teaser conditional (null in sample); removals confirmed absent in HTML + `today-client.tsx` audit. |

#### Track 1C: Render-time side effects

| Step | Task | Acceptance |
|------|------|------------|
| ~~1C-1~~ | ~~Move outcome backfill from Today render to post-import~~ | ~~Zero mutations during render~~ — **done 2026-04-12:** `backfillFromExistingData` + `persistOutcomes` removed from `page.tsx`; `runOutcomeBackfill()` created in `src/domains/product/outcome-backfill.ts`; wired into `executeImport` + `importWorkbook` in `src/lib/import/actions.ts` |
| ~~1C-2~~ | ~~Move experiment citation update to post-scan/import~~ | ~~Zero mutations during render~~ — **done 2026-04-12:** `updateExperimentCitations` + `persistExperiments` removed from `page.tsx`; `runExperimentCitationSync()` created in `src/domains/product/experiment-citation-sync.ts`; wired into `executeImport` + `importWorkbook` in `src/lib/import/actions.ts` |
| ~~1C-3~~ | ~~Audit `page.tsx` for remaining write ops in render~~ | ~~Zero persist/write/update calls~~ — **done 2026-04-12:** found + removed `syncMilestonesFromWorkspace()` (disk write via `writeStore`); created `src/domains/milestones/post-import-sync.ts`; wired `runMilestoneSync()` into `executeImport` + `importWorkbook`; `getMilestoneState()` (read-only) replaces sync in render; removed dead `perfCompetitorRank` + imports (`buildCompetitorRank`, `classifyCompetitorType`). Full audit confirmed zero remaining writes in `page.tsx` render path. |

### Phase 2: Trust & Onboarding (2-3 days) — LAUNCH BLOCKER — **COMPLETE**

**Goal:** New users understand what they're seeing. Data freshness is visible.

| Step | Task | Acceptance |
|------|------|------------|
| ~~2A-1~~ | ~~Create `DemoBanner` component (sticky, dismissable, links to import)~~ | ~~Component renders~~ — **done 2026-04-12:** created `src/components/shell/demo-banner.tsx`; client component with `useState` dismiss; sticky `top-0 z-40`; warning-toned strip; "Sample data" label + link to `/settings/import`; not mounted yet (2A-2/2A-3 handle flag + conditional render) |
| ~~2A-2~~ | ~~Pass `isDemoMode` flag from shell layout~~ | ~~Flag computed correctly~~ — **done 2026-04-12:** `src/app/(shell)/layout.tsx` sets `isDemoMode = !hasActiveExperiment()` (same signal as seed hydration: empty `import-runs` ⇒ bundled sample data). Passed to `ShellProvider` as `isDemoMode`; exposed on `ShellContext` for `useShell()`. `DemoBanner` not rendered this step (2A-3). |
| ~~2A-3~~ | ~~Render `DemoBanner` conditionally~~ | ~~Shows when no imports, hidden after import~~ — **done 2026-04-12:** `DemoBannerGate` in `demo-banner.tsx` (`if (!isDemoMode) return null`); single mount in `src/app/(shell)/layout.tsx` as first child inside `<main>` (scroll container) so `sticky top-0` applies; `p-6 lg:p-8` moved to inner `max-w-[1120px]` wrapper. No new demo logic. |
| ~~2B-1~~ | ~~Add Today empty state ("Import your data to see briefing")~~ | ~~Guidance when empty~~ — **done 2026-04-12:** `isDemoMode = !hasActiveExperiment()` in `page.tsx` (same signal as 2A); passed to `TodayClient`. When true: `ScanStatusBanner` + compact import section (`/settings/import` CTA); briefing blocks (`HowWeKnowPanel` through System line) hidden. When false: unchanged full Today. |
| ~~2B-2~~ | ~~Add Pages empty state~~ | ~~Guidance when empty~~ — **done 2026-04-12:** `src/app/(shell)/pages/page.tsx` — `!hasActiveExperiment()` early return (same signal as Today 2B-1 / shell demo). Renders existing route header + compact `<section>` (“Import your data to see your real page list”, `/settings/import` CTA). Skips `PagesClient` and all row prep when demo. Normal `/pages` unchanged after import. |
| ~~2B-3~~ | ~~Add Changes empty state~~ | ~~Guidance when empty~~ — **done 2026-04-12:** `src/app/(shell)/changes/page.tsx` — `!hasActiveExperiment()` early return before scorecard/replication/attribution work. Same `PageHeader` as normal route + compact `<section>` (“Import your data to see your real Changes workspace”, `/settings/import` CTA). Skips `syncMilestonesFromWorkspace` and full tab shell when demo. Normal `/changes` unchanged after import. |
| ~~2B-4~~ | ~~Verify Market empty state (already exists)~~ | ~~Works and links to import~~ — **done 2026-04-12:** **Verified** existing `benchmark === null` branch (“No citation evidence yet” + `/settings/import`) — **not** the same as `!hasActiveExperiment()` (demo seed can still have citation index). **ADDED** `!hasActiveExperiment()` early return in `src/app/(shell)/competitors/page.tsx`: same `PageHeader` + compact section (“Import your data to see your real Market view”, `/settings/import`). Post-import missing-citation path unchanged below. |
| ~~2B-5~~ | ~~Refine "All Clear" — don't show when no data exists~~ | ~~Only when data exists AND nothing needs attention~~ — **done 2026-04-12:** `shouldShowTodayAllClear` in `src/lib/today-ritual.ts` accepts optional `isDemoMode`; returns **false** immediately when true (same signal as Today prop: `!hasActiveExperiment()` from `page.tsx`). `TodayClient` passes `isDemoMode`. Real-data rules unchanged when `isDemoMode` is false/omitted. Vitest: new case in `tests/lib/today-ritual.test.ts`. |
| ~~2C-1~~ | ~~Create `DataFreshnessStrip` component~~ | ~~Shows import + scan timestamps~~ — **done 2026-04-12:** `src/components/shell/data-freshness-strip.tsx` — presentational `DataFreshnessStrip` + `DataFreshnessStripProps`: `lastImportAt`, `lastScanCompletedAt` (ISO strings | null), optional `className`. Aligns with `getDataCoverage().lastImportAt` and `latestWebsiteCrawlRun()?.completed_at`. Compact shell-style row; **not mounted** (2C-2). |
| ~~2C-2~~ | ~~Wire into shell layout~~ | ~~Visible on all routes~~ — **done 2026-04-12:** `src/app/(shell)/layout.tsx` — single mount **immediately after `<AppHeader />`**, before `<main>` (fixed strip while main scrolls). Props: `lastImportAt` = newest `importRuns[].started_at` via same sort as `getDataCoverage()` (no new logic); `lastScanCompletedAt` = `latestWebsiteCrawlRun()?.completed_at`. `className="shrink-0 px-6"` aligns horizontal padding with header. |

### Phase 3: Settings Coherence (1-2 days) — PRE-LAUNCH — **COMPLETE**

**Goal:** Settings tabs make sense to operators.

| Step | Task | Acceptance |
|------|------|------------|
| ~~3-1~~ | ~~Create real Config page (editable business settings, not setup wizard)~~ | ~~Config page shows current settings~~ — **done 2026-04-12:** `src/app/(shell)/settings/config/page.tsx` (RSC, `dynamic = "force-dynamic"`) loads `getBusinessConfig()`; `config-form.tsx` client form for **name, domain, industry, locations, services, primaryCompetitors** (comma lists → arrays). **Save:** `saveSetup` in **`settings/config/actions.ts`** (moved from removed **`setup/`** in Phase 3-6) → `saveBusinessConfig()` + `revalidatePath("/", "layout")`. **Persistence:** `.data/business-config.json` via `src/lib/business-config.ts`. |
| ~~3-2~~ | ~~Hide Health tab from settings~~ | ~~Not visible~~ — **done 2026-04-12:** removed `{ href: "/settings/health", label: "System Health" }` from **`TABS`** in `src/app/(shell)/settings/layout.tsx` only. **`src/app/(shell)/settings/health/page.tsx`** unchanged; **`/settings/health`** still resolves (manual / bookmark access). |
| ~~3-3~~ | ~~Rename History tab → "Data"~~ | ~~Tab says "Data"~~ — **done 2026-04-12:** in `src/app/(shell)/settings/layout.tsx` **`TABS`**, changed label from **"Measurement History"** to **"Data"** for `{ href: "/settings/history", ... }`. **Route unchanged:** still **`/settings/history`**; no file moves; no `aria-*` on these links beyond default `Link` behavior. |
| ~~3-4~~ | ~~Add framing text to Data tab~~ | ~~Contextual header~~ — **done 2026-04-12:** `src/app/(shell)/settings/history/page.tsx` wraps default **`ResultsPage`** import: a **`role="note"`** block **above** the existing results tree only on this route. Copy: imported row-level visibility + citation evidence, raw material for other routes, use for **audit / linkage / freshness**, not attribution or recommendations. **No** changes to results data path; framing only on **`/settings/history`** (see 3-7: `results-page.tsx` under settings). |
| ~~3-5~~ | ~~Remove standalone `/import` route (keep only `/settings/import`)~~ | ~~One path only~~ — **done 2026-04-12:** deleted **`src/app/(shell)/import/page.tsx`** (and empty `(shell)/import/`). UI moved to **`src/app/(shell)/settings/import/import-page.tsx`**; **`settings/import/page.tsx`** re-exports `export { default } from "./import-page"`. **Link fix:** `src/app/(shell)/diagnostics/page.tsx` **`/import` → `/settings/import`**. **`/settings/import`** unchanged functionally. |
| ~~3-6~~ | ~~Remove standalone `/setup` route~~ | ~~One path only~~ — **done 2026-04-12:** removed **`src/app/(shell)/setup/`** (`page.tsx` two-step wizard + **`actions.ts`**). **`saveSetup`** / **`loadSetup`** moved to **`src/app/(shell)/settings/config/actions.ts`** (same implementations). **`config-form.tsx`** imports **`./actions`**. No **`href="/setup"`** in `src/` (nothing to retarget). **`/settings/config`** remains the sole setup/config **route**; wizard UI removed as superseded by Config (3-1). |
| ~~3-7~~ | ~~Remove standalone `/results` route~~ | ~~One path only~~ — **done 2026-04-12:** removed **`src/app/(shell)/results/`** (`page.tsx`, `results-client.tsx`, **`[id]/page.tsx`**). Files live under **`src/app/(shell)/settings/history/`**; **`page.tsx`** imports **`./results-page`**. In-app **`href`s** **`/results`** / **`/results/:id`** → **`/settings/history`** / **`/settings/history/:id`** (import page, diagnostics, briefs, changes detail, pages client, review queue, topics, attribution/brief/outcome components, history clients). |
| ~~3-8~~ | ~~Verify all settings tabs work~~ | ~~All functional~~ — **verified 2026-04-12:** Code review: **`settings/layout.tsx`** `TABS` = Import, Config, Data only (no Health). **`rg`** on `src/` — no `href`/`router` targets to **`/import`**, **`/setup`**, or bare **`/results`**. **`curl`** (dev `127.0.0.1:3000`): **`/settings/import`**, **`/config`**, **`/history`**, **`/health`** → **200**; **`/import`**, **`/setup`**, **`/results`** → **404**. Data HTML contains **“Imported measurements”** (3-4 framing). **`npm run typecheck` / `test` / `build`** — pass. **No code changes.** |

### Phase 4: Component Quality (3-4 days) — **COMPLETE**

**Goal:** Break mega-components, reduce maintenance risk.

| Step | Task | Acceptance |
|------|------|------------|
| ~~4-1~~ | ~~Extract `TodayScanStrip` from `today-client.tsx`~~ | ~~Renders independently~~ — **done 2026-04-12:** added **`src/components/today/today-scan-strip.tsx`** — **`TodayScanStrip`** with prop **`shouldTriggerScan`**; renders same comment + **`ScanStatusBanner`** (no logic changes). **`today-client.tsx`** imports **`TodayScanStrip`**, replaces inline banner. **`npm run typecheck` / `test` / `build`** — pass. |
| ~~4-2~~ | ~~Extract `TodayPrimaryAction`~~ | ~~Handles display + actions~~ — **done 2026-04-12:** **`src/components/today/today-primary-action.tsx`** — primary recommendation card (bucket styles, Basis, accept/defer/dismiss, **Accept & test** + `onStartExperiment`) and **`summary.nextMove`** fallback card; **`BUCKET_STYLE`** moved here. Props: **`primaryAction`**, **`nextMove`**, callbacks, **`pending`**, **`startTransition`**, **`actionMsg`**, **`setActionMsg`** (same shared transition/feedback as watchlist). **`today-client.tsx`** replaces inline block with **`<TodayPrimaryAction ... />`**. |
| ~~4-3~~ | ~~Extract `TodayFindings`~~ | ~~Handles display + resolve~~ — **done 2026-04-12:** **`src/components/today/today-findings.tsx`** — **`TodayFindings`** + **`FindingRow`** + **`PRIORITY_STYLE`**; “Since last scan” all-clear, grouped pending findings (same priority buckets / header copy), accepted-awaiting-promotion line + **`/pages`** link. Props: **`pendingFindings`**, **`resolvedFindingsCount`**, **`scanCompletedAt`** (was **`run?.completed_at`**), **`crawlAgeDays`**, **`onResolveFinding`**, **`onPromoteFinding`**, **`acceptedAwaitingPromotionCount`**. **`SerializedFinding`** type-only import from **`today-client`** (same pattern as 4-2). **`today-client.tsx`** replaces inline block with **`<TodayFindings ... />`**; upstream finding computation unchanged. |
| ~~4-4~~ | ~~Extract `TodayVisibilitySnapshot`~~ | ~~Proof + coverage + system shell~~ — **done 2026-04-12:** **`src/components/today/today-visibility-snapshot.tsx`** — **`HowWeKnowPanel`** + morning-order line; merged **coverage / freshness** strip (same **`crawlStale` / `visStale` / `coverageTone`** rules); **“Done for today”** all-clear block; **System** line (scan age, visibility fresh/stale/no data, attribution pending link, Health). **`children`** slot preserves DOM order for milestone teaser + **`TodayFindings`** + **`TodayPrimaryAction`** + replication one-liner (unchanged markup; parent still computes **`deriveCoverageTone`**, **`shouldShowTodayAllClear`**, **`reviewPending`**). Props explicit scalars + **`proofContext`**. **`npm run typecheck` / `test` / `build`** — pass. |
| ~~4-5~~ | ~~Compose Today from extracted components~~ | ~~`today-client.tsx` < 300 lines~~ — **done 2026-04-12:** removed dead code: **`WatchlistExperimentCard`**, **`GROUP_CONFIG`**, **`WATCHLIST_STATUS_PRESENTATION`**, **`MANUAL_STATUS_OPTIONS`**, **`REC_ACCENT`**, **`formatExperimentStarted`**, **`recTypeDisplayLabel`**, **`formatScanTime`**; dead types **`TodayImpactItem`**, **`TodayExperiment`**, **`TodayTrackRecord`**, **`VisibilitySummary`**; dead imports **`cn`**, **`ReactNode`**, **`ChangeVerdict`**, **`ImpactConfidence`**, **`ImpactDirection`**. File is now **299 lines** — clean orchestration: types + component composition only. |
| ~~4-6~~ | ~~Extract `PageRowCard` from `pages-client.tsx`~~ | ~~Renders one row~~ — **done 2026-04-12:** **`src/components/pages/page-row-card.tsx`** — **`PageRowCard`** (left-queue row button: label, status/open-items line, mentions / pending / scan / Q&A / schema / canonical / next-move chips). **`STATUS_CONFIG`** + **`NEXT_MOVE`** moved here and **re-exported**; **`pages-client.tsx`** imports them for the detail panel (single source of truth). **`import type { PageRow }`** from **`pages-client`** (type-only). **`npm run typecheck` / `test` / `build`** — pass. |
| ~~4-7~~ | ~~Compose Pages from extracted components~~ | ~~`pages-client.tsx` < 400 lines~~ — **done 2026-04-12:** **`src/components/pages/pages-selected-detail.tsx`** (~739 lines) — selected-page right pane (header, scan verdict, crawl snapshot, diff, actions, wave, fix/playbook briefs, changes/events) + **`CrawlRow` / `CrawlChip` / `DiffChip`** + **`STATUS_BADGE`** (moved from **`pages-client`**). **`src/components/pages/pages-workbench-top.tsx`** (~157 lines) — crawl warning, KPI strip + donut, scan button + last-scan + view tabs. **`pages-client.tsx`** now **340 lines** (was **1114**): types + **`PagesClient`** orchestration only. Removed dead **`PAGE_TYPE_LABELS`** (unused). Dropped unused **`Link`**, **`cn`**, **`ChangeVerdictBadge`**, **`KpiCard`**, **`DonutRing`** imports from **`pages-client`**. **`npm run typecheck` / `test` / `build`** — pass. |
| ~~4-8~~ | ~~Extract Today server computation to separate modules~~ | ~~`page.tsx` < 400 lines~~ — **done 2026-04-12:** **`src/app/(shell)/today-data.ts`** — **`loadTodayPageData()`** returns **`TodayPageData`** (same props as **`TodayClient`** minus the four server-action callbacks). All former RSC prep (demo mode, scan overdue, stores/summary, recommendations, replication line, local operator strip, **`proofContext`**, serialized findings, milestone teaser read path, **`formatTimeAgo`**) moved verbatim; **`page.tsx`** = **`await loadTodayPageData()`** + **`<TodayClient {...data} onRespondToRec={…} … />`**. **~21 lines.** No render-time writes (read-only prep; Track 1C unchanged). |
| ~~4-9~~ | ~~Run `npm run typecheck && npm test && npm run build`~~ | ~~All pass~~ — **done 2026-04-12:** same gate run as **4-8** verification — **`npm run typecheck`**, **`npm run test`** (78/78), **`npm run build`** — all pass. |

### Phase 5: Testing & Observability (2-3 days) — **COMPLETE**

**Goal:** Structured logging, route smoke tests, scan crash recovery.

| Step | Task | Acceptance |
|------|------|------------|
| ~~5-1~~ | ~~Create `src/lib/logger.ts` (JSON, levels, context)~~ | ~~Logger works~~ — **done 2026-04-12:** **`src/lib/logger.ts`** — `log.debug/info/warn/error(msg, context?)`. Single JSON line per call: `{ level, ts, msg, context? }`. Uses `console.log` / `.warn` / `.error` by level. Handles circular refs safely. 47 lines. No external deps. |
| ~~5-2~~ | ~~Add logging to scan orchestrator~~ | ~~Scan ops logged~~ — **done 2026-04-12:** **`src/domains/scanning/orchestrate-scan.ts`** — `import { log } from "@/lib/logger"`. **`runWebsiteScan`:** `log.info("Scan started", { runId, trigger })` where `runId = scan-${Date.now()}`, `trigger` = **`auto`** iff `ScanTrigger === "import"` else **`manual`**; **`log.error("Scan failed", { runId, durationMs, error })`** on CLI `exec` rejection or missing/invalid `last-scan-result`; **`log.info("Scan completed", { runId, durationMs, resultCount })`** when terminal `ok` (success or partial with `pagesScanned > 0`); else **`log.error("Scan failed", …)`** with `error` from `cliError` / `aborted` / exit. No orchestration or revalidate changes. |
| ~~5-3~~ | ~~Add logging to import engine~~ | ~~Import ops logged~~ — **done 2026-04-12:** **`src/lib/import/actions.ts`** only — **`executeImport`**: `log.info("Import started", { runId: batchId, source: "upload" })` after id mint; parse catch → `log.error("Import failed", { runId, durationMs, error })`; terminal **`imported > 0`** → `log.info("Import completed", { runId, durationMs, rowCount: imported })`; else **`log.error("Import failed", …)`** with first row error or “No data rows” / “No rows imported”. **`importWorkbook`**: missing file → `log.error("Import failed", { runId: "", error: "No file provided" })` (no **`Import started`**); else same start pattern; parse catch → **`Import failed`**; success path → **`Import completed`** with **`rowCount: run.imported_count`** (existing run aggregate). **`source`** is **`upload`** for both entry points (settings UI); no **`api`** path yet. **`postImportSetup`** unchanged. |
| ~~5-4~~ | ~~Add logging to server actions~~ | ~~Actions logged~~ — **done 2026-04-12:** Outer-boundary **`log.info("Action started", { action, params })`** / **`log.info("Action completed", { action, durationMs })`** / **`log.error("Action failed", { action, durationMs, error })`** on all targeted **`"use server"`** exports below. **Params** are IDs, enums, lengths, counts, or patch key lists only — no raw CSV/HTML/body text. **Not instrumented:** **`getScanStatus`** (client poll noise), **`loadSetup`** (read-only), **`executeImport`** / **`importWorkbook`** (already **`Import *`** in **5-3**), inline **`use server`** blocks in **`page.tsx`**. **Files:** **`trigger-scan-action.ts`**, **`pages/scan-action.ts`**, **`recommendation-actions.ts`**, **`experiment-actions.ts`**, **`finding-actions.ts`**, **`settings/config/actions.ts`** (`saveSetup`), **`pages/wave-actions.ts`**, **`pages/issue-actions.ts`**, **`pages/verify-action.ts`**, **`topics/package-actions.ts`**, **`competitors/competitors-actions.ts`**, **`changes/contract-actions.ts`**, **`lib/import/actions.ts`** (`previewImport`, **`clearEntityData`**, **`clearImportedData`**, **`resetExperiment`**, **`postImportSetup`**), **`domains/actions/actions.ts`**, **`domains/attribution/candidate-actions.ts`**, **`domains/changelog/actions.ts`**, **`domains/results/actions.ts`**, **`domains/briefs/actions.ts`**, **`domains/opportunities/actions.ts`**, **`domains/opportunity-candidates/actions.ts`**, **`domains/brief-generation/actions.ts`**, **`adapters/profound/actions.ts`**. |
| ~~5-5~~ | ~~Create route smoke test: Today renders~~ | ~~Test passes~~ — **done 2026-04-12:** **`tests/routes/today-smoke.test.ts`** — dynamic import **`TodayPage`** from **`@/app/(shell)/page`**, **`await TodayPage()`**, **`renderToStaticMarkup`**. **`TodayClient`** mocked to a hook-free stub emitting **`Since last scan`** (matches real **`today-findings`** heading; avoids **`useState`** under Vitest). Asserts **`max-w-3xl`** (real **`page.tsx`** wrapper) + stub string. **`next/cache`** mocked. **`npm run typecheck` / `test`** (79/79) / **`build`** — pass. |
| ~~5-6~~ | ~~Create route smoke test: Pages renders~~ | ~~Test passes~~ — **done 2026-04-12:** **`tests/routes/pages-smoke.test.ts`** — **`await import("@/app/(shell)/pages/page")`**, sync **`PagesPage()`**, **`renderToStaticMarkup`**. **`PagesClient`** stubbed (empty div; client hooks). Asserts **`max-w-5xl`** + subtitle **`Health, citations, and the next step for each URL.`** from RSC (**`page.tsx`**, demo + full). **`next/cache`** mocked. **`npm run typecheck` / `test`** (80/80) / **`build`** — pass. |
| ~~5-7~~ | ~~Create route smoke test: Changes renders~~ | ~~Test passes~~ — **done 2026-04-12:** **`tests/routes/changes-smoke.test.ts`** — **`await import("@/app/(shell)/changes/page")`**, async **`ChangeScorecardPage()`**, **`renderToStaticMarkup`**. **`ChangesTabShell`** stubbed (**`useState` / `useSearchParams`**). Asserts **`PageHeader`** description **`What worked. What to scale. Why visibility moved.`** and layout class string **`flex items-start justify-between gap-4 mb-8`** (no root **`max-w-*`** on Changes — **`PageHeader`** structure instead). **`next/cache`** mocked. **`npm run typecheck` / `test`** (81/81) / **`build`** — pass. |
| ~~5-8~~ | ~~Create route smoke test: Market renders~~ | ~~Test passes~~ — **done 2026-04-12:** **`tests/routes/market-smoke.test.ts`** — **`await import("@/app/(shell)/competitors/page")`**, async **`CompetitorsPage()`**, **`renderToStaticMarkup`**. **`next/cache`** mocked. Five **`"use client"`** sections stubbed (**`CompetitorsManageClient`**, **`CoMentionSection`**, **`SourceTrustSection`**, **`LocalPressureSection`**, **`BattlecardSection`**) so Vitest never executes hooks when import + citation data mounts the full Market tree. Asserts **`max-w-4xl`** + **`PageHeader`** description **`Who beats you, where they beat you, and exactly what to do about it.`** (demo + full **`competitors/page.tsx`**). **`npm run typecheck` / `test`** (82/82) / **`build`** — pass. |
| ~~5-9~~ | ~~Add scan crash recovery (stale-running detection)~~ | ~~Stuck scans auto-recover~~ — **done 2026-04-12:** Three files changed. **`src/domains/scanning/scan-state.ts`:** added **`STALE_SCAN_THRESHOLD_MS`** (5 min = 300 000 ms; CLI timeout 120 s), **`runningScanAgeMs(state)`** (age of running scan from `updatedAt`), **`isScanRunningAndFresh(state)`** (true only when running AND under threshold). **`src/domains/scanning/orchestrate-scan.ts`:** at top of **`runWebsiteScan`**: (1) if `phase === "running"` **and fresh** → return early with `phase: "running"` + `error` (duplicate guard, no concurrent scans); (2) if `phase === "running"` **and stale** → `log.warn("Scan marked stale", { runId, ageMs, thresholdMs })`, write failed payload via `writeIdleScanStateFromLastResult`, `log.info("Recovered stale scan state", { runId })`, then proceed to start new scan. **`src/app/(shell)/scan-status-action.ts`:** `getScanStatus()` normalizes stale `running` → `phase: "failed"` + message `"Previous scan appears to have crashed — ready to retry"` so the UI never shows "scanning" indefinitely. Normal active-scan behavior unchanged. **`npm run typecheck` / `test`** (82/82) / **`build`** — pass. |
| ~~5-10~~ | ~~Full test suite passes~~ | ~~All green~~ — **done 2026-04-12 (verification-only):** Full gate **`npm run typecheck`** ✓ · **`npm run test`** ✓ **82**/82 (20 test files) · **`npm run build`** ✓ (17 static ○ + 4 dynamic ƒ). **Phase 5 checklist:** **`src/lib/logger.ts`** present; scan (**`orchestrate-scan.ts`**) + import (**`lib/import/actions.ts`**) + shared server-action logging unchanged from **5-2**–**5-4**; route smokes **`tests/routes/today-smoke.test.ts`**, **`pages-smoke.test.ts`**, **`changes-smoke.test.ts`**, **`market-smoke.test.ts`** all in suite; stale-running recovery (**`scan-state.ts`**, **`orchestrate-scan.ts`**, **`scan-status-action.ts`**) unchanged. **No app code changes** for this step. **Phase 5 closed.** |

---

## Top 25 Highest-Leverage Fixes

Full details: `docs/archive/audits/TOP_25_HIGHEST_LEVERAGE_FIXES.md`

| # | Fix | Effort | Impact |
|---|-----|--------|--------|
| 1 | Error boundaries | 2 hrs | Prevents route crashes |
| 2 | Loading states | 1 hr | Prevents blank pages |
| 3 | Move scan out of render | 4-6 hrs | Fixes morning experience |
| 4 | Demo mode indicator | 2 hrs | Fixes new user trust |
| 5 | Empty states | 3-4 hrs | Fixes new user experience |
| 6 | Today simplification (15→5 sections) | 4-6 hrs | Reduces cognitive load |
| 7 | Split mega-components (1000+ lines) | 6-8 hrs | Maintainability |
| 8 | Remove render-time side effects | 2-3 hrs | Correctness |
| 9 | Clean dead weight (PDFs, legacy adapter) | 1 hr | Repo hygiene |
| 10 | Structured logging | 3-4 hrs | Production debugging |
| 11 | Settings restructure | 4-6 hrs | UX coherence |
| 12 | Route smoke tests | 4-6 hrs | Regression safety |
| 13 | Scan crash recovery | 2 hrs | Reliability |
| 14 | Module-cache invalidation strategy | 4-6 hrs | Production data freshness |
| 15 | Supabase scan output sync | 4-6 hrs | Data layer parity |
| 16 | "Business consequence" copy honesty | 2 hrs | Trust |
| 17 | Today server computation extraction | 3-4 hrs | Maintainability |
| 18 | Pages pagination | 3-4 hrs | Scale |
| 19 | Terminology cleanup (Beacon Intel, contracts) | 2 hrs | UX |
| 20 | Dark mode | 4-6 hrs | Premium feel |
| 21 | Onboarding flow (setup → import → first scan) | 6-8 hrs | First-run experience |
| 22 | Health check endpoint | 1 hr | Deployment safety |
| 23 | Rate limiting for scan target site | 2 hrs | Good citizenship |
| 24 | Scan retry on transient failure | 2-3 hrs | Reliability |
| 25 | E2E tests (Playwright) | 8-12 hrs | Confidence |

---

## Future Roadmap: Tiered Product Stack (post-launch)

These are **research-led nano-phases** — each is a mini-prompt slice, not a monolithic phase. Execute sequentially within each track. Tracks can run in parallel where dependencies allow.

### Tier 1 — Core product completion

| Track | Focus | Key deliverables | Exit gate |
|-------|-------|-------------------|-----------|
| 1.1 | Proof layer | Methodology shell, confidence lexicon, lineage fields, adversarial FAQ | **1.1j signed off (2026-04-13)** |
| 1.2 | Daily ritual | Inbox-zero definition, digest channel, assignment model, keyboard path | 1.2h signed off |
| 1.3 | Replication engine | Winner definition v2, pattern gap analysis, queue IA, experiment linkage | 1.3h signed off |
| 1.4 | Local listings/reviews | GBP read-path, health score, review monitoring, NAP checks | 1.4l signed off |
| 1.5 | Milestones/ATH | ATH metrics, rolling windows, celebration UX, history store | 1.5g signed off |

**Tier 1 closed when:** 1.1j, 1.2h, 1.3h, 1.4l, 1.5g all signed off + one internal dogfood week without P0 trust regressions. **Evidence:** append dated rows + final note in `docs/TIER_1_DOGFOOD_WEEK_LOG.md` (see file for template).

### Tier 2 — Growth + differentiation

| Track | Focus | Key deliverables | Exit gate |
|-------|-------|-------------------|-----------|
| 2.1 | Revenue bridge | Signal inventory, identity graph feasibility, metric definitions, v1 bridge | 2.1g signed off |
| 2.2 | Weekly export | Audience variants, data inclusion rules, PDF/deck layout, generation pipeline | 2.2f signed off |
| 2.3 | Stronger competitor attack | Countermove taxonomy, one-click strategy, evidence packs, competitive narrative QA | 2.3h signed off |

**Tier 2 closed when:** 2.1g, 2.2f, 2.3h signed off + one agency pilot runs a week without manual spreadsheet side-channel.

**Full nano-phase breakdown:** Each track has 7-12 lettered research steps (e.g., 1.1a through 1.1j). Authoritative copy: `master_execution_plan.md` — heading **“Tiered product stack — research-led nano-phases (1.1a–2.3h)”** (section appears before **AUDIT SUMMARY** in that file).

### Native ingestion (Profound → API → Supabase) — prep only

- **Audit + gaps:** `docs/NATIVE_INGESTION_READINESS_AUDIT.md` (filename-prefix trap, merge vs full-replace semantics, field utilization, idempotency target).
- **Shipped in prep pass:** Workbook import **removed**; `writeLegacyBridge` **dual-writes** results / changelog / import-runs when `DUAL_WRITE=true`. **2026-04-13:** Profound batch uses **header-based CSV discovery** + **merge-safe** ingest (multi-file, stable keys); filename prefixes no longer required.
- **Not shipped:** Staging tables, worker, API transport, repository-only reads — design in audit; implement when Tier 1 dogfood + operator answers to §7 unblock.

---

## Cursor Prompts (ready to paste)

Full prompt library: `docs/archive/audits/CURSOR_PROMPTS_BY_PHASE.md`

### Phase 0A — Error Boundaries (COMPOSER)

> Create error.tsx files for Beacon's Next.js App Router shell. Create `src/app/(shell)/error.tsx` and `src/app/(shell)/settings/error.tsx`. Each must: (1) be a client component with "use client", (2) accept `{ error, reset }` props, (3) render a centered card with Geist font, app colors, "Something went wrong" heading, error.message in muted text, and a "Try again" button that calls reset(). Style to match the existing app (see any page for tokens). Do NOT touch any other files. Verify: `npm run build` passes.

### Phase 0B — Loading States (COMPOSER)

> Create loading.tsx files: `src/app/(shell)/loading.tsx`, `src/app/(shell)/pages/loading.tsx`, `src/app/(shell)/changes/loading.tsx`. Each should render a skeleton layout matching its route: shell loading shows sidebar + content area skeleton, pages shows a list skeleton, changes shows a table skeleton. Use subtle pulse animation. Match existing app styling. Do NOT modify any existing files. Verify: `npm run build` passes.

### Phase 1A — Non-Blocking Scan (COMPOSER)

> Refactor Today's auto-scan to be non-blocking. Currently `src/app/(shell)/page.tsx` lines 120-132 await `runWebsiteScan()` during render, blocking for up to 120s. Fix: (1) Create `src/app/(shell)/trigger-scan-action.ts` server action that calls `runWebsiteScan()` and returns immediately. (2) Create `src/app/(shell)/scan-status-action.ts` server action that reads scan state. (3) In page.tsx, instead of awaiting scan, just check `isScanOverdue()` and pass `shouldTriggerScan` boolean to client. (4) Create `src/components/today/scan-status-banner.tsx` client component: on mount if shouldTriggerScan, call trigger action; poll status every 5s; show "Scanning your site..." banner; on complete, call router.refresh(). Do NOT change scan logic, findings, or any other route. Verify: `npm run typecheck && npm test && npm run build`.

---

## Keep / Hide / Fix / Kill (summary)

Full matrix: `docs/archive/audits/KEEP_HIDE_FIX_KILL_MATRIX.md`

| Surface | Label | Key issue |
|---------|-------|-----------|
| Today | FIX | Scan blocks render, 15 sections, render-time side effects |
| Pages | KEEP | Strongest route. Minor: split components, add pagination |
| Market | KEEP | Real competitive intelligence. Minor: first-run guidance |
| Changes | KEEP | Core value. Minor: terminology cleanup |
| Settings | FIX | Import solid; Config/Health/History mismatched |
| Settings > Health | HIDE | Internal diagnostics, wrong audience |
| /diagnostics | HIDE | Correctly hidden from nav already |
| /expansion | HIDE | Correctly quarantined |
| /actions | REMOVED | Deleted 2026-04-12 (Phase 0C-3); `briefs/proposed` “View Action” → `/` |
| /opportunities | REMOVED | Deleted 2026-04-12 (Phase 0C-4); list was → `/competitors`, detail was → `/topics/opportunity/[id]` — use those URLs directly |
| changelogpdf/ | REMOVED | Deleted 2026-04-12 (Phase 0C-1) |
| src/adapters/legacy/ | REMOVED | Deleted 2026-04-12 (Phase 0C-2); was README-only, no imports |
