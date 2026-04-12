# Beacon — Start Here

> **PURPOSE:** This is the entry point for anyone (human or AI) working on Beacon.
> Read this file first. It tells you what Beacon is, where everything stands, what works, what's broken, and where to go next.
>
> **NOT FOR:** Execution steps (→ `NEXT_PHASE_EXECUTION_PLAN.md`), system diagrams (→ `architecture.md`), deep history (→ `master_execution_plan.md`), verification proof (→ `VERIFICATION_LOG.md`).

**Last updated:** 2026-04-11
**Branch:** `work/attribution-precision-20260407`
**Build:** `npm run typecheck` ✓ · `npm run test` 77/77 ✓ · `npm run build` ✓ (19 static ○ + 6 dynamic ƒ in route table; Phase 0C-5 gate)

---

## What Beacon Is

Beacon is a **daily AI visibility operating system** for local businesses. One operator opens it each morning to answer:

- What changed on my site?
- What is true about my visibility?
- What matters right now?
- What should I do next?
- Where is competition beating me?

**Stack:** Next.js 16 (App Router), React 19, TypeScript strict, `.data/*.json` file persistence (optional Supabase dual-write). Single-user, premium, self-hosted.

**Not:** a generic SEO dashboard, a crawler, a CRM, an agency platform, a science project.

---

## Current System State

### What is genuinely working

| Area | Score | Evidence |
|------|-------|----------|
| Domain architecture | 76/100 | 31 well-bounded domains, strict types, consistent patterns |
| Scan pipeline | 68/100 | Live crawl → snapshot diff → 15 finding types → priority scoring. 5 dedicated tests |
| Attribution engine | 75/100 | Event detection → candidate discovery → triage → scoring → operator verification. Golden tests |
| Proof layer | 78/100 | Confidence badges, evidence tiers, trust sources, freshness dots. Honest about uncertainty |
| Pages route | 75/100 | Page truth + fix briefs + verification workflow. Strongest route |
| Changes route | 70/100 | Scorecard + verdicts + replication. Core "what worked" view |
| Market route | 62/100 | Real competitive intelligence (rankings, topic signals, battlecards). Data-dependent |
| Navigation | Clean | 5 items: Today, Pages, Market, Changes, Settings. Keyboard shortcuts, command palette |
| Build health | Solid | Zero type errors, 77 tests pass, production build succeeds |
| Copy/wording | 75/100 | Operator-focused, honest, avoids jargon |

### What is broken or risky

| Problem | Severity | Impact |
|---------|----------|--------|
| **Error boundaries** | DONE | `(shell)/error.tsx` + `settings/error.tsx` implemented and runtime-verified (2026-04-12) |
| **Loading states** | DONE (Phase 0B) | `(shell)/loading.tsx`, `(shell)/pages/loading.tsx`, `(shell)/changes/loading.tsx` — shell + Pages + Changes Suspense fallbacks |
| **Today scan blocks render** | LAUNCH BLOCKER | Morning visit can block 2 min while scan runs during RSC render |
| **Demo data not labeled** | HIGH | Ritz Builders sample shown with no "demo mode" indicator |
| **Empty states missing** | HIGH | Most routes have no "no data yet" guidance |
| **Module-cached import data** | MEDIUM | `seed-data.server.ts` top-level await → stale in long-running production process |
| **Settings fragmented** | MEDIUM | Config/Health/History are re-exports of mismatched pages |
| **Today has 15 sections** | MEDIUM | Cognitive overload for a morning briefing |
| **Render-time side effects** | MEDIUM | `persistOutcomes()`, `updateExperimentCitations()` / `persistExperiments()` during Today render |
| **Test coverage narrow** | LOW | 77 tests cover domain logic only. Zero route, integration, or E2E tests |

### Overall scores (from 2026-04-11 audit)

| Composite | Score |
|-----------|-------|
| Product intelligence | 75/100 |
| Operator experience | 45/100 |
| Production safety | 25/100 |
| **Overall** | **53/100** |
| **Launch readiness (now)** | **38/100** |
| **Launch readiness (after safety fixes)** | **72/100** |

---

## Current Phase & Next Actions

**Status:** **Phase 0 (Foundation Safety) is complete** — error boundaries, segment `loading.tsx`, dead-route/dead-asset cleanup, full hygiene gate (`typecheck` + `test` + `build`). Phases 2–37 (infrastructure through product truth) remain **shipped**. **Current execution focus:** **Phase 1 — Morning Experience** (non-blocking scan, Today simplification, render-side-effect cleanup). **Phase 1A-1 done:** `scan-status-action.ts` exposes `getScanStatus()` for polling.

