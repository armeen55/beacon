# Cursor Prompts by Phase

> Ready-to-paste prompts. Each prompt is bounded, validation-aware, and scope-controlled.
> Run mode indicated: COMPOSER (full agent) or OPUS EDIT (targeted edit).

---

## Phase 0A: Error Boundaries

### Prompt 0A-1 (COMPOSER)
```
Create error boundaries for the Next.js App Router shell.

Create these files:
1. src/app/(shell)/error.tsx
2. src/app/(shell)/settings/error.tsx

Requirements:
- Each must be a "use client" component (Next.js requirement for error.tsx)
- Accept { error, reset } props
- Display: centered layout, Beacon "B" logo, "Something went wrong" heading, error message (first 200 chars), "Try again" button calling reset()
- Use existing Tailwind classes: text-foreground, bg-background, border-border, rounded-lg, font-sans
- Use the Button component from @/components/ui/button
- Match the app's visual style (Geist font, clean spacing, muted colors)
- Do NOT add error logging yet (separate step)
- Do NOT modify any other files

Validation: Run npm run build after creating files. Both must compile without errors.
```

### Prompt 0A-2 (COMPOSER)
```
Create loading skeletons for the three heaviest routes.

Create these files:
1. src/app/(shell)/loading.tsx — matches the Today page layout
2. src/app/(shell)/pages/loading.tsx — matches the Pages page layout
3. src/app/(shell)/changes/loading.tsx — matches the Changes page layout

Requirements:
- Each exports a default function component (no "use client" needed for loading.tsx)
- Use the Skeleton component from @/components/ui/skeleton if it exists, otherwise use plain div with "animate-pulse bg-muted rounded" classes
- loading.tsx layout: simulate page header area + 3-4 card skeletons stacked vertically
- pages loading: simulate page header + summary strip + 5 row skeletons
- changes loading: simulate page header + tab bar + table with 5 row skeletons
- Use max-w-[1120px] mx-auto to match main content container
- Do NOT modify any other files

Validation: Run npm run build. All routes must still compile.
```

---

## Phase 0C: Dead-Weight Cleanup

### Prompt 0C-1 (OPUS EDIT)
```
Delete the following dead-weight directories and files from the repository:

1. Delete the entire changelogpdf/ directory (contains ~40 sample PDF files not used by the app)
2. Delete the entire src/adapters/legacy/ directory (contains only an empty README)
3. Delete the entire src/app/(shell)/actions/ directory (just a redirect to /)
4. Delete the entire src/app/(shell)/opportunities/ directory (just a redirect to /competitors)

Do NOT delete anything else.
Do NOT modify any other files.

After deletion, verify: npm run typecheck && npm run build
Both must pass cleanly.
```

---

## Phase 1A: Non-Blocking Scan

### Prompt 1A-1 (COMPOSER)
```
Refactor the Today route so the auto-scan does NOT block page render.

Current problem:
In src/app/(shell)/page.tsx lines 120-132, when scan is overdue, the page awaits runWebsiteScan() which runs a CLI subprocess with 120s timeout. This blocks the entire page render.

Required changes:

1. In src/app/(shell)/page.tsx:
   - Remove the `if (scanOverdue) { await runWebsiteScan(...) }` block (lines 120-132)
   - Keep the scanOverdue computation
   - Pass `scanOverdue` as a prop to the client component
   - Keep reading pageSnapshots and guardrailAlerts (they show last-known data even when scan hasn't run)

2. Create src/app/(shell)/scan-actions.ts (server action file):
   - "use server" directive
   - Export async function triggerBackgroundScan(): wraps runWebsiteScan({ trigger: "today" }), calls revalidatePath("/", "layout"), returns { ok, pagesScanned, pagesChanged, alertCount }
   - Export async function getScanStatus(): reads scan state from getScanState(), returns { phase, updatedAt, lastResult }

3. Create src/components/today/scan-status-banner.tsx (client component):
   - "use client" component
   - Props: { scanOverdue: boolean, lastScanAt: string | null }
   - On mount: if scanOverdue, call triggerBackgroundScan() action
   - Poll getScanStatus() every 5 seconds while scan is running
   - Display: "Scanning your pages..." with subtle animated indicator when running
   - Display: "Scan complete: X pages checked, Y changes, Z alerts" when done
   - Call router.refresh() when scan completes to refresh server data
   - Use existing Tailwind classes to match app style

4. In today-client.tsx: render ScanStatusBanner at the top of the page

Do NOT modify:
- src/domains/scanning/orchestrate-scan.ts
- src/domains/scanning/scan-state.ts
- Any other routes

Validation:
- npm run typecheck passes
- npm run build passes
- Today page loads in under 2 seconds even when scan is overdue
```

