# Recommendation Intelligence Audit

> **Slice 4.5.A — registry audit + activation plan (2026-05-19)**
> **Slice 4.5.B.α₀ — first activation: registry expansion + 2 metadata
> predicates + operator diagnostic shell (2026-05-19)**
>
> Canonical source-of-truth document for the Section 4.5 Recommendation
> Intelligence Expansion roadmap. Documented operator-approved
> exception to the "no new docs" rule (Decision Lock O10) because
> subsequent slices (4.5.B–4.5.G) each reference this document as the
> single source-of-truth for the action-type registry expansion plan +
> activation order.
>
> **Current state (post-4.5.B.α₀)**: registry expanded to 32 action
> types; 4 active (`edit_title`, `edit_meta`, `add_h2_section`,
> `add_faq`). 2 deterministic trigger predicates landed
> (`missing-title`, `missing-meta`). Operator-only diagnostic page
> live at `/diagnostics/recommendation-triggers`. Customer queue
> UNCHANGED (no `recommended_edits` write paths added; no surface
> changes outside the operator diagnostic).
>
> **Slice 4.5.B.α split (2026-05-19)**: the master-plan §4.5.20 4.5.B
> prompt was internally inconsistent — it proposed 5 `generatorActive`
> flips with only metadata/H1 predicates, which would violate the
> `recommendation-intelligence-no-llm-decides` invariant on day 1.
> Per operator decision (2026-05-19), 4.5.B.α is sub-split:
>
> - **α₀ (this slice — SHIPPED)**: registry expansion + emitter
>   foundation + `missing-title` + `missing-meta` predicates +
>   operator-only diagnostic page. Flipped: `edit_meta`. New (inactive):
>   `update_intro`, `add_h3_section`, `add_image_alt_text`.
> - **α₁ (next)**: H1 predicates (`missing-h1`, `weak-h1`,
>   `title-h1-mismatch`). Flips: `change_h1`.
> - **α₂ (after α₁)**: cross-snapshot duplicate predicates
>   (`duplicate-title`, `duplicate-meta`). No new flips.
>
> **Locked by**: O1–O12 decisions in
> `~/.claude/plans/enter-maximum-depth-planning-mode-twinkly-balloon.md`
> §4.5 Decision Lock (2026-05-18) + sub-split decision 2026-05-19.

---

## A. Current registry inventory

Total (post-4.5.B.α₀): **32 action types** in `ACTION_TYPES` /
`ACTION_TYPE_REGISTRY` (`src/domains/recommendations/action-types.ts`).
Pre-α₀ count was 29; α₀ added 3 inactive entries (`update_intro`,
`add_h3_section`, `add_image_alt_text`).

### Inventory by category

| # | Category | Count | Action types |
|---|---|---|---|
| 1 | On-page copy edits | 14 | `edit_title` · `edit_meta` · `change_h1` · `add_h2_section` · `rewrite_h2` · `add_faq` · `rewrite_faq` · `add_table` · `edit_table_row` · `add_answer_block` · `add_proof_section` · `add_comparison_section` · `add_cost_section` · `add_timeline_section` |
| 2 | Technical / structural | 4 | `add_internal_link` · `add_schema` · `fix_schema` · `reorder_sections` |
| 3 | Page-level lifecycle | 3 | `split_page` · `merge_pages` · `create_page` |
| 4 | Passive | 1 | `watch` |
| 5 | Slice 4.5.B.α₀ additions (registered inactive) | 3 | `update_intro` · `add_h3_section` · `add_image_alt_text` |
| 6 | Off-site authority (Section 7 C7b — LOCKED detection-only) | 7 | `claim_gbp` · `optimize_gbp_profile` · `request_gbp_reviews` · `claim_or_optimize_houzz` · `claim_or_optimize_yelp` · `submit_to_industry_directory` · `pursue_local_pr` |
| — | **TOTAL** | **32** | — |

## B. Current `generatorActive` set

**Exactly 4 action types currently have `generatorActive: true`** (post-4.5.B.α₀):

