# Beacon Verified Current Audit

> Verified 2026-04-11 against branch `claude/amazing-shamir` at commit `dd121be`

---

## 1. WHAT BEACON ACTUALLY IS RIGHT NOW

Beacon is a **real, functional, over-built prototype** of a daily AI visibility operating system.

It has genuine intelligence: a working scan pipeline, real attribution engine, real finding detection, real pattern mining, real recommendation system, real replication engine, and real competitive analysis. The domain model is deep and well-typed.

It is NOT fake. But it is not yet launchable.

The gap is not "this doesn't work" — the gap is "this works but the operator doesn't know what to do with it."

**Current state in one sentence**: A staff-engineer-quality domain model and data pipeline wrapped in a UI that asks too much of the operator and doesn't yet handle real-world edges (errors, empty states, demo-vs-real, slow loads).

---

## 2. ROUTE-BY-ROUTE AUDIT

### 2.1 TODAY (`/`)

**Files**: `src/app/(shell)/page.tsx` (1087 lines), `src/app/(shell)/today-client.tsx` (1217 lines)

**What it does**: Morning briefing. Shows scan status, primary action, visibility summary, top changes, attribution review queue, findings, experiments, recommendations, replication, performance, milestones, local market alerts, entity discrepancies, next moves, and verified fixes.

**Classification**: REAL BUT FRAGILE

**Strengths**:
- The "primary action" card is genuinely smart — computed from validated changes, pattern match, citation opportunity, and track record
- Finding queue is real (backed by actual crawl diffs, not heuristics)
- Attribution review queue surfaces real undecided visibility events
- Experiment watchlist with citation delta tracking is a real product feature
- "All clear" state exists and is computed correctly (`shouldShowTodayAllClear()`)
- Copy is operator-focused and honest ("Why did visibility change?", not "Your SEO score is 85!")

**Problems**:
1. **Scan blocks render up to 120s** (`page.tsx:120`). First morning visit on overdue scan = blank page for 2 minutes. No loading indicator, no streaming, no progressive render.
2. **1087-line server component** doing 15+ distinct computations in a single render. This is a maintainability and performance problem. If any computation throws, the entire page crashes (no error boundary).
3. **~15 distinct UI sections** in the client component. Cognitive overload for an operator who just wants "what matters today."
4. **No error boundary** — any data issue crashes the whole page.
5. **No loading state** — route-level Suspense would help during heavy computation.
6. **Demo data not labeled** — when no imports exist, the operator sees Ritz Builders data with no "this is demo data" indicator.
7. **Outcome backfill runs in render** (`page.tsx:558-585`) — `backfillFromExistingData()` and `persistOutcomes()` are called during render. This is a mutation during render, which is technically a side effect in RSC.
8. **Experiment citations updated in render** (`page.tsx:642-655`) — `updateExperimentCitations()` and `persistExperiments()` called during render. Same side-effect problem.

**Verdict**: The intelligence is real. The UX is too much. The render-time side effects are a correctness risk. The scan-blocking is a launch blocker.

---

### 2.2 PAGES (`/pages`)

**Files**: `src/app/(shell)/pages/page.tsx` (818 lines), `src/app/(shell)/pages/pages-client.tsx` (1168 lines)

**What it does**: Page health dashboard. Shows every tracked URL with: status, citations, changes, events, trust level, evidence tier, snapshot data, diffs, guardrail alerts, fix briefs, playbook briefs, rollout waves, pending findings, issue workflow.

**Classification**: REAL

**Strengths**:
- Page truth is genuinely backed by crawl data (live HTML fetch, snapshot comparison)
- Status classification (winning/building/unresolved/dormant) is computed from real signals
- Fix briefs connect crawl issues to actionable remediation with verification checklists
- Playbook briefs surface validated patterns with specific recommendations
- Issue workflow (new → handed_off → shipped → verified) is a real operator flow
- Evidence tiers (exact > probable > weak > inferred) are honest about certainty
- Rollout waves coordinate multi-page changes — a real feature