---

## Phase 1B: Today Simplification

### Prompt 1B-1 (OPUS EDIT)
```
Simplify the Today page to show only 5 focused sections instead of 15+.

Current state: src/app/(shell)/today-client.tsx renders ~15 sections. The morning briefing is overwhelming.

Target state: Today shows exactly these 5 sections:
1. Scan status banner (already added in previous step)
2. Primary action card + next moves (KEEP existing TodayPrimaryAction)
3. Findings queue — pending findings from crawl (KEEP existing findings section)
4. Visibility snapshot — compact KPI row: total citations, total mentions, trend %, platforms (KEEP but ensure compact)
5. Milestone teaser — when a milestone exists (KEEP existing milestone section)

Remove from today-client.tsx rendering:
- InlineReviewQueue (attribution queue) → replace with single line: "{count} visibility shifts need review → Changes" linking to /changes?tab=attribution
- Secondary recommendation cards → remove entirely
- Replication cards section → replace with single line under primary action: "{count} pages could benefit → Changes" linking to /changes?tab=replicate  
- TodayPerformance (performance trend) → remove entirely
- Accepted findings list → collapse to count: "{count} accepted findings"
- Full experiment cards → replace with compact line: "Watching {count} experiments ({promising} promising) → Changes"
- Verified fixes section → remove entirely
- Entity discrepancy section → remove entirely
- Local market urgent strip → keep ONLY if non-empty, make very compact

Also update src/app/(shell)/page.tsx server component:
- Remove computation for any data that's no longer passed to the client
- This includes: detailed experiment serialization, detailed recommendation serialization, replication card computation, performance timeseries, entity extraction, etc.
- Keep: primary action, findings, visibility summary, milestone, scan state, next moves

Do NOT modify:
- Any domain modules
- Any other routes
- The data computation logic itself (just stop calling it from Today)

Validation:
- npm run typecheck passes
- npm run build passes
- Today page renders with 5 clean sections
- page.tsx is under 600 lines
- today-client.tsx section count is 5 (verify by counting major section divs)
```

---

## Phase 1C: Render-Time Side Effects

### Prompt 1C-1 (OPUS EDIT)
```
Remove all write operations from the Today page render.

Current problem: src/app/(shell)/page.tsx has mutations during server component render:

1. Lines ~558-585: backfillFromExistingData() + persistOutcomes().catch(() => {})
2. Lines ~642-655: updateExperimentCitations() + persistExperiments().catch(() => {})

These are side effects during render. They should run on data change, not on page view.

Required changes:

1. Move outcome backfill:
   - In src/lib/import/actions.ts: after successful import, call backfillFromExistingData() and persistOutcomes()
   - Remove the backfill block from page.tsx
   - The outcomeSummary computation can still read outcomeRecords (it's a read)

2. Move experiment citation update:
   - In scan completion handler (src/app/(shell)/scan-actions.ts or orchestrate-scan.ts): after scan completes, call updateExperimentCitations for each active experiment and persistExperiments
   - Remove the experiment update block from page.tsx
   - The experiment serialization can still read from getActiveExperiments() (it's a read)

3. Verify no more writes:
   - Grep page.tsx for: persist, write, update, save, push (as function calls, not variable names)
   - The ONLY acceptable writes should be in server actions triggered by user interaction

Do NOT modify:
- The backfill logic itself
- The experiment update logic itself
- Domain store modules
- Other routes

Validation:
- npm run typecheck passes
- npm run build passes
- page.tsx has zero persist/write calls during render
```

---

## Phase 2A: Demo Mode Indicator

