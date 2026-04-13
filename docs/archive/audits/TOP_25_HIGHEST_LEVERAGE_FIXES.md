# Top 25 Highest-Leverage Fixes

> Verified 2026-04-11 against branch `claude/amazing-shamir` at commit `dd121be`
> Ordered by launch-readiness impact. Each fix includes why it matters and what it unblocks.

---

## Tier 1: Launch Blockers (Must fix before any real user sees Beacon)

### 1. Add error boundaries to every route group
- **Why**: Any uncaught error (null reference, malformed data, network timeout) crashes the entire route with a white screen. Zero error.tsx files exist anywhere in the app.
- **What it unblocks**: Production safety. Without this, a single bad data row can make Beacon unusable.
- **Files**: Create `src/app/(shell)/error.tsx`, `src/app/(shell)/settings/error.tsx`. Consider per-route error.tsx for Today, Pages, Changes, Market.
- **Effort**: 2 hours
- **Impact**: Trust +20, Production readiness +15

### 2. Add loading states to heavy routes
- **Why**: Today (1087-line server component) and Pages (818 lines) do heavy computation. Without loading.tsx, users see blank white page during computation. Combined with scan-blocking on Today, this means up to 2 minutes of nothing.
- **What it unblocks**: Perceived performance. Operator trust that the app is working.
- **Files**: Create `src/app/(shell)/loading.tsx`, `src/app/(shell)/pages/loading.tsx`, `src/app/(shell)/changes/loading.tsx`
- **Effort**: 1 hour
- **Impact**: Trust +15, Premium feel +10

### 3. Move auto-scan out of Today render path
- **Why**: `page.tsx:120-132` awaits `runWebsiteScan()` during render. CLI has 120s timeout. First morning visit with overdue scan = blank page for up to 2 minutes. This destroys the morning ritual experience.
- **What it unblocks**: The core product promise — "open Beacon each morning and know what matters." Currently the morning visit is the worst experience.
- **Files**: `src/app/(shell)/page.tsx` (extract scan trigger to background), `src/domains/scanning/orchestrate-scan.ts` (add status polling or streaming)
- **Approach**: Trigger scan via server action on page load, show "scanning..." indicator, poll or stream results. Page renders immediately with stale data, refreshes when scan completes.
- **Effort**: 4-6 hours
- **Impact**: Trust +25, UX +20, Launch readiness +15

### 4. Add "demo mode" indicator when showing seed data
- **Why**: When `_importRuns.length === 0`, all routes show Ritz Builders demo data with no indicator. An operator could mistake demo data for real data, or think the product is broken because the data doesn't match their business.
- **What it unblocks**: Onboarding trust. New user immediately understands they're seeing a walkthrough, not their data.
- **Files**: `src/lib/seed-data.server.ts` (export `hasActiveExperiment()`), `src/app/(shell)/layout.tsx` (add banner), create `src/components/shell/demo-banner.tsx`
- **Effort**: 2 hours
- **Impact**: Trust +20, Onboarding +15

### 5. Add explicit empty states to every primary route
- **Why**: When a route has no data (no imports, no scan, no competitors configured), most routes render either broken-looking sparse content or nothing at all. Only Market has a decent empty state.
- **What it unblocks**: New user experience. Every route should tell the operator what to do to populate it.
- **Files**: Each route's page.tsx or client component. Reuse `EmptyState` component from `src/components/data/empty-state.tsx`.
- **Effort**: 3-4 hours
- **Impact**: Trust +15, Onboarding +10, UX +10

---

## Tier 2: Critical Quality (Fix before first 10 users)

### 6. Simplify Today to 5 focused sections
- **Why**: Today currently renders ~15 sections (scan status, primary action, visibility summary, 3 changes, review queue, findings, experiments, recommendations, replication, performance, milestones, local market, entity discrepancies, next moves, verified fixes). This is a "show everything" page, not a "morning briefing."
- **What it unblocks**: The core UX promise — open once, know what to do. Reduces cognitive load from "scan 15 sections" to "read 5 things."
- **Recommended structure**: (1) Scan status strip, (2) Primary action + next moves, (3) Findings queue, (4) Visibility snapshot, (5) Milestone teaser. Everything else: links to other routes.
- **Files**: `src/app/(shell)/page.tsx`, `src/app/(shell)/today-client.tsx`
- **Effort**: 6-8 hours
- **Impact**: UX +25, Cognitive load -30, Product clarity +15

