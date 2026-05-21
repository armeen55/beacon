# Recommendation Intelligence Audit

> **Slice 4.5.A — registry audit + activation plan (2026-05-19)**
> **Slice 4.5.B.α₀ — first activation: registry expansion + 2 metadata
> predicates + operator diagnostic shell (2026-05-19)**
> **Slice 4.5.B.α₁ — H1 predicate family + `change_h1` activation
> (2026-05-19)**
> **Slice 4.5.B.α₂ — cross-snapshot duplicate-title + duplicate-meta
> predicates (2026-05-19)**
> **Slice 4.5.B.α₂.1 — diagnostic snapshot source + copy fix
> (2026-05-19)**
> **Slice 4.5.B.α₂.2 — page-intelligence/applicability layer; classify
> pages before trigger emission (2026-05-19)**
> **Slice 4.5.C.α₀ — indexability remediation registry foundation:
> 5 inactive action types + 5 customer-copy templates (2026-05-19)**
> **Slice 4.5.C.α₁ — Tier-1 indexability deterministic predicates +
> 4 generatorActive flips (2026-05-20)**
> **Slice 4.5.C.α₂ — Tier-2 sensitive indexability predicates +
> `fix_noindex` flip + diagnostic-only bucket render (2026-05-20)**
> **Slice 4.5.C.α₃a — orphan-page cross-snapshot predicate +
> `add_internal_link` flip (2026-05-20)**
> **Slice 4.5.C.α₃b — missing-schema per-snapshot predicate +
> `add_schema` flip (2026-05-20)**
> **Slice 4.5.D.α₀a — DE-SCOPED & REJECTED (2026-05-20):**
> first attempt landed at +3,530 src+tests vs the +1,000
> hard stop; operator rejected. Work split into α₀a.1 → α₀a.2
> → α₀a.3 → α₀b → α₁.
> **Slice 4.5.D.α₀a.1 — promotion eligibility + priority scoring
> foundation (2026-05-20)**: 2 src modules
> (`promotion-eligibility.ts` + `priority-score.ts`) + 2 unit
> suites + 2 invariants (`-promotion-eligibility-pin` +
> `-priority-score-contract`). +725 src+tests net (within
> +700 target with 25-line cushion).
> **Slice 4.5.D.α₀a.2 — dedupe + cooldown foundation
> (2026-05-20)**: 1 src module (`dedupe-cooldown.ts`) + 1 unit
> suite + 2 invariants (`-dedupe-key-formula` +
> `-cooldown-windows`). +928 src+tests net (above the ≤850
> soft threshold by 78 lines but under the +1,000 hard stop
> by 72 lines; operator approved Option 1 after explanation
> that `isInCooldown` is the load-bearing primitive). Q1
> locked `not_found_after_7d=0`. Q2 locked
> `verified_live_decay_refire` excluded (not a real status).
> Q3 locked `dismissed`-only response handling.
> **Slice 4.5.D.α₀a.3a — promotion safety-gates module
> (2026-05-20)**: 1 src module (`safety-gates.ts`) + 1 unit
> suite + 5 paired gate-level invariants
> (`-no-diagnostic-only-promotion` +
> `-confidence-low-stays-diagnostic` +
> `-promotion-respects-already-accepted` +
> `-page-classifier-applied-at-promotion` +
> `-no-promotion-without-evidence`). 13-step ordered gate
> ladder; first failing gate wins. +961 src+tests net
> (within 5% of the operator-approved ~915 estimate; under
> the +1,000 hard stop by 39 lines). U1 locked the 2-way
> split (α₀a.3a + α₀a.3b). U4 locked operator-review-only
> auto-suppression at Gate 3 with `diagnostic_only_tier`
> until α₂'s approve-to-promote affordance.
> **Slice 4.5.D.α₀a.3b — promotion orchestrator + caps
> (2026-05-20)**: 1 src module (`promote-to-queue.ts`) + 1
> unit suite + 2 paired cap invariants
> (`-max-rows-per-page` + `-max-rows-per-family`). Three-stage
> pure orchestrator `selectPromotableCandidates(...)`. V2
> locked caps at 5 + 10. V3 locked cap suppression reasons
> in `PromotionResultSuppressionReason` (α₀a.3a `SuppressionReason`
> UNCHANGED). V4 locked safety-suppressed rows do NOT count
> against caps. V5 locked deterministic tiebreaker. +836
> src+tests net (under ≤850 soft threshold by 14 lines).
> **Pure promotion decision engine is now COMPLETE.**
> **Slice 4.5.D.α₀b — operator-only Promotion Preview UI
> (2026-05-20)**: 1 modified page + 1 extended unit suite +
> 1 new no-write invariant (`-promotion-preview-no-writes`).
> Render-only DRY-RUN visualization on the existing
> operator-only diagnostic page. Three subsections
> (Eligible · Capped · Safety-suppressed). +481 src+tests
> net (219 UNDER the ≤700 target — cleanest landing of the
> α₀a chain). W1 (1-slice ship) · W2 (repository read path,
> no persistence imports) · W3 (response-store read OK) ·
> W4 (inline `pageTypeByUrl`) · W5 (3 subsections) · W6
> (always-render with 0/0; no empty tables) · W7 (1 new
> invariant; existing `no-queue-write` unchanged) · W8
> (local-only workflow, no CI minutes used). **Operator can
> now visually validate the promotion engine's output BEFORE
> α₁ ever flips a customer queue.**
> **Slice 4.5.E.α₁a — weak-h2 trigger predicate + `rewrite_h2`
> activation (2026-05-21)**: Second slice of Section 4.5.E. Pure
> detection layer only — adds the deterministic `weak-h2`
> trigger predicate that emits `rewrite_h2` candidates at
> `confidence: "low"` → routes to `diagnostic_only` via
> `applyQueueRules`. **NO env flag, NO server action, NO LLM
> call from this slice, NO gateway invocation, NO queue write,
> NO UI.** The α₀ LLM gateway (locally committed at `2923f25`)
> stays infrastructure-only and dormant; α₁b wires the env-
> gated server action that invokes it. 1 NEW src predicate
> (~185 lines, mirrors `weak-h1.ts` page-type-gating + modifier-
> overlap detection; per-page emission, not per-H2) + 1 NEW
> unit suite (29 cases) + 6 modified files (registry flip:
> `rewrite_h2.generatorActive: false → true` · eligibility
> entry: `weak_h2::rewrite_h2 = "diagnostic-only"` ·
> `rewriteH2Copy()` template · loader `PREDICATE_COUNT` 15 → 16
> + invocation · 4 paired test updates) + 4 architecture
> invariants extended (active-set 12 → 13; eligibility-pin
> table 16 → 17; customer-copy-vocab 14 → 15 templates;
> no-llm-decides auto-discovers the new `action_type` literal)
> + 5 doc syncs. **Operator-locked α₁a decisions**: activate
> `rewrite_h2` only (NOT `rewrite_faq`, NOT `refresh_stale_page`)
> · `weak_h2::rewrite_h2` operator-locked to `diagnostic-only`
> tier · `confidence: "low"` LITERAL forces `diagnostic_only`
> routing · `generator_kind: "llm_assisted"` LITERAL (first
> non-deterministic predicate) · page-snapshot-only signal (no
> observations, no GSC, no fan-out queries, no provider output)
> · per-page emission (not per-H2) · operator-locked
> `rewriteH2Copy()` phrasing. **Auto-pass** (existing α-family
> + α₀ + α₁c + 4.5.F + 4.5.E.α₀ invariants): `no-queue-write`
> (auto-covers new predicate file via `walk(INTEL_DIR)`),
> `trigger-predicates-purity`, `no-llm-decides` (auto-discovers
> the new `action_type: "rewrite_h2"` literal),
> `llm-draft-gateway-contract` (α₀ gateway unchanged + not
> invoked), `promotion-live-write-guards` (α₁c unchanged),
> `offsite-contract` (4.5.F unchanged). **Hard contracts
> honored**: NO push · NO CI · NO Vercel · NO LLM · NO gateway
> invocation · NO customer-facing route changes · NO α₀ / α₀a-d /
> α₀b / α₁a-b / α₁c / 4.5.F / 4.5.E.α₀ module modifications ·
> NO OpenAI provider / validator / budget ledger changes · NO
> queue writes · NO persistence imports · NO migrations / cron
> / workflows. **The first LLM-assisted detection predicate is
> now in place.** Gateway invocation deferred to α₁b. Operator
> can visit `/diagnostics/recommendation-triggers` after deploy
> and see `weak_h2 → rewrite_h2` candidates in the diagnostic-
> only bucket; NO LLM call fires.
>
> **Slice 4.5.E.α₀ — LLM-assisted drafting gateway
> (infrastructure only, 2026-05-21)**: First slice of Section
> 4.5.E sub-chain. **Pure infrastructure ONLY.** Gateway module
> `src/domains/recommendation-intelligence/llm-draft-gateway.ts`
> (146 lines, server-only) wires `openaiProvider.generate()`
> through the existing budget + validator gates and returns a
> discriminated-union draft result with locked 4-value `status`
> union: `drafted` / `abstained` / `validation_failed` /
> `blocked_budget`. **No production caller exists in α₀** —
> gateway is callable from tests + future α₁+ slices that wire
> trigger predicates → gateway → env-gated operator preview.
> 1 NEW src module + 1 NEW unit suite (17 cases, all passing,
> mocks at import boundary — NO real LLM calls) + 1 NEW
> invariant `recommendation-intelligence-llm-draft-gateway-
> contract` (12 cases) + 1 catalog row added. **α₀ scope
> honored**: no registry changes · no `generatorActive` flips ·
> no new action types · no trigger predicates · no operator
> preview · no customer queue write · no env flag (no caller
> yet) · gateway is type-agnostic. **Hard contracts
> honored**: NO `recommended-edits-persistence` import · NO
> `runProviderAndPersist` reference · NO direct Supabase
> `recommended_edits` write shape · NO `fetch(` call · NO LLM
> SDK import · NO α₀a / α₀b / α₁a / α₁b / α₁c module
> modifications · NO Section 7 / 4.5.F adapter or queue-rule
> modifications. 7-step fail-closed flow: pre-call
> `checkBudget()` → `openaiProvider.generate(packet)` → on
> success ALWAYS `recordSpend(bundle.totalCostUsd)` →
> `validateSpecificEdit()` → extract
> `targetElement?.proposedText` → return discriminated result.
> Spend NEVER recorded on `blocked_budget` or pre-call provider
> throw (the LLM never charged). 25 existing α-family
> invariants auto-pass; `recommendation-intelligence-no-queue-
> write` auto-covers the gateway file via `walk(INTEL_DIR)`.
> +750 src+tests net (gateway 153 · gateway test 450 ·
> invariant 147) — 50 over the ≤700 target; **100-line cushion
> to ≤850 soft threshold** ✅; 250-line cushion to +1,000 hard
> stop. **LLM-drafting infrastructure
> is in place; no production behavior change yet.** Next:
> Slice 4.5.E.α₁ — first trigger predicate (e.g. `rewrite-h2-
> needed`) + `rewrite_h2` activation + env-flag-gated
> (`BEACON_LLM_DRAFT_GATEWAY_ENABLED`) operator-only
> diagnostic preview. No queue write in α₁ — preview-only.
>
> **Slice 4.5.F — off-site shared queue contract (2026-05-21)**:
> First slice in the Section 4.5 post-4.5.D sequence (operator
> chose 4.5.F-first). Pure type-level + plumbing slice. Defines
> the adapter `offSiteCandidateToCandidateRow` (Section 7's
> `OffSiteCandidateAction` → Section 4.5's
> `RecommendationCandidateRow` carrier) + extends
> `applyQueueRules` with an off-site carve-out routing off-site
> rows ALWAYS to `diagnostic_only` (NEVER to `candidates`). 1 NEW
> adapter (107 lines) + 1 MODIFIED emitter (+32 net) + 1 NEW
> adapter test (17 cases) + 1 EXTENDED emitter test (+14 cases)
> + 1 NEW invariant `recommendation-intelligence-offsite-
> contract` (27 cases) + 1 catalog row. **F-block locked**: F1
> off-site→diagnostic_only routing · F2 adapter location · F3
> `target_url: null` · F4 `off_site:${channel}` namespace · F5
> `impact_estimate` mapping · F6 reuse `unsupported_claim_risk`
> · F7 reuse `business_config` evidence kind · F8 no loader wire-
> up · F9/F10 full invariant pin set. **Operator-locked safer
> correction**: off-site detection inside `applyQueueRules`
> reads `ACTION_TYPE_REGISTRY[actionType].signalType ===
> "off_page_seo"` from the existing registry; did NOT modify
> `promotion-eligibility.ts` or any α₀a module. Triple defense-
> in-depth on the customer-queue boundary: α₀a.1 eligibility →
> `"blocked"` + α₀a.3a Gate 1 → `blocked_tier` + new routing
> carve-out → always `diagnostic_only`. **No Section 7 wire-up,
> no customer surface change, no persistence path, no
> `generatorActive` flips, no new evidence-kind/safety-flag
> values.** 24 existing α-family invariants auto-pass. +677
> insertions / +673 net src+tests (under ≤700 target by 23–27
> lines ✅; 327-line cushion to +1,000 hard stop). **The shared
> queue language is
> now formalized**: deterministic-promotion + off-site + (future)
> LLM-assisted rows all carry the `RecommendationCandidateRow`
> shape; routing differences live in `applyQueueRules` +
> downstream safety gates. Next: 4.5.E (LLM-assisted gateway,
> independent of Section 10 per O11) OR 4.5.G (safety cleanup).
>
> **Slice 4.5.D.α₁c — operator-only live-write gesture + env-flag
> guard (2026-05-20)**: First slice that wires a UI-reachable code
> path to `promoteEligibleCandidates({ dryRun: false })`. Triple-
> gate ladder inside the server action: operator mode + env flag
> + confirmation phrase. **2 NEW src modules** (env helper +
> server action) + **1 MODIFIED page** + **1 NEW action test
> (12 cases)** + **1 EXTENDED page test (+8 cases)** + **1 NEW
> invariant (10 cases)** + **1 EVOLVED invariant in-place** +
> **1 catalog row added + 1 catalog row refreshed**. Env flag:
> `BEACON_PROMOTION_LIVE_WRITE_ENABLED === "true"` (strict case,
> mirrors `isOperatorModeServer` convention; `"True"`/`"1"`/`"yes"`/
> unset all DISABLE). Confirmation phrase: `"PROMOTE"` (strict
> uppercase, server-validated). On success: `revalidatePath` +
> redirect with `action_result=promoted&promoted_count=N&
> skipped_count=M&mapped_row_count=K[&sync_warning=...]`
> (sync_warning truncated 200 chars). On writer throw:
> `action_result=error&msg=...` (msg truncated 200 chars);
> `revalidatePath` NOT called. NEW invariant
> `-promotion-live-write-guards` source-text-pins the action file:
> operator gate ref · env-flag ref · `"PROMOTE"` literal · positive
> writer-import pin · NO `recommended-edits-persistence` direct
> import · NO `runProviderAndPersist` · NO Supabase write shape
> · positive `dryRun: false` pairing + 1 global negative scan
> asserting `actions.ts` is the ONLY file under `src/app/**`
> pairing `promoteEligibleCandidates` + `dryRun: false`. EVOLVED
> `-no-queue-write` in-place: file scan set now includes both
> `page.tsx` AND `actions.ts`; actions.ts NOT in persistence-
> import allowlist (regression guard). Y1—Y8 operator decisions
> honored. 19 existing α-family + α₀a + α₀b + α₁a + α₁b invariants
> auto-pass. **Hard contracts honored**: NO `runProviderAndPersist`
> import or call · NO LLM · NO external API · NO `fetch(` · NO
> Supabase migration · NO cron / workflow changes · NO customer-
> facing route changes · α₀a / α₀b / α₁a / α₁b src modules
> UNCHANGED · `SuppressionReason` / `SpecificEditEvidenceRef` /
> `SpecificEditSource` UNCHANGED. ~735 src+tests net (under ≤850
> soft threshold by 115 lines ✅; 265-line cushion to +1,000 hard
> stop; 35 over the ≤700 target but within the "above 700 /
> under 850" approval envelope). **Customer-queue writer pathway
> is now FULLY WIRED locally (α₀a + α₀b + α₁a + α₁b + α₁c).** Live
> writes require: operator mode ON + env flag = "true" + operator
> visits `/diagnostics/recommendation-triggers` + types
> `PROMOTE` + clicks submit. Next: Section 4.5.D closeout, then
> Section 4.5 remaining slices (4.5.E LLM-assisted · 4.5.F off-site
> contract · 4.5.G safety cleanup) per operator-chosen ordering.
>
> **Slice 4.5.D.α₁b — promotion writer + idempotent persistence
> (2026-05-20)**: First slice that actually crosses the customer-
> queue write boundary. The α₀a pure decision engine + α₀b
> operator preview + α₁a mapper all stayed write-free. α₁b is
> the SINGLE allowlisted importer of `recommended-edits-persistence`
> in the recommendation-intelligence tree — pinned via the
> EVOLVED `recommendation-intelligence-no-queue-write` invariant
> (refactored in-place, 2 tests → 5 tests, added
> `ALLOWED_PERSISTENCE_IMPORT_FILES` Set + positive importer
> pin). 1 NEW server-only src module (`promotion-writer.ts`,
> 193 lines) exporting `promoteEligibleCandidates(input)`. 1 NEW
> unit suite (13 cases, all passing via `vi.hoisted()` mockState
> pattern). 1 catalog refresh on the no-queue-write entry.
> **Default-safe**: `dryRun` defaults to `true`; live-write
> requires explicit `dryRun: false` (Y2). **Recompute-don't-trust**:
> writer ALWAYS recomputes `selectPromotableCandidates` at write
> time from fresh `loadTriggerCandidatesForTenant` + repository
> `getRecommendedEdits` + `getRecommendationResponses` reads (3
> parallel `Promise.all`); does NOT consume α₀b's render-time
> preview cache (Y3). **Idempotency (3 layers)**: α₁a `rec_id =
> promotion-${cooldown_key.slice(0, 16)}` + `persistRecommendedEditsLocal`
> `Map<row.id, row>` dedupe + Supabase `(tenant_id, rec_id,
> action_type, target_element_key)` unique index `NULLS NOT
> DISTINCT`. **Error handling (Y4)**: local write throws →
> propagate (source-of-truth failure, fail-loud); Supabase sync
> throws → catch + `log.warn` + return `sync_warning` in result;
> next run re-syncs from local. Mirrors `markRecommendedEditsAccepted`
> at lines 360–368. **Result shape (Y8)**: ALWAYS returns
> `mapped_rows` so the caller can inspect what WOULD or DID get
> written across BOTH dryRun modes. **Hard contract**: NO
> `runProviderAndPersist` import or call — the LLM-orchestrator
> path STAYS forbidden; even the writer uses persistence
> helpers directly. Y1 (one slice) · Y2 (dryRun default) · Y3
> (always recompute) · Y4 (local-fail-loud + sync-best-effort)
> · Y5 (in-place invariant evolution with single-file allowlist)
> · Y6 (no env flag — α₁c) · Y7 (no UI gesture — α₁c) · Y8
> (always return `mapped_rows`). +786 src+tests net (writer
> src 193 · writer test 541 · invariant in-place evolution
> +52 net) — under ≤850 soft threshold by 64 lines ✅; 214-line
> cushion to +1,000 hard stop; 86 over the ≤700 target but
> within the operator's "above 700 / under 850" approval
> envelope.
> **Customer-queue writer pathway is now COMPLETE locally
> (α₀a + α₀b + α₁a + α₁b).** Next: α₁c — operator-only UI
> gesture on `/diagnostics/recommendation-triggers` that calls
> `promoteEligibleCandidates({ dryRun: false })`.
>
> **Slice 4.5.D.α₁a — promotion row mapper (2026-05-20)**:
> First slice on the customer-queue boundary chain. 1 NEW
> pure mapper module (`promotion-result-to-edit-row.ts`) +
> 1 enum extension (`SpecificEditSource` += `"deterministic_promotion"`)
> + 1 unit suite + 2 paired invariants
> (`-promotion-writer-source-pin` + `-promotion-writer-eligibility-pin`).
> 5 defensive null-returns belt-and-suspenders the α₀a.3a
> safety gates. `rec_id = promotion-${cooldown_key.slice(0, 16)}`
> leverages existing unique index for idempotency. `source =
> "deterministic_promotion"` distinct from legacy
> `"deterministic"`. `evidence_hash = sha1(dedupe::cooldown::priority)`
> for traceability. X1 (3-way split α₁a + α₁b + α₁c) · X2
> (mapper-only) · X3 (new source value) · X4 (rec_id format) ·
> X5 (traceability via existing fields; `SpecificEditEvidenceRef`
> UNCHANGED — only `SpecificEditSource` extended per
> operator restriction) · X6 (local minimal type) · X7 (5
> defensive rejections) · X8 (`difficulty: "low"` v1). +722
> src+tests net (128 UNDER the ≤850 soft threshold; 22 over
> the ≤700 target but within the operator's "above 700 /
> under 850" approval envelope). **NO writes — mapper-only;
> the writer + UI ship in α₁b + α₁c.**
>
> Canonical source-of-truth document for the Section 4.5 Recommendation
> Intelligence Expansion roadmap. Documented operator-approved
> exception to the "no new docs" rule (Decision Lock O10) because
> subsequent slices (4.5.B–4.5.G) each reference this document as the
> single source-of-truth for the action-type registry expansion plan +
> activation order.
>
> **Current state (post-4.5.C.α₃b)**: registry holds **37 action
> types**; **12 active** (`edit_title`, `edit_meta`, `change_h1`,
> `add_h2_section`, `add_faq`, `fix_sitemap`, `fix_robots`,
> `fix_status_code`, `fix_canonical`, `fix_noindex`). **13
> deterministic trigger predicates landed**: the 7 α-family
> (`missing-title` + `missing-meta` + `missing-h1` + `weak-h1` +
> `title-h1-mismatch` + `duplicate-title` + `duplicate-meta`) plus
> the 4 Tier-1 indexability (`sitemap-missing` +
> `robots-blocks-googlebot` + `bad-http-status` +
> `canonical-mismatch`) plus the 2 Tier-2 sensitive indexability
> (`noindex-on-indexable-page` + `robots-blocks-ai-bots`)
> consuming the Section 4 `owned_url_indexability` verdict
> substrate. Operator-only diagnostic page at
> `/diagnostics/recommendation-triggers` surfaces all 13 trigger
> signals — main candidates section for the 11 high/medium
> confidence rows, NEW diagnostic-only section for the 2 Tier-2
> low-confidence rows. Customer queue UNCHANGED. **4.5.C.α₂ flips
> `fix_noindex` paired with the sensitive predicate** which emits
> at `confidence: "low"` so `applyQueueRules` routes candidates to
> `diagnostic_only` (NOT the customer queue) — three safety
> guards on the predicate: page-type allowlist (homepage/city/
> service/project only), skip `extraction_certainty="uncertain"`,
> skip `has_canonical_mismatch=true` (paginated/duplicate
> signature). `robots-blocks-ai-bots` reuses the already-active
> α₁ `fix_robots` action type (no new flip). Operator validates
> Tier-2 rows on the diagnostic page before any future customer-
> queue promotion.
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

Total (post-4.5.C.α₀): **37 action types** in `ACTION_TYPES` /
`ACTION_TYPE_REGISTRY` (`src/domains/recommendations/action-types.ts`).
Pre-α₀ count was 29; 4.5.B.α₀ added 3 inactive entries (`update_intro`,
`add_h3_section`, `add_image_alt_text`); 4.5.C.α₀ added 5 inactive
indexability-remediation entries (`fix_sitemap`, `fix_robots`,
`fix_noindex`, `fix_status_code`, `fix_canonical`).

### Inventory by category

| # | Category | Count | Action types |
|---|---|---|---|
| 1 | On-page copy edits | 14 | `edit_title` · `edit_meta` · `change_h1` · `add_h2_section` · `rewrite_h2` · `add_faq` · `rewrite_faq` · `add_table` · `edit_table_row` · `add_answer_block` · `add_proof_section` · `add_comparison_section` · `add_cost_section` · `add_timeline_section` |
| 2 | Technical / structural | 4 | `add_internal_link` · `add_schema` · `fix_schema` · `reorder_sections` |
| 3 | Page-level lifecycle | 3 | `split_page` · `merge_pages` · `create_page` |
| 4 | Passive | 1 | `watch` |
| 5 | Slice 4.5.B.α₀ additions (registered inactive) | 3 | `update_intro` · `add_h3_section` · `add_image_alt_text` |
| 6 | Slice 4.5.C.α₀ additions — indexability remediation (registered inactive) | 5 | `fix_sitemap` · `fix_robots` · `fix_noindex` · `fix_status_code` · `fix_canonical` |
| 7 | Off-site authority (Section 7 C7b — LOCKED detection-only) | 7 | `claim_gbp` · `optimize_gbp_profile` · `request_gbp_reviews` · `claim_or_optimize_houzz` · `claim_or_optimize_yelp` · `submit_to_industry_directory` · `pursue_local_pr` |
| — | **TOTAL** | **37** | — |

## B. Current `generatorActive` set

**Exactly 12 action types currently have `generatorActive: true`** (post-4.5.C.α₃b):

| Action type | Category | Notes |
|---|---|---|
| `edit_title` | On-page copy edits | Sprint 6A.1 substrate |
| `edit_meta` | On-page copy edits | **Flipped in Slice 4.5.B.α₀ (2026-05-19)** — paired with `missing-meta` trigger predicate |
| `change_h1` | On-page copy edits | **Flipped in Slice 4.5.B.α₁ (2026-05-19)** — paired with `missing-h1` + `weak-h1` + `title-h1-mismatch` trigger predicates |
| `add_h2_section` | On-page copy edits | Sprint 6A.1 substrate |
| `add_faq` | On-page copy edits | Sprint 6A.1 substrate |
| `fix_sitemap` | Technical / indexability | **Flipped in Slice 4.5.C.α₁ (2026-05-20)** — paired with `sitemap-missing` predicate over `not_in_sitemap` verdict |
| `fix_robots` | Technical / indexability | **Flipped in Slice 4.5.C.α₁ (2026-05-20)** — paired with `robots-blocks-googlebot` predicate over `blocked_by_robots_for_googlebot` verdict |
| `fix_status_code` | Technical / indexability | **Flipped in Slice 4.5.C.α₁ (2026-05-20)** — paired with `bad-http-status` predicate over `bad_status_code` verdict |
| `fix_canonical` | Technical / indexability | **Flipped in Slice 4.5.C.α₁ (2026-05-20)** — paired with `canonical-mismatch` predicate over `canonical_elsewhere` verdict |
| `fix_noindex` | Technical / indexability | **Flipped in Slice 4.5.C.α₂ (2026-05-20)** — paired with `noindex-on-indexable-page` Tier-2 sensitive predicate at `confidence: "low"` → routes to `diagnostic_only` via `applyQueueRules`. Three safety guards: page-type allowlist (homepage/city/service/project), skip `extraction_certainty="uncertain"`, skip `has_canonical_mismatch=true` |
| `add_internal_link` | Technical | **Flipped in Slice 4.5.C.α₃a (2026-05-20)** — paired with the cross-snapshot `orphan-page` predicate at `confidence: "medium"` → routes to main candidates section. Strict inbound-orphan semantics (0 inbound owned-page links; self-links excluded). Allowlist: homepage/city/service/project/hub. Global emptiness guard: when no snapshot has usable `internal_links` data, ALL emissions are suppressed (data unavailable). |
| `add_schema` | Technical | **Flipped in Slice 4.5.C.α₃b (2026-05-20)** — paired with the per-snapshot `missing-schema` predicate at `confidence: "low"` → routes to `diagnostic_only` via `applyQueueRules`. Reuses existing pure `diffSchemaCoverage()` + `EXPECTED_SCHEMA_BY_ASSET_TYPE` substrate. Tier-2 sensitive — schema-expectation map is local-service-tuned; diagnostic-only routing isolates operator validation from customer-queue impact. Safety guards: page-type allowlist (homepage/city/service/project/hub), skip `extraction_certainty="uncertain"`, fire only when `!coverage.satisfies_all_required` (recommended-only gaps are evidence-only). |

**25 action types have `generatorActive: false`** (post-4.5.C.α₃b). The
OpenAI specific-edit provider (Sprint 6A.2) can still produce any of
the 18 non-off-site inactive types when the LLM path activates per-rec
— but only the 12 above have a deterministic generator (or trigger
predicate) wired in production. The α₂ `robots-blocks-ai-bots`
predicate also reuses the already-active `fix_robots` action type (no
new flip).

**4.5.C closeout (post-α₃b)**: every indexability + linking + schema
remediation action type that is in scope for Section 4.5.C has now
been activated. The next slice is **4.5.D** — customer-queue
promotion (the diagnostic-only validation surface is complete; the
operator decides which low/medium-confidence rows promote to the
customer queue per per-tenant calibration).

The 7 off-site types are operator-locked at `generatorActive: false`
PERMANENTLY per Section 7 C7b's read-only/manual contract — Beacon
recommends off-site work, it never performs it.

The 3 4.5.B.α₀-added types (`update_intro`, `add_h3_section`,
`add_image_alt_text`) are registered inactive: paired predicates land
in later slices (α₁ for the H1 family does NOT cover them; α₂ does
not cover them; they flip in **Slice 4.5.C+** when their predicates
ship — and `add_image_alt_text` additionally requires an extractor
extension to surface an `images: { alt }[]` field on `PageSnapshot`).

The 5 4.5.C.α₀-added indexability-remediation types (`fix_sitemap`,
`fix_robots`, `fix_noindex`, `fix_status_code`, `fix_canonical`)
are registered inactive: paired predicates land in **Slice 4.5.C.α₁
Tier-1** (`fix_sitemap`, `fix_robots` for googlebot,
`fix_status_code`, `fix_canonical`) and **Slice 4.5.C.α₂ Tier-2
sensitive** (`fix_noindex`, robots blocks AI bots — `fix_robots`
re-fires under a different verdict). All five carry
`requiresProposedText: false` and route through the
`review_decision` row-type — Act 4 Suggested Copy stays suppressed
because these are operator-task rows (no LLM drafts a robots.txt
rule or sitemap entry).

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