### Prompt 2A-1 (COMPOSER)
```
Add a "demo mode" banner when Beacon is showing sample data.

Context: When no import runs exist (_importRuns.length === 0 in src/lib/seed-data.server.ts), all routes show hardcoded Ritz Builders demo data. There's no UI indicator that this is sample data.

Required changes:

1. Create src/components/shell/demo-banner.tsx:
   - "use client" component
   - Props: { visible: boolean }
   - Renders a compact banner below the app header: "Viewing sample data — Import your data to get started →"
   - Link points to /settings/import
   - Uses existing colors: bg-status-warning/10 border-status-warning/30 text-foreground
   - Has a small dismiss button (X) that hides it for the session (useState)
   - When visible=false, renders nothing

2. In src/app/(shell)/layout.tsx:
   - Import hasActiveExperiment from @/lib/seed-data.server
   - Compute isDemoMode = !hasActiveExperiment()
   - Pass isDemoMode to a DemoBanner rendered between AppHeader and main content

Do NOT modify:
- src/lib/seed-data.server.ts
- src/lib/seed-data.ts
- Any route pages
- Any domain modules

Validation:
- npm run typecheck passes
- npm run build passes
- When .data/import-runs.json is empty or missing: banner shows
- When .data/import-runs.json has entries: banner hidden
```

---

## Phase 2B: Empty States

### Prompt 2B-1 (COMPOSER)
```
Add explicit empty states to the four primary routes when no data is imported.

Use the existing EmptyState component from src/components/data/empty-state.tsx.

Required changes:

1. In src/app/(shell)/today-client.tsx:
   - Add prop: hasData (boolean) 
   - When hasData is false, render EmptyState with:
     - icon: Sun (from lucide-react)
     - title: "Your morning briefing starts here"
     - description: "Import your visibility data to see what changed, what matters, and what to do next."
     - Add a Link button to /settings/import: "Import data"
   - In page.tsx: pass hasData = results.length > 0 || pendingFindings.length > 0

2. In src/app/(shell)/pages/pages-client.tsx:
   - Add empty state when pageRows array is empty:
     - icon: Globe (from lucide-react)  
     - title: "No pages tracked yet"
     - description: "Run a scan or import page data to see health, citations, and next steps for each URL."
     - Add Link buttons: "Run first scan" (triggers scan action) and "Import data" (link to /settings/import)

3. In src/app/(shell)/changes/scorecard-client.tsx:
   - Add empty state when rows array is empty:
     - icon: ListChecks (from lucide-react)
     - title: "No changes tracked yet"  
     - description: "Import your changelog data to track what worked, what to scale, and why visibility moved."
     - Add Link to /settings/import

4. Market route (src/app/(shell)/competitors/page.tsx):
   - Already has an empty state — verify it works correctly. No changes needed unless broken.

Do NOT modify:
- Domain modules
- Data computation logic
- Empty state component itself

Validation:
- npm run typecheck passes
- npm run build passes
- Each route shows proper empty state when corresponding data is empty
```

---

## Phase 3: Settings Coherence

### Prompt 3-1 (COMPOSER)
```
Fix the Settings section to be coherent.

Current problems:
- Config tab re-exports the setup wizard (/setup) — wrong context for returning users
- Health tab re-exports internal diagnostics — wrong audience for operators
- History tab labeled "Measurement History" — misleading name

Required changes:

1. In src/app/(shell)/settings/layout.tsx:
   - Change tabs array:
     - Keep: { href: "/settings/import", label: "Import" }
     - Change: { href: "/settings/config", label: "Config" }
     - REMOVE: { href: "/settings/health", label: "System Health" }
     - Change: { href: "/settings/history", label: "Data" }

2. Create new src/app/(shell)/settings/config/page.tsx (replace the re-export):
   - Server component that reads current business config and scan settings
   - Renders: business name, site domain, services list, locations list, scan schedule, scan timezone, scan scope
   - Each section is read-only display with an "Edit" button that opens inline editing
   - Use server actions to save changes (reuse existing saveScanSettings, saveBusinessConfig if available)
   - Use existing form components and styling

3. Update src/app/(shell)/settings/history/page.tsx:
   - Keep the re-export from results page
   - But add a PageHeader at the top: title "Imported Data", description "Your visibility data — the foundation Beacon builds analysis from."

Do NOT modify:
- The import page
- The diagnostics page itself (keep it at /diagnostics for developer access)
- Domain modules

Validation:
- npm run typecheck passes
- npm run build passes
- Settings shows 3 tabs: Import, Config, Data
- Config tab shows current settings (not setup wizard)
- Data tab shows imported results with proper framing
- /diagnostics still accessible directly by URL
```

