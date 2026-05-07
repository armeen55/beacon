# Beacon — Recommendation Learning Score v0 (Trust Sprint T7.5)

**Date:** 2026-05-07
**Author:** Claude (Trust Sprint executor)
**Tenant:** `tenant-ritz-founder`
**Status:** **Implemented + reporting only.** No ranking changes. No row mutations.
**Source script:** [`scripts/analyze-recommendation-outcomes.ts`](../scripts/analyze-recommendation-outcomes.ts) Section 7.

---

## 0. TL;DR

A per-action-type learning score that aggregates over the **causal** rec → changelog → outcome chain (T7.1's `source_rec_id` join). It tracks shipped count, helping/weak_signal/nothing_yet/etc. verdict counts, derived T4.4 confidence distribution, average evidence depth, and a sample-size-gated confidence label.

**Key contract**: the score is reporting-only at v0. The brain MUST NOT change rec ranking based on rows labeled `insufficient_sample`. `directional` is operator-readable only. `credible` is the floor for any future ranking change (operator opts in).

Sample-size floors:

| Sample size | Confidence label | Use |
|---|---|---|
| 0 ≤ N < 5 | `insufficient_sample` | display only; do not affect ranking |
| 5 ≤ N < 15 | `directional` | operator-readable signal; not statistically reliable |
| N ≥ 15 | `credible` | safe to feed into rec ranking once operator opts in |

Ritz today has 0 outcomes per action_type → all rows label `insufficient_sample` → no ranking changes possible. Expected. Brain learns from new shipped recs forward; once a tenant accumulates ≥15 causal outcomes per action_type, the learning score graduates to `credible` and the operator can opt into ranking weighting.

---

## 1. Why "v0"

Three reasons this is v0 and not v1:

1. **Sample size on Ritz is zero.** Causal outcomes require both (a) a stamped changelog row and (b) a `url_change_outcomes` verdict for that change. Ritz has 3 stamped rows but 0 outcomes (T6.8 finding — `live_at` not yet populated on FAQ rows + materializer skipped them). The brain has no per-action-type signal to grade today.
2. **No ranking integration.** v0 reports the score; it does not write back to `recommended_edits.engineConfidence` or alter the queue ordering. That comes in v1 once the brain has a credible sample and the operator opts in.
3. **Single tenant.** Cross-tenant pattern learning would require the brain to aggregate causal outcomes across multiple tenants. Out of scope for the single-tenant dogfeed phase. The score's data shape is forward-compatible with a `tenant_id` index.

---

## 2. Score shape (per action_type)

```ts
{
  action_type: string,
  shipped_causal_count: number,        // changelog rows stamped + matching live rec
  causal_outcome_count: number,        // subset that has a url_change_outcomes row
  causal_helping: number,
  causal_weak_signal: number,
  causal_nothing_yet: number,
  causal_hurting: number,
  causal_too_early: number,
  causal_other: number,
  derived_strong: number,              // T4.4 derived label distribution among
  derived_moderate: number,            //   ALL recs of this action_type (not
  derived_needs_review: number,        //   just the ones with outcomes)
  needs_review_rate: number,           // derived_needs_review / total recs
  avg_evidence_depth: number,
  sample_size: number,                 // = causal_outcome_count
  confidence_label: "insufficient_sample" | "directional" | "credible"
}
```

---

## 3. Result on Ritz (2026-05-07)

```
Section 7. Recommendation learning score v0 (CAUSAL, per action_type)
  [⚠ insufficient_sample] add_h2_section
       shipped=1 causal_outcomes=0 (helping=0, weak=0, nothing_yet=0)
       derived: strong=0 moderate=10 needs_review=1 (rate 9.1%)
       avg_evidence_depth=2.36 sample_size=0
  [⚠ insufficient_sample] add_faq
       shipped=2 causal_outcomes=0 (helping=0, weak=0, nothing_yet=0)
       derived: strong=0 moderate=18 needs_review=2 (rate 10.0%)
       avg_evidence_depth=2 sample_size=0
```

Honest reading:
- The brain has shipped 1 H2 + 2 FAQ rows (causal stamping working).
- None of these have outcomes yet (live_at gap surfaced in T7.2).
- T4.4 derivation is differentiating (10% needs-review rate is non-zero, not all-medium).
- Average evidence depth is reasonable (~2-3 grounding categories per rec).
- Sample size is 0 → no ranking effect → no over-learning risk.

---

## 4. Rules (operator-locked)

1. **Sample-size floor for any ranking change**: N≥15 (`credible`).
2. **Operator opts in**: even at `credible`, the brain does NOT auto-weight ranking until the operator explicitly turns this on. Until then it's reporting only.
3. **No mutation**: the score script does not write back to `recommended_edits` or any other persisted row.
4. **URL-level coincidence is NOT causal**: the score uses `changelog.source_rec_id` exclusively. Section 6.A's URL-level join is reporting context, not learning input.
5. **Tenant isolation**: the score is per-tenant. Cross-tenant patterns are deferred.

---

## 5. What unblocks v1

| Gate | What's needed | Where it stands |
|---|---|---|
| Causal sample size ≥15 per action_type | Months of dogfeed + Phase 3 match runner enabled (T7.2 preflight) | 0 today |
| Phase 3 match runner enabled | Operator flips `BEACON_LIFECYCLE_ENABLED=1` after exit-gate sign-off | Flag OFF |
| Operator opt-in to ranking weighting | Operator decision after reviewing v0 reports | Pending |
| Cross-tenant aggregation (v2) | 2nd tenant onboarded; cross-tenant brain stub activated | Single-tenant only today |

---

## 6. Verification

- ✅ Script runs in <30s on Ritz canonical store.
- ✅ Section 7 emitted in markdown report + JSON snapshot.
- ✅ Sample-size labels correct (all rows `insufficient_sample` at N=0, as expected).
- ✅ Causal join uses `source_rec_id`, not `target_url`.
- ✅ Negative invariants: no rec mutations.
- ✅ 11 architecture invariants pin the contract.

---

## 7. Hard-constraint compliance

- ✅ Read-only — no engine changes, no schema changes, no row mutations.
- ✅ No ranking changes today; the score is reporting-only.
- ✅ Sample-size gate prevents overfitting on Ritz tiny data.
- ✅ No paid APIs. No OpenAI calls.
- ✅ No second tenant. No RLS / auth / Profound / onboarding / billing.
- ✅ No customer-visible UI changes.
- ✅ Tests TIGHTEN the contract.

---

## 8. References

- T7.1 causal analyzer (foundation): [`scripts/analyze-recommendation-outcomes.ts`](../scripts/analyze-recommendation-outcomes.ts) Section 6.B.
- T7.2 `live_at` auto-promotion preflight: [`docs/BEACON_LIVE_AT_AUTO_PROMOTION_PREFLIGHT_2026_05_07.md`](BEACON_LIVE_AT_AUTO_PROMOTION_PREFLIGHT_2026_05_07.md).
- T6.8 rec↔change causal stamping preflight: [`docs/BEACON_REC_TO_CHANGE_CAUSAL_STAMPING_PREFLIGHT_2026_05_06.md`](BEACON_REC_TO_CHANGE_CAUSAL_STAMPING_PREFLIGHT_2026_05_06.md).
- T4.4 derived confidence (input): [`src/domains/recommendations/derived-confidence.ts`](../src/domains/recommendations/derived-confidence.ts).
