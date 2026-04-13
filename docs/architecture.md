# Beacon Architecture

> **PURPOSE:** System map. Routes, domains, data flow, persistence, scan pipeline, import pipeline.
> This file answers: "How does the system fit together?"
>
> **NOT FOR:** What to do next (→ `NEXT_PHASE_EXECUTION_PLAN.md`), current state summary (→ `HANDOFF_VERIFIED_STATE.md`), historical phase details (→ `master_execution_plan.md`).

---

## What Beacon Is

Beacon is an attribution-triage system for AI/AEO visibility.
It ingests changes (what you did) and results (what happened), then uses deterministic logic to connect cause and effect.

**Stack:** Next.js 16 (App Router), React 19, TypeScript strict, `.data/*.json` persistence, optional Supabase dual-write.

---

## Data Flow

```
Workbook/CSV Import (or Profound adapter)
    ↓
Changes + Results + Opportunities + Competitors
    ↓
Candidate Discovery (change × result scoring)
    ↓
Auto-Triage (confirm/reject/review)
    ↓
Outcome Events (derived from result time series)
    ↓
Event Resolution (attributed / no_cause / pending)
    ↓
Recommendations (replicate / strengthen / investigate)
    ↓
Priority Engine (single primary action)
    ↓
Today Morning Briefing
```

---

## Routes

### Primary navigation (6 items — `src/lib/navigation.ts`)

| Route | Component | What it does | Score |
|-------|-----------|-------------|-------|
| **Today** `/` | `page.tsx` → `today-data.ts` → `today-client.tsx` | Morning briefing: scan status, optional **local attention** strip (`TodayLocalAttentionStrip` from `getLocalPresenceSnapshot` when not all-good), primary action, findings, visibility KPIs, milestones. Auto-scan trigger when overdue | 60/100 |
| **Pages** `/pages` | `pages/page.tsx` (818 lines) → `pages-client.tsx` (1168 lines) | Page health: every tracked URL with status, snapshots, diffs, guardrails, fix briefs, playbook briefs, rollout waves, findings | 75/100 |
| **Market** `/competitors` | `competitors/page.tsx` | Competitive analysis + compact **`MarketLocalStrip`** (listing health tier, NAP state with tone, imported reviews line, link to `/local`). AI share, rankings, topic signals, co-mention, source trust, battlecards | 62/100 |
| **Local** `/local` | `local/page.tsx` | Track 1.4: read-only local presence — explicit **NAP state**; **Data freshness** strip (`lastSync.google` / `yelp` / `manual` from `getLocalPresenceSnapshot()` — connector `last_synced_at` vs manual `ImportRun` excluding `connector:*`); 7-component listing health; methodology `#review-source-timestamps` + `#nap-consistency` + `#listing-health` + `#local-reviews` | — |
| **Changes** `/changes` | `changes/page.tsx` (594 lines) → 3 tabs (Outcomes/Replicate/Attribution) | Change impact: scorecard, verdicts, evidence tiers, pattern mining, replication targets, attribution review | 70/100 |
| **Settings** `/settings` | Server `settings/layout.tsx` (readiness hint + client tab bar) | Import, **Config**, **Connectors**, **Data** (`/settings/history`), **Sign-offs** (`/settings/exit-gates` — internal Daily Ritual / Replication exit gates; `.data/exit-gates.json`), **Methodology**. **`/settings/health`** remains valid (diagnostics) but **not** in the tab bar |

### Settings sub-routes

