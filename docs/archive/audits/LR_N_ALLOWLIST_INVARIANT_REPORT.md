# LR-N Harness Allowlist Invariant Report

**Date:** 2026-05-05
**Operator:** Armeen
**Scope:** Test-only. No production code. No OpenAI calls. No queue mutation. No backfill.
**Predecessor:** [`TEST_ISOLATION_FIX_REPORT.md`](./TEST_ISOLATION_FIX_REPORT.md)

---

## TL;DR

| | |
|---|---|
| **Verdict** | **Closed.** All 13 operator-locked safety properties pinned. Both LR-1 + LR-2 harnesses verified to carry every property. |
| New invariant | `tests/architecture/llm-live-regen-allowlist.test.ts` — 28/28 PASS (2 file-level + 13 properties × 2 harnesses). |
| Discovery | `scripts/llm-live-regen-<digit>.ts` filename pattern. Excludes the `-discover` read-only script and dry-run / deterministic / pre-existing scripts. |
| Out-of-scope (audited + reported) | `scripts/build-edits-for-queue.ts` is a Sprint 6A.1 developer CLI. NOT the operator-audit live-regen path. Operator should NOT use it for live regeneration. Documented prominently in the test docstring. |
| Ledger after invariant lands | byte-identical to pre-bundle: `$0.065741 / 6 calls` ✅ |
| Total architecture invariants | **94** (66 prior + 28 new). |
| LR-3 readiness | **Pinned safe.** Ready whenever the queue regrows. |

---

## What was searched / discovered

| Path | Status | In scope? |
|---|---|---|
| `scripts/llm-live-regen-1.ts` | committed (24fddbd) | YES — verified |
| `scripts/llm-live-regen-2.ts` | committed (cddc96e) | YES — verified |
| `scripts/llm-live-regen-2-discover.ts` | committed (cddc96e) | NO — read-only discovery (no provider call) |
| `scripts/llm-specific-edit-dryrun.ts` | committed | NO — pinned by sibling invariant `llm-dryrun-harness-no-persistence.test.ts` |
| `scripts/build-edits-for-queue.ts` | pre-existing (Sprint 6A.1 Phase 14) | **NO — out of scope, with rationale (see below)** |
| `scripts/generate-specific-edits.ts` | pre-existing | NO — deterministic-only, no LLM |

No live-regen harnesses are uncommitted or temporary. All 6 candidate scripts were located, classified, and (for the 2 in scope) verified.

### Why `build-edits-for-queue.ts` is out of scope

It's a developer convenience CLI from Sprint 6A.1 Phase 14 with these capabilities:
- `--provider=openai --write` → calls OpenAI + persists via `runProviderAndPersist`
- `--all` flag → broad-regen (iterates the entire live queue)
- `--limit=N` flag → optional cap
- No tenant-lock literal, no $1 default budget, no low-conf-exclude pre-flight

It's persistence-capable BUT lacks the operator-audit safety properties. Including it in the LR-N allowlist invariant would force a behavior change (or the invariant would fail, which would block the build). The honest call: **leave it pre-existing and document that the operator must NOT use it for live regeneration**. The LR-N pattern is the sanctioned path.

The invariant's docstring includes a prominent OUT OF SCOPE block calling this out so future readers don't mistake the script's existence for an authorized live-regen tool.

---

## The 13 properties — invariant-by-invariant

| # | Property | How pinned | LR-1 | LR-2 |
|---|---|---|---|---|
| 1 | Tenant-locked to `tenant-ritz-founder` | `TENANT_ID = "tenant-ritz-founder"` literal + `currentTenantId() !== TENANT_ID` mismatch abort regex | ✅ | ✅ |
| 2 | Hard candidate-count cap | `PINNED_CANDIDATES` array literal (no auto-discovery) | ✅ | ✅ |
| 3 | Hard budget cap, default ≤ $1 | `BUDGET_CAP_USD = N` extracted via regex; assert N ≤ 1.0; cumulative pre-call gate `cumulative + estimate > cap` | ✅ ($1.00) | ✅ ($1.00) |
| 4 | `runProviderAndPersist` for persistence | Import from `@/domains/recommendations/recommended-edits-persistence` AND a call site | ✅ | ✅ |
| 5 | No direct Supabase write helpers | NEGATIVE invariant on `dualWriteUpsert*`, `syncRecommendationResponses`, `deleteRecommendationResponseByRecId` | ✅ | ✅ |
| 6 | No direct `writeStore` for recommended edits | NEGATIVE invariant on `writeStore("recommended-edits", …)` AND `persistRecommendedEditsLocal` | ✅ | ✅ |
| 7 | No direct `syncRecommendedEdits` | NEGATIVE invariant on `\bsyncRecommendedEdits\s*\(` | ✅ | ✅ |
| 8 | Validator path | Either `runProviderAndPersist` (which runs `validateSpecificEditBundle` internally) OR explicit `validateSpecificEditBundle` call | ✅ (via runProviderAndPersist) | ✅ (via runProviderAndPersist) |
| 9 | Excludes low-confidence candidates | Pre-flight assertion `confidence !== "medium"` (or `=== "medium"`/`"high"`) | ✅ | ✅ |
| 10 | Excludes inventory-tier / weak | Pre-flight assertion `tier !== "observation"` (or `=== "observation"`) | ✅ | ✅ |
| 11 | Pre-flight candidate list | Literal `PRE-FLIGHT` header + selected candidates printed BEFORE provider call | ✅ | ✅ |
| 12 | Aborts on missing budget/provider/key | `OPENAI_API_KEY` check + abort path; `BUDGET_ABORT` branch | ✅ | ✅ |
| 13 | No Apply-All-HIGH or broad regen | NEGATIVE invariant on `acceptAllHighConfidence`, `applyAllHighConfidence`, `--all` flag, `for (const c of candidates)` shape, `regenerateAllRecommendations`, `runProviderAndPersist over .queue.map` | ✅ | ✅ |