**Problems**:
1. **1168-line client component** — too much in one file. Should be split by section.
2. **Information density is very high** — an operator looking at a page row sees: label, status, reason, opportunity score, next move, topics, platforms, citations, changes, events, trust, evidence tier. Plus expandable sections for snapshots, diffs, events, changes, guardrails, fix briefs, playbook briefs, findings, and wave assignment. This is exhausting.
3. **No pagination** — renders all pages in a flat list. Works for 20 pages, breaks at 200.
4. **Empty state for "no pages yet"** is implied but not explicitly designed.
5. **Stale pages section** shows pages not in canonical sitemap — useful but could confuse operators who don't understand sitemaps.

**Verdict**: The strongest route. Page truth + fix briefs + rollout waves is a differentiated product. Needs density reduction and component splitting.

---

### 2.3 MARKET (`/competitors`)

**Files**: `src/app/(shell)/competitors/page.tsx` (604 lines), `competitors-manage-client.tsx` (208 lines), plus section components (co-mention, source-trust, local-pressure, battlecard)

**What it does**: Competitive analysis. Shows AI share benchmark, competitor rankings, topic signals (where you lead/lose/are weak), discovered competitors, growth opportunities, co-mention matrix, source trust index, local pressure cities, battlecards.

**Classification**: REAL BUT DATA-DEPENDENT

**Strengths**:
- Ranked threats table with citation share comparison is genuinely useful
- Topic signals (where you lead / highest pressure / thinnest share) is clear competitive intelligence
- Discovered competitors (new domains in AI citations) is a unique feature
- Growth opportunities combining losses + weaknesses is actionable
- Battlecards per competitor are real competitive playbooks
- Copy is excellent: "Who beats you, where they beat you, and exactly what to do about it."

**Problems**:
1. **Entirely dependent on imported citation data** — without imports, shows full empty state ("Competitive ranking needs imported citation data"). This is correct behavior but means the route is useless until first import.
2. **Co-mention matrix computed on first visit** (`page.tsx:45-51`) — `computeCoMentionMatrix()` runs if no cached version exists, then persists. This is computation-on-first-render, though much lighter than Today's scan.
3. **Competitor universe management** is buried at the bottom ("Universe & Data Setup" collapsible). Should be more prominent for first-time setup.
4. **Local pressure section** is useful but depends on geo data + prompt library — may be empty for many operators.
5. **No competitive trend over time** — rankings are snapshot-based, not time-series.