### 7. Extract render-time side effects from Today
- **Why**: `page.tsx:558-585` calls `backfillFromExistingData()` + `persistOutcomes()`. Lines 642-655 call `updateExperimentCitations()` + `persistExperiments()`. These are mutations during server component render — technically side effects that could cause subtle bugs (double execution, race conditions).
- **What it unblocks**: Correctness. Predictable behavior. Safe re-renders.
- **Files**: `src/app/(shell)/page.tsx` — move to initialization server action or separate effect
- **Effort**: 2-3 hours
- **Impact**: Correctness +10, Reliability +10

### 8. Split mega-components (1000+ line files)
- **Why**: `today-client.tsx` (1217 lines), `pages-client.tsx` (1168 lines), `page.tsx` Today (1087 lines). These are unmaintainable, untestable, and make refactoring dangerous.
- **What it unblocks**: Testability. Maintainability. Ability to modify individual sections without risking the whole page.
- **Files**: Split each into focused section components (TodayScanStrip, TodayPrimaryAction, TodayFindings, etc.)
- **Effort**: 8-12 hours (across multiple sessions)
- **Impact**: Maintainability +20, Testability +15

### 9. Fix Settings sub-routes
- **Why**: Config re-exports setup wizard (onboarding context, not settings). Health re-exports diagnostics (developer tool, not operator). History re-exports results (raw data, not "history"). These are confusing.
- **What it unblocks**: Settings as a coherent section. Operators find what they expect.
- **Approach**: Keep Import. Create a real Config page for returning users (business info, scan schedule, scan scope). Hide Health behind developer flag. Rename History to "Data" and add contextual framing.
- **Files**: `src/app/(shell)/settings/config/page.tsx`, `src/app/(shell)/settings/health/page.tsx`, `src/app/(shell)/settings/history/page.tsx`
- **Effort**: 4-6 hours
- **Impact**: UX +10, Product coherence +10

### 10. Add basic structured logging
- **Why**: Zero observability. Scan failures, import errors, action failures, render errors — none are logged to any persistent store. In production, debugging is blind.
- **What it unblocks**: Production debugging. Incident response. Understanding what's happening.
- **Files**: Create `src/lib/logger.ts`. Add to scan orchestrator, import engine, server actions.
- **Effort**: 3-4 hours
- **Impact**: Production readiness +15, Debugging +20

---

## Tier 3: Product Quality (Fix before 50 users)

### 11. Add module-cache invalidation for seed-data.server
- **Why**: In production, `seed-data.server.ts` top-level await populates arrays once per process. Imports mutate the arrays in-place (visible within request) but new requests in a long-running process see the initial cached data. `revalidatePath()` triggers re-renders but doesn't bust the module cache.
- **What it unblocks**: Data freshness in production. Currently a user who imports data and then navigates to a different route may see stale data until process restart.
- **Approach**: Either add per-request fresh reads (move away from module-level), or implement cache version checking.
- **Files**: `src/lib/seed-data.server.ts`, `src/lib/persistence/repositories/index.ts`
- **Effort**: 4-6 hours
- **Impact**: Data truthfulness +15, Production safety +10

