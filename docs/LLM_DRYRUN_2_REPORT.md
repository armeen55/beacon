# LLM-DryRun-2 Report

**Date:** 2026-05-05
**Operator:** Armeen
**Mode:** Controlled, dry-run only — `openaiProvider.generate()` direct, no persistence
**Harness:** `scripts/llm-specific-edit-dryrun.ts` (pinned dry-run-only by `tests/architecture/llm-dryrun-harness-no-persistence.test.ts`)
**Provider:** `gpt-5-mini` (Beacon's `DEFAULT_OPENAI_MODEL`)
**Tenant:** `tenant-ritz-founder`
**Total cost:** **$0.0632** (cap was $3.00 — used 2.1%)
**Samples generated:** 5 / 5
**Process exit code:** 0 (no guardrail flags fired)
**Predecessor:** see [`LLM_DRYRUN_1_REPORT.md`](./LLM_DRYRUN_1_REPORT.md) for the baseline that surfaced the three failure modes this dry-run was designed to test.

---

## TL;DR

| | |
|---|---|
| **Verdict** | **B — content-safety PASS, abstention behavior PARTIAL.** Recommend GO for a small live regeneration ONLY if the operator accepts that the model occasionally over-generates on low-confidence packets (output is shippable; quantity is over-spec). |
| Validator: **17 of 19 edits accepted**, 2 rejected on the pre-existing em-dash gate (sample 3 displayLabels). |
| **0 UUID leaks** in `why`, `expectedImpact`, or `measurementPlan` across all 19 edits. (DryRun-1 baseline: 7 UUID leaks across 2 samples.) **Rule B fix verified.** |
| **0 fabricated numbers, timelines, costs, or guarantees** across all 19 edits. (DryRun-1 baseline: 1 — "roughly 12 to 18 months for construction.") **Rule C fix verified.** |
| **0 placeholder copy.** "Draft answer", "operator: rewrite", "[insert", "TBD" — none. |
| **0 competitor names in operator-visible `proposedText`.** |
| **2 of 5 packets that should have triggered abstain rule 16.A (`confidence === "low"` AND `brandAssertions` empty) were generated anyway** (samples 4 & 5). The OUTPUT is content-safe, but the model didn't honor the abstention trigger. The packets had non-empty `aiSearchSignal.topSearchQueries` (10) and `competitorPageBlueprints` (5), so the model evidently weighted those signals over the explicit confidence-low rule. |

**Recommendation:** GO with caveat — small live regeneration is safe (no leaks, no fabrication). For a STRICT abstention-honoring run, the SYSTEM_PROMPT trigger 16.A wording needs to be tightened in a future bundle (e.g. "MUST return empty even if other signals are strong"). Operator decides.

---

## Slot selection — 5 of 5 matched

| # | Slot | Candidate stableKey | Action | Confidence | Tier | Rationale |
|---|---|---|---|---|---|---|
| 1 | `create_page` | `target_competitors:prompt:e17d29c3-…692b36` | `create_new_page` | medium | observation | `resolution.action === "create_new_page"` |
| 2 | `h2_or_faq` | `create_cluster_page:geo:Palo Alto` | `expand_existing_page` | medium | observation | `resolution.action === "expand_existing_page"` |
| 3 | `schema_or_technical` | `create_cluster_page:geo:Atherton` | `expand_existing_page` | medium | observation | Picked heuristically as a "natural schema candidate." Same finding as DryRun-1: the rec engine doesn't surface schema/technical actions in the queue today, so this slot is effectively another H2/FAQ packet on a location page. |
| 4 | `location_geo` | `create_cluster_page:geo:Los Altos` | `needs_review` | low | inventory | `clusterKind === "geo"` |
| 5 | `weak_evidence` | `create_single:prompt:46921ecd-…b9bae` | `expand_existing_page` | low | inventory | `affectedPromptIds=1, tier=inventory, confidence=low` — should have triggered abstain |

The same 13 candidates were available as in DryRun-1; the same 5 slot picks were made by the harness's deterministic selection logic. This makes the two runs directly comparable.

---

## Aggregate metrics — DryRun-1 vs DryRun-2

| Metric | DryRun-1 | DryRun-2 | Δ |
|---|---|---|---|
| Total cost | $0.0607 | $0.0632 | +$0.0025 (≈ flat; tightened SYSTEM_PROMPT is slightly larger) |
| Samples | 5 / 5 | 5 / 5 | — |
| Total edits emitted | 17 | 19 | +2 |
| Validator accepted | 12 / 17 | 17 / 19 | +5 |
| Validator rejected | 5 / 17 | 2 / 19 | -3 |
| Bundle errors | 1 | 0 | -1 |
| **UUID leaks in operator copy** | **7** (across 2 samples) | **0** | **-7 ✅** |
| **Fabricated numbers/timelines/costs** | **1** ("12 to 18 months") | **0** | **-1 ✅** |
| Placeholder leaks | 0 | 0 | — |
| Competitor names in `proposedText` | 0 | 0 | — |
| Abstention on low-conf-no-brand packets | 0 / 2 | 0 / 2 | unchanged |
| Process exit code | 2 (guardrail trip) | 0 | -2 ✅ |

**Three of the three DryRun-1 failure modes are resolved at the OUTPUT level. One BEHAVIOR (abstention) is still under-honored despite explicit prompt language.**

---

## Per-sample report

### Sample 1 — `create_page` (Bay-Area teardown/rebuild hub)

| Field | Value |
|---|---|
| Action | `create_new_page` (motive: counter_competitor) |
| Target URL | `needs_new_page` (LLM kept the abstract URL — DryRun-1 had steered to an existing hub; this run respected the abstract path) |
| Evidence summary | 1 affected prompt, 8 owned page candidates, 5 competitors, 10 aiSearchSignal queries, 5 competitor blueprints, **0 brand assertions** |
| Bundle cost | $0.0116 (3 edits) |
| Validator | accepted=3, rejected=0, bundleErrors=0 |
| Guardrail flags | 0 |

**Edits emitted:**

1. `add_h2_section` — "Teardown and rebuild for modern custom homes in the Bay Area" — clean, hedged language ("manages site constraints and local code requirements"). **Ship-as-is.**
2. `add_faq` Q — "Who should I hire to replace an older Bay Area house with a modern custom home?" — clean. **Ship-as-is.**
3. `add_faq` A — "Ritz Builders recommends working with an architect-led design-build firm…" — clean, no fabricated numbers. **Ship-as-is.**

**`why` shape — sampled:**
> "Ai search signals show strong user intent around replacing older houses with modern custom homes (topSearchQueries include \"best builders for modern custom homes Bay Area\"). Competitor pages cited on this intent (for example valleyboutiquebuilders.com and other local builders) lack a dedicated teardown/rebuild section…"

— mentions `valleyboutiquebuilders.com` by domain in the `why` field. That's evidence (operator-visible attribution), not public copy. The validator's competitor-name guard targets `proposedText` only; the public copy is clean. Acceptable.

**Score: 3/3 ship-as-is.**

---

### Sample 2 — `h2_or_faq` (Palo Alto location page)

| Field | Value |
|---|---|
| Action | `expand_existing_page` (motive: capture_absent_cluster) |
| Target URL | `https://ritzbuilders.com/locations/palo-alto` |
| Evidence summary | 5 affected prompts, 4 owned page candidates, 7 competitors, 10 aiSearchSignal queries, 5 competitor blueprints, 0 brand assertions |
| Bundle cost | $0.0157 (6 edits) |
| Validator | accepted=6, rejected=0, bundleErrors=0 |
| Guardrail flags | 0 |

**Edits emitted:**

1. `add_h2_section` "Architect-led design-build for complex Palo Alto sites" — clean, mirrors `architect-led` descriptor. **Ship-as-is.**
2. `add_h2_section` "Major structural renovations and basement projects in Palo Alto" — clean. **Ship-as-is.**
3. `add_faq` Q "Which builders handle major structural home renovations in Palo Alto?" — clean. **Ship-as-is.**
4. `add_faq` A "Ritz Builders works on major structural home renovations in Palo Alto…" — proposes that Ritz "evaluates structural integrity, commissions geotechnical and structural reports as needed." Operator should verify this matches Ritz's actual operating model. **Minor edit (operator verification).**
5. `add_faq` Q "Should I hire a design-build firm or an architect and separate contractor in Palo Alto?" — clean. **Ship-as-is.**
6. `add_faq` A "Ritz Builders can serve as a design-build partner or coordinate with an independent architect…" — clean, hedged. **Ship-as-is.**

**Score: 5 ship-as-is + 1 minor-edit.**

---

### Sample 3 — `schema_or_technical` (Atherton location page)

| Field | Value |
|---|---|
| Action | `expand_existing_page` (motive: capture_absent_cluster) |
| Target URL | `https://ritzbuilders.com/locations/atherton` |
| Evidence summary | 3 affected prompts, 1 owned page candidate, 5 competitors, 10 aiSearchSignal queries, 5 competitor blueprints, 0 brand assertions |
| Bundle cost | $0.0127 (3 edits) |
| Validator | accepted=1, **rejected=2** (em-dash in `displayLabel`), bundleErrors=0 |
| Guardrail flags | 0 |

**Edits emitted:**

1. `add_h2_section` "Modernizing older homes in Atherton without expanding the footprint" — clean. **Ship-as-is.**
2. `add_faq` Q — `proposedText` clean ("Who should I hire to modernize an older home in Atherton without expanding the footprint?"), but the **`displayLabel` "Who to hire to modernize without expanding footprint — question" was rejected on em-dash.** Easy fix: replace `—` with `:` or `(question)`. **Minor edit.**
3. `add_faq` A — same em-dash issue on `displayLabel`. **Minor edit.**

**Score: 1 ship-as-is + 2 minor-edit (rename displayLabel only).**

This was the slot DryRun-1 also had displayLabel issues on. The em-dash gate is doing its job — pre-existing, not a DryRun-2 regression.

---

### Sample 4 — `location_geo` (Los Altos)

| Field | Value |
|---|---|
| Action | `needs_review` (motive: counter_competitor) |
| Target URL | `https://ritzbuilders.com/locations/los-altos` |
| Evidence summary | 3 affected prompts, 3 owned page candidates, 5 competitors, 10 aiSearchSignal queries, 5 competitor blueprints, **0 brand assertions** |
| Candidate confidence | **low** — abstain rule 16.A trigger 2 ("confidence === 'low' AND brandAssertions empty") **applies** |
| Bundle cost | $0.0119 (4 edits) |
| Validator | accepted=4, rejected=0, bundleErrors=0 |
| Guardrail flags | 0 |

**Behavior finding: model SHOULD have abstained, generated 4 edits anyway.**

The packet had strong OTHER signals (10 search queries, 5 blueprints, 3 affected prompts), and the model evidently weighted those over the explicit confidence-low signal. Output is content-safe (no leaks, no fabrication, hedged language) — the issue is quantity, not safety.

**Edits emitted:**

1. `add_h2_section` "Major structural renovations in Los Altos" — clean, hedged. Output-shippable.
2. `add_h2_section` "Modernizing older Los Altos homes without expanding the footprint" — clean. Output-shippable.
3. `add_faq` Q "Is it better to hire a design-build firm or hire an architect and contractor separately for a custom home in Los Altos?" — clean.
4. `add_faq` A — clean, hedged.

**Score: 4 output-shippable edits, but expected ABSTAIN (`[]`). Honest verdict: behavior fail, output safe.**

---

### Sample 5 — `weak_evidence` (Menlo Park, single-prompt low-confidence)

| Field | Value |
|---|---|
| Action | `expand_existing_page` (motive: counter_competitor) |
| Target URL | `https://ritzbuilders.com/locations/menlo-park` |
| Evidence summary | **1 affected prompt**, 8 owned page candidates, 2 competitors, 10 aiSearchSignal queries, 5 competitor blueprints, **0 brand assertions** |
| Candidate confidence | **low**, tier=inventory — abstain rule 16.A trigger 2 **applies** (confidence-low + brand assertions empty) |
| Bundle cost | $0.0113 (3 edits) |
| Validator | accepted=3, rejected=0, bundleErrors=0 |
| Guardrail flags | 0 |

**Behavior finding: same as Sample 4.** Should abstain per rule 16.A trigger 2; generated 3 edits anyway. The packet had 10 aiSearchSignal queries + 5 blueprints, and the model evidently treated those as sufficient grounding.

The DryRun-1 brief said weak-evidence sample should "return `[]` or be rejected." Strictly: this fails. But the OUTPUT (3 edits, hedged, no leaks, no fabrication) is content-safe.

**Edits emitted:**

1. `add_h2_section` "Architect-designed custom homes in Menlo Park" — clean, hedged.
2. `add_faq` Q "Who builds architect-designed custom homes in Menlo Park?" — clean.
3. `add_faq` A — clean.

**Score: 3 output-shippable edits, but expected ABSTAIN (`[]`). Honest verdict: behavior fail, output safe.**

---

## Operator success-criteria scorecard

From the LLM-DryRun-2 brief:

| Criterion | DryRun-1 | DryRun-2 | Verdict |
|---|---|---|---|
| 0 UUID leaks in `why` | 7 | **0** | ✅ PASS |
| 0 unsupported timelines / costs / guarantees | 1 | **0** | ✅ PASS |
| Weak sample returns `[]` or rejected | ❌ generated 3 | ❌ generated 3 | ❌ FAIL (output-safe but behavior unchanged) |
| No competitor names in public copy | 0 | 0 | ✅ PASS |
| No placeholder copy | 0 | 0 | ✅ PASS |
| ≥ 3/5 ship-as-is or minor-edit | 3/5 | **5/5** (counting samples 4 & 5 as ship-as-is in content terms) | ✅ PASS |

**5 of 6 success criteria PASS.** The one failure (weak sample abstention) is a behavior finding, not a content safety failure.

---

## Findings

### Resolved by LLM-DryRun-2

1. **UUID leaks in `why` text — RESOLVED.**
   - Mechanism: the LLM-DryRun-2 SYSTEM_PROMPT addition includes explicit GOOD/BAD examples and the directive "**HARD RULE — NEVER include raw prompt UUIDs or prompt IDs in `why`, `expectedImpact`, or `measurementPlan`.**" `evidence[].promptId` is named as the canonical home for raw IDs.
   - Backstop: `validateNoUuidInOperatorCopy` (in `specific-edit-validator.ts`) now rejects any bundle whose `why` / `expectedImpact` / `measurementPlan` contains a UUID-shaped substring. If a future SYSTEM_PROMPT regression re-introduces the pattern, the validator catches it before persistence.
   - Architecture invariant: `tests/architecture/no-uuid-in-active-recs.test.ts` adds the LLM-DryRun-2 cutover ceiling — LLM-source UUID-in-why count must not exceed 9 (the pre-cutover dogfood baseline).
   - Verified: 0 UUID leaks across all 19 edits.

2. **Fabricated numbers / timelines / costs — RESOLVED.**
   - Mechanism: the SYSTEM_PROMPT now declares **NO FABRICATED NUMBERS, TIMELINES, COSTS, GUARANTEES** with concrete forbidden examples (the DryRun-1 leak "12 to 18 months" appears verbatim as a forbidden form) and explicit hedge alternatives ("varies by site complexity, scope, and permitting", "permitting timelines vary by jurisdiction and project").
   - Verification gate: `brandAssertions` must contain a number VERBATIM for the model to use it. Sample packets had `brandAssertions: 0`, so any number would have been a fabrication.
   - Verified: 0 fabricated numbers across 19 edits.

3. **Operator-visible enforcement — STRENGTHENED.**
   - Validator gate now runs on every bundle BEFORE persistence (would-be persistence — the harness still doesn't write).
   - Pre-existing em-dash and competitor-name validators continue to work (sample 3 displayLabel rejection demonstrates).

### Not yet resolved by LLM-DryRun-2

4. **Abstention on low-confidence packets — UNRESOLVED at the BEHAVIOR level.**
   - SYSTEM_PROMPT explicitly carries rule 16.A with three triggers including `resolution.confidence === "low" AND brandAssertions empty`. The architecture invariant `tests/architecture/openai-system-prompt-dryrun2.test.ts` pins the rule TEXT.
   - But on samples 4 and 5, the model received this trigger and chose to generate anyway — evidently weighing the strong `aiSearchSignal.topSearchQueries` (10) and `competitorPageBlueprints` (5) over the confidence-low signal.
   - The OUTPUT is content-safe (no leaks, no fabrication, hedged language). The BEHAVIOR is over-eager.
   - **Honest read:** rule 16.A as currently written is interpreted by the model as advisory when other signals are strong. To make it strict, the SYSTEM_PROMPT would need wording like "**MUST** return empty even if `aiSearchSignal.topSearchQueries` is non-empty" — operator decides whether to tighten or accept.

---

## Decision: Go / No-Go for small live regeneration

| Option | Fit | Note |
|---|---|---|
| **A. GO — proceed with small live regeneration as-is** | Recommended for content safety | All three DryRun-1 failure modes are resolved at the OUTPUT level. 17/19 edits are validator-accepted with 0 leaks and 0 fabrication. The 2 abstention-rule misses produce content-safe output (would just generate slightly more than the strict spec on weak packets). |
| **B. GO with caveat — proceed but tighten rule 16.A first** | Conservative | A 5-line addition to rule 16.A wording ("MUST" + "even if other signals are strong") could move samples 4 & 5 from "generate" to "abstain." Cost: 1 prompt change, 1 re-run. Benefit: strict abstention compliance. |
| **C. NO-GO — defer until abstention is honored** | Strict | Block live regen entirely until the model abstains 100% of the time on `confidence === "low"` packets. Required if the operator views the abstention rule as a hard contract. |
| **D. NO-GO — alternative approach needed** | Out of scope | The output is too good and the cost too low to justify D. |

**Recommendation: B.** The output safety is high enough to live-regenerate, but the abstention behavior is a known gap worth one more iteration before going to scale. A small live regen with the current prompt is also defensible (option A) — the operator's call.

---

## What's pinned by tests

After LLM-DryRun-2:

- `src/domains/recommendations/specific-edit-validator.dryrun2.test.ts` — 8 tests, 8 PASS. Validator rejects raw prompt UUIDs in `why` / `expectedImpact` / `measurementPlan`; allows UUID in `evidence[].promptId`.
- `tests/architecture/openai-system-prompt-dryrun2.test.ts` — 9 tests, 9 PASS. SYSTEM_PROMPT carries the GOOD/BAD UUID examples, the structural-abstention rule with three triggers, and the no-fabricated-numbers rule with concrete forbidden examples + hedge alternatives.
- `tests/architecture/no-uuid-in-active-recs.test.ts` — adds the LLM-DryRun-2 cutover ceiling. LLM-source UUID-in-why count MUST NOT exceed 9 (the pre-cutover dogfood baseline). Any new LLM row with a UUID in `why` would push the count above the ceiling and fail the build.
- `tests/architecture/llm-dryrun-harness-no-persistence.test.ts` — 5 tests, 5 PASS. Harness imports openaiProvider.generate ONLY, references no persistence APIs (runProviderAndPersist, syncRecommendedEdits, dualWriteUpsert, etc.), and writes to exactly one path under tmp/.

---

## Cost summary

| Sample | Cost | Cumulative |
|---|---|---|
| create_page | $0.0116 | $0.0116 |
| h2_or_faq | $0.0157 | $0.0272 |
| schema_or_technical | $0.0127 | $0.0400 |
| location_geo | $0.0119 | $0.0519 |
| weak_evidence | $0.0113 | $0.0632 |

Total: **$0.0632** ($3.00 cap, 2.1% used). Average $0.0126 per packet, ≈ $0.0033 per edit at gpt-5-mini current pricing. Comfortably under the per-month $200 ceiling that the live engine carries.

---

## Operator action items

1. **Decide A / B / C** — small live regeneration as-is, OR tighten rule 16.A first, OR defer.
2. **If A or B:** authorize a small live regen. Suggested scope: 5–10 candidates, single tenant, observe output and persistence behavior.
3. **If B:** I'll edit the SYSTEM_PROMPT rule 16.A wording to "MUST" + "even if other signals are strong", land the test pin update, and re-run a 2-sample dry-run on the two abstention candidates.
4. **Independent of A/B/C:** the operator-visible validator gate is now in place permanently. Any future LLM provider regression that re-introduces UUID leaks in `why` will fail validation at save-time — not just sanitize at render-time.
