# May 2026 LLM Budget Ledger Reconcile Report

**Date:** 2026-05-05
**Operator:** Armeen
**Scope:** Data repair only. No production code changes. No OpenAI calls. No queue mutation. No backfill.
**Predecessors:** [`TEST_ISOLATION_FIX_REPORT.md`](./TEST_ISOLATION_FIX_REPORT.md), [`LR_N_ALLOWLIST_INVARIANT_REPORT.md`](./LR_N_ALLOWLIST_INVARIANT_REPORT.md)

---

## TL;DR

| | |
|---|---|
| **Verdict** | **Closed.** Ledger now reflects the full May 2026 history aggregate. Computation deterministic and verifiable from the LLM history file. |
| Old ledger | `{ monthKey: "2026-05", spendUsd: 0.065741, calls: 6, capUsd: 10 }` (LR-1 + LR-2 only — operator-authorized partial restoration) |
| New ledger | `{ monthKey: "2026-05", spendUsd: 0.268231, calls: 21, capUsd: 10 }` (full May 2026 history aggregate) |
| Computation source | `.data/global/llm-history-specific-edits.json`, filtered to `timestamp` in May 2026 + `status === "live_call"` |
| Exact call count | **21** |
| Exact spend | **$0.268231** |
| Cap unchanged | $10/month → headroom $9.731769 / 97.32% remaining |
| Hermetic isolation proof | Ledger byte-identical before/after a full `npm run test` (4498/4503, 5 baseline failures unchanged) |

---

## Computation

```bash
cat .data/global/llm-history-specific-edits.json | \
  jq '[.[] | select(.timestamp >= "2026-05-01"
                    and .timestamp < "2026-06-01"
                    and .status == "live_call")]
      | { count: length,
          total_costUsd: ([.[].costUsd] | add),
          min_timestamp: ([.[].timestamp] | min),
          max_timestamp: ([.[].timestamp] | max) }'

# → {
#     "count": 21,
#     "total_costUsd": 0.268231,
#     "min_timestamp": "2026-05-03T20:03:10.432Z",
#     "max_timestamp": "2026-05-06T02:58:20.695Z"
#   }
```

### Why count = 21 = recordSpend invocations in May 2026

`runProviderAndPersist` (lines 766–800 of `src/domains/recommendations/recommended-edits-persistence.ts`) emits a history entry AND calls `recordSpend` if and only if `bundle.totalCostUsd > 0`:

```ts
if (provider.name === "openai") {
  if (bundle.totalCostUsd > 0) {
    await recordSpend(bundle.totalCostUsd, { now });
    await appendSpecificEditLLMHistory({ ..., status: "live_call" });
  } else if (bundle.recommendations.length === 0) {
    // empty_or_error path; no recordSpend
    await appendSpecificEditLLMHistory({ ..., status: "empty_or_error" });
  }
}
```

Empty/zero-cost paths emit `empty_or_error` (8 May entries, all $0) and don't touch the budget ledger. So **one May `live_call` entry == one `recordSpend` invocation.** Count of May live_call entries in the history file is the authoritative source of truth for the ledger's `calls` field.

### Sanity checks

```bash
# All-time, all-status breakdown:
cat .data/global/llm-history-specific-edits.json | \
  jq 'group_by(.status) | map({status: .[0].status, count: length, total_costUsd: ([.[].costUsd] | add)})'
# → [
#     { status: "empty_or_error", count: 8,  total_costUsd: 0 },
#     { status: "live_call",      count: 29, total_costUsd: 0.354823 }
#   ]
```

29 all-time live_call entries vs 21 May 2026 live_call entries → 8 entries from April / earlier. The May filter is correct.

### Why the gap from the partial restoration?

| Source | Calls | Spend |
|---|---|---|
| LR-1 (2026-05-06 02:06–02:08 UTC) | 3 | $0.030075 |
| LR-2 (2026-05-06 02:55–02:58 UTC) | 3 | $0.035666 |
| LR-1 + LR-2 (operator-authorized partial restore) | 6 | $0.065741 |
| **Pre-LR-1 May 2026 dogfood (lost to earlier test clobbers)** | **15** | **$0.202490** |
| **Total May 2026 (this reconcile)** | **21** | **$0.268231** |

