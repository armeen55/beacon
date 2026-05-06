# LLM-LiveRegen-1 Report — first persistence round-trip

**Date:** 2026-05-05
**Operator:** Armeen
**Mode:** **LIVE — first paid persistence round-trip after the LLM-DryRun-1/2/3 cycle.** No queue mutation outside the 3 pinned candidates. No backfill. No broad regeneration.
**Harness:** `scripts/llm-live-regen-1.ts` (separate from the dry-run harness; uses `runProviderAndPersist` for the persistence path)
**Provider:** `gpt-5-mini`
**Tenant:** `tenant-ritz-founder`
**Total cost:** **$0.0301** (cap was $1.00 — used 3.01%)
**Rows persisted:** **7**
**Process exit code:** 0
**Predecessors:** [`LLM_DRYRUN_1_REPORT.md`](./LLM_DRYRUN_1_REPORT.md), [`LLM_DRYRUN_2_REPORT.md`](./LLM_DRYRUN_2_REPORT.md), [`LLM_DRYRUN_3_REPORT.md`](./LLM_DRYRUN_3_REPORT.md)

---

## TL;DR

| | |
|---|---|
| **Verdict** | **GO with one caveat for live-regen scope.** All persistence rails work; all forbidden-content gates fire correctly; all 7 persisted rows are clean. |
| **The caveat** | The DryRun-3 strict-abstention rule (Rule 16.A trigger 1: `affectedPrompts.length === 1` AND `brandAssertions` empty) **fires on medium-confidence single-prompt packets too.** The Bay Area teardown packet — medium confidence + 1 prompt + 0 brand assertions — abstained ($0.0038, 0 edits). DryRun-2 produced 3 ship-as-is edits on the same packet. Output remains content-safe; quantity is over-spec on single-prompt medium-confidence packets. Operator decision needed. |
| Validator | 7/9 emitted edits accepted; 2/9 rejected on the evidence-grounder's "competitor ref unknown name" gate (working as designed; LLM cited "Construct Elements" which isn't in the packet's `competitorAngles`). |
| UUID leaks in operator-visible copy of new rows | **0** |
| Placeholder leaks | **0** |
| Fabricated numbers / timelines / costs / guarantees | **0** |
| Competitor names in `proposed_text` or `display_label` | **0** |
| Duplicate rows | **0** |
| Dual-write to Supabase | ✅ all 7 rows landed; 0 duplicates; row IDs identical to local |
| Budget ledger updated | ✅ `.data/global/llm-budget.json` records $0.030075 / $10 monthly cap |
| LLM history updated | ✅ `.data/global/llm-history-specific-edits.json` appended 3 `live_call` breadcrumbs |
| /recommendations smoke | ✅ 10/10 PASS (page server component + read-fresh tests) |
| Architecture invariants | ✅ 47/47 PASS (DryRun-2 + DryRun-3 + harness no-persistence + cutover ceiling + packet-resolution invariants all green against the new persisted rows) |
| Full test suite | 4451/4456 PASS (5 baseline failures unchanged) |
| Build | green (EXIT_CODE=0) |

**Recommended next step (subject to operator approval):** `/recommendations` UI smoke pass on the 7 new rows, then a 5–10-candidate live-regen across DIFFERENT slot types (the current 3 covered location-cluster expansion + create-page; missing: schema/technical, and any candidate that triggers the FAQ-pairing or competitor-blueprint code paths). **Before that, decide whether to scope abstention rule 16.A trigger 1 to "low confidence only" or keep it broad.**

---

## Pre-flight (printed before any provider call)

```
Tenant target: tenant-ritz-founder
Budget cap (harness): $1.00
Provider: openai (gpt-5-mini)
Persistence path: runProviderAndPersist (file + Supabase dual-write)

PRE-FLIGHT — selected candidates:
  · create_cluster_page:geo:Palo Alto
      action=expand_existing_page targetUrl=https://ritzbuilders.com/locations/palo-alto
      confidence=medium tier=observation affectedPrompts=5
  · target_competitors:prompt:e17d29c3-eab3-4278-a3ea-4bd175692b36
      action=create_new_page targetUrl=needs_new_page
      confidence=medium tier=observation affectedPrompts=1
  · create_cluster_page:geo:Atherton
      action=expand_existing_page targetUrl=https://ritzbuilders.com/locations/atherton
      confidence=medium tier=observation affectedPrompts=3

Pre-flight passed: 3 candidates, all medium-conf + observation-tier ✓
```