| Action type | Category | Notes |
|---|---|---|
| `edit_title` | On-page copy edits | Sprint 6A.1 substrate |
| `edit_meta` | On-page copy edits | **Flipped in Slice 4.5.B.α₀ (2026-05-19)** — paired with `missing-meta` trigger predicate |
| `add_h2_section` | On-page copy edits | Sprint 6A.1 substrate |
| `add_faq` | On-page copy edits | Sprint 6A.1 substrate |

**28 action types have `generatorActive: false`.** The OpenAI specific-
edit provider (Sprint 6A.2) can still produce any of the 24 non-off-
site inactive types when the LLM path activates per-rec — but only the
4 above have a deterministic generator (or trigger predicate) wired in
production.

The 7 off-site types are operator-locked at `generatorActive: false`
PERMANENTLY per Section 7 C7b's read-only/manual contract — Beacon
recommends off-site work, it never performs it.

The 3 α₀-added types (`update_intro`, `add_h3_section`,
`add_image_alt_text`) are registered inactive: paired predicates land
in later slices (α₁ for the H1 family does NOT cover them; α₂ does
not cover them; they flip in **Slice 4.5.C+** when their predicates
ship — and `add_image_alt_text` additionally requires an extractor
extension to surface an `images: { alt }[]` field on `PageSnapshot`).

## C. Existing inactive / underused action types

### Reachable via LLM provider when activated, but no deterministic generator (19 total)

| Action type | Category | Why inactive today | Activation slice |
|---|---|---|---|
| `edit_meta` | On-page copy | No deterministic trigger predicate yet | 4.5.B |
| `change_h1` | On-page copy | No deterministic trigger predicate yet | 4.5.B |
| `rewrite_h2` | On-page copy | LLM-assisted; needs confidence-floor calibration | 4.5.E |
| `rewrite_faq` | On-page copy | LLM-assisted; needs source-FAQ extraction confidence | 4.5.E |
| `add_table` | On-page copy | Heuristic too loose; defer | (deferred) |
| `edit_table_row` | On-page copy | Rare case; LLM-only fallback | (deferred) |
| `add_answer_block` | On-page copy | No deterministic trigger yet | 4.5.B |
| `add_proof_section` | On-page copy | No trust-gap detector yet | 4.5.D |
| `add_comparison_section` | On-page copy | No fan-out comparison detector yet | 4.5.D |
| `add_cost_section` | On-page copy | No fan-out cost detector yet | 4.5.D |
| `add_timeline_section` | On-page copy | No fan-out timeline detector yet | 4.5.D |
| `add_internal_link` | Technical | No orphan-page detector yet | 4.5.B |
| `add_schema` | Technical | No schema-coverage detector yet | 4.5.B |
| `fix_schema` | Technical | Requires schema-vs-content diff (4.5 v2 work) | 4.5.G (later) |
| `reorder_sections` | Technical | Risky structural change; needs above-fold answer pre-work | (deferred) |
| `split_page` | Page lifecycle | Page-lifecycle; high blast radius; defer | (deferred) |
| `merge_pages` | Page lifecycle | Needs cannibalization detector | 4.5.C |
| `create_page` | Page lifecycle | Needs evidence guards (case-study backfire) | 4.5.C |
| `watch` | Passive | Stays passive — Section 4.5.12 diagnostics-only threshold | (keep passive) |

### Detection-only, locked inactive permanently (7 total)

The 7 off-site action types live in the registry **for the operator
diagnostic surface only** (`/diagnostics/off-site-authority`). They
are Section 7 C7b detection-side rows that customer-side
Recommendations queue surfaces (C7c–C7e) consume. They never become
`generatorActive: true` — Beacon RECOMMENDS off-site work but never
PERFORMS it. Locked invariants:

- `generatorActive: false`
- `requiresCurrentText: false` AND `requiresProposedText: false`
- `elementTypeDomain: []`
- `signalType: "off_page_seo"`
- `changelogAssetType: "directory_profile"`

## D. Missing action types (proposed additions per O1–O5 decisions)

23 new action types proposed for Section 4.5 across slices 4.5.B–
4.5.G. Names locked by O1–O5 decisions (2026-05-18). None added in
this slice.

