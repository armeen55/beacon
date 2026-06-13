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
> **Slice — Brand Assertion Key Alignment (2026-05-22)**:
> Generic tenant-identity fix surfaced by B.4a's diagnostic
> (Brand-supported = 0 despite Ritz's `architect-led
> design-build` `process` assertion). Root cause:
> `TENANT_ASSERTIONS` + `TENANT_NAME_STYLES` in
> `brand-assertions.ts` were keyed by tenant SLUG
> (`"ritz-builders"`) while every production caller
> (`specific-edit-evidence.ts`, the recommendation-triggers
> action, the B.4a safety-audit diagnostic, and the validator's
> `getBrandNameStyle(packet.tenantId)`) passes the tenant ID
> (`"tenant-ritz-founder"` = `currentTenantId()`). So
> `getBrandAssertions`/`getBrandNameStyle` returned `[]`/`null`
> in production — silently disabling the LLM brand-assertion
> guidance + the validator brand-name-style gate; the slug-based
> unit test stayed green, masking it. Fix (Option 4): re-key both
> registries by canonical tenantId — generic, no Ritz `if`, no
> async resolver, no caller changes, sync signatures preserved.
> **Re-activates intended behavior** (LLM allowed-phrase guidance
> + validator brand-name-style gate for Ritz) — verified via the
> full validator/LLM suite. Modifies (1) `brand-assertions.ts` —
> re-key + test-only `__brandRegistryKeys` export + doc comments;
> (2) `brand-assertions.test.ts` — re-key lookups + 2 regression
> tests (slug → `[]`/`null`, no alias); (3)
> `specific-edit-validator-brand-claims.test.ts`
> (operator-approved fixture expansion) — 11 packet fixtures
> slug→id; the 2 bare-Ritz-rejection tests now fire; (4)
> `specific-edit-validator-faq-pairing.test.ts`
> (operator-approved) — 1 fixture slug→id. `static-bundle.test.ts`
> untouched (22 green, unaffected). Adds (5) NEW
> `tests/architecture/brand-assertions-tenant-key-contract.test.ts`
> — every registry key is an `ops/active-tenants.json` tenantId,
> NO key equals a slug, + behavioral regression (tenantId lookup
> non-empty / slug lookup empty). **This is the invariant that
> would have caught the bug.** Protects Customer 2. **NO
> production mutation · NO migration · NO LLM · NO polls/scans ·
> NO env · NO validator-logic change · NO customer-route change ·
> NO scanner change · NO Ritz-specific logic.** After deploy,
> `/diagnostics/recommendation-safety-audit` should flip
> Brand-supported from 0 → > 0 with architect-led tagged
> supported, unblocking the B.4b/B.4c scope decision against
> correctly-resolved data.

> **Slice 4.5.G-B.4a — generic claim-risk classification (tag,
> don't suppress) (2026-05-22)**: First slice of Section
> 4.5.G-B.4. Operator-locked architecture: GLOBAL risk-pattern
> detection (pure scanner) + TENANT-PROVIDED brand-assertion
> support (via context) + TAG-DON'T-SUPPRESS. Preflight finding:
> the 40 architect_overclaim + 14 unsupported_claim audit "debt"
> is largely false-positive — the scanner flat-token-matched with
> NO brand-assertion carve-out, so it flagged operator-asserted
> phrases (e.g. an `architect-led design-build` `process`
> assertion). The validator already blocks the genuinely-unsafe
> brand claims at write-time via its category-gated unlock
> mechanism; the audit lacked the same awareness. B.4a makes the
> scanner CLASSIFY each `architect_overclaim` / `unsupported_claim`
> violation as `brand_supported: true | false` against
> tenant-supplied assertions — NEVER removing a violation — and
> the operator diagnostic surfaces a per-field × per-term ×
> brand-support debt breakdown. **Tenant-agnostic**: the scanner
> owns a GLOBAL claim-risk registry (token → 6 categories:
> professional_credential / process / ranking / award /
> guarantee_outcome / superiority) + a GLOBAL unlock map
> (risk-category → assertion-category strings); it NEVER imports
> brand-assertions, NEVER imports getBrandAssertions, NEVER
> imports business-config, NEVER references getRepository, NEVER
> branches on a tenant name. The diagnostic page resolves
> `getBrandAssertions(tenantId)` at the boundary and passes a
> LOCAL STRUCTURAL shape (`{ id?, phrase, category }`) into the
> scanner via `context.brandAssertions`. No assertions →
> `brand_supported` defaults false (safe; preserves pre-B.4a
> behavior). Modifies (1) `safety-audit.ts` — `ClaimRiskCategory`
> type + 4 OPTIONAL violation fields (architect/unsupported only)
> + `SafetyAuditBrandAssertion` structural shape +
> `context.brandAssertions?` + `CLAIM_RISK_BY_TOKEN` (18 tokens
> mapped) + `CLAIM_RISK_UNLOCK` + `classifyClaim` /
> `classificationForToken`; existing kinds UNCHANGED. (2)
> `recommendation-safety-audit/page.tsx` — boundary
> `getBrandAssertions` resolution + structural map + context
> pass; page-layer `FIELD_VISIBILITY` (proposed_text + why =
> customer_visible; customer_copy = unknown; operator_evidence =
> operator_internal); brand-support counters; `DebtBreakdownTable`
> grouped section; flat-table brand-support data-attrs + column.
> Tests: `safety-audit.test.ts` +20 (51 total, SYNTHETIC tenants
> only); `recommendation-safety-audit-page.test.tsx` +9 (19
> total); `recommendation-safety-audit-read-only.test.ts` +5
> scanner purity pins + page brand-assertions pin flipped
> negative→positive (32 cases); `recommendation-safety-audit-
> coverage.test.ts` +15 (30 total). **Locked decisions honored**:
> tag-don't-suppress; generic-not-Ritz (zero tenant-name logic in
> scanner); scanner import-free (structural shape via context);
> page-boundary brand-assertion resolution; NO credentials
> category (B.4d); field-visibility unknown-where-uncertain. **NO
> customer surface change · NO migration · NO mutation · NO LLM ·
> NO B.1/B.2/validator change.** **The operator can now SEE true
> debt (unsupported + customer-visible) vs audit noise
> (brand-supported or operator-internal) on the diagnostic —
> unblocking the B.4b (validator: premier/proven) + B.4c (render
> guard for why/measurement_plan) scope decision against REAL
> per-field/per-term data instead of guessed counts.**

> **Slice 5.B.2 — Today edit-lifecycle tile repeat-citation
> band counter (2026-05-21)**: Closes Section 5 end-to-end.
> Sections 5.A (compute + loader at `0c1957a`), 5.A.2
> (`/diagnostics/repeat-citation` operator diagnostic at
> `aa003e8`), 5.A bug-fix (poll-day denominator alignment at
> `93a56f6`), and 5.B Slice 1 (Changes detail Act 3 sub-line at
> `4656483`) were already deployed pre-slice. 5.B.2 ships the
> LAST Section-5 customer surface: a compact "Citation stability
> (past 30 days)" counter sub-section inside the existing Today
> `EditLifecycleTile` (NOT a new tile). Locked decisions G1-G5 +
> 5.B.1 customer labels were already in place; this slice plumbs
> them through to the Today tile. **Pure additive render-time
> extension. NO production data mutations · NO LLM · NO Supabase
> writes · NO migrations · NO new top-level routes · NO new
> dashboards · NO env changes · NO compute-repeat-citation.ts /
> load-repeat-citation.ts / /diagnostics/repeat-citation /
> Changes detail mutations · NO band-threshold or denominator-
> logic changes · NO Section 6 / Section 7 / Section 9 / Section
> 10 / 4.5.G-B work.** Modifies (1) `src/domains/citation-
> lifecycle/load-lifecycle.ts` — adds `repeat_citation_30d:
> { per_band: Record<RepeatCitationBand, number>; total: number;
> total_with_band: number }` to `LifecycleSummary`. Loader body
> invokes existing `loadRepeatCitationForEdit({ tenantId,
> recommendedEdit: row, windowDays: 30, now })` in `Promise.all`
> across the SAME `candidates` set the per_stage loop iterates;
> aggregates per-band counts. Per-edit `.catch()` softens
> individual failures; outer try/catch zeros the rollup on
> catastrophic failure. Each per-edit call hits its existing 60s
> `unstable_cache`. (2) `src/components/today/edit-lifecycle-
> tile.tsx` — additive `repeatCitation30d?` prop + new
> `CitationStabilitySection` component. Locked
> `REPEAT_CITATION_BAND_LABELS` map (lower-case sentence-case
> forms): `stable: "consistent"`, `intermittent: "recurring"`,
> `one_off: "early signal"`, `not_repeated: "not repeated"`,
> `still_learning: "still learning"`. Locked
> `REPEAT_CITATION_BAND_ORDER` drives render order.
> Suppression rules: prop null / total 0 / total_with_band 0 /
> all-zero per_band → section absent. Zero-buckets hidden in the
> counter line. Type-only import of `RepeatCitationBand`. (3)
> `src/app/(shell)/today-v2-sections.tsx` — single-line addition:
> `repeatCitation30d={summary.repeat_citation_30d}` prop passed
> to existing `<EditLifecycleTile />`. (4) `tests/components/
> today/edit-lifecycle-tile.test.tsx` — extended from 8 to 20
> cases (+12 new 5.B.2 cases): section renders when populated ·
> locked labels rendered · zero-buckets hidden · section absent
> when prop absent / null / total_with_band=0 / total=0 · no raw
> band names as visible JSX text · no percentages · no Section-6
> vocab · no causal/revenue language · per-stage rollup coexists.
> (5) `tests/domains/citation-lifecycle/load-lifecycle.test.ts`
> — extended with new mock for `loadRepeatCitationForEdit` and 7
> new aggregation cases. 31/31 passing. (6) `tests/architecture/
> repeat-citation-no-customer-surface.test.ts` — extended
> ALLOWED_FILES with `src/components/today/edit-lifecycle-tile.
> tsx` + `src/app/(shell)/today-v2-sections.tsx`; introduced
> `ADDITIONAL_SCAN_FILES` list to scan `today-v2-sections.tsx`
> (sits at sibling depth, not in existing root walk). 585 cases
> passing. (7) NEW `tests/architecture/repeat-citation-today-
> tile-band-counter.test.ts` (~280 lines, 31 cases) — pins 3
> things on the tile: locked customer-label map (7 pins) +
> module purity (8 pins) + forbidden customer-copy vocab (10
> pins) + render-surface contract (5 pins). **Locked decisions
> honored**: G1 (30d customer / 60+90d operator already covered
> by 5.A.2; tile shows 30 only); G2 (successful poll-day
> denominator UNCHANGED via existing loader); G3 (per-platform
> divergence on Changes detail only; tile counter is single
> aggregate row — no per-platform); G4 (no half-life — invariant
> pins absence); G5 (band thresholds UNCHANGED). 5.B.1 customer
> labels EXACTLY preserved (lower-case forms in tile counter;
> title-case forms in Changes detail badge — same band concept,
> case-folded for rendering context). **Auto-pass invariants**:
> `repeat-citation-pure-purity` · `repeat-citation-forbidden-
> vocab` · `repeat-citation-customer-copy-vocab` (5.B.1
> UNCHANGED) · `repeat-citation-no-section-6-bridge` · `repeat-
> citation-loader-tenant-scope` (5.A loader UNCHANGED) ·
> `repeat-citation-changes-detail-band-mapping` · `repeat-
> citation-operator-page-discipline` + `repeat-citation-
> operator-page-vocab` · `citation-lifecycle-tenant-isolation` ·
> `catalog-sync` (1 new row added in lockstep). **Hard contracts
> honored**: pure additive · NO mutations · NO LLM · NO Supabase
> writes · NO migrations · NO env changes · NO 5.A / 5.A.2 /
> 5.B.1 mutations · NO Section 6 / 7 / 9 / 10 / 4.5.G-B work ·
> forward-only · existing rows + cache untouched. **Section 5 —
> Repeat-Citation Classifier is now COMPLETE end-to-end**: 5.A
> compute + loader + 5.A.2 operator diagnostic + 5.B.1 Changes
> detail + 5.B.2 Today tile. The customer reads "Citation
> stability (past 30 days): N consistent · M recurring · K
> early signal" alongside the existing per-stage rollup.
> Operator inspects the full 30/60/90 breakdown at
> `/diagnostics/repeat-citation`.

> **Slice 4.5.G-B.2 — write-time sanitizer forward-prevention
> (2026-05-21)**: Second half of Section 4.5.G-B safety
> hardening. **Forward-only complement to B.1's render-time
> guard.** B.1 (deployed at `origin/main = 25cb285`) blocks
> the 4 high-severity leak kinds (uuid_leak / long_hex_hash /
> internal_token / competitor_name) at customer render. B.2
> prevents NEW leaks from being persisted at row creation —
> extends the existing write-time sanitizer
> (`sanitizeOperatorEvidenceText` at `src/domains/
> recommendations/copy-sanitize.ts`) which already scrubs
> canonical UUIDs per the M2 (2026-05-05) operator audit.
> Pre-edit inspection confirmed the sanitizer IS the correct
> central point — already wired at `recommended-edits-
> persistence.ts:246-259` for `why` / `expectedImpact` /
> `measurementPlan` / `displayLabel` before Supabase
> persistence. B.2 adds two new pattern families to the SAME
> pure-function pipeline: (a) long 32+ hex/hash strings
> (SHA-1 / SHA-256 / MD5 / similar) replaced with
> `"prompt evidence"`; (b) the 12 locked internal taxonomy
> tokens (mirrors B.1's blocklist EXACTLY) replaced with
> operator-approved customer-safe wording. **Pure string
> transformation. NO production data mutations · NO LLM ·
> NO Supabase writes · NO env changes · NO migrations · NO
> validator changes · NO brand-assertions changes · NO
> registry/action-types changes · NO B.1 render-guard
> changes.** Inherits B.1 scope discipline:
> `unsupported_claim` + `architect_overclaim` deferred to
> slice 4.5.G-B.4; competitor-name scrubbing stays on the
> separate `validateCompetitorPublicCopy` validator path.
> Modifies (1) `src/domains/recommendations/copy-sanitize.
> ts` — adds `LONG_HEX_HASH_PATTERN_GLOBAL` regex,
> `INTERNAL_TOKEN_REPLACEMENTS` table (10 pattern→
> replacement pairs; 3 Mode labels share one
> `\bMode\s+[ABC]\b` regex), exports new helper
> `scrubInternalLeakagePatterns(text)` that runs long-hex
> THEN walks the token table, and 2-line evolution of
> `sanitizeOperatorEvidenceText` to call the helper AFTER
> the UUID-replacement phase (existing M2 early-return
> restructured so B.2 runs unconditionally). Locked
> replacement style: `aiSearchSignal` → `search-intent
> signals`; `actualSearchQueries` → `observed search-intent
> signals`; `action_type` → `action type`; `trigger_signal`
> → `signal`; `evidence_tier` → `evidence`; `Mode A/B/C` →
> `Beacon's evaluation mode`; `source_rec_id` → `source
> recommendation`; `rec_id` → `recommendation`;
> `diagnostic_only` → `diagnostic`; `customer-queue-ready`
> → `customer queue`; long-hex → `prompt evidence`.
> Idempotent. (2) `src/domains/recommendations/copy-
> sanitize.test.ts` — extended from 16 to 49 cases
> (+33 B.2 cases). Adds (3) NEW `tests/architecture/
> recommendation-copy-sanitize-purity.test.ts` (30 cases)
> — 1 file-exists + 12 module-purity pins (no fetch / no
> Supabase / no LLM / no `recommended-edits-persistence` /
> no brand-assertions / no validator / no `why-display-
> guard` (B.1 stays separate) / no `suggested-copy-
> display-guard` / no action-types / no Supabase write
> shape; exports `sanitizeOperatorEvidenceText` +
> `scrubInternalLeakagePatterns`) + 4 coverage pins
> (long-hex pattern + `"prompt evidence"` fallback + 9
> per-token literal pins + 1 shared `Mode\s+[ABC]` regex +
> 1 replacement-style spot-check) + 4 deferral pins (no
> `architect-led` / `architect-designed` / `\bbest\b`
> replacement keys; no competitor scrubbing). **Locked
> decisions honored**: extend `sanitizeOperatorEvidenceText`
> (operator-confirmed correct central point); pure
> transformation; idempotent; preserves M2 UUID-with-
> prompt-mapping behavior; B.1 render-guard UNCHANGED
> (invariant pins zero imports between the two modules);
> forward-only (existing rows unchanged); deferred kinds
> stay deferred. **Auto-pass invariants**:
> `recommendation-why-render-guard` (B.1 unchanged);
> `recommendation-safety-audit-coverage` (A.1 unchanged);
> `recommendation-safety-audit-read-only` (A.1/A.2
> unchanged); `recommendation-intelligence-no-queue-write`
> (sanitizer lives under `src/domains/recommendations/`,
> NOT under `recommendation-intelligence/`);
> `llm-safety-invariants` (no provider imports);
> `catalog-sync` (1 new row in lockstep). **Hard contracts
> honored**: pure transformation · NO production data
> mutations · NO LLM · NO paid APIs · NO Supabase writes ·
> NO migrations · NO env changes · NO validator changes ·
> NO brand-assertions changes · NO `generatorActive`
> flips · NO new top-level routes · NO `revalidatePath` ·
> NO server actions · NO Today / Changes / Prompts /
> Settings / Section 6 / Section 9 changes · NO
> `recommendation-intelligence` tree changes · forward-only.
> **Section 4.5.G-B safety floor is now complete for the 4
> B.1-locked reason kinds end-to-end** — A.1 detects
> historical violations at audit time, B.1 catches them at
> customer render, B.2 prevents new ones at row
> persistence. Defense-in-depth across the full lifecycle.

> **Slice 4.5.G-B.1 — recommendation `why` render-time
> guard (2026-05-21)**: First half of Section 4.5.G-B
> (defense-in-depth follow-up to the production audit at
> A.2). Operator-side visual smoke of
> `/diagnostics/recommendation-safety-audit` (deployed
> against `origin/main = 450a3f2`) surfaced **73 violations
> across 25 of 28 rows**: **10 uuid_leak (high)**, **5
> internal_token (medium, e.g., `aiSearchSignal`)**, **4
> competitor_name (high)**, 40 architect_overclaim
> (medium — many legitimate Ritz brand-assert phrasing per
> K3 audit-only patterns), 14 unsupported_claim, 0
> placeholder/causal/em_dash/leading_superlative.
> **Operator-locked decision: render-guard + future
> prevention, NO production data mutation.** B.1 scope:
> render-time guard for the customer-visible `why` field
> ONLY, blocking the 4 high-confidence non-overclaim kinds
> (uuid_leak / long_hex_hash / internal_token /
> competitor_name). **unsupported_claim and
> architect_overclaim INTENTIONALLY DEFERRED to slice
> 4.5.G-B.4** to preserve Ritz's brand-asserted
> "architect-led design-build" positioning until the
> brand-assertion carve-out lands. Adds (1) NEW
> `src/domains/recommendations/why-display-guard.ts`
> (~200 lines) — pure `checkWhyDisplaySafe(why, context?)`
> returning discriminated `{ ok: true, text } | { ok:
> false, fallback, reasons }`. 4 reasons via
> `WhyDisplayGuardReason` union. 12 locked internal
> tokens: `aiSearchSignal`, `actualSearchQueries`,
> `action_type`, `trigger_signal`, `evidence_tier`,
> `Mode A`, `Mode B`, `Mode C`, `rec_id`, `source_rec_id`,
> `diagnostic_only`, `customer-queue-ready`. UUID-shape
> regex + 32+ char hex regex. Competitor names via
> case-insensitive whole-word match on passed-in
> `context.competitorNames`. Locked fallback copy
> verbatim: `"Beacon has additional context for this
> recommendation, but it needs review before showing
> here."` Null / undefined / empty-string handled
> gracefully (returns `{ ok: true, text: "" }`). **ZERO
> dependency on**: validator (`specific-edit-validator` /
> `validateSpecificEdit`), brand-assertions
> (`@/domains/recommendations/brand-assertions`),
> suggested-copy-display-guard, action-types registry
> (`ACTION_TYPE_REGISTRY`), persistence
> (`recommended-edits-persistence`), Supabase, LLM
> provider (`openaiProvider`), HTTP (`fetch(`). (2) NEW
> `tests/domains/recommendations/why-display-guard.test.ts`
> (~250 lines, 33 cases) — clean / null / undefined /
> empty + uuid_leak (2) + long_hex_hash (2) + 12
> internal-token cases (one per locked token) +
> competitor_name (4 cases) + multi-reason + 5 intentional
> non-blocking (architect-led / architect-designed / best
> / em-dash / leading Best — per B.1 scope discipline) +
> fallback shape. (3) NEW `tests/architecture/
> recommendation-why-render-guard.test.ts` (~200 lines,
> 24 cases) — pins BOTH the guard module's purity AND the
> 4 customer-facing render sites' adoption. Module-level:
> 1 file-exists + 11 source-text negatives (no fetch / no
> Supabase / no LLM / no validator / no brand-assertions /
> no suggested-copy-display-guard / no action-types
> registry / no Supabase write shape / no
> recommended-edits-persistence) + 1 positive on locked
> fallback string + 1 positive on `checkWhyDisplaySafe`
> export. Site-level: 12 pins across 4 render sites
> (`recommendation-detail-client.tsx`,
> `suggested-copy-act.tsx`, `recommendations-client.tsx`
> legacy drawer, `recommendation-v2-card.tsx` v2 card) ×
> 3 pins each (file-exists + `@/domains/recommendations/
> why-display-guard` import + ≥2 `checkWhyDisplaySafe`
> occurrences). **Files modified (8)**: 2 server pages
> (`src/app/(shell)/recommendations/page.tsx` +
> `src/app/(shell)/recommendations/[id]/page.tsx`) load
> `tracked_entities` once via
> `getRepository().forTenant(tenantId).getTrackedEntities()`,
> filter to active competitors (`entity_type ===
> "competitor"` AND `is_active === true`; mirrors the A.2
> diagnostic page pattern), thread `competitorNames` down
> with `[]` soft-fail on error. 6 render path files
> (`recommendations-v2-client.tsx` +
> `recommendations-client.tsx` legacy +
> `recommendation-v2-card.tsx` +
> `recommendation-detail-client.tsx` +
> `suggested-copy-act.tsx` + plumbing through 3 hops in
> the legacy client: `RecommendationsClient` →
> `ActionTable` → `ActionRow` → `RowDrawer`) call
> `checkWhyDisplaySafe(...)` before rendering `why`. In
> the legacy drawer, the guard wraps the existing
> `sanitizeOperatorEvidenceText(...)` chain — catches
> leaks the write-time sanitizer missed.
> **Locked decisions honored**: 4-reason scope
> (uuid_leak / long_hex_hash / internal_token /
> competitor_name); unsupported_claim + architect_overclaim
> deferred to B.4; competitor source =
> `tracked_entities` filtered to active competitors;
> fallback copy locked verbatim and pinned by architecture
> invariant; guard module purity (zero I/O / zero LLM /
> zero validator+brand-assertions+registry imports).
> **Auto-pass invariants**:
> `recommendation-safety-audit-coverage` (A.1 unchanged);
> `recommendation-safety-audit-read-only` (A.1/A.2
> unchanged); `recommendation-intelligence-no-queue-write`
> (guard lives under `src/domains/recommendations/`, NOT
> under `recommendation-intelligence/`; no new persistence
> imports under the scanned tree);
> `llm-draft-gateway-render-isolation` (unchanged);
> `llm-safety-invariants` (no provider imports / no
> `runProviderAndPersist`); `catalog-sync` (1 new row
> added in lockstep). **Hard contracts honored**: pure
> render-time guard · NO production data mutations · NO
> LLM call on render · NO paid API · NO Supabase writes ·
> NO migrations · NO env changes · NO validator changes ·
> NO brand-assertions changes · NO `generatorActive`
> flips · NO new top-level routes · NO `revalidatePath` ·
> NO server actions · NO Today / Changes / Prompts /
> Settings / Section 6 / Section 9 changes · NO
> `recommendation-intelligence` tree changes · original
> render text preserved when guard returns `{ ok: true }`
> (only the fallback path swaps content). **Customer-
> visible `why` field is now end-to-end guarded across
> all 4 known render paths** — uuid_leak / long_hex_hash /
> internal_token / competitor_name leaks now resolve to
> the locked fallback at render time. Defense-in-depth
> alongside the existing audit scanner (A.1 captures at
> audit time) and the `suggested-copy-display-guard`
> (which guards `proposed_text` at render time on a
> separate code path). Future slice 4.5.G-B.2 will extend
> the write-time sanitizer to prevent future
> internal_token / uuid leaks at row creation,
> complementing this render-time guard.

> **Slice 4.5.G-A.2 — recommendation safety audit
> diagnostic page + read-only invariant (2026-05-21)**:
> Second half of Section 4.5.G-A. **Completes the
> operator-facing safety-audit vertical** — operator can
> now visit `/diagnostics/recommendation-safety-audit` and
> inspect historical safety violations on every
> `recommended_edits` row for the tenant. Consumes the A.1
> scanner (`auditRecommendedEditRow`, locally committed at
> `506c6ae`) without modification. Adds (1) NEW
> `src/app/(shell)/diagnostics/recommendation-safety-audit/
> page.tsx` (~287 lines) — operator-only diagnostic page.
> Operator gate `isOperatorModeServer() || NODE_ENV ===
> "test"` else `notFound()` (per K5). Reads
> `recommended_edits` + `tracked_entities` via existing
> repository pattern. Builds competitor-name list filtered
> to active competitor entities. Audits every row via
> `auditRecommendedEditRow(...)`. Renders flat one-row-per-
> violation table with `data-safety-rec-id` /
> `data-safety-violation-kind` / `data-safety-violation-
> severity` / `data-safety-violation-field` attrs. Counter
> strip (scanned / rows-with-violations / total / high /
> medium / low) + empty-state success banner. **NO action
> buttons. NO forms. NO mutations. NO `revalidatePath`. NO
> server action pragma.** (2) NEW `tests/app/diagnostics/
> recommendation-safety-audit-page.test.tsx` (~269 lines,
> 10 cases) — non-operator notFound · operator/test env
> renders · empty state · clean rows · violation table
> render · multi-violation DOM rows · counter totals ·
> active competitor entity flows into scanner · inactive
> competitor excluded · no action buttons / forms.
> (3) NEW `tests/architecture/recommendation-safety-audit-
> read-only.test.ts` (~217 lines, 27 cases) — 2 file-exists
> pins + 8 scanner source-text negatives + 17 page
> contracts (14 negative + 3 positive:
> `isOperatorModeServer` + `notFound` +
> `auditRecommendedEditRow`). Pins read-only nature of
> BOTH the A.1 scanner and A.2 page at the file boundary.
> **A.1 scanner UNCHANGED** — `git diff HEAD --
> src/domains/recommendation-intelligence/safety-audit.ts`
> is empty; structural typing handles the call site.
> **Locked decisions (K1-K7) honored**: K1 split (A.1
> scanner + A.2 page = operator-reachable end-to-end) ·
> K2 NO `credentials` BrandAssertionCategory · K3
> architect/licensing audit-only patterns (10 locked terms
> in A.1) · K4 3-band severity (rendered) · K5 standard
> operator gate · K6 audit ALL rows · K7 include all
> lifecycle statuses (status column rendered).
> **Auto-pass invariants**: `no-queue-write` (A.1 scanner
> unchanged); `llm-draft-gateway-render-isolation`
> (unchanged — page does not import gateway);
> `promotion-live-write-guards` (unchanged);
> `offsite-contract` (unchanged); `specific-edit-target-
> constraint` (page does not invoke heavy packet builder);
> `recommendation-safety-audit-coverage` (A.1 invariant
> still green); `llm-safety-invariants` (page does not
> import provider); `catalog-sync` (1 new row added in
> lockstep). **Hard contracts honored**: page is pure
> read-only · NO writes · NO mutations · NO server action ·
> NO `revalidatePath` · NO queue writes · NO LLM calls ·
> NO OpenAI provider import · NO llm-draft-gateway import ·
> NO `recommended-edits-persistence` import · NO
> `persistRecommendedEditsLocal` / `syncRecommendedEdits` ·
> NO `runProviderAndPersist` · NO Supabase
> `recommended_edits` write shape · NO brand-assertions.ts
> changes · NO new `BrandAssertionCategory` · NO
> `credentials` category · NO validator import · NO
> `action-types` registry import · NO display-guard
> changes · NO registry changes · NO `generatorActive`
> flips · NO trigger predicate changes · NO customer-
> facing route changes · NO Today / Changes / Prompts /
> Settings / Recommendations / Section 9 changes · NO
> migrations · NO cron/workflows. **The safety-audit
> vertical is now operator-reachable end-to-end** —
> operator visits `/diagnostics/recommendation-safety-
> audit`, sees the violations table for every
> recommended_edits row across the 9 locked kinds, and
> decides per-row whether to fix (manual edit / dismiss /
> accept-as-is). Beacon does NOT auto-rewrite live rows
> from this surface. Future 4.5.G-B (validator + category +
> unlock extensions) remains gated on operator review of
> audit results.

> **Slice 4.5.G-A.1 — recommendation safety audit scanner +
> coverage invariant (2026-05-21)**: First half of Section
> 4.5.G-A (safety cleanup / defense-in-depth) after
> operator-approved split. **Section 4.5.E was production-
> verified / closed** at `origin/main = a97affb` with
> `BEACON_LLM_DRAFT_GATEWAY_ENABLED` unset; Section 4.5.G
> begins the safety hardening phase before any further
> LLM-assisted activation. Original 4.5.G-A first pass came
> to 1,724 lines (+724 over the +1,000 hard stop); operator
> approved Option 1 split into A.1 (scanner + scanner
> tests + coverage invariant) and A.2 (diagnostic page +
> page tests + read-only file-boundary invariant). **A.1
> ships pure scanner substrate only — no operator surface
> yet.** Adds (1) NEW `src/domains/recommendation-
> intelligence/safety-audit.ts` (413 lines) — pure
> `auditRecommendedEditRow(row, ctx)` scanner with 9
> locked violation kinds (placeholder · competitor_name ·
> unsupported_claim · architect_overclaim · causal_language ·
> em_dash · leading_superlative · internal_token · uuid_leak).
> Severity bands per K4: high (placeholder / competitor /
> uuid) · medium (unsupported / architect / causal) · low
> (em-dash / leading-superlative / internal-token). Local
> `AuditableEditRow` type — ZERO dependency on
> `recommended-edits-persistence` module (structural typing
> handles the call site). Smart `\b` word-boundary handling
> for non-word-character tokens (`#1` / `architect-led`).
> Exports the locked token lists `ARCHITECT_OVERCLAIM_TOKENS`
> (10 K3 terms) and `CAUSAL_LANGUAGE_TOKENS` (9 K3 terms).
> Pure / deterministic / no I/O / no LLM / no Supabase / no
> mutation. (2) NEW `tests/domains/recommendation-
> intelligence/safety-audit.test.ts` (401 lines, 31 cases) —
> every violation kind + multi-violation row + context
> excerpt + field coverage (proposed_text / why /
> display_label / expected_impact / measurement_plan) +
> null/empty-field safety. (3) NEW `tests/architecture/
> recommendation-safety-audit-coverage.test.ts` (167 lines,
> 15 cases) — all 9 `SafetyViolationKind` exercised in
> scanner test file + locked 10-token architect-overclaim
> set (exact match, no extras) + locked 9-token causal-
> language set (exact match, no extras) + scanner scans
> `proposed_text` + `why` at minimum. **Locked decisions
> (K1-K7) honored**: K1 split (G-A only; G-B deferred); now
> further split into A.1 + A.2 per +1,000 hard-stop rule ·
> K2 NO `credentials` BrandAssertionCategory · K3
> architect/licensing audit-only patterns (10 locked terms) ·
> K4 3-band severity · K5 standard operator gate (applied in
> A.2's page) · K6 audit ALL rows (scanner does not filter
> by status) · K7 include all lifecycle statuses (scanner
> does not filter). **Auto-pass invariants**: `no-queue-
> write` (auto-covers scanner via `walk(INTEL_DIR)`);
> `llm-draft-gateway-render-isolation` (unchanged — scanner
> does not import gateway); `promotion-live-write-guards`
> (unchanged); `offsite-contract` (unchanged); `specific-
> edit-target-constraint` (scanner does not invoke heavy
> packet builder); `catalog-sync` (1 new row added in
> lockstep; A.2 will add the sibling read-only invariant
> row). **Hard contracts honored**: scanner is pure ·
> NO I/O · NO LLM · NO fetch · NO Supabase · NO persistence
> imports · NO `recommended-edits-persistence` import · NO
> `persistRecommendedEditsLocal` / `syncRecommendedEdits` ·
> NO `runProviderAndPersist` · NO direct Supabase
> `recommended_edits` write shape · NO brand-assertions.ts
> changes · NO new `BrandAssertionCategory` · NO
> `credentials` category · NO validator changes · NO
> display-guard changes · NO registry changes · NO
> `generatorActive` flips · NO trigger predicate changes ·
> NO customer-facing route changes · NO Today / Changes /
> Prompts / Settings / Recommendations / Section 9 changes ·
> NO migrations · NO cron/workflows. **Line budget**: src +
> tests = 981 lines · under +1,000 hard stop by 19 lines ✅
> (test depth is the dominant cost; operator-locked policy
> forbids weakening tests to fit a tighter budget). **The
> pure scanner substrate is in place** — any future operator
> surface (A.2 diagnostic page, future cron, ad-hoc script)
> can call `auditRecommendedEditRow(...)` to detect
> violations across the 9 locked kinds. Read-only by design;
> no auto-rewrite path. A.2 will add the operator-only
> `/diagnostics/recommendation-safety-audit` page + the
> sibling `recommendation-safety-audit-read-only`
> architecture invariant that pins the no-mutation /
> no-server-action / no-`revalidatePath` contract on both
> files. Future 4.5.G-B (validator + category + unlock
> extensions) remains gated on operator review of audit
> results.
> **Slice 4.5.E.α₁b₂-B — LLM-draft preview UI + 8-state
> result banner (2026-05-21)**: Fifth slice of Section 4.5.E.
> **Completes the operator-facing LLM-draft preview
> vertical** — operator can now click "Generate draft" on a
> weak-H2 diagnostic row from the browser. Pure UI consumer
> of α₁b₂-A's `generateLlmDraftAction`. Adds (1) MODIFIED
> `src/app/(shell)/diagnostics/recommendation-triggers/
> page.tsx` (+372 lines) — imports `generateLlmDraftAction`
> from `./actions` as a Server Action function reference
> (NOT a gateway import) + `isLlmDraftGatewayEnabled` from
> `@/lib/llm-draft-gateway-flag`; threads
> `llmDraftResult = parseLlmDraftResult(searchParams)` +
> `llmDraftEnabled = isLlmDraftGatewayEnabled()` +
> `weakH2DiagnosticRows = result.diagnostic_only.filter(
> weak_h2 + rewrite_h2)` into the page render path; adds
> 8-variant `LlmDraftResult` discriminated union +
> `parseLlmDraftResult` parser (reads `llm_draft_result`
> discriminator + per-state fields via existing `readParam`
> helper; returns null for unknown) + `LlmDraftResultBanner`
> (8 states + unknown→null; each emits `data-llm-draft-
> result="<status>"` attr; drafted shows `proposed_text` in
> `<pre>` + `cost_usd` + `bundle_size` + truncation notice
> conditional + "Render-only · not persisted." footer) +
> `LlmDraftPreviewSection` (between Diagnostic-only and
> Promotion Preview; filtered `result.diagnostic_only` only;
> calm empty state; env-off disabled button + locked
> caption; env-on per-row `<form action={
> generateLlmDraftAction} data-llm-draft-form>` with hidden
> `candidate_dedupe_key` input + enabled `Generate draft`
> submit; emits `data-diagnostic-section="llm-draft-
> preview"` + `data-row-count` + `data-llm-draft-enabled`
> attrs). **No bulk button. No confirmation phrase. Page
> render NEVER invokes the gateway.** (2) NEW
> `tests/app/diagnostics/recommendation-triggers-page-llm-
> draft-section.test.tsx` (~415 lines, 18 cases) — section
> render + 8 banner states + sanity carry-over (gateway
> mock never invoked from page render). **Render-isolation
> invariant UNCHANGED**: page.tsx satisfies all 6 source-
> text negatives (no gateway import / no
> `draftProposedTextForCandidate` reference / no
> `openaiProvider` import or symbol / no
> `openaiProvider.generate` / no `fetch(`); global
> allowlist still finds EXACTLY ONE caller = actions.ts.
> Catalog row's narrative refined to confirm "α₁b₂-B
> unchanged-but-verified". **Locked decisions honored
> (1-16)**: single UI-only slice · MODIFY page.tsx only ·
> ADD page test file · NO action / gateway / build-thin-
> packet / trigger / registry / queue-write / persistence /
> `runProviderAndPersist` / Supabase-write / OpenAI-
> provider changes · NO LLM call on page render · NO bulk
> LLM calls · page imports ONLY `generateLlmDraftAction`
> from `./actions` · page does NOT import gateway · page
> does NOT reference `draftProposedTextForCandidate` ·
> page does NOT import `openaiProvider`. **Auto-pass**
> (existing α-family + α₀ + α₁a + α₁b₁ + α₁b₂-A + α₁c +
> 4.5.F): `recommendation-intelligence-llm-draft-gateway-
> render-isolation` UNCHANGED (page.tsx satisfies all 6
> source-text negatives; global allowlist still finds
> EXACTLY ONE caller); `no-queue-write` (auto-covers
> page.tsx in scan set — verified zero new persistence
> imports / no `runProviderAndPersist` / no Supabase write
> shape); `llm-draft-gateway-contract` (α₀ gateway
> unchanged); `promotion-live-write-guards` (α₁c
> unchanged); `offsite-contract` (4.5.F unchanged);
> `specific-edit-target-constraint` (page does not invoke
> heavy packet builder); `catalog-sync` (existing render-
> isolation row updated in-place). **Hard contracts
> honored**: NO action changes · NO gateway changes · NO
> build-thin-packet changes · NO trigger changes · NO
> registry changes · NO `generatorActive` flips · NO queue
> writes · NO persistence imports · NO `recommended-
> edits-persistence` import · NO `runProviderAndPersist` ·
> NO direct Supabase `recommended_edits` write shape · NO
> OpenAI provider import in page · NO gateway import in
> page · NO `draftProposedTextForCandidate` reference in
> page · NO automatic LLM calls on page render · NO bulk
> LLM calls · NO customer-facing route changes · NO Today
> / Changes / Prompts / Settings / Recommendations /
> Section 9 changes · NO migrations · NO cron/workflows.
> **The Section 4.5.E LLM-draft preview vertical is now
> complete end-to-end** behind
> `BEACON_LLM_DRAFT_GATEWAY_ENABLED=true`: detection →
> infrastructure → action → UI. Operator can visit
> `/diagnostics/recommendation-triggers`, see weak-H2
> diagnostic candidates in the new LLM-Draft Preview
> section, click "Generate draft" on a row, and see the
> result in one of 8 banners after the redirect. Page UI
> button is the natural human-facing entry point; the
> hand-crafted POST path landed in α₁b₂-A remains the
> machine-facing entry point (same action, same gates,
> same budget protection).
> **Slice 4.5.E.α₁b₂-A — operator-only server action +
> evolved render-isolation invariant (2026-05-21)**: Fourth
> slice of Section 4.5.E. **First slice that activates the
> LLM call path end-to-end** (server-action side; page UI
> consumer deferred to α₁b₂-B). Adds (1) the operator-only
> env-gated server action `generateLlmDraftAction(formData)`
> in `src/app/(shell)/diagnostics/recommendation-triggers/
> actions.ts` with an 11-step fail-closed gate ladder
> (operator → env → tenant → FormData → fresh candidate
> load → diagnostic_only-only resolution → shape validation
> → snapshot exact-URL match → business config → brand
> assertions (empty allowed) → build thin packet → invoke
> gateway), `revalidatePath` + redirect with result params
> on success and on every failure path; (2) EVOLVED the
> render-isolation invariant from α₁b₁'s "no caller yet"
> (7 cases) to α₁b₂-A's "exactly one allowlisted caller"
> (19 cases) — pins 6 source-text negatives on page.tsx,
> 9 source-text contracts on actions.ts (4 positive + 5
> negative), 2 global allowlist scans, 2 file-exists pins.
> Pattern mirrors `recommendation-intelligence-promotion-
> live-write-guards`. **Split from oversized α₁b₂ first
> pass**: original combined slice (α₁b₂-A + α₁b₂-B) was
> 1,725 lines = +725 over the +1,000 hard stop; operator
> approved Option 1 clean split; oversized changes were
> reverted via `git restore` + untracked-file deletion
> before α₁b₂-A implementation began. **NO page.tsx change.
> NO UI section. NO LLM-Draft Preview visual surface yet.
> NO automatic LLM call. NO bulk LLM call. NO queue write.
> NO live promotion. NO confirmation phrase.** Action is
> reachable only via hand-crafted POST (still operator +
> env-flag gated). 1 MODIFIED src file + 1 EVOLVED
> invariant + 1 NEW test file + 5 doc syncs. **Result-
> param transport per P6 OVERRIDE**: drafted carries
> `cost_usd` (6-decimal) + `bundle_size` + `proposed_text`
> capped to 500 chars + `proposed_text_truncated=true`
> flag when truncated + `candidate_dedupe_key` echo. Other
> 7 states (abstained / validation_failed / blocked_budget
> / blocked_env / candidate_not_found / invalid_candidate
> / error) carry their respective truncated payloads.
> **Locked decisions honored (1-10, all LOCKED after
> split)**: single slice (after operator split decision) ·
> FormData input · fresh re-read via
> `loadTriggerCandidatesForTenant` · diagnostic_only-only
> resolution (reject main bucket) · URL params transport ·
> `proposed_text` in URL capped 500 chars + truncated flag
> (operator OVERRIDE — no in-memory cache, no deferred
> viewer) · action-contract pins folded into evolved
> render-isolation invariant (no separate invariant file) ·
> no confirmation phrase · no per-tenant rate limit ·
> snapshot exact URL match via `getRepository`.
> **Auto-pass** (existing α-family + α₀ + α₁a + α₁b₁ +
> α₁c + 4.5.F): `no-queue-write` (auto-covers `actions.ts`
> already in scan set — verified zero new persistence
> imports / no `runProviderAndPersist` / no Supabase write
> shape), `llm-draft-gateway-contract` (α₀ unchanged),
> `promotion-live-write-guards` (α₁c unchanged),
> `offsite-contract` (4.5.F unchanged), `specific-edit-
> target-constraint` (action does not invoke heavy packet
> builder), `catalog-sync` (existing render-isolation row
> updated in-place). **Hard contracts honored**: NO
> page.tsx change · NO UI section · NO LLM-Draft Preview
> visual surface yet · NO bulk LLM calls · NO automatic
> LLM calls on page render · NO queue write · NO live
> promotion · NO persistence imports · NO `recommended-
> edits-persistence` import · NO `runProviderAndPersist` ·
> NO direct Supabase `recommended_edits` write shape · NO
> OpenAI provider import in action (provider reached ONLY
> through gateway) · NO registry changes · NO
> `generatorActive` flips · NO trigger predicate changes ·
> NO weak-h2 changes · NO llm-draft-gateway changes · NO
> build-thin-packet changes · NO `rewrite_faq` activation ·
> NO `refresh_stale_page` addition · NO customer-facing
> route changes · NO Today / Changes / Prompts / Settings /
> Recommendations / Section 9 changes · NO migrations · NO
> cron/workflows. **The LLM call path is now operator-
> reachable end-to-end via hand-crafted POST** behind
> `BEACON_LLM_DRAFT_GATEWAY_ENABLED=true`. Page UI button
> to expose the action to operators in the browser lands
> in α₁b₂-B (no invariant changes expected — page.tsx
> adds a button that POSTs to the existing action;
> gateway is still imported by exactly one file).
> **Slice 4.5.E.α₁b₁ — env flag + thin packet builder +
> render-isolation invariant (2026-05-21)**: Third slice of
> Section 4.5.E. Caller-side infrastructure ONLY. Adds (1) the
> env-flag helper `src/lib/llm-draft-gateway-flag.ts` (single
> source of truth `isLlmDraftGatewayEnabled()` reading
> `BEACON_LLM_DRAFT_GATEWAY_ENABLED === "true"`, strict casing,
> default unset ⇒ `false`) that will gate future α₁b₂ server-
> action invocation of the gateway; (2) the pure thin packet
> builder `src/domains/recommendation-intelligence/build-thin-
> packet.ts` (~245 lines, `buildThinPacketForCandidate(...)`
> returning a structurally valid `SpecificEditEvidencePacket`
> from an α₁a weak-H2 candidate row + page snapshot + brand
> assertions; 8 fail-loud preconditions; locked field
> assignments per α₁b₁ design lock; empty brandAssertions
> does NOT throw — validator handles the empty-grounding case
> downstream via the abstention contract Rule B); (3) the
> render-isolation architecture invariant `tests/architecture/
> recommendation-intelligence-llm-draft-gateway-render-
> isolation.test.ts` (4 source-text pins on the diagnostic
> page.tsx + 2 global negative scans across `src/app/**`)
> that pins the "no caller yet" boundary. **NO server action.
> NO LLM call from this slice. NO gateway invocation. NO
> customer-facing render path change. NO action-type registry
> change. NO promotion-eligibility-table change. NO customer-
> copy template change. NO loader change.** 2 NEW src modules
> + 1 NEW unit suite (21 cases) + 1 NEW architecture invariant
> (7 cases) + 1 catalog row added + 5 doc syncs. **Operator-
> locked α₁b₁ decisions (1-15)**: single slice (no split) ·
> env flag strict-cased `=== "true"` · pure thin builder
> (sibling to heavy builder, not a wrapper) · 8 fail-loud
> preconditions · empty brandAssertions allowed (validator
> handles) · render-isolation invariant scope (page.tsx +
> global app sweep) · element_key
> `h2[<index>]:<sha1.slice(0,12)>` · recId
> `"preview-" + dedupe_key.slice(0,16)` · evidenceHash sha1
> of canonical-JSON sans hash · 21 builder tests + 7
> invariant tests · STOP at READY_TO_COMMIT (no commit, no
> push, no CI, no Vercel) · NO loader modification · NO
> promotion-eligibility-table change · NO customer-copy
> template change · NO α₀ gateway modification (gateway
> unchanged from `2923f25`). **Auto-pass** (existing α-family
> + α₀ + α₁a + α₁c + 4.5.F invariants): `no-queue-write`
> (auto-covers builder via `walk(INTEL_DIR)`), `no-llm-decides`
> (unchanged — no new generatorActive flips),
> `llm-draft-gateway-contract` (α₀ unchanged),
> `promotion-live-write-guards` (α₁c unchanged),
> `offsite-contract` (4.5.F unchanged), `specific-edit-target-
> constraint` (builder does not invoke the heavy packet
> builder; docstring reworded to avoid the literal call-
> pattern token), `catalog-sync` (catalog row added in
> lockstep). **Hard contracts honored**: NO push · NO CI ·
> NO Vercel · NO LLM · NO server action · NO gateway
> invocation · NO customer-facing route changes · NO α₀ /
> α₀a-d / α₀b / α₁a-b / α₁c / 4.5.F / 4.5.E.α₀ / 4.5.E.α₁a
> module modifications · NO OpenAI provider / validator /
> budget ledger changes · NO action-type registry changes ·
> NO eligibility-table changes · NO customer-copy template
> changes · NO loader change · NO queue writes · NO
> persistence imports · NO migrations / cron / workflows ·
> NO new top-level routes. **The caller-side infrastructure
> for the LLM-draft gateway is now in place.** α₁b₂ will
> wire the operator-only env-gated server action that
> invokes the gateway via the new builder.
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

## 2026-06-13 — registry expansion (Clarity fuse)

Added `fix_page_experience` (inactive generator) — the directive-only
action paired with the deterministic `clarity_friction` predicate that
consumes the synced Microsoft Clarity per-URL metrics (script errors /
rage clicks). Registry count is now **38** action types (was 37); the
locked active set is UNCHANGED (3: `edit_title`, `add_h2_section`,
`add_faq`) — `fix_page_experience` ships `generatorActive: false`.
