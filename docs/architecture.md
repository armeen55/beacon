# Beacon Architecture

## What Beacon Is

Beacon is an attribution-triage system for AEO/SEO visibility.
It ingests changes (what you did), results (what happened), and uses deterministic logic to connect cause and effect.

## Data Flow

```
Workbook/CSV Import
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
Action Clusters (grouped events + changes)
    ↓
Patterns (normalized change strategies)
    ↓
Action Queue (prioritized operator tasks)
    ↓
Proposed Briefs (execution plans)
```

## Core Domains

| Domain | Purpose | Type |
|--------|---------|------|
| `results/` | Daily visibility snapshots | Imported |
| `changelog/` | Changes made (what you did) | Imported |
| `opportunities/` | What to pursue | Imported + System |
| `competitors/` | Who you compete with | Imported |
| `attribution/` | Cause-effect scoring + triage | Computed |
| `action-clusters/` | Grouped events + changes | Computed |
| `actions/` | Prioritized operator tasks | Computed + Persisted state |
| `patterns/` | Repeatable change strategies | Computed (diagnostic) |
| `opportunity-candidates/` | System-derived expansion ideas | Computed (deferred) |
| `brief-generation/` | Execution plans from actions | Computed |
| `briefs/` | Accepted execution plans | Persisted |

## Attribution Config (Single Source of Truth)

All weights live in `src/domains/attribution/config.ts`:

- **Weights**: platform=20, topic=25, url=5, geo=15, temporal=20, sourceCategory=15
- **Strength values**: strong=1.0, partial=0.5, unknown=0, none=0
- **Confidence bands**: high≥70, medium≥45, low≥20

These are referenced by `compute.ts` and `diagnostics.ts` — no duplication.

## Pattern Success Rate

Denominator = **all relevant events** (not just resolved ones).
This prevents artificial inflation. A pattern with 3 attributed events out of 10 total shows 30%, not 100%.

## Navigation (pilot spine)

Default loop:
- **Today** — observation strip + queue + next move
- **Your Website** — execution workbench
- **Gap ledger** (`/topics`) — typed gaps

Work:
- **Changes** — log + verification + **change impact** (`computeScorecard` → `enrichWithImpact` in `change-impact.ts`: confidence, direction, why, next action on `/changes` and `/changes/[id]`)

Advanced:
- **Review** — hypothesis locks (attribution bookkeeping)
- **Sample history** (`/results`) — imported snapshots
- **Import**
- **Diagnostics (analyst)** — pipeline debug, outside daily loop

Experimental:
- **Draft ideas** (`/expansion`) — model backlog only

Secondary (accessible but not in main spine):
- Competitors, Briefs/Proposed, `/opportunities` legacy routes if present

Removed:
- Weekly (dead surface)
- Coverage (dead surface)

## Persistence

**Default:** Route-critical data is read through `SeedDataRepository` with **`DATA_SOURCE=supabase`** (see `src/lib/persistence/repositories/`). **`DUAL_WRITE=true`** keeps file-first writes and best-effort Supabase upserts so rollback stays trivial.

**Rollback:** Set **`DATA_SOURCE=file`** in `.env.local` and restart — reads return to `.data/*.json` via the same repository interface; no code change.

**Disk:** Supplementary operator state and large JSON blobs still live under `.data/` (read through repository getters or thin domain stores). The file **`.data/observation-runs.json` is shared**: Profound import rows (`ProfoundImportRun`, `canonical-store.ts`) coexist with website crawl/verify rows (`ObservationRun`); `file-backend` merges website-typed rows with legacy `scan-runs.json` and skips Profound-shaped objects (see `docs/master_execution_plan.md`, Phase 3C).

Underlying file cache and mutations still use `src/lib/persistence/json-store.ts` where applicable. Server-only — enforced by `import "server-only"`.

## Persistence boundaries (locked — Phase 3E)

| Layer | Role |
|--------|------|
| **Postgres (Supabase)** | Canonical **read** source for route-critical tables when `DATA_SOURCE=supabase`. |
| **`.data/*.json` + `json-store`** | On-disk truth and in-process mutation cache; always written first on mutating paths; enables instant rollback via `DATA_SOURCE=file`. |
| **`SeedDataRepository` (`getRepository`)** | **Default read path** for app/domain code — switches backend from env. |
| **Thin domain stores** | Wrap repository data for a single domain (citation index, snapshots, etc.); no second source of truth. |
| **`storage/canonical-store.ts`** | **Profound import pipeline only** — hot/cold Profound stores; not for website `ObservationRun` (those go through `domains/observations/read.ts`). |

**Documented bypasses (do not copy without updating this doc):**

- `topics/page.tsx` server action — `readDotDataJson` for citation index + snapshots at action time (freshness vs module cache).
- `universe-read.ts` — `readDotDataJson("competitor-universe")` only when `DATA_SOURCE=file` (file pin metadata).
- **`import-orchestrator.ts`** — `readStore("imported-changes")` for CLI/batch (policy decision; not swapped to repo blindly).
- **Scripts** (`scripts/*`) — may use `readStore` / disk directly.

Naming cheat sheet: **website** observation runs = `ObservationRun` + `observation_runs` table / merged file sources; **Profound** “observation” rows = `ProfoundImportRun` in `observation-runs.json` via canonical-store; **visibility** runs = separate types + `visibility-observation-runs.json` (+ synthetic wrappers).

## Server/Client Boundary

- `seed-data.server.ts`: Server-only data layer, imports `json-store.ts`
- `seed-data.ts`: Pure data arrays, no Node.js dependencies
- Pages are server components that pass serialized props to client components
