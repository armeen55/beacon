# Micro-Step Execution Plan

> Verified 2026-04-11. Every step is a single bounded task.
> Steps marked LAUNCH-BLOCKING must be completed before first real user.

---

## Phase 0: Foundation Safety

### Track 0A: Error Boundaries

| Step | Goal | Files | Prerequisite | Acceptance | Risk | Mode | Launch Status | Increases |
|------|------|-------|-------------|------------|------|------|--------------|-----------|
| 0A-1 | Create shell error boundary | Create `src/app/(shell)/error.tsx` | None | Route errors show "Something went wrong" with retry button instead of white screen | Low | COMPOSER | BLOCKING | Trust, Safety |
| 0A-2 | Create settings error boundary | Create `src/app/(shell)/settings/error.tsx` | None | Settings sub-route errors caught | Low | COMPOSER | BLOCKING | Trust, Safety |
| 0A-3 | Test error boundary catch | Temporarily throw error in Today computation, verify boundary catches it | 0A-1 | Error caught, recovery UI shown, no white screen | Low | MANUAL CHECK | BLOCKING | Trust |
| 0A-4 | Style error boundary to match app | Update error.tsx styling — use app fonts, colors, centered layout | 0A-1 | Error page looks like Beacon, not a generic error | Low | COMPOSER | BLOCKING | Premium |

### Track 0B: Loading States

| Step | Goal | Files | Prerequisite | Acceptance | Risk | Mode | Launch Status | Increases |
|------|------|-------|-------------|------------|------|------|--------------|-----------|
| 0B-1 | Create shell loading skeleton | Create `src/app/(shell)/loading.tsx` with sidebar + content skeleton matching app layout | None | Heavy routes show loading state instead of blank | Low | COMPOSER | BLOCKING | Trust, UX |
| 0B-2 | Create pages loading skeleton | Create `src/app/(shell)/pages/loading.tsx` with page-list skeleton | None | Pages route shows list skeleton during load | Low | COMPOSER | BLOCKING | UX |
| 0B-3 | Create changes loading skeleton | Create `src/app/(shell)/changes/loading.tsx` with table skeleton | None | Changes route shows table skeleton during load | Low | COMPOSER | BLOCKING | UX |

### Track 0C: Dead-Weight Cleanup

| Step | Goal | Files | Prerequisite | Acceptance | Risk | Mode | Launch Status | Increases |
|------|------|-------|-------------|------------|------|------|--------------|-----------|
| 0C-1 | Delete changelogpdf directory | Delete `changelogpdf/` (40 PDFs) | None | Directory gone, build passes | Low | OPUS EDIT | BLOCKING | Hygiene |
| 0C-2 | Delete legacy adapter | Delete `src/adapters/legacy/` | None | Directory gone, build passes | Low | OPUS EDIT | BLOCKING | Hygiene |
| 0C-3 | Delete /actions redirect route | Delete `src/app/(shell)/actions/` | None | Route removed, build passes | Low | OPUS EDIT | BLOCKING | Hygiene |
| 0C-4 | Delete /opportunities redirect route | Delete `src/app/(shell)/opportunities/` | None | Route removed, build passes | Low | OPUS EDIT | BLOCKING | Hygiene |
| 0C-5 | Verify build after cleanup | Run `npm run check` | 0C-1 through 0C-4 | Typecheck, lint, build all pass | Low | MANUAL CHECK | BLOCKING | Confidence |

---

## Phase 1: Morning Experience

### Track 1A: Non-Blocking Scan

