# Phased Path to Launch

> Verified 2026-04-11 against branch `claude/amazing-shamir` at commit `dd121be`
> Phases ordered by launch-readiness impact. Each phase has clear acceptance criteria.

---

## Phase 0: Foundation Safety (LAUNCH BLOCKER)
**Goal**: Make Beacon safe enough to not crash in front of a user.
**Duration**: 1-2 days
**Prerequisite**: None

### Track A: Error Boundaries
1. Create `src/app/(shell)/error.tsx` — catches all route errors, shows friendly "Something went wrong" with retry button
2. Create `src/app/(shell)/settings/error.tsx` — same for settings sub-routes
3. Test: throw an error in Today computation → error boundary catches it, shows recovery UI
4. **Acceptance**: No route can crash to white screen

### Track B: Loading States
1. Create `src/app/(shell)/loading.tsx` — Skeleton layout matching shell (sidebar + content area)
2. Create `src/app/(shell)/pages/loading.tsx` — Page list skeleton
3. Create `src/app/(shell)/changes/loading.tsx` — Scorecard skeleton
4. **Acceptance**: Heavy routes show loading skeleton during computation

### Track C: Dead-Weight Cleanup
1. Delete `changelogpdf/` directory (40 PDFs)
2. Delete `src/adapters/legacy/` directory (empty)
3. Delete `src/app/(shell)/actions/` directory (redirect route)
4. Delete `src/app/(shell)/opportunities/` directory (redirect route)
5. Update `.gitignore` if needed
6. **Acceptance**: `npm run build` still passes, no dead routes

---

## Phase 1: Morning Experience (LAUNCH BLOCKER)
**Goal**: The Today route works as a morning ritual, not a 2-minute blank screen.
**Duration**: 2-3 days
**Prerequisite**: Phase 0

### Track A: Non-Blocking Scan
1. Extract scan trigger from `page.tsx:120-132` into a separate mechanism
2. Create scan status component that shows "Scanning your pages..." with progress
3. Today renders immediately with last-known data
4. When scan completes, trigger `revalidatePath("/")` to refresh
5. Option A: Use a server action triggered by client-side `useEffect` + polling
6. Option B: Use a server action with streaming status updates
7. **Acceptance**: Today loads in <2s even when scan is overdue. Scan runs in background. Page refreshes when scan completes.

### Track B: Today Simplification
1. Identify the 5 core sections: scan status, primary action + next moves, findings, visibility KPIs, milestone teaser
2. Move remaining sections (attribution queue, experiments, secondary recs, replication, performance, entity discrepancies, verified fixes, accepted findings) to expandable "More" or remove from Today entirely
3. Add links to Changes, Pages, Market for the removed sections
4. **Acceptance**: Today renders 5 sections max. Operator scans page in <30 seconds.

### Track C: Render-Time Side Effects
1. Move `backfillFromExistingData()` + `persistOutcomes()` out of Today render (`page.tsx:558-585`)
2. Move `updateExperimentCitations()` + `persistExperiments()` out of render (`page.tsx:642-655`)
3. Either run these on import/scan completion, or as a separate initialization action
4. **Acceptance**: Today render has zero write operations. All computation is read-only.

---

## Phase 2: Trust & Onboarding (LAUNCH BLOCKER)
**Goal**: New user understands what they're seeing and can get started.
**Duration**: 2-3 days
**Prerequisite**: Phase 0

### Track A: Demo Mode Indicator
1. Create `src/components/shell/demo-banner.tsx` — sticky banner: "You're viewing sample data. Import your data to get started."
2. Detect demo mode: `hasActiveExperiment()` === false (from seed-data.server)
3. Pass flag from shell layout to banner component
4. Banner links to `/settings/import`
5. **Acceptance**: When no imports exist, every route shows demo banner. After first import, banner disappears.

### Track B: Empty States
1. Today empty state: "Import data to see your morning briefing" (when no imports AND no scan data)
2. Pages empty state: "Run your first scan or import page data to see your pages" (when no page snapshots)
3. Changes empty state: "Import changelog data to track what's working" (when no changelog entries)
4. Market empty state: Already exists, verify it works
5. Each empty state includes a primary CTA button linking to appropriate import/setup
6. **Acceptance**: Every route handles "no data" gracefully with clear guidance.

### Track C: Data Freshness Indicator
1. Add "Data imported X days ago" to shell header or footer
2. Show "Last scan: X hours ago" in compact format
3. Use FreshnessDot styling (fresh/aging/stale)
4. **Acceptance**: Operator always knows data freshness without navigating to Settings.

---

## Phase 3: Settings Coherence (PRE-LAUNCH)
**Goal**: Settings makes sense as a section.
**Duration**: 1-2 days
**Prerequisite**: Phase 2

### Track A: Fix Config Tab
1. Replace setup wizard re-export with a real settings page for returning users
2. Show current business config in editable form (site domain, business name, services, locations)
3. Show scan schedule settings (preferred hour, timezone, scope)
4. **Acceptance**: Config tab shows current settings with edit capability, not onboarding wizard.

### Track B: Hide Health Tab
1. Remove Health tab from settings layout tabs array
2. Keep `/diagnostics` route for developer access
3. Optional: add a small "Developer Tools" link at bottom of settings page
4. **Acceptance**: Operators don't see internal diagnostics. Developers can still access via URL.

### Track C: Rename History Tab
1. Rename "Measurement History" to "Data" or "Imported Data"
2. Add framing text: "Your imported visibility data. This is the foundation Beacon builds analysis from."
3. **Acceptance**: Tab label and content framing match what the operator sees.

