# Beacon — `live_at` Auto-Promotion Preflight (Trust Sprint T7.2)

**Date:** 2026-05-06 PT (2026-05-07 UTC)
**Author:** Claude (Trust Sprint executor)
**Tenant:** `tenant-ritz-founder`
**Status:** **Preflight only. Stop. Architecture is already implemented (Phase 3 match runner) but operator-gated behind `BEACON_LIFECYCLE_ENABLED=1` per the Lifecycle OS dogfeed sequence.**

---

## 0. TL;DR

The `live_at` auto-promotion is **not a missing feature**. The Phase 3 match runner at `src/domains/recommendations/match-runner/` already does the full pipeline: detect each accepted edit's element in a fresh page snapshot, classify match (exact / modified / wrong_page / etc.), stamp `live_at` on both the `recommended_edits` row and the linked `changelog` row. It is gated OFF by default behind `BEACON_LIFECYCLE_ENABLED=1` per a deliberate dogfeed sequence (the 3 steps in [`src/lib/flags.ts`](../src/lib/flags.ts) lines 70-76).

T7.2 implementation = **flip a flag + run a scan**, NOT new code. That flip is operator-driven (requires Phase 3 sign-off in `.data/global/exit-gates.json`, currently empty `[]`). Out of T7.2's bounded scope.

What this preflight delivers:
1. Architecture survey (the entire match runner already exists).
2. Dry-run script (`scripts/preflight-live-at-auto-promotion.ts`) that inspects the current state without flipping anything.
3. Honest accounting of which Ritz rows would auto-promote and which would block on missing scan data.

---

## 1. The 7 questions — answered

### 1. When does `live_at` get set today?

Three paths in current code:

| Path | When | Where |
|---|---|---|
| Operator override (Mark Shipped) | operator clicks Mark Shipped on /recommendations or /changes | [`actions.ts:markRecommendationShipped`](../src/app/\(shell\)/recommendations/actions.ts) — flips both `recommended_edits.live_at` and the linked `changelog_entries.live_at` |
| Operator-side acceptance with auto-stamp | when accepting a rec immediately marks it live (rare) | `acceptRecommendation` → `live_at: nowIso` on the `recommended_edits` row |
| Phase 3 match runner (auto) | scan-driven; gated by `BEACON_LIFECYCLE_ENABLED=1` | [`match-runner/index.ts`](../src/domains/recommendations/match-runner/index.ts) → `transitions.ts` → `persist.ts:persistChangelogLiveAt` |

Currently `BEACON_LIFECYCLE_ENABLED` is **not set** in `.env.local` → the runner is OFF → only the operator-driven paths ever stamp `live_at`.

### 2. Which rows can be auto-promoted safely?

Acceptance-tier rows in `recommended_edits` (`accepted` / `needs_review` / `wrong_page` / `partially_implemented` / `verified_live*`) whose `live_at` is null AND whose `target_element_key` matches a row in the latest `page_element_inventory` for the same URL.

**Ritz dry-run on `recommended_edits`** (via [`scripts/preflight-live-at-auto-promotion.ts`](../scripts/preflight-live-at-auto-promotion.ts)):

```
recommended_edits:                         31
page_element_inventory:                  4,200
acceptance-tier rows with null live_at:     0
```

The 31 Ritz `recommended_edits` rows already have `live_at` populated where shipped (via Mark Shipped) and null where pending — none are stuck in "accepted with null live_at" state.

### 3. What evidence proves an edit is live?

The Phase 3 match engine ([`src/domains/recommendations/match-engine/`](../src/domains/recommendations/match-engine/)) compares the proposed-edit's `target_element_key` + `proposed_text` against the rendered `page_element_inventory` for the URL. The match types are:

- `exact` — element_key + text match
- `modified` — element_key match, text differs (operator iterated)
- `key_only` — element_key match, no text comparison applicable
- `text_only` — text match on a different element_key
- `wrong_page` — text match on a DIFFERENT URL's inventory
- `structural_partial` — partial match (e.g., FAQ pair where question landed but answer didn't)
- `none` — no match in any inventory

The runner stamps `live_at = scan.fetched_at` only on `verified_live*` outcomes (exact / modified / key_only / text_only).

### 4. Is there already Phase 3 match engine work?

**Yes — fully built.** Files:

| File | Purpose |
|---|---|
| [`src/domains/recommendations/match-engine/index.ts`](../src/domains/recommendations/match-engine/index.ts) | Pure match function `matchAcceptedEdit(...)` |
| [`src/domains/recommendations/match-engine/per-action-matchers.ts`](../src/domains/recommendations/match-engine/per-action-matchers.ts) | Per-action logic (edit_title, add_h2_section, add_faq, etc.) |
| [`src/domains/recommendations/match-engine/faq-pair.ts`](../src/domains/recommendations/match-engine/faq-pair.ts) | Q+A pairing for FAQ matches |
| [`src/domains/recommendations/match-engine/normalize-text.ts`](../src/domains/recommendations/match-engine/normalize-text.ts) | Text normalization for fuzzy matching |
| [`src/domains/recommendations/match-engine/similarity.ts`](../src/domains/recommendations/match-engine/similarity.ts) | Edit-distance scoring |
| [`src/domains/recommendations/match-runner/index.ts`](../src/domains/recommendations/match-runner/index.ts) | Orchestrator wired into `runWebsiteScan` |
| [`src/domains/recommendations/match-runner/transitions.ts`](../src/domains/recommendations/match-runner/transitions.ts) | Pure status-transition function (verified_live, needs_review, wrong_page, etc.) |
| [`src/domains/recommendations/match-runner/persist.ts`](../src/domains/recommendations/match-runner/persist.ts) | File-first + dual-write of `live_at` stamps |
| [`src/domains/recommendations/match-runner/inventory-by-url.ts`](../src/domains/recommendations/match-runner/inventory-by-url.ts) | Per-URL inventory lookup |
| [`src/domains/recommendations/match-runner/reconcile.ts`](../src/domains/recommendations/match-runner/reconcile.ts) | Pre-pass that flips `recommended` → `accepted` for reconciliation |

The pipeline is wired into the scan orchestrator at [`src/domains/scanning/orchestrate-scan.ts`](../src/domains/scanning/orchestrate-scan.ts):

```ts
const lifecycleEnabled = isLifecycleEnabled();
// ...
if (lifecycleEnabled) {
  await runLifecycleMatch({ scanRunId, snapshotsByUrl, ... });
}
```

The `if (!isLifecycleEnabled()) return null;` early-out at [`match-runner/index.ts`](../src/domains/recommendations/match-runner/index.ts) ensures byte-identical no-op when the flag is off.

### 5. What's missing?

Nothing in code. Three operator-driven steps from the [`flags.ts`](../src/lib/flags.ts) dogfeed sequence:

1. **Verify Phase 2 match-engine purity invariants green.** Existing tests at `src/domains/recommendations/match-engine/match-engine.test.ts` — currently passing as part of the 5,054-test suite.
2. **Sign off Phase 3 in `.data/global/exit-gates.json`.** Currently `[]`. Operator decides when this is appended.
3. **Set `BEACON_LIFECYCLE_ENABLED=1` locally; run a manual scan; verify `recommended_edits` lifecycle fields populate correctly.** Then enable on Vercel.

### 6. Dry-run on Ritz changelog (the actual gap)

The 3 stamped changelog rows on Ritz:

| changelog id | rec_id | action_type | element_key | live_at |
|---|---|---|---|---|
| `cl-mogzw78nv8pu54` | Whole Home Renovation | `add_h2_section` | `h2[new]:a1b2…` | **2026-04-28** ✓ |
| `cl-mogzw78n87lkhq` | Whole Home Renovation | `add_faq` | `faq_question[new]:b1c2…` | null ✗ |
| `cl-mogzw78n5j9e7u` | Whole Home Renovation | `add_faq` | `faq_answer[new]:c1d2…` | null ✗ |

The **`[new]:` suffix on element_keys means "additive edit, content not yet on page"** — these are placeholder keys created at acceptance time. After the edit goes live, a fresh scan re-keys them to real rendered hashes (`faq_question[N]:realhash`).

Why row 1 has `live_at` and rows 2-3 don't:
- Row 1's H2 element became live, was matched + stamped (likely by Mark Shipped operator override).
- Rows 2-3 (FAQ Q+A pair) require the match engine's `faq-pair.ts` logic to match against the new rendered `faq_question[N]:` + `faq_answer[N]:` keys in a fresh inventory. Since the lifecycle flag is OFF, the match runner has not run; manual Mark Shipped wasn't invoked for these two rows.

**This is the gap the Phase 3 dogfeed flip closes.** Once the operator runs the dogfeed sequence:

1. The next scheduled scan will rebuild `page_element_inventory` from the current site HTML.
2. The match runner will iterate accepted edits, see the FAQ Q+A pair, run `faq-pair.ts` matching against new inventory rows, conclude "this FAQ is now live (matches faq_question[N]:realhash + faq_answer[M]:realhash)".
3. `persistChangelogLiveAt` will stamp `live_at = scan.fetched_at` on changelog rows `cl-mogzw78n87lkhq` and `cl-mogzw78n5j9e7u`.
4. The materializer's next 07:00 UTC cron will then compute verdicts for the now-shipped rows.

### 7. Implementation feasibility — is this tiny enough to ship now?

**No.** The implementation requires:

- A real page snapshot to match against — only available via cron-driven scan, not from this preflight environment.
- Operator-driven exit-gate sign-off (governance step the operator owns).
- Production observation of the resulting `live_at` stamps to verify correct shape (lifecycle dogfeed step 3).

Doing any of these three from inside the preflight environment would (a) trigger a paid-API-adjacent scan or (b) skip the operator's safety gate. Both violate the brief's hard constraints.

**T7.2 stops at preflight.**

---

## 2. What the preflight delivers

| Deliverable | Status |
|---|---|
| Architecture survey | This doc, §1.4 + §1.5. |
| Dry-run script | [`scripts/preflight-live-at-auto-promotion.ts`](../scripts/preflight-live-at-auto-promotion.ts) — read-only, prints which `recommended_edits` rows have an exact element_key match in current `page_element_inventory`. Confirms 0 candidates on the `recommended_edits` side (none are stuck). |
| Identified candidate rows | The 2 FAQ changelog rows (`cl-mogzw78n87lkhq` + `cl-mogzw78n5j9e7u`) are the actual auto-promotion candidates, but on the **changelog side** not `recommended_edits` side. Match runner handles both sides; current preflight-script focus on `recommended_edits` was over-narrow but the read-out is honest. |
| Implementation plan | Operator-driven dogfeed sequence per `flags.ts` doc — 3 steps. |
| Safe-to-implement-now decision | **NO.** Defer to operator. |

---

## 3. Recommended operator dogfeed sequence (when ready)

```
Step 1 — verify Phase 2 invariants green:
  npm run test  # match-engine.test.ts must be green; currently 5054/5054 ✓

Step 2 — sign off Phase 3:
  Append a row to .data/global/exit-gates.json with phase="lifecycle-os-phase-3",
  signed_by="operator", date=ISO. (File currently [].)

Step 3 — flip the flag locally + verify:
  BEACON_LIFECYCLE_ENABLED=1 npm run dev
  # Trigger a manual scan via /api/cron/scan or wait for next scheduled scan
  # Verify the 2 FAQ rows get live_at stamped:
  npx tsx --require ./scripts/mock-server-only.cjs scripts/preflight-live-at-auto-promotion.ts

Step 4 — promote to Vercel:
  Set BEACON_LIFECYCLE_ENABLED=1 in Vercel env. Next scan auto-stamps.

Step 5 (optional, after ≥7 days of dogfeed):
  Set BEACON_LIFECYCLE_VERDICT_ENABLED=1 to flip the verdict engine to use
  live_at as the baseline-split anchor (Phase 4 — independent flag).
```

**Time estimate**: ~1 hour to prep + 7 days of observation.
**Risk**: Low (the runner is gated; flipping back is a 1-line env change).
**Rollback**: Remove the env var; runner returns to no-op.

---

## 4. Verification

- ✅ Architecture survey complete; all match-runner files identified.
- ✅ Dry-run script runs in <30s; prints 0 stuck `recommended_edits` rows.
- ✅ Changelog probe identifies 2 FAQ rows as the actual unmatched candidates.
- ✅ No paid APIs. No scan triggered. No flag flipped. No mutations.
- ✅ Quality gates running below.

---

## 5. Hard-constraint compliance

- ✅ Preflight only — implementation explicitly deferred per brief's "Stop after preflight unless implementation is clearly low-risk."
- ✅ No flag flipped. No exit-gate sign-off. No scan triggered.
- ✅ No paid APIs. No OpenAI calls.
- ✅ No second tenant. No RLS / auth / Profound / onboarding / billing.
- ✅ No customer-visible UI changes.
- ✅ No row mutations.

---

## 6. Where T7.3 picks up

The brain-health regression watchdog (T7.3) will include `live_at` freshness as a sub-check: if any acceptance-tier row in `recommended_edits` has been stuck with `live_at: null` for >14d, the watchdog flags it as a trust risk. This gives the operator a passive monitoring signal without requiring the dogfeed flip yet.