| Step | Goal | Files | Prerequisite | Acceptance | Risk | Mode | Launch Status | Increases |
|------|------|-------|-------------|------------|------|------|--------------|-----------|
| 1A-1 | Create scan status server action | Create `src/app/(shell)/scan-status-action.ts` — returns current scan state (idle/running/complete/failed) and last result | Phase 0 | Action returns scan state correctly | Medium | COMPOSER | BLOCKING | Trust |
| 1A-2 | Create trigger-scan server action | Create `src/app/(shell)/trigger-scan-action.ts` — triggers scan without blocking, returns immediately | Phase 0 | Scan starts in background, action returns `{ started: true }` | Medium | COMPOSER | BLOCKING | UX |
| 1A-3 | Remove scan-in-render from Today page.tsx | Remove lines 120-132 (the `if (scanOverdue) await runWebsiteScan()` block). Replace with: check scan state, if overdue, mark `shouldTriggerScan = true`, pass to client | 1A-1, 1A-2 | Today renders immediately even when scan is overdue | High | OPUS EDIT | BLOCKING | UX, Trust |
| 1A-4 | Create ScanStatusBanner client component | Create `src/components/today/scan-status-banner.tsx` — shows "Scanning..." with progress when scan is running. On mount, if `shouldTriggerScan`, calls trigger-scan action. Polls scan-status-action every 5s. When complete, calls `router.refresh()` | 1A-1, 1A-2 | Banner shows scan progress, page refreshes on completion | Medium | COMPOSER | BLOCKING | UX, Trust |
| 1A-5 | Wire ScanStatusBanner into Today | Import and render `ScanStatusBanner` in today-client.tsx at top of page | 1A-3, 1A-4 | Scan triggers on load if overdue, shows progress, refreshes on complete | Medium | OPUS EDIT | BLOCKING | UX |
| 1A-6 | Test morning flow end-to-end | Mark scan as overdue, load Today, verify: (1) page loads fast, (2) banner shows, (3) scan runs, (4) page refreshes with new data | 1A-5 | Full flow works | Medium | MANUAL CHECK | BLOCKING | Trust |

### Track 1B: Today Simplification

| Step | Goal | Files | Prerequisite | Acceptance | Risk | Mode | Launch Status | Increases |
|------|------|-------|-------------|------------|------|------|--------------|-----------|
| 1B-1 | Map current Today sections | List all sections in today-client.tsx with line numbers. Classify each as: KEEP-ON-TODAY, MOVE-TO-ROUTE, or COLLAPSE | Phase 0 | Clear section map with decisions | Low | OPUS AUDIT | BLOCKING | Clarity |
| 1B-2 | Remove attribution review queue from Today | Remove InlineReviewQueue rendering from today-client.tsx. Replace with compact line: "X visibility shifts need review" → link to /changes?tab=attribution | 1B-1 | Queue removed, link added | Medium | OPUS EDIT | BLOCKING | Cognitive load |
| 1B-3 | Remove secondary recommendations from Today | Remove secondary recommendation cards. Keep only primary action | 1B-1 | Only one action card visible | Medium | OPUS EDIT | BLOCKING | Cognitive load |
| 1B-4 | Remove replication cards from Today | Remove replication section. Add compact note under primary action if replication targets exist: "N pages could benefit from this pattern" → link to /changes?tab=replicate | 1B-1 | Replication cards gone, link added | Medium | OPUS EDIT | BLOCKING | Cognitive load |
| 1B-5 | Remove performance trend from Today | Remove TodayPerformance section. This data lives on Changes route | 1B-1 | Performance section gone | Low | OPUS EDIT | BLOCKING | Cognitive load |
| 1B-6 | Remove entity discrepancies from Today | Remove entity extraction + discrepancy detection section | 1B-1 | Entity section gone | Low | OPUS EDIT | BLOCKING | Cognitive load |
| 1B-7 | Collapse accepted findings | Move accepted findings into a tiny summary line (count only) below findings queue | 1B-1 | Accepted findings reduced to count | Low | OPUS EDIT | BLOCKING | Cognitive load |
| 1B-8 | Collapse experiments to compact summary | Replace full experiment cards with compact line: "Watching N experiments (N promising)" → link to /changes | 1B-1 | Experiment detail moved, compact summary on Today | Medium | OPUS EDIT | BLOCKING | Cognitive load |
| 1B-9 | Remove verified fixes from Today | Move to Pages or Changes. Not forward-looking, doesn't belong on morning page | 1B-1 | Section gone | Low | OPUS EDIT | BLOCKING | Cognitive load |
| 1B-10 | Remove unused server computation from page.tsx | After sections removed from client, remove corresponding computation from page.tsx server component. This reduces the 1087-line file significantly | 1B-2 through 1B-9 | page.tsx < 600 lines | Medium | OPUS EDIT | BLOCKING | Performance, Maintainability |
| 1B-11 | Verify simplified Today | Load Today, verify 5 sections render: scan status, primary action + next moves, findings, visibility KPIs, milestone teaser | 1B-10 | Clean, focused morning page | Low | MANUAL CHECK | BLOCKING | UX |

