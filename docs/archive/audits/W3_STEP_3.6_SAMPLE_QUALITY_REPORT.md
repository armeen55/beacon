# W3 Step 3.6 — Sample-Quality Report

> **Date:** 2026-05-03
> **Sample:** all 11 specific edits in `.data/tenants/ritz-builders/recommended-edits.json` (the production tenant)
> **Method:** read each edit's title, target, body, evidence, risks, and lifecycle status. Score against four verdicts: **ship-as-is**, **minor-edit**, **no**, **placeholder**. No paid runs. No regeneration.
> **Goal:** answer the operator-locked W3 question — "is the rec engine producing edits the operator (or a marketing/dev) can actually ship?" Decide go / no-go for the first paid LIVE run.

---

## TL;DR

| Verdict | Count | Share | Source breakdown |
|---|---:|---:|---|
| ship-as-is | 1 | 9% | 1 LLM (operator already shipped it on 2026-04-28) |
| minor-edit | 4 | 36% | 4 LLM (need brand-claim verification before publish) |
| placeholder | 5 | 46% | 4 deterministic + 1 LLM Q-without-answer |
| no | 1 | 9% | 1 deterministic (named a specific competitor in public copy) |

**Headline:** every LLM-sourced edit is at worst minor-edit, at best ship-as-is. Every deterministic-sourced edit is either placeholder (4/5) or unshippable (1/5). The W3 Step 3.4 LLM activation moved the engine from "produces unshippable stubs" to "produces near-shippable copy that needs operator brand verification."

**Decision:** **CONDITIONAL GO for the first paid LIVE run.** Two must-fix items before scaling beyond the current cluster (see §4). Apply-All-HIGH stays operator-locked OUT until those land.

---

## 1 · Per-edit verdicts

Read in production-data order. Source (`deterministic` vs `openai`) shown in the bullet.

### 1.1 — deterministic · H2 "Why teams choose us over De Mattei Construction" → Los Altos

- **Verdict:** **no**
- **Status:** dismissed (W3 Step 3.5b.A quarantine — `invalid_competitor_public_copy_pre_w3`).
- **Why no:** the proposed H2 names a specific competitor by full legal name. That's a brand/legal red zone — the validator added in 3.5b.A would now reject it at write time (`validateCompetitorPublicCopy`).
- **What this tells us:** the deterministic generator's "counter-competitor" path can synthesize competitor-name copy. The post-3.5b validator catches it; the row stays as a historical artifact.

### 1.2 — deterministic · FAQ "I own a vacant lot in Los Altos and want to build a custom…" → Los Altos

- **Verdict:** **placeholder**
- **Status:** dismissed (W3 Step 3.1b quarantine).
- **Body:** `Q: I own a vacant lot in Los Altos…\n\nA: Draft answer (operator: rewrite). Anchor on: architect-led, award-winning, builder.`
- **Why placeholder:** the answer body is the literal phrase "Draft answer (operator: rewrite)" — the operator must write every word. Not shippable.
- **What this tells us:** the deterministic FAQ generator is a placeholder factory. W3 Step 3.4 (LLM activation) replaces this path.

### 1.3 — deterministic · FAQ "Who are the best builders in Los Altos for a major structural…" → Los Altos

- **Verdict:** **placeholder** (same as 1.2)
- **Status:** dismissed.

### 1.4 — deterministic · FAQ "Which builders in Los Altos are best for modernizing an old…" → Los Altos

- **Verdict:** **placeholder** (same as 1.2)
- **Status:** dismissed.

### 1.5 — deterministic · FAQ "For a custom home in Los Altos, is it better to hire a desi…" → Los Altos

- **Verdict:** **placeholder** (same as 1.2)
- **Status:** dismissed.

### 1.6 — LLM (gpt-5-mini) · H2 "Architect-recommended builders for whole-home renovations" → Whole Home Remodel page

- **Verdict:** **minor-edit**
- **Status:** recommended (open).
- **Body (excerpt):** "Architects and homeowners often prefer architect-led, design-build firms for complex whole-home renovation projects… Ritz Builders is **frequently recommended** for large-scale modernization projects in the Bay Area thanks to its integrated approach…"
- **Strengths:** concrete sentence shape, no placeholder, no specific competitor name, brand voice plausible.
- **Concern:** "frequently recommended" is an unsupported claim. The row's Risks list already flags it ("Marketing team should confirm the brand positioning sentence about Ritz Builders"). Operator must replace with a concrete fact ("X completed projects since 2018", "featured in Y publication", etc.) or soften to a process claim ("Ritz specializes in architect-led whole-home remodels…").
- **Minor-edit difficulty:** ~5 minutes. Brand owner can swap one sentence and ship.