---

## Phase 4: Component Splitting

### Prompt 4-1 (COMPOSER)
```
Split today-client.tsx into focused section components.

Current state: src/app/(shell)/today-client.tsx is 1217 lines with all Today sections inline.

After Phase 1B simplification, Today should have ~5 sections. Extract each into its own component:

1. Create src/components/today/today-scan-strip.tsx
   - Props: scan status data (ran, pages scanned, changed, alerts, lastScanAt)
   - Renders the scan status strip

2. Create src/components/today/today-primary-action.tsx  
   - Props: serialized primary action data + next moves + action handlers
   - Renders primary action card with confidence, rationale, expected outcome, watch-after, lineage bullets
   - Includes accept/defer/dismiss/start-experiment action buttons

3. Create src/components/today/today-findings.tsx
   - Props: serialized findings array + resolve/promote action handlers
   - Renders findings queue with priority badges, provenance, action buttons

4. Create src/components/today/today-visibility-snapshot.tsx
   - Props: visibility summary data (citations, mentions, platforms, trend)
   - Renders compact KPI row

5. Rewrite today-client.tsx as composition:
   - Import all section components
   - Pass props from TodayClient props to each section
   - Handle any cross-section state (useTransition for actions)
   - Target: < 300 lines

Do NOT modify:
- page.tsx server component
- Domain modules
- Other route components

Validation:
- npm run typecheck passes
- npm run build passes
- Today page renders identically to before splitting
- today-client.tsx < 300 lines
- Each section component < 250 lines
```

---

## Phase 5: Testing & Observability

### Prompt 5-1 (COMPOSER)
```
Add structured logging and scan crash recovery.

1. Create src/lib/logger.ts:
   - Export functions: logInfo(op, data), logWarn(op, data), logError(op, error, data)
   - Each outputs JSON to console: { level, op, timestamp, ...data }
   - Keep it simple — no external dependencies

2. Add logging to src/domains/scanning/orchestrate-scan.ts:
   - logInfo("scan:start", { trigger })
   - logInfo("scan:complete", { trigger, duration, pagesScanned, pagesChanged, findingsAdded })
   - logError("scan:failed", error, { trigger })

3. Add logging to src/lib/import/actions.ts:
   - logInfo("import:start", { entityType, source })
   - logInfo("import:complete", { entityType, rowCount, errors })

4. Add scan crash recovery to src/domains/scanning/scan-state.ts:
   - When writing running state, include startedAt timestamp
   - Add function isScanStale(): if phase is "running" AND startedAt > 3 minutes ago, return true
   - In scan-settings.ts isScanOverdue(): also return true if scan is stale (allows re-trigger)

Do NOT modify:
- Route pages
- Client components
- Build configuration

Validation:
- npm run typecheck passes
- npm run build passes
- npm test passes (existing tests should not break)
- Manually verify: set scan state to running with old timestamp → isScanOverdue returns true
```

---

## Master Execution Sequence

| Order | Prompt | Mode | Estimated Time |
|-------|--------|------|---------------|
| 1 | 0A-1: Error boundaries | COMPOSER | 30 min |
| 2 | 0A-2: Loading skeletons | COMPOSER | 30 min |
| 3 | 0C-1: Dead-weight cleanup | OPUS EDIT | 15 min |
| 4 | 1A-1: Non-blocking scan | COMPOSER | 2-3 hours |
| 5 | 1B-1: Today simplification | OPUS EDIT | 3-4 hours |
| 6 | 1C-1: Render-time side effects | OPUS EDIT | 1-2 hours |
| 7 | 2A-1: Demo mode banner | COMPOSER | 1 hour |
| 8 | 2B-1: Empty states | COMPOSER | 2 hours |
| 9 | 3-1: Settings coherence | COMPOSER | 3-4 hours |
| 10 | 4-1: Component splitting | COMPOSER | 3-4 hours |
| 11 | 5-1: Logging + scan recovery | COMPOSER | 2 hours |

**Total: ~18-22 hours of Cursor work across 11 prompts**