**Verdict**: Strong route with real competitive intelligence. Data-dependent is acceptable (the product can't fake this). Needs better first-run guidance.

---

### 2.4 CHANGES (`/changes`)

**Files**: `src/app/(shell)/changes/page.tsx` (594 lines), `changes-tab-shell.tsx` (81 lines), `scorecard-client.tsx`

**What it does**: Change impact analysis. Three tabs: Outcomes (scorecard + verdicts), Replicate (pattern targets), Attribution (review queue). Shows every changelog entry with verdict, confidence, evidence tier, events, score, trust source.

**Classification**: REAL

**Strengths**:
- Scorecard table is the core "what worked" view — genuinely useful
- Verdicts (validated/partial/inconclusive/pending/too_early/no_impact/negative) are computed from real attribution data
- Evidence tiers provide honest certainty levels
- Replication tab connects validated patterns to target pages — bridges "what worked" to "what to do next"
- Attribution tab surfaces undecided visibility events for operator review
- Track record (momentum section) shows overall success rate — builds operator confidence
- Milestones section highlights all-time highs and first-time outcomes
- Tab structure keeps the route organized

**Problems**:
1. **Scorecard rows can be dense** — each row shows 10+ fields. Filters help but default view may overwhelm.
2. **"Beacon Intel" column** terminology is internal/jargon — operators may not understand what this means.
3. **Change contracts section** is powerful but may confuse operators who don't understand what a "contract" means in this context.
4. **Replication tab is empty without validated changes** — needs better empty state messaging.

**Verdict**: The strongest analytical route. Scorecard + replication is Beacon's core value proposition. Needs mild terminology cleanup.

---

### 2.5 SETTINGS

**Files**: `src/app/(shell)/settings/layout.tsx` (42 lines), sub-routes are re-exports

**What it does**: Four tabs — Import, Config, System Health, Measurement History. Each re-exports a standalone page.

**Sub-routes**:
- `/settings/import` → `src/app/(shell)/import/page.tsx` — Real import UI with drag-drop, workbook upload, Profound adapter, manual CSV/JSON, data coverage display, import history, reset capability
- `/settings/config` → `src/app/(shell)/setup/page.tsx` — Business configuration (domain, services, locations, etc.)
- `/settings/health` → `src/app/(shell)/diagnostics/page.tsx` — Attribution diagnostics, candidate analysis, pattern/cluster analysis, model report
- `/settings/history` → `src/app/(shell)/results/page.tsx` — Measurement history and citation evidence

**Classification**: REAL BUT FRAGMENTED

**Strengths**:
- Import flow is real and works (workbook upload, Profound adapter, CSV/JSON)
- Config captures actual business parameters
- Health/diagnostics provides real system introspection
- Settings layout with tab navigation is clean

**Problems**:
1. **Re-export pattern is fragile** — `/settings/import` re-exports from `../../import/page`, meaning the same page exists at both `/import` and `/settings/import`. This is a routing duplication that could cause confusion.
2. **Config page is the setup wizard re-exported** — it's not a "settings" page, it's an onboarding flow shown in a settings context. May confuse returning users.
3. **Health tab is the diagnostics page** — extremely technical, full of attribution model internals. Not appropriate for most operators. Should be hidden or simplified.
4. **History tab is the results page** — shows raw measurement data. Useful but feels disconnected from the "settings" framing.

**Verdict**: Import is solid. The other three tabs are real pages awkwardly surfaced in a settings context. Config and Health need rethinking.

---

### 2.6 HIDDEN ROUTES

| Route | Classification | Notes |
|-------|---------------|-------|
| `/diagnostics` | REAL, INTERNAL | Attribution model diagnostics. Useful for debugging, not for operators. Correctly hidden from nav. |
| `/expansion` | QUARANTINED | Opportunity hypothesis backlog, gated behind experiment-active flag. Correctly quarantined. |
| `/briefs`, `/briefs/[id]`, `/briefs/proposed` | REAL, UNDER-SURFACED | Brief management. Accessible from Pages but not from nav. Could be valuable if properly surfaced. |
| `/review` | REAL, PROPERLY EMBEDDED | Attribution review queue. Correctly embedded in Changes tab rather than standalone. |
| `/actions` | REDIRECT | Legacy → redirects to `/`. Correct. |
| `/opportunities` | REDIRECT | Legacy → redirects to `/competitors`. Correct. |
| `/topics`, `/topics/opportunity/[id]` | REAL, ORPHANED | Topic detail views. Not linked from nav. Accessible from command palette. |
| `/results`, `/results/[id]` | REAL, RE-EXPORTED | Citation evidence. Accessible via `/settings/history` and direct URL. |
| `/observations/[id]` | REAL, LINKED | Observation run detail. Linked from crawl proof references. Correct. |
| `/setup` | REAL, RE-EXPORTED | Setup wizard. Accessible via `/settings/config` and direct URL. |
| `/import` | REAL, RE-EXPORTED | Import UI. Accessible via `/settings/import` and direct URL. |

---

## 3. DATA / SCAN / TRUTH AUDIT

### 3.1 Scan Pipeline

**Flow**: `runWebsiteScan()` → `execAsync(scan-owned-pages.ts)` → writes `.data/*.json` → `regenerateScanFindings()` → `addFindings()` → returns result

**Classification**: REAL

**Evidence**:
- CLI fetches actual sitemap.xml from live site
- Fetches each canonical page with real HTTP requests (15s timeout, 300ms delay)
- Extracts real page data: title, meta, h1, schema, FAQs, links, word count
- Computes real diffs vs previous snapshots
- Writes structured JSON (not regex-parsed CLI output)
- Findings are generated from actual diff analysis with priority scoring

**Risks**:
- 120s CLI timeout — legitimate for 50+ pages but harsh for render-blocking
- No retry on transient network failure
- No crash recovery if Node process dies mid-scan (scan-state stays "running")
- No rate limiting awareness for target site

### 3.2 Findings System

**Classification**: REAL

**Evidence**:
- 15 distinct finding types, each derived from actual scan data comparison
- Priority scoring uses real signals: severity, homepage status, citation count, changelog contradiction
- Dedup by ID prevents duplicates
- Suppression system allows "expected" findings to be silenced
- Max 500 findings with oldest-resolved pruning
- 5 tests specifically cover scan orchestration, state, delegation, revalidation, and fresh snapshots

### 3.3 Attribution Engine

**Classification**: REAL AND SOPHISTICATED

**Evidence**:
- Outcome events detected from result data (first_appearance, visibility_regained, mention_surge, visibility_lost, mention_decline)
- Candidate discovery links events to changelog entries + opportunities
- Triage system classifies candidates (primary, contributing, auto-resolved, needs-review)
- Scoring combines temporal proximity, topic match, asset relevance
- Judgment builder creates human-readable explanations
- Event decisions persist operator approvals
- Citation decay detection tracks declining pages
- Golden tests + invariant tests validate scoring logic

### 3.4 Recommendation Engine

**Classification**: REAL

**Evidence**:
- `src/domains/product/recommendation-engine.ts` computes recommendations from: impact rows, patterns, briefs, page snapshots, citation data
- Types include: investigate, strengthen, strengthen_structure, improve_internal_links, refresh_content, competitive_displacement, cross_page_pattern, topic_cluster_gap, refresh_stale_citation
- Priority engine (`priority-engine.ts`) ranks and selects single primary action
- Track record (`recommendation-tracker.ts`) measures historical success rate
- Response store persists accept/dismiss/defer decisions
- Experiment store tracks watch-list items with citation deltas

### 3.5 Data Freshness

| Data | Freshness | Mechanism |
|------|-----------|-----------|
| Page snapshots | **FRESH** | `readDotDataJson()` — no cache, disk read every time |
| Guardrail alerts | **FRESH** | `readDotDataJson()` — no cache |
| Scan state | **FRESH** | `readDotDataJson()` — no cache |
| Citation evidence | **FRESH** | `readDotDataJson()` — no cache |
| Results, changes, opportunities, competitors | **MODULE-CACHED** | Populated once via `seed-data.server.ts` top-level await. Mutations visible within request, but stale across requests in long-running process |
| Event decisions | **MODULE-CACHED** | Same pattern via `attribution/store.ts` |
| Import runs | **MODULE-CACHED** | Same pattern |
| Recommendation responses | **IN-MEMORY** | `json-store` cache — first read cached for process lifetime |
| Experiments | **IN-MEMORY** | `json-store` cache |
| Page issues | **IN-MEMORY** | `json-store` cache |

**Risk**: In development (`next dev`), modules are re-evaluated frequently. In production (`next start`), module-cached data persists for the process lifetime. This means production may show stale import data if the process isn't restarted after imports. The `revalidatePath()` calls trigger re-renders but don't bust the module cache.

---

## 4. UX / OPERATOR AUDIT

### 4.1 Cognitive Load

**Today**: HIGH. 15+ sections competing for attention. The operator must scan: scan status, primary action, visibility summary, actionable changes, review queue, findings, experiments, recommendations, replication, performance, milestones, local market, next moves, verified fixes. Even with section prioritization, this is too much for a "what do I do now" morning visit.

**Pages**: HIGH but appropriate. This is a power-user view. Filters (Fix/Winning/Watch/All) help. The information density is justified for a page health dashboard. The expandable sections keep the default view manageable.

**Market**: MEDIUM. Clear hierarchy: KPIs → rankings → topic signals → discovered competitors → growth opportunities. The progressive disclosure works. Gets complex at the bottom (battlecards, co-mention matrix, source trust index) but those are optional deep-dives.

**Changes**: MEDIUM. Tab structure helps. Scorecard table is dense but filterable. Replication tab is focused. Attribution tab is the most complex (requires understanding event → candidate → triage → decision) but is appropriately for advanced users.

**Settings**: LOW. Simple tab navigation. Import UI is clear. Config is standard form. Health is technical but appropriately nested.

### 4.2 Primary Action Clarity

**Today**: The primary action card is well-designed — single action, confidence badge, rationale, expected outcome, watch-after description, lineage bullets. This IS the product's core value when it works. But it competes with 14 other sections.

**Pages**: Next move per page (double_down / review_signals / strengthen_evidence / wait / no_action) is clear. But it's one field among 10+ per row.

**Market**: "Suggested move" on discovered competitors is clear. Growth opportunities have clear rationale. But there's no single "do this first" across the route.

**Changes**: Verdicts are clear. But "what to do about it" is implicit (you replicate winners, investigate losers) rather than explicit.

### 4.3 Trust Signals

**Strong**:
- Confidence badges (high/medium/low) with explanations
- Evidence tiers (exact > probable > weak > inferred) with dot colors
- Freshness dots (fresh/aging/stale/abandoned)
- Trust sources (operator_confirmed > auto_cleared > system_primary > contributing > candidate)
- Crawl proof links (observation run detail)
- Data freshness timestamps in captions
- "How We Know" panel on Today
- Finding provenance (scan run ID, crawl proof href)

**Missing**:
- No "this is demo data" indicator when showing seed data
- No "data last imported X days ago" global indicator
- No "scan last ran X hours ago" persistent indicator (only shown on Today when scan runs)
- No confidence explanation for market-level metrics (share calculations, etc.)

### 4.4 Premium Feel

**Strong**:
- Geist font family (clean, modern)
- Consistent spacing and padding
- Semantic color system (success/warning/danger/neutral + accent-primary)
- Subtle border opacity variants (border/50, border/70)
- Smooth transitions (transition-colors, duration-100)
- Keyboard shortcuts (G T, G P, etc.)
- Command palette with search
- Compact but readable typography scale

**Weak**:
- No dark mode (only light)
- No animations or micro-interactions beyond hover states
- No skeleton loading (because no loading states)
- No empty state illustrations
- No onboarding flow (just seed data → import)
- Some sections have very dense 8-10px text that feels cramped on larger screens

---

## 5. ENGINEERING / ARCHITECTURE AUDIT

### 5.1 Architecture Quality

**Domain boundaries**: EXCELLENT. 31 domains with clear separation. Each has types, compute, selectors/builders, store, and actions as needed. No cross-domain imports that violate boundaries (domains reference lib/ utilities and each other through well-defined interfaces).

**File organization**: GOOD. `src/domains/`, `src/lib/`, `src/components/`, `src/adapters/`, `src/app/`, `src/storage/`, `scripts/`, `tests/` — all logical and consistent.

**Type safety**: EXCELLENT. Strict TypeScript, no `any` escape hatches visible. Constants use `as const` arrays with type inference. Domain types are well-defined and specific.

### 5.2 Technical Debt

1. **Today page.tsx (1087 lines)** — Needs decomposition. Extract computation into separate functions/modules. Split client component into sections.
2. **Pages pages-client.tsx (1168 lines)** — Same. Needs component splitting.
3. **today-client.tsx (1217 lines)** — Same.
4. **Render-time side effects** — `backfillFromExistingData()`, `persistOutcomes()`, `updateExperimentCitations()`, `persistExperiments()` called during render. Should be moved to server actions or initialization hooks.
5. **Settings re-export pattern** — Same page at two routes. Should be a redirect or shared component, not re-export.
6. **No error boundaries** — A thrown error in any computation crashes the entire route with no recovery.
7. **No loading states** — Heavy server computation with no Suspense boundaries means users see nothing during load.
8. **Module-level top-level await** — `seed-data.server.ts` blocks module initialization. In production, this means the first request to any route pays the full initialization cost. Subsequent requests within the same process see cached data.
9. **6350 lines in pages domain** — Largest domain by far. Some files (frontier-compiler.ts: 505 lines, playbook.ts: 553 lines, competitor-evidence.ts: 426 lines) could be split.

### 5.3 Dead Code

- `changelogpdf/` — 40 PDF files from sample changelog entries. Not imported by application. Should be gitignored or removed.
- `src/adapters/legacy/` — Contains only README.md. Empty adapter. Remove.
- `/actions` route — Just a redirect. Could be removed.
- `/opportunities` route — Just a redirect. Could be removed.
- `src/storage/canonical-store.ts` — Contains in-memory arrays that duplicate some json-store functionality. May be partially redundant.

### 5.4 Server/Client Boundary

**Correct patterns**:
- Server components fetch data, pass as serialized props to client components
- Server actions mutate data and call `revalidatePath()`
- `"server-only"` import guard on server modules
- No client-side data fetching (SWR/React Query not used)

**Incorrect patterns**:
- Mutations during server component render (outcome backfill, experiment citation update)
- Shell layout pays full seed-data initialization cost for every route

### 5.5 Deployment Risk

| Risk | Severity | Evidence |
|------|----------|----------|
| No error boundaries | **HIGH** | Any uncaught error crashes the route |
| Today scan blocks render | **HIGH** | 120s timeout, no loading indicator |
| Module-level data cache in production | **MEDIUM** | Stale data possible if process lives long |
| No health check endpoint | **MEDIUM** | No way to verify production readiness |
| No observability | **MEDIUM** | No structured logging, no metrics, no tracing |
| Supabase parity incomplete | **LOW** | File backend works, Supabase is optional |
| changelogpdf/ in repo | **LOW** | 40 PDFs inflating repo size |

---

## 6. FAKE VS REAL AUDIT

### Classification by Area

| Area | Classification | Evidence |
|------|---------------|----------|
| **Scan pipeline** | REAL | Fetches live pages, computes real diffs, generates real findings |
| **Finding detection** | REAL | 15 finding types from actual snapshot comparison with priority scoring |
| **Attribution engine** | REAL | Event detection, candidate discovery, triage, scoring — all algorithmic from real data |
| **Recommendation engine** | REAL | Computed from validated changes, patterns, citation data |
| **Priority engine** | REAL | Single primary action selected from ranked recommendations |
| **Replication engine** | REAL | Pattern mining → target identification → rollout coordination |
| **Competitive analysis** | REAL BUT DATA-DEPENDENT | All intelligence derived from imported citation data. No data = empty. |
| **Page truth** | REAL | Live crawl data, snapshot comparison, diff detection |
| **Fix briefs** | REAL | Connect guardrail issues to actionable remediation |
| **Playbook briefs** | REAL | Pattern-based recommendations with verification checklists |
| **Issue workflow** | REAL | new → handed_off → shipped → verified with live verification |
| **Experiment tracking** | REAL | Citation delta monitoring over time |
| **Milestone detection** | REAL | All-time highs and first-time outcomes computed from data |
| **Local operator surface** | REAL BUT FRAGILE | Depends on geo coverage + local import data — often empty |
| **Co-mention matrix** | REAL | Computed from citation evidence cross-references |
| **Source trust index** | REAL | Platform trust patterns from citation data |
| **Battlecards** | REAL | Per-competitor competitive intel from multiple data sources |
| **Seed data walkthrough** | COSMETIC | Ritz Builders demo data looks real but isn't. No indicator. |
| **Revenue/business consequence** | COSMETIC | Copy says "business consequence" but no revenue data exists |
| **"Premium" metrics display** | HALF-REAL | Numbers are real when data exists, but presentation suggests insight depth that requires more data |
| **Today "All Clear"** | REAL | Computed from actual state — no findings, no actions, no stale data |
| **Settings > Health** | REAL BUT MISPLACED | Real diagnostics, wrong audience (internal debugging, not operator) |

### Biggest Illusions

1. **Demo data as product experience** — When no imports exist, Beacon shows Ritz Builders data across all routes. An operator could think this is their data. There's no "demo mode" banner.
2. **Business consequence framing** — Copy references "business impact" but no revenue, leads, or conversion data exists. Attribution stops at visibility (citations/mentions).
3. **"System Health" in settings** — Attribution model diagnostics are presented as "system health" — suggests the system is monitoring itself, but it's really showing model internals.
4. **Today's 15 sections suggest completeness** — The sheer volume of sections implies comprehensive coverage, but many sections are empty or thin for a new user.

### Where Beacon Is Better Than You Think

1. **The scan-to-finding pipeline is genuinely production-quality**. Live crawl → snapshot diff → priority-scored findings with provenance. This is not a prototype.
2. **The attribution engine is real science**. Candidate discovery, temporal scoring, triage classification, operator verification — this is a legitimate attribution system.
3. **The replication engine bridges insight to action**. Validated change → pattern mine → target pages → rollout wave. This is a real product loop.
4. **The proof layer is honest**. Confidence badges, evidence tiers, trust sources, freshness dots — Beacon actively tells you when it's uncertain. This builds real trust.
5. **The fix brief + verification workflow is a complete loop**. Detect issue → generate brief → hand off → verify ship → confirm in production. This is a real operator workflow.