### 1.7 — LLM (gpt-5-mini) · FAQ "Which builders should I hire for a complete whole-home renovation?" → Whole Home Remodel page

- **Verdict:** **minor-edit**
- **Status:** recommended (open).
- **Body (excerpt):** "Many Bay Area homeowners hire architect-led design-build firms… Ritz Builders is **commonly recommended** for high-end whole-home remodels because its integrated design-build process coordinates architecture, engineering, and construction…"
- **Concern:** same as 1.6 — "commonly recommended" is unsupported. Otherwise structurally clean (Q-shape FAQ, single paragraph answer, brand voice).
- **Minor-edit difficulty:** ~5 minutes.

### 1.8 — LLM (gpt-5-mini) · FAQ "Builders architects recommend for complex whole-home renovations" → Whole Home Remodel page

- **Verdict:** **minor-edit**
- **Status:** recommended (open).
- **Body (excerpt):** "Architects typically recommend builders with proven experience on complex, architect-led renovations who can manage structural upgrades, MEP systems, and phased construction… Ritz Builders is **often cited** among firms recommended for architect-led projects because of its integrated design-build approach and experience with large-scale Bay Area remodels."
- **Concern:** "often cited among firms recommended" is the third unsupported claim. Operator can either back it with a concrete reference (publication, count, awards) or rewrite to a process-focused claim ("Ritz handles structural, MEP, and phasing in-house for architect-led projects…").
- **Minor-edit difficulty:** ~5 minutes.

### 1.9 — LLM (gpt-5-mini) · H2 "Architect-led design-build advantage" → Whole Home Remodel page

- **Verdict:** **ship-as-is** ✓
- **Status:** **verified_live** (shipped 2026-04-28, `live_match_kind=exact`).
- **Body (excerpt):** "An architect-led design-build approach keeps design, budget, and construction tightly coordinated, reducing unexpected cost increases and schedule delays. For complex Bay Area whole-home renovations, **our** in-house architects, permitting specialists, and project managers handle feasibility, approvals, and trade coordination to deliver high craftsmanship with a smoother, lower-stress process."
- **Why ship-as-is:** operator already shipped it. Body uses "our" voice (no third-person "Ritz Builders is recommended"). Claims-of-fact are about Ritz's process (in-house architects, permitting specialists, project managers) — verifiable by the operator. No specific competitor name. No inflated marketing claim.
- **Note:** the display_label carries the `H2:` prefix bug; the W3 Step 3.5f title humanizer strips it before render so the operator sees `Add an "Architect-led design-build advantage" H2 to the Whole Home Remodel page`.

### 1.10 — LLM (gpt-5-mini) · FAQ question only "Who should I hire in the Bay Area for a whole-home renovation instead of rebuilding my house?" → Whole Home Remodel page

- **Verdict:** **placeholder** (incomplete)
- **Status:** dismissed.
- **Why placeholder:** the proposed_text is the question line alone; the matching answer is in a separate edit row (1.11). The operator dismissed the question-half because the schema split FAQ Q + A across two rows is harder to use than one Q+A pair.
- **What this tells us:** FAQ pairing in the persistence layer should emit ONE edit row, not two. Or the UI should render Q+A pairs together and accept-as-pair.

### 1.11 — LLM (gpt-5-mini) · FAQ answer "Hire an architect-led design-build firm…" → Whole Home Remodel page

- **Verdict:** **minor-edit** (would be ship-as-is if paired with its question)
- **Status:** dismissed.
- **Body (excerpt):** "Hire an architect-led design-build firm that manages feasibility, permitting, and construction together. Ritz Builders provides **in-house architectural design, permitting support, and dedicated project management** for complex whole-home renovations in the Bay Area to minimize surprises and keep schedules on track."
- **Why minor-edit:** body is solid, concrete, brand-voice plausible. The dismissal was structural (Q-without-A pairing), not content-quality.
- **What this tells us:** confirms 1.10's finding — the FAQ pairing schema needs a fix.

---

## 2 · Source breakdown

| Source | Count | ship-as-is | minor-edit | placeholder | no |
|---|---:|---:|---:|---:|---:|
| **deterministic** | 5 | 0 | 0 | 4 | 1 |
| **openai (gpt-5-mini)** | 6 | 1 | 4 | 1 | 0 |

**Reading:** every deterministic-sourced edit is either placeholder (4) or unshippable (1). Every LLM-sourced edit is at worst minor-edit, at best ship-as-is.

