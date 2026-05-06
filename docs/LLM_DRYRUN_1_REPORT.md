# LLM-DryRun-1 Report

**Date:** 2026-05-05
**Operator:** Armeen
**Mode:** Controlled, dry-run only — `openaiProvider.generate()` direct, no persistence
**Harness:** `scripts/llm-specific-edit-dryrun.ts` (renamed from `scripts/llm-dryrun-1.ts` during the LLM-DryRun-2 follow-up so the harness is reusable across future iterations; pinned dry-run-only by `tests/architecture/llm-dryrun-harness-no-persistence.test.ts`)
**Follow-up:** see [`LLM_DRYRUN_2_REPORT.md`](./LLM_DRYRUN_2_REPORT.md) for the post-fix re-run.
**Provider:** `gpt-5-mini` (Beacon's `DEFAULT_OPENAI_MODEL`)
**Tenant:** `tenant-ritz-founder`
**Total cost:** **$0.0607** (cap was $3.00)
**Samples generated:** 5 / 5
**Process exit code:** 2 (guardrail flags fired — see Findings)

---

## TL;DR

| | |
|---|---|
| **Verdict** | **B + C — needs prompt tightening AND validator tightening before live regeneration.** |
| Real, useful copy on **3 of 5** samples (Palo Alto + Los Altos + most of Bay-Area teardown hub). |
| **2 critical safety gaps** uncovered: (a) raw prompt UUIDs leak into `why` text on 7 of 17 edits across 2 samples; the validator does not reject these (render-time sanitizer scrubs them, but save-time persistence carries the raw IDs). (b) Weak-evidence packet (1 affected prompt, low confidence, inventory tier) did **not** trigger the abstain branch — the LLM generated 3 edits anyway. |
| **1 fabricated-claim risk:** Sample 1 emitted "*roughly 12 to 18 months for construction*" — a specific timeline promise the operator did not authorize. Operator brief explicitly forbids fabricated timelines. |
| **Validator caught two REAL bugs cleanly:** unpaired FAQ question (no matching answer row), and a competitor name not in the packet's allowed list. ✓ |
| **No placeholder copy. No "Draft answer". No "operator rewrite". No competitor names in any operator-visible `proposedText`.** Those guardrails held. |

**Do NOT enable live regeneration yet.** Tighten prompt + validator (proposals at the bottom of this report), re-run the dry-run, then revisit.

---

## Slot selection — 5 of 5 matched

| # | Slot | Candidate stableKey | Action | Confidence | Tier | Rationale |
|---|---|---|---|---|---|---|
| 1 | `create_page` | `target_competitors:prompt:e17d29c3-…692b36` | `create_new_page` | medium | observation | `resolution.action === "create_new_page"` |
| 2 | `h2_or_faq` | `create_cluster_page:geo:Palo Alto` | `expand_existing_page` | medium | observation | `resolution.action === "expand_existing_page"` |
| 3 | `schema_or_technical` | `create_cluster_page:geo:Atherton` | `expand_existing_page` | medium | observation | Picked heuristically as a "natural schema candidate" — but the resolver did NOT classify this as a schema/technical recommendation. **Honest finding: the rec engine doesn't currently surface schema/technical action types in the queue. The LLM emitted H2 + FAQ edits instead.** |
| 4 | `location_geo` | `create_cluster_page:geo:Los Altos` | `needs_review` | low | inventory | `clusterKind === "geo"` |
| 5 | `weak_evidence` | `create_single:prompt:46921ecd-…b9bae` | `expand_existing_page` | low | inventory | `affectedPromptIds=1, tier=inventory, confidence=low` — should have triggered abstain |

**No padding.** All 5 slots were filled honestly from the 13 candidates in the live queue.

---

## Per-sample report

### Sample 1 — `create_page` (Bay-Area teardown / rebuild hub)

| Field | Value |
|---|---|
| Source rec | `target_competitors:prompt:e17d29c3-eab3-4278-a3ea-4bd175692b36` |
| Action | `create_new_page` (motive: counter_competitor) |
| Target URL | `needs_new_page` (LLM steered to `https://ritzbuilders.com/custom-home-builder-bay-area` — an existing hub) |
| Evidence summary | 1 affected prompt, 8 owned page candidates, 5 competitors, 10 aiSearchSignal queries, 5 competitor blueprints |
| Bundle cost | $0.0135 (6 edits) |
| Validator | accepted=4, **rejected=2**, bundleErrors=1 |
| Guardrail flags | **4 UUID_LEAK in `why` text** |

**Validator rejected (caught 2 real issues cleanly):**

1. `add_faq` / `targetElement.elementKey` / `unpaired FAQ question (faq_question[new]:fdb3a9c1) — every FAQ question must ship with a matching faq_answer[new]:fdb3a9c1 answer row in the same bundle.` — LLM emitted FAQ Q without paired A. **Validator did its job.** ✓
2. `add_faq` / `evidence[1]` / `competitor ref unknown name "Valley Boutique Builders"` — LLM cited a competitor in evidence that wasn't in the packet's `competitorAngles` (the entity-pollution-filter excluded it for low frequency). **Validator did its job.** ✓

**Generated edits + scores:**

| # | actionType | proposedText (excerpt) | Score | Why |
|---|---|---|---|---|
| 1 | add_h2_section | "Replacing an older house with a modern custom home in the Bay Area\n\nRitz Builders explains how a teardown and rebuild works…" | **minor edit** | Useful, mentions Bay Area, no fabricated specifics. Slightly verbose. |
| 2 | add_h2_section | "Teardown feasibility and Bay Area permitting considerations\n\nRitz Builders recommends an early feasibility study to evaluate structural conditions, geotech constraints, setback and zoning limits…" | **minor edit** | Concrete, plausible. Geotech/setback/zoning are real Bay Area concerns. |
| 3 | add_faq | "Can I tear down an old house in the Bay Area and build a modern custom home?" | _rejected_ | Unpaired Q (validator rejected) |
| 4 | add_faq | "Ritz Builders evaluates teardown feasibility as the first step. We assess site constraints including geotechnical and seismic issues, setbacks and zoning, protected trees and utilities…" | **ship-as-is** | Properly hedged ("evaluates", "if feasible"), accurate site-constraint list. |
| 5 | add_faq | "How long does replacing an older house with a custom modern home take in the Bay Area?" | _rejected_ | Unpaired Q (validator rejected) |
| 6 | add_faq | "Ritz Builders notes timelines vary by site complexity, scope, and permitting requirements. Many teardown and rebuild projects require several months for design and entitlements plus **roughly 12 to 18 months for construction**…" | **MAJOR EDIT or REJECT** | **Fabricated timeline claim.** "12 to 18 months for construction" is a specific number not grounded in any evidence the operator approved. Operator brief: "no fabricated awards, claims, process details, costs, guarantees, or timeline promises." |

**4 raw prompt UUIDs in `why` text** (e.g., `Top aiSearchSignal queries and the outranking prompt (e17d29c3-eab3-4278-a3ea-4bd175692b36)…`). Render-time sanitizer (M2) strips these; save-time persistence does not.

---

### Sample 2 — `h2_or_faq` (Palo Alto)

| Field | Value |
|---|---|
| Source rec | `create_cluster_page:geo:Palo Alto` |
| Action | `expand_existing_page` (capture_absent_cluster) |
| Target URL | `https://ritzbuilders.com/locations/palo-alto` |
| Evidence | 5 prompts, 4 pages, 7 competitors, 10 aiSearchSignal queries, 5 blueprints |
| Bundle cost | $0.0125 (4 edits) |
| Validator | accepted=4, rejected=0 |
| Guardrail flags | **0** ✓ |

**Generated edits + scores:**

| # | actionType | proposedText (excerpt) | Score |
|---|---|---|---|
| 1 | add_h2_section | "Design-build firm vs architect and contractor in Palo Alto\n\nRitz Builders explains when a design-build firm is the right choice for Palo Alto projects and when separate architect and contractor teams may be a better fit…" | **ship-as-is** |
| 2 | add_h2_section | "Building custom homes with underground basements in Palo Alto\n\nRitz Builders outlines the key challenges and risk mitigations for underground basements on Palo Alto lots. Our team prioritizes early feasibility studies, structural engineering coordination, and permitting strategy…" | **ship-as-is** |
| 3 | add_faq | "Should I hire a design-build firm or an architect and contractor separately in Palo Alto?" | **ship-as-is** |
| 4 | add_faq | "Ritz Builders recommends choosing based on project complexity and owner priorities. For constrained Palo Alto lots or projects that need tight coordination between design, permitting, and construction, a design-build approach reduces handoffs and aligns budget with buildability. If you prefer an independent architect for design oversight, we can partner with owner-selected architects while managing construction to preserve design intent and schedule." | **ship-as-is** |

**Best sample of the run.** 4 paired edits (H2 + FAQ Q+A), grounded in actual search queries, no fabricated specifics, properly hedged language ("Some owners prefer…", "we can partner…"), no UUIDs leaked into copy.

---

### Sample 3 — `schema_or_technical` (Atherton, but the rec engine didn't surface a schema action)

| Field | Value |
|---|---|
| Source rec | `create_cluster_page:geo:Atherton` |
| Action | `expand_existing_page` (capture_absent_cluster) |
| Target URL | `https://ritzbuilders.com/locations/atherton` |
| Evidence | 3 prompts, 1 page, 5 competitors, 10 aiSearchSignal queries, 5 blueprints |
| Bundle cost | $0.0120 (3 edits) |
| Validator | accepted=3, rejected=0 |
| Guardrail flags | **3 UUID_LEAK in `why` text** |

**Honest scope finding:** the rec engine does NOT currently emit `add_schema` / `fix_schema` recommendations in the live queue. My harness picked the most "natural" schema candidate (a /locations page that could carry LocalBusiness JSON-LD), but the LLM emitted H2 + FAQ edits — because that's what the packet's `allowedActionTypes` permitted. **Schema/technical edits are out of scope for the current generator.** Either the packet builder needs to widen `allowedActionTypes`, or schema-parity recs need to flow through a different path (existing `schema-parity-actions.ts` is deterministic-only).

**Generated edits + scores:**

| # | actionType | proposedText (excerpt) | Score |
|---|---|---|---|
| 1 | add_h2_section | "Modernizing older homes in Atherton without expanding the footprint\n\nRitz Builders emphasizes an architect-led design-build approach for modernizing older homes in Atherton without changing the home's footprint. Our team focuses on interior reconfiguration, upgraded mechanical and electrical systems, improved insulation and windows, and targeted exterior refreshes…" | **minor edit** |
| 2 | add_faq | "Can I modernize an older home in Atherton without expanding the footprint?" | **ship-as-is** |
| 3 | add_faq | "Ritz Builders can modernize an older home in Atherton without expanding the footprint by prioritizing interior reconfiguration, systems upgrades, and targeted structural work. We coordinate with architects and engineers to assess feasibility, optimize existing floor area usage, and handle permitting so improvements meet local zoning and floor area ratio rules while improving livability and energy performance." | **ship-as-is** |

Operator-locked Atherton has FAR (floor area ratio) restrictions; the LLM correctly mentioned them. Useful, accurate.

**3 raw prompt UUIDs leaked** (`b741f295-2535-4027-95d6-8edbed7ee4e9`).

---

### Sample 4 — `location_geo` (Los Altos)

| Field | Value |
|---|---|
| Source rec | `create_cluster_page:geo:Los Altos` |
| Action | `needs_review` (counter_competitor) |
| Target URL | `https://ritzbuilders.com/locations/los-altos` |
| Evidence | 3 prompts, 3 pages, 5 competitors, 10 aiSearchSignal queries, 5 blueprints |
| Bundle cost | $0.0116 (4 edits) |
| Validator | accepted=4, rejected=0 |
| Guardrail flags | **0** ✓ |

**Generated edits + scores:**

| # | actionType | proposedText (excerpt) | Score |
|---|---|---|---|
| 1 | add_h2_section | "Major structural home renovations in Los Altos\n\nRitz Builders emphasizes an architect-led design-build approach for major structural renovations in Los Altos. Our team coordinates structural engineering, foundation and seismic upgrades, and permitting strategy early so designs remain buildable and budget risks are reduced during construction." | **ship-as-is** |
| 2 | add_h2_section | "Modernizing older Los Altos homes without expanding the footprint\n\nRitz Builders emphasizes an architect-led design-build approach when modernizing older Los Altos homes while preserving the existing footprint. Our team focuses on interior reconfiguration, system upgrades, insulation and window improvements, and detailed permitting…" | **ship-as-is** |
| 3 | add_faq | "Should I hire a design-build firm or hire an architect and a separate contractor for a custom home in Los Altos?" | **ship-as-is** |
| 4 | add_faq | "Ritz Builders offers an architect-led design-build model that keeps design, engineering, permitting, and construction coordinated from the start. For complex Los Altos projects this approach can reduce rework and streamline approvals by aligning structural and permitting needs early. Some owners prefer a separate architect and contractor for distinct design control or competitive bidding; we can also collaborate with an owner's architect when clients request that path." | **ship-as-is** |

**Note on edit 1's `why` text:** "the AI's tendency to cite local competitors (Bayside Builders Group)". Competitor name appears in `why` — that's evidence-only and operator-visible only via the drawer expansion (already routed through the M2 sanitizer). **Not a leak** — operator brief said "no competitor names in **public** Ritz copy" and `proposedText` is clean.

---

### Sample 5 — `weak_evidence` (Menlo Park, single-prompt low-confidence) — **should have abstained**

| Field | Value |
|---|---|
| Source rec | `create_single:prompt:46921ecd-5a18-435c-83db-eff1a09b9bae` |
| Action | `expand_existing_page` (counter_competitor) |
| Target URL | `https://ritzbuilders.com/locations/menlo-park` |
| Evidence | **1 affected prompt**, 8 pages, 2 competitors, 10 aiSearchSignal queries, 5 blueprints |
| Resolution | confidence=`low`, tier=`inventory` |
| Bundle cost | $0.0110 (3 edits) |
| Validator | accepted=3, rejected=0 |
| Guardrail flags | **0** (but should have abstained) |

**Critical finding:** the operator's `BUDGET / abstain` system-prompt rule says "If you have no honest output for this packet, return an empty recommendations array. It is better to return [] than to invent." With just **1 affected prompt** + **low confidence** + **inventory tier** (not even adjudicated), the LLM should have abstained. Instead it generated 3 generic edits.

**Generated edits + scores:**

| # | actionType | proposedText (excerpt) | Score |
|---|---|---|---|
| 1 | add_h2_section | "Architect-designed custom homes in Menlo Park\n\nRitz Builders emphasizes an architect-led design-build approach for custom homes in Menlo Park…" | **should have abstained** (generic, not differentiated) |
| 2 | add_faq | "Who builds architect-designed custom homes in Menlo Park?" | **should have abstained** |
| 3 | add_faq | "Ritz Builders works on architect-designed custom homes in Menlo Park, coordinating directly with architects from feasibility through construction…" | **should have abstained** |

The output isn't BAD copy — but the underlying premise is "1 prompt asking 'who builds…' is enough to justify 3 page edits." That's the over-eagerness pattern the operator is worried about. **The system prompt's abstain rule is in place but the LLM doesn't fire it on this packet shape.**

---

## Aggregate scores

| Slot | Edits emitted | Validator-accepted | Validator-rejected | Guardrail flags | Quality breakdown |
|---|---|---|---|---|---|
| 1. create_page | 6 | 4 | 2 | 4 (UUID leak) | 1 ship-as-is, 2 minor edit, 1 **MAJOR** (fabricated timeline), 2 rejected |
| 2. h2_or_faq | 4 | 4 | 0 | 0 | 4 ship-as-is |
| 3. schema_or_technical | 3 | 3 | 0 | 3 (UUID leak) | 2 ship-as-is, 1 minor edit |
| 4. location_geo | 4 | 4 | 0 | 0 | 4 ship-as-is |
| 5. weak_evidence | 3 | 3 | 0 | 0 | 3 **should have abstained** |
| **Total** | **20** | **18** | **2** | **7** | **11 ship-as-is**, **3 minor edit**, **1 major edit (timeline)**, **3 should have abstained**, **2 rejected** |

---

## Guardrails — pass/fail summary

| Guardrail | Status | Notes |
|---|---|---|
| No placeholder copy | ✅ **PASS** | Zero "Draft answer" / "TBD" / "[insert" / "operator: rewrite" in any proposed_text. |
| No `Draft answer` literal | ✅ **PASS** | |
| No `operator rewrite` literal | ✅ **PASS** | |
| No raw prompt IDs in operator-VISIBLE proposedText | ✅ **PASS** | All 18 accepted edits' proposed_text were UUID-free. |
| No raw prompt UUIDs in **`why` text** | ❌ **FAIL** | **7 of 17 generated edits** carried raw prompt UUIDs in `why` (Samples 1 and 3). Render-time sanitizer scrubs them but save-time persistence does not. |
| No generic SEO fluff ("first-class", "premier", "trusted") | ✅ **PASS** | Copy was process-focused, not adjective-marketing. |
| No unsupported claims like "Ritz is frequently recommended" | ✅ **PASS** | Every claim attributed to "our team", "we", "Ritz Builders" verb-action ("evaluates", "coordinates", "explains"). |
| No competitor names in Ritz public copy | ✅ **PASS** | Sample 4 mentioned "Bayside Builders Group" in `why` but NOT in proposedText. |
| No fabricated awards | ✅ **PASS** | |
| No fabricated process details | ⚠ **PARTIAL** | Sample 1 mentioned "geotechnical and seismic issues, setbacks and zoning, protected trees" — these are real Bay Area concerns; OK. |
| **No fabricated timeline promises** | ❌ **FAIL** | Sample 1 emitted "**roughly 12 to 18 months for construction**" — a specific numeric timeline that the operator did not authorize. |
| No fabricated guarantees | ✅ **PASS** | Hedged language ("can", "may", "if feasible"). |
| Exact copy usable for H2/meta/FAQ | ✅ **PASS** | All accepted edits had paired Q+A or named element keys; copy was site-ready. |
| Abstain on thin evidence | ❌ **FAIL** | Sample 5 (1 prompt, low confidence) should have returned `[]`. |
| Validator catches unpaired FAQ | ✅ **PASS** | Sample 1 unpaired Q rejected. |
| Validator catches competitor name not in packet | ✅ **PASS** | Sample 1 evidence ref rejected. |

---

## Cost report

| Slot | Bundle cost | Cumulative |
|---|---|---|
| 1 (create_page) | $0.0135 | $0.0135 |
| 2 (Palo Alto) | $0.0125 | $0.0260 |
| 3 (Atherton) | $0.0120 | $0.0380 |
| 4 (Los Altos) | $0.0116 | $0.0497 |
| 5 (Menlo Park) | $0.0110 | $0.0607 |

**Total: $0.0607.** Cap was $3.00. Plenty of headroom for follow-up runs.

---

## Required fixes before live regeneration

### Prompt tightening (P0 — blocking)

1. **Make UUID-citation in `why` field a HARD RULE.** Current SYSTEM_PROMPT says "NEVER quote raw prompt UUIDs in the 'why'" but the LLM still emits them. Tighten by adding a structural example near the bottom (the LLM weights structural examples heavily):

   ```
   ❌ BAD:  "why": "Drawn from actualSearchQueries on the prompt b741f295-2535-4027-95d6-8edbed7ee4e9..."
   ✅ GOOD: "why": "Drawn from actualSearchQueries on the 'builders in Atherton for modernizing older home' prompt..."
   ```

2. **Strengthen the abstain rule.** Add to SYSTEM_PROMPT:

   > **Abstain by default when:**
   > - `affectedPrompts.length === 1` AND no `aiSearchSignal.topSearchQueries` AND no operator-curated `brandAssertions`
   > - resolution `confidence === "low"` AND no operator-curated `brandAssertions`
   > - the packet's `competitorPageBlueprints` are empty AND `aiSearchSignal.topSearchQueries` are empty
   >
   > Returning `[]` is a CORRECT answer for thin packets. Generating generic copy on a thin packet is a FAILURE.

3. **Forbid specific numeric timelines and costs unless evidenced.** Sample 1's "12 to 18 months" came from nowhere. Add:

   > **Never emit specific durations (months/days/weeks), specific costs (dollars / per sq ft), or specific guarantees ("on time", "under budget") unless `brandAssertions` includes them VERBATIM. If you can't say it without a number, hedge with "varies by site complexity" / "depends on permitting".**

### Validator tightening (P0 — blocking)

4. **Reject any edit whose `why` text contains a UUID-shaped substring.** Add to `validateSpecificEditBundle`:
   - Use the existing `containsUuid()` predicate from `copy-sanitize.ts`
   - When fired on `edit.why`, return `{ ok: false, field: "why", reason: "raw prompt UUID in why text — cite the prompt by short snippet, not by ID" }`
   - Pin via architecture invariant: `tests/architecture/no-uuid-in-active-recs.test.ts` already pins ship-as-is fields; extend it to `why` for openai-sourced rows.

5. **Optional: validate that fabricated timeline / cost claims match brand-assertions.** This is harder (requires a phrase-match heuristic). Defer to v2 of the validator; keep #3 (prompt-side) as the primary defense.

### Scope finding (not a fix, but a flag)

6. **The rec engine does NOT currently emit `add_schema` / `fix_schema` action types.** Slot 3 was a forced fit. If the operator wants schema/technical edits in the live LLM output, the packet builder needs to widen `allowedActionTypes` for recs whose target page lacks LocalBusiness/FAQPage/BreadcrumbList JSON-LD. Existing `schema-parity-actions.ts` is deterministic-only and runs separately. Decision: **out of scope for live regeneration — schema edits stay deterministic until/unless the operator explicitly scopes the LLM path for them.**

---

## Final go/no-go

**B + C — needs prompt tightening AND validator tightening before live regeneration.**

Both are surgical, narrow fixes (prompt tweaks + one validator rule + one architecture invariant). Estimated work: a single bundle of 4-5 small edits.

**Not D (not ready)** — because the engine clearly DOES produce ship-quality copy on healthy packets (Samples 2 + 4 were excellent end-to-end). The math is right; the math just needs three guardrails added before unattended generation.

**Not A (safe today)** — because Sample 1's fabricated timeline + 7 UUID leaks + Sample 5's failure-to-abstain are not acceptable on a customer-facing surface.

After fixes land + a second dry-run shows zero UUID leaks + zero fabricated specifics + abstain on Sample 5's packet shape, **then** A.

---

## Constraints respected

- ✅ No persisted changes (provider.generate-only path; no `runProviderAndPersist`, no `writeStore`, no `syncRecommendedEdits`)
- ✅ No queue mutation
- ✅ No Supabase writes
- ✅ No `.data` writes (apart from `tmp/llm-dryrun-1-output.json` for this report — outside the canonical store)
- ✅ Budget cap respected — $0.0607 of $3.00
- ✅ No code changes to product behavior — added `scripts/llm-dryrun-1.ts` harness only (untracked unless explicitly committed)
- ✅ No paid OpenAI generation outside this dry-run
- ✅ No Apply-All-HIGH
- ✅ No backfill, onboarding, Profound archive

## Files

- `scripts/llm-dryrun-1.ts` — the harness (NEW; not yet committed; can be deleted, kept as a tool, or formalized)
- `tmp/llm-dryrun-1-output.json` — structured output for this report (NEW; gitignored)
- `tmp/llm-dryrun-1-stdout.log` — full stdout transcript (NEW; gitignored)
- `docs/LLM_DRYRUN_1_REPORT.md` — this report (NEW; intended as a permanent record)