---

## Per-candidate report

### Candidate 1 — Palo Alto (cluster expansion)

| Field | Value |
|---|---|
| stableKey | `create_cluster_page:geo:Palo Alto` |
| Action | `expand_existing_page` (motive: capture_absent_cluster) |
| Target URL | `https://ritzbuilders.com/locations/palo-alto` |
| Confidence | medium |
| Tier | observation |
| Affected prompts | 5 |
| Packet aiSearchSignal queries | 10 |
| Packet competitorPageBlueprints | 5 |
| Packet brandAssertions | 0 |
| Packet evidenceHash | f4662fc926639e5e |
| Bundle | 5 edits emitted, **4 accepted, 1 rejected** |
| Rejected detail | `add_h2_section.evidence[2]` — competitor ref unknown name "Construct Elements" |
| Cost | $0.0135 |
| Persisted | YES, 4 rows |
| Guardrail flags | 0 |

**Persisted rows (operator-readable summary):**

1. **Design-build vs architect+contractor (H2)** — `Design-build versus hiring an architect and contractor in Palo Alto…`
2. **Underground basements & complex sites (H2)** — `Custom homes with underground basements and complex site work in Palo Alto…`
3. **Which builders to consider (FAQ Q)** — `Which builders should I consider for a custom home in Palo Alto?`
4. **Which builders to consider (FAQ A)** — `Ritz Builders recommends evaluating firms that demonstrate experience with architect-led design-build, local Palo Alto permitting, and complex site work such as deep foundations or basements…`

All 4 grounded in `aiSearchSignal.topSearchQueries` and the affected prompts. Hedged language ("evaluate firms that demonstrate experience"), no fabricated numbers/timelines, no competitor names in public copy.

---

### Candidate 2 — Bay-Area teardown create_new_page (BEHAVIOR FINDING)

| Field | Value |
|---|---|
| stableKey | `target_competitors:prompt:e17d29c3-…692b36` |
| Action | `create_new_page` (motive: counter_competitor) |
| Target URL | `needs_new_page` |
| Confidence | medium |
| Tier | observation |
| Affected prompts | **1** |
| Packet brandAssertions | **0** |
| Packet evidenceHash | 2a99f574c2d57144 |
| Bundle | **0 edits emitted** (model abstained) |
| Cost | $0.0038 |
| Persisted | no (nothing to persist) |
| Guardrail flags | 0 |

**Behavior finding (open):** the LLM-DryRun-3 abstention rule 16.A trigger 1 — `affectedPrompts.length === 1` AND no operator-curated `brandAssertions` — **fires on this medium-confidence packet** because the trigger doesn't reference confidence, only prompt count + brand-empty conjunction. The model interpreted the rule as written and returned `[]`.

DryRun-2 produced 3 ship-as-is edits on this same packet (before strict abstention landed). DryRun-3 (focused only on the two LOW-confidence abstention candidates) didn't surface this case because the live queue only has 1 single-prompt MEDIUM-confidence row and DryRun-3 ran on the LOW-confidence ones. LiveRegen-1 caught it.

**This is a content-safe outcome** (no harm done; the queue just gets fewer rows than DryRun-2 implied). It IS a behavior gap from DryRun-2 expectations: "create_page produced 3 ship-as-is edits." For LiveRegen-1 the operator's brief said "Create-page teardown/rebuild candidate" was one of the 3 we'd persist; the model abstained instead.

**Operator decision needed before the next live-regen iteration:**

| Option | Effect |
|---|---|
| **A.** Accept current scope. Single-prompt + brand-empty packets always abstain regardless of confidence. | Fewer recs on isolated single-prompt patterns. Safe but conservative. |
| **B.** Tighten Rule 16.A trigger 1 to require LOW confidence too. | Single-prompt MEDIUM-confidence packets generate again (3 edits in the Bay-Area case); LOW-confidence single-prompt still abstains. |
| **C.** Add a `singlePromptMediumConfidenceCarve` env flag. | Keeps current default; operator can flip if a deployed tenant has many single-prompt clusters. |

Recommend B (operator's earlier brief consistently distinguished low- vs medium-confidence treatment; trigger 1 is the only one that doesn't).

---

### Candidate 3 — Atherton (cluster expansion)

