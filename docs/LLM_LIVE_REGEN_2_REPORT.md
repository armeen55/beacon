# LLM-LiveRegen-2 Report — second persistence round-trip

**Date:** 2026-05-05
**Operator:** Armeen
**Mode:** **LIVE — second paid persistence round-trip after LLM-DryRun-3.5 verified the Rule 16.A scope fix.**
**Harness:** `scripts/llm-live-regen-2.ts` (sibling of `scripts/llm-live-regen-1.ts`; uses `runProviderAndPersist` for the persistence path)
**Provider:** `gpt-5-mini`
**Tenant:** `tenant-ritz-founder`
**Total cost:** **$0.0357** (cap $1.00 — used 3.57%)
**Rows actually persisted:** **4** (only candidate 3 had a clean bundle; candidates 1 & 2 had `bundleErrors` and were correctly NOT persisted)
**Process exit code:** 0
**Predecessors:** [`LLM_LIVE_REGEN_1_REPORT.md`](./LLM_LIVE_REGEN_1_REPORT.md), [`LLM_DRYRUN_3_5_REPORT.md`](./LLM_DRYRUN_3_5_REPORT.md)

---

## TL;DR

| | |
|---|---|
| **Verdict** | **GO with two findings.** Persistence path verified safe at the engine level; bundleError gate works correctly. Two findings need operator awareness. |
| **Finding 1 (engine — working as designed)** | Two of three bundles tripped `bundleErrors` (FAQ pairing + competitor-grounder). Engine correctly aborted persistence on those bundles — 0 rows leaked from Cupertino or strengthen_page. The "Persisted row count: N" line in harness output is misleading (it shows `acceptedRows.length` even when persistence aborted because of bundleError); only `persisted: true` rows actually wrote. |
| **Finding 2 (test isolation — pre-existing bug, NOT a LR-2 regression)** | Running `npm run test` between LiveRegen-1 and LiveRegen-2 clobbered `.data/global/llm-budget.json` to `[]`. Root cause: `tests/domains/recommendations/adjudicate.test.ts:cleanupTestStores` calls `writeStore("llm-budget", [])` on the REAL .data/ directory (no hermetic chdir). The LR-2 ledger therefore records only LR-2's spend ($0.0357 / 3 calls), not the cumulative LR-1+LR-2 ($0.066 / 6 calls). **This is a real persistent-budget tracking gap.** Recommended follow-up: hermetic-isolate that test (separate bundle, not a LR-2 fix-forward). |
| Validator | 7 of 12 emitted edits accepted; 5 rejected on a mix of FAQ-pairing + competitor-grounder gates. Engine then rejected 2 of 3 bundles for `bundleErrors` and correctly persisted only the clean 3rd bundle's 4 rows. |
| UUID leaks in operator-visible copy of new rows | **0** |
| Placeholder leaks | **0** |
| Fabricated numbers / timelines / costs / guarantees | **0** |
| Competitor names in `proposed_text` or `display_label` | **0** |
| Duplicate rows | **0** |
| Dual-write to Supabase | ✅ 4 rows landed; 0 Cupertino LR-2 rows (the 3 Cupertino rows in Supabase are pre-existing 2026-05-04 dogfood); 0 strengthen_page rows ever written |
| /recommendations smoke + architecture invariants | ✅ 69/69 PASS (47 prior + 12 DryRun-3.5 + 10 route smoke) |
| Full test suite | 4463/4468 (5 pre-existing failures unchanged) |
| Build | green (EXIT_CODE=0) |

**Recommended next step:** the persistence path is now proven safe across two LR runs (3+3 candidates → 7+4 = 11 clean rows, 0 leaks across both). The bundleError gate is working. Before any LR-3, **fix the test-isolation bug** so monthly budget tracking actually accumulates. Then either continue with mixed-slot LR-3 (if the queue gets new candidate types) or pause LLM-regen entirely and move to other operator priorities.

---

## Pre-flight (printed before any provider call)

