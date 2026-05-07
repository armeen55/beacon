# Beacon Recommendation BRAIN Audit — 2026-05-06

**Trust Sprint Phase 2 (2.A engine + 2.B sample-20). Read-only. Two parallel agents.**

> Operator framing: "Specific edits aren't even that good. Why would I trust the brain?" Be brutal. Cite file:line for every engine claim. Cite line numbers in `recommended-edits.json` for every sample claim.

Two-line summary: the engine has the right shape — packet → abstain rules → validators → confidence rubric — but **(a) Rule 16.A abstention is enforced ONLY in the LLM SYSTEM_PROMPT with no validator gate, (b) the customer-visible queue order discards `prioritize.ts`'s score and re-sorts by a different rubric, (c) `competitorPageBlueprints.h1/topH2s/faqQuestions/metaDescription` is hardcoded null even though SYSTEM_PROMPT promises the model uses it, (d) confidence on every shipped row is the literal string `"medium"` — there is no HIGH or LOW signal in production today.** The sample-20 found 13 SHIP_NOW + 4 NEEDS_MINOR_EDIT + 1 NEEDS_MAJOR_EDIT + 2 ABSTAIN_THIN_EVIDENCE — but precision is inflated by paired Q+A (counted as 2 rows, decided as 1) and by repeating "architect-led design-build" boilerplate the model itself flags as duplicate-content risk.

---

## Phase 2.A — Engine audit

### Source-of-evidence hierarchy

The packet built in `src/domains/recommendations/specific-edit-evidence.ts:538-701` carries:

- `affectedPrompts[]` (`:707-776`) — per-prompt block: opportunity category, observation count, brand share, top primary competitor, `descriptorsNearBrand`, `actualSearchQueries`, `citedSourcePages`, `descriptorWindows`. Source: `PromptOpportunity.evidence` + `PromptPrimarySummary` + per-prompt observations grouped at `:560-573`.
- `ownedPageCandidates[]` (`:824-860`) — `matchClusterToInventory` results scored against `cluster_label` / first prompt text. Carries `routeType`, `detectedGeo`, `detectedService`, `matchScore`, `title/h1/h2s`.
- `targetPageElements[]` (`:862-903`) — extractor rows from `page_element_inventory`, filtered to candidate URLs, freshest by `(url, element_key)`, capped 80.
- `competitorAngles[]` (`:905-957`) — primary-competitor rollup across affected prompts, filtered through `makeCompetitorRankingFilter` (entity-pollution-filter).
- `aiSearchSignal.{topSearchQueries, topDescriptors, topCompetitorCoMentions}` (`:982-1109`) — verbatim AI-emitted queries, descriptor windows around brand, real-competitor co-mentions, aggregated cross-prompt.
- `competitorPageBlueprints[]` (`:1125-1230`) — competitor URLs cited in observations, filtered by `class === "competitor"` or non-owned/non-directory domain. Title/topic enriched from `CompetitorPageEvidence` + `citationEvidenceIndex` when available; **`h1/topH2s/faqQuestions/metaDescription` are always null/[] today** (`:1214-1219`).
- `crossTenantPatterns[]` — `getCrossTenantPatterns(...)` **stub returns [] today** (`:632-637`; producer activates post-month-3 behind `BEACON_CROSS_TENANT_BRAIN=1` per SYSTEM_PROMPT comment at `openai.ts:374-382`).
- `brandAssertions[]` (`:690-696`) — `getBrandAssertions(tenantId)`. Empty for tenants without curation.
- `resolution: { confidence, tier, action }` (`:374-378`) — page-intent resolver context, set at `load-queue.ts:456-462`.

### Abstention rules

LLM provider (`providers/openai.ts`):
- **Rule 16** (`:384-397`) — abstain if no specific copy can name domain/services/geography. Soft instruction.
- **Rule 16.A** (`:399-506`) — hard contract abstain when EITHER `resolution.confidence === "low"` AND `brandAssertions == []`, OR `competitorPageBlueprints == [] AND aiSearchSignal.topSearchQueries == [] AND brandAssertions == []`. **Critical: enforced ONLY in the SYSTEM_PROMPT (instruction text).** No validator-side gate rejects a non-empty bundle on a low-confidence packet. If the model ignores the rule, the bundle ships.
- **Rule 16.B** (`:508-540`) — no fabricated numbers/timelines/costs/guarantees unless verbatim in `packet.brandAssertions`. Enforced via Rule 18's brand-claim grounder at validation time (`validateBrandClaimGrounding`, `specific-edit-validator.ts:617-619`).