### Track 1C: Render-Time Side Effects

| Step | Goal | Files | Prerequisite | Acceptance | Risk | Mode | Launch Status | Increases |
|------|------|-------|-------------|------------|------|------|--------------|-----------|
| 1C-1 | Move outcome backfill to post-import | Move `backfillFromExistingData()` call from page.tsx:558-585 to import action completion. Call `persistOutcomes()` after import, not during render | Phase 0 | Backfill runs on import completion, not on Today render | Medium | OPUS EDIT | BLOCKING | Correctness |
| 1C-2 | Move experiment citation update to post-scan/import | Move `updateExperimentCitations()` from page.tsx:642-655 to scan completion or import completion | 1C-1 | Citation update runs after data changes, not during render | Medium | OPUS EDIT | BLOCKING | Correctness |
| 1C-3 | Verify Today render is read-only | Audit page.tsx for any remaining write operations during render. Grep for `persist`, `write`, `update`, `save` calls | 1C-1, 1C-2 | Zero mutations during render | Low | OPUS AUDIT | BLOCKING | Correctness |

---

## Phase 2: Trust & Onboarding

### Track 2A: Demo Mode Indicator

| Step | Goal | Files | Prerequisite | Acceptance | Risk | Mode | Launch Status | Increases |
|------|------|-------|-------------|------------|------|------|--------------|-----------|
| 2A-1 | Create DemoBanner component | Create `src/components/shell/demo-banner.tsx`. Sticky banner below header: "Viewing sample data — Import your data to get started →". Link to /settings/import. Dismissable | Phase 0 | Component renders correctly | Low | COMPOSER | BLOCKING | Trust |
| 2A-2 | Pass demo mode flag from shell layout | In `src/app/(shell)/layout.tsx`, import `hasActiveExperiment()`, pass `isDemoMode={!hasActiveExperiment()}` to shell | Phase 0 | Flag correctly computed | Low | OPUS EDIT | BLOCKING | Trust |
| 2A-3 | Render DemoBanner conditionally | In shell layout, render DemoBanner when isDemoMode is true | 2A-1, 2A-2 | Banner shows when no imports, hidden when imports exist | Low | OPUS EDIT | BLOCKING | Trust |
| 2A-4 | Test demo mode detection | Verify: (1) fresh app with no .data/ → banner shows, (2) after import → banner gone | 2A-3 | Both states work | Low | MANUAL CHECK | BLOCKING | Trust |

### Track 2B: Empty States

| Step | Goal | Files | Prerequisite | Acceptance | Risk | Mode | Launch Status | Increases |
|------|------|-------|-------------|------------|------|------|--------------|-----------|
| 2B-1 | Add Today empty state | In today-client.tsx: when no imports, no scan data, no findings → show "Import your data to see your morning briefing" with CTA to /settings/import | Phase 1 | Today shows guidance when empty | Low | COMPOSER | BLOCKING | Trust |
| 2B-2 | Add Pages empty state | In pages-client.tsx: when no page snapshots → show "Run your first scan or import data to see your pages" with CTA | Phase 0 | Pages shows guidance when empty | Low | COMPOSER | BLOCKING | Trust |
| 2B-3 | Add Changes empty state | In changes scorecard: when no changelog entries → show "Import changelog data to track what's working" with CTA | Phase 0 | Changes shows guidance when empty | Low | COMPOSER | BLOCKING | Trust |
| 2B-4 | Verify Market empty state | Market already has empty state. Verify it renders correctly and links to import | Phase 0 | Market empty state works | Low | MANUAL CHECK | BLOCKING | Trust |
| 2B-5 | Add "All Clear" refinement | Distinguish "all clear — nothing to do" from "all clear — nothing set up". When no data exists, don't show All Clear | Phase 1 | All Clear only shows when data exists AND nothing needs attention | Low | OPUS EDIT | BLOCKING | Trust |