### Family-by-family additions

| Proposed action type | Family | Rationale | Target slice |
|---|---|---|---|
| `update_intro` | Metadata + retrieval | Distinct from `change_h1`; targets the first paragraph used for SERP snippet + AI extraction | 4.5.B |
| `add_h3_section` | H1 / heading hierarchy | Registry has H2 but not H3; AEO emphasizes H3 sub-topic coverage | 4.5.B |
| `add_image_alt_text` | Schema-adjacent + retrieval | Image-side extractable evidence | 4.5.B |
| `add_definition_block` | Retrieval coverage | Distinct from `add_answer_block`; targets extractable definitions | 4.5.D |
| `add_selection_criteria_section` | Primary recommendation gap | "When to choose us" framing | 4.5.D |
| `add_project_proof` | Proof-density | Project-specific evidence | 4.5.D |
| `add_testimonial_section` | Proof-density | Testimonial / review proof | 4.5.D |
| `add_local_proof` | Proof-density + local-service wedge | City-specific proof | 4.5.D |
| `add_trust_section` | Proof-density | Alias-keep-both with `add_proof_section` (per O2) | 4.5.D |
| `update_internal_anchor` | Internal linking | Anchor text rewrite (distinct from `add_internal_link`) | 4.5.C |
| `fix_canonical` | Indexability | Canonical-specific operator task | 4.5.C |
| `fix_robots` | Indexability | robots.txt operator task | 4.5.C |
| `fix_noindex` | Indexability | meta robots noindex on important page | 4.5.C |
| `fix_sitemap` | Indexability | XML sitemap operator task | 4.5.C |
| `fix_status_code` | Indexability | 4xx/5xx on important URL | 4.5.C |
| `fix_redirect_chain` | Indexability | Operator task | 4.5.C |
| `fix_orphan_page` | Internal linking | Adds inbound internal links (distinct trigger from `add_internal_link`) | 4.5.C |
| `create_city_page` | New page (typed) | Sub-typed variant per O1 (6 typed creators) | 4.5.C |
| `create_city_service_page` | New page (typed) | Sub-typed per O1 | 4.5.C |
| `create_service_page` | New page (typed) | Sub-typed per O1 | 4.5.C |
| `create_comparison_page` | New page (typed) | Sub-typed per O1 | 4.5.C |
| `create_project_page` | New page (typed) | Sub-typed per O1 | 4.5.C |
| `create_guide_page` | New page (typed) | Sub-typed per O1 | 4.5.C |
| `refresh_stale_page` | Freshness / decay | Operator + LLM-assisted refresh | 4.5.D |
| `resolve_cannibalization` | Cannibalization | Wrapper for merge / canonical / internal-link triage | 4.5.C |
| `clarify_page_intent` | Cannibalization + retrieval | Reassigns query→URL when AI/GSC cite wrong URL | 4.5.C |
| `safety_cleanup` | Safety / cleanup | Single action type with structured `task_instructions` per O5 | 4.5.G |

### Decision-lock cross-references

- **O1** — Page-creation typing → 6 typed `create_*_page` variants (locked names above).
- **O2** — Proof / trust naming → `add_trust_section` becomes preferred customer-safe family label; `add_proof_section` kept as internal alias for backward compat.
- **O3** — `update_intro` distinct from `change_h1` — YES (intro answer block is first-class).
- **O4** — Technical / indexability fix grouping → all `fix_*` carry `signalType: "technical"`.
- **O5** — `safety_cleanup` → single action type with structured `task_instructions` carrying the specific violation class.

## E. 18 recommendation families mapped to action types

Compressed from master plan §4.5.7. Each family is a coherent triage
bucket; each maps to ≥1 trigger predicate and ≥1 action type.