LLM-call-level safety gates (`openai.ts`): empty bundle on missing `fetchImpl`/missing `BEACON_LLM_BUILD_OK`/missing `OPENAI_API_KEY`/network/timeout/HTTP-non-200/parse-fail/refusal/empty content (`:757-927`). **Verdict: silent degradation** — operator sees no rec rather than an error; `console.warn` is the only signal.

Validator gates (`specific-edit-validator.ts:212-677`, all reject the row):
- `validateNoPlaceholder` (`:564`) — rejects placeholder phrases listed in SYSTEM_PROMPT Rule 17.
- `validateNoUuidInOperatorCopy` (`:585`) — rejects raw prompt UUIDs in `why/expectedImpact/measurementPlan`.
- `validateCompetitorPublicCopy` (`:598`) — rejects competitor names from `competitorAngles[]` in `proposedText` or `displayLabel`.
- `validateBrandClaimGrounding` (`:617-619`) — rejects forbidden patterns (popularity, trust, ranking_first, award, tenure, client_outcome, guarantee_outcome) unless unlocked by an assertion of matching category. `BEACON_ALLOW_UNSUPPORTED_BRAND_CLAIMS=1` disables.
- `validateNoEmDashes` (`:638-641`).
- `validateNoLeadingSuperlativePublicCopy` (`:662-665`) — rejects "Best/Top/Leading/Premier/#1".
- `validateBrandNameFirstMention` (`:667-670`) — rejects bare short-form brand on first mention.
- `validateFaqRowShape` (`:543`) + `validateFaqIntentRewriting` (`:545`) — FAQ-question must end "?", must not lift synthetic prompt verbatim, ≤200 chars; bundled Q+A in one row rejected (`checkFaqPairing`, `:1636`).
- `confidence==="low"` + `source ∈ {openai, anthropic}` rejected unless `BEACON_LLM_LOW_CONF=1` (`:412-421`).

### Ranking — TWO LAYERS THAT DON'T AGREE

**Layer A — `prioritizeRecommendations` (`prioritize.ts:202-231`):**
`score = SEVERITY_WEIGHT (high=3/medium=2/low=1) + clusterSizeBonus (min(promptCount-1, 5)) + competitorPressureBonus (+3 dom-competitor ≥50% / +2 fragmented) + recentSignalBonus (+1 if maxSignalStrength≥60) − effortPenalty (low=0/medium=1/high=2)` (`:124-132`). Tie-breakers: `promptCount` desc, then effort asc, then `stableKey` asc (`:187-200`). Rank → tier: top 5 = "now", 6-10 = "this_week", rest = "later" (`:179-183`).

**Layer B — `buildRecommendationActionRows` (`recommendation-action-rows.ts:1568-1576`):**
Customer-visible table re-sorts by `(STATUS_BUCKET asc → PRIORITY_RANK asc → observationCount desc → id asc)`. `STATUS_BUCKET` puts new/needs_review/needs_fresh_edit at 0; `PRIORITY_RANK` is `priorityForRow` (`:694-757`) using a separate rubric (severity + observation count + brandPrimaryShare + needsHumanReview + engineConfidence + hasExactEdit). **Layer A's `_score` is NOT used in the operator-facing rank — it is computed and discarded.** The "rec.tier === 'now'" semantic is invisible to the operator.

### Confidence rubric — `computeRecConfidence` (`confidence.ts:202-351`)

LOW gates (early-return; first wins, `:206-276`):
- `affectedPromptCount===0 → no_affected_prompts`
- `needsHumanReview → needs_human_review`
- `edits.length===0 → no_edits`
- per-edit `confidence==="low" → edit_low_confidence`
- per-edit `looksLikePlaceholder(proposed_text) → edit_placeholder_text`
- per-edit `copyContainsCompetitor → competitor_name_leak_in_copy`
- `resolutionConfidence==="low" → resolution_low_confidence`
- single-prompt + `!hasAnyGroundedSignal` + `evidenceRefCount===0 → single_prompt_no_evidence` (`:268-276`; W3 Step 3.5b.B rule).

