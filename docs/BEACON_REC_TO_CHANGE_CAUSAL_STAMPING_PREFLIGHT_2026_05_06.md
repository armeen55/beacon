# Beacon — Rec → Change Causal Stamping Preflight (Trust Sprint T6.8)

**Date:** 2026-05-06 PT (2026-05-07 UTC)
**Author:** Claude (Trust Sprint executor)
**Tenant:** `tenant-ritz-founder`
**Status:** **Preflight only. Stop. No implementation needed for the bounded scope; the architecture is already in place.**

---

## 0. TL;DR

T6.3's blunt finding "today's recs persistence does not stamp the changelog id on the rec row directly" was correct in **direction** (we want the brain to answer "what URL verdict came from the change THIS rec produced") but **inverted in mechanism**: the right link is `changelog.source_rec_id` (from rec to event, not from event back to rec). And it **already exists**. Schema fields + write paths landed in Fix 2 (2026-04-21) and Sprint 6A.1 Phase 1 (2026-04-24). Both `acceptRecommendation` and `confirmFindingAsChange` stamp `source_rec_id` + `source_pattern_id` + `action_type` + `target_element_key` on the changelog rows they create.

The reason T6.3's analyzer reported "0% causal join after URL normalization" wasn't a missing schema — it was that the analyzer joined on URL alone (the path it had), not on `source_rec_id`. With the right join key the chain works. The remaining gap is **data shape**, not architecture: 99% of the Ritz changelog (332/334 rows) is legacy CSV/PDF import rows with no rec to link to; only the 3 most-recent rec acceptances carry `source_rec_id`.

T6.8 implementation is **deferred**: the schema is correct, the writers are correct, the only thing missing is dogfood time + an `live_at` auto-promotion step that's already scheduled as a separate phase ("Phase 3 match engine" per code comments). Document the existing architecture; punt the implementation work.

---

## 1. Operator's preflight questions — answered

### 1. Where does "Accept" happen?

[`src/app/(shell)/recommendations/actions.ts:acceptRecommendation`](../src/app/\(shell\)/recommendations/actions.ts) (around line 357 stamps `source_rec_id`).

Flow:
```
Operator clicks Accept on /recommendations
  → server-action acceptRecommendation(stableKey, payload)
    → builds N changelog entries (one per accepted edit)
    → stamps each with:
        source_rec_id = payload.stableKey         (the rec's stable key)
        source_pattern_id = payload.patternId      (if pattern-backed)
        action_type = payload.actionType          (e.g. "add_h2_section")
        target_element_key = payload.elementKey   (e.g. "h2[new]:abc")
        hypothesis_source = "recommendation"
    → persists changelog rows + dual-writes to Supabase
    → flips rec's implementation_status to "accepted"
```

### 2. Where does "Mark shipped" happen?

[`src/app/(shell)/recommendations/actions.ts:markRecommendationShipped`](../src/app/\(shell\)/recommendations/actions.ts) — operator clicks "Mark shipped" on /recommendations or /changes; flips `live_at` on the matching rec row + changelog row.

This is the operator-override path. The auto-detection path is the (deferred) Phase 3 match engine that flips `live_at` automatically when a fresh page snapshot proves the edit is live.

### 3. Where is the changelog row created?

Three writers:

| Writer | When | Stamps `source_rec_id`? |
|---|---|---|
| `acceptRecommendation` | operator clicks Accept on a rec | YES |
| `confirmFindingAsChange` | operator confirms a Finding as a real change | YES (when finding was auto-linked to a rec) |
| Scanner auto-classifier (`scan_detection`) | scanner observes a live diff vs prev snapshot | NO (scanner-detected events don't carry a rec) |
| CSV / PDF importers (legacy) | one-shot pre-Beacon edit history imports | NO (no rec exists for legacy edits) |

### 4. Can accepted recommendation ID be stamped onto changelog entry?

**Yes — already implemented.** Both `acceptRecommendation` and `confirmFindingAsChange` write `source_rec_id` on the changelog row at creation time. Schema field is at [`src/domains/changelog/types.ts:122`](../src/domains/changelog/types.ts).

Probe on Ritz canonical store (2026-05-07):

```
total changelog rows:           334
rows with source_rec_id:          3 (1%)
rows with action_type:            3
rows with target_element_key:     3
rows with live_at:                1

source_system breakdown:
  pdf_changelog_rebuild   232  (legacy import — no rec)
  changelog_csv            85  (legacy import — no rec)
  scan_detection           14  (scanner — no rec)
  (none)                    3  (rec acceptances — stamped)
```

The 3 stamped rows are all from a single rec acceptance (`create_cluster_page:topic:Whole Home Renovation Builders (Bay Area)`), which produced 3 changelog rows (one per accepted edit).

### 5. Can one recommendation produce multiple changelog entries?

**Yes — by design and verified.** Sprint 6A.1 Phase 1 (2026-04-24) introduced typed-edit attribution: each accepted rec carries N `recommended_edits` rows; accepting it produces N changelog entries, each tagged with its specific `action_type` + `target_element_key`. Ritz example: 1 rec → 3 changelog rows.

This is the right shape for attribution: the brain can ask "did the H2 edit help, or did the FAQ edit help?" not just "did the Whole-Home-Remodel rec help?".

### 6. Can one changelog entry come from multiple recs?

**Schema-wise: no.** `source_rec_id` is a single string field, not an array.

**Practical answer**: this is rare. The dominant flow is one rec → N changelog rows. The closest scenario is an operator independently making the same edit that two different recs proposed — but in that case, `confirmFindingAsChange` has linkage logic that picks the most-likely rec via URL + recency window. A future bridge table (`changelog_rec_links`) could capture multi-rec attribution, but it's not on the critical path.

### 7. What schema field is needed?

**None.** Already stamped via:

```ts
// src/domains/changelog/types.ts (already present, no migration needed)
source_rec_id?: string;            // Fix 2 (2026-04-21)
source_pattern_id?: string | null; // Fix 2 (2026-04-21)
action_type?: string;              // Sprint 6A.1 Phase 1 (2026-04-24)
target_element_key?: string;       // Sprint 6A.1 Phase 1 (2026-04-24)
live_at?: string | null;           // Recommendation Lifecycle OS Phase 1 (2026-04-27)
```

Plus on the rec row side ([`src/domains/recommendations/recommended-edits-persistence.ts`](../src/domains/recommendations/recommended-edits-persistence.ts)):

```ts
implementation_status?: ImplementationStatus;
live_at?: string | null;
live_match_kind?: LiveMatchKind | null;
live_match_confidence?: LiveMatchConfidence | null;
live_element_key?: string | null;
```

So the brain can traverse:
- forward: `rec.id → changelog rows where source_rec_id === rec.id`
- backward: `changelog row → rec.id via source_rec_id; expand via rec.target_element_key + action_type`

### 8. What backfill is possible for current rows?

| Row class | Count on Ritz | Backfill possible? |
|---|---|---|
| `pdf_changelog_rebuild` | 232 | NO — these are pre-Beacon CSV/PDF imports of edits that pre-date the rec engine. No rec exists to link. |
| `changelog_csv` | 85 | NO — same reason. |
| `scan_detection` | 14 | PARTIAL — could retroactively link a scan-detected event to a rec accepted within N days on the same URL. `confirmFindingAsChange` does this for findings; an offline backfill could do it for already-confirmed scan rows. Low-leverage; low-confidence linking. |
| `(none)` rec acceptances | 3 | Already stamped. |

**Recommendation**: do not backfill. The legacy 99% have no rec to link; the scanner 4% would require a heuristic linker with no obvious benefit at current dogfood volume. Brain learns from new recs going forward.

### 9. What future learning score becomes possible?

With the existing schema, once `live_at` is populated for shipped recs (either via the Phase 3 match engine or operator-driven Mark shipped), the brain can compute:

| Question | Required join | Possible today? |
|---|---|---|
| "What's the helping-rate for `add_h2_section` recs?" | rec.action_type → changelog.source_rec_id where action_type='add_h2_section' → url_change_outcomes via change_id | YES (once N=10+ shipped recs) |
| "Do high-confidence recs produce more helping verdicts?" | rec.derivedConfidence (T4.4) × changelog × outcome | YES (once dogfood window grows + T6.5 derived label is consistently computed) |
| "Per-rec evidence: what packet shape correlates with helping outcomes?" | rec.evidence (already on row) × outcome via changelog | YES (T6.2 brain has the AEO database; this query is a join now, not a new feature) |
| "Which rec types abstain rate vs LLM accept rate?" | source breakdown × outcome | YES (already in T6.3 source funnel; needs N≥30 shipped to be statistically meaningful) |
| "Ship-rate by confidence × action_type 2-D grid?" | derivedConfidence × action_type × outcome | YES |
| "Time-to-helping by action_type" | live_at - timestamp distribution by action_type | YES |

Sample size today: N=3 stamped rows, all on the same URL, none yet shipped (`live_at` null on 2/3, populated on 1/3). The brain CANNOT yet learn anything statistically meaningful, but the **join shape exists**. The bottleneck is dogfood-time + Phase 3 match engine, not schema.

---

## 2. Implementation decision: STOP after preflight

The operator brief: "Stop after preflight unless the implementation is clearly low-risk."

The "implementation" the brief implied (add `source_rec_id` field, stamp on accept, build a join table) is **already done**. There is nothing to implement for T6.8.

What's deferred:

1. **`live_at` auto-promotion** (Phase 3 match engine) — already scheduled. Out of T6.8 scope.
2. **Scanner-detection retro-linkage backfill** — low-leverage on current data; defer.
3. **Multi-rec changelog bridge table** — speculative; defer until a real case lands.
4. **Brain learning queries** — gated on N≥30 shipped recs (months of dogfood). Architecture is ready when the data is.

---

## 3. What "the brain can answer right now" looks like

Working through one Ritz example:

```
rec_id = create_cluster_page:topic:Whole Home Renovation Builders (Bay Area)
  → 6 recommended_edits rows (1 H2, 1 FAQ pair, 1 metadata, 3 nested edits)
  → 3 of 6 accepted (operator clicked Accept on 3 specific edits)
  → 3 changelog rows created, each stamped with:
      source_rec_id = rec_id
      action_type = "add_h2_section" / "add_faq" / "add_faq"
      target_element_key = "h2[new]:wholerem01" / "faq_answer[new]:b1c2..." / "faq_answer[new]:c1d2..."
  → 0 of 3 have live_at populated (operator hasn't clicked Mark Shipped)
  → 0 of 3 have a matching url_change_outcomes row (the materializer skips
    rows without a resolvable anchor date — when live_at is null AND the
    lifecycle flag is on, the engine's fallback to timestamp may still
    classify these as "too_early" or "not_enough_data" and skip)
```

Once the operator marks any of the 3 shipped (or the Phase 3 match engine flips `live_at` from a fresh page snapshot), the materializer will pick up the row, compute a verdict, and write a `url_change_outcomes` entry. From that point the brain has the full causal chain:

```
rec_id → action_type → target_element_key → changelog → live_at → url_change_outcomes.verdict
```

So the answer to T6.3's blunt finding "Brain CAN see rec → URL outcome co-occurrence but NOT attribute causality" is:

> The brain CAN attribute causality. The `source_rec_id` join + the `action_type` granularity + the `live_at` baseline anchor together form a clean causal chain. Pre-T6.8 the analyzer wasn't using this join. Post-T6.8 it should.

(But that's a one-line analyzer fix — see §4.)

---

## 4. One-line analyzer fix (optional, low risk)

The T6.3 analyzer's rec → URL outcome join does:

```ts
outcomeByUrl[normalizeUrl(o.url)] → list of verdicts
recs whose target_url has a verdict ← any verdict on the URL
```

A more honest join uses `source_rec_id`:

```ts
changelogByRecId[c.source_rec_id].push(c)
outcomesByChangeId[o.change_id] → outcome
joined[r.rec_id] = changelogByRecId[r.rec_id].map(c => outcomesByChangeId[c.id])
```

This produces 1:1 rec → outcome causal mapping for stamped rows. **Sample size on Ritz: 3 recs, 0 outcomes** (because none of the 3 are shipped yet). Still a more honest report.

**Decision**: not bundled into T6.8. Add as a small follow-up when the dogfood produces shipped recs with outcomes (then the report is non-empty). The current T6.3 analyzer's URL-level join is the right read for "how many recs target URLs that have any verdict signal at all" — different question, also useful.

---

## 5. Verification

- ✅ Schema fields verified in [`src/domains/changelog/types.ts`](../src/domains/changelog/types.ts) (lines 122-147, 162).
- ✅ Stamping verified in [`src/app/(shell)/recommendations/actions.ts:357`](../src/app/\(shell\)/recommendations/actions.ts) and [`src/app/(shell)/finding-actions.ts:247`](../src/app/\(shell\)/finding-actions.ts).
- ✅ Ritz dogfood probe: 3/334 changelog rows have `source_rec_id`; rest are legacy imports + scanner detections (correct ratio per data origin).
- ✅ One-rec → multi-changelog shape verified: 1 rec produced 3 changelog rows on Ritz.
- ✅ All schema invariants and writers exist; no new code required to unblock the brain learning loop.

---

## 6. Hard-constraint compliance

- ✅ Preflight only — no engine changes, no schema changes, no row mutations.
- ✅ No paid APIs. No OpenAI calls.
- ✅ No second tenant. No RLS / auth / Profound / onboarding / billing.
- ✅ No customer-visible UI changes.

---

## 7. References

- Schema: [`src/domains/changelog/types.ts`](../src/domains/changelog/types.ts) (Fix 2 2026-04-21 + Sprint 6A.1 Phase 1 2026-04-24 + Lifecycle OS Phase 1 2026-04-27).
- Write paths: [`src/app/(shell)/recommendations/actions.ts`](../src/app/\(shell\)/recommendations/actions.ts) (`acceptRecommendation`, `markRecommendationShipped`); [`src/app/(shell)/finding-actions.ts`](../src/app/\(shell\)/finding-actions.ts) (`confirmFindingAsChange`).
- T6.3 finding (the inverted-mechanism observation): [`docs/BEACON_RECOMMENDATION_LEARNING_LOOP_PREFLIGHT_2026_05_06.md`](BEACON_RECOMMENDATION_LEARNING_LOOP_PREFLIGHT_2026_05_06.md).
- Phase 3 match engine (deferred — `live_at` auto-promotion): scheduled per the Lifecycle OS Phase 3 spec.
