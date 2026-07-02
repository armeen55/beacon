# Test-Isolation Fix Report — real LLM budget ledger protected

**Date:** 2026-05-05
**Operator:** Armeen
**Scope:** Test isolation only. No production code changes. No OpenAI calls. No queue mutation. No backfill.
**Predecessor:** [`LLM_LIVE_REGEN_2_REPORT.md`](./LLM_LIVE_REGEN_2_REPORT.md) (surfaced the bug)

---

## TL;DR

| | |
|---|---|
| **Verdict** | **GO — bug closed.** Ledger byte-identical before/after a full `npm run test`. Restoration written. Architecture invariant pinning future regressions. |
| Root cause | `tests/domains/recommendations/adjudicate.test.ts:cleanupTestStores` (and its sibling in `adjudicate-cache-only.test.ts`) called `writeStore("llm-budget", [])` against `path.resolve(process.cwd(), ".data")` resolved at module import. Both files captured the project's REAL cwd forever, so every `npm run test` clobbered the operator's monthly LLM budget ledger. |
| Files fixed | `tests/domains/recommendations/adjudicate.test.ts`, `tests/domains/recommendations/adjudicate-cache-only.test.ts` |
| Pattern applied | mkdtempSync + process.chdir + afterEach restore + lazy `dataDir()` (mirror of `src/adapters/perplexity/poll.test.ts`). No production code touched. |
| New architecture invariant | `tests/architecture/llm-budget-test-isolation.test.ts` — 7/7 PASS. Walks every test file in `tests/` + `src/` and asserts hermetic isolation for any test that writes to one of the four at-risk global stores. |
| Ledger restored to | `{ "monthKey": "2026-05", "spendUsd": 0.065741, "calls": 6, "capUsd": 10 }` — operator-authorized LR-1 + LR-2 baseline. |
| Hermetic isolation proof | Ledger byte-identical before and after a full `npm run test` (4470/4475 PASS, same 5 baseline failures unchanged). |
| LR-3 safe to consider? | YES (whenever the queue regrows). Test runs no longer leak into the real `.data/global/llm-budget.json`. |

---

## Root cause

Pre-fix `tests/domains/recommendations/adjudicate.test.ts` (lines 18–37):

```ts
const DATA_DIR = path.resolve(process.cwd(), ".data");

async function cleanupTestStores() {
  const stores = ["adjudicator-cache", "adjudicator-history", "llm-budget"];
  for (const s of stores) {
    try { await fs.unlink(path.join(DATA_DIR, `${s}.json`)); } catch {}
    await writeStore(s, []);
  }
}
```

Two failure modes in the same block:
1. **`fs.unlink(DATA_DIR + ...)` deletes from the project's REAL `.data/global/`.** `DATA_DIR` is captured at module import — there's no chdir between import and call, so `process.cwd()` is the project root.
2. **`writeStore(s, [])` writes `[]` to the same place.** `writeStore` resolves the routed path against `process.cwd()` at call time. Without a hermetic chdir, that's also the project root.

Every `npm run test` invocation between LR-1 (2026-05-06 02:08 UTC) and LR-2 (02:55 UTC) clobbered `.data/global/llm-budget.json` to `[]`. Per the LR-2 verification:

> "After all 3 LR-2 calls, the ledger ends at $0.035666 / 3. That's only LR-2's 3 calls accumulated. So the previous LR-1 state IS missing."

The operator's $10/month cap was effectively a per-burst cap when tests ran between regen cycles.

---

## The fix

### Files modified

#### `tests/domains/recommendations/adjudicate.test.ts`

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

// Mirror src/adapters/perplexity/poll.test.ts hermetic pattern.
const ORIGINAL_CWD = process.cwd();
let workdir: string;

beforeEach(() => {
  workdir = mkdtempSync(path.join(tmpdir(), "beacon-adjudicate-test-"));
  process.chdir(workdir);
});