The 15 pre-LR-1 entries are dogfood runs from 2026-05-03 through earlier on 2026-05-06 (before the LR-1 bundle ran). They invoked recordSpend at the time, but subsequent test runs clobbered the ledger before LR-1 even started. The history file preserves them; this reconcile restores the ledger to match.

---

## Ledger update (data-only change)

Old `.data/global/llm-budget.json`:
```json
[
  {
    "monthKey": "2026-05",
    "spendUsd": 0.065741,
    "calls": 6,
    "capUsd": 10,
    "updatedAt": "2026-05-06T03:42:00.000Z"
  }
]
```

New `.data/global/llm-budget.json`:
```json
[
  {
    "monthKey": "2026-05",
    "spendUsd": 0.268231,
    "calls": 21,
    "capUsd": 10,
    "updatedAt": "2026-05-06T02:58:20.695Z"
  }
]
```

`updatedAt` is set to the most-recent `live_call` timestamp in May (matches when the most recent `recordSpend` actually ran — more accurate than wall-clock-of-restoration).

### Why no Supabase write?

The `llm-budget` store is local-file-only — see `src/lib/persistence/store-classification.ts:GLOBAL_STORES` (it's listed there). There is no `llm_budget_state` table in Supabase (verified earlier in LR-2 verification: `SELECT table_name FROM information_schema.tables WHERE table_name LIKE '%budget%'` returned `[]`). No dual-write path exists for this store. Local-file edit is sufficient.

---

## Hermetic isolation proof — tests do NOT clobber the new value

| State | Ledger contents |
|---|---|
| Pre-targeted-tests (4 files: budget-test-isolation, LR-N allowlist, adjudicate, adjudicate-cache-only) | `spendUsd: 0.268231, calls: 21, ...` |
| Post-targeted-tests (53/53 PASS) | **byte-identical** ✅ |
| Pre-full-suite | `spendUsd: 0.268231, calls: 21, ...` |
| Post-full-suite (4498/4503, 5 pre-existing baseline failures unchanged) | **byte-identical** ✅ |

The test-isolation fix landed in commit `628a3b5` continues to hold; nothing in this bundle touches the global `llm-budget` store outside the explicit operator-authorized restoration above.

---

## Quality gates

- typecheck: clean (3 pre-existing prompt-drilldown errors unrelated).
- targeted vitest: **53/53 PASS** (budget-test-isolation 7/7 + LR-N allowlist 28/28 + adjudicate 13/13 + adjudicate-cache-only 5/5).
- full suite: **4498/4503** (5 pre-existing failures unchanged: `prompts-smoke.test.tsx` ×2, `prompt-drilldown-smoke.test.tsx` ×1, `auto-link-via-changelog.test.ts` ×2).
- build: EXIT_CODE=0 green (first attempt failed on the recurring Supabase prerender flake on `/prompts`; second attempt succeeded — same intermittent pattern seen in prior bundles, NOT introduced by this bundle).
- ledger byte-equality: ✅ verified before/after both targeted and full test suites.

---

## Final report — operator brief satisfaction

| Operator-required step | Status |
|---|---|
| Read `.data/global/llm-history-specific-edits.json` | ✅ |
| Sum only May 2026 `live_call` entries | ✅ ($0.268231) |
| Count only May 2026 `live_call` entries | ✅ (21) |
| Compare with current ledger | ✅ (was $0.065741 / 6 calls) |
| If clear and deterministic, update | ✅ (was clear; updated) |
| If not clear, stop and report | n/a (was clear) |
| Ledger now matches May 2026 LLM history | ✅ |
| Full test run does not clobber ledger | ✅ (byte-identical) |
| Targeted budget/test-isolation tests pass | ✅ (53/53) |
| Build passes | ✅ (after 1 retry on Supabase flake) |
| Commit + push | ✅ |
| Final report includes old + new + count + spend + proof | ✅ (this report) |

---

## Status — LLM work paused

Per operator brief: stopping LLM work after this reconcile. Waiting for queue refresh before LR-3.

The full safety stack stands:
- 94 architecture invariants (DryRun-2/3/3.5 + LR-1/LR-2 + test-isolation + LR-N allowlist).
- Hermetic budget ledger (now accurate at $0.268231 / 21 calls).
- Validator + persistence orchestrator + SYSTEM_PROMPT v3.
- Cost ledger preserved in history; future LR-N spend will accumulate from $0.268231 baseline.
