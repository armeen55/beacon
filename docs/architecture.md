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
- **Changes** — log + verification

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

Local `.data/` JSON files via `src/lib/persistence/json-store.ts`.
Server-only — enforced by `import "server-only"`.

## Server/Client Boundary

- `seed-data.server.ts`: Server-only data layer, imports `json-store.ts`
- `seed-data.ts`: Pure data arrays, no Node.js dependencies
- Pages are server components that pass serialized props to client components