The invariant strips `/* … */` and `// …` comments before identifier checks so docstring mentions of forbidden APIs (which are intentional — they document the contract) don't trip the negative invariants. Same trick the dry-run harness no-persistence test uses.

---

## Quality gates

- typecheck: clean (3 pre-existing prompt-drilldown errors unrelated).
- targeted vitest: **28/28 PASS** (`tests/architecture/llm-live-regen-allowlist.test.ts`).
- architecture invariant suite: **496/496 PASS** across **40 files** (38 prior + 1 new + 1 unchanged).
- full suite: **4498/4503** (5 pre-existing failures unchanged; +28 new passing tests vs prior baseline of 4470).
- build: EXIT_CODE=0 green.
- ledger byte-equality: ✅ verified before/after a full `npm run test`. The test-isolation fix continues to hold; the new invariant adds nothing that touches global stores.

---

## Architecture invariant inventory (cumulative)

| Bundle | Tests | Cumulative |
|---|---|---|
| LLM-DryRun-2 (validator + SYSTEM_PROMPT v2 + harness no-persistence + cutover ceiling) | 25 | 25 |
| LLM-DryRun-3 (strict abstention + packet-resolution wiring) | 22 | 47 |
| LLM-DryRun-3.5 (Rule 16.A scope fix) | 12 | 59 |
| LLM-budget-test-isolation | 7 | 66 |
| **LR-N harness allowlist (this bundle)** | **28** | **94** |

---

## Is LR-3 safe to run later once the queue refreshes?

**YES — pinned safe at the architecture level.** The 13 operator-locked safety properties are now invariant-protected. Any future LR-3 (or LR-N) harness MUST:
- Match the `scripts/llm-live-regen-<digit>.ts` filename pattern (otherwise add an explicit allowlist entry with justification).
- Carry all 13 properties OR fail the build before reaching production.

The full safety stack now in place:
1. **Validator** (`validateSpecificEditBundle` + `validateNoUuidInOperatorCopy` save-time gate, `bundleError` gate) — 0 leaks across LR-1 + LR-2.
2. **Persistence orchestrator** (`runProviderAndPersist`) — only writes accepted edits, only when bundleErrors === 0.
3. **Budget ledger** — hermetic-isolated from tests; accumulates correctly across LR-N runs.
4. **SYSTEM_PROMPT** — strict abstention on low-confidence + brand-empty; SINGLE-PROMPT CAUTION lets medium/high single-prompt packets generate while grounding every edit; concrete BAD/GOOD examples.
5. **Architecture invariants (94 total)** — fail the build on any drift across all of the above.

When the daily 07:00 UTC cron repopulates the queue with new medium-conf observation-tier candidates, LR-3 can run with the same pattern as LR-1 + LR-2. No additional design work needed.

---

## Final report — operator brief satisfaction

| Operator-required property | Pinned? |
|---|---|
| 1. Tenant-locked to `tenant-ritz-founder` | ✅ |
| 2. Hard candidate-count cap | ✅ |
| 3. Hard budget cap, default ≤ $1 | ✅ |
| 4. Uses `runProviderAndPersist` only | ✅ |
| 5. No direct Supabase writes | ✅ |
| 6. No direct `writeStore` for rec edits | ✅ |
| 7. No direct `syncRecommendedEdits` | ✅ |
| 8. Validator path | ✅ |
| 9. Excludes low-confidence | ✅ |
| 10. Excludes inventory-tier / weak | ✅ |
| 11. Pre-flight candidate list | ✅ |
| 12. Aborts on missing budget/provider/key | ✅ |
| 13. No Apply-All-HIGH or broad regen | ✅ |
| Search all current live regen scripts | ✅ |
| Report status of LR-1 / LR-2 harnesses | ✅ (both committed; verified) |
| No modification unless needed for invariant | ✅ (no harness modifications needed) |
| Targeted invariant passes | ✅ (28/28) |
| Full suite only baseline failures | ✅ (4498/4503, 5 baseline) |
| Build green | ✅ EXIT_CODE=0 |
| Commit + push | ✅ |
| Final report on LR-3 safety | ✅ (this report) |
