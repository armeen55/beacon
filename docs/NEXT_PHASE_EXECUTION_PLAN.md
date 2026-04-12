# Beacon Execution Plan

> **PURPOSE:** The only active execution plan. What to do, in what order, with what acceptance criteria.
> This file answers: "What do I work on next?"
>
> **NOT FOR:** System architecture (→ `architecture.md`), historical phase details (→ `master_execution_plan.md`), verification proof (→ `VERIFICATION_LOG.md`).

**Last updated:** 2026-04-12
**Current status:** **Phase 0 (Foundation Safety) COMPLETE.** Phases 2–37 COMPLETE. Active work: **Phase 1** — Morning Experience (non-blocking scan + Today focus).
**Overall score:** 53/100. Launch readiness: 38/100 → 72/100 after Phases 0-2.

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

### Phase 1: Morning Experience (2-3 days) — LAUNCH BLOCKER — **CURRENT**

**Goal:** Today loads fast, scan runs in background, morning page is focused.

#### Track 1A: Non-blocking scan

| Step | Task | Files | Acceptance |
|------|------|-------|------------|
| ~~1A-1~~ | ~~Create scan status server action~~ | `src/app/(shell)/scan-status-action.ts` | ~~Returns current scan state~~ — `getScanStatus()` → `readScanState()` |
| 1A-2 | Create trigger-scan server action | `src/app/(shell)/trigger-scan-action.ts` | Triggers scan, returns immediately |
| 1A-3 | Remove `await runWebsiteScan()` from Today `page.tsx` render | `src/app/(shell)/page.tsx` | Today renders immediately even when overdue |
| 1A-4 | Create `ScanStatusBanner` client component | `src/components/today/scan-status-banner.tsx` | Shows "Scanning..." + polls + refreshes on complete |
| 1A-5 | Wire banner into `today-client.tsx` | `src/app/(shell)/today-client.tsx` | Scan triggers on load if overdue |
| 1A-6 | Test full morning flow | — | Page loads fast → banner → scan → refresh |

#### Track 1B: Today simplification

**Target Today:** 5 sections max: scan status → primary action + next moves → findings queue → visibility KPIs → milestone teaser.

| Step | Task | Acceptance |
|------|------|------------|
| 1B-1 | Map current Today sections, classify KEEP / MOVE / COLLAPSE | Decision doc |
| 1B-2 | Remove inline attribution review queue → compact link to `/changes?tab=attribution` | Queue gone |
| 1B-3 | Remove secondary recommendation cards (keep primary only) | One action card |
| 1B-4 | Remove replication cards → compact note with link | Cards gone |
| 1B-5 | Remove performance trend (lives on Changes) | Section gone |
| 1B-6 | Remove entity discrepancies | Section gone |
| 1B-7 | Collapse accepted findings to count only | Compact |
| 1B-8 | Collapse experiments to summary line | Compact |
| 1B-9 | Remove verified fixes (past-tense, not morning-facing) | Section gone |
| 1B-10 | Remove unused server computation from `page.tsx` | `page.tsx` < 600 lines |
| 1B-11 | Verify simplified Today renders correctly | 5 focused sections |

#### Track 1C: Render-time side effects

| Step | Task | Acceptance |
|------|------|------------|
| 1C-1 | Move outcome backfill from Today render to post-import | Zero mutations during render |
| 1C-2 | Move experiment citation update to post-scan/import | Zero mutations during render |
| 1C-3 | Audit `page.tsx` for remaining write ops in render | Zero persist/write/update calls |

### Phase 2: Trust & Onboarding (2-3 days) — LAUNCH BLOCKER

**Goal:** New users understand what they're seeing. Data freshness is visible.

| Step | Task | Acceptance |
|------|------|------------|
| 2A-1 | Create `DemoBanner` component (sticky, dismissable, links to import) | Component renders |
| 2A-2 | Pass `isDemoMode` flag from shell layout | Flag computed correctly |
| 2A-3 | Render `DemoBanner` conditionally | Shows when no imports, hidden after import |
| 2B-1 | Add Today empty state ("Import your data to see briefing") | Guidance when empty |
| 2B-2 | Add Pages empty state | Guidance when empty |
| 2B-3 | Add Changes empty state | Guidance when empty |
| 2B-4 | Verify Market empty state (already exists) | Works and links to import |
| 2B-5 | Refine "All Clear" — don't show when no data exists | Only when data exists AND nothing needs attention |
| 2C-1 | Create `DataFreshnessStrip` component | Shows import + scan timestamps |
| 2C-2 | Wire into shell layout | Visible on all routes |