| # | Family | Existing action types (registered) | Missing additions | Trigger sources | Activation slice |
|---|---|---|---|---|---|
| 1 | Metadata / SERP snippet | `edit_title`, `edit_meta` | `update_intro` | `page_snapshots` (title/meta), GSC query→URL | 4.5.B |
| 2 | H1 / heading hierarchy | `change_h1`, `add_h2_section`, `rewrite_h2` | `add_h3_section` | `page_snapshots` (h1/h2_list), observation fan-out queries | 4.5.B |
| 3 | New page creation | `create_page` | 6 typed `create_*_page` variants | observations + GSC + business-config city/service | 4.5.C |
| 4 | Indexability fixes | (none) | `fix_canonical`, `fix_robots`, `fix_noindex`, `fix_sitemap`, `fix_status_code`, `fix_redirect_chain` | `owned_url_indexability` (Section 4 / Phase A.3 verdict) | 4.5.C |
| 5 | Retrieval / AI query coverage | `add_h2_section`, `add_faq`, `add_answer_block`, `add_cost_section`, `add_timeline_section`, `add_comparison_section` | `add_definition_block` | observations (fan-out queries, top descriptors) | 4.5.D |
| 6 | GSC query-to-URL | `edit_title`, `edit_meta` | `clarify_page_intent` | GSC Search Analytics (Section 4 / Phase A.3) | 4.5.C |
| 7 | Citation reinforcement | `add_proof_section`, `add_internal_link`, `add_schema` | `add_trust_section` | Section 5 repeat-citation + `daily_metric_snapshots` | 4.5.D (after Section 5 + 6) |
| 8 | Primary recommendation gap | `add_proof_section` | `add_selection_criteria_section` | Section 6 Mode A + tracked-entity competitor signals | 4.5.D (after Section 6) |
| 9 | Content expansion | `add_h2_section`, `add_faq`, `add_answer_block`, `add_comparison_section`, `add_cost_section`, `add_timeline_section`, `rewrite_h2`, `rewrite_faq` | `add_definition_block`, `add_h3_section` | observations + page_snapshots word_count | 4.5.B + 4.5.D + 4.5.E |
| 10 | Schema / structured data | `add_schema`, `fix_schema` | (none new) | `page_snapshots.schema_types`, business-config | 4.5.B (add_schema), 4.5.G (fix_schema) |
| 11 | Internal linking / architecture | `add_internal_link` | `update_internal_anchor`, `fix_orphan_page` | `page_snapshots.internal_links_*`, business-config keyPages | 4.5.B + 4.5.C |
| 12 | Freshness / decay | `watch` | `refresh_stale_page` | `daily_metric_snapshots` decay + stale page snapshot | 4.5.D |
| 13 | Cannibalization / wrong-page | `merge_pages` | `resolve_cannibalization`, `clarify_page_intent` | observations + GSC query→URL | 4.5.C |
| 14 | Proof-density / trust gaps | `add_proof_section` | `add_trust_section`, `add_project_proof`, `add_testimonial_section`, `add_local_proof` | observations (descriptor windows), business-config local proof | 4.5.D |
| 15 | Multi-provider divergence | `add_proof_section`, `add_schema`, `add_internal_link` | (none new — uses existing types) | per-platform observation discriminator | 4.5.D (after Section 6) |
| 16 | Off-site authority handoff | 7 off-site types (Section 7 C7b — LOCKED detection-only) | (none new) | `off_site_presence` (Section 7 / detection scrapers) | (Section 7 owns) |
| 17 | Conversion / UX handoff (FUTURE) | (none) | (deferred entirely — not in 4.5 scope) | GA4 / CallRail / Clarity (Section 9 + future) | (post-4.5) |
| 18 | Safety / cleanup | (none) | `safety_cleanup` | scan of existing accepted `recommended_edits.proposed_text` | 4.5.G |

## F. Deterministic vs LLM-assisted vs human-task classification

Architecture invariant 4.5.18 will enforce this split (in Slice 4.5.B
onward). Documented here for traceability.

### Deterministic (10 types — issue detection + simple templated task)

