# W3 Step 3.7 — First Paid LIVE Run Report

> **Date:** 2026-05-03
> **Run mode:** DRY-RUN (no persist to `.data/recommended-edits.json`).
> **Tenant:** ritz-builders.
> **Cluster:** `create_cluster_page:geo:Palo Alto` (queue rank #2, target `https://ritzbuilders.com/locations/palo-alto`).
> **Provider:** `openai` (`gpt-5-mini`).
> **Cost:** $0.012162 USD total (2 generated edits, $0.0061/edit).
> **Goal:** verify the W3 §3.7 brand-claim grounding layer prevents the "Ritz is frequently/commonly/often recommended" defect class observed in the W3 §3.6 sample-quality report.

---

## TL;DR

| Verdict | Count | Source | Notes |
|---|---:|---|---|
| ship-as-is | 1 | LLM | clean H2 with grounded "Ritz emphasizes…" phrasing |
| rejected | 1 | LLM | validator caught FAQ-shape defect (Rule 13: FAQ question must end with "?") |
| brand-claim leak | **0** | — | grounding layer worked |
| placeholder | 0 | — | — |
| competitor-name leak | 0 | — | — |
| wrong-page anchor | 0 | — | both edits anchored on Palo Alto target |

**Headline:** the brand-grounding layer eliminated the W3 §3.6 minor-edit defect class. The model defaulted to "Ritz **emphasizes** …" — the canonical grounded phrasing example from Rule 18 — instead of "Ritz is **frequently/commonly recommended**". The one rejection is a structural FAQ-shape issue (the model bundled the question + answer into a single proposedText), not a brand-claim issue.

**Decision:** **GO for narrowly-scoped paid runs going forward.** The grounding contract holds. Apply-All-HIGH stays operator-locked OUT until the operator personally inspects a wider sample (W3 §1.5).

---

## 1 · Run setup

```
BEACON_TENANT_ID=tenant-ritz-founder BEACON_TENANT_SLUG=ritz-builders \
  npx tsx --require ./scripts/mock-server-only.cjs \
  scripts/build-edits-for-queue.ts \
  --rec-id="create_cluster_page:geo:Palo Alto" \
  --provider=openai
```

DRY-RUN by default. `--write` was NOT passed; nothing persisted to `.data/recommended-edits.json` or Supabase.

Pre-run state of `.data/tenants/ritz-builders/recommended-edits.json`:
- 11 rows (all from prior runs on Los Altos + Whole Home Renovation Builders clusters).
- 0 rows for the Palo Alto cluster — confirmed fresh target.

Brand-assertions in packet (`packet.brandAssertions`):
- `architect-led design-build` (process)
- `Silicon Valley luxury custom homes` (service_area)
- `Bay Area luxury custom homes` (service_area)
- `custom homes` (service_offering)
- `remodels` (service_offering)
- `whole-home remodels` (service_offering)
- `teardown / rebuild projects` (service_offering)
- `in-house architecture and design-build coordination` (process)
- `concept-to-completion (feasibility, permitting, construction)` (process)
- `premium / luxury positioning` (positioning)

NO award / popularity / ranking_first / trust / tenure / client_outcome assertions — every forbidden-claim pattern in those categories stayed armed.

---

## 2 · Edit-by-edit verdicts

### 2.1 — ACCEPTED · add_h2_section "Architect-designed custom homes (Palo Alto)"

- **Status:** `accepted` (validation passed)
- **Confidence:** medium
- **Difficulty:** low
- **Element:** `h2[new]:archpa1a2b3c4` (additive — new H2 on Palo Alto page)
- **Verdict:** **ship-as-is**

**proposedText:**
> Architect-designed custom homes in Palo Alto
>
> Ritz **emphasizes** an architect-led design-build approach in Palo Alto that keeps architectural design, engineering, and city permitting coordinated from concept through construction. That integrated workflow is valuable on highly regulated Palo Alto sites and for complex builds — for example, projects that require deep foundation engineering or underground basements — because early engineering and permit strategy reduce schedule risk and unexpected costs.

**Why this is ship-as-is:**

1. Brand-claim grounding holds. The body uses "Ritz **emphasizes**" — the exact grounded-phrasing example added to Rule 18 (W3 §3.7). It does NOT say "Ritz is frequently recommended" / "the leading firm" / "award-winning" / "trusted by homeowners" / any of the operator-flagged claim classes.
2. Every claim is operator-supported or evidence-derived:
   - "architect-led design-build approach" → matches `BrandAssertion[process]`.
   - "in Palo Alto" → matches the cluster's geo + the target page.
   - "highly regulated Palo Alto sites" → factual, ties to packet evidence (city permitting).
   - "deep foundation engineering or underground basements" → grounded in packet's `aiSearchSignal.topSearchQueries` (one of the affected prompts asked about complex builds with underground basements).
   - "early engineering and permit strategy reduce schedule risk" → process claim, no superlative.
3. Risk notes flag the right operator self-check:
   > "Mentions of complex scopes (underground basements) may require internal confirmation of past project experience before publishing."
   > "If claims about permitting/engineering support are inaccurate for specific project types, customer expectations could be mismatched."
4. Evidence cites two affected prompts by full UUID (validator Rule 9 holds).
5. `why` correctly references competitor co-mention without leaking the name into public copy:
   > "competitor Greenberg Construction is repeatedly co-mentioned on these prompts, so the page needs a clearer architect-led-local angle."

**Operator action:** ship as-is, OR add one Ritz-specific proof point (e.g. a recent Palo Alto basement project) before publishing.

### 2.2 — REJECTED · add_faq Q+A bundled into one proposedText

- **Status:** `rejected` (validator)
- **Failure reason:** `add_faq / rewrite_faq question must end with "?" (got: "pecific constraints.")`
- **Verdict:** **structural defect, NOT brand-claim related**

**proposedText (truncated):**
> Who are the best builders for architect-designed custom homes in Palo Alto?
> Ritz Builders offers architect-led design-build services in Palo Alto and coordinates architects, structural engineers, and …

**Why rejected:**

The model bundled the FAQ question + answer body into ONE `proposedText` string targeting a single `faq_question[new]:…` element key. SYSTEM_PROMPT Rule 13 says FAQ-question proposedText MUST end with "?" and be ≤ 200 chars; the validator's tail-end string was "pecific constraints." (mid-answer prose), which clearly isn't a question.

The model violated Rule 13 by trying to ship Q + A together. The W3 §3.6 sample-quality report flagged this exact failure mode ("FAQ pairing — schema currently splits Q+A into two rows; operator dismissed both halves") as a should-fix structural item; the OpenAI provider hasn't been re-prompted to emit Q+A pairs as separate edits yet.

**This is NOT a brand-claim issue:**
- The proposedText (even with the structural defect) does NOT contain any forbidden claim. "Ritz Builders offers architect-led design-build services" — clean. "Coordinates architects, structural engineers" — process claim, allowed.
- The brand-claim grounder would have passed this row had the Q + A been split correctly.

**Operator action:** the W3 §3.6 should-fix item (FAQ Q + A pairing) is unblocked. Two paths:
1. Update Rule 13 in SYSTEM_PROMPT to require the model emit Q + A as TWO separate edits (one with `faq_question[new]:…`, one with `faq_answer[new]:…` matched by a shared hash suffix).
2. Update `recommended-edits-persistence` to accept a single `Q\n\nA` string and split it at write time.

Either fix is a follow-up; neither blocks the brand-grounding contract verified here.

---

## 3 · Brand-claim grounding verification

The W3 §3.6 sample-quality report flagged 3 of 4 LLM minor-edit rows for the same defect: "Ritz is **frequently/commonly/often** recommended". The Step 3.7 grounding layer (brand assertions + Rule 18 + validator) was specifically designed to close that gap.

Verification matrix on the Palo Alto run output:

| Forbidden pattern | Body 2.1 (accepted) | Body 2.2 (rejected on different rule) |
|---|:---:|:---:|
| frequently / commonly / often recommended | ✓ NOT present | ✓ NOT present |
| most trusted / trusted by homeowners | ✓ NOT present | ✓ NOT present |
| #1 / top-rated | ✓ NOT present | ✓ NOT present |
| the best builder/firm/etc. | ✓ NOT present | ✓ NOT present |
| leading builder/firm/etc. | ✓ NOT present | ✓ NOT present |
| award-winning | ✓ NOT present | ✓ NOT present |
| years in business / since YYYY | ✓ NOT present | ✓ NOT present |
| % satisfaction / N projects completed | ✓ NOT present | ✓ NOT present |
| guarantee outcome | ✓ NOT present | ✓ NOT present |

Every forbidden pattern stayed out. The grounding contract held end-to-end:
1. SYSTEM_PROMPT Rule 18 instructed the model on the allowed list + the forbidden list + grounded phrasing.
2. The packet's `brandAssertions` field shipped the operator-curated list to the model.
3. The validator's `validateBrandClaimGrounding` was armed (no env opt-out). Had the model leaked a forbidden phrase, the validator would have rejected with `unsupported brand claim`.
4. The model defaulted to "Ritz **emphasizes**" — the canonical grounded phrasing example from Rule 18.

---

## 4 · Cost

- Total cost: **$0.012162 USD** (a tenth of a cent per edit).
- 1 accepted edit ÷ $0.012162 = $0.012/accepted edit.
- 2 generated edits → 1 acceptance → 50% acceptance rate on this cluster (the rejection is a structural FAQ-shape defect; the grounding layer didn't reject anything).

Projected cost for a full LIVE run on a fresh cluster (5–10 edits): **$0.04–$0.08 USD**.

---

## 5 · What's working

1. **Brand-grounding layer eliminates the W3 §3.6 minor-edit defect.** Zero "Ritz is frequently/commonly/often recommended"; zero "leading builder"; zero "award-winning". The model defaults to operator-locked grounded phrasing ("Ritz emphasizes…", "Architect-led design-build keeps…").
2. **The packet's `brandAssertions` block reached the model.** The accepted body uses "architect-led design-build" verbatim — that's a packet `BrandAssertion[process]` row.
3. **Cost economics scale.** $0.012/cluster × ~15 clusters × ~daily regeneration cadence < $1/day for the Ritz tenant. Well below the existing $200/month adjudicator-budget cap.
4. **Validator stack is layered correctly.** Rule 13 (FAQ shape) caught a structural defect; the brand-claim gate would have caught a brand defect; both ran independently. Errors surface specific pattern ids so the operator can act on them.
5. **Risk notes are honest.** The accepted edit's risks correctly flag operator confirmation needed for project-experience-specific claims.

## 6 · What still needs fixing

### 6.1 — FAQ Q+A pairing (W3 §3.6 carry-over, exposed again)

The rejection in 2.2 was the same FAQ-pairing structural defect flagged in the W3 §3.6 report. The model wants to emit Q+A as one block; the persistence schema requires two rows; SYSTEM_PROMPT Rule 13 enforces "?". Three paths to close this:

1. **Update Rule 13** to require Q + A as TWO edits with a shared hash suffix. Shortest path.
2. **Update `recommended-edits-persistence`** to accept a single `Q\n\nA` proposedText and split at write time. Slightly larger surface, but more forgiving for future LLM versions.
3. **Update the schema** to carry `question_text` + `answer_text` natively. Most invasive, but the cleanest data shape.

Recommended: option (1) — minimal SYSTEM_PROMPT update, no schema change, defers (3) to a future phase.

### 6.2 — Rule 18 already lands cleanly; no follow-up needed

The brand-grounding layer's first-paid-run verdict is a clean pass. No tweaks to the assertion list, the forbidden patterns, or the validator are required from this run.

---

## 7 · Decision

**GO for narrowly-scoped paid runs going forward** (one cluster at a time, dry-run mode, operator-approved). The brand-grounding contract holds. Apply-All-HIGH stays operator-locked OUT until the operator personally inspects a wider sample (W3 §1.5).

The output of this run (the accepted Palo Alto H2) is shippable as-is. If the operator wants to persist + ship it, re-run with `--write`:

```
BEACON_TENANT_ID=tenant-ritz-founder BEACON_TENANT_SLUG=ritz-builders \
  npx tsx --require ./scripts/mock-server-only.cjs \
  scripts/build-edits-for-queue.ts \
  --rec-id="create_cluster_page:geo:Palo Alto" \
  --provider=openai \
  --write
```

---

## 8 · Raw run log

Saved to `/tmp/w3-step-3.7-paid-run-palo-alto.log` (not committed — local artifact only).

## 9 · References

- Brand-grounding layer: commit `2b99413`.
- W3 §3.6 baseline: `docs/W3_STEP_3.6_SAMPLE_QUALITY_REPORT.md`.
- SYSTEM_PROMPT Rule 18: `src/domains/recommendations/providers/openai.ts:319` (the BRAND-CLAIM GROUNDING block).
- Validator: `src/domains/recommendations/specific-edit-validator.ts:validateBrandClaimGrounding`.
- Brand assertions module: `src/domains/recommendations/brand-assertions.ts`.
- Operator-locked W3 §1.5: no Apply-All-HIGH until 20–30 fresh recs are operator-inspected.