### Phase 3: Settings Coherence (1-2 days) — PRE-LAUNCH

**Goal:** Settings tabs make sense to operators.

| Step | Task | Acceptance |
|------|------|------------|
| 3-1 | Create real Config page (editable business settings, not setup wizard) | Config page shows current settings |
| 3-2 | Hide Health tab from settings | Not visible |
| 3-3 | Rename History tab → "Data" | Tab says "Data" |
| 3-4 | Add framing text to Data tab | Contextual header |
| 3-5 | Remove standalone `/import` route (keep only `/settings/import`) | One path only |
| 3-6 | Remove standalone `/setup` route | One path only |
| 3-7 | Remove standalone `/results` route | One path only |
| 3-8 | Verify all settings tabs work | All functional |

### Phase 4: Component Quality (3-4 days) — PRE-LAUNCH

**Goal:** Break mega-components, reduce maintenance risk.

| Step | Task | Acceptance |
|------|------|------------|
| 4-1 | Extract `TodayScanStrip` from `today-client.tsx` | Renders independently |
| 4-2 | Extract `TodayPrimaryAction` | Handles display + actions |
| 4-3 | Extract `TodayFindings` | Handles display + resolve |
| 4-4 | Extract `TodayVisibilitySnapshot` | Renders KPIs independently |
| 4-5 | Compose Today from extracted components | `today-client.tsx` < 300 lines |
| 4-6 | Extract `PageRowCard` from `pages-client.tsx` | Renders one row |
| 4-7 | Compose Pages from extracted components | `pages-client.tsx` < 400 lines |
| 4-8 | Extract Today server computation to separate modules | `page.tsx` < 400 lines |
| 4-9 | Run `npm run typecheck && npm test && npm run build` | All pass |

### Phase 5: Testing & Observability (2-3 days) — PRE-LAUNCH

**Goal:** Structured logging, route smoke tests, scan crash recovery.

| Step | Task | Acceptance |
|------|------|------------|
| 5-1 | Create `src/lib/logger.ts` (JSON, levels, context) | Logger works |
| 5-2 | Add logging to scan orchestrator | Scan ops logged |
| 5-3 | Add logging to import engine | Import ops logged |
| 5-4 | Add logging to server actions | Actions logged |
| 5-5 | Create route smoke test: Today renders | Test passes |
| 5-6 | Create route smoke test: Pages renders | Test passes |
| 5-7 | Create route smoke test: Changes renders | Test passes |
| 5-8 | Create route smoke test: Market renders | Test passes |
| 5-9 | Add scan crash recovery (stale-running detection) | Stuck scans auto-recover |
| 5-10 | Full test suite passes | All green |

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
| 1.1 | Proof layer | Methodology shell, confidence lexicon, lineage fields, adversarial FAQ | 1.1j signed off |
| 1.2 | Daily ritual | Inbox-zero definition, digest channel, assignment model, keyboard path | 1.2h signed off |
| 1.3 | Replication engine | Winner definition v2, pattern gap analysis, queue IA, experiment linkage | 1.3h signed off |
| 1.4 | Local listings/reviews | GBP read-path, health score, review monitoring, NAP checks | 1.4l signed off |
| 1.5 | Milestones/ATH | ATH metrics, rolling windows, celebration UX, history store | 1.5g signed off |

**Tier 1 closed when:** 1.1j, 1.2h, 1.3h, 1.4l, 1.5g all signed off + one internal dogfood week without P0 trust regressions.

### Tier 2 — Growth + differentiation

| Track | Focus | Key deliverables | Exit gate |
|-------|-------|-------------------|-----------|
| 2.1 | Revenue bridge | Signal inventory, identity graph feasibility, metric definitions, v1 bridge | 2.1g signed off |
| 2.2 | Weekly export | Audience variants, data inclusion rules, PDF/deck layout, generation pipeline | 2.2f signed off |
| 2.3 | Stronger competitor attack | Countermove taxonomy, one-click strategy, evidence packs, competitive narrative QA | 2.3h signed off |

**Tier 2 closed when:** 2.1g, 2.2f, 2.3h signed off + one agency pilot runs a week without manual spreadsheet side-channel.

**Full nano-phase breakdown:** Each track has 7-12 lettered research steps (e.g., 1.1a through 1.1j). Authoritative copy: `master_execution_plan.md` — heading **“Tiered product stack — research-led nano-phases (1.1a–2.3h)”** (section appears before **AUDIT SUMMARY** in that file).

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
