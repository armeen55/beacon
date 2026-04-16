# Visibility Event Engine — Handoff Brief

**Last updated:** 2026-04-15
**Status:** Plan approved, ready to execute E1
**Read this file first, then read the plan file.**

## The 30-second summary

You are picking up Beacon at the point where we've just finished a deep restructure plan. The plan is approved. The next task is to execute **Phase E1 — Engine Consolidation**.

Before touching any code, read these three files in order:

1. **This file** (you're reading it)
2. **`/Users/armeen/.claude/plans/rippling-munching-pnueli.md`** — the full rebuild plan. Parts 9-13 are the active plan. Parts 1-8 are historical context from earlier work that is already complete.
3. **`docs/HANDOFF_VERIFIED_STATE.md`** — the living state-of-Beacon doc.

## Where we are

- **Phases 1-9 of the original V1 rebuild are COMPLETE.** Trust language, experiment noise floor, config extraction, recommendation specificity, answer intelligence integration, Today simplification, context/action split, step compression, trust reinforcement, and cleanup pass — all shipped. 566 tests pass.
- **Spike Forensics v1 is SHIPPED** at `src/domains/forensics/spike-forensics.ts` with dev route at `/diagnostics/spikes` and 16 tests. 582 tests total.
- **A second-layer audit found that spike-forensics v1 duplicates existing primitives** (triage.ts, memory.ts, change-patterns.ts) and misses key behaviors (state model, sequence memory, unlock detection, pattern→execution bridge).
- **The 4-phase restructure plan (E1-E4) is approved** and written to the plan file. Ready to execute.

## The 4 phases at a glance

```
E1 (~7 days)  Engine Consolidation + Confidence Decomposition
E2 (~5 days)  State Snapshots + Annotations Overlay
E3 (~5 days)  Event Classification (spike / unlock / ramp)
E4 (~7 days)  Sequence Memory + Pattern→Execution Bridge
```

Each phase has its own validation gate in the plan file. Each is independently shippable.

## Start here — Phase E1 first mini-steps

Read Part 9 (and Part 4 for the original E1 spec) of the plan file, then execute in order:

1. **E1.1** Create `src/domains/visibility-events/` scaffold (types.ts, empty engine module)
2. **E1.2** Replace my `attributeSpike()` in `spike-forensics.ts:365-481` with a call into `triageCandidates()` from `src/domains/attribution/triage.ts`
3. **E1.3** Replace `buildEventWindows()` with calls into `computeMemoryInsights()` from `src/domains/attribution/memory.ts`
4. **E1.4** Consume `change-outcomes.json` for pre-materialized deltas (don't recompute)
5. **E1.5** Consume `change-patterns.ts:engine_timing` for per-platform learned windows
6. **E1.6** Impact-weighted cluster scoring (`changeCount * clusterWeight * proximityWeight * coverageWeight`)
7. **E1.7** Align to observation runs (`listWebsiteCrawlRuns()`)
8. **E1.8** Delete/deprecate duplicative code in `spike-forensics.ts`
9. **E1.9** Add event confidence decomposition (detection/attribution/pattern_match — three separate values)

## Key rules that apply to every phase

1. **Reuse existing primitives.** The plan lists which files are read-only (reused) vs. modified. Do not rewrite `triage.ts`, `memory.ts`, `change-outcomes.ts`, or `change-patterns.ts`.
2. **Directional language only.** Never claim causation. "Most likely trigger" not "caused." See Phase 1 of the V1 rebuild plan.
3. **No new features mid-phase.** If you find something that feels like a good idea, write it down for a future phase. Don't widen scope.
4. **Every phase must pass `npm run typecheck` + `npm run test` + its validation gate before advancing.**
5. **No causal strings ever.** Grep check before shipping: `"Strong evidence"|"Strongest correlate"|"is working"|"this pattern works"|"Validated pattern"` must return zero matches in production code.

## What's in the codebase that you MUST reuse

| Primitive | Location | What it does |
|---|---|---|
| `triageCandidates()` | `src/domains/attribution/triage.ts` | primary/contributing/candidate scoring with existing logic |
| `discoverCandidates()` | `src/domains/attribution/candidates.ts` | candidate discovery for events |
| `computeMemoryInsights()` | `src/domains/attribution/memory.ts` | before/after windowing with data gates |
| `ChangeOutcome` (materialized) | `.data/change-outcomes.json` + `src/domains/attribution/change-outcome.ts` | per-change before/after deltas |
| `ChangePattern.engine_timing` | `src/domains/learning/change-patterns.ts` | per-platform learned median/earliest/latest days |
| `listWebsiteCrawlRuns()` | `src/domains/observations/read.ts` | crawl run timestamps for alignment |
| `findings.signalStrength` | `src/domains/scanning/findings-store.ts` | 0-100 composite signal |
| `CLUSTER_LABELS` | `src/domains/forensics/types.ts` | 9-cluster taxonomy — correct, reuse |

## What lives at `src/domains/forensics/` right now

Audit it before refactoring:

- `src/domains/forensics/types.ts` — types (Spike, WindowedChange, ClusterBurst, ClusterAttribution, SpikeForensics)
- `src/domains/forensics/spike-forensics.ts` — main engine (~500 LOC). **This file will be gutted during E1.** Its detection math stays, its attribution logic gets replaced, and it eventually becomes a thin wrapper over the new `visibility-events/` module.
- `src/app/(shell)/diagnostics/spikes/page.tsx` — dev route. Keep, updates fields as engine evolves.
- `tests/forensics/spike-forensics.test.ts` — 16 tests. Some will be refactored during E1.

## What changed recently that you need to know

- **Phase A shipped FAQ schema recommendation** (`rec-faq-schema-*` in recommendation engine). Priority 850-899. `targetPlatforms: ["chatgpt", "google_aio"]`.
- **Phase B shipped comparison table recommendation.** `actionClass: "comparison_table"`. Priority 750-849. `targetPlatforms: ["google_aio"]`. Fires only for city/service/homepage.
- **Phase C shipped platform targeting.** Every recommendation has `targetPlatforms: ("google_aio" | "chatgpt" | "perplexity")[]`. Today page shows platform breakdown + concentration warning.
- **Spike Forensics v1 shipped.** Dev route at `/diagnostics/spikes` shows 224 detected spikes with directional attribution.

## The critical files modified in the last session

- `src/domains/product/recommendation-engine.ts` (+240 lines for Phases A/B/C)
- `src/domains/product/morning-brief.ts` (platform suffix in keyReason, FAQ schema key reason)
- `src/app/(shell)/today-data.ts` (faqSchemaCoverage, platformDistribution, concentratedPlatform, experimentProof)
- `src/app/(shell)/today-client.tsx` (platform breakdown line, concentration warning)
- `src/domains/scanning/types.ts` (added `faq_without_schema` finding type)
- `src/domains/scanning/detect-findings.ts` (FAQ-without-schema detection block)
- `src/domains/pages/extractor.ts` (table detection, `table_count` field)
- `src/domains/pages/types.ts` (`table_count` on PageSnapshot)
- `src/domains/forensics/` (new module, ~680 lines)
- `src/app/(shell)/diagnostics/spikes/page.tsx` (new dev route)
- `tests/scanning/faq-without-schema.test.ts` (+5 tests)
- `tests/scanning/comparison-table.test.ts` (+10 tests)
- `tests/scanning/platform-targeting.test.ts` (+6 tests)
- `tests/forensics/spike-forensics.test.ts` (+16 tests)

## Test counts at handoff

- 582 total tests passing
- 62 test files
- typecheck clean

## Known blind spots documented in the plan

These are gaps that E1-E4 will NOT fix. Beacon will openly acknowledge them in output:

1. No access to ChatGPT / Google / Perplexity crawl timestamps
2. No prompt distribution shift tracking
3. No competitor content diffing (only sitemap additions)
4. No LLM index refresh cadence data
5. Delayed-effect vs snowball disambiguation remains partial
6. No per-change expected impact magnitude (sample size too small — only 327 historical changes)
7. Negative pattern resolution is coarse (we know it failed, not why)

See Part 10 of the plan for full accounting.

## If you're a new agent starting fresh

1. Read this file (done if you're here)
2. Read `/Users/armeen/.claude/plans/rippling-munching-pnueli.md` Parts 9-13 (the active plan)
3. Glance at Parts 1-8 for historical context (original V1 rebuild)
4. Run `npm run typecheck && npm run test` to confirm baseline is green
5. Start executing **Phase E1 mini-step E1.1** — create the `visibility-events/` module scaffold
6. Use `TodoWrite` to track E1.1 through E1.9 as you go
7. Before moving to E2, confirm the E1 validation gate (Part 9 of the plan)

## The one line that matters most

> Beacon is becoming a visibility event engine with pattern memory. The moat is in the compounded intelligence that accumulates across events, not in any single recommendation. Every phase protects trust language and reuses existing primitives.

## Commands you'll use most

```bash
# Typecheck
npm run typecheck

# Full test suite
npm run test

# Specific test file
npm run test -- tests/forensics/spike-forensics.test.ts

# Dev server (for /diagnostics/spikes)
# Via preview_start tool, not npm run dev directly
```