| Action type | State | Slice |
|---|---|---|
| `edit_meta` | inactive | 4.5.B |
| `add_internal_link` | inactive | 4.5.B |
| `add_schema` | inactive | 4.5.B |
| `fix_canonical` (new) | inactive | 4.5.C |
| `fix_robots` (new) | inactive | 4.5.C |
| `fix_noindex` (new) | inactive | 4.5.C |
| `fix_sitemap` (new) | inactive | 4.5.C |
| `fix_status_code` (new) | inactive | 4.5.C |
| `fix_redirect_chain` (new) | inactive | 4.5.C |
| `fix_orphan_page` (new) | inactive | 4.5.C |
| `merge_pages` | inactive | 4.5.C |
| `resolve_cannibalization` (new) | inactive | 4.5.C |
| `add_image_alt_text` (new) | inactive | 4.5.B |
| `safety_cleanup` (new) | inactive | 4.5.G |

### LLM-assisted (LLM drafts copy AFTER deterministic trigger fires)

| Action type | State | Slice |
|---|---|---|
| `edit_title` | **ACTIVE** | (already live) |
| `add_h2_section` | **ACTIVE** | (already live) |
| `add_faq` | **ACTIVE** | (already live) |
| `change_h1` | inactive | 4.5.B |
| `update_intro` (new) | inactive | 4.5.B |
| `rewrite_h2` | inactive | 4.5.E |
| `rewrite_faq` | inactive | 4.5.E |
| `add_answer_block` | inactive | 4.5.B |
| `add_definition_block` (new) | inactive | 4.5.D |
| `add_comparison_section` | inactive | 4.5.D |
| `add_cost_section` | inactive | 4.5.D |
| `add_timeline_section` | inactive | 4.5.D |
| `add_selection_criteria_section` (new) | inactive | 4.5.D |
| `add_h3_section` (new) | inactive | 4.5.B |
| `refresh_stale_page` (new) | inactive | 4.5.D |
| `clarify_page_intent` (new) | inactive | 4.5.C |
| `add_proof_section` | inactive | 4.5.D |
| `add_trust_section` (new) | inactive | 4.5.D |
| `add_project_proof` (new) | inactive | 4.5.D |
| `add_testimonial_section` (new) | inactive | 4.5.D |
| `add_local_proof` (new) | inactive | 4.5.D |

### Human-task (no `proposed_text`; carries `task_instructions`)

| Action type | State | Slice |
|---|---|---|
| 7 off-site types | LOCKED inactive | (Section 7 owns) |
| 6 typed `create_*_page` variants | inactive | 4.5.C (human-task initially; LLM-assisted in 4.5.E) |
| `split_page` | inactive | (deferred) |
| `watch` | inactive (passive) | (keep passive) |

## G. Trigger signals required per family

Compressed from master plan §4.5.13 trigger matrix. Each family
depends on one or more existing signal sources.

| Trigger signal source | Module | Families served | Available now? |
|---|---|---|---|
| `recommended_edits` + lifecycle status | `recommended-edits-persistence.ts` | ALL (dedupe + cooldown surface) | ✓ |
| `page_snapshots` (title/meta/h1/h2_list/schema_types/internal_links/etc.) | `pages/types.ts` | 1, 2, 9, 10, 11, 12 | ✓ |
| `prompt_answer_observations` (citation_urls, actualSearchQueries, descriptors) | `prompt-answer-observations/types.ts` | 5, 7, 8, 14, 15 | ✓ |
| `citation_observations` + `citation_evidence_index` | `citation-observations/*` | 7, 12 | ✓ |
| `daily_metric_snapshots` | `daily-metric-snapshots/*` | 7, 8, 12 | ✓ |
| `lifecycle_for_edit` results | `citation-lifecycle/load-lifecycle.ts` (Phase A.1) | 7, 12 | ✓ |
| `owned_url_indexability` verdicts | `indexability/*` (Section 4 / Phase A.3) | 4, 5 | ✓ |
| GSC URL Inspection + Search Analytics | `lib/connectors/gsc/*` (Section 4 + 8) | 4, 6, 13 | ✓ |
| `business-config` (services / locations / keyPages / industry) | `lib/business-config.ts` | 3, 11, 14 | ✓ |
| `off_site_presence` | `off-site-authority/*` (Section 7) | 16 | ✓ |
| `tracked_entities` (competitors) | existing table | 13, 14, 15 | ✓ (operator-only) |
| `recommendation_responses` (accept/dismiss/defer) | `product/recommendation-response-store.ts` | dedupe / cooldown / suppression | ✓ |
| **Section 5 repeat-citation results** | `citation-lifecycle/load-repeat-citation.ts` | 7 | ✓ |
| **Section 6 primary-recommendation Mode A/B** | (operator-only diagnostic) | 8, 15 | ✓ (operator) |
| **Section 9 outcome attribution (Mode A traffic)** | `outcome-attribution/*` | 17 | ✓ (customer surfaces shipped) |
| **CallRail call signals** (K2-deferred) | — | 17 | ✗ deferred |
| **GBP insights** (Section 9.3 / future) | — | 16 | ✗ deferred |