### Track 2C: Data Freshness Indicator

| Step | Goal | Files | Prerequisite | Acceptance | Risk | Mode | Launch Status | Increases |
|------|------|-------|-------------|------------|------|------|--------------|-----------|
| 2C-1 | Create DataFreshnessStrip component | Create `src/components/shell/data-freshness-strip.tsx`. Compact bar: "Data: imported X ago · Last scan: X ago". Use FreshnessDot colors | Phase 0 | Component renders with timestamps | Low | COMPOSER | BLOCKING | Trust |
| 2C-2 | Compute freshness data in shell layout | In layout.tsx, read latest import run date and latest scan run date. Pass to strip | 2C-1 | Dates computed correctly | Low | OPUS EDIT | BLOCKING | Trust |
| 2C-3 | Render strip below header or in header | Add DataFreshnessStrip to shell layout | 2C-1, 2C-2 | Strip visible on all routes | Low | OPUS EDIT | BLOCKING | Trust |

---

## Phase 3: Settings Coherence

| Step | Goal | Files | Prerequisite | Acceptance | Risk | Mode | Launch Status | Increases |
|------|------|-------|-------------|------------|------|------|--------------|-----------|
| 3-1 | Create real Config page | Replace `src/app/(shell)/settings/config/page.tsx` re-export with a proper settings page. Show current business config (domain, name, services, locations) in editable form. Show scan settings (schedule, timezone, scope) | Phase 2 | Config page shows editable current settings | Medium | COMPOSER | Pre-launch | UX |
| 3-2 | Hide Health tab | Remove "System Health" from settings tabs in `src/app/(shell)/settings/layout.tsx` | Phase 0 | Health tab not visible in Settings nav | Low | OPUS EDIT | Pre-launch | UX |
| 3-3 | Rename History tab | Change "Measurement History" label to "Data" in settings layout tabs | Phase 0 | Tab says "Data" not "Measurement History" | Low | OPUS EDIT | Pre-launch | UX |
| 3-4 | Add framing to Data tab | Add header text: "Your imported visibility data — the foundation Beacon builds analysis from" | 3-3 | Tab has contextual framing | Low | OPUS EDIT | Pre-launch | UX |
| 3-5 | Remove standalone /import route | Delete `src/app/(shell)/import/`, update settings/import to inline the import page instead of re-exporting | Phase 2 | Import only accessible at /settings/import | Medium | OPUS EDIT | Pre-launch | Coherence |
| 3-6 | Remove standalone /setup route | Delete or redirect `src/app/(shell)/setup/` | 3-1 | Setup only accessible at /settings/config | Low | OPUS EDIT | Pre-launch | Coherence |
| 3-7 | Remove standalone /results route | Delete or redirect `src/app/(shell)/results/` | Phase 0 | Results only accessible at /settings/data | Low | OPUS EDIT | Pre-launch | Coherence |
| 3-8 | Verify settings navigation | Navigate all settings tabs, verify each works | 3-1 through 3-7 | All tabs functional, no broken links | Low | MANUAL CHECK | Pre-launch | Trust |

---

## Phase 4: Component Quality

