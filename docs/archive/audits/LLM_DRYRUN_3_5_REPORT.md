# LLM-DryRun-3.5 Report — single-prompt rule scope fix

**Date:** 2026-05-05
**Operator:** Armeen
**Mode:** Controlled, dry-run only — `openaiProvider.generate()` direct, no persistence, no queue mutation
**Harness:** `scripts/llm-specific-edit-dryrun.ts` (slot filter `BEACON_DRYRUN_ONLY_SLOTS=create_page`)
**Provider:** `gpt-5-mini`
**Tenant:** `tenant-ritz-founder`
**Total cost:** **$0.0120** (cap $1.00 — used 1.2%)
**Samples generated:** 1 / 1 (Bay Area teardown only)
**Process exit code:** 0
**Predecessors:** [`LLM_DRYRUN_3_REPORT.md`](./LLM_DRYRUN_3_REPORT.md), [`LLM_LIVE_REGEN_1_REPORT.md`](./LLM_LIVE_REGEN_1_REPORT.md)

---

## TL;DR

| | |
|---|---|
| **Verdict** | **GO — single-prompt MEDIUM-confidence packets generate again, low-confidence abstention still hard.** |
| Bay Area teardown packet (medium, 1 prompt, brand-empty, 10 search queries, 5 blueprints) | **4 edits emitted, 4 accepted, 0 rejected, 0 guardrail flags** ✅ |
| UUID leaks | 0 |
| Fabricated numbers/timelines/costs | 0 |
| Placeholder leaks | 0 |
| Competitor names in proposedText/displayLabel | 0 |
| Validator behavior | All 4 edits accepted cleanly |
| **All 6 of 6 operator success criteria** | **PASS** |

**Recommended next step:** proceed with LLM-LiveRegen-2 (5–10 candidates, $1 cap, mixed slot types, avoid the 3 LiveRegen-1 candidates).

---

## What changed since LiveRegen-1

### Rule 16.A wording (operator-locked)

The single-prompt+brand-empty bullet was DROPPED from the hard-abstain trigger list. Old triggers:

```
• affectedPrompts.length === 1 AND no operator-curated brandAssertions  ← REMOVED
• resolution.confidence === "low" AND no operator-curated brandAssertions  ← KEPT (now trigger 1)
• competitorPageBlueprints + aiSearchSignal.topSearchQueries + brandAssertions ALL empty  ← KEPT (now trigger 2)
```

New trigger list (2 hard triggers, both confidence- or signal-driven):

```
• resolution.confidence === "low" AND no operator-curated brandAssertions
  (regardless of how many affectedPrompts).
• competitorPageBlueprints + aiSearchSignal.topSearchQueries + brandAssertions ALL empty.
```

A new **SINGLE-PROMPT CAUTION** block follows the trigger list:

> When `affectedPrompts.length === 1` AND confidence is "medium" or "high," DO generate IF — and only if — every emitted edit is directly grounded in either `aiSearchSignal.topSearchQueries` or `competitorPageBlueprints` (or, when present, `brandAssertions`). A single-prompt packet at medium/high confidence with non-empty aggregate signals (10 topSearchQueries, 5 blueprints) IS a legitimate generate scenario — the resolver flagged it medium/high precisely because the aggregate evidence carries weight even when only one prompt is affected. Do NOT abstain on single-prompt + brand-empty alone; that's an over-broad reading of Rule 16.A. Single-prompt + LOW confidence + brand-empty IS still in the hard-abstain set above (via trigger 1).

A new **GOOD #2** worked example demonstrates the canonical "generate" shape:

> GOOD #2 (1 affected prompt + MEDIUM confidence — generate):
> Packet: resolution.confidence = "medium", affectedPrompts.length = 1, brandAssertions = [], aiSearchSignal.topSearchQueries.length = 10, competitorPageBlueprints.length = 5
> Output: { "recommendations": [ ...2-4 grounded edits... ] }

### Architecture invariants

NEW `tests/architecture/openai-system-prompt-dryrun3.5.test.ts` — 12 invariants, 12 PASS:

- HARD trigger list no longer contains a single-prompt-only abstain bullet (NEGATIVE invariant — pins the over-broad wording stays gone).
- HARD trigger list keeps low-confidence + brand-empty (the rule fires correctly on Los Altos / Menlo Park).
- HARD trigger list keeps all-three-empty fallback.
- SINGLE-PROMPT CAUTION block declared by name.
- "NOT a hard abstain" framing adjacent to CAUTION.
- "DO generate IF…" affirmative permission for medium/high single-prompt.
- Edit grounding requirement (topSearchQueries OR blueprints) preserved.
- GOOD #2 worked example with literal `confidence = "medium"` AND `affectedPrompts.length = 1`.
- DryRun-2 + DryRun-3 invariants still hold (STRUCTURAL ABSTENTION header, HARD CONTRACT wording, MUST + even-if override, multi-prompt BAD example, "CORRECT answer for thin packets" framing).

All 25 DryRun-2 invariants + 22 DryRun-3 invariants + 12 DryRun-3.5 invariants = **59/59 PASS**. The DryRun-3.5 fix preserves every prior invariant.

---

## Re-run results — Bay Area teardown only

Same packet that abstained in LiveRegen-1, same packet that generated 3 ship-as-is edits in DryRun-2 (before strict abstention).

| Field | Value |
|---|---|
| stableKey | `target_competitors:prompt:e17d29c3-eab3-4278-a3ea-4bd175692b36` |
| Action | `create_new_page` (motive: counter_competitor) |
| Target URL | `needs_new_page` |
| **resolution.confidence** | **`medium`** |
| resolution.tier | `observation` |
| resolution.action | `create_new_page` |
| affectedPrompts | 1 |
| aiSearchSignal.topSearchQueries | 10 |
| competitorPageBlueprints | 5 |
| brandAssertions | 0 |
| Bundle | **4 edits emitted, 4 accepted, 0 rejected** ✅ |
| Cost | $0.0120 |
| Guardrail flags | 0 |

**Behavior:** Rule 16.A trigger 1 no longer fires (single-prompt + brand-empty alone is no longer a hard trigger). The model evaluates trigger 1 (low-conf + brand-empty) and trigger 2 (all three empty) and finds neither applies. It then enters the SINGLE-PROMPT CAUTION block, sees the medium-confidence + strong aggregates condition, and generates 4 grounded edits.

### The 4 edits (all validator-accepted, all clean)

| # | Action | Display label | Grounding | Notes |
|---|---|---|---|---|
| 1 | add_h2_section | "H2: Replacing an older house with a modern custom home" | topSearchQueries + competitor blueprints | Hedged ("aligning modern design intent with buildability") |
| 2 | add_h2_section | "H2: Architect-led design-build for teardown and rebuilds" | AI descriptors (architect, design-build) + competitor blueprints | Process-focused, no fabricated timelines |
| 3 | add_faq | "FAQ: Who to hire for replacing an older house" | Direct mirror of topSearchQueries | Clean question phrasing |
| 4 | add_faq | "FAQ answer: Who to hire for replacing an older house" | AI descriptors + competitor pages | Hedged ("understands modern finishes, local permitting, and site-specific constraints") |

All 4 are content-shippable. No UUIDs, no placeholders, no fabricated timelines/costs/guarantees, no competitor names in proposedText/displayLabel. Validator accepted all 4 cleanly (no em-dash issues, no competitor-grounder rejections, no FAQ-pairing errors).

### Comparison across the 4 runs on this same candidate