```
Tenant target: tenant-ritz-founder
Budget cap (harness): $1.00
Provider: openai (gpt-5-mini)
Persistence path: runProviderAndPersist (file + Supabase dual-write)

PRE-FLIGHT — selected candidates:
  · create_cluster_page:geo:Cupertino
      action=expand_existing_page
      targetUrl=https://ritzbuilders.com/locations/cupertino-custom-home-builder
      confidence=medium tier=observation affectedPrompts=3
  · strengthen_page_copy:prompt:328d13f0-ddbe-4ece-bb86-68095a2fa62e
      action=expand_existing_page targetUrl=https://ritzbuilders.com/
      confidence=medium tier=observation affectedPrompts=1
  · create_single:prompt:39d566dc-f6a1-4af0-89bf-fec753a9e855
      action=expand_existing_page targetUrl=https://ritzbuilders.com/
      confidence=medium tier=observation affectedPrompts=1

Pre-flight passed: 3 candidates, all medium-conf + observation-tier ✓
```

### Why only 3 candidates (operator brief said 5–10)

Read-only discovery (`scripts/llm-live-regen-2-discover.ts`) found exactly **3 eligible candidates** in the live queue after applying the operator's filter:

- 13 candidates total
- 3 already touched by LiveRegen-1 (Palo Alto, Bay Area teardown, Atherton)
- 6 LOW-confidence inventory-tier (would abstain via Rule 16.A trigger 1)
- 1 medium-confidence INVENTORY-tier (Luxury Home Builder topic cluster — outside the operator's "observation+ tier" criterion)
- **3 remain eligible** — exactly the slate above

The brief's ideal mix (1 location + 1 page-create + 1 FAQ-heavy + 1 schema/technical) couldn't be met:
- Location ✓ (Cupertino)
- Page-create ✗ (the only `create_new_page` was Bay Area teardown, in LR-1)
- FAQ-heavy: the 2 single-prompt expansions emit FAQ pairs naturally (Cupertino + create_single both did)
- Schema/technical ✗ (no `add_schema` action types in this tenant's queue today)

Honest constraint of the queue. Reported up-front. The 2 single-prompt MEDIUM candidates do test the LLM-DryRun-3.5 SINGLE-PROMPT CAUTION code path in live persistence, which was the secondary value of this run.

---

## Per-candidate report

### Candidate 1 — Cupertino (cluster expansion)

| Field | Value |
|---|---|
| stableKey | `create_cluster_page:geo:Cupertino` |
| Action | `expand_existing_page` (motive: capture_absent_cluster) |
| Target URL | `https://ritzbuilders.com/locations/cupertino-custom-home-builder` |
| Confidence | medium |
| Tier | observation |
| Affected prompts | 3 |
| Bundle | 5 edits emitted |
| Validator | 2 accepted, 3 rejected, **bundleErrors=1** |
| **Persisted** | **NO** (bundleError gate fired) |
| Cost | $0.0122 |
| Guardrail flags | 0 |

**Validator rejections (working as designed):**
1. `add_h2_section.evidence[1]` — competitor ref unknown name "Feldman Construction"
2. `add_faq.targetElement.elementKey` — unpaired FAQ question (`faq_question[new]:cupertfaq01`) without matching answer in same bundle
3. `add_faq.evidence[1]` — competitor ref unknown name "ConstructElements"

The unpaired-FAQ rejection promoted to a `bundleError` (every FAQ Q must have its A row in the same bundle). The engine's `runProviderAndPersist` correctly aborted persistence:

```ts
if (!dryRun && validation.bundleErrors.length === 0 && acceptedRows.length > 0) {
  await persistRecommendedEditsLocal(acceptedRows);
  await syncRecommendedEdits(acceptedRows, ctxTenantId);
  persisted = true;
}
```

`persisted=false` → 0 rows written to .data, 0 rows written to Supabase. **Verified directly:** Supabase shows 3 Cupertino rows but they were created `2026-05-04 03:36:12 UTC` (yesterday's dogfood) with different element keys (`9f7c2b6a` vs LR-2's would-have-been `b3c9f7a1`/`d94a2e6f`). LR-2 introduced **0 Cupertino rows**.

### Candidate 2 — strengthen_page_copy (single-prompt)

| Field | Value |
|---|---|
| stableKey | `strengthen_page_copy:prompt:328d13f0-…68095a2fa62e` |
| Action | `expand_existing_page` |
| Target URL | `https://ritzbuilders.com/` |
| Confidence | medium |
| Tier | observation |
| Affected prompts | **1** |
| Bundle | 3 edits emitted |
| Validator | 1 accepted, 2 rejected, **bundleErrors=1** |
| **Persisted** | **NO** (bundleError gate fired) |
| Cost | $0.0114 |
| Guardrail flags | 0 |

**Validator rejections (working as designed):**
1. `add_faq.targetElement.elementKey` — unpaired FAQ question (`faq_question[new]:hillside01`)
2. `add_faq.evidence[1]` — competitor ref unknown name "Greenberg Construction"

Same FAQ-pairing bundleError pattern. **0 rows persisted.** Supabase verified: 0 rows match `rec_id = strengthen_page_copy:prompt:328d13f0-…`. Validator accepted 1 H2 edit but the bundle's overall integrity (orphaned FAQ Q) made the whole bundle un-shippable. Correct engine behavior.

**SINGLE-PROMPT CAUTION in action:** the model DID generate (3 edits) instead of abstaining — this confirms the DryRun-3.5 fix in live persistence: single-prompt + medium-conf + brand-empty + strong aggregates → generate (under the OLD over-broad rule, this candidate would have abstained at 0 cost).

### Candidate 3 — create_single (single-prompt)

| Field | Value |
|---|---|
| stableKey | `create_single:prompt:39d566dc-…fec753a9e855` |
| Action | `expand_existing_page` |
| Target URL | `https://ritzbuilders.com/` |
| Confidence | medium |
| Tier | observation |
| Affected prompts | **1** |
| Bundle | 4 edits emitted |
| Validator | **4 accepted, 0 rejected, 0 bundleErrors** ✅ |
| **Persisted** | **YES, 4 rows** |
| Cost | $0.0121 |
| Guardrail flags | 0 |

**Persisted rows (operator-readable summary):**

| # | Action | Display label | Quality |
|---|---|---|---|
| 1 | add_h2_section | "Architect-led design build process for custom homes" | Clean H2 grounded in topSearchQueries + competitor blueprints |
| 2 | add_h2_section | "Why choose architect-led design-build" | Hedged process-focused content |
| 3 | add_faq | (Q) — modern custom home process question | Direct match for user query |
| 4 | add_faq | (A) — paired answer | Hedged ("focuses on integrating design and construction…") |

All 4 grounded in `aiSearchSignal.topSearchQueries` and the affected prompt. No fabricated numbers/timelines, no UUID leaks, no placeholders, no competitor names in public copy.

This candidate is the second confirmation of the LLM-DryRun-3.5 SINGLE-PROMPT CAUTION fix: under the LiveRegen-1 over-broad rule, this packet (medium-conf + 1 prompt + brand-empty) would have abstained. With the fix, it generates 4 ship-as-is edits.

---

## Validator behavior summary

| Reason | Count | Working as designed? |
|---|---|---|
| competitor ref unknown name "Feldman Construction" | 1 | YES |
| competitor ref unknown name "ConstructElements" | 1 | YES |
| competitor ref unknown name "Greenberg Construction" | 1 | YES |
| unpaired FAQ question (faq_question[new]:cupertfaq01) | 1 → bundleError | YES — promoted to bundle-level fail because every FAQ Q needs its paired A |
| unpaired FAQ question (faq_question[new]:hillside01) | 1 → bundleError | YES |
| All other validator gates (UUID, placeholder, fabricated numbers, em-dash) | 0 fires | YES (no triggering content emitted) |

**0 unexpected validator behavior. 0 silent persistence of rejected edits. The bundleError gate (line 733-737 of `recommended-edits-persistence.ts`) is doing its job.**

---

## Persistence verification (post-run)

### `.data/tenants/ritz-builders/recommended-edits.json`

| Metric | Before | After | Δ |
|---|---|---|---|
| Total rows | 27 | 31 | **+4** ✅ (only candidate 3) |
| openai-source rows | 19 | 23 | **+4** ✅ |
| New row IDs | — | (4 unique under `create_single:prompt:39d566dc-…`) | 0 collisions, 0 duplicates |
| UUID hits in {why, expectedImpact, measurementPlan, proposedText, displayLabel, currentText} | — | **0** ✅ |
| Placeholder hits | — | **0** ✅ |
| Fabricated number/timeline/cost in proposedText/displayLabel/expectedImpact | — | **0** ✅ |
| Competitor name in proposedText or displayLabel | — | **0** ✅ |
| Duplicate IDs across the entire file | — | **0** ✅ |

### Supabase `recommended_edits` table

| Metric | Value |
|---|---|
| Total rows for tenant-ritz-founder | 28 |
| openai-source rows | 20 |
| Rows from LR-2's create_single bundle | **4** ✅ |
| Cupertino rows (should be 0 from LR-2) | 3 (all created 2026-05-04 03:36 UTC — pre-existing dogfood, NOT from LR-2) ✅ |
| strengthen_page_copy rows (should be 0) | **0** ✅ |
| Rows created today 2026-05-06 | 11 (= 7 from LR-1 + 4 from LR-2) ✅ |
| Duplicate IDs | **0** ✅ |

### `.data/global/llm-history-specific-edits.json`

3 new entries appended (1 per candidate, all `live_call`):

```json
{ "timestamp": "2026-05-06T02:55:52.372Z", "recId": "create_cluster_page:geo:Cupertino",         "model": "gpt-5-mini", "costUsd": 0.012184, "acceptedCount": 2, "status": "live_call" }
{ "timestamp": "2026-05-06T02:57:09.821Z", "recId": "strengthen_page_copy:prompt:328d13f0-…",   "model": "gpt-5-mini", "costUsd": 0.011381, "acceptedCount": 1, "status": "live_call" }
{ "timestamp": "2026-05-06T02:58:20.695Z", "recId": "create_single:prompt:39d566dc-…",          "model": "gpt-5-mini", "costUsd": 0.012101, "acceptedCount": 4, "status": "live_call" }
```

**`acceptedCount` here is the validator's count, not the persisted count.** Cupertino's 2 + strengthen_page's 1 are accepted-but-not-persisted (bundleError). create_single's 4 are accepted AND persisted.

### `.data/global/llm-budget.json` — **ANOMALY**

```json
{ "monthKey": "2026-05", "spendUsd": 0.035666, "calls": 3, "capUsd": 10, "updatedAt": "2026-05-06T02:58:20.695Z" }
```

The ledger records ONLY LR-2's 3 calls ($0.035666 = 0.012184 + 0.011381 + 0.012101). LR-1's $0.030075 + 3 calls is GONE.

**Root cause traced:** `tests/domains/recommendations/adjudicate.test.ts:cleanupTestStores` (around line 38–58) writes `[]` to the REAL `.data/global/llm-budget.json` via `writeStore` without a hermetic chdir. Every `npm run test` invocation between LR-1 and LR-2 clobbered the file.

**This is a pre-existing test-isolation bug, NOT a LR-2 regression.** LR-2's persistence-path code did exactly what it should have: read state from disk, accumulate spend, write back. The bug is upstream — the test reset the disk file.

**Recommended fix (separate bundle):** make `cleanupTestStores` either (a) chdir to a tmpdir + restore in afterEach (the pattern `src/adapters/perplexity/poll.test.ts` uses), or (b) mock `json-store` so writes never touch the real `.data/`. The fix is small but operator-locked — I'm flagging it here, not silently fixing forward.

**Operational implications:**
- The $10/month cap is effectively a per-burst cap if the ledger gets reset. An operator could exceed the intended monthly cap across many bursts.
- The harness's own $1 cap with cumulative pre-call gate worked correctly — LR-2 stayed under $1 within its own run.
- For now: track cumulative spend manually across runs (LR-1 + LR-2 = $0.066). Real fix lives in adjudicate.test.ts.

---

## Quality gates

- typecheck: clean (3 pre-existing prompt-drilldown errors verified by stash test in earlier bundles).
- targeted vitest: **69/69 PASS** across 9 files (DryRun-2 + DryRun-3 + DryRun-3.5 + cutover ceiling + packet-resolution invariants + harness no-persistence + recommendations route smoke).
- /recommendations smoke: **10/10 PASS** with the new persisted rows present.
- full suite: **4463/4468** (5 pre-existing failures unchanged; same baseline as DryRun-3.5 + LR-1 commits).
- build: **EXIT_CODE=0 green**.

---

## Cost summary

| Sample | Cost | Cumulative within LR-2 | Note |
|---|---|---|---|
| Cupertino | $0.0122 | $0.0122 | Bundle rejected (bundleError) — 0 rows persisted |
| strengthen_page | $0.0114 | $0.0236 | Bundle rejected (bundleError) — 0 rows persisted |
| create_single | $0.0121 | $0.0357 | 4 rows persisted ✅ |

LR-2 spend: **$0.0357** / $1 cap (3.57%). Cumulative across all LLM runs (DryRun-1+2+3+3.5 + LR-1 + LR-2): **$0.1963**.

---

## Open questions for operator

1. **Test-isolation bug (highest priority).** `tests/domains/recommendations/adjudicate.test.ts:cleanupTestStores` clobbers `.data/global/llm-budget.json`. Recommended fix: hermetic chdir or json-store mock. This breaks accurate monthly budget accounting across runs. Suggest a small dedicated bundle to fix it.
2. **Queue thinness.** The current queue has only 3 medium-conf observation-tier candidates not in LR-1 — far short of the operator's brief 5–10. New candidates will populate the queue as the daily cron runs and entity registry / search signals refresh. No-op until then.
3. **bundleError frequency.** 2 of 3 LR-2 bundles tripped FAQ-pairing or competitor-grounder bundleErrors. The model is sometimes citing competitors not in `competitorAngles` and emitting FAQ Q without paired A. Two patterns, both validator-caught. Possible follow-up: tighten SYSTEM_PROMPT to require evidence-array competitor-name grounding (validator already enforces it; prompt could discourage it earlier).

---

## Architecture invariants pinned by this bundle

The LR-2 harness inherits all pinning from LR-1's harness pattern. No new architecture invariants in this bundle — the operator-recommended `tests/architecture/llm-live-regen-allowlist.test.ts` (pinning the live-regen harness's safety properties) remains a future bundle.

---

## What this run proved

1. **The bundleError gate works.** 2 of 3 bundles had at least one validator rejection that promoted to `bundleErrors`; engine correctly aborted persistence; 0 rows leaked from the rejected bundles.
2. **The DryRun-3.5 fix works in live persistence.** 2 single-prompt MEDIUM-conf + brand-empty candidates GENERATED (instead of abstaining as they would have under the LR-1 over-broad rule). One of them produced 4 clean ship-as-is edits.
3. **Per-row guardrails hold across runs.** All 4 newly-persisted rows are clean (0 UUIDs, 0 placeholders, 0 fabricated numbers, 0 competitor names in public copy).
4. **Dual-write to Supabase is reliable.** All 4 rows landed; 0 duplicates; row IDs match local exactly.
5. **The persistent budget ledger has a test-isolation bug.** LR-2 didn't cause it; LR-2 surfaced it. Pre-existing technical debt to address before LR-3 if accurate monthly tracking matters.