### 12. Add onboarding flow
- **Why**: New user opens Beacon → sees demo data (if fix #4 done, with banner). No guidance on: what to import, how to configure, what to do first. The import page exists but requires prior knowledge.
- **What it unblocks**: New user activation. First value delivery.
- **Approach**: First-visit detection → guided setup: (1) business config, (2) data import, (3) first scan. Could be a simple checklist on Today when no imports exist.
- **Files**: `src/app/(shell)/page.tsx` (onboarding detection), create `src/components/today/onboarding-checklist.tsx`
- **Effort**: 4-6 hours
- **Impact**: Onboarding +25, Activation +20

### 13. Clean dead-weight files
- **Why**: `changelogpdf/` (40 PDFs), `src/adapters/legacy/` (empty), redirect routes (`/actions`, `/opportunities`), duplicate route paths. Noise in the repo.
- **What it unblocks**: Repo clarity. Build hygiene. Signal-to-noise ratio for new contributors.
- **Files**: Delete `changelogpdf/`, delete `src/adapters/legacy/`, delete `src/app/(shell)/actions/`, delete `src/app/(shell)/opportunities/`
- **Effort**: 30 minutes
- **Impact**: Hygiene +10

### 14. Add route-level tests
- **Why**: Zero route tests exist. 77 tests cover only domain logic. If a route crashes on render, no test catches it.
- **What it unblocks**: Confidence in deployment. Regression detection for route-level changes.
- **Approach**: Smoke tests: each route renders without throwing. Use `@testing-library/react` or similar.
- **Files**: Create `tests/routes/` with smoke tests for each route
- **Effort**: 4-6 hours
- **Impact**: Test coverage +15, Deployment confidence +10

### 15. Add scan crash recovery
- **Why**: If Node process dies during scan, `.data/scan-state.json` stays `phase: "running"` forever. No watchdog or stale-lock detection. Subsequent scan checks see "already running" and skip.
- **What it unblocks**: Scan reliability. Self-healing after crashes.
- **Approach**: Add timestamp to running state. If running for > 3 minutes, consider stale and allow re-trigger.
- **Files**: `src/domains/scanning/scan-state.ts`, `src/domains/scanning/scan-settings.ts`
- **Effort**: 2 hours
- **Impact**: Reliability +10

---

## Tier 4: Polish & Differentiation (Fix before 100 users)

### 16. Add "data last imported" global indicator
- **Why**: No persistent indicator showing when data was last imported. Operator doesn't know if they're looking at fresh or stale data unless they check Settings > Import.
- **What it unblocks**: Ambient trust. Operator always knows data freshness.
- **Files**: `src/app/(shell)/layout.tsx` or `src/components/shell/app-header.tsx`
- **Effort**: 1-2 hours
- **Impact**: Trust +10

### 17. Reduce Pages information density
- **Why**: Each page row shows 10+ fields with 9 expandable sections. Justified for power users but overwhelming on first encounter.
- **What it unblocks**: Faster page-level decision making.
- **Approach**: Default view shows: label, status, citations, next move. Expand for details.
- **Files**: `src/app/(shell)/pages/pages-client.tsx`
- **Effort**: 4-6 hours
- **Impact**: UX +10, Cognitive load -10

### 18. Add dark mode
- **Why**: No dark mode. Many power users (especially technical operators) expect it. CSS variables are already set up for it.
- **What it unblocks**: User preference satisfaction. Premium feel.
- **Files**: `src/app/globals.css` (add dark theme variables), `src/app/layout.tsx` (theme toggle)
- **Effort**: 3-4 hours
- **Impact**: Premium feel +10

### 19. Clean "Beacon Intel" terminology
- **Why**: "Beacon Intel" column in scorecard, "Tier 1A," "Tier 1B" references, "change contract" — internal terminology that leaks to operators.
- **What it unblocks**: Copy clarity. Reduced learning curve.
- **Files**: `src/app/(shell)/changes/scorecard-client.tsx`, `src/app/(shell)/today-client.tsx`
- **Effort**: 1-2 hours
- **Impact**: Copy clarity +5

### 20. Add competitive trend over time
- **Why**: Market route shows snapshot rankings but no trend. "Competitor X gained 5% share this month" is more actionable than "Competitor X has 23% share."
- **What it unblocks**: Competitive intelligence depth. Actionable pressure signals.
- **Files**: `src/app/(shell)/competitors/page.tsx`, `src/domains/competitors/` (add trend computation)
- **Effort**: 6-8 hours
- **Impact**: Market route usefulness +15

---

## Tier 5: Scalability & Hardening (Post-launch)

### 21. Add pagination to Pages route
- **Why**: Pages renders all pages in a flat list. Works for 20 pages, performance degrades at 200+.
- **Files**: `src/app/(shell)/pages/pages-client.tsx`
- **Effort**: 3-4 hours

### 22. Complete Supabase parity for scan outputs
- **Why**: Scan CLI writes only to `.data/` files. No sync to Supabase for page snapshots, guardrails, findings.
- **Files**: `scripts/scan-owned-pages.ts`, `src/domains/scanning/orchestrate-scan.ts`
- **Effort**: 8-12 hours

### 23. Add health check endpoint
- **Why**: No way to verify production readiness. Load balancers, monitoring, and deployment automation need health checks.
- **Files**: Create `src/app/api/health/route.ts`
- **Effort**: 1 hour

### 24. Bridge revenue/business metrics
- **Why**: Copy says "business consequence" but attribution stops at visibility. Real business impact requires form submissions, phone calls, or revenue data.
- **Files**: `src/lib/import/engine.ts` (add business metric type), domain modules
- **Effort**: 12-20 hours

### 25. Add E2E test suite
- **Why**: Zero E2E tests. Full user journeys (import → scan → view findings → resolve → verify) are untested.
- **Files**: Set up Playwright, create test scenarios
- **Effort**: 12-20 hours