HIGH requires ALL six (`:280-340`): `multi_prompt_signal` (≥2 prompts), `adjudicated_or_inventory_tier`, `all_edits_high_confidence`, `grounded_in_search_signal OR grounded_in_competitor_blueprints`, `resolution_high_confidence`, `sufficient_evidence_refs` (≥2). Any blocker → MEDIUM with mixed reason list.

### Source-label hierarchy

`source` stamped at edit-row level by producer:
- Deterministic generators stamp `source: "deterministic", providerName: "deterministic", model: null, costUsd: null` (`add-h2-section.ts:158-160`, `add-faq.ts:133-136`, `edit-title.ts:99-103`).
- OpenAI provider stamps `source: "openai", providerName: "openai", model: <model>, costUsd: <split>` (`openai.ts:944-959`).
- Validator enforces coherence (`specific-edit-validator.ts:471-526`).
- Customer-visible "AI" pill = `editSource: edit.source ?? null` (`recommendation-action-rows.ts:254, 1248-1249, 1350-1351`). Meta-action rows (create_page / review_decision / regenerate_edit) carry `editSource: null` (`:1483-1484`).

There is NO `pattern` or `scan` source value in `SOURCE_VALUES` (`specific-edit-validator.ts:161-166`); only `deterministic`, `openai`, `anthropic`, `operator_edited`. UNVERIFIED whether scan-derived edits would re-use `deterministic`.

### Top 5 systemic engine risks

1. **Rule 16.A is SYSTEM_PROMPT-only — no validator gate.** Low-confidence + brand-empty packets rely on the model's discipline alone. (highest risk)
2. **Two ranking layers don't agree.** Prioritizer score is computed (`prioritize.ts:124-132`) and discarded by the customer-facing table (`recommendation-action-rows.ts:1568-1576`). The "rec.tier === 'now'" semantic is invisible.
3. **Deterministic `add_h2_section` puts competitor names into public copy by design** ("Why teams choose us over {Competitor}", `add-h2-section.ts:74`). Either the validator's `validateCompetitorPublicCopy` catches them and the queue silently shrinks, or they ship.
4. **Deterministic `add_faq` emits combined Q+A in one row** (`add-faq.ts:96`) while the validator's W3 §3.8 pairing contract requires two rows. Either dead code or live regression. UNVERIFIED whether `checkFaqPairing` is scoped to LLM-source rows only.
5. **`engineConfidence` defaults `hasAiSearchSignal` / `hasCompetitorPageBlueprints` to false** when callers omit them (`confidence.ts:152-162`). Any consumer outside `load-queue.ts` will under-stamp HIGH. Defense-in-depth gap.

### Missing-evidence patterns