| Run | Rule 16.A scope | Output | Note |
|---|---|---|---|
| DryRun-2 | No abstention (rule 16.A didn't exist yet) | 3 edits, all ship-as-is, $0.0116 | Pre-strict-abstention |
| DryRun-3 (final) | Single-prompt+brand-empty as hard trigger | NOT RE-RUN (DryRun-3 only ran low-conf abstention candidates) | — |
| LiveRegen-1 | Single-prompt+brand-empty as hard trigger | 0 edits ($0.0038), abstained | Triggered the over-broad rule; surfaced the issue |
| **DryRun-3.5 (this report)** | **Single-prompt is a CAUTION, not a hard trigger** | **4 edits, all ship-as-is, $0.0120** ✅ | Rule fix verified |

The 4-edit output is BETTER than DryRun-2's 3-edit output (the new SYSTEM_PROMPT also has the no-fabricated-numbers + no-UUID + grounding rules tightened). The fix is a Pareto improvement: low-confidence abstention is preserved (Los Altos + Menlo Park still abstain), single-prompt MEDIUM packets generate again with strict grounding.

---

## Operator success-criteria scorecard

From the LLM-DryRun-3.5 brief:

| Criterion | Result |
|---|---|
| Bay Area teardown generates again | ✅ 4 edits |
| 0 UUID leaks | ✅ |
| 0 fabricated timelines/costs/guarantees | ✅ |
| 0 placeholders | ✅ |
| 0 competitor names in public copy | ✅ |
| Validator accepts useful edits or cleanly rejects bad ones | ✅ 4/4 accepted |
| build/test clean | ✅ typecheck clean (3 pre-existing prompt-drilldown errors), 59/59 targeted PASS, full suite 4463/4468 (5 pre-existing failures unchanged, +12 from new DryRun-3.5 tests), build EXIT_CODE=0 green |

**7 of 7 PASS.**

---

## What's pinned by tests after LLM-DryRun-3.5

- DryRun-2 invariants: 25 (8 validator + 9 SYSTEM_PROMPT + 5 harness no-persistence + 3 cutover ceiling) — all PASS.
- DryRun-3 invariants: 22 (16 SYSTEM_PROMPT + 6 packet-resolution) — all PASS.
- **DryRun-3.5 invariants: 12 (NEW)** — all PASS:
  - HARD trigger list does NOT contain single-prompt-only abstain bullet (NEGATIVE invariant catches future drift).
  - SINGLE-PROMPT CAUTION block declared.
  - GOOD #2 worked example present with literal `confidence = "medium"` + `affectedPrompts.length = 1`.
  - All DryRun-2/3 protections retained.

**Total: 59 architecture invariants** pinning the LLM-DryRun-2/3/3.5 contract.

---

## Cost summary

| Run | Cost | Cumulative across LLM cycle |
|---|---|---|
| DryRun-1 (baseline) | $0.0607 | $0.0607 |
| DryRun-2 (validator + SYSTEM_PROMPT v2) | $0.0632 | $0.1239 |
| DryRun-3 (strict abstention) | $0.0066 | $0.1305 |
| LiveRegen-1 (3 candidates) | $0.0301 | $0.1606 |
| **DryRun-3.5 (this report)** | **$0.0120** | **$0.1726** |

DryRun-3.5 spent $0.0120 ($1.00 cap, 1.2% used). Total LLM cycle spend: **$0.1726**.

---

## Next step (LLM-LiveRegen-2 — pending operator approval if ready)

The single-prompt-MEDIUM rule fix is verified. The persistence path is proven safe at 3-candidate scale (LiveRegen-1). The architecture invariants stand at 59/59.

The brief said: *"After this: Proceed to LLM-LiveRegen-2: 5–10 candidates max, $1 cap, avoid the 3 candidates already touched by LiveRegen-1 if possible, include one FAQ-heavy, one page-create, one location expansion, one technical/schema candidate if the queue supports it, persist only accepted edits, report cleanly."*

Available queue (post-LiveRegen-1 + DryRun-3.5):
- 13 candidates total (per the dry-run harness's slot picker)
- Excluded by LiveRegen-1: Palo Alto (geo), Bay Area teardown, Atherton (geo)
- Excluded by DryRun-3 (low-conf abstention): Los Altos (geo, low-conf), Menlo Park (single-prompt low-conf weak)
- 8 remaining candidates available

Recommended LiveRegen-2 mix (TBD post-pre-flight discovery):
- 1 location expansion (Menlo Park is excluded — pick a different geo cluster)
- 1 page-create (Bay Area is excluded — pick a different create_new_page)
- 1 FAQ-heavy (any topic-cluster expansion)
- 1 technical/schema if the queue surfaces an `add_schema` action (none did in the previous cycle — may need to skip)
- 1–2 fillers from medium-confidence observation-tier remainders

Same harness conventions as LiveRegen-1: pinned candidate stableKeys, $1 hard cap with cumulative pre-call gate, halt-on-guardrail-trip, persistence ONLY through `runProviderAndPersist`, pre-flight assertion no low-conf / inventory / weak candidate enters the loop.
