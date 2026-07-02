# W3 Step 3.9 — Narrow Paid Runs (Palo Alto persist + Cupertino + Luxury)

> **Date:** 2026-05-03
> **Operator scope:** persist Palo Alto with `--write`, then run two narrow dry-runs (one cluster at a time) on Cupertino + Luxury Home Builder Bay Area. Per cluster: report every generated edit, grade ship-as-is / minor-edit / no / rejected, check em dashes / Ritz Builders first mention / FAQ pairing / unsupported claims / competitor leak / row quality.
> **Provider:** `openai` (`gpt-5-mini`).
> **Persist:** Palo Alto only. Cupertino + Luxury are dry-run, no `--write`.

---

## TL;DR

| Cluster | Run mode | Generated | Ship-as-is | Rejected | Cost | Notes |
|---|---|---:|---:|---:|---:|---|
| Palo Alto | `--write` | 3 | 3 | 0 | $0.013672 | Persisted to `.data/tenants/ritz-builders/recommended-edits.json`. |
| Cupertino | DRY-RUN | 3 | 2 (FAQ pair) | 1 (H2 — unknown competitor in evidence ref) | $0.014794 | Validator caught LLM inventing competitor name "TerraRevo" in evidence refs. Public copy was clean. |
| Luxury Home Builder Bay Area | DRY-RUN | 3 | 3 (1 H2 + 1 FAQ pair) | 0 | $0.014569 | Required two validator fixes mid-run (see §4). |

**Headline:** every paid run produced clean public copy under the operator-locked rules. Three minor validator gaps surfaced and were fixed before any half-pair persisted to disk:
1. **Alias floor 3 → 4** — the bare-"Bay" alias of competitor "Bay Builders" was matching every "Bay Area" mention as a false positive.
2. **FAQ pairing now per-edit aware** — a per-edit-failed FAQ question used to leave its matching answer effectively orphaned at persist time.
3. **`best_in_market` adjective gap** — "the best luxury home builders" slipped through the original strict-adjacency regex; pattern now allows up to 3 modifier words between "best" and the noun.

---

## 1 · Palo Alto (`--write` persist)

### Run

```
BEACON_TENANT_ID=tenant-ritz-founder BEACON_TENANT_SLUG=ritz-builders \
  npx tsx --require ./scripts/mock-server-only.cjs \
  scripts/build-edits-for-queue.ts \
  --rec-id="create_cluster_page:geo:Palo Alto" \
  --provider=openai --write
```

### Result

3 edits generated · 3 accepted · 0 rejected · cost $0.013672 USD · persisted to `.data/tenants/ritz-builders/recommended-edits.json`.

### Edit grading

