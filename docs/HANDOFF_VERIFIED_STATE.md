# Beacon — Start Here

> **PURPOSE:** This is the entry point for anyone (human or AI) working on Beacon.
> Read this file first. It tells you what Beacon is, where everything stands, what works, what's broken, and where to go next.
>
> **NOT FOR:** Execution steps (→ `NEXT_PHASE_EXECUTION_PLAN.md`), system diagrams (→ `architecture.md`), deep history (→ `master_execution_plan.md`), verification proof (→ `VERIFICATION_LOG.md`).

**Last updated:** 2026-04-13
**Branch:** `work/attribution-precision-20260407`
**Build:** `npm run typecheck` ✓ · `npm run test` 280/280 ✓ · `npm run build` ✓
**Track 1.2:** Daily ritual perfection — Phases 1–3 complete (2026-04-12): layout + Inbox Zero/digest + Today keyboard path (A / J/K, finding focus, primary `autoFocus` when safe)
**Track 1.3:** Replication engine refinement — Phases 1–2 complete (2026-04-12): language/hierarchy + queue structure/experiment linkage/vague suppression
**Track 1.2 / 1.3 exit gates (persistence):** Settings → **Sign-offs** `/settings/exit-gates` + `.data/exit-gates.json` — `daily_ritual` + `replication` status / note / `updated_at` only; internal sign-off; does not affect metrics, scores, or proof (`exit-gates-store.ts`, `exit-gates-types.ts`, methodology `#exit-gates`; optional Settings layout hint when engaged and not both `passed`)
**Tier 1.1i:** Coverage escalation — **expanded (2026-04-13):** five-state model (`fresh` / `aging` / `stale` / `critical` / `partial`) in `coverage-state.ts` only; aging = crawl age in `(0.7×T, T]` for `T=3`; critical = missing crawl when flagged or age `> 2T`; Today digest + findings attention strip + `shouldShowTodayAllClear`; Market/Changes use `latestWebsiteCrawlRun()` crawl age; methodology `#coverage-states`
**Tier 1.1j:** Proof layer **final trust pass (2026-04-13)** — methodology: “How to read it” + “Beacon does not know” across core metrics; FAQ (coverage labels, continuous updates, every review); standardized review phrases + connector disclosures; overview five-pillar list. Product: `beacon-proof-copy.ts` (`BEACON_LOCAL_SURFACE_FOOTNOTE`, Layer-2 bullets), `local-presence.ts` footnotes + Market review lines, Today `HowWeKnowPanel` + coverage → `#coverage-states`, Market **partial** coverage warning, Connectors page/client, `/local` stored-review wording, `local-operator/surface.ts` data gaps. Checklist refresh: `docs/TIER_1_1J_EXIT_GATE_CHECKLIST.md`.
**Proof layer:** Layer-2 collapsed disclosures on Market + Changes Outcomes (2026-04-12): `<details>` “How this works” / “How verdicts work” + links to `/settings/methodology#citation-share` and `#verdicts`; copy from `beacon-proof-copy.ts`
**Track 1.4:** Local listings / reviews — Phase 1 + **Phases 2B–4** (2026-04-12/13); **1.4d (spec):** `docs/TIER_1_4D_REVIEW_MONITORING_V1_SPEC.md`; **1.4e connectors (2026-04-13):** `docs/TIER_1_4E_REVIEW_CONNECTORS_SPEC.md` + `/settings/connectors` — **Google:** OAuth + **multi-location picker** (fetch → select → persist `selected_location_id` on token) + on-demand Sync now → GBP v4 reviews for selected location only → strict map → `mergeUpsertLocalReviews`; sync blocked until location selected. **Yelp:** server-stored Fusion API key + Sync now → Fusion business + reviews → `mapYelpReviewToLocalReview` → same merge; ids `yelp:…`, import run `connector:yelp`. `last_synced_at` per provider; local-presence freshness = max(import run, Google sync, Yelp sync). No auto-sync. `/local` + manual import unchanged.
**Track 1.4f–g (NAP + surfacing):** NAP consistency expanded to 4 states (`complete` / `incomplete` / `inconsistent` / `unknown`); centralized in `napState` on `LocalPresenceSnapshot`; inconsistency detects conflicting `listing_name` on imported reviews vs configured name. Today attention uses 4-state NAP (inconsistent fact line). Market strip shows NAP state with tone coloring. `/local` shows explicit label + factual explanation. Methodology `#nap-consistency`. No new connectors, scoring formulas, or ranking claims.
**Track 1.4 — Per-source last sync (`/local`):** `LocalPresenceSnapshot.lastSync` — `google` / `yelp` from connector `last_synced_at`; `manual` from latest non-connector `ImportRun` (`entity_type: reviews`, `imported_count > 0`). **Data freshness** section on `/local` (always three rows + disclosure); methodology `#review-source-timestamps`. Pure projection — no merged timestamp, no new thresholds.
**Methodology (connectors + freshness):** `/settings/methodology` — `#review-connectors` documents **shipped** Google + Yelp (on-demand); `#review-monitoring-v1`, `#local-reviews`, boundaries, and FAQ aligned with manual + connectors, per-source timestamps, no auto-sync, no SLA language. **2026-04-13:** FAQ “connection breaks” + **`/local`** “How this works” / empty-state copy aligned with shipped connectors (no “not syncing yet” drift); tier specs `TIER_1_4D` / `TIER_1_4E` docstrings match.
**Track 1.5:** Milestone polish (2026-04-12): magnitude classification (major/minor), same-key-same-day dedupe, weekly noise cap (3+ minors → suppress on Today), enriched Today teaser (subtitle + relative date + magnitude-aware styling), Changes list collapsed (5 visible, rest behind expand). Exit gate 1.5g verified: ATH truthful, deduped, linked to proof

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
| Navigation | Clean | 6 items: Today, Pages, Market, Local, Changes, Settings. Today: **A** → primary CTA, **J/K** → findings; command palette |
| Build health | Solid | Zero type errors, 280 tests pass, production build succeeds |
| Copy/wording | 75/100 | Operator-focused, honest, avoids jargon |