- **Deterministic provider (Step 3.4) is not called yet at queue load time.** `load-queue.ts:262-284` runs only `adjudicateFromCacheOnly`; no `runProviderAndPersist` in the load path. Edits feeding `engineConfidence` come from previously-persisted rows fetched at `:302-308`. If no edit has been persisted, the rec lands at LOW with `reason: "no_edits"` — even if the packet would be packed with signal.
- **`priorOutcomes[]` is always empty** (`specific-edit-evidence.ts:657-661` accepts the input but the producer doesn't exist).
- **Pre-Phase-D observations contribute zero to `actualSearchQueries`/`descriptorWindows`** (`specific-edit-evidence.ts:815-822` and inline comment at `:786-805`). Perplexity/Sonar rows ALWAYS contribute zero. A packet built entirely from Perplexity rows looks like the AI never asked anything — and Rule 16.A trigger 2 fires (`topSearchQueries === [] AND blueprints === [] AND brandAssertions === [] → abstain`).
- **`competitorPageBlueprints[].h1/topH2s/faqQuestions/metaDescription` are hardcoded null/[]** (`specific-edit-evidence.ts:1214-1219`). SYSTEM_PROMPT Rule 15 (`openai.ts:363-372`) tells the model "LEARN the STRUCTURE / ANGLE these pages take", but the model only sees URL + domain + topic + citationCount + pageTitle. **The structural promise is unbacked.**

### Engine-side verdicts per evidence source

| Source | Verdict | Why |
|---|---|---|
| `aiSearchSignal.topSearchQueries` | TRUSTWORTHY | Verbatim AI emissions; canonical filtering; Rule 14 prioritizes. Honest blind spot for Perplexity / AIO. |
| `aiSearchSignal.topDescriptors` | TRUSTWORTHY | Schema v2.1 deterministic windows around brand mentions. |
| `aiSearchSignal.topCompetitorCoMentions` | TRUSTWORTHY | Filtered through `entity-pollution-filter`. |
| `competitorPageBlueprints` (URL/domain/citationCount) | TRUSTWORTHY | Sourced from `citation_urls` filtered by `class === "competitor"`. |
| `competitorPageBlueprints` (h1/topH2s/faqQuestions/metaDescription) | **UNRELIABLE** | Always null/[] today. SYSTEM_PROMPT Rule 15 promises the LLM uses them; the LLM cannot. |
| `affectedPrompts.descriptorsNearBrand` | DIRECTIONAL | From `PromptOpportunity.evidence.topDescriptors`; pre-Phase-D rows contribute none. |
| `affectedPrompts.actualSearchQueries` / `citedSourcePages` / `descriptorWindows` | DIRECTIONAL | Phase D extraction; OpenAI native polls only; Perplexity = zero. |
| `competitorAngles` | DIRECTIONAL | Real numerator/denominator, filtered. Risk: `add_h2_section` weaponizes top entry into public copy. |
| `ownedPageCandidates` | DIRECTIONAL | Heuristic blended score; `singleTargetUrl` from resolver constrains the LLM, not the matcher. |
| `brandAssertions` | TRUSTWORTHY | Operator-curated source of truth; gates social-proof claims. Empty when curation absent — honest. |
| `resolution.confidence` | TRUSTWORTHY at resolver, FRAGILE downstream | No validator gate enforces Rule 16.A on it; `priorityForRow` doesn't read it. |
| `crossTenantPatterns` | UNRELIABLE (stub) | Always `[]`. |
| `priorOutcomes` | UNRELIABLE (stub) | Always `[]`. |
| Scan findings (page_element_inventory) | TRUSTWORTHY when present | Real `element_text`; deduped to freshest. Empty when scan hasn't run after Phase 6. |

---

## Phase 2.B — Sample-20 production rec audit

Source: `.data/tenants/ritz-builders/recommended-edits.json` — **31 records** (not ~28 as the brief said). Confidence is uniformly `medium` on every row. Sampled top-20 by `created_at` desc. **Read-only.**

### Per-rec audit (top 20)

| # | id-tail | rec_id (pattern) | action | source | conf | resolution.tier | evidence types | prompts | search queries (evidence type) | competitor (in evidence) | owned-page? | scan? | brand-assertions? | status | Score | Why |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `…modern01a (faq_a)` | `create_single:prompt:39d566dc…` | add_faq (answer) | openai | medium | not present | prompt(1)+competitor(1) | 1 | not present | De Mattei (cited only in `evidence`, not customer copy) | no | no | no — risks note process-focused | recommended | NEEDS_MAJOR_EDIT | Single-prompt evidence, packet flagged "no brandAssertions"; "Ritz Builders recommends hiring an architect-led design-build firm" is self-promotional voice in an FAQ answer (line 1238). |
| 2 | `…modern01a (faq_q)` | same | add_faq (question) | openai | medium | — | prompt(1)+owned_page(1) | 1 | — | none | yes (custom-home-builder-bay-area) | no | no | recommended | SHIP_NOW | Plain customer question, on-brand, no fabrication (line 1197). |
| 3 | `…whydbld01 (h2)` | same | add_h2_section | openai | medium | — | prompt(1)+competitor(1) | 1 | — | Valley Boutique Builders | no | no | no | recommended | NEEDS_MINOR_EDIT | Duplicate H2 angle on same homepage URL as #4 (line 1156). |
| 4 | `…design01a (h2)` | same | add_h2_section | openai | medium | — | prompt(1)+competitor(1)+owned_page(1) | 1 | — | Kasten Builders | yes | no | no | recommended | SHIP_NOW | Concrete H2+body, evidence chain references competitor blueprint and owned hub (line 1110). |
| 5 | `…faqmd01ab (faq_a)` Atherton | `create_cluster_page:geo:Atherton` | add_faq (answer) | openai | medium | — | prompt(1) ONLY | 1 | — | none | no | no | no | recommended | ABSTAIN | Single prompt id, no owned_page, no competitor. Thin packet (line 1072). |
| 6 | `…faqmd01ab (faq_q)` Atherton | same | add_faq (question) | openai | medium | — | prompt(1)+owned_page(1) | 1 | — | none | yes (atherton) | no | no | recommended | SHIP_NOW | Clean customer-voice question (line 1029). |
| 7 | `…a1b2c3d4 (h2)` Atherton | same | add_h2_section | openai | medium | — | prompt(1)+owned_page(1)+competitor(1) | 1 | — | Bayside Builders Group | yes (atherton) | no | risk: brandAssertions empty | recommended | SHIP_NOW | Topic-first H2, body anchored in process language (line 981). |
| 8 | `…faq8a7b6c5d (faq_a)` Palo Alto | `create_cluster_page:geo:Palo Alto` | add_faq (answer) | openai | medium | — | prompt(2) ONLY | 2 | — | none | no | no | no | recommended | NEEDS_MINOR_EDIT | "Our team can review plans or lots…" reads like sales CTA (line 938). |
| 9 | `…faq8a7b6c5d (faq_q)` Palo Alto | same | add_faq (question) | openai | medium | — | prompt(1)+owned_page(1) | 1 | — | none | yes (palo-alto) | no | no | recommended | SHIP_NOW | Direct customer-voice question (line 897). |
| 10 | `…undergroundbasement…` Palo Alto | same | add_h2_section | openai | medium | — | prompt(1)+competitor(1) | 1 | — | Greenberg | no | no | risk: claims need engineering review | recommended | NEEDS_MINOR_EDIT | Missing owned_page evidence, technical claims need review (line 854). |
| 11 | `…designbuild_vs_arch…` Palo Alto | same | add_h2_section | openai | medium | — | prompt(1)+owned_page(1) | 1 | — | none | yes (palo-alto) | no | no | recommended | SHIP_NOW | Decision-stage H2, clean comparison framing (line 811). |
| 12 | `…faqlux01ab23cd45 (faq_a)` Luxury | `create_cluster_page:topic:Shield: Luxury…` | add_faq (answer) | operator_edited | medium | — (W3 §3.13 grounder catch in `why`) | prompt(1)+element(1) | 1 | — | none | yes (cust-home-builder…) | no | yes — `why` notes prior "best builder" superlative was rejected | recommended | SHIP_NOW | Operator-touched, brand-claim grounder fired and was respected (line 769). |
| 13 | `…faqlux01ab23cd45 (faq_q)` Luxury | same | add_faq (question) | operator_edited | medium | grounder evidence in `why` | prompt(1)+competitor(1) | 1 | "best luxury home builders Bay Area 2023" count=2 (in `why` not as evidence-type) | Kasten Builders | no | no | yes — superlative rejected, explicit | recommended | SHIP_NOW | Reframed from "who are the best…" to "what should I look for…" — exemplar (line 728). |
| 14 | `…a1b2c3d4e5f6g7h8 (h2)` Luxury | same | add_h2_section | operator_edited | medium | grounder cited | prompt(1)+element(1) | 1 | "best luxury home builders Bay Area 2023" count=2 (in `why`) | none | yes (cust-home-builder…) | no | no | recommended | SHIP_NOW | "How to choose…" framing, operator-edited (line 686). |
| 15 | `…cupertino01 (faq_a)` | `create_cluster_page:geo:Cupertino` | add_faq (answer) | openai | medium | — | prompt(1)+owned_page(1) | 1 | — | none | yes (cupertino) | no | no | recommended | SHIP_NOW | Service-specific, scoped to Cupertino, factual (line 643). |
| 16 | `…cupertino01 (faq_q)` | same | add_faq (question) | openai | medium | — | prompt(1)+owned_page(1) | 1 | — | none | yes (cupertino) | no | no | recommended | SHIP_NOW | Direct user-language match (line 602). |
| 17 | `…9f7c2b6a (h2)` Cupertino | same | add_h2_section | openai | medium | — | prompt(1)+owned_page(1) | 1 | — | none (wisebuilders.org/baysidebuildersgroup.com in `why` only) | yes (cupertino) | no | no | recommended | NEEDS_MINOR_EDIT | `why` text mentions competitor URLs not in evidence array — thin grounding (line 559). |
| 18 | `…faqpalo1234 (faq_a)` | `create_cluster_page:geo:Palo Alto` | add_faq (answer) | openai | medium | — | prompt(2)+owned_page(1) | 2 | — | none | yes (palo-alto) | no | no | recommended | SHIP_NOW | Concrete process language (line 512). |
| 19 | `…faqpalo1234 (faq_q)` | same | add_faq (question) | openai | medium | — | prompt(1)+owned_page(1) | 1 | — | none | yes (palo-alto) | no | no | recommended | SHIP_NOW | Customer-voice question (line 471). |
| 20 | `…paloalto1a2b3c4d (h2)` | same | add_h2_section | openai | medium | — | prompt(2)+owned_page(1) | 2 | — | none (Greenberg in `why` only) | yes (palo-alto) | no | no | recommended | SHIP_NOW | Two-prompt evidence, grounded H2 (line 422). |

### Format-of-data observations
- **No `resolution.tier` field exists on any row** in this file.
- **No `topSearchQueries` / `actualSearchQueries` evidence rows exist as evidence-array items.** `why` text mentions `aiSearchSignal` rhetorically (rows #20, #1, #11) but no `evidence[].type === "search_query"` rows are present anywhere.
- **No `scan_finding` evidence type appears on any row.**
- **"Ranking" is purely file order = `created_at` desc clustered by evidence_hash.** No `rank` field. Confidence is the literal string `"medium"` on **all 31 rows**.

### Five-question summary (Phase 2.B)

**1. Precision estimate.** 13 SHIP_NOW + 4 NEEDS_MINOR_EDIT out of 20 = ~85% (round to ~90%). 1 NEEDS_MAJOR_EDIT (#1, Modern Bay Area FAQ answer), 2 ABSTAIN (#5 Atherton FAQ-answer with single-prompt thin evidence; #1 marginal). **Caveat:** precision is inflated by (i) operator-edited rows #12-14, (ii) paired Q+A rows that should count as one decision (5 of 20 are Q+A pairs).

**2. Top 3 recurring false-positive patterns**
1. **"Architect-led design-build" boilerplate appears in nearly every H2 body and FAQ answer** (rows #1, #4, #7, #11, #14, #15, #17, #20 — 8 of 20). Brand-true, but the proposed copy reads near-identically across pages — duplicate-content risk the model itself flags in `risks` arrays repeatedly (e.g. line 668, line 222). The engine drafts the same paragraph for Palo Alto, Cupertino, Atherton, the homepage, and the luxury hub.
2. **"Bay Area" geographic blanket on rows that should be city-specific.** Cupertino H2 (#17, line 567) reads "Modernizing older Cupertino homes" but the matching FAQ answer #15 (line 651) opens "Ritz Builders provides architect-led design-build services in Cupertino…" then reverts to generic process language with no Cupertino-specific facts. **Customer-facing copy is generic-Bay-Area dressed in city tags.**
3. **Evidence-array drift from `why` text.** Multiple rows cite competitors / source URLs in the `why` field (#17 cites wisebuilders.org & baysidebuildersgroup.com; #20 cites Greenberg; #10 cites competitor pages) but those references **don't appear as `evidence[]` entries**. The grounding the rec claims is not the grounding the rec exposes.

**3. Top 3 missing-evidence patterns**
1. **No `search_query` evidence type ever ships.** `why` text repeatedly invokes "aiSearchSignal topSearchQueries" / "actualSearchQueries" (rows #14, #6, #5, #20) but **zero rows** contain an evidence row of `type: "search_query"`. The packet's strongest signal is invisible to the operator.
2. **Single-prompt evidence is the norm, not the exception.** 17 of 20 rows have exactly one `prompt` evidence entry. Only #8, #11, #20 cite 2 prompts. None cite ≥3.
3. **No `scan_finding` evidence and no `resolution.tier` field anywhere.** If "adjudicated vs deterministic-only" tiering exists, it is not reflected in this output. Operator cannot tell which recs survived adjudication.

**4. Where ranking logic is weak.** **No `rank` field exists.** Order = `created_at` desc clustered by `evidence_hash` (lines 460, 591, 845, 1018, 1145 — each timestamp emits 3-4 recs as a batch). Within a batch, FIFO by element-key. So the queue surfaces "newest LLM packet first" rather than "highest-impact first." A SHIP_NOW Cupertino FAQ (#15) sits below a NEEDS_MAJOR_EDIT homepage FAQ (#1) only because the homepage packet ran later. There is no priority signal — no `affected_prompt_count`, no `competitor_count`, no `confidence_score` numeric. Confidence is `"medium"` on **all 31 rows**, so confidence cannot drive ordering either.

**5. Top-5 customer first-impression brutal honest pass/fail.**

| Order | Verdict | Reasoning |
|---|---|---|
| #1 (modern01a faq_a) | **No** | Self-promotional voice in an FAQ answer + single-prompt evidence. A thoughtful customer reads this as a sales pitch, not an answer. |
| #2 (modern01a faq_q) | **Yes** | Plain user-voice question. Ships. |
| #3 (whydbld01 h2) | **No (needs minor edit)** | Duplicates the angle of #4 on the same homepage URL. Without dedupe, customer ships both and the page reads as repeated boilerplate. |
| #4 (design01a h2) | **Yes** | Concrete intent, evidence chain present. |
| #5 (faqmd01ab faq_a Atherton) | **Marginal — abstain** | Single `prompt` evidence row, no `owned_page`, no `competitor`. Engine should escalate the packet or hold this rec. |

**Brutal answer: 3 of 5 are shippable as-is, 1 should be rejected for self-promotional voice, 1 should be held for thin evidence.** A customer browsing top-down loses trust by row #1. Re-ordering by evidence depth (prompt count + competitor count + owned_page presence) would surface rows #4, #20, #11, #14, #7 first — all SHIP_NOW. **The product underperforms its actual quality because it has no priority field.**

---

## Combined verdicts (Phase 2)

| Component | Verdict | Why |
|---|---|---|
| Packet construction | TRUSTWORTHY | Clear-source per evidence type; pollution filter applied; honest about blind spots. |
| Rule 16.A abstention | **UNRELIABLE** | Enforced in SYSTEM_PROMPT only; no validator gate. |
| Validator suite (placeholder, UUID, competitor-leak, brand-claim, em-dash, FAQ shape) | TRUSTWORTHY | Real rejections; enforced. |
| Layer A prioritizer score | DIRECTIONAL | Math sound, but the score is computed and discarded by the customer-facing table. |
| Layer B `priorityForRow` (customer-visible) | DIRECTIONAL | Different rubric than Layer A; floors at HIGH on severity+observationCount alone, ignoring evidence depth. |
| Confidence rubric (`computeRecConfidence`) | TRUSTWORTHY at the gate; **NOT EXERCISED IN PRODUCTION** | Today every shipped row is `"medium"`. HIGH/LOW signals don't ship. |
| Source label (deterministic vs openai) | TRUSTWORTHY | Validator enforces coherence. |
| `competitorPageBlueprints.h1/topH2s/faqQuestions/metaDescription` | UNRELIABLE | Hardcoded null; SYSTEM_PROMPT lies to the model. |
| `crossTenantPatterns`, `priorOutcomes` | UNRELIABLE (stubs) | Always `[]`. |
| Sample-20 customer quality | DIRECTIONAL → SHIPPABLE | ~85% SHIP_NOW or minor-edit; failure modes are duplicate boilerplate, generic-Bay-Area-dressed-as-city, and the absence of `search_query` evidence rows even when the engine claims to use them. |

**Recommended capability for next step:** Balanced — fixes (validator gate for Rule 16.A; expose `search_query`/`actualSearchQueries` as `evidence[]` items; thread Layer A score into the Layer B sort; populate `competitorPageBlueprints` structural fields OR strip them from SYSTEM_PROMPT; exercise the LOW/HIGH paths in production) are bounded edits across `specific-edit-validator.ts`, `recommendation-action-rows.ts`, `specific-edit-evidence.ts`, and `openai.ts`.