| Step | Goal | Files | Prerequisite | Acceptance | Risk | Mode | Launch Status | Increases |
|------|------|-------|-------------|------------|------|------|--------------|-----------|
| 4-1 | Extract TodayScanStrip | Extract scan status rendering from today-client.tsx to `src/components/today/today-scan-strip.tsx` | Phase 1 | Component renders scan status independently | Low | COMPOSER | Pre-launch | Maintainability |
| 4-2 | Extract TodayPrimaryAction | Extract primary action card rendering to `src/components/today/today-primary-action.tsx` | Phase 1 | Component handles action display + response actions | Medium | COMPOSER | Pre-launch | Maintainability |
| 4-3 | Extract TodayFindings | Extract findings queue rendering to `src/components/today/today-findings.tsx` | Phase 1 | Component handles finding display + resolve/promote actions | Medium | COMPOSER | Pre-launch | Maintainability |
| 4-4 | Extract TodayVisibilitySnapshot | Extract visibility KPI row to `src/components/today/today-visibility-snapshot.tsx` | Phase 1 | Component renders KPI cards independently | Low | COMPOSER | Pre-launch | Maintainability |
| 4-5 | Compose Today from extracted components | Rewrite today-client.tsx as composition of extracted components | 4-1 through 4-4 | today-client.tsx < 300 lines | Medium | OPUS EDIT | Pre-launch | Maintainability |
| 4-6 | Extract PageRowCard | Extract single page row from pages-client.tsx to `src/components/pages/page-row-card.tsx` | Phase 0 | Component renders one page row with all expandable sections | Medium | COMPOSER | Pre-launch | Maintainability |
| 4-7 | Compose Pages from extracted components | Rewrite pages-client.tsx as list of PageRowCard components + filters + summary | 4-6 | pages-client.tsx < 400 lines | Medium | OPUS EDIT | Pre-launch | Maintainability |
| 4-8 | Extract Today server computation | Move visibility summary, pattern mining, experiment serialization to separate modules imported by page.tsx | Phase 1 | page.tsx < 400 lines, each module focused | Medium | OPUS EDIT | Pre-launch | Maintainability |
| 4-9 | Verify all routes after refactor | Run `npm run check`, load each route | 4-5, 4-7, 4-8 | Build passes, all routes render correctly | Low | MANUAL CHECK | Pre-launch | Confidence |

---

## Phase 5: Testing & Observability

| Step | Goal | Files | Prerequisite | Acceptance | Risk | Mode | Launch Status | Increases |
|------|------|-------|-------------|------------|------|------|--------------|-----------|
| 5-1 | Create structured logger | Create `src/lib/logger.ts` — JSON output, log levels (info/warn/error), context (operation, duration) | Phase 0 | Logger module works | Low | COMPOSER | Pre-launch | Observability |
| 5-2 | Add logging to scan orchestrator | Import logger in orchestrate-scan.ts. Log: scan start, scan complete (duration, pages), scan error | 5-1 | Scan operations logged | Low | OPUS EDIT | Pre-launch | Observability |
| 5-3 | Add logging to import engine | Import logger in import/engine.ts. Log: import start, row counts, errors, completion | 5-1 | Import operations logged | Low | OPUS EDIT | Pre-launch | Observability |
| 5-4 | Add logging to server actions | Import logger in key server actions. Log: action name, success/failure | 5-1 | Actions logged | Low | OPUS EDIT | Pre-launch | Observability |
| 5-5 | Create route smoke test for Today | Create `tests/routes/today.test.ts`. Mock seed-data, verify page renders | Phase 4 | Test passes | Medium | COMPOSER | Pre-launch | Test coverage |
| 5-6 | Create route smoke test for Pages | Create `tests/routes/pages.test.ts` | Phase 4 | Test passes | Medium | COMPOSER | Pre-launch | Test coverage |
| 5-7 | Create route smoke test for Changes | Create `tests/routes/changes.test.ts` | Phase 4 | Test passes | Medium | COMPOSER | Pre-launch | Test coverage |
| 5-8 | Create route smoke test for Market | Create `tests/routes/market.test.ts` | Phase 4 | Test passes | Medium | COMPOSER | Pre-launch | Test coverage |
| 5-9 | Add scan crash recovery | Add `startedAt` to running state in `scan-state.ts`. In `isScanOverdue()`, if running > 3min → treat as stale | Phase 0 | Stuck scans auto-recover | Low | OPUS EDIT | Pre-launch | Reliability |
| 5-10 | Run full test suite | `npm run check` + `npm test` | All Phase 5 | Everything passes | Low | MANUAL CHECK | Pre-launch | Confidence |

---

## Step Count Summary

| Phase | Steps | Estimated Time |
|-------|-------|---------------|
| Phase 0: Foundation Safety | 12 | 1-2 days |
| Phase 1: Morning Experience | 20 | 2-3 days |
| Phase 2: Trust & Onboarding | 12 | 2-3 days |
| Phase 3: Settings Coherence | 8 | 1-2 days |
| Phase 4: Component Quality | 9 | 3-4 days |
| Phase 5: Testing & Observability | 10 | 2-3 days |
| **Total to production-ready** | **71 steps** | **12-17 days** |
