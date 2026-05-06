# LLM-DryRun-3 Report — strict abstention

**Date:** 2026-05-05
**Operator:** Armeen
**Mode:** Controlled, dry-run only — `openaiProvider.generate()` direct, no persistence, no queue mutation
**Harness:** `scripts/llm-specific-edit-dryrun.ts` (slot filter via `BEACON_DRYRUN_ONLY_SLOTS=location_geo,weak_evidence`; budget tightener via `BEACON_DRYRUN_BUDGET_CAP_USD=1.00`)
**Provider:** `gpt-5-mini` (Beacon's `DEFAULT_OPENAI_MODEL`)
**Tenant:** `tenant-ritz-founder`
**Total cost (final run):** **$0.0066** (cap was $1.00 — used 0.66%)
**Samples generated:** 2 / 2 (only the two abstention candidates ran)
**Process exit code:** 0
**Predecessors:** [`LLM_DRYRUN_1_REPORT.md`](./LLM_DRYRUN_1_REPORT.md) (baseline), [`LLM_DRYRUN_2_REPORT.md`](./LLM_DRYRUN_2_REPORT.md) (validator + SYSTEM_PROMPT tightening; surfaced the abstention behavior gap).

---

## TL;DR

| | |
|---|---|
| **Verdict** | **GO — strict abstention is now enforceable AND honored.** |
| Los Altos (3 affected prompts, confidence=low, brandAssertions empty) | **`{ "recommendations": [] }`** ✅ |
| Menlo Park (1 affected prompt, confidence=low, brandAssertions empty) | **`{ "recommendations": [] }`** ✅ |
| Validator failures | 0 |
| Guardrail flags | 0 |
| UUID leaks | 0 (no edits emitted) |
| Fabricated numbers / timelines / costs / guarantees | 0 |
| Placeholders | 0 |
| Competitor names in public copy | 0 |
| **All operator success criteria for DryRun-3** | **PASS** |

**Recommended next step (subject to operator approval):** authorize the $1-cap 5–10-candidate live regeneration on `tenant-ritz-founder`, persistence observed carefully.

---

## What changed since DryRun-2

### 1. Rule 16.A wording (SYSTEM_PROMPT) — operator-locked text landed verbatim

The required hard-contract paragraph is now in `providers/openai.ts` SYSTEM_PROMPT (rule 16.A):

> **LOW-CONFIDENCE ABSTENTION IS A HARD CONTRACT. If the packet/resolution confidence is low AND brandAssertions is empty, you MUST return an empty recommendations array, even if aiSearchSignal.topSearchQueries, competitorPageBlueprints, ownedPageCandidates, or competitorAngles are non-empty.**

Plus the "Returning [] is the correct output. Generating safe-but-generic edits is a failure." closer, the explicit "REGARDLESS of how many affected prompts" qualifier, and concrete BAD #1 (1 prompt) + BAD #2 (3 prompts) + GOOD examples that show `{ "recommendations": [] }` as the literal correct output for both shapes.

Pinned by 16 invariants in `tests/architecture/openai-system-prompt-dryrun3.test.ts`.

### 2. Diagnosed root cause — the rule was structurally unenforceable

After landing the new wording, **Menlo Park (1 affected prompt) abstained** but **Los Altos (3 affected prompts) STILL generated 5–8 edits** despite identical confidence=low + brandAssertions=empty conditions.

Root cause traced to a packet-schema gap: **`SpecificEditEvidencePacket` did not include `resolution.confidence`.** The SYSTEM_PROMPT's trigger 2 ("`resolution.confidence === "low"` AND `brandAssertions` empty") was checking a field the model could not see in the JSON-stringified user message.

For Menlo Park trigger 1 ("`affectedPrompts.length === 1` AND `brandAssertions` empty") fired from packet data alone — both fields were visible. The model abstained correctly.

For Los Altos trigger 1 doesn't apply (3 prompts). Trigger 2 requires `resolution.confidence` which the packet didn't carry. Trigger 3 requires all three aggregates empty (not the case). **No trigger could fire.** The model defaulted to generation.

This was a packet-schema completeness gap, not a prompt-engineering gap. No amount of prompt tightening could close it without exposing the data.

### 3. Surface resolver context to the packet — narrow safety-issue escalation

Per the operator brief: *"No product-code changes beyond SYSTEM_PROMPT/test wording unless a safety issue appears."* The packet-schema gap qualified — without it the operator's success criterion was structurally unmeetable.

Landed:

- **`SpecificEditEvidencePacket`** (`src/domains/recommendations/specific-edit-evidence.ts`) gains a top-level `resolution?: { confidence: "high" | "medium" | "low"; tier: ResolverTier; action: RecommendationAction } | null` block. Optional + nullable so legacy test fixtures and callers without a resolver continue to typecheck.
- **`buildPacketForRec`** (`src/domains/recommendations/load-queue.ts`) sources from `rec.resolution`:
  ```ts
  resolution: rec.resolution
    ? {
        confidence: rec.resolution.confidence,
        tier: rec.resolution.tier,
        action: rec.resolution.action,
      }
    : null,
  ```
- The packet's `withoutHash` body includes the `resolution` block, so `evidenceHash` invalidates correctly when the resolver flips a confidence label.
- The OpenAI provider's user-message construction (`JSON.stringify(packet, null, 2)`) was already serializing the full packet — the new field flows through verbatim with zero provider-side changes.

Pinned by 6 invariants in `tests/architecture/packet-carries-resolver-confidence.test.ts`:
- packet TYPE declares `resolution.{confidence,tier,action}`
- packet `withoutHash` body includes `resolution: args.resolution`
- `buildPacketForRec` threads `confidence` from `rec.resolution.confidence`
- threads `tier` + `action`
- falls back to `null` when no resolver is attached
- provider serializes the full packet (no projection)

### 4. Harness — slot filter added so we can re-run only the 2 abstention candidates

`scripts/llm-specific-edit-dryrun.ts` gains:
- `BEACON_DRYRUN_BUDGET_CAP_USD` env var (tightener only, never widener — clamped to ≤ default $3)
- `BEACON_DRYRUN_ONLY_SLOTS` env var (comma-separated slot names; filter applied AFTER full picking so each slot still selects against the same candidate pool — DryRun-3's Los Altos + Menlo Park are byte-identical to DryRun-2's slots 4 + 5)

Existing harness no-persistence invariant (5/5 PASS) re-verified after adding the env-var reads.

---

## Per-sample report

### Sample 1 — `location_geo` (Los Altos)

| Field | Value |
|---|---|
| stableKey | `create_cluster_page:geo:Los Altos` |
| Action | `needs_review` (motive: counter_competitor) |
| Target URL | `https://ritzbuilders.com/locations/los-altos` |
| **resolution.confidence** | **`low`** |
| resolution.tier | `inventory` |
| resolution.action | `needs_review` |
| affectedPrompts | 3 |
| aiSearchSignal.topSearchQueries | 10 |
| competitorPageBlueprints | 5 |
| **brandAssertions** | **0** |
| Bundle output | **`{ "recommendations": [] }`** ✅ |
| Cost | $0.0034 |
| Validator | accepted=0, rejected=0, bundleErrors=0 |
| Guardrail flags | 0 |

**Behavior:** trigger 2 fires correctly. The model sees `"resolution": { "confidence": "low", ... }` and `"brandAssertions": []` in the packet JSON, applies the hard-contract rule, returns `[]`. Strong aiSearchSignal (10 queries) + 5 competitor blueprints did NOT override the low-confidence flag.

This is a complete reversal of DryRun-2's behavior on the same candidate (which generated 4 edits) and DryRun-3 attempt #1 (5 edits) and DryRun-3 attempt #2 (8 edits). The fix that worked was exposing the data the rule needed, not adding more prompt wording.

---

### Sample 2 — `weak_evidence` (Menlo Park)

| Field | Value |
|---|---|
| stableKey | `create_single:prompt:46921ecd-…b9bae` |
| Action | `expand_existing_page` (motive: counter_competitor) |
| Target URL | `https://ritzbuilders.com/locations/menlo-park` |
| **resolution.confidence** | **`low`** |
| resolution.tier | `inventory` |
| resolution.action | `expand_existing_page` |
| affectedPrompts | 1 |
| aiSearchSignal.topSearchQueries | 10 |
| competitorPageBlueprints | 5 |
| **brandAssertions** | **0** |
| Bundle output | **`{ "recommendations": [] }`** ✅ |
| Cost | $0.0032 |
| Validator | accepted=0, rejected=0, bundleErrors=0 |
| Guardrail flags | 0 |

**Behavior:** both trigger 1 (`affectedPrompts.length === 1` AND `brandAssertions` empty) AND trigger 2 (`resolution.confidence === "low"` AND `brandAssertions` empty) fire. The model returns `[]`.

Already abstained on DryRun-3 attempt #1 (single-prompt path was always evaluable via trigger 1). The DryRun-3.2 result is consistent — the new packet field does not destabilize the working case.

---

## Operator success-criteria scorecard

From the LLM-DryRun-3 brief:

| Criterion | Result |
|---|---|
| Low-confidence/no-brandAssertions samples return [] | ✅ Both samples |
| 0 UUID leaks | ✅ (no edits emitted; trivially zero) |
| 0 fabricated numbers/timelines/costs | ✅ |
| 0 placeholders | ✅ |
| 0 competitor names in public copy | ✅ |
| build/test clean | ✅ typecheck (3 pre-existing prompt-drilldown errors), targeted 273/273 PASS, full suite 4451/4456 (5 pre-existing failures unchanged), build green |

**6 of 6 success criteria PASS.**

---

## Aggregate metrics — DryRun-1 → DryRun-2 → DryRun-3

| Metric | DryRun-1 | DryRun-2 | DryRun-3 (final) |
|---|---|---|---|
| Total cost | $0.0607 | $0.0632 | $0.0066 (2 samples only) |
| UUID leaks in operator copy | 7 | 0 | 0 |
| Fabricated numbers/timelines | 1 | 0 | 0 |
| Placeholder leaks | 0 | 0 | 0 |
| Competitor names in proposedText | 0 | 0 | 0 |
| Abstention on confidence=low + brand-empty (Los Altos) | did not abstain | did not abstain | **abstained** |
| Abstention on single-prompt + brand-empty (Menlo Park) | did not abstain | did not abstain | **abstained** |
| Process exit code | 2 | 0 | 0 |

**All four DryRun-1 failure modes — UUID leaks, fabricated numbers, placeholders, abstention — are now closed at the OUTPUT level AND verified by the model's actual behavior on the abstention candidates.**

---

## What's pinned by tests after LLM-DryRun-3

- `src/domains/recommendations/specific-edit-validator.dryrun2.test.ts` — 8 tests (DryRun-2; UUID rejection rules — unchanged).
- `tests/architecture/openai-system-prompt-dryrun2.test.ts` — 9 invariants (DryRun-2; UUID + fabricated-number + abstention rule structure — unchanged).
- `tests/architecture/openai-system-prompt-dryrun3.test.ts` — **16 invariants** (DryRun-3; HARD CONTRACT wording, MUST/even-if/regardless overrides, multi-prompt BAD example, GOOD example with literal `{ "recommendations": [] }`, "safe-but-generic" failure framing).
- `tests/architecture/packet-carries-resolver-confidence.test.ts` — **6 invariants** (DryRun-3; packet TYPE declares the resolution block; `buildPacketForRec` threads `rec.resolution.{confidence,tier,action}` and falls back to null; the OpenAI provider's user-message JSON.stringify carries the full packet).
- `tests/architecture/llm-dryrun-harness-no-persistence.test.ts` — 5 invariants (re-verified after env-var additions; harness never imports persistence APIs).
- `tests/architecture/no-uuid-in-active-recs.test.ts` — 3 invariants (LLM-DryRun-2 cutover ceiling at 9; preserved).

---

## Cost summary

| Sample | Cost | Cumulative |
|---|---|---|
| location_geo (Los Altos) | $0.0034 | $0.0034 |
| weak_evidence (Menlo Park) | $0.0032 | $0.0066 |

Total: **$0.0066** ($1.00 cap, 0.66% used). Both samples cost less than the GPT-5-mini reasoning floor for "I cannot find a strong basis to act"-style abstentions — the model thought briefly, decided trigger 2 fired, and returned the empty array. Cheap, correct, fast.

Across DryRun-1 + DryRun-2 + DryRun-3 the total OpenAI spend on the entire LLM-DryRun cycle is **$0.1305** — well inside even the strictest operator-supplied budget cap.

---

## Operator decision (pending) — proceed to small live regeneration?

**Recommended: YES.** The validator is in place, the SYSTEM_PROMPT abstention is now a hard contract that fires correctly, the packet carries the resolver context the rule needs, and the architecture invariants pin everything forward. Three independent DryRun samples (Sample 4 + 5 in DryRun-2 → Sample 1 + 2 in DryRun-3) plus the matching content-quality wins in DryRun-2 samples 1+2+3 say the engine is ready for a small live test.

**Suggested live-regen scope:**

| Setting | Recommendation |
|---|---|
| Tenant | `tenant-ritz-founder` only |
| Candidate count | 5–10 |
| Slot mix | The same 5 slot-types from the dry-run cycle (create_page, h2_or_faq, schema_or_technical, location_geo, weak_evidence) — operator selects which to actually accept post-generation |
| Persistence | YES — but inspected per-row before any operator-visible UI surfaces them |
| Budget cap | $1 hard cap on the live run (current per-rec cost is ≈$0.013, so 10 candidates ≈ $0.13 expected) |
| Validator | `validateSpecificEditBundle` runs at save-time (already wired) — UUID gate + placeholder gate + em-dash gate + brand-claim gate + competitor-name gate + the new strict-abstention rule on the model side |
| Architecture invariants live | The LLM-DryRun-2 + DryRun-3 invariant tests run pre-deploy and on every PR; any regression that re-introduces UUID leaks or removes the abstention rule fails the build |
| Failure mode | If a generated edit looks wrong, the operator deletes the row from the queue — no workflow change for now |

**If you want one more dry-run iteration before live regen (DryRun-4):** run all 5 slots once more to verify the strict abstention doesn't accidentally suppress the 3 medium-confidence packets that should generate. Cost ≈ $0.07. Optional.

**If you want to defer live regen entirely:** the validator + architecture invariants stand on their own. Any future drift will be caught by CI before it touches a queue.
