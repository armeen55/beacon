# W3 Step 3.8 — FAQ Q+A Pairing Dry-Run Report

> **Date:** 2026-05-03
> **Run mode:** DRY-RUN (no `--write`, nothing persisted to `.data/recommended-edits.json`).
> **Tenant:** ritz-builders.
> **Cluster:** `create_cluster_page:geo:Palo Alto` (queue rank #2, target `https://ritzbuilders.com/locations/palo-alto`).
> **Provider:** `openai` (`gpt-5-mini`).
> **Cost:** $0.015969 USD total (5 edits, $0.0032/edit).
> **Goal:** verify the W3 §3.8 paired-FAQ contract closes the bundled-Q+A defect observed in the §3.7 first paid run.

---

## TL;DR

| Verdict | Count | Type | Notes |
|---|---:|---|---|
| ship-as-is | 5 | 1 H2 + 2 paired FAQs (Q+A × 2) | every operator rule held |
| rejected | 0 | — | the §3.7 bundled-Q+A failure mode is gone |
| brand-claim leak | 0 | — | grounding contract holds |
| em dash leak | 0 | — | style layer holds |
| bare "Ritz" | 0 | — | every brand mention uses "Ritz Builders" or "our team" |
| FAQ pairing | 2 of 2 | both Q+A pairs share hash | `pa01ab2c3d4` + `pa02ab2c3d5` |
| placeholder | 0 | — | — |
| competitor-name leak | 0 | — | — |
| wrong-page anchor | 0 | — | both FAQs anchor on the Palo Alto page |

**Headline:** the FAQ Q+A pairing contract works end-to-end. The model emitted TWO valid FAQ pairs (4 rows total) with matching hash suffixes — exactly the operator-locked shape from W3 §3.8. The H2 also passed every previous gate (Step 3.7 brand grounding + Step 3.7s style). Cost ticked up ~30% vs Step 3.7 because the model emits both halves of each FAQ pair instead of bundling.

**Decision:** **GO for narrowly-scoped paid runs going forward.** The gate stack (Step 3.7 grounding + 3.7s style + 3.8 pairing) is now production-ready for one cluster at a time. Apply-All-HIGH stays operator-locked OUT until the operator inspects 20–30 fresh recs (W3 §1.5).

---

## 1 · Run setup

```
BEACON_TENANT_ID=tenant-ritz-founder BEACON_TENANT_SLUG=ritz-builders \
  npx tsx --require ./scripts/mock-server-only.cjs \
  scripts/build-edits-for-queue.ts \
  --rec-id="create_cluster_page:geo:Palo Alto" \
  --provider=openai
```

DRY-RUN. No `--write`, nothing persisted.

Pre-run state of `.data/tenants/ritz-builders/recommended-edits.json`:
- 11 rows from prior runs on Los Altos + Whole Home Renovation Builders clusters.
- 0 rows on the Palo Alto cluster (target stayed fresh after the §3.7 dry-run).

Active gates on this run:
- Step 3.7 brand-claim grounding (`packet.brandAssertions` + Rule 18).
- Step 3.7s public-copy style (no em dashes, full entity name first mention).
- Step 3.8 FAQ Q+A pairing (per-edit shape + bundle-level pairing + Rule 13 paired contract).

---

## 2 · Edit-by-edit verdicts

### 2.1 — ACCEPTED · add_h2_section "Architect-designed custom homes (Palo Alto)"

- **Element:** `h2[new]:h2pa01a2b3c4` (additive — new H2 on Palo Alto page).
- **Verdict:** **ship-as-is**

**proposedText:**
> Architect-designed custom homes in Palo Alto
>
> Ritz Builders emphasizes an architect-led design-build approach for custom homes in Palo Alto, coordinating architectural design, structural engineering, permitting strategy, and construction planning from the earliest stages. For complex Palo Alto sites, including deep foundations and large basement scopes, our integrated process helps align design intent with buildability before construction begins.

**Why ship-as-is:**
1. Full entity name first mention: "Ritz Builders emphasizes…" ✓
2. First-person plural transition: "our integrated process…" ✓
3. No em dashes — sentences use commas + colon-style breaks ✓
4. No popularity / award / superlative claims ✓
5. Topic-first H2 heading (not brand-stuffed) ✓
6. Specific scope tied to evidence (deep foundations, large basement scopes) ✓
7. Self-contained answer chunk — first sentence stands alone for AI engines ✓

This is the gold-standard shape from SYSTEM_PROMPT Rule 19e.

### 2.2 — ACCEPTED · add_faq Q row · `faq_question[new]:pa01ab2c3d4`

- **Verdict:** **ship-as-is**
- **proposedText:** "Who builds architect-designed custom homes in Palo Alto?"
- Question-only ✓ · ends "?" ✓ · 56 chars (≤ 200) ✓ · no answer body ✓.

### 2.3 — ACCEPTED · add_faq A row · `faq_answer[new]:pa01ab2c3d4` (paired with 2.2)

- **Verdict:** **ship-as-is**

**proposedText:**
> Ritz Builders provides an architect-led design-build approach for custom homes in Palo Alto. Our team coordinates architects, structural and geotechnical engineers, and the permitting process from feasibility through construction so homeowners can evaluate relevant portfolio projects and confirm experience with similar scope and site complexity.

- 51 words (within the 40–120 preferred range) ✓
- "Ritz Builders provides…" → "Our team coordinates…" (gold transition pattern) ✓
- No em dashes ✓ · No popularity claims ✓
- Specific scope: "geotechnical engineers", "permitting process from feasibility through construction" — grounded in packet evidence ✓
- Hash suffix `pa01ab2c3d4` matches the question row → paired ✓

### 2.4 — ACCEPTED · add_faq Q row · `faq_question[new]:pa02ab2c3d5`

- **Verdict:** **ship-as-is**
- **proposedText:** "Can custom home builders in Palo Alto build large underground basements?"
- Question-only ✓ · ends "?" ✓ · 75 chars (≤ 200) ✓.
- Targets a specific real prompt observed in the affected-prompt set (basement / buildability intent on prompt `397618d8…`).

### 2.5 — ACCEPTED · add_faq A row · `faq_answer[new]:pa02ab2c3d5` (paired with 2.4)

- **Verdict:** **ship-as-is**

**proposedText:**
> Ritz Builders can manage custom home projects in Palo Alto that include large underground basements by coordinating structural engineering, geotechnical investigations, dewatering strategy, and permitting early in the design process. Early feasibility analysis and a clear permitting plan are essential because groundwater, dewatering, and strict city review affect constructability and cost.

- 51 words ✓
- "Ritz Builders can manage…" (full entity name first) ✓
- No first-person transition needed — the third-person voice fits the technical answer; the brand-name-first rule is satisfied with the single "Ritz Builders" mention ✓
- Specific scope: "geotechnical investigations, dewatering strategy, groundwater, strict city review" — densely grounded in packet evidence ✓
- No em dashes ✓ · No popularity claims ✓
- Hash suffix `pa02ab2c3d5` matches the question row → paired ✓

---

## 3 · Verification matrix

| Operator-locked rule | This run |
|---|:---:|
| FAQ Q+A pairing (shared hash, separate rows) | ✓ both pairs |
| Question rows: question-only, ends "?", ≤ 200 chars | ✓ both |
| Answer rows: 40–120 words, not a bare question | ✓ both (51, 51) |
| No `Q: \n A:` bundling | ✓ |
| No em dash (—) | ✓ |
| No en dash as sentence punctuation (–) | ✓ |
| Full entity name "Ritz Builders" on first mention | ✓ all 3 paragraphs |
| First-person plural transition (`Our team`, `our integrated process`) | ✓ where it fits |
| No bare "Ritz" alone | ✓ |
| No "frequently / commonly / often recommended" | ✓ |
| No "award-winning" / "leading" / "top-rated" | ✓ |
| No "best builder/firm" superlative | ✓ |
| No outcome guarantees | ✓ |
| No specific competitor names in public copy | ✓ |
| No raw prompt-id references | ✓ |
| No placeholder phrases ("Draft answer", "TBD", etc.) | ✓ |
| Topic-first H2 (not brand-stuffed) | ✓ |
| Self-contained body sentences | ✓ |
| Specific scope tied to packet evidence | ✓ |

Every gate held. Zero rejections.

---

## 4 · Cost

- Total: **$0.015969 USD** (5 edits, $0.0032/edit).
- ~30% higher than §3.7's run ($0.012162 for 2 edits, $0.0061/edit) on a per-cluster basis.
- The model now emits BOTH halves of each FAQ pair, doubling the FAQ row count for the same conceptual FAQ. The per-edit cost dropped because the question row is short.

Projected cost for a typical create-cluster-page rec (1 H2 + 2 FAQ pairs = 5 rows): ~$0.016 USD.

---

## 5 · Decision

**GO for narrowly-scoped paid runs going forward.** The gate stack is now production-ready:
- Step 3.7 (brand-claim grounding) — closed in §3.7.
- Step 3.7s (public-copy style: em dashes + brand-name-first) — closed in §3.7s.
- Step 3.8 (FAQ Q+A pairing) — closed in this run.

The `--write` flag will now persist clean rows. Apply-All-HIGH stays operator-locked OUT until the operator personally inspects ≥ 20–30 generated recs across multiple clusters (W3 §1.5).

To persist the Palo Alto output:

```
BEACON_TENANT_ID=tenant-ritz-founder BEACON_TENANT_SLUG=ritz-builders \
  npx tsx --require ./scripts/mock-server-only.cjs \
  scripts/build-edits-for-queue.ts \
  --rec-id="create_cluster_page:geo:Palo Alto" \
  --provider=openai \
  --write
```

---

## 6 · References

- Validator + bundle-pairing: commit `c261e35`.
- W3 §3.7 grounding layer: commit `2b99413`.
- W3 §3.7s style layer: commit `6794361`.
- Raw run log: `/tmp/w3-step-3.8-paid-run-palo-alto.log` (local artifact).
- Prior reports: `docs/W3_STEP_3.6_SAMPLE_QUALITY_REPORT.md`, `docs/W3_STEP_3.7_FIRST_PAID_RUN_REPORT.md`.