### What is broken or risky

| Problem | Severity | Impact |
|---------|----------|--------|
| **Error boundaries** | DONE | `(shell)/error.tsx` + `settings/error.tsx` implemented and runtime-verified (2026-04-12) |
| **Loading states** | DONE (Phase 0B) | `(shell)/loading.tsx`, `(shell)/pages/loading.tsx`, `(shell)/changes/loading.tsx` — shell + Pages + Changes Suspense fallbacks |
| **Today scan blocks render** | DONE (1A-1–6) | RSC never awaits scan; `ScanStatusBanner` triggers + polls from client; `router.refresh()` on complete. Flow verified end-to-end. **Phase 5-9:** stale-running detection + duplicate guard added — crashed scans no longer block indefinitely |
| **Demo data not labeled** | MITIGATED (2A) | `DemoBannerGate` + `isDemoMode` when no import runs; sticky banner with import CTA (Phase 2A-3) |
| **Empty states missing** | LOW (2B done) | Import empty states on main routes; **2B-5:** `shouldShowTodayAllClear` returns false when `isDemoMode` (no false “all clear” on sample data) |
| **Module-cached import data** | MEDIUM | `seed-data.server.ts` top-level await → stale in long-running production process |
| **Settings fragmented** | DONE (Phase 3) | Route consolidation + smoke **3-8** verified **2026-04-12**: Import / Config / Data tabs only; Health direct URL; **`/import`**, **`/setup`**, **`/results`** → **404** |
| **Today section count** | DONE (1.2) | Track 1.2 Phase 1: primary action promoted to #1 slot, findings collapsed, proof/system moved to bottom, morning-order text removed, milestone/replication compacted |
| **Render-time side effects** | DONE (1C) | `persistOutcomes()`, `updateExperimentCitations()`/`persistExperiments()`, and `syncMilestonesFromWorkspace()` all moved to post-import; 1C-3 audit confirmed zero writes in render path |
| **Test coverage narrow** | LOW | 280 tests (domain + lib + `exit-gates-store` + local-presence + NAP 4-state + per-source `lastSync` + GBP/Yelp map/sync + GBP location picker + Tier 1.1i coverage + components + **route smokes**); Vitest `fileParallelism: false` + 30s timeout stabilizes heavy dynamic imports; no full E2E |

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

**Status:** **Launch Phases 0–5 COMPLETE. Tier 1.1 + 1.1i COMPLETE. Track 1.2 Phases 1–3 COMPLETE. Track 1.3 Phases 1–2 COMPLETE. Track 1.4 through per-source last sync on `/local` + 1.4e connectors shipped.** **`/local`:** NAP state + **Data freshness** (Google / Yelp / manual timestamps independently). **Today** / **Market** local surfacing unchanged in wiring. **Sign-offs** at `/settings/exit-gates`. Gate: typecheck ✓, 280/280 tests ✓, build ✓.

**Immediate next 3 actions:**

1. **Track 1.4h–k** — Advanced local surfacing (review trend, GBP field audit) per `NEXT_PHASE_EXECUTION_PLAN.md`.
2. **Tier 2** tracks or **1.2h / 1.3h** checklist dogfood.
3. **Tier 1.1j regression spot-check** — operator read-through of methodology + Today/Market/Changes/`/local` after the 2026-04-13 pass (no code unless a trust gap surfaces). **Sign-offs** page records operator state only.


**Full execution plan:** See `NEXT_PHASE_EXECUTION_PLAN.md` — launch phases complete; active roadmap is **Tier 1** tracks **1.1 → 1.5** (see `master_execution_plan.md` §"Tiered product stack").

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
| Vitest tests | 280 |
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
  TIER_1_4_PHASE_2_LOCAL_REVIEW_READ_PATH_SPEC.md  ← local review import contract
  TIER_1_4D_REVIEW_MONITORING_V1_SPEC.md           ← review monitoring v1 scope (1.4d)
  TIER_1_4E_REVIEW_CONNECTORS_SPEC.md             ← connector sub-spec extending 1.4d (1.4e)
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