| # | Action | Element | Verdict | Notes |
|---|---|---|---|---|
| 1 | add_h2_section | `h2[new]:paloalto1a2b3c4d` | ship-as-is | "Architect-designed custom homes in Palo Alto" — gold-standard voice ("Ritz Builders emphasizes … our team includes feasibility and permitting planning early …"). |
| 2 | add_faq Q | `faq_question[new]:faqpalo1234` | ship-as-is | "Who builds architect-designed custom homes in Palo Alto?" — clean question-only, ends "?". |
| 3 | add_faq A | `faq_answer[new]:faqpalo1234` (paired with #2) | ship-as-is | 65-word answer: "Ritz Builders provides … Our team coordinates …" — concrete scope (deep foundations, underground basements). |

### Checklist

- ✓ no em dashes
- ✓ "Ritz Builders" full entity name on first mention (all 2 paragraphs)
- ✓ "our team" first-person plural transition (after first full mention)
- ✓ FAQ pair (Q+A share hash `faqpalo1234`)
- ✓ no unsupported popularity / award / superlative claims
- ✓ no competitor public-copy leak
- ✓ action-table row quality: each row reads as a concrete operator task; specific scope tied to packet evidence (deep foundations, underground basements, complex Palo Alto sites).

---

## 2 · Cupertino (DRY-RUN)

### Run

```
BEACON_TENANT_ID=tenant-ritz-founder BEACON_TENANT_SLUG=ritz-builders \
  npx tsx --require ./scripts/mock-server-only.cjs \
  scripts/build-edits-for-queue.ts \
  --rec-id="create_single:prompt:7130b218-ecb2-4fb2-94ef-bf5beb171388" \
  --provider=openai
```

The `create_single:prompt:7130b218…` rec targets `https://ritzbuilders.com/locations/cupertino-custom-home-builder` (no Cupertino geo-cluster exists in the live queue; this is the most relevant Cupertino-specific opportunity).

### Result

3 edits generated · 2 accepted · 1 rejected · cost $0.014794 USD.

### Edit grading

| # | Action | Element | Verdict | Notes |
|---|---|---|---|---|
| 1 | add_h2_section | (rejected) | rejected | LLM emitted an evidence ref `{ type: "competitor", competitorName: "TerraRevo" }` — the validator caught that "TerraRevo" isn't in the packet's `competitorAngles` list. Honest validator behavior; the LLM hallucinated a competitor name in evidence refs. Public copy itself was clean ("Ritz Builders helps Cupertino homeowners update interiors and building systems while keeping the existing footprint."). |
| 2 | add_faq Q | `faq_question[new]:faqcupt01` | ship-as-is | "Which builders in Cupertino specialize in modernizing older homes without expanding the footprint?" — customer-voice without "best" superlative. |
| 3 | add_faq A | `faq_answer[new]:faqcupt01` (paired with #2) | ship-as-is | 60-word answer: "Ritz Builders works with Cupertino homeowners … We prioritize interior reconfiguration, updated mechanical and electrical systems, energy-efficiency improvements, and a permitting strategy tailored to local rules …". |

### Checklist

- ✓ no em dashes
- ✓ "Ritz Builders" full entity name on first mention
- ✓ "We" / "our team" transitions naturally
- ✓ FAQ pair (Q+A share hash `faqcupt01`)
- ✓ no unsupported popularity claims
- ✓ no competitor public-copy leak in the proposed text
- ✓ action-table row quality: concrete Cupertino-specific tasks (interior reconfiguration, mechanical / electrical upgrades, energy efficiency, seismic and code, permitting tailored to local rules).
- ⚠ One H2 rejected for an evidence-ref hallucination — the LLM made up the competitor name "TerraRevo". Honest validator catch; not a public-copy leak.

### First Cupertino dry-run (pre-fix) for context

The first run also rejected an FAQ question — "Who are the best builders in Cupertino for modernizing an older home without changing the footprint?" — for the brand-claim "the best builders" pattern. That run also caught an effective-orphan answer that would have persisted alone if the question had been the only failure (see §4 below).

---

## 3 · Luxury Home Builder Bay Area (DRY-RUN)

### Run

```
BEACON_TENANT_ID=tenant-ritz-founder BEACON_TENANT_SLUG=ritz-builders \
  npx tsx --require ./scripts/mock-server-only.cjs \
  scripts/build-edits-for-queue.ts \
  --rec-id="create_cluster_page:topic:Shield: Luxury Home Builder Bay Area" \
  --provider=openai
```

Three runs were required to land clean output — see §4 for the validator fixes that the first two runs surfaced.

### Result (final / clean run)

3 edits generated · 3 accepted · 0 rejected · cost $0.014569 USD.

### Edit grading

| # | Action | Element | Verdict | Notes |
|---|---|---|---|---|
| 1 | add_h2_section | `h2[new]:h29f4b2a1` | ship-as-is | "How to choose a luxury home builder in the Bay Area" — topic-first H2. Body: "Ritz Builders recommends evaluating builders by demonstrated high-end project experience, integrated design capability, and local permitting fluency. Our team coordinates feasibility, architecture, and construction planning on Bay Area sites …". |
| 2 | add_faq Q | `faq_question[new]:faq9f4b2a1` | ship-as-is | "Who should I talk to about building a high-end custom home in the Bay Area?" — customer-voice phrasing WITHOUT the superlative ("Who should I talk to" vs "Who are the best", which the model self-corrected after the validator's first-run feedback). |
| 3 | add_faq A | `faq_answer[new]:faq9f4b2a1` (paired with #2) | ship-as-is | 70-word answer: "Ritz Builders suggests … Our team manages feasibility, permitting strategy, architecture coordination, and construction planning … When you meet builders, ask about recent luxury projects in your city, their permitting experience, and whether they provide in-house design." Concrete actionable advice. |

### Checklist

- ✓ no em dashes
- ✓ "Ritz Builders" full entity name on first mention (all 2 paragraphs)
- ✓ "Our team" first-person plural transition
- ✓ FAQ pair (Q+A share hash `faq9f4b2a1`)
- ✓ no unsupported popularity claims (the model self-rephrased "Who are the best" to "Who should I talk to" after the first run's rejection)
- ✓ no competitor public-copy leak (after the alias-floor fix — see §4.1)
- ✓ action-table row quality: concrete builder-evaluation criteria; question is customer-voice without superlative; answer gives an actionable list of things to ask in interviews.

---

## 4 · Validator gaps surfaced + fixes

The Cupertino + Luxury runs surfaced three real validator gaps that I fixed before the next run.

### 4.1 — Alias floor 3 → 4 (Luxury #1 false positives)

The first Luxury dry-run rejected ALL THREE generated edits with the same reason: `proposedText contains competitor name "Bay Builders" (matched alias "Bay")`. Tracing showed the validator's `buildCompetitorAliases("Bay Builders")` produced `["Bay Builders", "Bay"]` — and "Bay" matched every "Bay Area" mention in the legitimate geo copy.

**Fix:** raised `MIN_COMPETITOR_ALIAS_LENGTH` from 3 to 4 in `specific-edit-validator.ts`. The full name "Bay Builders" still matches when actually present in copy; the bare-"Bay" derivative is now suppressed. Same fix suppresses "ICB" from "ICB Builders" and any other 3-letter abbreviation collisions.

**Tests:** added `'Bay Builders' competitor does NOT trip on 'Bay Area' copy` and `'Bay Builders' STILL matches the full name in copy`. Updated 2 existing alias-builder tests that pinned 3-char outputs (`ABC LLC` → just `["ABC LLC"]` now; `Foo Group` → just `["Foo Group"]`).

### 4.2 — FAQ pairing per-edit aware (Cupertino #1 effective-orphan risk)

The first Cupertino run rejected its FAQ question (for "the best builders" superlative) but accepted the matching answer. Under the original Step 3.8 pairing logic — which ran on the INPUT bundle, not the post-validation bundle — the answer's effective orphan status was missed. On a `--write` run, the answer would have persisted alone (the question fails per-edit but the answer slips through).

**Fix:** `checkFaqPairing` now optionally accepts `perEditOk: ReadonlyArray<boolean>` and skips per-edit-failed rows during bucketing. A failed Q correctly leaves its matching A flagged as orphan. `validateSpecificEditBundle` passes `perEditMutable.map(p => p.result.ok)`.

**Test:** added `per-edit-failed Q leaves matching A effectively orphaned (Cupertino regression)`.

### 4.3 — `best_in_market` adjective gap (Luxury #2 missed claim)

The second Luxury dry-run accepted a FAQ question "Who are the best luxury home builders in the Bay Area?" because the original `best_in_market` regex required strict adjacency between "the best" and the noun (builder/firm/etc.). With "luxury home" sitting between "best" and "builders", the pattern didn't fire.

**Fix:** the regex now allows 0-3 modifier words between "best" and the noun: `\bthe\s+best\s+(?:[\w-]+\s+){0,3}(?:builders?|...)`. Same gap fix applied to `leading_brand`. Also generalized the noun list to plurals (`builders?`, `firms?`, etc.).

**Tests:** added `flags 'the best luxury home builders' (W3 §3.8.6 — adjective gap)`, `flags 'leading luxury home builders' (adjective-gap regression)`, plus an explicit `ALLOWS 'best for whole-home remodels' (no 'the' prefix, no banned noun)` test to prove the regex still ignores legitimate non-superlative usage.

---

## 5 · Aggregate verdict across all three runs

| Operator-locked rule | Palo Alto | Cupertino | Luxury (final) |
|---|:---:|:---:|:---:|
| FAQ Q+A pairing (shared hash, separate rows) | ✓ | ✓ | ✓ |
| Question rows: question-only, ends "?", ≤ 200 chars | ✓ | ✓ | ✓ |
| Answer rows: 40-120 words, not bare question | ✓ | ✓ | ✓ |
| No em dash (—) or sentence-punctuation en dash (–) | ✓ | ✓ | ✓ |
| Full entity name "Ritz Builders" on first mention | ✓ | ✓ | ✓ |
| First-person plural transition where natural | ✓ | ✓ | ✓ |
| No bare "Ritz" alone | ✓ | ✓ | ✓ |
| No "frequently / commonly / often recommended" | ✓ | ✓ | ✓ |
| No "award-winning" / "leading" / "top-rated" | ✓ | ✓ | ✓ |
| No "best <noun>" superlative (incl. adjective gap) | ✓ | ✓ | ✓ (after §4.3 fix) |
| No outcome guarantees | ✓ | ✓ | ✓ |
| No specific competitor names in public copy | ✓ | ✓ | ✓ (after §4.1 fix) |
| No false-positive competitor alias matches | ✓ | ✓ | ✓ (after §4.1 fix) |
| No raw prompt-id references in public copy | ✓ | ✓ | ✓ |
| No placeholder phrases | ✓ | ✓ | ✓ |
| Topic-first H2 (not brand-stuffed) | ✓ | n/a (no H2 final) | ✓ |
| Self-contained body sentences | ✓ | ✓ | ✓ |
| Specific scope tied to packet evidence | ✓ | ✓ | ✓ |
| Action-table row quality (concrete tasks) | ✓ | ✓ | ✓ |

**Total cost across the three paid runs (including the false-positive runs that surfaced the validator gaps):**
- Palo Alto persist: $0.013672
- Cupertino dry-run #1: $0.011898
- Cupertino dry-run #2: $0.014794
- Luxury dry-run #1 (false-positive Bay alias): $0.014479
- Luxury dry-run #2 (best_in_market adjective gap): $0.014208
- Luxury dry-run #3 (final clean): $0.014569

Total: **$0.083620 USD** for 6 paid generations across 3 clusters. Persisted: 3 edits (Palo Alto only). Pending operator approval to persist: 5 dry-run-clean edits (2 Cupertino FAQ pair + 3 Luxury). Apply-All-HIGH stays operator-locked OUT.

---

## 6 · Decision

**The validator stack now holds end-to-end on three diverse cluster shapes** (geo location page, single-prompt service page, topic hub). Three real gaps were caught + fixed without any unsafe data reaching disk.

**Recommended next moves:**

1. Operator reviews the Cupertino + Luxury edits in this report. If approved, persist them with `--write`:
   ```
   BEACON_TENANT_ID=tenant-ritz-founder BEACON_TENANT_SLUG=ritz-builders \
     npx tsx --require ./scripts/mock-server-only.cjs \
     scripts/build-edits-for-queue.ts \
     --rec-id="<id>" --provider=openai --write
   ```
2. Operator may run the same generation on additional fresh clusters (Whole Home Renovation Builders, the location-specific strengthen rows for Palo Alto / Menlo Park) to broaden the inspection sample toward the 20-30-rec threshold.
3. Apply-All-HIGH stays operator-locked OUT until the operator explicitly approves it after personal inspection.

---

## 7 · References

- Validator + alias-floor fix + FAQ pairing per-edit aware + `best_in_market` adjective gap: this commit.
- W3 §3.8 FAQ pairing layer: commit `c261e35`.
- W3 §3.7s style layer (em dash + brand-name-first): commit `6794361`.
- W3 §3.7 brand-claim grounding: commit `2b99413`.
- Raw run logs (local artifacts):
  - `/tmp/w3-step-3.8-persist-palo-alto.log`
  - `/tmp/w3-cupertino-dry-run.log` (first run — flagged "the best builders" + effective-orphan answer)
  - `/tmp/w3-cupertino-dry-run-2.log` (second run after pairing fix)
  - `/tmp/w3-luxury-dry-run.log` (first run — Bay alias false positives)
  - `/tmp/w3-luxury-dry-run-2.log` (second run — best_in_market adjective gap)
  - `/tmp/w3-luxury-dry-run-3.log` (final clean run)
- Prior reports: `docs/W3_STEP_3.6_SAMPLE_QUALITY_REPORT.md`, `docs/W3_STEP_3.7_FIRST_PAID_RUN_REPORT.md`, `docs/W3_STEP_3.8_FAQ_PAIRING_REPORT.md`.