| Tab | Route | Re-exports | Purpose |
|-----|-------|------------|---------|
| Import | `/settings/import` | `settings/import/page.tsx` → `./import-page.tsx` (**only** entry; standalone **`/import`** removed — Phase 3-5) | Workbook upload, Profound adapter, CSV/JSON import (including **Local reviews** entity → `.data/local-reviews.json`) |
| Config | `/settings/config` | `settings/config/page.tsx` + `config-form.tsx` + **`actions.ts`** (`saveSetup` / `loadSetup`) | Editable business profile; **`/setup`** route removed (Phase 3-6)—**only** this path for setup/config UI |
| Connectors | `/settings/connectors` | `settings/connectors/page.tsx` + `connectors-client.tsx` + **`actions.ts`** (Google OAuth + **`loadGoogleLocations`** / **`selectGoogleLocation`** / **`syncGoogleReviews`**; Yelp **`saveYelpApiKey`** / **`syncYelpReviews`** / **`disconnectYelp`**) | **Google:** OAuth + **location picker** (`fetchGoogleLocations` → select → `selected_location_id` on token) + on-demand **Sync now** (requires location) → `runGoogleReviewsSync` → GBP v4 reviews for selected location → `LocalReview` → `mergeUpsertLocalReviews`; callback `/api/connectors/google/callback`. **Yelp:** API key only (server store) + **Sync now** → Fusion `businesses/{id}` + `reviews` → `runYelpReviewsSync` → same merge path; `connector:google` / `connector:yelp` import runs. Tokens + `last_synced_at` + `selected_location_id`: `connector-store.ts` → `.data/connector-tokens.json`. **Yelp business id** from `business-config.json` (`yelpBusinessId`) or token `business_id` |
| Health | `/settings/health` | `../../diagnostics/page` | Attribution diagnostics (developer-facing). **Not** shown in settings tab nav (direct URL only) |
| Data (tab) | `/settings/history`, **`/settings/history/[id]`** | `settings/history/page.tsx` (framing + `./results-page`), **`results-page.tsx`**, **`results-client.tsx`**, **`[id]/page.tsx`** (Phase 3-7: former **`(shell)/results/`** tree; standalone **`/results`** removed) | Imported measurement / citation evidence + row detail; tab label **Data** |
| Sign-offs | `/settings/exit-gates` | `settings/exit-gates/page.tsx` + `exit-gates-client.tsx` + **`actions.ts`** | Internal operator sign-off only (`readExitGates` / `updateExitGate` → **`exit-gates.json`**). Does not affect metrics, scores, or proof. Optional strip in Settings layout when engaged and a gate is not `passed`. Methodology **`#exit-gates`** |
| Methodology | `/settings/methodology` | `settings/methodology/page.tsx` (static, 5 sections + FAQ) | Proof layer (1.1c + **1.1j 2026-04-13**): per-metric **How to read it** / **Beacon does not know** blocks, expanded FAQ (incl. coverage states), boundaries. Anchors: **`#exit-gates`**, **`#nap-consistency`**, **`#local-reviews`**, **`#review-source-timestamps`**, **`#listing-health`**, **`#review-monitoring-v1`**, **`#review-connectors`**, **`#coverage-states`**, **`#boundaries`**. Specs: `docs/TIER_1_4D_REVIEW_MONITORING_V1_SPEC.md`, `docs/TIER_1_4E_REVIEW_CONNECTORS_SPEC.md`. Linked from HowWeKnowPanel, Today coverage line, Market/Changes `<details>`, **`/local`** disclosure |

### Hidden / secondary routes

| Route | Purpose | How accessed |
|-------|---------|-------------|
| `/diagnostics` | Attribution model diagnostics | Direct URL (not in nav) |
| `/expansion` | Quarantined hypothesis backlog | Direct URL (gated behind experiment flag) |
| `/briefs`, `/briefs/[id]`, `/briefs/proposed` | Brief management | Linked from Pages |
| `/review` | Attribution review queue | Embedded in Changes > Attribution tab |
| `/topics`, `/topics/opportunity/[id]` | Topic detail views | Command palette |
| `/observations/[id]` | Crawl proof detail | Linked from finding provenance |
| `/changes/[id]` | Change detail + inline recommendations | Linked from Changes list |
| `/local` | Local presence (GBP/reviews read-path v1) | Primary nav **Local**; command palette |

---

## Domains (31 modules under `src/domains/`)

| Domain | Purpose | Key files | Type |
|--------|---------|-----------|------|
| `attribution/` | Cause-effect scoring, triage, golden tests | `compute.ts`, `candidates.ts`, `triage.ts`, `events.ts` | Computed |
| `scanning/` | Scan orchestration, findings, scan state | `orchestrate-scan.ts`, `detect-findings.ts`, `findings-store.ts` | Computed + Persisted |
| `pages/` | Page registry, snapshots, guardrails, fix briefs, playbooks | `snapshot-store.ts`, `guardrails.ts`, `extractor.ts` | Imported + Computed |
| `competitors/` | Rankings, co-mention, source trust, battlecards, snippet intel | `co-mention.ts`, `source-trust.ts`, `battlecards.ts` | Computed |
| `product/` | Recommendations, priority, replication, experiments, milestones | `recommendation-engine.ts`, `priority-engine.ts`, `replication-engine.ts` | Computed |
| `observations/` | Crawl run management, merged reads | `read.ts`, `observation-runs-merge.ts` | Imported |
| `opportunities/` | Opportunity scoring and guidance | — | Imported + Computed |
| `actions/` | Action cluster detection | — | Computed |
| `brief-generation/` | Brief template creation | — | Computed |
| `briefs/` | Brief types and lifecycle | — | Computed |
| `patterns/` | Pattern detection for replication | — | Computed |
| `entity/` | Entity extraction, discrepancy detection | `entity-extract.ts`, `discrepancy-detect.ts` | Computed |
| `geo/` | Geographic normalization, coverage gaps | `normalize.ts`, `coverage.ts` | Computed |
| `prompts/` | Prompt library, journey coverage, adversarial templates | `prompt-library.ts`, `journey-coverage.ts` | Managed |
| `milestones/` | All-time highs, first-time outcomes | `compute.ts`, `apply.ts` | Computed |
| `local-operator/` | Local market surface signals | `surface.ts` | Computed |
| `changelog/` | Change contract types | — | Imported |
| `results/` | Result actions and scoring | — | Imported |
| Remaining 13 domains | Type definitions, small utilities | — | Various |