### Track D: Remove Duplicate Routes
1. Remove standalone `/import` route (keep only `/settings/import`)
2. Remove standalone `/setup` route (keep only `/settings/config`)
3. Remove standalone `/results` route (keep only `/settings/history`)
4. Add redirects from old paths to new paths for any existing links
5. **Acceptance**: Each page exists at exactly one URL path.

---

## Phase 4: Component Quality (PRE-LAUNCH)
**Goal**: Code is maintainable enough to iterate quickly post-launch.
**Duration**: 3-4 days
**Prerequisite**: Phase 1

### Track A: Split Today Components
1. Extract `TodayScanStrip` from today-client.tsx (scan status section)
2. Extract `TodayPrimaryAction` (already partially exists but inline)
3. Extract `TodayFindings` (findings queue section)
4. Extract `TodayVisibilitySnapshot` (KPI row)
5. Extract `TodayMilestoneTeaser` (milestone section)
6. Reduce today-client.tsx to composition of focused components
7. **Acceptance**: today-client.tsx < 300 lines, each section component < 200 lines

### Track B: Split Pages Components
1. Extract `PageRowCard` (single page row with expandable sections)
2. Extract `PageSnapshotDetail` (crawl data section)
3. Extract `PageEventsTimeline` (events section)
4. Extract `PageFixBrief` (fix brief section)
5. Extract `PagePlaybookBrief` (playbook brief section)
6. Reduce pages-client.tsx to composition
7. **Acceptance**: pages-client.tsx < 400 lines

### Track C: Split Today Server Computation
1. Extract visibility summary computation to `src/lib/today-summary.ts` or separate module
2. Extract citation/pattern/brief computation to separate functions
3. Extract experiment/outcome computation to separate functions
4. Today page.tsx imports and calls these, then passes results to client
5. **Acceptance**: page.tsx < 400 lines, each computation module is focused and testable

---

## Phase 5: Testing & Observability (PRE-LAUNCH)
**Goal**: Confidence in deployment and ability to debug production issues.
**Duration**: 2-3 days
**Prerequisite**: Phase 0, Phase 4

### Track A: Route Smoke Tests
1. Create test that renders Today page without throwing
2. Create test that renders Pages page without throwing
3. Create test that renders Changes page without throwing
4. Create test that renders Market page without throwing
5. Create test that renders Settings page without throwing
6. **Acceptance**: 5 new route smoke tests pass

### Track B: Structured Logging
1. Create `src/lib/logger.ts` with structured log output (JSON, levels)
2. Add logging to scan orchestrator (scan start, scan complete, scan error)
3. Add logging to import engine (import start, row counts, errors)
4. Add logging to server actions (action name, success/failure)
5. **Acceptance**: Key operations emit structured logs visible in production

### Track C: Scan Recovery
1. Add `startedAt` timestamp to running scan state
2. In `isScanOverdue()`, check if running state is older than 3 minutes → treat as stale
3. Allow re-trigger when stale
4. **Acceptance**: Scan recovers from process crash without manual intervention

---

## Phase 6: Polish (POST-LAUNCH PRIORITY)
**Goal**: Premium feel and reduced cognitive load.
**Duration**: 3-5 days
**Prerequisite**: Phase 1-5

### Track A: Terminology Cleanup
1. Replace "Beacon Intel" with clearer label (e.g., "Beacon recommended" badge only)
2. Replace "change contract" with "change log" or "change record"
3. Replace "Tier 1A" / "Tier 1B" references with human-readable labels
4. Review all copy for internal jargon

### Track B: Pages Density Reduction
1. Default page row shows: label, status badge, citation count, next move
2. Additional fields visible on click/expand only
3. Keep full detail in expanded view
4. **Acceptance**: Page list scannable without horizontal scrolling

### Track C: Dark Mode
1. Add dark theme CSS variables to globals.css
2. Add theme toggle in header
3. Persist preference
4. **Acceptance**: Dark mode functional with no broken contrast

### Track D: Competitive Trends
1. Add time-series tracking for competitor citation share
2. Show trend arrows/sparklines in Market rankings table
3. **Acceptance**: Market shows directional change, not just snapshot

---

## Phase 7: Revenue Bridge (POST-LAUNCH)
**Goal**: Connect visibility to business outcomes.
**Duration**: 5-10 days
**Prerequisite**: Phase 6

### Track A: Business Metric Import
1. Add "conversions" or "leads" entity type to import engine
2. Parse form submissions, phone calls, or revenue data
3. Link to pages and changes via URL/time matching

### Track B: Business Impact Attribution
1. Extend attribution engine to connect visibility changes → business metric changes
2. Add "estimated business impact" to scorecard verdicts
3. Show on Today as proof of value

### Track C: Honest Business Framing
1. Only show "business impact" copy when business data exists
2. When visibility-only, say "visibility impact" not "business impact"
3. **Acceptance**: Copy matches available data depth

---

## Phase Summary

| Phase | Duration | Launch Status | Primary Impact |
|-------|----------|--------------|----------------|
| 0: Foundation Safety | 1-2 days | BLOCKER | Production safety |
| 1: Morning Experience | 2-3 days | BLOCKER | Core UX |
| 2: Trust & Onboarding | 2-3 days | BLOCKER | New user trust |
| 3: Settings Coherence | 1-2 days | PRE-LAUNCH | Product coherence |
| 4: Component Quality | 3-4 days | PRE-LAUNCH | Maintainability |
| 5: Testing & Observability | 2-3 days | PRE-LAUNCH | Deployment confidence |
| 6: Polish | 3-5 days | POST-LAUNCH | Premium feel |
| 7: Revenue Bridge | 5-10 days | POST-LAUNCH | Business value proof |

**Total to launch-ready (Phases 0-2)**: 5-8 days
**Total to production-confident (Phases 0-5)**: 12-17 days
**Total to polished v1 (Phases 0-6)**: 15-22 days