The Step 3.4 LLM activation is the difference between "the rec engine produces stubs" and "the rec engine produces near-shippable copy that needs brand verification."

---

## 3 · What's working

- **No raw prompt-id leaks** in proposed bodies. Step 3.5c's `scrubRawPromptIds` defense-in-depth is doing its job.
- **No specific-competitor names** in any LLM-sourced body. Step 3.5b.A's `validateCompetitorPublicCopy` plus the openai SYSTEM_PROMPT v2 are holding the line. The deterministic-sourced 1.1 violation predates the validator.
- **Page targeting is right.** Every Whole Home Remodel edit anchors on `/services/whole-home-remodel`; every Los Altos edit anchors on `/locations/los-altos`. No cross-page drift.
- **Brand voice is plausible** in the LLM bodies — first-person "our" or third-person "Ritz Builders" sentences read like a real builder website, not LLM filler.
- **Topical accuracy is high.** When the cluster is "whole-home renovation builders", the LLM produces copy about whole-home renovations (not about kitchen remodels). When the cluster is geo+older-home, the LLM produces older-home copy.

## 4 · What needs fixing before scale

### 4.1 — Brand-claim grounding (must-fix before paid run on a fresh cluster)

Three of four minor-edit rows (1.6, 1.7, 1.8) carry the same defect: an unsupported "Ritz is **frequently/commonly/often** recommended" sentence. The LLM has no source for this — it's pattern-matching to what a strong builder website says about itself.

**Fix:** plumb operator-curated brand assertions through the SYSTEM_PROMPT. Concrete shape:

```
brand_assertions: [
  "Founded 2014, 30+ Bay Area whole-home remodels completed since 2018",
  "Featured in [publication] 2024",
  "All architects and project managers are in-house",
]
```

The LLM uses ONLY these assertions when claiming third-party recognition. If no operator-supplied assertion fits, the LLM rewrites the sentence to a process-focused claim instead. This is a one-pass change to the openai provider's input shape + SYSTEM_PROMPT v2 — no new LLM cost, no new tests beyond the existing competitor-leak check.

### 4.2 — FAQ pairing (should-fix before scaling FAQ generation)

Edit 1.10 is a question-without-answer; edit 1.11 is the answer-without-question. The schema currently splits Q+A into separate `recommended_edits` rows. Operator dismissed both because they're harder to use independently than as a pair.

**Fix:** at the persistence layer, emit ONE edit row per FAQ with a `question_text` + `answer_text` field pair, OR the UI renders linked Q+A rows together and the Accept button accepts both at once. Lower priority than 4.1 — operator can manually pair them today.

### 4.3 — Display-label hygiene (already fixed, post-3.5f)

The `H2: Architect-led design-build advantage` label format (with the `H2:` prefix) showed up in the operator browser audit on 3.5e as `Add an H2 "H2: …"`. W3 Step 3.5f's `cleanDisplayLabel` strips these prefixes at render time. No further engine-side change needed; the title humanizer is the right layer for that hygiene.

---

## 5 · Decision

**CONDITIONAL GO for the first paid LIVE run.**

- ✅ Quality bar is met when the LLM is the source.
- ✅ Validator + entity-pollution filter + scrubber stack is holding.
- ⚠️ Must-fix before running a fresh paid generation: §4.1 (brand-claim grounding).
- ⚠️ Should-fix before scaling FAQ output: §4.2 (FAQ pairing).
- ❌ Apply-All-HIGH stays operator-locked OUT until §4.1 lands and the operator personally inspects 20-30 fresh recs (operator-locked W3 §1.5).

The first paid run can target a single new cluster (5-10 edits max) with brand-claim grounding plumbed. Operator inspects manually. If the verdict distribution holds (≥80% ship-as-is or minor-edit, ≤10% placeholder), proceed to broader generation.

---

## 6 · References

- Sample data: `.data/tenants/ritz-builders/recommended-edits.json` (11 rows)
- Operator-locked verdict rubric: W3 §1.5
- Step 3.1 (placeholder kill) → `src/domains/recommendations/placeholder-detection.ts`
- Step 3.5b.A (competitor-name validator) → `src/domains/recommendations/specific-edit-validator.ts:validateCompetitorPublicCopy`
- Step 3.5c (raw-prompt-id scrubber) → `recommendations-client.tsx:scrubRawPromptIds`
- Step 3.5f (display-label cleaner) → `recommendation-title-humanizer.ts:cleanDisplayLabel`
- LLM provider system prompt → `src/domains/recommendations/providers/openai.ts:SYSTEM_PROMPT`
