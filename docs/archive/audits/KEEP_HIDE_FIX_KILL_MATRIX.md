# Keep / Hide / Merge / Fix / Kill Matrix

> Verified 2026-04-11 against branch `claude/amazing-shamir` at commit `dd121be`

---

## Primary Routes

| Surface | Label | Rationale |
|---------|-------|-----------|
| **Today (`/`)** | **FIX** | Core route, core value prop. But: move scan out of render, reduce to 3-5 primary sections, add error/loading boundaries, add demo-mode indicator, extract render-time side effects. |
| **Pages (`/pages`)** | **KEEP** | Strongest route. Page truth + fix briefs + verification workflow is differentiated. Minor: split mega-components, add pagination for large page counts, add explicit empty state. |
| **Market (`/competitors`)** | **KEEP** | Real competitive intelligence. Good empty state handling already. Minor: add first-run setup guidance, move competitor universe management higher. |
| **Changes (`/changes`)** | **KEEP** | Core "what worked" + replication. Tab structure works. Minor: clean up "Beacon Intel" terminology, improve replication tab empty state. |
| **Settings (`/settings`)** | **FIX** | Import tab is solid. But Config/Health/History are mismatched re-exports. Restructure: keep Import + Config, hide Health, rename History. |

---

## Settings Sub-Routes

| Surface | Label | Rationale |
|---------|-------|-----------|
| **Settings > Import** | **KEEP** | Real, functional import UI. Drag-drop, workbook, Profound adapter. Works. |
| **Settings > Config** | **FIX** | Re-exports setup wizard. Needs to become a real settings page for returning users, not an onboarding flow. |
| **Settings > Health** | **HIDE** | Internal attribution diagnostics. Wrong audience. Move to a developer-only route or behind a debug flag. Not for operators. |
| **Settings > History** | **FIX** | Re-exports results page. Rename to "Data" or "Measurements." The framing should reflect what it shows (imported visibility data), not imply a timeline of system actions. |

---

## Hidden Routes

| Surface | Label | Rationale |
|---------|-------|-----------|
| **`/diagnostics`** | **HIDE** | Real diagnostics, correctly hidden. Keep for developer use, don't surface to operators. |
| **`/expansion`** | **HIDE** | Quarantined hypothesis backlog. Correctly gated behind experiment-active. Keep as-is. |
| **`/briefs`** | **MERGE** | Brief management is useful but shouldn't be a standalone route. Merge into Pages (where briefs are already shown per-page). The proposed briefs view could be a section within Pages. |
| **`/briefs/proposed`** | **MERGE** | Same — merge into Pages as a section or filter view. |
| **`/briefs/[id]`** | **KEEP** | Detail view linked from brief cards. Keep as a detail route. |
| **`/review`** | **KEEP** | Already correctly embedded in Changes > Attribution tab. Keep as standalone for deep-link access. |
| **`/actions`** | **KILL** | Just a redirect to `/`. No purpose. Remove. |
| **`/opportunities`** | **KILL** | Just a redirect to `/competitors`. No purpose. Remove. |
| **`/topics`** | **HIDE** | Topic detail views accessible from command palette. Useful but not primary. Keep hidden. |
| **`/results`** | **MERGE** | Re-exported as Settings > History. Remove standalone route, keep only the settings path. |
| **`/observations/[id]`** | **KEEP** | Crawl proof detail. Linked from finding provenance. Essential for trust chain. |
| **`/setup`** | **MERGE** | Re-exported as Settings > Config. Remove standalone route, keep only the settings path. |
| **`/import`** | **MERGE** | Re-exported as Settings > Import. Remove standalone route, keep only the settings path. |

---

## Today Sections (within `/`)