Every Section 4.5 family has at least one available signal source. NO
new connector required for Slice 4.5.B onward; everything builds on
already-shipped substrate.

## H. `proposed_text` requirements per action type

Family classification drives whether the recommendation queue row
carries a `proposed_text` (LLM-drafted publishable copy) or a
`task_instructions` (human-operator next-step description).

### Currently `requiresProposedText: true` (22 types)

All 14 on-page copy + all 4 technical/structural + the new
`update_intro` / `add_definition_block` / `add_h3_section` /
`add_selection_criteria_section` / `add_project_proof` /
`add_testimonial_section` / `add_local_proof` / `refresh_stale_page` /
`clarify_page_intent` / `add_image_alt_text` / `add_trust_section` /
`update_internal_anchor`.

These carry publishable text in the queue. Some are LLM-assisted
(per F above), some are deterministic templated tasks.

### Currently `requiresProposedText: false` (15 types)

- 3 page-lifecycle (`split_page`, `merge_pages`, `create_page`)
- 1 passive (`watch`)
- 7 off-site authority
- Plus 4 new human-task additions: `safety_cleanup` (when carrying
  `task_instructions`), the 6 typed `create_*_page` variants (until
  4.5.E adds LLM-assisted draft path).

### Locked invariants for off-site (Section 7 C7b)

- `requiresProposedText: false` PERMANENTLY
- `elementTypeDomain: []` PERMANENTLY
- `generatorActive: false` PERMANENTLY
- Act 4 Suggested Copy is SUPPRESSED for off-site action types in the
  Recommendations detail page

## I. Main queue vs diagnostics-only placement rules

Per master plan §4.5.12. A recommendation enters the customer queue
(`/recommendations` v2 + Today tile + Changes detail integration)
only when ALL 10 of these conditions hold:

1. **Specific**: `target_url` non-null AND non-sentinel (`needs_new_page` allowed only for `create_*_page` types).
2. **Evidence-backed**: `evidence.length >= 1` AND every entry references a verifiable signal source.
3. **Target known**: `target_url` OR `target_entity` resolved.
4. **Customer-safe**: `customer_copy` passes the forbidden-vocab catalog scan AND the unsupported-claim scan.
5. **Actionable**: `requires_proposed_text === false` OR `proposed_text !== null`.
6. **Confidence threshold met**: `confidence ∈ {"high", "medium"}` (low confidence is diagnostics-only).
7. **Not duplicate**: `dedupe_key` unique against already-emitted rows.
8. **Not cooled down**: no prior emission of same `cooldown_key` within the cooldown window.
9. **Not already accepted/shipped**: no `recommendation_responses.status='accepted'` ancestor.
10. **Not prerequisite-blocked**: every `prerequisite_key` references a resolved row.

Diagnostics-only (operator-only `/diagnostics/recommendation-triggers`)
when any of the above fail OR `confidence === "low"` OR `safety_flags`
non-empty.

## J. Priority / ranking model inputs

Master plan §4.5.14. Pure function. Locked weights:

```
priorityScore = (
    SEVERITY(0-30)            // trigger_signal-derived
  + PROMPT_COUNT(0-15)         // clamp(evidence_count × 2)
  + GSC_OPPORTUNITY(0-15)
  + CITATION_GAP(0-10)
  + REPEAT_WEAKNESS(0-10)
  + PRIMARY_GAP(0-10)
  + INDEX_BLOCKER(0-25)        // highest weight (architecture invariant 13)
  + PAGE_IMPORTANCE(0-15)
) × CONFIDENCE(0.5–1.0)
  × FRESHNESS(0.5–1.0)
  × PREREQUISITE(0 or 1)       // 0 if blocked
  × SAFETY(0 or 1)             // 0 if dangerous
  ÷ EFFORT(1.0–2.0)
```