---

## Persistence

### Primary: File-based (`.data/*.json`)

All route-critical data persists as JSON files under `.data/` via `src/lib/persistence/json-store.ts`. Server-only, enforced by `import "server-only"`.

**Multi-tenant:** When `BEACON_TENANT=<slug>` is set, stores resolve under `.data/tenants/{slug}/` via `src/lib/tenant.ts`.

### Optional: Supabase dual-write

| Layer | Role |
|-------|------|
| **Postgres (Supabase)** | Canonical read source when `DATA_SOURCE=supabase` |
| **`.data/*.json`** | On-disk truth, always written first. Enables instant rollback via `DATA_SOURCE=file` |
| **`SeedDataRepository`** | Default read path — switches backend from env |
| **Thin domain stores** | Wrap repository for single domain (snapshots, guardrails, etc.) |
| **`storage/canonical-store.ts`** | Profound import pipeline only |

**Rollback:** Set `DATA_SOURCE=file` in `.env.local` and restart.

### Data freshness

| Data | Freshness | Mechanism |
|------|-----------|-----------|
| **UI coverage label** (Today / Market / Changes) | Derived | `src/lib/coverage-state.ts` — `deriveCoverageState()` (fresh / aging / stale / critical / partial) from crawl age vs fixed thresholds (`T=3` days), optional missing-crawl flag, visibility-vs-crawl, and sample tier only. No persistence. |
| Page snapshots | FRESH | `readDotDataJson()` — no cache, disk read every call |
| Guardrail alerts | FRESH | `readDotDataJson()` |
| Scan state | FRESH | `readDotDataJson()` |
| Citation evidence | FRESH | `readDotDataJson()` |
| Results, changes, opportunities, competitors | MODULE-CACHED | `seed-data.server.ts` top-level await, populated once |
| Event decisions | MODULE-CACHED | `attribution/store.ts` |
| Recommendation responses, experiments, page issues | IN-MEMORY | `json-store` first-read cache |

### Persistence stores

| Store basename | Domain | Written by |
|----------------|--------|------------|
| `pages` | Page registry | `adapters/profound/import-orchestrator` |
| `page-snapshots` | Crawl snapshots | `scripts/scan-owned-pages.ts` |
| `page-snapshots-prev` | Prior crawl baseline | `scripts/scan-owned-pages.ts` |
| `page-snapshot-diffs` | Snapshot diffs | `scripts/scan-owned-pages.ts` |
| `page-guardrails` | Guardrail alerts | `scripts/scan-owned-pages.ts` |
| `render-checks` | Render check results | `scripts/scan-owned-pages.ts` |
| `observation-runs` | Website crawl runs | `scripts/scan-owned-pages.ts` + `storage/canonical-store.ts` |
| `sitemap-reconciliation` | Sitemap reconciliation | `scripts/scan-owned-pages.ts` |
| `scan-findings` | Detection findings | `domains/scanning/findings-store.ts` |
| `last-scan-result` | Structured scan result | `scripts/scan-owned-pages.ts` |
| `scan-state` | Scan lifecycle state | `domains/scanning/orchestrate-scan.ts` |
| `imported-results` | Imported results | `lib/import/actions.ts` |
| `imported-changes` | Imported changelog | `lib/import/actions.ts` |
| `imported-opportunities` | Imported opportunities | `lib/import/actions.ts` |
| `imported-competitors` | Imported competitors | `lib/import/actions.ts` |
| `import-runs` | Import run records | `lib/import/actions.ts` |
| `candidate-links` | Attribution candidates | `domains/attribution/store.ts` |
| `truth-labels` | Attribution truth labels | `domains/attribution/store.ts` |
| `event-decisions` | Review decisions | `domains/attribution/store.ts` |
| `recommendation-responses` | Accept/dismiss/defer | `domains/product/recommendation-response-store.ts` |
| `experiments` | Watch-list tracking | `domains/product/experiment-store.ts` |
| `competitor-universe` | Competitor config | `universe-read.ts` |
| `business-config` | Business profile | `setup/actions.ts` |
| `scan-settings` | Scan schedule config | `domains/scanning/scan-settings.ts` |
| `exit-gates` | Track 1.2 / 1.3 internal sign-off (Daily Ritual, Replication) | `lib/exit-gates-store.ts` + `settings/exit-gates/actions.ts` |

