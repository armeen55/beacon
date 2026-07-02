# Beacon — Recommendation Learning Loop Preflight (Trust Sprint T6.3)

**Date:** 2026-05-06 (PT) / 2026-05-07 (UTC report timestamp)
**Author:** Claude (Trust Sprint executor)
**Tenant:** `tenant-ritz-founder` (Ritz Builders)
**Source script:** [`scripts/analyze-recommendation-outcomes.ts`](../scripts/analyze-recommendation-outcomes.ts)
**Source snapshot:** `.data/_reports/rec-outcome-analysis-2026-05-07T04-54-35.json` (operator-local; gitignored)

---

## 0. TL;DR (one-paragraph for the operator)

The brain has the data shape it needs to *see* recommendation → URL outcome co-occurrence (100% URL-join rate after normalization), but it cannot *attribute causality* yet because today's recommended-edits rows do not stamp the changelog id they produced. The current rec queue is too small (31 rows, 1 verified_live) to support real pattern learning. Two structural fixes — (1) normalize URL at write-time, (2) stamp `rec_id ↔ change_id` at accept-time — would unlock a real learning loop. Without them, "brain trains on rec outcomes" reduces to selection-bias confirmation. **Do NOT build a learning engine on the current shape. T6.3 is preflight; the real work is the structural fix in a future mini-phase + a longer dogfood window to grow the labeled-outcome sample.**

---

## 1. Scope and contract

This document is the read-only preflight for "brain learns from recommendation outcomes." Per the operator's Trust Sprint brief:

> "Brain-to-recommendation learning loop preflight — analyze rec types → outcomes."

Specifically OUT of scope:
- No engine changes.
- No ML model.
- No new persistence shape.
- No customer-facing UI.

IN scope:
- Honest analysis of what the current data allows.
- Honest gaps that block a real learning loop.
- Recommended next 3 steps to unblock.

---

## 2. What the analyzer surfaces today (Ritz, 2026-05-07 04:54 UTC)

### 2.1 Status funnel

| Status | Count |
|---|---|
| recommended (queued, awaiting operator) | 23 |
| dismissed | 7 |
| verified_live | 1 |
| **Total** | **31** |

Operator reviewed 8 of 31 (26% review rate). Of those reviewed, 1 shipped + 7 dismissed (12.5% ship-rate of reviewed). Sample size for any "learning" is **N=8 reviewed, N=1 shipped**. This is small.

### 2.2 Source funnel

| Source | Total | Reviewed | Accepted | Verified live | Dismissed | Ship-rate (reviewed) |
|---|---|---|---|---|---|---|
| deterministic | 5 | 5 | 0 | 0 | 5 | 0.0% |
| openai | 23 | 3 | 0 | 1 | 2 | 33.3% |
| operator_edited | 3 | 0 | 0 | 0 | 0 | — |

**Honest signal**: deterministic generators emit recs the operator dismisses 100% of the time on this sample. OpenAI ships at 33% of reviewed. **Sample is too small to call this a real verdict on either source** — but the directional read (deterministic struggles, LLM does better) is consistent with the LR-1/LR-2/DryRun rounds in the verification log.

### 2.3 Confidence funnel

| Confidence | Total | Reviewed | Shipped | Ship-rate (reviewed) |
|---|---|---|---|---|
| high | 0 | 0 | 0 | — |
| medium | 31 | 8 | 1 | 12.5% |
| low | 0 | 0 | 0 | — |

**Major finding**: 100% of recs are tagged `medium` confidence. T4.4 (derived confidence — "stop 'all medium'", commit `72b8675`) was supposed to fix this. Either:
- T4.4's logic does not run on these specific rows (timing / rec source / edit type).
- T4.4 is running but the inputs collapse to medium for this set.
- The persisted rows pre-date T4.4 and were never recomputed.

This is a **trust-sprint follow-up worth investigating in a separate mini-phase**. Without confidence-tier differentiation, the brain has nothing to calibrate against.

### 2.4 Time-to-live (verified_live recs)