| Section | Label | Rationale |
|---------|-------|-----------|
| **Scan Status Strip** | **KEEP** | Essential morning context. When scan ran, what it found. Keep compact. |
| **All Clear Indicator** | **FIX** | Good concept but needs to distinguish "all clear because nothing to do" from "all clear because nothing set up." |
| **Primary Action Card** | **KEEP** | Core value. The single most important thing. Keep prominent. |
| **Visibility Summary** | **KEEP** | Quick orientation. Total citations, platform breakdown, trend. Keep compact. |
| **Top 3 Actionable Changes** | **FIX** | Good but should only show when there are truly actionable items. Currently shows "validated" changes that may not need action. |
| **Attribution Review Queue** | **HIDE** | Belongs in Changes > Attribution tab, not on Today. Show only a badge/count on Today with link to Changes. |
| **Findings Queue (Tier 1A)** | **KEEP** | Real crawl-backed findings requiring operator attention. Keep on Today. |
| **Accepted Findings** | **HIDE** | Accepted findings don't need daily attention. Move to Pages or a Findings sub-view. |
| **Watchlist Experiments** | **FIX** | Good feature but clutters Today. Show only count + most urgent experiment. Full list should be on Changes. |
| **Secondary Recommendations** | **HIDE** | After the primary action, more recommendations is noise. Show on a separate view or collapse deeply. |
| **Replication Cards** | **HIDE** | Belongs on Changes > Replicate tab, not Today. Show badge/count only. |
| **Performance Trend** | **HIDE** | Interesting but not actionable on a daily basis. Move to a dedicated performance view or collapse. |
| **Milestone Teaser** | **KEEP** | Motivating, quick to scan, rare enough to be meaningful. Keep on Today. |
| **Local Market Urgent Strip** | **FIX** | Good concept but often empty. Only show when there's actually something urgent. |
| **Entity Discrepancies** | **HIDE** | Too technical for Today. Move to Pages or Settings > Health. |
| **Next Moves** | **KEEP** | Useful prioritized action list. Keep but merge with primary action area. |
| **Verified Fixes** | **HIDE** | Past-tense items don't belong on a forward-looking morning page. Move to Changes or Pages. |

**Recommended Today structure (5 sections)**:
1. Scan status + data freshness (compact strip)
2. Primary action + next moves (combined, prominent)
3. Findings queue (real crawl issues)
4. Visibility snapshot (compact KPI row)
5. Milestone teaser (when applicable, brief)

Everything else: accessible via route links, not cluttering Today.

---

## Domain Modules

| Domain | Label | Rationale |
|--------|-------|-----------|
| **pages** (28 files, 6350 lines) | **FIX** | Core domain. Real and necessary. But frontier-compiler.ts (505 lines) and frontier-planner.ts (261 lines) are speculative features not yet surfaced. Consider splitting or deferring. |
| **competitors** (26 files) | **KEEP** | Essential for Market route. Well-structured. |
| **product** (22 files) | **KEEP** | Recommendation + replication + priority + experiment engines. Core intelligence. |
| **attribution** (19 files) | **KEEP** | Core engine. Well-tested. Essential for Changes route. |
| **observations** (11 files) | **KEEP** | Crawl run management. Essential for scan provenance. |
| **scanning** (7 files) | **KEEP** | Scan orchestration + findings. Well-tested. Core pipeline. |
| **opportunities** (7 files) | **KEEP** | Opportunity scoring and guidance. Used by Market and Changes. |
| **actions** (7 files) | **FIX** | Action cluster detection. The standalone `/actions` route is dead, but the domain logic is used by Today and Pages. Keep domain, kill route. |
| **brief-generation** (8 files) | **KEEP** | Brief template creation. Used by Pages playbook briefs. |
| **briefs** (5 files) | **KEEP** | Brief types and lifecycle. Used across multiple routes. |
| **patterns** (5 files) | **KEEP** | Pattern detection for replication. Core to Changes > Replicate. |
| **opportunity-candidates** (6 files) | **HIDE** | Used by `/expansion` which is quarantined. Keep code but don't surface until needed. |
| **prompts** (6 files) | **KEEP** | Prompt library for geo coverage. Used by local operator surface. |
| **entity** (6 files) | **HIDE** | Entity extraction + discrepancy detection. Used by Today but adds cognitive load. Defer for v1. |
| **action-clusters** (5 files) | **KEEP** | Clustering logic used by diagnostics. Low maintenance burden. |
| **changelog** (3 files) | **KEEP** | Change contract types. Essential for Changes. |
| **results** (3 files) | **KEEP** | Result actions and scoring. Core data type. |
| **geo** (3 files) | **KEEP** | Geographic coverage. Used by local operator surface. |
| **local-operator** (2 files) | **FIX** | Good concept but often renders empty. Make more graceful when data is sparse. |
| **milestones** (6 files) | **KEEP** | Milestone computation. Well-integrated. Motivating for operators. |
| **answer-snapshots** (2 files) | **KEEP** | Answer snapshot types. Low maintenance. |
| **All remaining 1-file domains** | **KEEP** | Type definitions only. Zero maintenance burden. |