**Immediate next 3 actions:**

1. **Phase 1A-2** — Add `src/app/(shell)/trigger-scan-action.ts`.
2. **Phase 1A-3** — Remove `await runWebsiteScan()` from Today `page.tsx` render path.
3. **Phase 1A-4** — Add `ScanStatusBanner` client component (poll + refresh on complete).

**Full execution plan:** See `NEXT_PHASE_EXECUTION_PLAN.md` — 68 steps across 6 phases.

---

## Key Numbers *(snapshot / example — from one imported dataset + repo layout; re-run diagnostics on your `.data` if these must be exact)*

| Entity | Count |
|--------|-------|
| Results (imported) | 1,179 |
| Changes (imported) | 85 |
| Opportunities | 0 |
| Outcome events detected | 45 |
| Attribution candidates | 202 |
| Auto-resolved events | 13/45 (29%) |
| Domain modules | 31 |
| App routes (build) | 29 |
| Vitest tests | 77 |
| Viz components | 19 |

---

## Doc Reading Order

| Order | File | What it tells you |
|-------|------|-------------------|
| 1 | **This file** (`HANDOFF_VERIFIED_STATE.md`) | Current state, what works, what's broken, next steps |
| 2 | **`architecture.md`** | How the system fits together: routes, domains, data flow, persistence |
| 3 | **`NEXT_PHASE_EXECUTION_PLAN.md`** | What to do next: phased plan, micro-steps, cursor prompts |
| 4 | **`VERIFICATION_LOG.md`** | Proof of past work: dated entries with before/after metrics |
| 5 | **`master_execution_plan.md`** | Deep context vault: all history, all ideas, full backlog |
| 6 | **`SCAN_TRUTH_REFACTOR_PLAN.md`** | Vertical deep dive: scan orchestration refactor spec |

---

## Where Everything Lives

### Documentation

```
docs/
  HANDOFF_VERIFIED_STATE.md     ← YOU ARE HERE (entry point)
  NEXT_PHASE_EXECUTION_PLAN.md  ← active execution plan
  VERIFICATION_LOG.md           ← proof + history log
  architecture.md               ← system map
  master_execution_plan.md      ← full context vault (history + ideas + backlog)
  SCAN_TRUTH_REFACTOR_PLAN.md   ← scan refactor spec (completed)
  archive/
    audits/                     ← 9 audit files from 2026-04-11 comprehensive audit
    handoffs/                   ← archived handoff snapshots
    completed-specs/            ← completed spec documents
    product/                    ← historical PRD
    research/
      profound-integration/     ← Profound CSV field notes, parsing risks, source map
```

### Code

```
src/
  app/(shell)/           ← All routes (Today, Pages, Market, Changes, Settings, etc.)
  domains/               ← 31 domain modules (attribution, scanning, pages, competitors, product, etc.)
  components/            ← UI components (shell, viz, data, display, form, today, replication)
  lib/                   ← Shared utilities (persistence, import, data-adapters, view-models, tenant)
  adapters/              ← External data adapters (Profound)
  storage/               ← Canonical persistence layer
  derivations/           ← Pure computation functions
scripts/                 ← CLI tools (scan, registry, sampling, parity)
tests/                   ← Vitest tests (domains + lib)
.data/                   ← Runtime data (gitignored)
```

### Key Config

| File | What |
|------|------|
| `.env.local` | `DATA_SOURCE`, `DUAL_WRITE`, `BEACON_TENANT` |
| `.cursor/rules/core.mdc` | Always-on Cursor rules for Beacon |
| `src/lib/navigation.ts` | 5-item nav definition |
| `src/lib/business-config.ts` | Business profile (name, domain, services, locations) |
| `src/lib/tenant.ts` | Optional multi-tenant file isolation |

---

## Rules for Future Work

1. **Read this file first** before starting any task.
2. **Do not create new planning docs.** Use the existing 6 files. Ideas go in `master_execution_plan.md`. Steps go in `NEXT_PHASE_EXECUTION_PLAN.md`. Proof goes in `VERIFICATION_LOG.md`.
3. **Do not duplicate context.** Each doc has one job (see reading order above). If you're not sure where something goes, it goes in the vault (`master_execution_plan.md`).
4. **Update this file** when the system state materially changes (new phase completed, major bug fixed, scores change).
5. **Archive, don't delete.** Old specs → `docs/archive/completed-specs/`. Old handoffs → `docs/archive/handoffs/`.