- N = 1 verified_live row (cl-real-224's underlying rec, presumably).
- Median days from `created_at` to `live_at`: 0.94 days (~22 hours).
- Bucket: same_day = 1; other buckets = 0.

**Sample size of 1 is below threshold for any conclusion.** Need ≥10 verified_live rows before time-to-live distribution carries signal.

### 2.5 Cost vs ship (LLM source only)

- 23 LLM recs at $0.0035 average per rec → $0.0804 total spent.
- 1 shipped → cost-per-shipped = $0.0804.
- 3 reviewed → cost-per-reviewed = $0.0268.

Healthy cost shape; the bottleneck is operator review throughput, not LLM emission cost.

### 2.6 Rec → URL outcome join

After URL-normalization fix at read-time:

| Metric | Value |
|---|---|
| recs with target_url | 31 |
| recs whose target_url has at least one verdict | 31 |
| **Join rate** | **100.0%** |

| Verdict on joined recs | Count |
|---|---|
| helping | 25 |
| nothing_yet | 6 |

By action_type × verdict:

| action_type | helping | nothing_yet |
|---|---|---|
| add_h2_section | 9 | 2 |
| add_faq | 16 | 4 |

**This number is structurally compromised** — see §3 for why.

---

## 3. The honest gap: structural inability to attribute causality

The 100% join rate looks great until you read it carefully:

- Each rec targets a specific URL.
- Every URL on Ritz that the verdict engine evaluates has at least one verdict (because there are many changelog entries per URL — operator-entered + scanner-detected + import-batch + recommendation-derived).
- Joining `rec.target_url` → `url-change-outcomes.url` returns the URL's verdict, but **not the verdict caused by THIS rec**.

Concrete shape of the problem:

```
URL = /locations/los-altos
  Changelog entries on this URL:
    cl-real-1   (operator-entered, 2026-04-22)         → verdict = helping
    cl-real-12  (scanner-detected, 2026-04-25)         → verdict = helping
    cl-real-37  (rec-derived from rec abc-123, 2026-05-04) → verdict = helping
    ...
  Recs targeting this URL:
    rec-abc-123  (LLM, accepted 2026-05-04) → joined to "first verdict" = helping
    rec-def-456  (LLM, recommended)         → joined to "first verdict" = helping
    rec-ghi-789  (LLM, recommended)         → joined to "first verdict" = helping
```

The "first verdict" picked by the analyzer is not necessarily the verdict caused by the joined rec. The 25 helping / 6 nothing_yet split tells us that recs target URLs that are mostly already helping — a **selection-bias confirmation**, not a causal signal.

For a real causal join we need:

1. **Stamp `rec_id` on the changelog row** the rec produces at accept-time. Today, accepting a rec creates a changelog entry but the link is not persisted on the changelog row. The link IS persisted on the rec row (`recommended_edits.live_match_kind`, etc.), but the inverse direction (changelog → producing rec) is missing.
2. OR maintain a `(rec_id, change_id)` join table populated at accept-time.

Either way, today the brain cannot ask: *"What URL verdict came from the change THIS rec produced?"*

---

## 4. Two structural fixes that would unblock a real learning loop

### Fix A — normalize URL at write-time

**Problem.** `recommended_edits.target_url` is full URL (`https://ritzbuilders.com/locations/los-altos`); `url_change_outcomes.url` is path-only (`/locations/los-altos`). Cross-store joins require analyzer-side normalization.

**Fix.** Pick one shape, write it consistently.
- **Recommend path-only**, because that's what the verdict engine and citation history already use.
- Migration: write-side fix in [`recommended-edits-persistence.ts`](../src/domains/recommendations/recommended-edits-persistence.ts) `mapSpecificEditToRow()` to call `urlToPath()` on `target_url` before persistence. Existing rows can be migrated by a one-shot script (or just left as-is; this analyzer's read-time normalization is a back-compat no-op).
- Alternative: keep both, add a derived `target_path` column populated at write-time.

**Estimate.** ~1 hour. One file modified. New invariant: `target_url` matches `^/[^?#]+$`.

### Fix B — stamp `rec_id ↔ change_id` at accept-time

**Problem.** Brain can see "rec X targeted URL Y" and "URL Y has verdict Z", but cannot see "the change rec X produced got verdict W". Without this link, every learning attempt collapses to selection bias.

**Fix.** When a rec moves to `accepted` or `verified_live`, stamp the producing changelog row with `produced_by_rec_id`. Add column to `changelog_entries` (Supabase + .data shape) and persist in the accept-action handler.

**Estimate.** Medium. Touches:
- `changelog_entries` table schema (Supabase migration + .data type extension).
- The accept-action handler in [`src/app/(shell)/recommendations/actions.ts`](../src/app/\(shell\)/recommendations/actions.ts).
- The match engine that flips `accepted` → `verified_live` (it usually creates / discovers the changelog entry; needs to stamp).
- A backfill script for existing `verified_live` recs (lookup by URL × accept-window).

**Risk.** Backfill is best-effort; some existing rec ↔ changelog links cannot be reconstructed cleanly (multiple changelog rows on the same URL within the same week). Acceptable.

### Together: what becomes learnable

With Fix A + Fix B, the brain can answer (for any time window):

| Question | Answer surface |
|---|---|
| "What action_types ship from LLM source vs deterministic?" | already answerable (today's source funnel) |
| "What's the median time-to-live by action_type?" | already answerable once N grows |
| "What URL verdict does an action_type produce on average?" | **needs Fix B** |
| "Do high-confidence recs produce more helping verdicts?" | **needs Fix B + restored T4.4 confidence tiers** |
| "Which rec types are net-positive after 30d?" | **needs Fix B + 30d dogfood** |
| "Per-rec evidence: what packet shape correlates with helping verdict?" | **needs Fix B + extended packet-snapshot persistence** |

---

## 5. What the brain CAN learn today (honest)

Even with the gaps above, three classes of pattern are learnable now:

### 5.1 Source-acceptance calibration

Sample size is small but the directional finding is:
- Deterministic generators: 5 emitted, 5 reviewed, 0 shipped.
- LLM generators: 23 emitted, 3 reviewed, 1 shipped (33% of reviewed).

If this directional reads holds at N≥30 reviewed, the brain can adjust generator priority in the queue (LLM-source recs surface above deterministic by default).

### 5.2 Action-type acceptance

- `add_faq`: 20 emitted (16 helping URL co-occurrence, 4 nothing_yet).
- `add_h2_section`: 11 emitted (9 helping co-occurrence, 2 nothing_yet).

Both action types have a high "URL is helping" co-occurrence rate, which is the **selection-bias confirmation problem from §3**. Until Fix B, this is not a learnable signal.

### 5.3 Confidence-tier collapse alarm

Already a signal: 31/31 recs are `medium`. The brain SHOULD see at least some `high` and `low`. This is a T4.4 regression worth investigating in its own mini-phase.

---

## 6. Recommended next 3 steps (in order)

1. **Fix A — URL normalization at write-time.** Smallest scope, immediate analyzer-side cleanup, no schema changes. Do this in a focused mini-phase before or alongside any UI work that touches recommendations.

2. **Confidence-tier regression hunt.** Why are 31/31 recs medium when T4.4 explicitly stops "all medium"? Read-only investigation; documented finding. If T4.4 logic isn't reaching these rows, fix it; if T4.4 IS running but inputs collapse, document why.

3. **Fix B — `rec_id ↔ change_id` stamp at accept-time.** Larger scope (schema change + handler change + backfill). Defer until #1 + #2 land. Brain learning is blocked on this — but blocking on it is honest. Don't build a learning loop on selection-bias data.

**Out of scope for any short-term learning loop work**: ML / embeddings / model fine-tune. The bottleneck is data shape, not modeling sophistication.

---

## 7. Verification

- ✅ `scripts/analyze-recommendation-outcomes.ts` runs in <30s on Ritz canonical store.
- ✅ Snapshot persisted to `.data/_reports/rec-outcome-analysis-{ts}.json` (operator-local; gitignored).
- ✅ No paid APIs called. No mutations.
- ✅ Both URL shapes (full + path-only) found in source data — confirms Fix A is real, not a false alarm.
- ✅ All 31 recs are medium confidence — confirms T4.4 follow-up is real, not a false alarm.

---

## 8. What this preflight is NOT

- Not a learning engine.
- Not a model spec.
- Not a UI proposal.
- Not a customer-facing surface.
- Not a green light to start training.

It is a sober inventory of *what current data allows*, with two structural fixes that would unblock a real learning loop and a recommendation to defer engine work until those fixes land + the dogfood window grows.

---

## 9. Pointers

- Source script: [`scripts/analyze-recommendation-outcomes.ts`](../scripts/analyze-recommendation-outcomes.ts)
- Schema: [`src/domains/recommendations/recommended-edits-persistence.ts`](../src/domains/recommendations/recommended-edits-persistence.ts)
- Verdict store: [`src/domains/attribution/url-change-outcome.ts`](../src/domains/attribution/url-change-outcome.ts)
- Brain Health context: [`docs/VERIFICATION_LOG.md`](VERIFICATION_LOG.md#2026-05-06--trust-sprint-mini-phase-t61--brain-health-index-operator-only)
- Local AEO derivations the brain reads from: `.data/tenants/ritz-builders/brain/*.json` (built by `scripts/build-local-aeo-intelligence.ts`)