### Key locked rules

- **Indexability blockers outrank content polish** (architecture invariant 13).
- **Prerequisite-blocked rows get priority 0** until prerequisite resolves.
- **Safety-flag set → priority 0**.
- **Effort divisor**: `add_internal_link = 1.0` · `change_h1 = 1.2` · `add_h2_section = 1.5` · `create_*_page = 2.0` · `merge_pages = 2.0`.
- **Cooldown windows** (O6 locked): `dismissed = 90d` · `accepted-not-yet-live = 30d` · `verified_live (cited or stuck) = 180d` · `decay re-fire = 60d after stale detection` · `wrong_page = 14d` · `partially_implemented = 60d`.
- **Max rows per page** (O7 locked): 5 in queue, surplus demoted.
- **Max rows per family** (O8 locked): 10 in queue, surplus demoted.
- **Signal-stale threshold** (O9 locked): 90 days.

## K. Required tests / invariants for future activation slices

Per master plan §4.5.18. Each new invariant is a separate test file
under `tests/architecture/`. Cataloged in lockstep.

### Locked invariant list (21 total, added incrementally across 4.5.A–4.5.G)

| # | Invariant | Slice |
|---|---|---|
| 4.5.18.1 | `recommendation-registry-active-set` (pins 29-type registry + 3-active flag set + audit-doc presence) | **4.5.A (THIS SLICE)** |
| 4.5.18.2 | `recommendation-intelligence-no-llm-decides-existence` | 4.5.B |
| 4.5.18.3 | `recommendation-intelligence-every-queue-row-has-evidence` | 4.5.B |
| 4.5.18.4 | `recommendation-intelligence-every-queue-row-has-confidence` | 4.5.B |
| 4.5.18.5 | `recommendation-intelligence-every-queue-row-has-dedupe-key` | 4.5.B |
| 4.5.18.6 | `recommendation-intelligence-every-queue-row-has-cooldown-key` | 4.5.B |
| 4.5.18.7 | `recommendation-intelligence-every-queue-row-customer-safe` | 4.5.B |
| 4.5.18.8 | `recommendation-intelligence-every-queue-row-has-target-surface` | 4.5.B |
| 4.5.18.9 | `recommendation-intelligence-every-queue-row-has-action-type` | 4.5.B |
| 4.5.18.10 | `recommendation-intelligence-no-internal-tokens-in-copy` | 4.5.B |
| 4.5.18.11 | `recommendation-intelligence-diagnostics-only-signals-stay-out` | 4.5.B |
| 4.5.18.12 | `recommendation-intelligence-offsite-no-proposed-text` (verifies Section 7 C7b lock survives) | 4.5.F |
| 4.5.18.13 | `recommendation-intelligence-index-outranks-content` | 4.5.D |
| 4.5.18.14 | `recommendation-intelligence-prerequisites-block-content` | 4.5.D |
| 4.5.18.15 | `recommendation-intelligence-dismissed-cooldown` | 4.5.D |
| 4.5.18.16 | `recommendation-intelligence-accepted-suppression` | 4.5.D |
| 4.5.18.17 | `recommendation-intelligence-no-paid-apis` | 4.5.D |
| 4.5.18.18 | `recommendation-intelligence-no-unsupported-claims` | 4.5.B |
| 4.5.18.19 | `recommendation-intelligence-title-meta-h1-evidence-shape` | 4.5.B |
| 4.5.18.20 | `recommendation-intelligence-new-page-requires-evidence` | 4.5.C |
| 4.5.18.21 | `recommendation-intelligence-schema-no-content-contradiction` | 4.5.B |

## L. Recommended next activation slice

**Slice 4.5.B — Metadata / H1 / new-page deterministic triggers.**