### Cold stores

| Path | Content | Access |
|------|---------|--------|
| `.data/answer-texts.json` | ~9,596 entries, ~27 MB | `cold-store.ts` on-demand |
| `.data/citations-by-date/{date}.json` | ~85,004 citation rows | `cold-store.ts` sharded |

---

## Scan Pipeline

**Orchestrator:** `src/domains/scanning/orchestrate-scan.ts` — single `runWebsiteScan({ trigger })` function. Render-safe (no `revalidatePath`).

**Flow:**
1. Capture previous snapshots/guardrails
2. Write `scan-state.json` → `running`
3. Execute CLI (`scripts/scan-owned-pages.ts`) via `child_process.exec` (120s timeout)
4. CLI fetches live sitemap → fetches each page → extracts title/meta/H1/schema/FAQ/links/word count → writes structured `.data/*.json` atomically
5. Read `last-scan-result.json`
6. Run `regenerateScanFindings()` — compares current vs previous snapshots, generates findings
7. Write terminal scan state (`success` / `partial` / `failed`)
8. Return structured `WebsiteScanResult`

**Entry points:**
- **Today** (`page.tsx`) — when `isScanOverdue()` is true
- **Pages** (`scan-action.ts`) — manual "Scan now" button → calls `revalidatePath` after
- **Import** (`postImportSetup()`) — after workbook import → calls `revalidatePath` after

**Cache invalidation:** `revalidatePath("/", "layout")` and `revalidatePath("/pages", "layout")` are called only from server actions (`scan-action.ts`, `import/actions.ts`), never from the render path.

**Finding detection:** 15 types from snapshot diff with priority scoring (severity + homepage + citations + changelog contradiction). Priority buckets: critical ≥60, important ≥35, minor ≥15, informational <15.

---

## Import Pipeline

**Primary:** Workbook upload → `src/lib/import/actions.ts` → parse CSV/JSON/XLSX → persist to `.data/imported-*.json` + optional Supabase dual-write.

**Profound adapter:** `src/adapters/profound/` — maps Profound CSV exports to canonical Beacon types.

**Post-import automation:** `postImportSetup()` — runs registry build + page scan after successful workbook import.

---

## Component Architecture

### Server/client boundary

- Server components (pages) fetch data, compute, pass serialized props to client components
- Client components render UI, handle interactions, call server actions for mutations
- `seed-data.server.ts`: server-only data layer
- No client-side data fetching (no SWR/React Query)
- All mutations go through server actions (`"use server"`) — no API routes

### Shared components

| Category | Count | Key examples |
|----------|-------|-------------|
| Shell | 4 | Sidebar, header, command palette, provider |
| Viz | 19 | ConfidenceBadge, FreshnessDot, KpiCard, Sparkline, DonutRing, AreaChart, etc. |
| Data | 21 | PageHeader, StatCard, EmptyState, etc. |
| Display | 16 | Badge variants, cards, metric displays |
| Form | 6 | Import forms, record sheets |

### Abstraction layers (visual + data swappability)

```
Data Adapters              View Models             Chart Components
┌─────────────┐           ┌──────────────┐         ┌──────────────┐
│ Profound     │──────────▶│ visibility   │────────▶│ KpiCard      │
│ (current)    │           │ score        │         │ AreaChart    │
│              │           │ geo          │         │ RadialScore  │
│ Native       │           │ journey      │         │ DonutRing    │
│ (future)     │──────────▶│ competitors  │────────▶│ MiniBarChart │
└─────────────┘           └──────────────┘         │ etc.         │
                                                    └──────────────┘
```

- **Data adapters** (`src/lib/data-adapters/`): Interface per domain. Current: `profound-adapter.ts`. Swap: change import in `index.ts`.
- **View models** (`src/lib/view-models/`): Pure functions. Domain data → chart-ready props. 5 modules.
- **Chart interfaces** (`src/components/viz/chart-types.ts`): Canonical prop shapes. Any chart library can implement.

---

## Attribution Engine

**Config SSOT:** `src/domains/attribution/config.ts`
- Weights: platform=20, topic=25, url=5, geo=15, temporal=20, sourceCategory=15
- Strength: strong=1.0, partial=0.5, unknown=0, none=0
- Confidence bands: high≥70, medium≥45, low≥20

**Scoring model (priority engine — 0-100, 7 dimensions):**
1. Impact confidence (0-25)
2. Evidence strength (0-20)
3. Pattern strength (0-15)
4. Replication potential (0-15)
5. Type urgency (0-15)
6. Recency (0-10)
7. Track record (-5 to +10)

**Buckets:** CRITICAL ≥72, HIGH_LEVERAGE ≥50, OPPORTUNISTIC ≥25, NOISE <25.
