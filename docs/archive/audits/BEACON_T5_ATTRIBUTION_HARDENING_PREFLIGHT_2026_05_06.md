# T5 Attribution Hardening — Preflight Report

**Date:** 2026-05-06
**Mini-phase:** T5.1 (preflight only — NO verdict math changes)
**Source audits:** Trust Sprint Phase 3.A + 3.B (`docs/BEACON_ATTRIBUTION_TRUST_AUDIT_2026_05_06.md`), Trust Sprint Phase 4 (`docs/BEACON_DATA_INTEGRITY_AUDIT_2026_05_06.md`)
**Author:** read-only audit run

> **Scope contract:** This preflight inventories what's at risk in the current verdict store and proposes the smallest set of code+test changes for T5.2. It does NOT modify verdict math, persisted rows, or `live_at` population. T5.2 is gated on operator approval of the proposal below.

---

## 1. Verdict-row inventory (Ritz, `.data/tenants/ritz-builders/url-change-outcomes.json`)

| Shape | Count |
|---|---|
| Total verdicts | **131** |
| `helping` | **118** (90.1%) |
| `nothing_yet` | 13 |
| `hurting` | 0 |
| `too_early` | 0 |
| `not_enough_data` | 0 |
| `not_enough_native_baseline` | 0 |
| `not_implemented` | 0 |

The distribution is skewed strongly toward `helping`. Empirically this is suspicious — Phase 3.B's 5-real / 5-placebo backtest produced 1 placebo false-positive (the sparse-pre-window class) and 1 real false-negative; you would expect more variance in verdicts that include the abstain branches. Two structural drivers:

1. **All 118 helping verdicts touch a contaminated window.** Every one of them has at least one of the dates 2026-04-23 / 2026-04-26 / 2026-05-06 inside its baseline or post-change window.
2. **Compressed pre-window across many rows.** Top-10 highest-z helping verdicts share `baseline_days_used=5d` + `post_days_used=30d` + `z=76.92` on `/luxury-home-builder-bay-area`. The high z is a structural artifact of `sigma_pre_used = max(sigma_pre_raw, 1.0)` over a 5-day baseline window with very low variance — the exact placebo-2 class from Phase 3.B.