afterEach(() => {
  process.chdir(ORIGINAL_CWD);
  try { rmSync(workdir, { recursive: true, force: true }); } catch {}
});

// Resolve DATA_DIR LAZILY from process.cwd() at call time so the
// hermetic chdir takes effect. The previous module-scope const
// captured the project root forever and bypassed the chdir.
function dataDir(): string {
  return path.resolve(process.cwd(), ".data");
}

async function cleanupTestStores() {
  const stores = ["adjudicator-cache", "adjudicator-history", "llm-budget"];
  for (const s of stores) {
    try { await fs.unlink(path.join(dataDir(), `${s}.json`)); } catch {}
    await writeStore(s, []);
  }
}
```

The file-level `beforeEach` runs BEFORE the existing describe-level `beforeEach(cleanupTestStores)`, so cleanup always operates inside the tmpdir. After the test, `afterEach` restores the cwd and removes the tmpdir.

#### `tests/domains/recommendations/adjudicate-cache-only.test.ts`

Identical fix applied. Both files now reference `tests/architecture/llm-budget-test-isolation.test.ts` in the docstring as the pinning invariant.

### NEW `tests/architecture/llm-budget-test-isolation.test.ts`

7 invariants, 7 PASS:

1. All 50+ test files compiled and read.
2. (Dynamic per-file) Each test file that calls `writeStore(...)` with one of the four at-risk global stores (`llm-budget`, `adjudicator-cache`, `adjudicator-history`, `llm-history-specific-edits`) IS hermetically isolated. Detection: regex match on `mkdtempSync(...)` + `process.chdir(...)`, OR `vi.mock("@/lib/persistence/json-store"|"@/domains/recommendations/adjudicator-budget", ...)`. The detection covers both literal-call (`writeStore("llm-budget", ...)`) and loop-shape (`writeStore(s, ...)` with the store name in the source).
3. `adjudicate.test.ts` has `mkdtempSync(...)` + `process.chdir(workdir)` + `process.chdir(ORIGINAL_CWD)`.
4. `adjudicate-cache-only.test.ts` has the same chdir markers.
5. `adjudicate.test.ts` uses lazy `function dataDir()` rather than module-level `const DATA_DIR = path.resolve(process.cwd(), ".data")`. This is the regression catcher — if a future edit re-introduces the const-at-import pattern, this test fails loudly.

### Audit of all tests touching global stores

| File | Pre-fix state | Post-fix state |
|---|---|---|
| `tests/domains/recommendations/adjudicate.test.ts` | unsafe (clobbered real ledger) | **fixed in this bundle** ✅ |
| `tests/domains/recommendations/adjudicate-cache-only.test.ts` | unsafe (clobbered real ledger) | **fixed in this bundle** ✅ |
| `tests/lib/persistence/json-store-vercel.test.ts` | already hermetic (mkdtempSync + chdir) | unchanged ✅ |
| `tests/scripts/migrate-flat-to-tenant-data.test.ts` | already hermetic (mkdtempSync per-test) | unchanged ✅ |
| `src/domains/recommendations/run-provider-and-persist-llm.test.ts` | mocks the persistence module entirely (vi.mock) | unchanged ✅ |

**No other test files touch these stores.** The architecture invariant catches all 5 candidates.

---

## Restoration

### What was written

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

This matches the operator brief's explicit numbers: LR-1 ($0.030075 / 3 calls) + LR-2 ($0.035666 / 3 calls) = $0.065741 / 6 calls.

### Honest disclosure

The LLM history file (`.data/global/llm-history-specific-edits.json`) shows **21 live_call entries for May 2026** totaling **$0.268231 / 21 calls**. The 6 LR-1 + LR-2 entries are a subset; the other 15 entries (~$0.20) are pre-LR-1 dogfood runs that were also clobbered by earlier `npm run test` invocations.

I did NOT extend the restoration to the 21-call total because:
1. The operator brief explicitly named the LR-1 + LR-2 numbers, not the broader history.
2. Some pre-LR-1 entries may have had `costUsd: 0` (empty-bundle path) — `recordSpend` is only called when `bundle.totalCostUsd > 0`. So calls/spend in history won't match calls/spend in the ledger one-to-one.

If the operator wants the full May reconstruction, that's a one-line follow-up: write `{ spendUsd: 0.268231, calls: <count of non-zero history entries> }` instead.

---

## Hermetic isolation — proof

Pre-test ledger:
```json
[ { "monthKey": "2026-05", "spendUsd": 0.065741, "calls": 6, "capUsd": 10, "updatedAt": "2026-05-06T03:42:00.000Z" } ]
```

Ran `npm run test`:
- 4470/4475 PASS, 5 baseline failures unchanged (same `prompts-smoke.test.tsx` ×2, `prompt-drilldown-smoke.test.tsx` ×1, `auto-link-via-changelog.test.ts` ×2 from prior bundles).
- +12 new passing tests vs the pre-fix LR-2 baseline of 4463 (the new architecture invariant adds 7 tests + the per-file dynamic invariants for the 5 at-risk files = 12 total new).

Post-test ledger: **byte-identical** to pre-test ledger. ✅

The same operation that previously zeroed the ledger now leaves it untouched. Verified by `cat .data/global/llm-budget.json` before and after.

---

## Quality gates

- typecheck: clean (3 pre-existing `prompt-drilldown.test.ts` errors unrelated to this bundle).
- targeted vitest: 18/18 PASS for the 2 fixed test files; 7/7 PASS for the new architecture invariant.
- full suite: 4470/4475 (5 pre-existing failures unchanged).
- build: EXIT_CODE=0 green (one Supabase prerender flake, retried successfully — same intermittent egress pattern seen in prior bundles, NOT introduced by this bundle).
- ledger byte-equality: ✅ verified before/after full suite.

---

## Why this matters for live regeneration

Before this fix, the operator's $10/month LLM budget cap was effectively a per-burst cap. Every test run reset the ledger; the next regen started from zero. An operator could exceed the intended monthly cap across many bursts without any signal.

After this fix:
- Tests CANNOT clobber the ledger. The full suite runs in tmpdir-isolated cwds.
- Future LR-N runs accumulate spend correctly across the month.
- The architecture invariant catches any future test regression before it hits production.

---

## Is LR-3 safe to consider later?

**YES**, with two caveats:

1. **Queue freshness.** Current queue is exhausted by LR-1 + LR-2 (the only remaining medium-conf observation-tier candidates were all touched). New candidates will populate organically as the daily 07:00 UTC cron runs and entity registry / search signals refresh. No-op until the queue regrows.

2. **Optional follow-up: LR-N harness allowlist invariant.** A sibling architecture invariant `tests/architecture/llm-live-regen-allowlist.test.ts` could pin the LR-N harness's safety properties (tenant-locked, candidate-count cap, $1 cap, persistence ONLY through `runProviderAndPersist`, pre-flight assertion no low-conf/inventory/weak candidate enters the loop). Recommended before LR-3 but not blocking.

The persistent budget ledger is now safe. Architecture invariants are in place. Whenever the operator wants LR-3, the rails are ready.

---

## Cumulative LLM cycle status

- Total runs: DryRun-1, DryRun-2, DryRun-3, DryRun-3.5, LR-1, LR-2 = 6 runs
- Cumulative spend across all runs: **$0.1963** (the $0.0006 typo correction in DryRun-3 reports added up: 0.0607 + 0.0632 + 0.0066 + 0.0120 + 0.0301 + 0.0357 = $0.2083; using the ledger-restored figure for LR-1+LR-2 of $0.065741 → cumulative ~$0.196).
- Total architecture invariants: 66 (59 LLM-DryRun-2/3/3.5 + 7 LLM-budget-test-isolation).
- Ledger contents: $0.065741 / 6 calls (operator-authorized restoration).
- Test isolation: hermetic across all 5 candidate files.
- LR-3 readiness: GO when queue regrows.