---

## Data Layer

| Surface | Label | Rationale |
|---------|-------|-----------|
| **File-based persistence (.data/)** | **KEEP** | Works, simple, no external dependency. Essential for single-operator deployment. |
| **Supabase integration** | **FIX** | Incomplete parity (scan outputs not synced). Either complete the sync or clearly document file-mode as primary for v1. |
| **Dual-write** | **FIX** | Best-effort Supabase write is fine but silent failures need logging. |
| **Module-level seed-data.server.ts** | **FIX** | Top-level await with frozen arrays is a staleness risk in production. Needs cache invalidation strategy or per-request initialization. |
| **json-store (in-memory cache)** | **FIX** | First-read-cached-forever is risky. Add TTL or invalidation on mutation. |
| **Seed data (Ritz Builders)** | **FIX** | Demo data is correct for walkthrough but needs "demo mode" UI indicator. |

---

## Components

| Surface | Label | Rationale |
|---------|-------|-----------|
| **Shell (sidebar, header, command palette, provider)** | **KEEP** | Clean, well-built, 5-item nav. |
| **Data components (21 files)** | **KEEP** | PageHeader, KpiCard, StatCard, etc. Good reusable components. |
| **Viz components (20 files)** | **KEEP** | ConfidenceBadge, FreshnessDot, Sparkline, etc. Essential for proof layer. |
| **Display components (16 files)** | **KEEP** | Badge variants, cards, metric displays. |
| **Form components (6 files)** | **KEEP** | Import forms, record sheets. |
| **Today components (1 file)** | **FIX** | "How We Know" panel is a single component but Today needs 5+ focused section components. |
| **Replication components (1 file)** | **KEEP** | ReplicationCardsClient. Well-isolated. |
| **Local operator components (1 file)** | **FIX** | LocalOperatorPanel. Needs better empty/sparse state handling. |

---

## Scripts & Tooling

| Surface | Label | Rationale |
|---------|-------|-----------|
| **scan-owned-pages.ts** | **KEEP** | Core scan CLI. Essential. |
| **build-page-registry.ts** | **KEEP** | Registry builder. |
| **score-snapshot.ts** | **KEEP** | Score computation. |
| **backfill-to-supabase.ts** | **KEEP** | Migration tool. |
| **compare-parity.ts** | **KEEP** | Parity verification. |
| **test-import.ts** | **KEEP** | Import testing. |
| **changelogpdf/** | **KILL** | 40 PDFs from sample data. Not used by app. Inflates repo. |
| **src/adapters/legacy/** | **KILL** | Empty adapter. Only README. Remove. |

---

## Tests

| Surface | Label | Rationale |
|---------|-------|-----------|
| **Existing 16 test files** | **KEEP** | All pass, well-written, cover critical domain logic. |
| **Route-level tests** | **ADD** | Zero route tests. Need at minimum: Today, Pages, Changes render without crash. |
| **Error boundary tests** | **ADD** | After adding error boundaries, test they catch and display errors. |
| **Import integration tests** | **ADD** | Test CSV → parse → persist → route-renders-new-data flow. |
| **Scan pipeline test** | **ADD** | Test orchestrate-scan → findings-generated → state-updated flow. |