Operator-locked at master plan §4.5.19 as the natural successor to
this audit slice. Activates 5 existing action types and adds 3 new
ones (see §4.5.8 / §4.5.9 of master plan for full list):

### Activations (flips `generatorActive: true`)

- `edit_meta`
- `change_h1`
- `add_answer_block`
- `add_internal_link`
- `add_schema`

### New action types added to registry

- `update_intro`
- `add_h3_section`
- `add_image_alt_text`

### Deliverables

- 9 trigger predicates from §4.5.13 (missing-title / duplicate-title /
  title-h1-mismatch / missing-meta / duplicate-meta / missing-h1 /
  multiple-h1 / weak-h1 / missing-h2-coverage)
- New emitter contract module (CandidateRow + apply-queue-rules)
- Customer-copy template skeletons per §4.5.16
- Operator-only `/diagnostics/recommendation-triggers` surface
  (Slice 4.5.B emits to this surface ONLY; customer-queue flip is
  Slice 4.5.D per O12 lock)
- ≥4 new architecture invariants from §4.5.18 list

Exact implementation prompt: master plan §4.5.21 (already drafted +
operator-approved).

**Slice 4.5.A → 4.5.B sequence preserves the operator-locked O12
contract: trigger engine MUST be operator-visible BEFORE it touches
the customer queue.**

## M. Stop conditions for future slices

Per master plan §4.5.22. Any future slice 4.5.B+ MUST STOP and REPORT
when:

1. A registry flip from 4.5.B onward lands without a paired trigger predicate + invariant test.
2. Any trigger predicate requires network I/O, LLM call, or GSC call (deterministic-pure-function-only allowed).
3. Queue spam exceeds 5 rows per page or 10 rows per family on Ritz before suppression tightens.
4. The `recommendation-intelligence-no-llm-decides` invariant fails — LLM is deciding existence instead of drafting text.
5. Customer-copy templates leak any forbidden-vocab token.
6. Indexability blockers do NOT outrank content polish in the priority score.

### Hard contracts (inherited from prior sections)

- NO LLM call on page load (Phase A.1 / Section 10 carry-over).
- NO paid API call on page load (Section 4 / 9 carry-over).
- Forbidden-vocab catalog applies to every Section 4.5 customer copy template.
- Section 6 + Section 9 scope discipline applies: no Mode A / Mode B / Mode C labels in customer copy; no causal-revenue claims.
- Budget ledger routing per Section 12 N2 for Slice 4.5.E (LLM-assisted gateway).
- Section 10 original-copy preservation for Slice 4.5.E regenerate reuse.
- Section 12 catalog updated on every slice.

---

## Slice-by-slice activation sequence (operator-locked O11 + O12)

| Slice | Scope | Customer-visible? | Net new action types | Net activations |
|---|---|---|---|---|
| **4.5.A** | Registry audit + activation plan + 1 pin invariant | NO | 0 | 0 |
| **4.5.B** | Metadata/H1/new-page deterministic triggers; operator-diagnostic surface | NO (operator-only) | 3 | 5 |
| **4.5.C** | Indexability + GSC + query-to-URL + cannibalization triggers | NO (operator-only) | 12 | 6 |
| **4.5.D** | Ranking + dedupe + cooldown + prerequisite layer; customer-queue FLIP | **YES** (queue surface) | 8 | 3 |
| **4.5.E** | LLM-assisted copy drafting gateway | YES (Suggested Copy via existing 6A.2 provider) | 0 | 3 |
| **4.5.F** | Off-site queue contract for Section 7 | YES (off-site rows in queue) | 0 | 0 (off-site stays detection-only) |
| **4.5.G** | Safety / cleanup recommendation family | YES | 1 | 1 |

After 4.5.G ships, the registry reaches:
- ~52 action types total (29 current + 23 proposed)
- ~21 active deterministic + LLM-assisted (vs current 3)
- Operator-locked permanently inactive: 7 off-site

---

**END OF SLICE 4.5.A AUDIT.** This document is the canonical
source-of-truth for every future Section 4.5 slice. Any slice that
changes the registry shape MUST update this document in lockstep
with the change.