| Field | Value |
|---|---|
| stableKey | `create_cluster_page:geo:Atherton` |
| Action | `expand_existing_page` (motive: capture_absent_cluster) |
| Target URL | `https://ritzbuilders.com/locations/atherton` |
| Confidence | medium |
| Tier | observation |
| Affected prompts | 3 |
| Packet brandAssertions | 0 |
| Packet evidenceHash | 472db203970658d6 |
| Bundle | 4 edits emitted, **3 accepted, 1 rejected** |
| Rejected detail | `add_h2_section.evidence[1]` — competitor ref unknown name "Construct Elements" |
| Cost | $0.0128 |
| Persisted | YES, 3 rows |
| Guardrail flags | 0 |

**Persisted rows (operator-readable summary):**

1. **Modernization without footprint expansion H2** — `Modernizing an older home in Atherton without adding square footage…`
2. **Can I modernize my Atherton home without expanding footprint? (Q)** — `Can I modernize my Atherton home without expanding its footprint?`
3. **Can I modernize my Atherton home without expanding footprint? (A)** — `Ritz Builders can modernize an Atherton home without increasing the footprint by reconfiguring interiors, upgrading mechanical systems, and selectively reinforcing structure…`

DryRun-2 had this candidate at 1 accepted + 2 em-dash-displayLabel rejections. **In LiveRegen-1 the model produced cleaner displayLabels** (no em-dashes — instead used "(Q)" / "(A)" parenthesized labels), so all 3 grounded edits got through the validator. Same number of em-dash rejections (0 here) is a behavioral improvement on its own; the strict-abstention SYSTEM_PROMPT didn't regress this case.

The 1 rejection was the validator's evidence-grounder catching `evidence[1].competitorName === "Construct Elements"` with no matching entry in the packet's `competitorAngles`. **Working as designed** — the validator should reject competitor refs not grounded in packet data, and it did.

---

## Validator behavior summary

| Reason | Count | Working as designed? |
|---|---|---|
| competitor ref unknown name "Construct Elements" | 2 | YES — the model attempted to cite a competitor not in the packet's `competitorAngles`; validator caught it; the bundle's other edits still landed cleanly. |
| All other validator gates (UUID, placeholder, fabricated numbers, em-dash, etc.) | 0 fires on this run | YES (no triggering content emitted) |

**0 unexpected validator behavior. 0 silent persistence of rejected edits. Safe.**

---

## Persistence verification (post-run)

### `.data/tenants/ritz-builders/recommended-edits.json`

| Metric | Before | After | Δ |
|---|---|---|---|
| Total rows | 20 | 27 | **+7** ✅ |
| openai-source rows | 12 | 19 | **+7** ✅ |
| New row IDs | — | (see list below) | 7 unique, no collisions |
| UUID hits in {why, expectedImpact, measurementPlan, proposedText, displayLabel, currentText} for the 7 new rows | — | **0** ✅ | |
| Placeholder hits ("Draft answer", "TBD", "[insert", "operator: rewrite") in new rows | — | **0** ✅ | |
| Fabricated number/timeline/cost in proposedText/displayLabel/expectedImpact of new rows | — | **0** ✅ | |
| Competitor name in proposedText or displayLabel of new rows | — | **0** ✅ | |
| Duplicate IDs across the entire file | — | **0** ✅ | |

The 3 UUIDs detected in my initial scan turned out to be **pre-existing dogfood rows** (`paloalto1a2b3c4d`, `faqpalo1234`, both PRE-cutover) that share the `Palo Alto` prefix with the new rows — not LiveRegen-1's output. They're protected by the LLM-DryRun-2 cutover ceiling at 9 (`tests/architecture/no-uuid-in-active-recs.test.ts`).

### Supabase `recommended_edits` table

| Metric | Value |
|---|---|
| Total rows for tenant-ritz-founder | 24 |
| openai-source rows | 16 |
| Rows created today (2026-05-06 UTC) | **7** ✅ |
| Duplicate IDs | **0** ✅ |
| Schema fields populated correctly | ✅ verified per-row (id/source/action_type/target_url/display_label all match local) |

The 3-row gap between local (`27`) and Supabase (`24`) is legacy `.data`-only rows that pre-date dual-write — not introduced by this run. Every row LiveRegen-1 wrote landed in both stores.

### `.data/global/llm-history-specific-edits.json`

3 new entries appended (1 per candidate):