| Helping-verdict risk signal | Count |
|---|---|
| Window touches 2026-04-23 / 2026-04-26 / 2026-05-06 | **118 (100%)** |
| `baseline_days_used < 5` | 0 (engine's natural floor) |
| `post_days_used < 5` | 0 |
| `confidence: high` | 66 |
| `confidence: medium` | 52 |
| `confidence: low` | 0 |
| Distinct URLs with helping verdicts | 9 |
| Distinct change_ids producing helping verdicts | 118 |

`live_at` coverage:

```
total_changelog_rows: 334
rows_with_live_at:    1
rows_missing_live_at: 333  (99.7%)
```

**Every existing helping verdict is anchored on commit `timestamp`, not `live_at`.** Per Phase 3.A, the engine does fall back gracefully — `resolveChangeDate` reads `change.live_at ?? change.timestamp` — but the actual deploy day is unknown for 333/334 rows. For rapid-iteration tenants whose timestamp ≠ deploy day, this skews every window.

---

## 2. Top risky helping verdicts (sorted by |z| desc)

All top-10 are on the same URL `/luxury-home-builder-bay-area` with identical math:

```
url=/luxury-home-builder-bay-area
z=76.92, delta_pct=86.58, baseline=5d, post=30d, confidence=medium
```

Eight more distinct change_ids on the same URL produce the identical verdict. This suggests the same change was logged 10× (different change rows pointing at the same URL with the same window) — the verdict math then runs identically, producing 10× duplicate verdict rows.

---

## 3. Specific code paths to change in T5.2

### 3.1 Add hard precondition — sparse pre-window

**File:** `src/domains/attribution/url-verdict.ts`

```ts
// Inside computeUrlVerdict, before returning helping/hurting:
const FULL_POLL_OBS_FLOOR = 80;
const PRE_DAYS_WITH_FULL_POLLS_MIN = 5;

const preDaysWithFullPolls = baselineCounts.filter((day) =>
  day.sampling_status === "full" || day.observations >= FULL_POLL_OBS_FLOOR
).length;

if (
  preDaysWithFullPolls < PRE_DAYS_WITH_FULL_POLLS_MIN &&
  (verdict === "helping" || verdict === "hurting")
) {
  // Operator-locked T5: sparse pre-windows produce structural
  // false-positives via sigma floor amplification (Phase 3.B
  // placebo-2 class). Demote to nothing_yet rather than risk
  // shipping an unreliable measured-win card.
  verdict = "nothing_yet";
  // Emit a structured demotion log similar to the M3 sampling guard.
}
```

This closes the placebo-2 false-positive class identified by the Phase 3.B backtest.

### 3.2 Add `weak_signal` tier between `too_early` and `helping`

**File:** `src/domains/attribution/url-verdict.ts`

```ts
const Z_BAR_HELPING = 2.0;
const Z_BAR_WEAK_SIGNAL = 1.2;

if (Math.abs(z) >= Z_BAR_HELPING && sustainUp >= 5) {
  verdict = "helping";
} else if (
  Math.abs(z) >= Z_BAR_WEAK_SIGNAL &&
  sustainUp >= 5 &&
  preDaysWithFullPolls >= PRE_DAYS_WITH_FULL_POLLS_MIN
) {
  verdict = "weak_signal"; // NEW
} else if (postDays >= NOTHING_YET_MIN_DAYS) {
  verdict = "nothing_yet";
} else {
  verdict = "too_early";
}
```

Catches the real-3 menlo-park false-negative class (z=+1.35, lift was real but sub-cutoff).

### 3.3 Update `VerdictLabel` union + downstream consumers

**File:** `src/domains/attribution/url-verdict.ts`

```ts
export type VerdictLabel =
  | "helping"
  | "hurting"
  | "weak_signal"     // NEW
  | "nothing_yet"
  | "too_early"
  | "not_enough_data"
  | "not_enough_native_baseline"
  | "not_implemented";
```

Consumers to update (each just needs a new case):

- `src/domains/attribution/lifecycle-attribution-copy.ts` — add `"weak_signal"` → "Early signs of lift" customer-safe phrasing.
- `src/components/display/lifecycle-status-pill.tsx` — add a yellow color path for `weak_signal`.
- `src/domains/attribution/verdict-provenance.ts` — extend `VerdictKind` union and add a directional+caveat trust label (T3.2 verdict provenance already has the rendering surface; T5.2 just adds the new kind).
- `src/app/(shell)/changes/scorecard-client.tsx` — `MathRow` change-strength label can read `"Early signal"` for `z ∈ [1.2, 2.0)`.

### 3.4 Backfill `weak_signal` on next nightly verdict run

The new tier emits naturally on the next verdict-materialize pass. Existing on-disk verdicts are unchanged — they'll be re-classified when the nightly cron runs the engine.

T5.2 does NOT need to mutate existing verdict rows; the materializer is idempotent on `(change_id, url)` and will overwrite stale verdicts with the new tier as data refreshes.

---

## 4. Test cases needed (T5.2)

### 4.1 Sparse-pre-window precondition

```ts
it("demotes helping to nothing_yet when preDaysWithFullPolls < 5", () => {
  // pre window has 2 full days + 12 proof days; z >= 2.0 normally
  // would emit helping. Verdict should be nothing_yet with a
  // demotion reason set.
});
```

### 4.2 `weak_signal` tier

```ts
it("emits weak_signal when z ∈ [1.2, 2.0) and sustain + full pre-days satisfied", () => {
  // matches the real-3 menlo-park backtest case
});

it("never emits weak_signal when preDaysWithFullPolls < 5", () => {
  // sparse-pre precondition takes precedence
});

it("does NOT emit weak_signal for z < 1.2", () => {
  // floor preserved
});
```

### 4.3 Lifecycle copy

```ts
it("weak_signal maps to 'Early signs of lift' (NOT 'this change worked')", () => {
  // operator-locked phrasing
});

it("weak_signal is labeled DIRECTIONAL (not unreliable, not trustworthy)", () => {
  // matches T3.2 verdict-provenance trust contract
});
```

### 4.4 Backtest re-run

The Phase 3.B backtest's 10-sample harness should re-run with the new rules. Expected outcomes:

| Sample | Pre-T5 | Post-T5 (predicted) |
|---|---|---|
| real-1 luxury (z=+2.85) | helping | helping (unchanged) |
| real-2 custom-home (z=+2.90) | helping | helping (unchanged) |
| real-3 menlo-park (z=+1.35) | nothing_yet | **weak_signal** (recovered) |
| real-4 cupertino (z=+4.78) | helping | helping (unchanged) |
| real-5 whole-home | not_enough_data | not_enough_data |
| placebo-1 luxury (z=+1.32) | nothing_yet | weak_signal (still directional) |
| placebo-2 custom-home (z=+2.17, sparse) | helping (false positive) | **nothing_yet** (precondition closes false positive) |
| placebo-3 atherton | nothing_yet | nothing_yet |
| placebo-4 los-altos | nothing_yet | nothing_yet |
| placebo-5 menlo-park | nothing_yet | nothing_yet |

Net: 1 false-positive closed, 1 false-negative recovered as `weak_signal`. Engine accuracy moves from "directionally honest" to "directionally honest + new tier for moderate-but-real signal".

---

## 5. Expected UI copy changes

| Surface | Pre-T5 | Post-T5 |
|---|---|---|
| Lifecycle pill (yellow) | not used | **"Early signs of lift"** for `weak_signal` |
| /changes ExpandPanel "Explain this verdict" | "Strong signal" / "Weak signal" | + "Early signal" tier for `weak_signal` |
| /today win cards | "Citation lift detected after the X change" | unchanged for `helping`; new card variant for `weak_signal` (less assertive language) |
| T3.2 "Why this verdict?" disclosure | 5 abstains (trustworthy) + helping/hurting (directional) | + `weak_signal` (directional + caveat: "Z-score sub-2.0 — wait for stronger signal") |

**Customer-safe copy contract:** `weak_signal` should NEVER be described as "proof" or "win." Phrasing options:

- "Early signs of lift detected — watch for sustained signal."
- "Citation rate is trending up after this change. Not yet a strong signal."
- "Possible early signal — Beacon needs more days of post-change data."

---

## 6. Rollback plan

T5.2 is pure code change — no migration, no row mutation:

1. **Forward path:** apply the precondition + tier additions; next nightly cron run materializes verdicts with the new shape.
2. **Rollback path:** revert the commit. The materializer is idempotent on `(change_id, url)` and overwrites in place. Existing on-disk rows that already migrated to `weak_signal` will revert to `helping` on the next run after rollback.

No data is destroyed by either direction. The persisted `verdict` column is a single string and can hold any of the union values; older readers that don't recognize `weak_signal` will fall through to a default (currently the `nothing_yet` path in most consumers).

---

## 7. Should `weak_signal` be implemented immediately or after next cron?

**Recommendation: implement immediately, push, let the next 07:00 UTC cron rematerialize.**

Reasons:
- The cron is idempotent on `(change_id, url)`. Old verdicts will be overwritten with the new shape.
- Existing `helping` verdicts are mostly false-positives per the audit (118/118 touch contaminated dates). Letting them sit until cron runs preserves the false-positive surface.
- T3.2 verdict-provenance disclosures already render directional/unreliable trust labels — the new tier will get the right label automatically once `verdict-provenance.ts` adds the `weak_signal` case.

Risk if implemented BEFORE cron rematerialization:
- Operator opens /changes between code-deploy and cron-run; they see the OLD `helping` verdicts on disk while the engine code has the new tier. This is benign — the row data is stale relative to the engine, but any new verdict computation produces the new tier correctly.

---

## 8. Hard-constraint compliance for T5.1 (this preflight)

- ✅ Read-only. No verdict math touched. No persisted rows mutated.
- ✅ No `live_at` backfill (out of scope; would require per-row scan timestamp recovery).
- ✅ No paid polling. No OpenAI. No second tenant. No RLS / auth changes.
- ✅ `weak_signal` NOT implemented; this is the proposal.
- ✅ `npm run typecheck` ran clean (no code changes).
- ✅ `scripts/verify-tenant-data-integrity.ts` PASS.
- ✅ `scripts/verify-observation-dedup-integrity.ts` PASS.
- ✅ `.data/global/llm-budget.json` SHA byte-identical (no engine calls).
- ✅ Zero queue mutations.

---

## 9. Awaiting operator approval

When you approve T5.2:
1. Apply §3.1 precondition (4 lines + log path)
2. Apply §3.2 tier (12 lines + threshold const)
3. Apply §3.3 union extension + downstream cases (~6 files, single-line edits each)
4. Add §4 tests
5. Quality gates green
6. Commit + push
7. Next 07:00 UTC cron rematerializes verdicts with the new shape

Estimated diff size: ~200 lines (engine code + tests + UI copy + provenance trust contract).

**End of preflight.**