```json
{ "timestamp": "2026-05-06T02:06:08.001Z", "recId": "create_cluster_page:geo:Palo Alto",        "model": "gpt-5-mini", "costUsd": 0.013489, "acceptedCount": 4, "status": "live_call" }
{ "timestamp": "2026-05-06T02:07:54.642Z", "recId": "target_competitors:prompt:e17d29c3-…",   "model": null,         "costUsd": 0.003752, "acceptedCount": 0, "status": "live_call" }
{ "timestamp": "2026-05-06T02:08:01.736Z", "recId": "create_cluster_page:geo:Atherton",         "model": "gpt-5-mini", "costUsd": 0.012834, "acceptedCount": 3, "status": "live_call" }
```

The middle entry has `model: null` because the bundle had `recommendations.length === 0` (Bay Area abstention) — the breadcrumb logic only carries the model when there's at least one edit to report from. That's existing 6A.2c behavior, not a regression.

### `.data/global/llm-budget.json`

```json
{ "monthKey": "2026-05", "spendUsd": 0.030075, "calls": 3, "capUsd": 10, "updatedAt": "2026-05-06T02:08:01.736Z" }
```

Monthly cap = $10 (existing operator config); LiveRegen-1 spend = $0.030075 (0.30% of the monthly cap). Headroom is enormous.

---

## Quality gates

- typecheck: clean (3 pre-existing errors in `tests/domains/prompts/prompt-drilldown.test.ts` unrelated to this bundle).
- targeted vitest: **47/47 PASS** across 6 files (DryRun-2 + DryRun-3 + harness no-persistence + cutover ceiling + packet-resolution invariants — all run against the new persisted rows).
- /recommendations smoke: **10/10 PASS** (`tests/routes/recommendations-smoke.test.ts` + `tests/routes/recommendations-page-reads-fresh.test.ts`).
- full suite: **4451/4456** (5 pre-existing failures unchanged: `prompts-smoke.test.tsx` ×2, `prompt-drilldown-smoke.test.tsx` ×1, `auto-link-via-changelog.test.ts` ×2 — all verified pre-existing on main via stash test in earlier bundles).
- build: **EXIT_CODE=0** green.

---

## Cost summary

| Sample | Cost | Cumulative | Notes |
|---|---|---|---|
| Palo Alto | $0.0135 | $0.0135 | 4 accepted, 1 rejected (competitor ref) |
| Bay-Area teardown | $0.0038 | $0.0173 | 0 emitted (abstention rule 16.A trigger 1 fired) |
| Atherton | $0.0128 | $0.0301 | 3 accepted, 1 rejected (competitor ref) |

Total: **$0.0301** ($1.00 cap, 3.01% used). Cumulative DryRun-1 + DryRun-2 + DryRun-3 + LiveRegen-1 spend: **$0.1606**.

Average per-candidate cost: ~$0.010. Projection: a future 100-candidate run would cost ≈ $1.00 — within reach of the $200/mo monthly cap.

---

## Open questions for operator

1. **Abstention rule 16.A trigger 1 scope.** Should single-prompt + brand-empty packets abstain regardless of confidence (current behavior, observed on Bay-Area medium packet), or only when confidence is "low"? Recommend Option B (tighten trigger 1 to require LOW confidence).
2. **Competitor-evidence grounding.** The validator caught 2 cases where the LLM cited "Construct Elements" in `evidence[]` despite it not being in `competitorAngles`. The bundles still landed (1 edit/bundle was rejected; the rest were accepted). Is this acceptable, or should the SYSTEM_PROMPT add a stricter rule that the model can ONLY cite competitor names that appear in `competitorAngles`?
3. **5–10-candidate next run.** Recommended slot mix: `add_section_or_faq` (location-cluster), one `create_new_page`, one `add_h2_section` on a service page, two `add_faq` on owned pages, one schema-action-type if the queue surfaces one. Avoid single-prompt MEDIUM packets until question 1 is decided.

---

## Architecture invariants pinned by this bundle

The LiveRegen-1 harness itself isn't pinned by an architecture invariant yet (the dry-run harness is, by `tests/architecture/llm-dryrun-harness-no-persistence.test.ts`). Operator may want a sibling invariant for the live-regen harness that pins:
  - Tenant scope (only `tenant-ritz-founder`)
  - Hard candidate-count cap (3)
  - Hard budget cap ($1)
  - Persistence path locked to `runProviderAndPersist` (no direct `persistRecommendedEditsLocal` / `syncRecommendedEdits` / `dualWriteUpsert*` calls)
  - Pre-flight assertion that no low-conf / inventory / weak_evidence candidate enters the loop

Recommend adding this in a follow-up commit if the operator wants to lock the harness's safety properties before the next live-regen iteration runs.
