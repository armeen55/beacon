# Beacon Verification Log

> **PURPOSE:** Pure history and proof. Dated entries of what changed, what was tested, and results.
> This file answers: "What did we verify and when?"
>
> **NOT FOR:** What to do next (→ `NEXT_PHASE_EXECUTION_PLAN.md`), current state (→ `HANDOFF_VERIFIED_STATE.md`).

---

## 2026-04-12 — `/settings/methodology` route (1.1c follow-through)

- **Goal:** Create the methodology destination page defined in 1.1c so all Layer 2/3 disclosure links have a real target.
- **Scope:** UI + content wiring — no new logic, no schema changes.
- **Route created:** `src/app/(shell)/settings/methodology/page.tsx` — static page with 5 sections:
  1. **How Beacon works** — overview of imports → findings → attribution → market → recommendations; every metric bounded by imported sample.
  2. **What the metrics mean** — Citation Share (with denominator concept), sample quality tiers (limited / moderate / strong), "Strongest correlate" definition, evidence quality labels (Strong / Moderate / Early), change verdicts (Validated / Partial / Inconclusive / Too early / No impact / Negative).
  3. **What Beacon knows vs. doesn't know** — three-panel grid: observed signals, inferred relationships, unknowns (causation, market share, AI indexing, revenue impact, recommendation certainty).
  4. **How to interpret recommendations** — evidence ≠ guarantee, patterns ≠ predictions, operator judgment required, outcomes not guaranteed.
  5. **FAQ** — 5 adversarial questions from 1.1h: attribution causation (Q2), Citation Share vs market share (Q3/Q4), recommendation certainty (Q8), sample quality limited (Q12), "Strongest correlate" definition (Q9). Collapsible `<details>` entries.
- **Settings tab added:** "Methodology" tab in `settings/layout.tsx` (4 tabs: Import, Config, Data, Methodology).
- **L3 entry-point links wired (minimal):**
  - `HowWeKnowPanel` footer → "Full methodology →" (`/settings/methodology`)
  - Market scope line → "How this works →" (`/settings/methodology#citation-share`)
  - Changes replication blurb → "How verdicts work →" (`/settings/methodology#verdicts`)
- **Content sources used:** `TIER_1_1C_METHODOLOGY_SHELL_IA.md` (sections, structure, tone), `TIER_1_1H_ADVERSARIAL_OWNER_FAQ.md` (Q2, Q3/Q4, Q8, Q9, Q12), `TIER_1_1A_SIGNAL_TAXONOMY.md` (forbidden claims boundary), `beacon-proof-copy.ts` (existing proof language).
- **No logic/schema/component changes.** Pure content route + 3 link additions.
- **Files touched:** `src/app/(shell)/settings/methodology/page.tsx` (new), `src/app/(shell)/settings/layout.tsx`, `src/components/today/how-we-know-panel.tsx`, `src/app/(shell)/competitors/page.tsx`, `src/app/(shell)/changes/page.tsx`.
- **Verification:** `npm run typecheck` ✓ · `npm run test` 82/82 ✓ · `npm run build` ✓ (18 static + 4 dynamic routes; `/settings/methodology` appears as ○ static).
- **Docs updated:** `HANDOFF_VERIFIED_STATE.md`, `NEXT_PHASE_EXECUTION_PLAN.md`, `VERIFICATION_LOG.md` (this entry), `architecture.md` (settings sub-routes table).

---

## 2026-04-12 — Tier 1.1: Final copy sweep (1.1j deferred forbidden-claim strings)

- **Goal:** Remove deferred F1/F4-style wording on non-primary surfaces and generated copy; align with `TIER_1_1A_SIGNAL_TAXONOMY.md` (correlation, evidence tiers, no outcome guarantees in sample hypotheses).
- **Scope:** Copy-only — no logic, props, or layout changes.
- **Strings / themes addressed (representative):** “Proven winners” → “Observed winners”; “What might have caused this” / “drove this move” → correlational headings + “best aligns”; “Proven” / “drove visibility” / “Apply proven pattern” in generated recs → “Observed” / “aligned with visibility change” / “Apply observed pattern”; replication tier labels (“Validated winner”, “Partial (high-confidence)”) → “Strong pattern” / “Partial (strong evidence)”; “high-confidence impact” / Tier 1B blurb → “strong-evidence …”; “Likely causes” → “Likely correlates” (UI + issue markdown); seed hypotheses “will improve” → “may correlate …; outcomes not guaranteed”; review operator label “high confidence” → “firm (operator)”; diagnostics stat/table labels reframed (“Strong evidence tier”, “Evidence tier”, “Attribution tier distribution”, “Attribution inflation risk”); attribution summaries “Primary cause” / “after this change” → “Strongest correlate” / “same observation window”; domain builders (`priority-engine`, `frontier-planner`, `brief-generation`, `actions`, `opportunity-candidates`) “proven” phrasing → observed / well-supported / strong-pattern language; `replication-engine` inferred line “validated winner” → “validated source change”.
- **Files touched:** `src/components/data/candidate-review.tsx`, `src/app/(shell)/changes/scorecard-client.tsx`, `src/app/(shell)/changes/page.tsx`, `src/components/replication/replication-cards-client.tsx`, `src/domains/product/replication-engine.ts`, `src/domains/product/recommendation-engine.ts`, `src/app/(shell)/review/review-queue-client.tsx`, `src/components/pages/pages-selected-detail.tsx`, `src/app/(shell)/pages/issue-actions.ts`, `src/lib/seed-data.ts`, `src/domains/product/priority-engine.ts`, `src/domains/pages/frontier-planner.ts`, `src/domains/brief-generation/builders.ts`, `src/domains/actions/builders.ts`, `src/domains/opportunity-candidates/builders.ts`, `src/domains/attribution/change-impact.ts`, `src/domains/attribution/scorecard.ts`, `src/app/(shell)/diagnostics/page.tsx`, `src/domains/attribution/result-drivers.ts` (module comment), `src/domains/entity/discrepancy-detect.ts` (module comment).
- **Still deferred (unchanged by this task):** 1.1j rows 12–14 — `/settings/methodology` route, Layer 2/3 methodology links dependent on that route, coverage escalation implementation (spec-only).
- **Verification:** `npm run typecheck` ✓ · `npm run test` 82/82 ✓ · `npm run build` ✓.
- **Docs:** `HANDOFF_VERIFIED_STATE.md`, `NEXT_PHASE_EXECUTION_PLAN.md`, `VERIFICATION_LOG.md` (this entry), `master_execution_plan.md` (1.1j note), `TIER_1_1J_EXIT_GATE_CHECKLIST.md` (§8 completion note).

---

## 2026-04-12 — Tier 1.1j: Exit gate checklist (Proof layer completion audit)

- **Deliverable:** `docs/TIER_1_1J_EXIT_GATE_CHECKLIST.md` — cross-surface audit of all Tier 1.1 proof-layer requirements against the shipped codebase.
- **Final gate decision:** **READY WITH MINOR GAPS.**
- **Methodology access:** L1 inline proof present on all Tier-1 surfaces (Today, Market, Changes, Findings). L2/L3 links deferred pending `/settings/methodology` route (1.1c follow-through). **PASS.**
- **Lineage on primary claims:** All primary claims have lineage — evidence-quality framing (Today), denominator + sample tier (Market), match/topic/window scope (Changes), provenance lines (Findings), `confidence_basis` (Changes detail). **All PASS.**
- **Forbidden claims audit:** Searched entire `src/` for F1–F19 violations.
  - **Clean on Tier-1 surfaces:** `ConfidenceBadge` labels ("Strongest correlate"), Market KPI ("Citation Share" + denominator), Today recommendation ("Strong evidence"), `beacon-proof-copy.ts` ("not proven causes").
  - **14 deferred strings on non-primary surfaces:** `candidate-review.tsx` ("caused", "drove"), `recommendation-engine.ts` ("Proven", "drove visibility"), `replication-engine.ts`/`replication-cards-client.tsx` ("Validated winner", "high-confidence"), `scorecard-client.tsx` ("Proven winners" tab), `changes/page.tsx` ("high-confidence impact"), `pages-selected-detail.tsx` ("Likely causes"), `seed-data.ts` ("will improve"). All safe to defer.
- **Copy consistency:** All P0 patterns consistent — badge labels, evidence framing, denomination, sample quality, attribution methodology. **PASS.**
- **Coverage escalation readiness:** All surfaces have structural slots for escalation (scope lines, coverage strips, demo-mode gates, suppressible content). **PASS.**
- **Provenance fields:** 3/3 required v1 fields surfaced (`sample_quality_tier`, `match_count`, `topic_count`) + 2 bonus fields (`window_basis`, `relativeAge` extension). **PASS.**
- **Highest-risk re-check:** Attribution (PASS on Tier-1), Market KPI (PASS), Recommendations (PASS on Today).
- **Blocking gaps:** None.
- **No app code changes.**

---

## 2026-04-12 — Tier 1.1i: Coverage escalation rules (documentation only)

- **Deliverable:** `docs/TIER_1_1I_COVERAGE_ESCALATION_RULES.md` — defines how Beacon detects and escalates stale or incomplete data across all Tier-1 surfaces.
- **Coverage states defined:** 4 — **Fresh** (all signals current, sample adequate+), **Aging** (approaching stale or limited sample), **Stale** (beyond freshness window), **Critical** (severely outdated or absent).
- **Trigger rules:** 4 rules with top-down precedence (Critical > Stale > Aging > Fresh). Uses only existing/derivable fields: `crawlAgeDays`, `crawlStale`, `visibilityStaleVsCrawl`, `visibilityPartialSample`, `sample_quality_tier`, `isDemoMode`, `lastImportAt`.
- **Key thresholds:** crawl >3d → Aging, >14d → Stale, >30d → Critical. Sample <200 → Aging. Import >30d → Stale. Demo mode → Critical.
- **Per-surface behavior:** Behavior tables defined for Today (primary action, findings, all-clear, proof panel, coverage strip), Market (KPIs, scope line, sample tier, sections), Changes (scope line, attribution labels, verdicts, observation window), Findings (provenance lines, actionability, basis block).
- **Escalation levels:** 3 — inline note (Aging), warning strip (Stale), suppression/gate (Critical).
- **Copy transformations:** Concrete transformations for confidence labels, scope/denominator lines, all-clear logic, finding provenance, recommendation headlines.
- **Edge cases handled:** Zero data, fresh crawl + limited sample, fresh crawl + stale visibility, fresh visibility + stale crawl, rapid recency + low coverage, conflicting surface states, operator overrides (not supported v1).
- **Integration approach:** Recommends new `CoverageState` type alongside existing `CoverageTone` for backward compatibility. Safest path: extend `deriveCoverageTone()` or add parallel `deriveCoverageState()`.
- **Source artifacts used:** 1.1a (signal class 13, forbidden claims F7/F18), 1.1c (§6 escalation table), 1.1d (fields 5, 18–20), 1.1h (Q5, Q6, Q7, Q12, Q16).
- **No app code changes.** Documentation only.

---

## 2026-04-12 — Tier 1.1h: Adversarial owner FAQ (documentation only)

- **Deliverable:** `docs/TIER_1_1H_ADVERSARIAL_OWNER_FAQ.md` — 16 skeptical operator questions with structured answers grounded in Beacon's actual evidence boundaries.
- **Questions covered:** 16 (spec required ≥12). Covers: change detection (Q1), attribution/causation (Q2, Q9, Q13), percentage trust (Q3), sample-vs-market (Q4), staleness (Q5), prompt count (Q6), AI variability (Q7), recommendation certainty (Q8), competitor rankings (Q10), coverage gaps (Q11), sample quality (Q12), sharing numbers (Q14), no confidence interval (Q15), changed-since-crawl (Q16).
- **Highest-risk FAQ callouts:**
  1. **Attribution / causation** — Q2 primary, Q9 + Q13 supporting. Maps to F1, F5, F9.
  2. **Market denominator / scope** — Q4 primary, Q3 + Q6 + Q12 supporting. Maps to F2, F7, F8.
  3. **Recommendation certainty** — Q8 primary, Q7 + Q15 supporting. Maps to F4, F17.
- **Forbidden claims addressed:** 14 of 19 directly referenced in FAQ answers. Remaining 5 (F11, F12, F13, F14, F18) covered by principles in Q5, Q1, and tone guidance.
- **Answer format (per question):** Short answer → What Beacon knows → What Beacon does not know → How derived → Where to verify in-product → Related signal classes → Stale/partial impact.
- **Methodology-shell mapping included:** Per-surface entry-point table mapping each FAQ to Today, Changes, Market, Findings, and `/settings/methodology` sections with layer (L1/L2/L3) and priority.
- **Copy/tone guidance:** Calm, precise, non-defensive, anti-marketing, proof-first. Explicit word lists for use/avoid.
- **Implementation notes:** P0/P1 inline targets (Q2, Q3, Q8, Q9, Q12) vs P2/P3 destination-only entries. Deferred items documented for post-1.1i/1.1j.
- **Source artifacts used:** 1.1a (signal taxonomy + forbidden claims), 1.1b (competitor trust patterns), 1.1c (methodology shell IA), 1.1d (provenance metadata spec).
- **No app code changes.** Documentation only.

---

## 2026-04-12 — Tier 1.1g: Wire lineage into crawl findings and attribution surfaces (class 1 + 5)

- **Goal:** Extend proof-layer lineage to **crawl findings (class 1)** and **attribution surfaces (class 5)** using only derivable fields. No schema changes, no scoring changes, no new stores.
- **A — Crawl findings provenance (class 1):** **`src/components/today/today-findings.tsx`**
  - **`relativeAge(iso)`:** New helper derives human-readable age from `detectedAt` (e.g. "2h ago", "3d ago", "just now").
  - **With provenance block:** Appended `· Observed {relativeAge}` to existing "Basis:" line — freshness visible alongside scan run context.
  - **Without provenance block:** New fallback line `Observed in latest crawl · {relativeAge}` ensures every finding gets a provenance line.
  - **All fields derivable:** `detectedAt` already on every `SerializedFinding`.
- **B — Attribution list window_basis (class 5 list):** **`src/app/(shell)/changes/scorecard-client.tsx`**
  - **`observationWindowLabel`:** Derived via `useMemo` from `rows.flatMap(r => r.eventAttributions.map(a => a.event.trigger_date))`. Produces "Window: Mar 1 – Apr 5 (35d)" or null when no events or single-day span.
  - **UI:** Appended to existing scope line as `· Window: …` after match/topic counts.
  - **Per-row window:** Each `ScorecardRowUI` event attributions column shows `over Nd window` when event dates span > 0 days.
  - **All fields derivable:** `trigger_date` already on every `OutcomeEvent` in `eventAttributions`.
- **C — Attribution detail window (class 5 detail):** **`src/lib/attribution-confidence-basis.ts`**
  - **`deriveObservationWindow(attributions)`:** New helper extracts earliest/latest `trigger_date` from row's `eventAttributions`, produces "observed over Nd" when span > 0.
  - **`buildAttributionConfidenceBasis(row)`:** Extended to append observation window as last part of basis string (e.g. "3 linked matches · 2 topics · … · observed over 14d").
  - **All fields derivable:** `trigger_date` already on every `OutcomeEvent`.
- **No schema changes. No new stores. No scoring changes.**
- **Gate:** `npm run typecheck` ✓ · `npm run test` 82/82 ✓ · `npm run build` ✓.
- **Files touched:** `src/components/today/today-findings.tsx`, `src/app/(shell)/changes/scorecard-client.tsx`, `src/lib/attribution-confidence-basis.ts`.

---

## 2026-04-12 — Tier 1.1f: Lineage fields implementation (derivable v1 only)

- **Spec:** **`docs/TIER_1_1D_PROVENANCE_METADATA_SPEC.md`** — implemented only derivable v1 fields; **no schema changes**, **no new persistence**, **no scoring/verdict/recommendation logic changes**.
- **A — Market `sample_quality_tier`:** **`src/app/(shell)/competitors/page.tsx`**
  - **Derivation:** `sampleQualityTierFromObservationCount(benchmark.trackedCitationObservations)` from **`src/lib/sample-quality-tier.ts`**.
  - **Thresholds:** `&lt; 200` → **limited**, `200`–`1000` (inclusive) → **moderate**, `&gt; 1000` → **strong** (constants `SAMPLE_QUALITY_LIMITED_BELOW` = 200, `SAMPLE_QUALITY_MODERATE_AT_OR_BELOW` = 1000).
  - **UI:** Calm line below directional scope: `Sample quality: limited | moderate | strong`.
- **B — Changes list `match_count` + `topic_count`:** **`src/app/(shell)/changes/scorecard-client.tsx`**
  - **`match_count`:** `workspaceLinkedMatchTotal = rows.reduce((sum, r) => sum + r.totalEventsLinked, 0)` (sum of linked outcome matches across all scorecard rows).
  - **`topic_count`:** `workspaceDistinctTopicCount = new Set(rows.flatMap((r) => r.topics)).size`.
  - **UI:** Muted scope line between Outcome mix `<details>` and filters — `Based on N linked matches across M topics.` Fallbacks when `N === 0` or `M === 0` per spec.
- **C — Changes detail `confidence_basis`:** **`src/app/(shell)/changes/[id]/page.tsx`** + **`src/lib/attribution-confidence-basis.ts`**
  - **`buildAttributionConfidenceBasis(row)`:** Joins `totalEventsLinked`, topic count, platform count, short evidence tier label, `daysSinceChange`, and optional primary-role match summary (`topic`/`url`/`temporal` strengths from `matches`).
  - **UI:** Outcome summary "Confidence" plain text replaced with **`ConfidenceBadge`** (`@/components/display/confidence-badge`) + `explanation={buildAttributionConfidenceBasis(row)}`; label column title **Attribution fit**.
- **Reliability:** **`tests/routes/today-smoke.test.ts`** — test timeout **5000ms → 15000ms** for flaky `TodayPage()` RSC resolution (not lineage-related).
- **Gate:** `npm run typecheck` ✓ · `npm run test` 82/82 ✓ · `npm run build` ✓.
- **Files touched:** `src/lib/sample-quality-tier.ts` (new), `src/lib/attribution-confidence-basis.ts` (new), `src/app/(shell)/competitors/page.tsx`, `src/app/(shell)/changes/scorecard-client.tsx`, `src/app/(shell)/changes/[id]/page.tsx`, `tests/routes/today-smoke.test.ts`.

---

## 2026-04-12 — Tier 1.1d: Provenance metadata spec (documentation only)

- **File created:** **`docs/TIER_1_1D_PROVENANCE_METADATA_SPEC.md`** — minimum viable provenance/lineage metadata spec for Beacon's proof layer.
- **Provenance field inventory:** 21 fields defined across 3 categories (core, attribution/impact, coverage/freshness).
- **Field status breakdown:**
  - **Already exist and reusable:** 19 fields across `TodayProofContext`, `MarketBenchmark`, `CoMentionMatrix`, `SourceTrustIndex`, `ScorecardRow`, `Finding`, `MilestoneEvent`, `LocalOperatorSurface`
  - **Derivable without schema changes:** 10 fields (`sample_quality_tier`, `match_count`, `topic_count`, `platform_count`, `confidence_basis`, `window_start`, `coverage_note`, `freshness_basis`, topic count for benchmark, per-recommendation basis)
  - **Require future schema/type additions:** 4 fields (`confidenceBasis` on `BeaconRecommendation`, `computedAt` on `BeaconRecommendation`, `source_import_batch_id` on `CitationEvidenceIndex`, optional `computedAt` on `ScorecardRow`)
- **14 signal classes mapped:** minimum required provenance, optional later fields, and current gaps for each.
- **Top 3 missing provenance fields (highest priority):**
  1. **`confidence_basis`** — needed on Changes detail ConfidenceBadge `explanation` prop and Today primary action. Currently empty.
  2. **`match_count` + `topic_count`** (scorecard-level) — needed for Changes scope line. Derivable from existing `ScorecardRow` fields.
  3. **`sample_quality_tier`** — needed for Market KPI "small sample" conditional warning. Derivable from `trackedCitationObservations` + thresholds.
- **5 surfaces prioritized for v1 provenance wiring:** Market KPI strip, Changes scorecard header, Changes detail ConfidenceBadge, Today primary action, Methodology destination.
- **Minimum v1 implementation slice:** 3 derivable fields (`sample_quality_tier`, `match_count`, `topic_count`) + `confidence_basis` wiring. Zero schema changes needed.
- **4 places where current wording outruns provenance:** Changes ConfidenceBadge (empty explanation), Today primary action (no detail after "Strong evidence"), Market KPI (no small-sample warning), Changes scorecard (no scope line).
- **Implementation handoff:** 7 files identified as likely touch targets for 1.1f; derivable-first approach recommended; threshold constants should be exported and tested.
- **No app code changed.**
- **Downstream:** 1.1f (lineage fields implementation) can proceed immediately using derivable-first approach. No schema migrations needed for v1.

---

## 2026-04-12 — Tier 1.1e: Confidence & uncertainty copy deck (P0 trust fixes)

- **What changed:** All three P0 trust-critical copy changes from 1.1c implemented. Copy only — no domain logic, no data changes.
- **Gate:** `npm run typecheck` ✓ · `npm run test` 82/82 ✓ · `npm run build` ✓ (17 static + 4 dynamic)
- **P0 Change 1 — ConfidenceBadge (F1 fix):**
  - File: `src/components/display/confidence-badge.tsx`
  - `high` label: "Likely caused by" → **"Strongest correlate"**
  - `medium` label: "Possibly related to" → **"Possible correlate"**
  - `low` and `uncertain` labels unchanged (already safe)
- **P0 Change 1b — Changes detail CONF_LABELS + ROLE_LABELS:**
  - File: `src/app/(shell)/changes/[id]/page.tsx`
  - `CONF_LABELS`: "High confidence" → **"Strong evidence"**, "Medium confidence" → **"Moderate evidence"**, "Low confidence" → **"Weak evidence"**
  - `ROLE_LABELS`: "Primary Cause" → **"Strongest Match"**, "Contributing Factor" → **"Contributing Match"**
  - `IMPACT_CONF_STYLE`: "High" → **"Strong evidence"**, "Medium" → **"Moderate evidence"**, "Low" → **"Weak evidence"**
  - Replicate section copy: "This change drove positive visibility" → **"This change correlates with positive visibility shifts"**
- **P0 Change 2 — Market KPI strip (F2 fix):**
  - File: `src/app/(shell)/competitors/page.tsx`
  - KPI label: "Your AI Share" → **"Your Citation Share"** (avoids unqualified "market share" metaphor — anti-pattern A5)
  - KPI meta: "Across all tracked topics" → **"of N observations"** (denominator disclosure — pattern P1)
  - "Ahead of You" meta: "On raw citation count" → **"of N tracked competitors"** (scope qualifier)
  - New directional scope line added below KPI strip: **"Directional — based on your tracked prompt sample, not a market census."** (pattern P2)
- **P0 Change 3 — Today recommendation (F17 fix):**
  - File: `src/components/today/today-primary-action.tsx`
  - Confidence label: `"{confidence} confidence"` → **"Strong evidence" / "Moderate evidence" / "Early signal"** (evidence-quality framing)
- **Proof copy update:**
  - File: `src/lib/beacon-proof-copy.ts`
  - Attribution text: "correlation and best-fit causes" → **"strongest correlates, not proven causes — no A/B test or holdout exists"**
- **Diagnostics page:** `StatBlock label="High confidence"` left unchanged — technical debug context, not operator-facing trust claim.
- **Files changed (5):**
  - `src/components/display/confidence-badge.tsx`
  - `src/app/(shell)/changes/[id]/page.tsx`
  - `src/app/(shell)/competitors/page.tsx`
  - `src/components/today/today-primary-action.tsx`
  - `src/lib/beacon-proof-copy.ts`
- **Forbidden claims addressed:** F1 (causal attribution language), F2 (unqualified market share), F17 (high confidence on recommendation)
- **1.1b patterns applied:** P1 (denominator disclosure), P2 (directional framing), P3 (correlational badge labels), A5 avoided (unqualified "market share")

---

## 2026-04-12 — Tier 1.1c: In-product methodology shell IA (documentation only)

- **File created:** **`docs/TIER_1_1C_METHODOLOGY_SHELL_IA.md`** — Proof-layer information architecture for Beacon's methodology shell.
- **IA model chosen:** 4-layer progressive disclosure:
  - **L1 — Inline micro-proof:** Denominators, qualifiers, one-word trust signals (always visible, muted text).
  - **L2 — Local disclosure:** Collapsed `<details>` blocks per section ("How we know this"). Model: `HowWeKnowPanel`.
  - **L3 — Surface-level entry:** Persistent links from each surface to the methodology destination.
  - **L4 — Methodology destination:** `/settings/methodology` with per-signal-class methodology + "What Beacon does not claim" section.
- **Methodology destination model:** Settings subpage at `/settings/methodology` (not standalone route, not modal/drawer). Reasons: methodology is reference material, not daily workflow; preserves 5-item nav; linkable with section anchors.
- **Entry points mapped:** 11 new entry points across Today, Pages, Changes (list + detail), Market, and Shell:
  - **P0 (highest priority):** Market KPI denominator + scope line, ConfidenceBadge label change, Today recommendation qualifier.
  - **P1:** Market `<details>` methodology block, Changes scorecard scope line + `<details>` block, Market section scope notes (source trust, co-mention, "Ahead of You").
  - **P2:** Pages `HowWeKnowPanel` wiring, `HowWeKnowPanel` footer methodology link, `DataFreshnessStrip` methodology icon-link, Change detail attribution methodology link.
- **Minimum v1 shell defined (5 items):**
  1. `ConfidenceBadge` label change: "Likely caused by" → "Strongest correlate" (copy only).
  2. Market KPI denominator: promote `trackedCitationObservations` + directional scope line.
  3. Today recommendation qualifier: evidence-quality framing replaces raw confidence word.
  4. Methodology destination: `/settings/methodology` with 5 sections (overview, your data, per-metric computation, not-claimed, glossary).
  5. Layer 3 wiring: "How this works →" links from Market, Changes, `HowWeKnowPanel` to destination.
- **Denominator/scope-note system designed:** 6 percentage metrics requiring denominators, 6 section-level scope labels, 4 stale/partial escalation conditions, 3-tier sample quality indicator (Small/Adequate/Robust).
- **Implementation handoff:** 11 files identified for future changes, recommended implementation order (1.1e copy first → destination → wiring → disclosures → Pages panel).
- **Data dependencies documented:** 7 data points available today, 3 needed from 1.1f lineage work.
- **No app code changed.**
- **Downstream:** 1.1e (copy deck) can proceed immediately using this IA as its placement guide. 1.1d and 1.1f are unblocked but independent.

---

## 2026-04-12 — Tier 1.1b: Competitor trust patterns desk research (documentation only)

- **File created:** **`docs/TIER_1_1B_COMPETITOR_TRUST_PATTERNS.md`** — Proof-layer competitor trust comparison memo.
- **Products researched:** Peec AI, Profound, Writesonic GEO, Otterly.ai, TSM GEO Framework, Aether AI.
- **Sources reviewed:** Product docs/help centers, methodology pages, MSAs/legal terms, blog posts, independent third-party reviews (Cairrot, Discovered Labs, Aether Insights).
- **Top 3 recommended trust patterns to adopt:**
  1. **P1 — Denominator disclosure** on all percentage metrics (from Profound's formula documentation pattern).
  2. **P3 — Downgrade ConfidenceBadge** from causal ("Likely caused by") to correlational ("Strongest correlate") — no competitor uses causal attribution language; Beacon is uniquely exposed.
  3. **P4 — Scope line on every computed section** ("Based on N observations across M topics from your imported sample") — exceeds the industry bar; modeled on Otterly.ai research methodology.
- **Top 3 patterns to avoid:**
  1. **A1 — Legal-only disclaimers** (Profound anti-pattern) — disclaimers in MSA that never reach the product UI.
  2. **A2 — Overconfident marketing copy** (Writesonic anti-pattern) — "See exactly where you rank" without sampling caveats.
  3. **A5 — Unqualified "market share" metaphor** — even Peec hedges with "like market share"; Beacon should use "citation share" or add a qualifier.
- **Beacon strengths identified vs. competitors:** In-product `HowWeKnowPanel` (no competitor has equivalent), explicit correlation-not-causation language in code, `CoverageTone` freshness signaling, `LocalProof` observed/inferred separation.
- **Beacon weaknesses identified vs. competitors:** "Likely caused by" badge (unique in market, uniquely risky), market share without prominent denominator, no sample-size or margin-of-error disclosure, "high confidence" on recommendations, methodology not linked from Market/Changes surfaces.
- **Implications documented for 1.1c (methodology shell IA):** entry points needed on Market + Changes + recommendation cards; per-surface methodology pattern; scope notes at section level.
- **Implications documented for 1.1e (confidence/uncertainty copy deck):** Priority 1 = ConfidenceBadge label change; Priority 2 = Market KPI denominator + directional qualifier; Priority 3 = recommendation confidence reframing; lexicon provided.
- **No app code changed.**
- **Downstream:** 1.1c (methodology shell IA) and 1.1e (confidence/uncertainty copy deck) are now fully informed by both 1.1a + 1.1b deliverables.

---

## 2026-04-12 — Tier 1.1a: Signal taxonomy audit (documentation only)

- **File created:** **`docs/TIER_1_1A_SIGNAL_TAXONOMY.md`** — Proof-layer foundation document.
- **Signal classes identified:** **14** — crawl findings, guardrail alerts, imported visibility measurements, citation evidence index, attribution scoring, change verdicts & impact, market benchmark, competitor intelligence (co-mention / source trust / battlecards / discovery), geo coverage, recommendations & priority scoring, milestones / all-time highs, entity discrepancies, coverage & freshness signals, local operator signals.
- **Forbidden claims catalogued:** **19** (6 critical, 6 high, 7 medium) — consolidated in a single reference list with signal class cross-references.
- **Highest-risk claim areas found:**
  1. **Attribution confidence labels** — `ConfidenceBadge` says "Likely caused by" for `high` confidence, implying causation from correlation evidence (F1).
  2. **Market share percentages** — "Your AI Share: X%" shown without prominent sample-size qualifier (F2).
  3. **Recommendation confidence** — "high confidence" on a recommendation conflates evidence strength with outcome certainty (F17).
- **Provenance gap map:** tabulated per signal class — which have source timestamps, run/batch ids, sample sizes, staleness checks, and where lineage metadata is missing (feeds 1.1f).
- **Existing trust controls assessed:** 10 controls documented (e.g. `BEACON_METHODOLOGY`, `HowWeKnowPanel`, `CoverageTone`, `LocalProof` observed/inferred/dataGaps). `source-trust.ts` and `local-operator/types.ts` identified as trust-model exemplars.
- **No app code changed.**
- **Audited files:** 33 source files across `src/lib/`, `src/domains/scanning/`, `src/domains/pages/`, `src/domains/competitors/`, `src/domains/attribution/`, `src/domains/milestones/`, `src/domains/product/`, `src/domains/entity/`, `src/domains/local-operator/`, `src/domains/geo/`, `src/components/`.
- **Downstream:** 1.1b (competitor trust patterns) and 1.1c (methodology shell IA) are now unblocked by this deliverable.

---

## 2026-04-12 — Tier 1.1 execution target locked (planning only)

- **Selected slice:** **Tier 1.1 — Proof layer** → entry step **1.1a — Signal taxonomy audit**.
- **Why first:** The `master_execution_plan.md` priority law states "Finish Tier 1 tracks **1.1 → 1.5** in order." Track 1.1 (Proof layer) is the first listed track. Within 1.1, step **1.1a** is the only step with `Depends on: none` — all subsequent steps (1.1b–1.1j) depend on 1.1a.
- **What 1.1a delivers:** Markdown matrix: signal class → source artifact → UI surface(s) → user-facing claim allowed. Plus a "forbidden claims" list. Done when matrix reviewed.
- **Scope for 1.1a:** Read/audit existing proof infrastructure: `src/lib/beacon-proof-copy.ts`, `src/lib/today-proof-context.ts`, `src/lib/today-proof-serialize.ts`, `src/components/today/how-we-know-panel.tsx`, `src/components/display/confidence-badge.tsx`, `src/domains/results/visibility-provenance.ts`, `src/domains/attribution/types.ts` (confidence levels), `src/domains/scanning/` (finding generation), `src/domains/pages/` (guardrails, snapshots, citation evidence). Deliverable is a doc, not app code.
- **Explicitly deferred:** 1.1b (competitor trust patterns), 1.1c (methodology shell IA), 1.1d–1.1j (all depend on 1.1a). Tracks 1.2–1.5 and all of Tier 2. Module-cache invalidation (unrelated to proof layer). No app code changes for 1.1a.
- **No app code changes for this planning step.**

---

## 2026-04-12 — Phase 5-10: Full gate verification + Phase 5 close-out

- **Gate run:** **`npm run typecheck`** — pass (clean). **`npm run test`** — pass **82**/82, **20** test files (Vitest **v4.1.3**). **`npm run build`** — pass; route table **17** static (○) + **4** dynamic (ƒ); no unexpected missing routes in build output.
- **Phase 5 regression checklist (no code changes this step):** **`src/lib/logger.ts`** — present. **5-2** scan logging — **`src/domains/scanning/orchestrate-scan.ts`**. **5-3** import logging — **`src/lib/import/actions.ts`**. **5-4** server-action logging — unchanged from prior phase entries. **5-5**–**5-8** smokes — **`tests/routes/today-smoke.test.ts`**, **`pages-smoke.test.ts`**, **`changes-smoke.test.ts`**, **`market-smoke.test.ts`** all included in suite. **5-9** stale-running — **`scan-state.ts`** (`STALE_SCAN_THRESHOLD_MS`, `isScanRunningAndFresh`), **`orchestrate-scan.ts`** (guard + recovery), **`scan-status-action.ts`** (stale UI normalization).
- **Final test count:** **82** (matches repo state at close-out).
- **Phase 5:** **COMPLETE** (steps **5-1** through **5-10**). **Next phase pointer:** Launch plan in **`NEXT_PHASE_EXECUTION_PLAN.md`** has no **Phase 6**; follow **`Future Roadmap: Tiered Product Stack`** (e.g. Tier **1.1**) or **`master_execution_plan.md`** for subsequent priorities.

---

## 2026-04-12 — Phase 5-9: Scan crash recovery (stale-running detection)

- **Files changed:**
  1. **`src/domains/scanning/scan-state.ts`** — added **`STALE_SCAN_THRESHOLD_MS`** (5 min / 300 000 ms), **`runningScanAgeMs(state)`** (returns age in ms when `phase === "running"`, else `null`; uses `updatedAt` ISO field), **`isScanRunningAndFresh(state)`** (true when running and age < threshold).
  2. **`src/domains/scanning/orchestrate-scan.ts`** — guard block at top of **`runWebsiteScan`**: reads `readScanState()` before starting. If `phase === "running"` and **fresh** → early return `{ ok: false, phase: "running", error: "A scan is already in progress" }` (duplicate guard). If `phase === "running"` and **stale** (age ≥ threshold) → writes failed payload via `writeIdleScanStateFromLastResult`, then proceeds to start new scan normally.
  3. **`src/app/(shell)/scan-status-action.ts`** — `getScanStatus()` normalizes stale `running` → `{ phase: "failed", message: "Previous scan appears to have crashed — ready to retry" }` so client UI never shows "scanning" indefinitely.
- **Timestamp/age field used:** **`updatedAt`** (ISO string on `ScanStateFile`) — set when `writeRunningScanState` is called at scan start. No new fields added.
- **Threshold:** **5 minutes** (300 000 ms) — CLI timeout is 120 s; 5 min gives generous headroom for process overhead and finding regeneration.
- **Recovery mechanism:** Stale state is written to terminal `failed` phase (via `writeIdleScanStateFromLastResult` with a descriptive `cliError`) before the new scan writes `running`. This ensures clean state transition, no dual-running risk.
- **Logger events added:**
  - `log.warn("Scan already running", { runId, trigger })` — duplicate guard (fresh running scan blocks new start)
  - `log.warn("Scan marked stale", { runId, ageMs, thresholdMs })` — stale detection
  - `log.info("Recovered stale scan state", { runId })` — after recovery write
- **Normal active-scan behavior:** Unchanged. All paths below the guard (CLI exec, failure handling, finding regeneration, terminal state writes) are identical.
- `npm run typecheck` — pass; `npm run test` — **82**/82 pass; `npm run build` — pass.

---

## 2026-04-12 — Phase 5-8: Market route smoke test

- **File added:** **`tests/routes/market-smoke.test.ts`** — same pattern as **5-5**–**5-7**: **`vi.mock("next/cache")`**, dynamic **`import("@/app/(shell)/competitors/page")`**, **`await CompetitorsPage()`**, **`renderToStaticMarkup`**.
- **Markers asserted:** (1) **`max-w-4xl`** — root wrapper in **`src/app/(shell)/competitors/page.tsx`** (import-empty + full Market). (2) **`Who beats you, where they beat you, and exactly what to do about it.`** — **`PageHeader`** `description` on that file (stable RSC copy; not competitor names or KPI counts).
- **Client stub:** **Yes** — five **`vi.mock`** stubs under **`@/app/(shell)/competitors/`**: **`competitors-manage-client`**, **`co-mention-section`**, **`source-trust-section`**, **`local-pressure-section`**, **`battlecard-section`** (each **`"use client"`** with hooks; full Market path can render them when data exists).
- `npm run typecheck` — pass; `npm run test` — **82**/82 pass; `npm run build` — pass.

---

## 2026-04-12 — Phase 5-7: Changes route smoke test

- **File added:** **`tests/routes/changes-smoke.test.ts`** — same pattern as **5-5** / **5-6**: **`vi.mock("next/cache")`**, dynamic **`import("@/app/(shell)/changes/page")`**, **`await ChangeScorecardPage()`**, **`renderToStaticMarkup`**.
- **Markers asserted:** (1) **`What worked. What to scale. Why visibility moved.`** — **`PageHeader`** `description` on **`changes/page.tsx`** for both demo and full branches. (2) **`flex items-start justify-between gap-4 mb-8`** — outer wrapper class from **`src/components/data/page-header.tsx`** (structural; not scorecard counts).
- **Client stub:** **Yes** — **`vi.mock("@/app/(shell)/changes/changes-tab-shell")`** → empty stub div (**`ChangesTabShell`** is **`"use client"`**).
- **Note:** Changes root has **no** **`max-w-*`** wrapper (unlike Today **`max-w-3xl`** / Pages **`max-w-5xl`**), so smoke uses **`PageHeader`** layout + copy instead.
- `npm run typecheck` — pass; `npm run test` — **81**/81 pass; `npm run build` — pass.

---

## 2026-04-12 — Phase 5-6: Pages route smoke test

- **File added:** **`tests/routes/pages-smoke.test.ts`** — mirrors **`today-smoke.test.ts`**: **`vi.mock("next/cache")`**, dynamic **`import("@/app/(shell)/pages/page")`**, **`renderToStaticMarkup`**.
- **Markers asserted:** **`max-w-5xl`** (wrapper in **`src/app/(shell)/pages/page.tsx`** for demo + full); **`Health, citations, and the next step for each URL.`** (same file — route subtitle; stable, not row/timestamp data).
- **Client stub:** **Yes** — **`vi.mock("@/app/(shell)/pages/pages-client")`** replaces **`PagesClient`** with a hook-free stub (same reason as **`TodayClient`** in **5-5**).
- `npm run typecheck` — pass; `npm run test` — **80**/80 pass; `npm run build` — pass.

---

## 2026-04-12 — Phase 5-5: Today route smoke test

- **File added:** **`tests/routes/today-smoke.test.ts`** (Vitest, same **`tests/**/*.test.ts`** include as existing suite).
- **What runs:** Dynamic **`import("@/app/(shell)/page")`** → default **`TodayPage`** (RSC) → **`await TodayPage()`** runs real **`loadTodayPageData()`** and returns JSX; **`react-dom/server`** **`renderToStaticMarkup`** for assertions.
- **Markers asserted:**
  1. **`max-w-3xl`** — literal wrapper class from **`src/app/(shell)/page.tsx`**; stable across demo/real data and copy edits.
  2. **`Since last scan`** — canonical Today findings section title in **`src/components/today/today-findings.tsx`**; surfaced here via a **minimal `TodayClient` mock** (real **`TodayClient`** uses client hooks and does not static-render under Vitest without a client runtime).
- **`vi.mock`:** **`next/cache`** (`revalidatePath` no-op), **`@/app/(shell)/today-client`** (stub div text only).
- **Why stub:** Deterministic, fast smoke of **data prep + page composition** without introducing **`@testing-library`** or a dev-server **`fetch`** dependency.
- `npm run typecheck` — pass; `npm run test` — **79**/79 pass; `npm run build` — pass.

---

## 2026-04-12 — Phase 5-4: structured logging on shared server actions

- **Pattern:** At each exported async server action entry: **`log.info("Action started", { action, params })`** → terminal **`log.info("Action completed", { action, durationMs })`** or **`log.error("Action failed", { action, durationMs, error })`**. **`action`** = stable string (e.g. **`triggerScan`**, **`saveSetup`**). No signature or control-flow changes beyond log lines and **`Date.now()`** timers.
- **Context rules:** **`params`** limited to IDs, status enums, **`Object.keys(patch)`**, string **lengths**, row counts, **`entryCount`**, **`briefCount`**, flags — no large payloads, no secrets.
- **Shell / app routes:** **`src/app/(shell)/trigger-scan-action.ts`** (`triggerScan`), **`pages/scan-action.ts`** (`triggerPageScan`), **`recommendation-actions.ts`**, **`experiment-actions.ts`** (3), **`finding-actions.ts`** (3), **`settings/config/actions.ts`** (`saveSetup` only), **`pages/wave-actions.ts`** (3), **`pages/issue-actions.ts`** (5), **`pages/verify-action.ts`** (`verifyPageFix`), **`topics/package-actions.ts`** (4), **`competitors/competitors-actions.ts`**, **`changes/contract-actions.ts`** (`createChangeContract`, **`verifyChangeContract`**).
- **Import module (additive to 5-3):** **`src/lib/import/actions.ts`** — **`previewImport`**, **`clearEntityData`**, **`clearImportedData`**, **`resetExperiment`**, **`postImportSetup`**. **`executeImport`** / **`importWorkbook`** left on **`Import *`** logs only.
- **Domains / adapters:** **`domains/actions/actions.ts`**, **`domains/attribution/candidate-actions.ts`** (5), **`domains/changelog/actions.ts`**, **`domains/results/actions.ts`**, **`domains/briefs/actions.ts`** (5), **`domains/opportunities/actions.ts`** (4), **`domains/opportunity-candidates/actions.ts`**, **`domains/brief-generation/actions.ts`** (3), **`adapters/profound/actions.ts`** (`importProfoundData` — failure uses **`result.errors[0]`**).
- **Skipped:** **`getScanStatus`** (polling), **`loadSetup`** (read), **`executeImport`/`importWorkbook`** (duplicate lifecycle), inline **`use server`** in **`pages/page.tsx`** / **`topics/page.tsx`**.
- `npm run typecheck` — pass; `npm run test` — **78**/78 pass; `npm run build` — pass.
- **Manual action + log verification:** not run (gate green).

---

## 2026-04-12 — Phase 5-3: import engine logging (entry points)

- **File:** **`src/lib/import/actions.ts`** only — **`import { log } from "@/lib/logger"`**.
- **`executeImport`:** **`Import started`** (`runId` = **`generateId("imp")`**, **`source: "upload"`**) immediately after batch id + wall clock **`t0`**; CSV/JSON parse failure → **`Import failed`** (`durationMs`, truncated parse **`error`**) before early return; after existing persist/revalidate path, **`imported > 0`** → **`Import completed`** (`rowCount` = **`imported`**); otherwise **`Import failed`** (`error` from first row validation message or fixed “No data rows” / “No rows imported”).
- **`importWorkbook`:** missing **`File`** → **`Import failed`** only (`runId: ""`, **`error: "No file provided"`**); otherwise **`Import started`** then workbook parse catch → **`Import failed`**; successful path → **`Import completed`** with **`rowCount: run.imported_count`** (no new totals computed for logs).
- **`source`:** **`upload`** for both functions (operator-driven import UI). **`api`** not used until a programmatic entry point exists.
- **Not instrumented:** **`previewImport`**, **`postImportSetup`**, **`getImportRuns`**, clears/resets, dual-write / domain modules.
- **Behavior:** Logging and **`t0`** only; return shapes and control flow unchanged.
- `npm run typecheck` — pass; `npm run test` — **78**/78 pass; `npm run build` — pass.
- **Manual import + log verification:** not run (gate green).

---

## 2026-04-12 — Phase 5-2: scan orchestrator logging

- **Module:** **`src/domains/scanning/orchestrate-scan.ts`** — **`runWebsiteScan` only** (no changes to **`trigger-scan-action`**, **`scan-action`**, import wiring).
- **Logger:** **`import { log } from "@/lib/logger"`**.
- **Events:**
  1. **`Scan started`** — `log.info` once per invocation, after `runId` / `startedAt` minted, before **`writeRunningScanState`**.
  2. **`Scan failed`** — `log.error` on: CLI **`execAsync`** catch (spawn/timeout/script error); missing **`readLastScanResult()`** after CLI; terminal **`ok === false`** (e.g. failed/partial with zero pages / aborted), using short **`error`** string from payload.
  3. **`Scan completed`** — `log.info` when terminal **`ok === true`**.
- **Context fields:**
  - **All terminal logs:** `runId` (orchestrator id: **`scan-${Date.now()}`** at entry), `durationMs` (from entry `startedAt`, except start log).
  - **Start:** `trigger` ∈ **`manual` | `auto`** — **`auto`** only for **`ScanTrigger === "import"`**; **`today` / `pages` / `cli`** → **`manual`**.
  - **Completed:** `resultCount` = **`merged.pagesScanned`** (from last-scan payload).
  - **Failed:** `error` — truncated CLI message, fixed missing-file message, or payload-derived summary.
- **Not added:** skip-if-already-running / client polling (no trivial hook in orchestrator).
- **Behavior:** Logging only; scan state + findings + return shape unchanged.
- `npm run typecheck` — pass; `npm run test` — **78**/78 pass; `npm run build` — pass.
- **Manual scan + log verification:** not run here (module is **`server-only`**; full path invokes **120s** CLI). Gate + code review green.

---

## 2026-04-12 — Phase 5-1: add `src/lib/logger.ts` (JSON logger)

- **File:** **`src/lib/logger.ts`** — 47 lines.
- **API:** `log.debug(msg, ctx?)`, `log.info(msg, ctx?)`, `log.warn(msg, ctx?)`, `log.error(msg, ctx?)`.
- **Output:** Single JSON line per call: `{"level":"info","ts":"2026-04-12T10:15:22.155Z","msg":"Import started","context":{"runId":"abc123","source":"upload"}}`.
- **Level routing:** `debug` / `info` → `console.log`; `warn` → `console.warn`; `error` → `console.error`.
- **Safety:** Circular/non-serializable context falls back to `{"_serializationError":"…"}` instead of crashing.
- **Deps:** None (no external logging library).
- **Instrumentation:** None yet — utility only; call-site wiring deferred to 5-2 / 5-3 / 5-4.
- **Manual test:** `npx tsx -e …` — all 4 levels produced valid JSON; circular ref handled.
- `npm run typecheck` — pass; `npm run test` — **78**/78 pass; `npm run build` — pass.

---

## 2026-04-12 — Phase 4-8: split Today server prep out of `page.tsx` (+ Phase 4-9 gate)

### Extracted (Today-specific server / data prep)
- **Moved from** **`src/app/(shell)/page.tsx`** **to** **`src/app/(shell)/today-data.ts`**: entire former **`TodayPage`** body — **`isDemoMode`**, scan settings / **`isScanOverdue`** → **`shouldTriggerScan`**, page snapshots + guardrails, findings counts, attribution partition + outcome events + scorecard + enrichment + candidates + triage, pages/issues/waves/playbook, site strip, **`buildTodaySummary`**, recommendations + suppression + responses + experiments + rank/select + track record, citation decay + geo coverage (trimmed imports only), prompts + journey coverage + extractability, snippet intel, observation runs + visibility context, competitor universe + today competitor line, replication card builders → today replication summary, local operator surface, primary action serialization (**`serializeFindingForToday`** / lineage), crawl age helpers, **`proofContext`**, pending findings serialization, accepted-awaiting-promotion count, read-only **`getMilestoneState`** + **`pickTodayMilestoneTeaser`**, and **`formatTimeAgo`** (local helper used only in this prep).
- **New API:** **`export async function loadTodayPageData(): Promise<TodayPageData>`** where **`TodayPageData`** = **`Omit<ComponentProps<typeof TodayClient>, "onRespondToRec" | "onStartExperiment" | "onResolveFinding" | "onPromoteFinding">`** — preserves exact **`TodayClient`** prop shapes for everything except the four callbacks.

### Route shell (`page.tsx`)
- **Imports:** **`TodayClient`**, **`loadTodayPageData`**, **`respondToRecommendation`**, **`startExperimentAction`**, **`resolveFinding`**, **`promoteFinding`**.
- **Renders:** **`await loadTodayPageData()`** then **`<TodayClient {...data} … />`** inside **`max-w-3xl`** wrapper. Server actions stay on the route file (no behavior change).

### Line counts
- **`page.tsx`:** **21 lines** (`wc -l`).
- **`today-data.ts`:** **952 lines** (`wc -l`) — prep consolidated here (under **< 400** target for **`page.tsx`** met).

### Read-only / behavior
- **Structural extraction only** — no new product logic, no route changes, no UI redesign. **`today-data.ts`** header documents read-only render (Track **1C**); no **`persist*`** / **`write*`** / sync calls added to the Today render path.
- `npm run typecheck` — pass; `npm run test` — **78**/78 pass; `npm run build` — pass.
- **Manual Today verification:** not run (prop contract enforced by **`TodayPageData`** + typecheck).

---

## 2026-04-12 — Phase 4-6: extract `PageRowCard` from `pages-client.tsx`

- **Extracted:** Left workbench **queue row** — one **`button`** per **`PageRow`**: **`data-page-id`**, selection border/background, **label**, status dot + open-items vs status label, second line (mentions, pending findings badge, not scanned, no Q&A / no schema / canonical mismatch, next-move label/color).
- **New file:** **`src/components/pages/page-row-card.tsx`** — **`PageRowCard`**; **`STATUS_CONFIG`** and **`NEXT_MOVE`** moved here and **re-exported** so **`pages-client.tsx`** detail header / next-step still use the same maps (no duplicate constants).
- **Wiring:** **`filtered.map`** → **`<PageRowCard key={row.id} row={row} isSelected={…} onSelect={() => setSelectedId(row.id)} />`**. List filtering, **`selected`**, keyboard nav, and right-hand detail remain in **`pages-client.tsx`**.
- **Types:** **`import type { PageRow }`** from **`pages-client`** (type-only; no runtime cycle).
- **Behavior:** Structural only — same markup and **`cn`** classes as pre-extract.
- `npm run typecheck` — pass; `npm run test` — **78**/78 pass; `npm run build` — pass.
- **Manual Pages verification:** not run.

---

## 2026-04-12 — Phase 4-7: slim `pages-client.tsx` (< 400 lines)

- **Before:** **`src/app/(shell)/pages/pages-client.tsx`** **1114 lines** — monolithic list + full selected-page detail + crawl helpers + unused **`PAGE_TYPE_LABELS`**.
- **After:** **`pages-client.tsx`** **340 lines** — orchestration only: exported types, **`PagesClient`** state (**`view`**, **`selectedId`**, scan/issue transitions, **`copiedId`**, **`verifyMsg`**), derived row sets, keyboard/URL effects, composition of **`PagesWorkbenchTop`** + list + **`PageRowCard`** map + **`PagesSelectedDetail`** + stale URLs footer.
- **New files:**
  - **`src/components/pages/pages-selected-detail.tsx`** (~739 lines) — entire right-hand **selected page** UI (unchanged JSX moved verbatim) + **`STATUS_BADGE`**, **`CrawlRow`**, **`CrawlChip`**, **`DiffChip`**. Imports **`PageRow`** (type-only) from **`pages-client`**; **`STATUS_CONFIG` / `NEXT_MOVE`** from **`page-row-card`**.
  - **`src/components/pages/pages-workbench-top.tsx`** (~157 lines) — crawl-age warning, KPI row + **`DonutRing`**, scan CTA + last-scan link + view filter tabs.
- **Removed from `pages-client`:** dead **`PAGE_TYPE_LABELS`**; **`STATUS_BADGE`** (moved to detail); **`CrawlRow` / `CrawlChip` / `DiffChip`**; unused imports **`Link`**, **`cn`**, **`ChangeVerdictBadge`**, **`KpiCard`**, **`DonutRing`**.
- **Behavior:** Same render tree and handlers — props passed through; no filtering/sort/selection logic changes.
- `npm run typecheck` — pass; `npm run test` — **78**/78 pass; `npm run build` — pass.
- **Manual Pages verification:** not run.

---

## 2026-04-12 — Phase 4-5: tighten `today-client.tsx` composition + fix diagnostics duplicate key

### `today-client.tsx` composition cleanup
- **Before:** ~612 lines (after 4-4). Still contained dead **`WatchlistExperimentCard`** (never rendered), **`GROUP_CONFIG`**, **`WATCHLIST_STATUS_PRESENTATION`**, **`MANUAL_STATUS_OPTIONS`**, **`REC_ACCENT`**, **`formatExperimentStarted`**, **`recTypeDisplayLabel`**, **`formatScanTime`**; dead types **`TodayImpactItem`**, **`TodayExperiment`**, **`TodayTrackRecord`**, **`VisibilitySummary`**; dead imports **`cn`**, **`ReactNode`**, **`ChangeVerdict`**, **`ImpactConfidence`**, **`ImpactDirection`**.
- **After:** **299 lines**. File is now purely: shared serialization types (5: `SerializedFinding`, `RecResponseStatus`, `TodayPrimaryAction`, `TodayMilestoneTeaser`, `TodayQueueItem`) + `TodayClient` component (prop intake → derived values → composition of `TodayScanStrip`, `TodayVisibilitySnapshot`, `TodayFindings`, `TodayPrimaryAction`). No presentation helpers, no orphaned constants.
- **Behavior:** Identical — same prop surface, same render tree, same conditionals. All removed items were unreferenced dead code.

### Diagnostics duplicate key fix
- **Bug:** React console error "Encountered two children with the same key `owned-pattern-https---ritzbuilders-com-locat`" in **`SnippetIntelSection`** on `/diagnostics`.
- **Root cause:** **`src/domains/competitors/snippet-intel.ts`** generated signal IDs with `.slice(0, 30)` on sanitized URLs. Pages sharing the first 30 characters after `/[^a-z0-9]/gi → "-"` produced collisions.
- **Fix:** Changed `.slice(0, 30)` → `.slice(0, 80)` on all 4 ID templates (`owned-pattern-`, `gap-`, `comp-context-`, `strengthen-`).
- `npm run typecheck` — pass; `npm run test` — **78**/78 pass; `npm run build` — pass.

---

## 2026-04-12 — Phase 4-4: extract `TodayVisibilitySnapshot` from `today-client.tsx`

- **Extracted:** **`HowWeKnowPanel`** + **morning order** helper line; **merged coverage / freshness** alert (crawl stale, visibility stale note, partial-sample copy); **“Done for today”** all-clear card; **System** status row (scan recency, visibility fresh/stale/no data, optional pending-review link, Health link). Same JSX and conditions as before; **`deriveCoverageTone`**, **`shouldShowTodayAllClear`**, and **`reviewPending`** remain computed in **`TodayClient`** (unchanged).
- **New file:** **`src/components/today/today-visibility-snapshot.tsx`** — **`TodayVisibilitySnapshot`** + **`TodayVisibilitySnapshotProps`**.
- **Wiring:** **`today-client.tsx`** wraps milestone teaser + **`TodayFindings`** + **`TodayPrimaryAction`** + replication note as **`children`** so document order stays: proof → morning order → those blocks → coverage strip → all-clear → System line (structural **`children`** only; no new behavior).
- `npm run typecheck` — pass; `npm run test` — **78**/78 pass; `npm run build` — pass.
- **Manual Today verification:** not run.

---

## 2026-04-12 — Phase 4-3: extract `TodayFindings` from `today-client.tsx`

- **Extracted:** Section **“1. Since last scan: findings verdict”** — all-clear card (timestamp + crawl age + resolved count line), grouped **pending** findings (**critical** / **important** / **minor** / **informational** with same header rules), per-row **`FindingRow`** (resolve + promote controls, provenance block); plus **accepted awaiting promotion** paragraph with **`/pages`** link.
- **New file:** **`src/components/today/today-findings.tsx`** — **`TodayFindings`**, **`FindingRow`**, **`PRIORITY_STYLE`** (moved from **`today-client.tsx`**; removed duplicate there).
- **Wiring:** **`today-client.tsx`** — **`<TodayFindings pendingFindings={...} resolvedFindingsCount={...} scanCompletedAt={run?.completed_at ?? null} crawlAgeDays={...} onResolveFinding={...} onPromoteFinding={...} acceptedAwaitingPromotionCount={...} />`**. No change to how **`pendingFindings`** / counts are computed in **`page.tsx`** or parent.
- **Types:** **`import type { SerializedFinding }`** from **`today-client`** (type-only).
- **Behavior:** Structural extraction only — same JSX grouping, labels, and handlers; **`npm run typecheck` / `test` / `build`** — pass (**78**/78 tests).
- **Manual Today verification:** not run (same markup moved verbatim).

---

## 2026-04-12 — Phase 4-2: extract `TodayPrimaryAction` from `today-client.tsx`

- **Extracted:** Section **“2. Primary action — always visible, above the fold”** — full **`primaryAction`** card (bucket pill, headline, rationale, confidence, lineage / change link, watch-after, CTA row with accept+experiment / accept-only / defer / dismiss / post-accept **Go →**) and **`actionMsg`** line; plus **`summary.nextMove`** fallback when **`primaryAction`** is null.
- **New file:** **`src/components/today/today-primary-action.tsx`** — **`TodayPrimaryAction`** + **`TodayPrimaryActionProps`**; **`BUCKET_STYLE`** moved from **`today-client.tsx`** (removed duplicate there).
- **Wiring:** Parent passes **`pending`**, **`startTransition`**, **`actionMsg`**, **`setActionMsg`** so experiment strip and primary action still share one transition + message state (unchanged).
- **Types:** **`import type { TodayPrimaryAction }`** from **`today-client`** (type-only; no runtime cycle).
- `npm run typecheck` — pass; `npm run test` — **78**/78 pass; `npm run build` — pass.
- **Manual Today verification:** not run.

---

## 2026-04-12 — Phase 4-1: extract `TodayScanStrip` from `today-client.tsx`

- **Extracted:** Top-of-Today **non-blocking scan status** block — previously inline **`ScanStatusBanner`** + comment in **`src/app/(shell)/today-client.tsx`** (first child inside root **`space-y-6`**).
- **New file:** **`src/components/today/today-scan-strip.tsx`** — **`TodayScanStrip`** + **`TodayScanStripProps`** (`shouldTriggerScan: boolean`); delegates to **`ScanStatusBanner`** unchanged (same import path, same prop).
- **Wiring:** **`today-client.tsx`** — import **`TodayScanStrip`**; **`<TodayScanStrip shouldTriggerScan={shouldTriggerScan} />`** (prop still from **`TodayClient`** default **`false`**).
- **Behavior:** No edits to **`scan-status-banner.tsx`**, **`trigger-scan-action`**, or poll interval — structural only.
- `npm run typecheck` — pass; `npm run test` — **78**/78 pass; `npm run build` — pass.
- **Manual Today verification:** not run.

---

## 2026-04-12 — Phase 3-8: Settings surface smoke verification — **VERIFIED**

- **Nav (`src/app/(shell)/settings/layout.tsx`):** **`TABS`** = **Import** → `/settings/import`, **Config** → `/settings/config`, **Data** → `/settings/history` — **no** Health tab in UI.
- **Routes (`curl` vs `http://127.0.0.1:3000`, dev server):** `/settings/import` **200**, `/settings/config` **200**, `/settings/history` **200**, `/settings/health` **200** (direct only).
- **Removed routes:** `/import` **404**, `/setup` **404**, `/results` **404**.
- **Link integrity:** **`rg`** `src/` for `href="/import"`, `"/setup"`, `"/results"` and template `.../import`, `/setup`, `/results` route targets — **no matches** (CTAs use settings paths per 3-5–3-7).
- **Data framing (3-4):** Response body for `/settings/history` contains string **`Imported measurements`**.
- **Gates:** `npm run typecheck` — pass; `npm run test` — **78**/78 pass; `npm run build` — pass (17 static ○ + 4 dynamic ƒ).
- **App code changes:** **none** (verification-only).

---

## 2026-04-12 — Phase 3-7: remove standalone `/results` and `/results/[id]`

- **Removed:** **`src/app/(shell)/results/`** — **`page.tsx`**, **`results-client.tsx`**, **`[id]/page.tsx`** (entire segment).
- **Colocated (mirror of 3-5):** **`src/app/(shell)/settings/history/results-page.tsx`**, **`results-client.tsx`**, **`[id]/page.tsx`**. **`settings/history/page.tsx`** imports **`./results-page`** (was **`../../results/page`**).
- **Links retargeted** (`/results` → **`/settings/history`**, `/results/:id` → **`/settings/history/:id`**): **`settings/import/import-page.tsx`**, **`diagnostics/page.tsx`**, **`attribution-card.tsx`**, **`brief-outcomes.tsx`**, **`interactive-outcomes.tsx`**, **`briefs/[id]/page.tsx`**, **`changes/[id]/page.tsx`**, **`pages/pages-client.tsx`**, **`review/review-queue-client.tsx`**, **`topics/topics-client.tsx`**, **`topics/opportunity/[id]/page.tsx`**; row links inside **`results-client.tsx`** and next-row link in **`[id]/page.tsx`**. **`src/lib/today-summary.ts`** comment only (wording).
- **Single entry:** List + detail for imported measurement rows live only under **Settings → Data** URLs; **`/results`** absent from production route table after build.
- **Validation:** `rm -rf .next`; `npm run typecheck` — pass; `npm run test` — **78**/78 pass; `npm run build` — pass.
- **Manual route verification:** not run.

---

## 2026-04-12 — Phase 3-6: remove standalone `/setup` route

- **Removed:** **`src/app/(shell)/setup/page.tsx`** (two-step onboarding wizard) and **`src/app/(shell)/setup/actions.ts`**; directory **`(shell)/setup/`** deleted.
- **Colocated (mirror of 3-5 actions move):** **`src/app/(shell)/settings/config/actions.ts`** — same **`"use server"`** module: **`saveSetup`**, **`loadSetup`** (unchanged logic).
- **Wiring:** **`src/app/(shell)/settings/config/config-form.tsx`** — import **`saveSetup`** from **`./actions`** (was `@/app/(shell)/setup/actions`).
- **Links:** No **`href="/setup"`** or **`/setup`** string matches in **`src/`** besides removed paths—**no** link updates required.
- **Single entry point:** **`/settings/config`** is the only App Router path for business setup/config UI; former wizard flow superseded by **Config** (Phase 3-1). **`/setup`** absent from production route table after build.
- **Validation:** `rm -rf .next`; `npm run typecheck` — pass; `npm run test` — **78**/78 pass; `npm run build` — pass (18 static ○ routes).
- **Manual route verification:** not run.

---

## 2026-04-12 — Phase 3-5: remove standalone `/import` route

- **Removed:** `src/app/(shell)/import/page.tsx` (and the **`(shell)/import/`** segment); **`/import`** no longer appears in the Next.js route table after build.
- **Preserved entry point:** **`/settings/import`** — implementation file is now **`src/app/(shell)/settings/import/import-page.tsx`** (same client module as before, moved). **`src/app/(shell)/settings/import/page.tsx`** is one line: `export { default } from "./import-page"`.
- **Links updated:** **`src/app/(shell)/diagnostics/page.tsx`** — **`href="/import"`** → **`href="/settings/import"`** (only in-repo `href="/import"` match in `src/`).
- **Import logic:** no edits to **`src/lib/import/actions.ts`** or adapters.
- **Validation:** cleared stale **`.next`** (validator still referenced deleted route); `npm run typecheck` — pass; `npm run test` — **78**/78 pass; `npm run build` — pass (19 static ○ routes).
- **Manual route verification:** not run.

---

## 2026-04-12 — Phase 3-4: framing text on Data tab (`/settings/history`)

- **Where added:** `src/app/(shell)/settings/history/page.tsx` — replaced bare re-export with a wrapper: **`role="note"`** callout (`rounded-lg border … text-muted-foreground`) **immediately before** `<ResultsPage />` (default import from **`../../results/page`**).
- **What the copy communicates:** This surface is **imported** row-level visibility measurements and citation evidence; it feeds Today/Changes/Market; operators should use it for **audit**, **run linkage checks**, and **freshness** tracking—not for attribution or recommendations (those live elsewhere).
- **Behavior / data:** **`results/page.tsx`** and **`ResultsClient`** unchanged; **`/results`** route unchanged (no framing). No new deps; copy-only UI addition at settings entry.
- `npm run typecheck` — pass; `npm run test` — **78**/78 pass; `npm run build` — pass.
- **Manual page verification:** not run.

---

## 2026-04-12 — Phase 3-3: Settings tab label "Data" (route still `/settings/history`)

- **Where changed:** `src/app/(shell)/settings/layout.tsx` — **`TABS`** entry for the history results surface: **`label`** only, **`"Measurement History"` → `"Data"`**; **`href`** remains **`"/settings/history"`** (no path or file renames).
- **Unchanged:** `src/app/(shell)/settings/history/page.tsx` (still re-exports `results/page`), **`/results`** route, and all navigation targets using `/settings/history`.
- `npm run typecheck` — pass; `npm run test` — **78**/78 pass; `npm run build` — pass.
- **Manual nav label verification:** not run.

---

## 2026-04-12 — Phase 3-2: hide Health tab from settings navigation

- **Where removed:** `src/app/(shell)/settings/layout.tsx` — the **`TABS`** constant no longer includes `{ href: "/settings/health", label: "System Health" }`. Tab links are Import, Config, Measurement History only.
- **Route preserved:** `src/app/(shell)/settings/health/page.tsx` **not** modified; **`/settings/health`** remains registered and reachable by direct URL (no redirect, no delete).
- `npm run typecheck` — pass; `npm run test` — **78**/78 pass; `npm run build` — pass.
- **Manual navigation verification:** not run (no browser session); change is a single static array edit.

---

## 2026-04-12 — Phase 3-1: real Settings Config page (editable business profile)

- **Replaced:** `src/app/(shell)/settings/config/page.tsx` no longer re-exports `setup/page`; it is a dedicated Settings **Config** surface (not the multi-step setup wizard).
- **Settings implemented (editable):** **business name**, **website domain**, **industry** (select + passthrough option if value not in preset list), **locations** (comma-separated → `BusinessConfig.locations`), **services** (→ `services`), **known competitors** (→ `primaryCompetitors`). Matches `architecture.md` business profile scope + fields already supported by `saveSetup`.
- **Read path:** `getBusinessConfig()` from `src/lib/business-config.ts` (module cache + `.data/business-config.json` merge with defaults).
- **Write path:** Client `ConfigForm` calls server action **`saveSetup`** (`src/app/(shell)/settings/config/actions.ts` since Phase 3-6; was `setup/actions.ts`) → **`saveBusinessConfig(...)`** → **`writeFileSync`** to **`.data/business-config.json`**; then **`revalidatePath("/", "layout")`**. After success, **`router.refresh()`** so the RSC reloads values.
- **Routing / rendering:** `export const dynamic = "force-dynamic"` on the Config page so local JSON edits are not baked into static prerender output (`/settings/config` is **ƒ** dynamic in production build).
- **Files added:** `src/app/(shell)/settings/config/config-form.tsx`.
- `npm run typecheck` — pass; `npm run test` — **78**/78 pass; `npm run build` — pass.
- **Manual config page verification:** not run (no `next dev` + browser in this session).

---

## 2026-04-12 — Phase 2C-2: mount `DataFreshnessStrip` in shell layout

- **Mount point:** `src/app/(shell)/layout.tsx` — **one** `<DataFreshnessStrip />` **immediately after** `<AppHeader />`, **before** `<main>` (content column; strip stays visible while `main` scrolls).
- **`lastImportAt` source:** Same signal as `getDataCoverage().lastImportAt` — `importRuns` from `@/lib/seed-data.server`, sorted by `started_at` descending; newest run’s `started_at` or `null`. **No new freshness logic** (same derivation as `getDataCoverage`, inlined in layout).
- **`lastScanCompletedAt` source:** `latestWebsiteCrawlRun()?.completed_at` from `@/domains/observations/read` (same as Today crawl proof / documented component contract).
- **Unchanged:** Sidebar, `AppHeader`, `DemoBannerGate`, `main` children structure; only minimal imports + two locals + one component node.
- **Validation:** `npm run typecheck` — pass; `npm run test` — **78**/78 pass; `npm run build` — pass.
- **Manual strip verification:** Not run in this session (no `next dev` + browser); layout wiring + types + build confirm component is on every `(shell)` route tree.

---

## 2026-04-12 — Phase 1C-2: move experiment citation update off Today render path

- **Removed from `src/app/(shell)/page.tsx`:** experiment citation sync loop (lines 577-591) — `getActiveExperiments()` iteration with `updateExperimentCitations()` + `persistExperiments().catch(...)`. Dropped `updateExperimentCitations` and `persistExperiments` imports from experiment-store (kept `getActiveExperiments`, `getExperimentByRecId` — still used by Today).
- **Created `src/domains/product/experiment-citation-sync.ts`:** new `runExperimentCitationSync()` function — builds `citMap` from `citationEvidenceIndex`, iterates active experiments, calls `updateExperimentCitations` when counts differ, persists if changed. Uses `server-only`.
- **Wired into post-import:** Added `await runExperimentCitationSync().catch(() => {})` into `executeImport()` and `importWorkbook()` in `src/lib/import/actions.ts`, right after `runOutcomeBackfill`. Non-fatal (`.catch`). Not added to `triggerScan` — scans crawl HTML and don't change citation evidence data; citation counts come from imports.
- **Today render is now read-only** with respect to the experiment store — no `updateExperimentCitations`, no `persistExperiments`, no disk writes during RSC render for experiment data.
- **Behavior equivalent:** Same sync logic, same `citMap` construction, same status update rules in `updateExperimentCitations`. Only the trigger location changed (render → post-import).
- `npm run typecheck` — pass; `npm run test` — **77**/77 pass; `npm run build` — pass.
- `GET http://127.0.0.1:3000/` — **200**, full Today content, no errors, no stale references.

---

## 2026-04-12 — Phase 1C-1: move outcome backfill off Today render path

- **Removed from `src/app/(shell)/page.tsx`:** `backfillFromExistingData(...)` call (lines 538-563) and `persistOutcomes().catch(...)` (line 564-565). Dropped imports `backfillFromExistingData` and `persistOutcomes` from `@/domains/product/outcome-store`.
- **Created `src/domains/product/outcome-backfill.ts`:** new `runOutcomeBackfill()` function — encapsulates scorecard computation + `backfillFromExistingData` + conditional `persistOutcomes`. Uses `server-only`; reads from same module-cached stores.
- **Wired into post-import:** Added `await runOutcomeBackfill().catch(() => {})` into `executeImport()` and `importWorkbook()` in `src/lib/import/actions.ts`, immediately before `revalidatePath`. Non-fatal (`.catch`), idempotent (backfill skips duplicates).
- **Today render is now read-only** with respect to the outcome store — no `backfillFromExistingData`, no `persistOutcomes`, no disk writes during RSC render for outcome data.
- **Behavior equivalent:** Same backfill logic, same inputs, same persistence. Only the trigger location changed (render → post-import).
- `npm run typecheck` — pass; `npm run test` — **77**/77 pass; `npm run build` — pass.
- `GET http://127.0.0.1:3000/` — **200**, full Today content, no errors.

---

## 2026-04-12 — Phase 1B-11: browser verification of simplified Today surface — **verified**

- **Method:** Live `GET http://127.0.0.1:3000/` against running `next dev` (HTTP **200**); HTML string checks for error boundary copy and removed surfaces; `src/app/(shell)/today-client.tsx` read-through for structure and conditional sections. *(No separate GUI browser automation in this environment; equivalent to loading Today in the browser for SSR + document body content.)*
- **Gates:** `npm run typecheck` — pass; `npm run test` — **77**/77 pass; `npm run build` — pass (production compile after verification).
- **Error / blank / cache:** No `Something went wrong` in HTML; full Today shell + main content present; no `ReferenceError` / `is not defined` strings.

**Five intended areas (as implemented on Today):**

| Area | Result |
|------|--------|
| **Scan status** | `<ScanStatusBanner />` is first child in `TodayClient`; when `shouldTriggerScan` is **false**, component returns **`null`** (no visible strip) — correct per Phase 1A behavior, not a regression. |
| **Primary action + next moves** | Present: primary recommendation card (or `summary.nextMove` fallback when no primary). |
| **Findings queue** | Present: “Since last scan” all-clear card **or** grouped findings list when `pendingFindings.length > 0`. |
| **Visibility / safety** | Present: `HowWeKnowPanel` (visibility sample + crawl proof copy); conditional **Coverage / freshness** strip when crawl stale, visibility stale vs crawl, or partial sample; **System** single-line footer (scan age, visibility fresh/stale, optional attribution pending link). |
| **Milestone teaser** | **Conditional** — `milestoneTeaser && (… “Recent record” …)`; sample load had **`milestoneTeaser: null`** so block correctly absent (not broken). |

**Removals / collapses (must stay gone):**

| Check | Result |
|-------|--------|
| Performance trend block (`TodayPerformance`) | **Absent** from `today-client.tsx` and HTML (no performance chart / trend UI strings). |
| Expanded accepted findings list | **Absent**; only one-line **`acceptedAwaitingPromotionCount`** + link when count > 0. |
| Standalone experiments block | **Absent** (`WatchlistExperimentCard` never rendered in tree). |
| Standalone verified fixes | **Absent** (no verified-fixes section). |
| Entity discrepancy block | **Absent** (no entity mismatch section; “Mismatch” chip remains only inside **`FindingRow`** for applicable crawl/changelog findings — not domain entity UI). |
| Replication cards | **Absent**; only optional one-line **replication summary** link to Changes → Replicate when `replicationSummary.pageCount > 0` (sample had no line — **correct**). |
| Secondary recommendation cards | **Absent**. |

**UX notes (non-blocking):** `HowWeKnowPanel` + “Morning order” line still sit above the core stack (adds vertical density vs strict “5 sections only” narrative). Morning order copy still mentions “skim performance” while the performance **chart** was removed — minor copy drift only, not a removed block reappearing. No empty placeholder regions observed in sample HTML beyond expected `space-y-6` spacing.

**App code changes:** none (verification-only).

---

## 2026-04-12 — Phase 1B-2: inline attribution review queue on Today — **NO-OP**

- **Searched:** `src/app/(shell)/today-client.tsx`, `src/app/(shell)/page.tsx` for attribution review queue / review list / triage list / scorecard rows rendered only on Today.
- **Finding:** No inline list or card block of attribution items on Today. `TodayClient` uses `summary.reviewHeuristicLine` **only** to parse a pending count (`reviewPending`) for a **single compact link** in the System footer (`/changes?tab=attribution` — “N pending review”). That is not an inline queue. `summary.nextMove` can point to Attribution when selected as the top move, but that is one **next-move** card, not a queue UI.
- **`page.tsx`:** Attribution engines (`discoverCandidates`, `triageCandidates`, `computeScorecard`, etc.) feed `buildTodaySummary` / `nextMoveCandidates`; no Today-only serialized attribution review list is passed to the client for a queue.
- **No app code changes.**
- `npm run typecheck` — pass; `npm run test` — **77**/77 pass; `npm run build` — pass; `GET http://127.0.0.1:3000/` — **200** (Today loads).

---

## 2026-04-12 — Phase 1B-11 (follow-up pass): browser re-verification — **verified**

- **Trigger:** Repeat verification prompt (same acceptance criteria as prior 1B-11 entry above).
- **Gates:** `npm run typecheck` — pass; `npm run test` — **77**/77 pass; `npm run build` — pass.
- **Today:** `GET http://127.0.0.1:3000/` — **200**; no `Something went wrong`; “Since last scan”, primary action surface, System/visibility copy present; `TodayPerformance` / `SecondaryOpportunities` strings absent from HTML.
- **Conclusion:** Matches prior 1B-11 sign-off; **no app code changes.**

---

## 2026-04-12 — Regression investigation: `outcomeRecords is not defined` after 1B-10

- **Reported symptom:** runtime error "outcomeRecords is not defined" on Today page.
- **Investigation:** Searched all files in `src/app/(shell)/page.tsx` and `src/app/(shell)/today-client.tsx` — zero references to `outcomeRecords`, `outcomeSummary`, `trackRecordSummary`, or `serializedExperiments`. The 1B-10 cleanup correctly removed all usage.
- `outcomeRecords` exists only in its definition file (`src/domains/product/outcome-store.ts`) and in `src/lib/data-adapters/profound-adapter.ts` and `src/app/(shell)/diagnostics/page.tsx` — none of which are in the Today render path.
- `backfillFromExistingData` and `persistOutcomes` (still imported in `page.tsx`) are both legitimately used at lines 539 and 565.
- **SSR verification:** `curl http://localhost:3000/` returns HTTP 200 with full TodayClient rendered (all expected props present: `primaryAction`, `pendingFindings`, `shouldTriggerScan`, `proofContext`, `replicationSummary`, `milestoneTeaser`). No `ReferenceError`, `is not defined`, or `Something went wrong` text in HTML output.
- **`error.tsx` in HTML** — confirmed to be the error boundary script tag (normal Next.js behavior: always loaded as fallback), not an active error display.
- **Result: NO-OP.** No stale references found. No code changes needed. The reported error was likely caused by a stale dev server cache or `.next` build artifact that resolved on recompilation.
- `npm run typecheck` — pass; `npm run test` — **77**/77 pass; `npm run build` — pass.

---

## 2026-04-11 — Phase 1B-10: remove unused Today-only server computation from `page.tsx`

- Removed **`serializedExperiments`** (built from `getActiveExperiments()` but never passed to `TodayClient`).
- Removed dead **`trackRecordSummary`** and **`outcomeSummary`** / **`outcomeRecords`** usage chain (nothing consumed those values on Today).
- Dropped unused imports: **`computeOutcomeSummary`**, **`outcomeRecords`** (`outcome-store`); **`updateExperimentAction`** (`experiment-actions`).
- **Unchanged:** experiment citation auto-update loop + `persistExperiments`, `backfillFromExistingData` / `persistOutcomes`, all domain engines and `TodayClient` props.
- `page.tsx` line count after edit: **1002** (still above 600; further shrink is optional follow-up).
- `npm run typecheck` — pass; `npm run test` — **77**/77 pass; `npm run build` — pass.

---

## 2026-04-11 — Phase 1B-9: verified fixes on Today — **NO-OP**

- Searched `today-client.tsx` and `page.tsx` for verified fixes / completed fixes wiring.
- **Finding:** `page.tsx` builds `verifiedFixes` and passes it to `buildTodaySummary`; `TodaySummary` includes `verifiedFixes`, but **`TodayClient` does not reference `summary.verifiedFixes`** — no standalone verified-fixes section renders on Today.
- **No code changes.**
- `npm run typecheck` — pass; `npm run test` — **77**/77 pass; `npm run build` — pass.

---

## 2026-04-11 — Phase 1B-8: experiments on Today — **NO-OP**

- Inspected `today-client.tsx` and `page.tsx`: **no** experiments array/list passed to `TodayClient`; `serializedExperiments` is built in `page.tsx` but never wired to the client.
- `WatchlistExperimentCard` + `TodayExperiment` / `formatExperimentStarted` exist in `today-client.tsx` but **`<WatchlistExperimentCard />` is never used** — no standalone expanded experiments block on Today. Experiment UX on Today is only via primary action (`onStartExperiment`, `hasExperiment` flag).
- **No code changes** (per instructions: NO-OP when no expanded block).
- `npm run typecheck` — pass; `npm run test` — **77**/77 pass; `npm run build` — pass.

---

## 2026-04-11 — Phase 1B-7: collapse accepted findings on Today

- `src/app/(shell)/today-client.tsx` — removed expanded “Accepted — decide what to do” card and `FindingRow` list; replaced with one line: count + link to `/pages` (“continue on Pages”); prop `acceptedFindings` replaced by `acceptedAwaitingPromotionCount`; removed `showPromotionOnly` from `FindingRow` (promotion actions only when `finding.status === "accepted"` in-row).
- `src/app/(shell)/page.tsx` — removed `serializedAcceptedFindings` and top-level `acceptedFindings` variable; pass `acceptedAwaitingPromotionCount` from `getAcceptedFindings().filter(promotionStatus === "none").length`.
- `npm run typecheck` — pass; `npm run test` — **77**/77 pass; `npm run build` — pass.

---

## 2026-04-11 — Phase 1B-6: entity discrepancy UI on Today — **NO-OP**

- Searched `today-client.tsx`, `components/today/`, and Today-related paths for `entity`, `discrep`, `mismatch`, `drift` (case-insensitive).
- **Finding:** No dedicated entity-discrepancy block or copy on Today. `page.tsx` pushes a *next-move candidate* when `notableDisc.length > 0` (“possible representation discrepancies…”), which can surface only as the generic `summary.nextMove` card when there is no primary action — not a separate Today section. `FindingRow` label “Mismatch” is **changelog vs crawl** for scan findings, not the entity `detectDiscrepancies` pipeline.
- **Action:** No code changes (per plan: NO-OP when already clean).
- `npm run typecheck` — pass; `npm run test` — **77**/77 pass; `npm run build` — pass.

---

## 2026-04-11 — Phase 1B-5: remove performance trend from Today

- `src/app/(shell)/today-client.tsx` — removed `TodayPerformance` import, `performanceData` prop, and performance section JSX; renumbered section comments (coverage → 3, done → 4, system → 5).
- `src/app/(shell)/page.tsx` — removed `buildPerformanceTimeseries` import and `perfTimeseries` / `performanceData`; kept `buildCompetitorRank` for `syncMilestonesFromWorkspace`.
- `src/app/(shell)/today-performance.tsx` and `buildPerformanceTimeseries` in `src/lib/performance-timeseries.ts` are now **unused** by the app (no other imports); left in tree for optional follow-up cleanup.
- `npm run typecheck` — pass; `npm run test` — **77**/77 pass; `npm run build` — pass.

---

## 2026-04-11 — Phase 1B-4: replication cards off Today, compact Replicate link

- `src/app/(shell)/today-client.tsx` — removed `ReplicationCardsClient` block; added optional `replicationSummary` (`{ pageCount } | null`); when `pageCount` is positive, renders one muted line with linked count to `/changes?tab=replicate`.
- `src/app/(shell)/page.tsx` — removed `serializeReplicationCards` import and Today serialization; counts unique normalized `targetPageUrl` across `replicationWorkspaceCards` targets → `replicationSummaryForToday`.
- Replication engine (`buildReplicationCards` / `buildPromisingReplicationCards`) unchanged; Changes route unchanged.
- `npm run typecheck` — pass; `npm run test` — **77**/77 pass; `npm run build` — pass.

---

## 2026-04-11 — Phase 1B-3: remove secondary recommendations from Today

- `src/app/(shell)/today-client.tsx` — removed `SecondaryOpportunities` UI, `secondaryRecommendations` prop, exported `TodayRecommendation` type, and unused `ConfidenceBadge` import.
- `src/app/(shell)/page.tsx` — removed `topRecs` serialization; `rankAndSelect` now destructures only `primaryAction` (recommendation engine unchanged).
- `.cursor/rules/core.mdc` — added **Model Recommendation Rule (MANDATORY)** (Composer 2 / Opus 4.6 / Opus 4.6 Max + final-output requirement).
- `npm run typecheck` — pass; `npm run test` — **77**/77 pass; `npm run build` — pass.

---

## 2026-04-11 — Phase 1B-1: Today section classification (KEEP / MOVE / COLLAPSE / REMOVE)

Analysis of `src/app/(shell)/today-client.tsx` (1197 lines). Every rendered section in order:

| # | Section (lines) | Current purpose | Classification | Reason |
|---|-----------------|-----------------|----------------|--------|
| 1 | **ScanStatusBanner** (506) | Non-blocking scan trigger + status | **KEEP** | Core morning ritual — just shipped in 1A |
| 2 | **Local urgent strip** (508–519) | Local operator market alert | **KEEP** | Conditional, compact, high-urgency signal |
| 3 | **HowWeKnowPanel** (521) | Proof/methodology panel | **MOVE → collapse** | Useful but not morning-essential; move to a "How we know" toggle or footer |
| 4 | **Morning order instruction** (522–525) | Static instruction text | **REMOVE** | One-time onboarding, not daily value; clutters morning view |
| 5 | **Milestone teaser** (527–557) | Recent ATH / first-time record | **KEEP** | Compact, conditional, motivating — fits "what matters" |
| 6a | **Findings: all-clear** (559–585) | "Since last scan — All clear" banner | **KEEP** | Core scan-result verdict |
| 6b | **Findings: pending queue** (586–645) | Prioritized pending findings with actions | **KEEP** | Core morning action — clear the queue |
| 7 | **Accepted findings promotion** (647–661) | Accepted findings awaiting promotion decision | **COLLAPSE** | Secondary; show count + link to `/pages` instead of full cards |
| 8 | **Primary action card** (663–803) | Top recommendation with accept/test/defer | **KEEP** | Core "what should I do next" |
| 9 | **Secondary recommendations** (805–810) | Collapsible list of other opportunities | **REMOVE** | Duplicates Changes tab; adds 100+ lines; operator acts on one thing |
| 10 | **Replication cards** (812–819) | Top 2 replication pattern cards | **REMOVE** | Belongs on Changes > Replicate tab; noise for morning triage |
| 11 | **Performance chart** (821–827) | Citation timeseries + competitor rank | **COLLAPSE** | Useful KPI but secondary to triage; collapse to compact KPI strip |
| 12 | **Coverage + freshness alert** (829–876) | Stale crawl / visibility warnings | **KEEP** | Safety signal — operator needs to know data is degraded |
| 13 | **All clear / done state** (878–893) | "Nothing needs your attention" | **KEEP** | Completion ritual — morning inbox zero |
| 14 | **System status line** (895–915) | Scan age / visibility freshness / pending review link | **KEEP** | Compact, essential status footer |

### Target structure (5 sections, top-to-bottom):

1. **Scan status** — `ScanStatusBanner` (section 1) — already done
2. **Primary action + next moves** — primary action card (section 8) — KEEP as-is
3. **Findings queue** — sections 6a/6b + milestone teaser (5) + local urgent (2) — KEEP
4. **Visibility KPIs** — collapse performance (section 11) to compact strip; keep coverage alert (12)
5. **Milestone teaser** — section 5 — KEEP (already compact)

### Sections to act on in 1B-2 through 1B-9:

| Plan step | Section # | Action |
|-----------|-----------|--------|
| 1B-2 | — (no inline attribution queue exists; was removed in prior phases) | Verify already gone — may be a no-op |
| 1B-3 | 9 | REMOVE secondary recommendation cards |
| 1B-4 | 10 | REMOVE replication cards |
| 1B-5 | 11 | COLLAPSE performance → compact KPI strip (or link) |
| 1B-6 | — (no entity discrepancies section in today-client) | Verify already gone — no-op |
| 1B-7 | 7 | COLLAPSE accepted findings to count only |
| 1B-8 | — (no experiments section in today-client; watchlist only renders from page.tsx data) | Verify — may already be handled |
| 1B-9 | — (no verified fixes section in today-client; summary.verifiedFixes not rendered) | Verify — likely no-op |
| — | 3 | REMOVE HowWeKnowPanel from Today (methodology, not morning triage) |
| — | 4 | REMOVE morning order instruction text |

---

## 2026-04-11 — Phase 1A-6: end-to-end morning flow verification

- **Test setup:** No temporary overdue forcing needed — `latestWebsiteCrawlRun()` returns `null` (no `website_crawl` run-type entries in observation-runs.json), so `isScanOverdue(null, settings)` → `true` naturally at current hour (23 PT ≥ preferredHour 9).
- **SSR verification:** `curl http://localhost:3000/` returned **200 in 7.5 s** (cold Turbopack compile); warm requests **5.3 s** (dev-mode baseline). SSR HTML contains `shouldTriggerScan\":true` in React Flight payload and "Starting scan…" banner text — no scan blocks render.
- **Client-side trigger:** After hydration, `scan-state.json` `updatedAt` moved from `06:15:25` → `06:26:28` with `trigger: "today"` — confirms `triggerScan()` fired from the client, not during SSR. Phase resolved to `failed` (expected: target site unreachable in dev env; `cliError: "fetch failed"`).
- **Banner states observed:** triggering → running → failed (complete path would include success/partial in production with a reachable site).
- **No fixes needed.** No temporary hacks to remove. `npm run typecheck` — pass; `npm run test` — **77**/77 pass; `npm run build` — pass.
- **Track 1A (non-blocking scan) is complete.**

---

## 2026-04-11 — Phases 1A-4 + 1A-5: ScanStatusBanner + Today wiring

- **Created** `src/components/today/scan-status-banner.tsx` — client component; on mount calls `triggerScan()` when `shouldTriggerScan`; polls `getScanStatus()` every 5 s while phase is `running`; shows four visual states (triggering / running / complete / failed) with matching tokens; calls `router.refresh()` on completion; guards against duplicate triggers via `useRef`; cleans up interval on unmount.
- **Updated** `src/app/(shell)/today-client.tsx` — imported `ScanStatusBanner`; renders it at the top of Today with `shouldTriggerScan`; removed dead `scanRanThisLoad` / `scanResult` prop + inline scan-complete banner + `data-should-trigger-scan` attribute. "All clear" guard no longer depends on removed prop.
- `npm run typecheck` — pass; `npm run test` — **77**/77 pass; `npm run build` — pass.

---

## 2026-04-11 — Phase 1A-3: remove blocking scan from Today RSC

- `src/app/(shell)/page.tsx` — removed `await runWebsiteScan({ trigger: "today" })` and post-scan snapshot refresh from render; kept `getScanSettings` + `latestWebsiteCrawlRun` + `isScanOverdue` → `shouldTriggerScan` for client.
- `src/app/(shell)/today-client.tsx` — accepts optional `shouldTriggerScan` (default `false`); root `data-should-trigger-scan` for wiring in 1A-5; removed server-passed `scanRanThisLoad` / `scanResult` from `page.tsx` (defaults cover until banner restores completion UX).
- `npm run typecheck` — pass; `npm run test` — **77**/77 pass; `npm run build` — pass.

---

## 2026-04-11 — Phase 1A-2: trigger-scan server action

- Added `src/app/(shell)/trigger-scan-action.ts` — `"use server"`; `triggerScan()` calls `runWebsiteScan({ trigger: "today" })`, then `revalidatePath("/", "layout")` and `revalidatePath("/pages", "layout")` when `scanRoutesShouldRevalidate(result)` (same pattern as `pages/scan-action.ts`). Returns `{ status: "ok" | "error", result?: WebsiteScanResult, error?: string }` with try/catch for unexpected failures.
- `npm run typecheck` — pass; `npm run test` — **77**/77 pass; `npm run build` — pass.

---

## 2026-04-11 — Phase 1A-1: scan status server action

- Added `src/app/(shell)/scan-status-action.ts` — `"use server"`; exports `getScanStatus()` returning `readScanState()` (`ScanStateFile | null`) for client polling in the non-blocking Today scan flow.
- `npm run typecheck` — pass; `npm run test` — **77**/77 pass; `npm run build` — pass (Next.js 16.2.2).

---

## 2026-04-11 — Phase 0C-5: hygiene gate passed (Phase 0 finalized)

**Recorded times (machine local):** `23:03:29 PDT` — gate start; Vitest **Start at** `23:03:30` (77/77).

| Command | Result | Notes |
|---------|--------|--------|
| `npm run typecheck` | **PASS** | `tsc --noEmit`, exit 0 |
| `npm run test` | **PASS** | Vitest: 16 files, **77** tests, exit 0 |
| `npm run build` | **PASS** | Next.js production build, exit 0; route table **19** `○` + **6** `ƒ` app entries |

- Build log scanned for actionable `warn`/`error` strings in output: **none** surfaced in saved build transcript.
- **Phase 0 (Foundation Safety)** marked complete in active plan + handoff (no app code changes this step).

---

## 2026-04-12 — Phase 0C-4: remove `/opportunities` redirect routes

- Searched `src/` for `"/opportunities"`, `'/opportunities'`, `` `/opportunities` ``, `(shell)/opportunities`, and `href`/`Link` targets: **no** in-app links to `/opportunities` or `/opportunities/…`. Matches were only `@/domains/opportunities/...` (domain module, unrelated to the App Router segment).
- Deleted `src/app/(shell)/opportunities/` (`page.tsx` → `/competitors`, `[id]/page.tsx` → `/topics/opportunity/[id]`).
- `npm run build` — pass; build route tree has **no** `/opportunities` or `/opportunities/[id]`. `npm run test` — 77/77 pass.
- **Note:** bookmarks to the old paths will 404 unless a `next.config` redirect is added later.
- **Re-verify (follow-up request):** `src/app/(shell)/opportunities/` still absent; `src/` still has zero `"/opportunities"` / `'/opportunities'` string links. `npm run typecheck` — pass; `npm run test` — 77/77; `npm run build` — pass; route tree still has no `/opportunities` entries.

---

## 2026-04-12 — Phase 0C-3: remove `/actions` redirect route

- Repo search for route `/actions` in `src/**/*.ts(x)`: **one** in-app link — `src/app/(shell)/briefs/proposed/page.tsx` (`href="/actions"` for “View Action”). No `navigation.ts` entry; no imports of `(shell)/actions/*` from outside that folder (`actions-client` only used `./action-state` internally).
- Updated **View Action** link to `href="/"` (same destination the redirect used). Deleted `src/app/(shell)/actions/` (`page.tsx` redirect, `actions-client.tsx`, `action-state.ts`).
- `npm run build` — pass (route no longer listed). `npm run test` — 77/77 pass.

---

## 2026-04-12 — Phase 0C-2: delete `src/adapters/legacy/`

- Searched repo for `adapters/legacy`, `@/adapters/legacy`, and `from "...legacy` in `.ts`/`.tsx`/`.js`/`.jsx`/`.json`: **zero** matches. Only documentation/audit files referenced the path as a planned deletion.
- Deleted `src/adapters/legacy/` (contained only `README.md` — no runtime adapter code).
- `npm run build` — pass. `npm run test` — 77/77 pass. No broken imports.

---

## 2026-04-12 — Phase 0C-1: delete `changelogpdf/`

- Searched entire repo for `changelogpdf` references in source code (`.ts`, `.tsx`, `.js`, `.jsx`, `.json`, `.css`, `.html`, `.gitignore`, `next.config.*`): **zero** matches. Only hits were documentation/audit files mentioning it as a deletion target.
- Deleted `changelogpdf/` — 39 PDF files (operator-generated changelog screenshots; not imported, linked, or served by the app).
- `npm run build` — pass. `npm run test` — 77/77 pass. No broken imports.

---

## 2026-04-12 — Phase 0B-3: Changes `loading.tsx`

- Added `src/app/(shell)/changes/loading.tsx` — Server Component; mirrors `/changes`: `PageHeader`-style block, tab strip (Outcomes / Attribution / Replicate), “At a glance” bordered card, outcome-category row, “Outcome mix” bordered strip, **Refine** filter placeholders, then `ScorecardTable`-shaped **9-column** table (`When`, `Work`, `Outcome`, `Score`, `Events`, `Linked`, `Match`, `Lift`, `Next`) with header row + **8** body rows (`animate-pulse`, `border-border/70`, `bg-surface-inset`, `bg-muted/*`, `bg-surface-raised/40`).
- Scoped to `/changes` segment only.
- `npm run build` — pass.

---

## 2026-04-12 — Phase 0B-2: Pages `loading.tsx`

- Added `src/app/(shell)/pages/loading.tsx` — Server Component; skeleton mirrors real `/pages` layout: `max-w-5xl` header block, KPI strip + donut placeholder, scan/tab bar placeholders, `lg:grid-cols-[minmax(260px,280px)_1fr]` split with left list (7 row cards: title + status + chip row) and right detail panel (title/path + body lines).
- Scoped to `/pages` segment only (nested `loading.tsx` under `(shell)/pages`).
- `npm run build` — pass.

---

## 2026-04-12 — Phase 0B-1: shell `loading.tsx`

- Added `src/app/(shell)/loading.tsx` — Server Component (no `"use client"`); minimal pulse skeleton (header strip + bordered content block + two card placeholders) using `border-border/60`, `bg-surface-inset/30`, `bg-muted/*`, `animate-pulse` (aligned with shell `error.tsx` tokens).
- Next.js App Router: this file is the Suspense fallback for the `(shell)` segment’s async UI (layout chrome stays mounted; main `children` slot shows skeleton while the page RSC loads).
- `npm run build` — pass.

---

## 2026-04-12 — Phase 0A-3: error boundary runtime verification

- **Shell boundary** (`src/app/(shell)/error.tsx`) — added temporary `throw new Error("shell boundary test")` inside `TopicsPage()` render body; hit `/topics`; RSC payload confirmed `E{"digest":"4011023310","name":"Error","message":"shell boundary test"}` + `src/app/(shell)/error.tsx` loaded as client module; boundary wired correctly.
- **Settings boundary** (`src/app/(shell)/settings/error.tsx`) — replaced `settings/health/page.tsx` export with inline throwing component; hit `/settings/health`; RSC payload confirmed `E{"digest":"1846340569","name":"Error","message":"settings boundary test"}` + `src/app/(shell)/settings/error.tsx` loaded with `"pagePath":"(shell)/settings/error.tsx"` in error boundary config; boundary correctly scoped to settings subtree.
- `reset()` button: verified client component receives error object and calls `reset` prop on click — pattern matches Next.js App Router spec. No additional runtime test needed (reset re-triggers RSC render, confirmed by component code).
- All temporary throws removed. `npm run build` — pass (23 static + 6 dynamic routes).

---

## 2026-04-12 — Phase 0A-2: settings `error.tsx`

- Added `src/app/(shell)/settings/error.tsx` — same client boundary pattern and styling as `(shell)/error.tsx` (settings subtree only).
- `npm run build` — pass.

---

## 2026-04-12 — Phase 0A-1: shell `error.tsx`

- Added `src/app/(shell)/error.tsx` — client component, `{ error, reset }`, “Something went wrong” + `error.message` + **Try again** (`reset()`), Beacon tokens (`border-border`, `text-foreground`, `text-muted-foreground`, `bg-surface-inset`).
- `npm run build` — pass (Next.js 16.2.2, Turbopack).

---

## 2026-04-12 — Doc accuracy + vault ladder + Cursor rule

- Restored **Tiered product stack — research-led nano-phases (1.1a–2.3h)** into `master_execution_plan.md` (before AUDIT SUMMARY; source: prior `NEXT_PHASE` ladder).
- Fixed **Next.js 15 → 16** in `HANDOFF_VERIFIED_STATE.md`, `architecture.md` (matches `package.json` `next@16`).
- Fixed **71 → 68** steps in `HANDOFF_VERIFIED_STATE.md`, `VERIFICATION_LOG.md` (2026-04-11 doc-rebuild line).
- `architecture.md`: Settings **System Health** tab described as **visible** (matches `settings/layout.tsx`).
- `SCAN_TRUTH_REFACTOR_PLAN.md`: tests section aligned to existing `tests/domains/scanning/*.test.ts` files.
- `NEXT_PHASE_EXECUTION_PLAN.md`: ladder pointer now targets real `master_execution_plan.md` heading.
- `HANDOFF_VERIFIED_STATE.md`: Key Numbers labeled **snapshot/example**; render-time row includes `persistExperiments()`.
- `.cursor/rules/core.mdc`: added **Documentation Sync Rule (MANDATORY)**; removed duplicate frontmatter fragment.

---

## 2026-04-11 — Documentation Reconstruction + Comprehensive Audit

### Documentation system rebuild
- Rewrote `HANDOFF_VERIFIED_STATE.md` as canonical START HERE entry point
- Rewrote `NEXT_PHASE_EXECUTION_PLAN.md` as active execution brain (68 steps across 6 phases)
- Rewrote `architecture.md` as pure system map (routes, domains, persistence, scan pipeline)
- Restructured `master_execution_plan.md` as context vault (historical + current + future)
- Added PURPOSE headers to all active docs with clear ownership boundaries
- Copied 9 audit files from Claude worktree to `docs/archive/audits/`
- Moved Profound research from `docs/archive/profound-integration/` to `docs/archive/research/profound-integration/`
- Archived pre-restructure handoff to `docs/archive/handoffs/HANDOFF_VERIFIED_STATE_2026-04-11.md`

### Comprehensive codebase audit (9 files in `docs/archive/audits/`)
- **Audit type:** Full codebase — product, engineering, UX, trust, launch-readiness
- **Branch:** `work/attribution-precision-20260407` at `dd121be`
- **Overall score:** 53/100
- **Product intelligence:** 75/100 (attribution, scan pipeline, proof layer, replication)
- **Operator experience:** 45/100 (Today overloaded, no error/loading states, no onboarding)
- **Production safety:** 25/100 (no error boundaries, scan blocks render, module-cached data)
- **Launch readiness:** 38/100 → estimated 72/100 after Phases 0-2 (5-8 days)
- **Key findings:** Error boundaries (0 `error.tsx`), loading states (0 `loading.tsx`), scan blocks render (120s), demo data unlabeled, 15 Today sections, render-time side effects
- **Build:** typecheck ✓, 77/77 tests ✓, build ✓

### Scan truth refactor verification
- `orchestrate-scan.ts` no longer contains `revalidatePath` (render-safe)
- `scan-action.ts` and `postImportSetup` call `revalidatePath` only after successful scans
- Today page no longer has `export const dynamic = "force-dynamic"`
- `/` is static in build output
- Tests added: `orchestrate-render-safe.test.ts`, `scan-action-revalidate-after-scan.test.ts`, `scan-action-delegates.test.ts`

---

## 2026-04-07 — New Chat Takeover

### Phase 0: Safety Checkpoint
- Branch: `checkpoint/beacon-new-chat-reset-20260407-1900`
- Commit: `2e4ddb0` — 100 files, 5820 insertions, 2916 deletions
- Tag: `beacon-handoff-20260407-1900`
- Working branch: `work/attribution-precision-20260407`
- No secrets exposed, `.data` and `.env*` gitignored

### Phase 1: Repo Truth Audit
- **Baseline score-snapshot run**: 45 events, 202 candidates, 6 auto-resolved, 39 needs-review
- **Score range**: 35–95, mean 59.0
- **Critical finding**: 60% of candidates have topic=none — overgeneration from broad changes
- **Critical finding**: evidence tiers exist but are not wired into live candidate flow
- **Critical finding**: hasMeaningfulSignal too loose — single structural factor sufficient
- **Verified**: all prior-chat claims about attribution factor repair are real
- **Verified**: review queue is fully operational on imported data
- **False**: evidence tiers affect live scoring (they don't — evidenceMeta never passed)

### Phase 2: Candidate Pruning + Evidence Tier Wiring
- Status: COMPLETE
- Files changed:
  - `src/domains/attribution/candidates.ts` — pre-score pruning, evidence tier wiring, no-content score cap, hard negatives
  - `src/domains/attribution/compute.ts` — exported EVIDENCE_TIER_BONUS/CAP
  - `src/domains/attribution/triage.ts` — topic-cluster auto-resolve rule
  - `scripts/score-snapshot.ts` — enhanced reporting with triage breakdown

#### Results

| Metric | Before | After | Change |
|--------|--------|-------|--------|
| Auto-resolved events | 6/45 | 13/45 | +117% |
| Needs-review events | 39 | 32 | -18% |
| Needs-review candidates | ~196 | 98 | -50% |
| Suppressed candidates | ~0 | 74 | new |
| Contributing candidates | ~0 | 15 | new |
| Max score | 95 | 85 | evidence cap |
| Mean score | 59.0 | 53.3 | content cap |
| Measurement leaks | yes | no | eliminated |
| Evidence tier in live scoring | no | yes | wired |

#### What the numbers mean
- Auto-resolve more than doubled: 13 events now have clear, topic-matching primaries
- Review workload halved: 98 candidates to review instead of ~196
- 74 candidates properly suppressed (not shown to operator)
- 15 candidates marked as contributing (useful context, not blocking)
- Non-topic candidates capped at 45 so they can't crowd out real matches
- Evidence tiers now flow into attribution — probable capped at 85, weak at 55

#### What remains after Phase 2
- 32 events still need review (genuinely ambiguous or no topic match)
- URL matching is 100% unknown (data gap, not logic gap)
- 0 opportunities in imported data → opportunity clustering inactive
- Evidence tier "exact" unreachable without page registry

### Build Verification (Phase 2)
- `npx next build` passes clean
- TypeScript: no errors
- All pages compile and generate successfully

---

## 2026-04-07 — Phase 4: Page Evidence Foundations

### What was implemented
1. **Domain fix**: `evidence-tier.ts` defaulted to `rfritz.com` — changed to `ritzbuilders.com` and made configurable
2. **Page registry wiring**: `candidates.ts` loads `pages.json` into `Map<url, PageEntity>` for `classifyEvidenceTier` snapshot_verified lookups
3. **Citation evidence integration**: `candidates.ts` loads `page_to_topics` from `citation-evidence-index.json` and applies +12 score bonus to content-matching candidates whose pages are cited for the event's topic
4. **Evidence tier UI**: `MatchFactors` component now renders evidence tier label with color across all 6 callsites
5. **Score-snapshot enhanced**: now uses page registry for tier distribution; reports citation support metrics

### Before/After Results

| Metric | Post-Phase-2 | Post-Phase-4 | Change |
|--------|-------------|-------------|--------|
| Auto-resolved events | 13/45 | 13/45 | maintained |
| Needs-review events | 32 | 32 | maintained |
| Needs-review candidates | 98 | 77 | -21% |
| Suppressed candidates | 74 | 95 | +28% |
| Max score | 85 | 100 | evidence tier exact unlocked |
| Mean score | 53.3 | 58.7 | +10% |
| Evidence tier "exact" reachable | no | yes (14 changes, 77 candidates) | FIXED |
| Citation evidence in scoring | no | yes (71 candidates supported) | NEW |
| Evidence tier in UI | no | yes (all callsites) | NEW |

### New Diagnostics
- **Citation-supported candidates**: 71/200 (36%) — their pages are cited for the event's topic
- **Citation-supported + no-topic**: 15 candidates — pages cited but changelog descriptions too vague for topic match
- **Evidence tier distribution (changes)**: exact 16%, probable 46%, weak 38%
- **Evidence tier distribution (candidates)**: exact 39%, probable 37%, weak 25%
- **Pages in registry**: 5,297 (42 owned)
- **Citation page-topics entries**: 5,253

### What this means
- Evidence tiers are now fully operational in the live attribution flow
- The "exact" tier is achievable and correctly requires both structural URL and page registry match
- Citation evidence provides a new topic-adjacent signal without disrupting triage stability
- The 15 citation-supported but no-topic candidates identify the biggest near-term changelog quality opportunity
- Suppressed candidates increased from 74 to 95 due to better scoring separation

### Build Verification (Phase 4)
- `npx next build` passes clean
- TypeScript: no errors
- All pages compile and generate successfully
- `score-snapshot.ts` runs successfully with page registry and citation evidence

---

## 2026-04-09 — Phase 5: Change Impact Engine

### What shipped
- **`src/domains/attribution/change-impact.ts`** — derives per-change **impact confidence** (high/medium/low), **direction** (positive/negative/mixed/none from outcome event mention context), **why** (multi-sentence explanation), **next action** (operator recommendation) from existing `ScorecardRow` data
- **Types** — `ChangeImpact`, `ImpactConfidence`, `ImpactDirection`; `ChangeVerdict` extended with `negative` (badge + filters; scorecard does not yet emit it until decline events exist)
- **UI** — `/changes`: impact snapshot strip, confidence badge, “What to do” column; `/changes/[id]`: Impact assessment section

### Constraints honored
- No persistence or schema changes; no changes to attribution scoring weights or `computeScorecard` verdict logic

### Build verification (Phase 5)
- `npm run check`, `npm run test`, `npm run data:parity` — pass; 17/17 routes build

---

## 2026-04-09 — Phase 6: Measurement Honesty (URL + Decline)

### What shipped
- **URL normalization** in `matchUrl` (`compute.ts`): `normalizePageUrl` + `canonicalizeOwnedUrl` replace raw string comparison. Handles path-only, full URLs, legacy domains, UTM strip, www/m prefix.
- **Decline event detection** in `events.ts`: `visibility_lost` (mentions → 0 after gap) and `mention_decline` (sharp rate drop). Symmetric to existing positive events.
- **Scorecard negative verdict** (`scorecard.ts`): when all linked events are negative + change is primary → `negative`
- **Impact Engine** (`change-impact.ts`): direction uses event type system; explanation distinguishes negative from positive
- **UI labels**: review + changes detail pages display new event types with danger styling

### Constraints honored
- No persistence changes, no new tables, no scoring weight changes
- Existing positive event detection unchanged
- Build, tests, parity all pass

### Build verification (Phase 6)
- `npm run check`, `npm run test`, `npm run data:parity` — pass; 17/17 routes build

---

## 2026-04-09 — Phase 7: Today Decision Surface

### What shipped
- **Today page (`/`)** now renders top 5 change impact signals from `enrichWithImpact`
- Server component (`page.tsx`): sorts by verdict priority + confidence + score, filters out `too_early`/`pending`/zero-event rows
- Client component (`today-client.tsx`): `TodayImpactItem` type; "Change impact signals" section with verdict dots, confidence badges, next-action text, score/event counts
- Validated/negative changes get colored borders for instant triage

### Constraints honored
- No persistence changes. No new data computation — reuses existing `enrichWithImpact`. No changes to scorecard or attribution logic.

### Build verification (Phase 7)
- `npm run check`, `npm run test`, `npm run data:parity` — pass; 17/17 routes build

---

## 2026-04-09 — Phase 8: Recommendation Engine

### What shipped
- **`src/domains/product/recommendation-engine.ts`** — synthesis engine connecting proven impact to structural page gaps
- Three recommendation types: **replicate** (apply proven pattern to similar page), **strengthen** (improve weak changelog entry), **investigate** (flag negative impact regression)
- Pattern matching: proven change URL -> mined pattern source pages -> playbook briefs for other pages with same gap
- "Strengthen" nudges identify specific gaps (no URL, no topic, no hypothesis) and suggest the topic from linked events
- Fallback: top playbook briefs when no proven patterns exist

### Today page integration
- `page.tsx` calls `computeRecommendations`, passes top 5 to client
- High-confidence replicate recommendation becomes first "Next best move" candidate (proactive, not reactive)
- `today-client.tsx` renders "Recommended moves" section with type-colored cards, confidence badges, evidence summaries

### Constraints honored
- No persistence changes, no new stores, no scoring formula changes
- Pure synthesis of existing data: scorecard, impact rows, mined patterns, playbook briefs
- No changes to attribution logic, evidence tiers, or triage

### Build verification (Phase 8)
- `npm run check`, `npm run test`, `npm run data:parity` — pass; 17/17 routes, 26/26 tests, 15/15 parity

---

## 2026-04-09 — Phase 9: Priority Engine

### What shipped
- **`src/domains/product/priority-engine.ts`** — 6-dimension scoring (impact confidence, evidence strength, pattern strength, replication potential, type urgency, recency) producing 0-100 priority score per recommendation
- Four buckets: CRITICAL (>=72), HIGH_LEVERAGE (>=50), OPPORTUNISTIC (>=25), NOISE (<25, filtered)
- `rankAndSelect()` picks single primary action + ranked secondary list
- Per-action expected outcome text (visibility improvement / evidence upgrade / loss prevention)

### Today page enforcement
- "DO THIS NOW" block replaces "Next best move" when primary action exists
- Visually dominant: bold border colored by bucket, priority score badge, "Why" + "Expected outcome" sections, bold CTA
- Secondary recommendations collapse into "Other opportunities (N)" toggle — reduces decision paralysis
- Graceful fallback: when no primary action qualifies, existing next-best-move logic renders unchanged

### Also modified
- `src/domains/product/recommendation-engine.ts` — added `patternId` and `citationOpportunity` to `BeaconRecommendation` for priority context

### Constraints honored
- No persistence changes, no new stores, no scoring formula changes
- No changes to attribution logic, evidence tiers, or triage
- Existing recommendation engine logic unchanged; priority engine is a pure post-processing layer

### Build verification (Phase 9)
- `npm run check`, `npm run test`, `npm run data:parity` — pass; 17/17 routes, 26/26 tests, 15/15 parity

---

## 2026-04-09 — Phase 10: Changes Detail Action Generation

### What shipped
- **`/changes/[id]`** now runs the full recommendation engine and surfaces change-specific actions inline
- Validated/partial + positive changes: **"Apply this pattern"** section listing specific target pages (up to 6) with the same structural gap, citation counts, and deep links to Website
- Weak-evidence changes with linked events: **"Strengthen this entry"** section showing specific missing fields (URL, topic, hypothesis) and suggested topic from event data
- Full pipeline: `enrichWithImpact` → citation map → `minePatterns` → `generateBriefs` → `computeRecommendations` → filter by `sourceChangeId`

### Constraints honored
- No new modules, no new types, no new stores, no scoring formula changes
- Today page unchanged, Changes list unchanged, recommendation engine unchanged
- Pure surfacing of existing intelligence on an existing page

### Build verification (Phase 10)
- `npm run check`, `npm run test`, `npm run data:parity` — pass; 17/17 routes, 26/26 tests, 15/15 parity

---

## 2026-04-09 — Phase 11: Recommendation Feedback Loop

### What shipped
- **`src/domains/product/recommendation-tracker.ts`** — retroactive matching of changes to recommendation patterns
- Core logic: if proven change A for pattern P existed before change B (same pattern, different page), then B was likely fulfilling a Beacon recommendation
- Per-pattern track record with success rate: (validated + partial) / (total - tooEarly - pending)
- `wasChangeRecommended()` helper for per-change lookups

### Priority engine reinforcement
- 7th scoring dimension: pattern track record (-5 to +10 bonus)
- Patterns with >=70% historical success rate get +10 boost; poor patterns with negatives get -5 penalty
- Minimum 2 acted-on changes required to activate (prevents noise)

### Surface integration
- Today page: "Beacon track record" line showing N acted on, M validated, success rate %
- `/changes/[id]`: "Beacon recommended" badge with match confidence and pattern name

### Constraints honored
- No new persistence, no new stores, no new tables
- Recommendation engine logic unchanged
- Attribution scoring unchanged
- Pure computation from existing scorecard + pattern data

### Build verification (Phase 11)
- `npm run check`, `npm run test`, `npm run data:parity` — pass; 17/17 routes, 26/26 tests, 15/15 parity

---

## 2026-04-09 — Phase 12: Changes List Intelligence Surface

### What shipped
- **`/changes/page.tsx`** — server-side enrichment: pattern mining + brief generation + track record computation + per-change intelligence map
- **`scorecard-client.tsx`** — "Beacon" badge (with confidence qualifier), "N replicable" badge, "Beacon recommended" toggle filter, "Impact" sortable column
- Impact snapshot strip: Beacon-recommended count + total replication targets

### What was NOT touched
- Recommendation engine, priority engine, recommendation tracker: all unchanged
- Attribution scoring unchanged
- Today page unchanged
- Change detail page unchanged
- No new modules, no new domain types, no new stores or persistence

### Constraints honored
- No new persistence, no new stores, no new tables
- Pure surfacing of existing intelligence computations on the changes list page
- Existing table structure preserved; new badges are additive, not replacing existing columns

### Build verification (Phase 12)
- `npm run check` — pass (tsc --noEmit clean)
- Lints: clean on both modified files

---

## 2026-04-09 — Phase 13: Recommendation Response

### What shipped
- **`src/domains/product/recommendation-response-store.ts`** — new json-store persistence for operator responses to recommendations
  - Types: `RecommendationResponse`, `RecommendationResponseStatus` (accepted/dismissed/deferred)
  - `recordResponse()`: upserts response, sets 7-day deferUntil for deferred
  - `isRecSuppressed()`: returns true for dismissed or not-yet-due deferred
  - `getResponse()`: lookup by recId
- **`src/app/(shell)/recommendation-actions.ts`** — server action `respondToRecommendation(recId, status)`
- **Today page** (`page.tsx`): filters suppressed recs before `rankAndSelect`; adds `id` + `responseStatus` to serialized primary action and secondary recs; passes `onRespondToRec` callback to client
- **Today client** (`today-client.tsx`): Accept/Not now/Dismiss buttons on primary action; Accept/Not now/Dismiss buttons on secondary opportunities; "Accepted" badge; action message feedback

### What was NOT touched
- Recommendation engine: unchanged
- Priority engine scoring: unchanged
- Recommendation tracker retroactive matching: unchanged
- Attribution scoring: unchanged
- Changes list page: unchanged
- Change detail page: unchanged
- No Supabase schema changes

### Constraints honored
- One new json-store (`recommendation-responses`) — minimal persistence, follows existing pattern
- All response logic is additive; no existing behavior modified
- Dismissed/deferred filtering happens before ranking, not inside the engine

### Build verification (Phase 13)
- `npm run check` — pass (tsc --noEmit clean)
- Lints: clean on all 4 modified/new files

---

## Phase 14 — Daily Surface Compression + Visibility Story (2026-04-09)

### What shipped
- **Visibility summary strip**: total citations with trend %, per-platform breakdown, data freshness indicator with stale-data warning
- **Navigation compression**: 2 groups (5 primary, 5 advanced). Competitors promoted. Work + Experimental groups removed.
- **Impact signals reduced** from 5 to 3, renamed "What changed"
- **Work queue collapsed** by default
- **System details collapsed** by default (crawl, visibility sample, attribution, verified fixes)
- **Today layout reordered**: Visibility strip → DO THIS NOW → Track record → What changed → Other opportunities → Work queue (collapsed) → System details (collapsed)

### What was NOT touched
- Attribution engine, recommendation engine, priority engine unchanged
- Supabase schema unchanged
- Import pipeline unchanged
- All domain modules unchanged
- Changes / Pages / Competitors surfaces unchanged
- No new persistence, no new modules, no new stores

### Constraints honored
- Zero new infrastructure
- Zero new data systems
- Pure surface-level restructuring using existing computed data
- All existing intelligence preserved, just better hierarchied

### Build verification (Phase 14)
- `npm run check` — pass (0 errors, 71 warnings — all pre-existing)
- Build: 17/17 static pages generated

---

## Phase 15 — Import Simplification + Freshness Loop (2026-04-09)

### What shipped
- **Coverage strip** on Import page: result count, change count, date range, freshness
- **Drag-and-drop upload zone** with clear delta messaging
- **Delta-aware result**: new vs updated counts for results + changes, post-import date range
- **Return-to-Today CTA** (was "Open Review Queue")
- **Advanced sections collapsed**: Profound CSV, Manual paste, Reset, History behind toggle
- **Page title**: "Import" (was "Import Historical Data")
- **New server action**: `getDataCoverage()` for coverage data
- **Enhanced type**: `WorkbookImportResult.delta` for new-vs-updated tracking

### What was NOT touched
- Import engine, workbook parser, Profound pipeline unchanged
- Attribution, recommendation, priority engines unchanged
- Supabase schema unchanged
- All domain modules unchanged
- Today, Changes, Pages surfaces unchanged

### Constraints honored
- Zero new infrastructure
- Zero new data systems or persistence
- Existing import behavior preserved; UX-only restructuring + delta tracking addition

### Build verification (Phase 15)
- `npm run check` — pass (0 errors, 71 pre-existing warnings)
- Build: 17/17 static pages generated

---

## Phase 16 — Page Intelligence Surface (2026-04-09)

### What shipped
- **Summary strip**: total pages, winning (green), needs action (red), building (blue), cited count + total citations, structure warnings (pages missing FAQ/schema)
- **Health card** at top of detail panel: status badge, citation count + platforms, FAQ/Schema health, next action block
- **Structure health in list items**: "no FAQ" / "no schema" visible in page list
- **Evidence internals** moved into "Show details" progressive disclosure
- **Page title**: "Pages" / "Page-level AI visibility health and actions"
- **7 lint warnings resolved**: previously unused summary stat variables now consumed

### What was NOT touched
- Page computation logic (770-line server) unchanged
- Attribution, recommendation, priority engines unchanged
- Import pipeline unchanged
- Supabase schema unchanged
- All domain modules unchanged
- Fix brief, playbook brief, wave, verification functionality preserved

### Constraints honored
- Zero new infrastructure or persistence
- Pure rendering restructure of existing computed data
- All existing functionality preserved in progressive disclosure

### Build verification (Phase 16)
- `npm run check` — pass (0 errors, 64 warnings — down from 71, 7 resolved)
- Build: 17/17 static pages generated

---

## Phase 17 — Competitive Clarity Surface (2026-04-09)

### What shipped
- **Competitive summary strip**: AI share %, citation count, tracked competitor count
- **Ranked competitor list**: sorted by citations, "Ahead of you" badges, links to detail
- **Competitive gap visualization**: "Where you are strongest" (green bars) vs "Biggest competitive gaps" (red bars)
- **Weakest areas card**: topics with lowest share
- **Next moves**: action links derived from benchmark
- **Settings collapsed**: universe CRUD + imported entities behind toggle
- Wired `computeMarketBenchmark` from `builder-benchmark.ts` (previously unused on this surface)

### What was NOT touched
- Competitor detail page (`/competitors/[id]`) unchanged
- Competitor domain modules (16 files) unchanged
- Attribution, recommendation, priority engines unchanged
- Import pipeline unchanged
- Supabase schema unchanged
- All other surfaces unchanged

### Constraints honored
- Zero new infrastructure or persistence
- Reused existing `computeMarketBenchmark` computation (zero new scoring logic)
- Configuration/management functionality preserved in collapsed settings

### Build verification (Phase 17)
- `npm run check` — pass (0 errors, 64 warnings)
- Build: 17/17 static pages generated

---

## Phase 18 — Track Record Enhancement (2026-04-09)

### What shipped
- **`SignalTier`** type on `TrackedOutcome`: `"explicit"` (operator accepted the rec for this page) vs `"inferred"` (retroactive pattern matching)
- **`computeTrackRecord` enhanced**: accepts optional `responses` + `recommendations`; bridges rec IDs to pattern IDs; maps accepted target pages to explicit outcomes
- **`PatternTrackRecord` enhanced**: `explicitAccepted`, `explicitDismissed` per pattern
- **`TrackRecordSummary` enhanced**: `totalExplicitAccepted`, `totalExplicitDismissed`
- **Priority engine enhanced**: explicit acceptance bonus (+2/+4), explicit dismissal penalty (-3/-7), dismissal penalty applies without actedOn threshold
- **Today surface**: track record line shows accepted/dismissed counts

### Signal flow
1. Accept/dismiss on Today → recommendation-response-store (already existed)
2. `computeTrackRecord` receives responses + recommendations (new)
3. Accepted recs bridged to patterns via recId → patternId (new)
4. Outcomes on accepted target pages tagged `signalTier: "explicit"` (new)
5. Per-pattern explicit counts flow into priority scoring (new)
6. Dismissed patterns penalized in priority scoring (new)

### What was NOT touched
- Recommendation engine unchanged
- Recommendation response store unchanged
- Import pipeline unchanged
- Supabase schema unchanged
- All surfaces except Today track record line unchanged
- `/changes` and `/changes/[id]` continue working with optional params

### Constraints honored
- Zero new infrastructure or persistence
- New tracker params are optional — backward compatible
- Explicit signals strengthen existing loop, no new scoring system

### Build verification (Phase 18)
- `npm run check` — pass (0 errors, 64 warnings)
- Build: 17/17 static pages generated

---

## Phase 19 — Multi-Dimensional Recommendation Expansion (2026-04-09)

### What shipped
- **4 new recommendation types**: `strengthen_structure` (cited pages missing FAQ/schema), `improve_internal_links` (cited pages with <5 links), `refresh_content` (cited but thin content), `competitive_displacement` (topics where competitors have ≥2x our share)
- **Evidence-gated generation**: each type requires citation minimums + structural gaps; capped at 2-3 per type
- **Priority engine**: new urgency weights (competitive: 12, structure: 10, refresh: 8, links: 6)
- **Expected outcome generation** for all 4 new types
- **Today accent colors**: structure/links = blue, refresh = yellow, competitive = red
- **Client types widened**: `type` field accepts any rec type string (forward-compatible)
- **Today server**: wires `pageSnapshots`, `citMap`, `citationEvidenceIndex` into rec engine

### Anti-spam design
- Recommendations require real evidence (citations + gaps), not templated cloning
- Each type capped to max 2-3 recs
- City/service expansion remains one class among seven
- Refinement types prioritized over net-new page creation

### What was NOT touched
- Existing replicate/strengthen/investigate logic unchanged
- Recommendation tracker unchanged
- Response store unchanged
- Import, Supabase, persistence unchanged
- All surfaces except Today (rec display + accent colors)

### Constraints honored
- Zero new infrastructure or persistence
- New rec inputs are optional — backward compatible for `/changes/[id]` callsite
- All new logic is evidence-grounded and capped

### Build verification (Phase 19)
- `npm run check` — pass (0 errors, 64 warnings)
- Build: 17/17 static pages generated

---

## Phase 20 — In-App Trust Layer + Evidence Explainability (2026-04-09)

### What shipped
- **DO THIS NOW evidence block**: evidence basis, confidence level + reason, data freshness, "after acting" watch guidance
- **Confidence reasons**: computed from evidence tier, citation count, pattern track record success rate
- **Watch-after guidance**: per-type instructions for post-action monitoring
- **Data freshness**: "Based on data through [date]" displayed on primary action
- **Secondary rec evidence**: inline evidence + confidence reason
- **Pages status reason**: `statusReason` explains why a page is Winning/Building/Unresolved/Dormant

### What was NOT touched
- Recommendation engine, priority engine unchanged
- Tracker, response store unchanged
- Import, Supabase, persistence unchanged
- Competitor surface, changes surfaces unchanged

### Constraints honored
- Zero new infrastructure or persistence
- Trust primitives derived entirely from existing computed data
- Progressive disclosure maintained — summary first, evidence on demand

### Build verification (Phase 20)
- `npm run check` — pass (0 errors, 64 warnings)
- Build: 17/17 static pages generated

---

## Phase 21 — Topic-Similarity / Adjacent Opportunity Expansion (2026-04-09)

### What shipped
- **`cross_page_pattern`**: proven structural pattern on page type A → apply to different page type B with shared topic/term overlap. REQUIRES different page types (anti-spam).
- **`topic_cluster_gap`**: topic with ≥15 owned citations but only transactional pages → recommends guide/comparison content.
- **Priority engine**: cross-page urgency 7, cluster gap urgency 5
- **Expected outcome + watch-after** for both types
- **Today accent colors**: cross-page = green, cluster gap = blue
- **`allPages`** wired into recommendation engine

### Anti-spam design
- `cross_page_pattern` requires DIFFERENT page types — cannot produce city→city clones
- `topic_cluster_gap` recommends MISSING content types, not more of what exists
- Capped at 3 + 2 recs. Citation evidence thresholds enforced.
- Recommendation system now spans 9 types across structure, links, content, competitive, adjacency, and cluster dimensions

### What was NOT touched
- Existing 7 rec types unchanged
- Tracker, response store unchanged
- Import, Supabase, persistence unchanged
- All surfaces except Today unchanged

### Constraints honored
- Zero new infrastructure or persistence
- New rec input (`allPages`) is optional — backward compatible
- Adjacency derived from existing page registry + snapshot terms + citation index

### Build verification (Phase 21)
- `npm run check` — pass (0 errors, 64 warnings)
- Build: 17/17 static pages generated

---

## Phase 22 — In-App Experiment Loop / Watchlist (2026-04-09)

### What shipped
- **`experiment-store.ts`**: `Experiment` type with `testing`/`watching`/`promising`/`inconclusive`/`negative`/`dropped` statuses; `startExperiment`, `updateExperimentCitations` (auto-status), `updateExperimentStatus`, `updateExperimentNote`
- **`experiment-actions.ts`**: server actions for start, update status, update note
- **"Start testing" button**: appears on accepted DO THIS NOW → prompt for operator note → experiment created with citation baseline
- **Watchlist section on Today**: active experiments showing headline, note, status badge, days elapsed, citation delta, watch-after, "Drop" action
- **Auto-outcome detection**: on page load, experiments refresh citation counts; status auto-updates based on delta + time
- **Store**: `.data/experiments.json` via json-store

### Experiment lifecycle
1. Accept rec on Today → "Start testing" button appears
2. Click → enter note → experiment created with citation baseline
3. Watchlist shows on Today between track record and "What changed"
4. On next page load after import: citations auto-refresh, status auto-updates
5. Operator can manually drop experiments

### What was NOT touched
- Recommendation engine, priority engine unchanged
- Tracker, response store unchanged
- Import, Supabase unchanged
- All surfaces except Today unchanged

### Constraints honored
- One new json-store (`experiments`) — follows existing pattern
- Lightweight experiment model — not project management
- Auto-outcome uses existing citation data — no new computation
- "Too early" / "inconclusive" are honest statuses

### Build verification (Phase 22)
- `npm run check` — pass (0 errors, 64 warnings)
- Build: 17/17 static pages generated

---

## Phase 23 — Nightly Usage Hardening (2026-04-09)

### What shipped
- **Combined "Accept & test"**: one-click accepts rec + prompts for note + creates experiment with target data
- **Button hierarchy fixed**: not-accepted state shows Accept & test / Accept only / Not now / Dismiss. Accepted state shows Go → / Start testing / status badge. No dismiss after accept.
- **Target data flows through**: `targetPageUrl`, `targetPagePath`, `baselineCitations` serialized from recommendation data into experiment creation
- **Post-import messaging**: "Your visibility story and watchlist experiments will refresh with the new data"

### Friction points resolved
1. Two-step Accept → Start testing → one combined "Accept & test"
2. "Do it now →" as first CTA → "Accept & test" is now primary
3. "Not now" / "Dismiss" visible after accepting → hidden
4. Experiments started with null target → now captures real page + citations
5. Post-import silent about watchlist → now mentions refresh

### What was NOT touched
- Recommendation engine, priority engine unchanged
- Experiment store model unchanged
- Tracker, response store unchanged
- Import pipeline, Supabase, persistence unchanged
- All surfaces except Today + Import post-import unchanged

### Constraints honored
- Zero new infrastructure or persistence
- Pure friction reduction — no new systems
- All changes are button/flow/messaging improvements

### Build verification (Phase 23)
- `npm run check` — pass (0 errors, 64 warnings)
- Build: 17/17 static pages generated

---

## QA Hardening Pass (2026-04-09)

### Bug fixed
- **`recHref` routing bug**: function only checked `r.type === "replicate"` before using `targetPageUrl`. All Phase 19/21 rec types (`strengthen_structure`, `improve_internal_links`, `refresh_content`, `cross_page_pattern`) have `targetPageUrl` but are not type `"replicate"`, so "Go →" / "Continue →" linked to wrong destination (generic `/pages` or source change instead of target page). Fixed: check `targetPageUrl` first regardless of type; added `/competitors` fallback for competitive/cluster recs.

### Build verification (QA pass)
- `npm run check` — pass (0 errors, 64 warnings)
- Build: 17/17 static pages generated

---

## Product Premiumization Pass (2026-04-09)

### What shipped
- **Navigation**: Topics→Opportunities, Sample history→History, Draft ideas removed from nav (page still accessible via URL)
- **Today primary action**: raw priority score removed; "Do this now"→"Recommended action"; evidence block compressed from 4 labeled rows to 1 inline confidence line; raw sample count removed from visibility strip
- **Rec type labels**: "Proven pattern"→"Apply pattern", "Strengthen evidence"→"Strengthen", "Competitive gap"→"Close gap", "Cross-page pattern"→"Apply pattern", "Topic cluster"→"Expand"
- **Pages**: verbose description removed; next-move labels: "Doing well"→"Strong", "Needs review"→"Review", "Needs stronger content"→"Strengthen"
- **Changes**: title "What You've Changed"→"Changes"; ops description removed
- **Competitors**: description removed
- **Topics**: "Gap ledger"→"Opportunities"
- **Import**: description removed

### What was NOT touched
- All intelligence logic, domain modules unchanged
- Recommendation engine, priority engine, tracker unchanged
- Experiment store, response store unchanged
- Persistence, Supabase unchanged

### Build verification (Premiumization pass)
- `npm run typecheck` — pass (0 errors)
- Build: 17/17 static pages generated

---

## Master UI/UX research audit + product presentation roadmap (2026-04-09)

### What shipped
- **Documentation only:** Appended **Master UI/UX product shell overhaul — PLANNED** to `docs/master_execution_plan.md` (Shell Phases A–H: design system, nav/IA, Today, Pages, Changes, Competitors/Topics/Review, Import/History/Diagnostics/Expansion, watchlist polish; external reference links; explicit non-goals).
- **Execution pointer:** Updated `docs/NEXT_PHASE_EXECUTION_PLAN.md` with **Master UI/UX product shell overhaul — RESEARCH COMPLETE, IMPLEMENTATION QUEUED** and set **Track 0 (Shell A–H)** as recommended next work before new intelligence tracks.
- **Verified state:** `docs/HANDOFF_VERIFIED_STATE.md` — new row block clarifying research-only status and queued shell phases.
- **Architecture:** `docs/architecture.md` — **Product Direction** nav bullets corrected to match shipped labels (Opportunities, History); added **Presentation layer (planned)** subsection pointing to Shell Phases A–H.

### What was NOT touched
- **Zero application code** (no components, styles, or routes modified).
- No new markdown files.
- Attribution, recommendation, priority, tracker, experiments, import backends, persistence — **unchanged**.

### Constraints honored
- Research + planning pass only; stop point explicit for handoff to implementation agent.
- External claims tied to cited sources (Linear, Stripe, Amplitude, Superhuman, Ramp/Fast Company, etc.).

### Build verification (this pass)
- N/A — docs-only; no `npm run check` required for scope.

---

## Shell Phase A — Design System + Chrome Baseline (2026-04-10)

### What shipped
- **Sidebar chrome recede:** `--sidebar` token darkened slightly (0.985→0.978 light, 0.205→0.175 dark); `--sidebar-foreground` muted (0.145→0.371 light, 0.985→0.708 dark); `--sidebar-border` softened to match `--border-subtle`; group labels changed from `uppercase tracking-widest` to sentence-case `tracking-normal`; inactive items use `text-sidebar-foreground` instead of `text-muted-foreground`; outer border uses `border-sidebar-border`
- **Global border softening:** `--border` lightened from `oklch(0.922)` to `oklch(0.935)` — every `border-border` in the app is now calmer
- **Uppercase purge:** Removed `uppercase tracking-wider` and `uppercase tracking-widest` from **all** route files and shared components (~153 instances across 27 files). Section labels now use sentence-case with normal tracking
- **Typography floor:** `text-[9px] font-semibold` → `text-[11px] font-medium` and `text-[9px] font-bold` → `text-[11px] font-semibold` on Today page (9 instances). Shared components (StatCard, FormField, command palette) labels bumped to `text-xs`/`text-[11px]` from `text-[9px]`–`text-[11px]` with admin modifiers removed
- **PageHeader hierarchy:** title from `text-base` (16px) to `text-lg` (18px); description from `text-[13px]` to `text-sm`; bottom margin from `mb-6` to `mb-8`. Inline `<h2>` titles on Pages and Topics routes matched to `text-lg`
- **StatCard de-admin:** label changed from `text-[11px] font-medium uppercase tracking-wider` to `text-xs text-muted-foreground`; border softened from `border-border` to `border-border/60`; radius from `rounded-md` to `rounded-lg`
- **Header chrome:** bottom border softened with `border-border/50`; stale breadcrumb "Gap ledger"→"Opportunities", "Gap detail"→"Opportunity detail"
- **Vocabulary cleanup:** Layout palette group "Gap ledger"→"Opportunities"; command palette GROUP_ORDER updated to match

### Files changed
- `src/app/globals.css` — sidebar tokens, border tokens
- `src/components/shell/app-sidebar.tsx` — sidebar chrome, labels, borders, semantic colors
- `src/components/shell/app-header.tsx` — border, breadcrumb labels
- `src/components/shell/command-palette.tsx` — group label styling, GROUP_ORDER
- `src/components/data/page-header.tsx` — title size, spacing
- `src/components/data/stat-card.tsx` — label, border
- `src/components/forms/form-controls.tsx` — label
- `src/components/data/entity-link-card.tsx` — label
- `src/components/data/attribution-card.tsx` — label
- `src/components/data/candidate-review.tsx` — labels
- `src/components/data/competitive-landscape.tsx` — label
- `src/app/(shell)/layout.tsx` — palette group name
- `src/app/(shell)/today-client.tsx` — uppercase purge + type floor
- `src/app/(shell)/pages/page.tsx` — title size
- `src/app/(shell)/pages/pages-client.tsx` — uppercase purge
- `src/app/(shell)/changes/page.tsx` — uppercase purge
- `src/app/(shell)/changes/[id]/page.tsx` — uppercase purge
- `src/app/(shell)/changes/scorecard-client.tsx` — uppercase purge
- `src/app/(shell)/changes/change-contract-client.tsx` — uppercase purge
- `src/app/(shell)/competitors/page.tsx` — uppercase purge
- `src/app/(shell)/competitors/[id]/page.tsx` — uppercase purge
- `src/app/(shell)/topics/page.tsx` — title size
- `src/app/(shell)/topics/topics-client.tsx` — uppercase purge + Gap ledger rename
- `src/app/(shell)/topics/opportunity/[id]/page.tsx` — uppercase purge
- `src/app/(shell)/import/page.tsx` — uppercase purge
- `src/app/(shell)/diagnostics/page.tsx` — uppercase purge
- `src/app/(shell)/results/[id]/page.tsx` — uppercase purge
- `src/app/(shell)/review/review-queue-client.tsx` — uppercase purge
- `src/app/(shell)/briefs/proposed/page.tsx` — uppercase purge
- `src/app/(shell)/briefs/[id]/page.tsx` — uppercase purge
- `src/app/(shell)/expansion/page.tsx` — uppercase purge
- `src/app/(shell)/observations/[id]/page.tsx` — uppercase purge
- `src/app/(shell)/actions/actions-client.tsx` — uppercase purge

### What was NOT touched
- Attribution, recommendation, priority, tracker, experiment stores — **unchanged**
- Import pipeline, Supabase, persistence — **unchanged**
- Page-specific content, copy, or information architecture — deferred to Shell Phases B–H
- Navigation grouping / item naming / route URLs — deferred to Shell Phase B
- Today hero structure, CTA consolidation — deferred to Shell Phase C

### Build verification (Shell Phase A)
- `npm run typecheck` — pass (0 errors)
- `npm run build` — pass, 17/17 static pages generated

---

## Shell Phase B — Navigation + IA Alignment (2026-04-10)

### Shipped
1. **Nav group restructure**: “Advanced” → “Data” (Import, Review, History) + “System” (Diagnostics)
2. **Shortcut realignment**: `G P` Pages, `G C` Changes, `G X` Competitors, `G I` Import; removed duplicates (`G S`, `G H`) and ghost (`G E`)
3. **Help panel**: Labels updated to short product names; duplicate/stale entries removed
4. **Page title alignment**: “Sample history” → “History”; “Diagnostics (analyst)” → “Diagnostics”
5. **Vocabulary cleanup**: “Sample history” purged from ~10 user-facing strings; “Gap ledger” → “Opportunities” in remaining surfaces; “Your Website” → “Pages”; “daily workflow” replaces stale references

### Files changed
- `src/lib/navigation.ts` — group structure + labels
- `src/components/shell/app-sidebar.tsx` — NAV_SHORTCUTS
- `src/components/shell/command-palette.tsx` — keyboard routes + help panel
- `src/app/(shell)/layout.tsx` — NAV_SHORTCUTS for palette items
- `src/app/(shell)/results/results-client.tsx` — page title + description
- `src/app/(shell)/diagnostics/page.tsx` — page title + description
- `src/app/(shell)/expansion/page.tsx` — empty-state copy
- `src/app/(shell)/page.tsx` — link label
- `src/app/(shell)/observations/[id]/page.tsx` — link labels (2 instances)
- `src/lib/today-summary.ts` — fallback evidence text
- `src/lib/import/actions.ts` — scope_label strings (2 instances)
- `src/domains/competitors/universe-drift-copy.ts` — user-facing copy
- `src/domains/observations/visibility-read.ts` — scope_label strings (2 instances)

### What was NOT touched
- Attribution, recommendation, priority, tracker, experiment stores — **unchanged**
- Import pipeline, persistence — **unchanged**
- Page-specific content restructuring — deferred to Shell Phases C–H
- Today hero structure — deferred to Shell Phase C

### Build verification (Shell Phase B)
- `npx tsc --noEmit` — pass (0 errors)
- `npm run build` — pass, all static pages generated
- Linter — 0 errors on modified files

---

## Shell Phase C — Today Content Overhaul (2026-04-10)

### Shipped
1. **Primary action card sculpted**: Removed "Why"/"Expected outcome" labeled blocks; rationale flows as natural prose with inline expected outcome; confidence/freshness/watch-after consolidated into two compact support lines instead of three separate micro-blocks
2. **CTA hierarchy simplified**: "Accept & test" is the dominant button; "Accept only", "Not now", and "Dismiss" are now text links instead of bordered buttons — reduces visual competition
3. **Track record reframed as momentum**: Dropped raw "% success" and dismissed count; shows "N accepted · N acted on · N confirmed positive" — reinforcing, not evaluative
4. **Watchlist tightened**: Proper `text-xs font-semibold` section heading; cards use lighter borders (`border-border/60`); operator note moved below metrics; watch-after text removed from cards (already shown in action card)
5. **"What changed" cleaned**: Asset names raised to `text-[13px]`; default border lightened to `border-border/60`; redundant "All changes →" link removed (nav provides this)
6. **Collapsed sections unified**: All three disclosure toggles (Other opportunities, Work queue, System details) now use consistent `text-[11px] font-medium` with `text-[9px]` triangle
7. **Visibility strip streamlined**: Date range removed (freshness link covers recency); "trend" label dropped from trend indicator; border softened to `border-border/60`
8. **Fallback action card cleaned**: Removed "evidence scope" label and "ObservationRun" link jargon; simplified to headline + evidence text + Go button
9. **Stale vocabulary**: "Website" → "Pages" in queue detail strings (3 instances)

### Files changed
- `src/app/(shell)/today-client.tsx` — all Today hierarchy/structure/CTA/section changes
- `src/app/(shell)/page.tsx` — stale "Website" vocabulary in queue item strings

### What was NOT touched
- `rankAndSelect`, `computeRecommendations`, priority engine — **unchanged**
- Experiment store, track record computation — **unchanged**
- Attribution, import, persistence — **unchanged**
- Other page surfaces (Pages, Changes, Competitors) — deferred to Shell Phases D–H

### Build verification (Shell Phase C)
- `npx tsc --noEmit` — pass (0 errors)
- `npm run build` — pass, all static pages generated
- Linter — 0 errors on modified files

---

## Shell Phase D — Pages list/detail productization (2026-04-10)

### Shipped
1. **Summary strip**: Larger type, softer border, “strong / need work / mentions”, structure line as neutral copy (without Q&A / without structured data, crawled count)
2. **Toolbar**: “Refresh crawl”, “View run”, filter pills (Needs work · Strong · Active · All) with inverted primary
3. **List**: Wider column, 13px titles, open-item count without uppercase, muted chips for missing Q&A/schema
4. **Detail**: Brief-style header; mention count chip; Q&A + structured data pills; consolidated “Next step”; “Why it matters” / “Recommended move” / “Opportunity”
5. **Actions**: Foreground “Hand off to dev”, “Mark live”, “Verify fix”; “Log in Changes →”
6. **Disclosure**: Renamed “Evidence & technical detail”; duplicate next-move footer removed from expanded area
7. **Fix brief blocks** (inside disclosure): Target / Live page, softer “Intent mismatch”, “Next move” callout
8. **Server**: `statusReason` without “needs review”; dormant copy; Pages subtitle

### Files changed
- `src/app/(shell)/pages/page.tsx`
- `src/app/(shell)/pages/pages-client.tsx`

### Not touched
- Page store, snapshots, guardrails computation, issue/playbook server actions

### Build
- `npx tsc --noEmit` — pass
- `npm run build` — pass

---

## Shell Phase E — Changes scorecard + contract productization (2026-04-10)

### Shipped
1. **Route** (`changes/page.tsx`): Outcome-first header copy; **At a glance** strip; scorecard above **Records & verification** block.
2. **Scorecard** (`scorecard-client.tsx`): Default-closed **Outcome mix** (verdict counts; avoids duplicating “confirmed in Review” vs page strip); **Refine** controls; shorter column labels; denser rows; softened **Linked** role presentation; long descriptions expandable; **Beacon picks only** filter label.
3. **Records** (`change-contract-client.tsx`): Primary actions first; **How scan check works** collapsed; per-contract compact header with inline **Run check** / re-check; colored one-line verification summary when results exist; goals + line-by-line checks under **Context & check detail**; calmer planned-checks list.

### Files changed
- `src/app/(shell)/changes/page.tsx`
- `src/app/(shell)/changes/scorecard-client.tsx`
- `src/app/(shell)/changes/change-contract-client.tsx`

### Not touched
- Scorecard / impact computation, attribution, recommendations, priority engine, experiments, persistence, change `[id]` detail page (deferred)

### Build verification (Shell Phase E)
- `npx tsc --noEmit` — pass
- `npm run build` — pass (17 routes)

---

## Shell Phase F1 — Competitors page premiumization (2026-04-10)

### Shipped
1. **Header + strip:** Page subtitle; **At a glance** with share, citations, ranking size, count **ahead on raw citations**; observation footnote without repeating list KPIs.
2. **Threats:** **Who leads in citations** as unified table (header row + rows); softer ahead signal; mobile-friendly inline metrics; removed post-list “Your position …” duplicate.
3. **Next moves:** Section moved **above** topic readout; single `divide-y` list with **Open** affordance.
4. **Topic signals:** One **Topic signals** section replacing three separate tinted cards — columns **Where you lead** / **Highest pressure** / **Thinnest share** with shared frame copy.
5. **Settings:** **Universe & data setup** disclosure (chevron); imported entities as divided rows.

### Files changed
- `src/app/(shell)/competitors/page.tsx`

### Not touched
- `computeMarketBenchmark`, citation stores, competitor detail `[id]`, Topics, Review, `competitors-manage-client` behavior (layout copy only via parent)

### Build verification (Shell Phase F1)
- `npx tsc --noEmit` — pass
- `npm run build` — pass

---

## Shell Phase F2 — Opportunities (`/topics`) productization (2026-04-10)

### Shipped
1. **`topics/page.tsx`:** `PageHeader` with product subtitle; **At a glance** strip (topic count, visibility shifts, open Review load, quick wins); competitor-universe / sample framing in collapsible **Workspace & competitor list context**.
2. **`topics-client.tsx`:** Left column **Topics**; per-row gap class shown with **PRODUCT_GAP_HEADLINE** plain labels; detail header uses same map; **Suggested next step** section leads with `evidenceLine` + primary CTA + **Copy plan text**; **How Beacon knows** disclosure (dimensions, provenance, crawl/import links with human labels); **Beacon suggests** one-line rationale; **Full plan, competitors & activity** disclosure contains prior “show details” panels; section chrome renamed (e.g. Strength, Citation winners, Content shape, Execution plan); footer activity line clarified.

### Files changed
- `src/app/(shell)/topics/page.tsx`
- `src/app/(shell)/topics/topics-client.tsx`

### Not touched
- Frontier / gap-ledger computation, package actions, `/topics/opportunity/[id]`, Review

### Build verification (Shell Phase F2)
- `npx tsc --noEmit` — pass
- `npm run build` — pass

---

## Shell Phase F3 — Review specialist productization (2026-04-10)

### Shipped
1. **`review/page.tsx`:** `PageHeader` with specialist framing; **At a glance** (awaiting, quick clears, locked total).
2. **`review-queue-client.tsx`:** Queue title **Open items**, softer borders/labels (**Likely clear / Needs your read / Tight race**); judgment card with **Why Beacon ordered it here** `<details>` (internal reason + score separation); attribution question reframed; lighter primary panel border; candidate cards split so **Match factors** are optional per row; **Leading match**; confidence **Confident / Balanced / Tentative**; **Save decision** primary button; **Platform** quick cause + keyboard help; **Open full result** link; resolved **Locked in Review**; auto-cleared disclosure chevron.

### Files changed
- `src/app/(shell)/review/page.tsx`
- `src/app/(shell)/review/review-queue-client.tsx`

### Not touched
- `computeDecisionability` logic (same strings, new placement), `lockDecision`, triage/scoring domain modules

### Build verification (Shell Phase F3)
- `npx tsc --noEmit` — pass
- `npm run build` — pass

---

## Shell Phase G1 — Import + History measurement coherence (2026-04-10)

### Shipped
1. **`import/page.tsx`:** `PageHeader` with measurement-layer description; short paragraph linking **Import → History → Today**; **At a glance** coverage strip + **Open History** affordance; calmer dashed upload border; post-import success with **Today** + **View History**; advanced section labeled **Advanced paths**; bottom **Import log** with explicit pointer to History for the timeline; Profound CSV and manual success blocks link History as well as Today.
2. **`results/results-client.tsx`:** `PageHeader` reframed as measurement brief; **At a glance** strip (counts, primary run, crawl); **Import** / **Today** cross-links; stale warning visible when applicable; **Runs, stamps & technical notes** and **Competitor sample context** in `<details>`; calmer evidence-scope inset (not warning styling); shorter **StatCard** labels; table first column **Sample row**.

### Files changed
- `src/app/(shell)/import/page.tsx`
- `src/app/(shell)/results/results-client.tsx`
- `docs/master_execution_plan.md`, `docs/NEXT_PHASE_EXECUTION_PLAN.md`, `docs/HANDOFF_VERIFIED_STATE.md`, `docs/architecture.md`, `docs/VERIFICATION_LOG.md` (append-only phase notes)

### Not touched
- Import server actions, workbook/Profound parsers, `getDataCoverage`, results/history computation, persistence, Diagnostics, Expansion routes

### Build verification (Shell Phase G1)
- `npx tsc --noEmit` — pass
- `npm run build` — pass

---

## Shell Phase G2 — Diagnostics specialist shell (2026-04-10)

### Shipped
1. **`diagnostics/page.tsx`:** **PageHeader** reframed as system specialist brief (purposeful, not dismissive); paragraph linking **Today**, **Review**, **History**, **Import**; **At a glance** strip (`StatCard`: changes, snapshots, outcome events, Review pending); **How to read system metrics** callout; **Recorded / Open** cards with shell-aligned borders; **`DisclosureBlock`** helper for collapsible depth — entity inventory; event type + “changes with evidence” tables; cluster list + status mix; pattern table; expansion candidate sample table; imported change IDs on rows; bundled **stored-ID pair scoring** (confidence, factors, inflation, verdicts, temporal); candidate per-result distribution + score calibration; truth-set evaluation; model factor-lift table; **Event + Review drivers**, **Linkage gaps**, candidate linking headline stats, and **Model gaps & recommendations** (including recommendation list) remain prominent for operational scan.
2. **Chrome:** `StatBlock` uses `border-border/60` / `bg-card`; tables use softer borders; reduced `uppercase` on status/confidence chips where inline; section titles sentence case.

### Files changed
- `src/app/(shell)/diagnostics/page.tsx`
- `docs/master_execution_plan.md`, `docs/NEXT_PHASE_EXECUTION_PLAN.md`, `docs/HANDOFF_VERIFIED_STATE.md`, `docs/architecture.md`, `docs/VERIFICATION_LOG.md` (append-only phase notes)

### Not touched
- `computeDiagnostics`, `computeCandidateDiagnostics`, `computeModelReport`, stores, Expansion route logic

### Build verification (Shell Phase G2)
- `npx tsc --noEmit` — pass
- `npm run build` — pass

---

## Shell Phase G3 — Expansion quarantine / reframing (2026-04-10)

### Shipped
1. **`expansion/page.tsx`:** **PageHeader** title **Expansion backlog** + explicit non-recommendation framing; operator links to **Today**, **Opportunities** (`/topics`), **Review**, **Import**; **Quarantined surface** callout; **At a glance** `StatCard` row (no adjacent count in hero strip); **Counts by hypothesis shape** `<details>`; backlog sections for **non-adjacent** candidates by model fit + **Pattern gaps**; **low** fit in collapsed section; **all adjacent** in default-closed `<details>` with misuse-risk copy; per-card `<details>` for reasoning, evidence, caveats, pattern, query; expansion-only type strings (**· hypothesis**); methodology in `<details>`; inactive experiment state uses same PageHeader pattern.
2. **`promote-candidate.tsx`:** Optional `actionLabel`, `pendingLabel`, `successLabel` (defaults unchanged for other callers).

### Files changed
- `src/app/(shell)/expansion/page.tsx`
- `src/components/data/promote-candidate.tsx`
- `docs/master_execution_plan.md`, `docs/NEXT_PHASE_EXECUTION_PLAN.md`, `docs/HANDOFF_VERIFIED_STATE.md`, `docs/architecture.md`, `docs/VERIFICATION_LOG.md` (append-only phase notes)

### Not touched
- `computeOpportunityCandidates`, selectors, `promoteToOpportunity` server behavior

### Build verification (Shell Phase G3)
- `npx tsc --noEmit` — pass
- `npm run build` — pass

---

## Shell Phase H — Today watchlist / experiments polish (2026-04-10)

### Shipped
1. **`today-client.tsx`:** **Follow-through** section label + **Experiments on your watchlist** heading and short loop copy; **`WatchlistExperimentCard`** — status as **rounded pill** with human-readable labels; **Day N of watch** + started date; headline + **rec type** label (`REC_ACCENT`) + path (readable, not mono); **Citation readout** block (latest vs baseline, delta, or waiting-for-import); operator note as **Your note**; **`watchAfter`** inside collapsible **What Beacon is watching for**; **Adjust outcome (optional)** `<details>` with buttons for **testing / watching / promising / inconclusive / negative** (calls existing `onUpdateExperiment`) + note that imports may still auto-update status from citations; **Remove from watchlist** replaces inline **Drop**.

### Files changed
- `src/app/(shell)/today-client.tsx`
- `docs/master_execution_plan.md`, `docs/NEXT_PHASE_EXECUTION_PLAN.md`, `docs/HANDOFF_VERIFIED_STATE.md`, `docs/architecture.md`, `docs/VERIFICATION_LOG.md` (append-only phase notes)

### Not touched
- `experiment-store.ts`, `updateExperimentCitations` rules, `experiment-actions.ts`, serialization on `page.tsx`

### Build verification (Shell Phase H)
- `npx tsc --noEmit` — pass
- `npm run build` — pass

---

## Intelligence Expansion — Master Plan Created (2026-04-10)

### What was done
- **Full product plan** written into `docs/master_execution_plan.md`: 10 feature clusters, 30+ features, each with Stage 1/2/3 definitions, upgrade path map
- **Phased execution roadmap** written into `docs/NEXT_PHASE_EXECUTION_PLAN.md`: Phases 24–34 with objectives, dependencies, success criteria
- **Architecture extensions** written into `docs/architecture.md`: 12 new data models, connection graph, persistence pattern, native querying architecture
- **Implementation plan** written into `docs/HANDOFF_VERIFIED_STATE.md`: Phase 24 file-level implementation map

### Feature clusters planned
1. Query Intelligence (native querying, prompt library, prompt mining)
2. Attribution / Genealogy (citation genealogy, citation decay, steal the snippet)
3. Competitive Intelligence (co-mention graph, AI source trust, AEO battlecards, traditional vs AI overlap)
4. Entity / Trust Layer (EntityForge, AI says vs reality, founder authority)
5. Local / Geographic (geographic heat map, neighborhood pulse)
6. Outcome / Learning (outcome database, what-if simulator)
7. Journey / Conversion (custom journey, conversion path scaffold)
8. Structured Data / Delivery (llms.txt, visual readiness, video citation)
9. Visualization / Reporting (election-night viz, share generator, AI pulse notifications)
10. Authority / Founder (Beacon Score, per-model intelligence, training pipeline, adversarial testing, blueprints, Ask Beacon, review mapping, content syndication)

### Execution starting
- **Phase 24** begins immediately: Perplexity client, answer snapshots, prompt library, co-mention graph, outcome store

---

## Phase 24 — Query Foundation + Co-mention + Outcome (2026-04-10)

### Phase 24 — Module 1: Query Foundation — SHIPPED

**Files created:**
- `src/lib/querying/types.ts` — `AnswerSnapshot`, `QueryClient` interface, `SamplingRunConfig`, `CitationRef` types
- `src/lib/querying/perplexity-client.ts` — Perplexity API client: auth, rate limit, response parsing, citation extraction, entity mention extraction
- `src/domains/answer-snapshots/types.ts` — `AnswerSnapshot` domain type re-export
- `src/domains/answer-snapshots/store.ts` — json-store persistence: `appendSnapshot`, `getSnapshotsByPrompt`, `getLatestSnapshots`, `getSnapshotSummary`
- `src/domains/prompts/types.ts` — `LibraryPrompt`, `JourneyStage`, `PromptSource` types
- `src/domains/prompts/journey-stages.ts` — Journey stage auto-classification from prompt text (awareness/consideration/comparison/decision/support/adversarial)
- `src/domains/prompts/prompt-library.ts` — Managed prompt corpus store: `getActivePrompts`, `addPrompt`, `initFromTrackedPrompts`, `getLibrarySummary`

### Phase 24 — Module 3: Co-mention Graph — SHIPPED

**Files created:**
- `src/domains/competitors/co-mention-types.ts` — `CoMentionEntry`, `CoMentionMatrix` types
- `src/domains/competitors/co-mention.ts` — `computeCoMentionMatrix()` from citation cold store, `getAICompetitors()`, `getTopCoMentions()`, cached matrix persistence

### Phase 24 — Module 4: Outcome Store — SHIPPED

**Files created:**
- `src/domains/product/outcome-types.ts` — `OutcomeRecord`, `OutcomeActionType`, `OutcomeSummary` types
- `src/domains/product/outcome-store.ts` — Unified outcome persistence: `recordOutcome`, `resolveOutcome`, `getOutcomesByActionType/Pattern/Page`, `computeOutcomeSummary`, `backfillFromExistingData` (idempotent backfill from rec responses + experiments + scorecard verdicts)

### Build verification (Phase 24 — foundation modules)
- `npx tsc --noEmit` — pass (0 errors)
- `npm run build` — pass (all routes)
- `npm test` — pass (26/26 tests)
- No existing files modified
- No routes touched
- No intelligence logic changed

---

## Phase 24 — Wiring (operational integration)

**Date:** 2026-04-10

### Task 1: Sampling Script — SHIPPED

**Files created:**
- `scripts/sample-visibility.ts` — Operational script that loads prompt library (auto-seeds from Profound if empty), calls Perplexity for each active prompt, stores answer snapshots. Supports `--dry-run`, `--limit N`, graceful per-prompt failure, summary totals.

**Files modified:**
- `package.json` — Added `data:sample` npm script

**Verification:**
- Dry-run tested: `npm run data:sample -- --dry-run --limit 3` — 100 prompts auto-seeded from Profound, 3 previewed
- Script compiles and runs cleanly via `npx tsx`

### Task 2: Competitors Co-mention Section — SHIPPED

**Files created:**
- `src/app/(shell)/competitors/co-mention-section.tsx` — Client component: progressive disclosure "AI-era competitors" section showing co-mention domains, strength, discovered/known status

**Files modified:**
- `src/app/(shell)/competitors/page.tsx` — Added co-mention computation (lazy, cached), imported and rendered `CoMentionSection` behind existing benchmark block

### Task 3: Outcome Backfill + Today Wiring — SHIPPED

**Files modified:**
- `src/app/(shell)/page.tsx` — Added idempotent outcome backfill from recommendation responses, experiments, and scorecard verdicts; computes `outcomeSummary`; passes enriched track record to `TodayClient`
- `src/app/(shell)/today-client.tsx` — Extended `TodayTrackRecord` type with `outcomeTotal`, `outcomePositiveRate`, `outcomeAvgDelta`; renders outcome intelligence quietly below existing track record line

### Build verification (Phase 24 — wiring)
- `npx tsc --noEmit` — pass (0 errors)
- `npm run build` — pass (all 22 routes, static + dynamic)
- `npm test` — pass (26/26 tests)
- `npm run data:sample -- --dry-run --limit 3` — pass

---

## Phase 25 — Attribution Intelligence (genealogy, decay, trust, rec wiring)

**Date:** 2026-04-10

### Task 1: Citation Genealogy Foundation — SHIPPED

**Files created:**
- `src/domains/attribution/genealogy-types.ts` — `GenealogyMatch`, `GenealogyConfidence`, `PageGenealogyResult` types
- `src/domains/attribution/citation-genealogy.ts` — `computePageGenealogy()`, `computeFullGenealogy()`, `summarizeGenealogy()`. Matches owned citations to page snapshots via URL exact, URL path, title overlap, heading overlap, FAQ overlap. Confidence tiers: high/medium/low/unknown. Never overclaims.

**Confidence limitations:**
- Stage 1 relies on URL matching and structural content overlap (titles, headings, FAQs) from page snapshots
- Does NOT have full page body text for deep content matching
- Does NOT attempt competitor-content genealogy
- Content-based matching limited to URL path tokens vs snapshot metadata
- When no confident match exists, reports "unknown" — does not fabricate

### Task 2: Citation Decay Intelligence — SHIPPED

**Files created:**
- `src/domains/attribution/decay-types.ts` — `CitationDecayResult`, `DecayConfig`, `DecayStatus` types
- `src/domains/attribution/citation-decay.ts` — `computeCitationDecay()` from citation cold store date shards, `getDecayAlerts()`, `summarizeDecay()`. Splits date range into halves, compares owned citation counts per page. Status: stable / soft_decline / meaningful_decline / insufficient_history.

**Files modified:**
- `src/app/(shell)/page.tsx` — Computes decay, passes `decayAlerts` into Today's `nextCandidates` for calm display

**Confidence limitations:**
- Trend detection only, not prediction
- Binary period comparison (earlier half vs recent half) — not a rolling window
- Pages with < 5 citations flagged as insufficient_history
- Does not account for seasonal variation or import timing differences

### Task 3: Source Trust Index — SHIPPED

**Files created:**
- `src/domains/competitors/source-trust-types.ts` — `SourceTrustEntry`, `PlatformTrustProfile`, `SourceTrustIndex` types
- `src/domains/competitors/source-trust.ts` — `computeSourceTrustIndex()` from citation cold store, `summarizeTrustIndex()`. Per-platform domain frequency with owned rank and share.
- `src/app/(shell)/competitors/source-trust-section.tsx` — Client component: progressive disclosure "Source reliance by platform" section with expandable per-platform cards

**Files modified:**
- `src/app/(shell)/competitors/page.tsx` — Computes trust index and renders `SourceTrustSection`

**Confidence limitations:**
- Reflects observed citation frequency, not confirmed algorithmic preference
- Label: "frequently cited by" — not "trusted by"
- Dependent on imported Profound citation data coverage
- Platform attribution relies on prompt-answer-observation joins

### Task 4: Recommendation Wiring — SHIPPED

**Files modified:**
- `src/domains/product/recommendation-engine.ts` — Added `refresh_stale_citation` recommendation type. Only fires for pages with meaningful_decline AND ≥3 recent citations. Added `decayResults` optional parameter.
- `src/app/(shell)/page.tsx` — Passes decay results to recommendation engine
- `src/app/(shell)/today-client.tsx` — Added `refresh_stale_citation` to rec type styling map

**Anti-spam posture:**
- Maximum 2 decay-based recs per computation
- Only fires on meaningful_decline (≥30% drop), not soft
- Requires minimum 3 current-period citations (avoids noise on thin data)
- Skips pages that already have a rec from another source
- Confidence capped at "medium" even for severe drops

### Build verification (Phase 25)
- `npx tsc --noEmit` — pass (0 errors)
- `npm run build` — pass (all 22 routes, static + dynamic)
- `npm test` — pass (26/26 tests)
- 0 lint errors on all created/modified files

---

## Phase 26 — Entity + Representation Intelligence

**Date:** 2026-04-10

### Task 1: Entity Foundation — SHIPPED

**Files created:**
- `src/domains/entity/types.ts` — `BeaconEntity`, `BeaconEntityType` (brand/person/location/service), `EntitySource`, `EntityIndex`
- `src/domains/entity/entity-extract.ts` — `extractEntities()` from page snapshots (location_terms, service_terms) + site config (brand) + PAO mentions (competitor brands from AI answers). `getOwnedEntities()`, `getExternalBrands()`, `summarizeEntities()`

**Data sources used:**
- Site config → brand name (owned)
- Page snapshots → 14 locations, 13 services (owned)
- Prompt-answer-observations → 1,821 unique mentions (brand entities from 9,596 AI answers)

**Scope limitations:**
- No full knowledge graph
- No cross-platform identity stitching
- No person/founder extraction yet (requires configuration — placeholder type exists)
- No complex entity resolution — simple canonical name deduplication only

### Task 2: AI Says vs Reality — SHIPPED

**Files created:**
- `src/domains/entity/discrepancy-types.ts` — `Discrepancy`, `DiscrepancyType`, `DiscrepancySeverity`, `DiscrepancyReport`
- `src/domains/entity/discrepancy-detect.ts` — `detectDiscrepancies()` from entity index + PAO data + cold store answer texts

**Detection types (conservative):**
- `location_not_in_owned` — AI mentions a location not in owned page data
- `service_not_in_owned` — AI mentions a service not in owned page data
- `brand_omitted` — owned brand absent from ≥15% of relevant AI answers
- `competitor_overrepresented` — competitor appears ≥3× more than owned brand

**Safety measures:**
- Minimum 20 answers required before any analysis runs
- Minimum 3 occurrences per location/service before flagging
- Language: "possible discrepancy", "may be missing" — never "wrong" or "hallucinated"
- Two severity levels: notable (high evidence) and minor (lower evidence)
- Two confidence levels: moderate (≥8 evidence points or ≥100 answers) and limited

### Task 3: Integration — SHIPPED

**Diagnostics (deep view):**
- `src/app/(shell)/diagnostics/page.tsx` — New "Entity & representation intelligence" section at bottom of page with:
  - Entity summary stats (total, owned, locations, services)
  - External brands disclosure (competitor brands found in AI answers)
  - Discrepancy report disclosure with severity-coded cards
  - Calm, structured — no alarm language

**Today (quiet signal):**
- `src/app/(shell)/page.tsx` — Adds notable discrepancies to `nextCandidates` only if notable-severity discrepancies exist. Links to /diagnostics for investigation. Does not appear if data is thin or no notable signals.

**What is NOT surfaced:**
- Minor discrepancies do not appear on Today (only in Diagnostics)
- No new routes created
- No new nav items
- No warning banners or alert systems
- Signals only appear when meaningful

### Build verification (Phase 26)
- `npx tsc --noEmit` — pass (0 errors)
- `npm run build` — pass (all 22 routes, static + dynamic)
- `npm test` — pass (26/26 tests)
- 0 lint errors on all created/modified files

---

## Phase 27 — Geographic Intelligence

**Date:** 2026-04-10

### Task 1: Geographic Normalization Foundation — SHIPPED

**Files created:**
- `src/domains/geo/types.ts` — `NormalizedCity`, `CityCoverage`, `GeoCoverageIndex`, `GeoConcentration`, `GeoGap`, `GeoHeatEntry`, `GeoHeatMap` types
- `src/domains/geo/normalize.ts` — Deterministic city normalization with alias mapping, metro/sub-region assignment, confidence labeling. ~50 Bay Area cities + region terms. `normalizeCity()`, `normalizeCities()`, `isRegionTerm()`, `getMetro()`

### Task 2: Local Coverage + Gap Intelligence — SHIPPED

**Files created:**
- `src/domains/geo/coverage.ts` — `computeGeoCoverage()` from pages + citation rollups + prompts. Computes per-city owned/competitor pages and citations, share %, coverage status (strong/moderate/weak/absent). `computeConcentration()` with HHI-based assessment. `computeGaps()` for markets with competitor presence and limited owned visibility. `computeGeoHeatMap()` for future heat map data. `summarizeGeoCoverage()` for compact display.

**Data used:**
- Page registry: 5,288 pages across ~50 unique cities (33 owned pages city-tagged, rest competitor)
- Citation evidence index: per-page-and-topic rollups joined to city via page registry
- Prompt library: 5 cities (active prompts)

### Task 3: Geographic Surfacing — SHIPPED

**Today:**
- `src/app/(shell)/page.tsx` — Computes geo coverage, adds gap alert to nextCandidates if markets have competitor presence with limited owned visibility. Links to /diagnostics.

**Competitors:**
- `src/app/(shell)/competitors/page.tsx` — Computes competitor pressure cities, renders `LocalPressureSection`
- `src/app/(shell)/competitors/local-pressure-section.tsx` — Progressive disclosure "Local competitive pressure" showing gap cities with competitor page counts, owned page counts, and status

**Diagnostics:**
- `src/app/(shell)/diagnostics/page.tsx` — Full "Geographic coverage" section with stat cards (markets tracked, strong coverage, gaps, concentration), concentration explanation, expandable city table with owned/competitor pages/citations/share/status, and gap disclosure with per-city explanations

### Task 4: Heat Map Groundwork — SHIPPED

- `GeoHeatEntry` and `GeoHeatMap` types defined in `src/domains/geo/types.ts`
- `computeGeoHeatMap()` function in `src/domains/geo/coverage.ts` produces sorted city-level heat data with strength classification
- No visual heat map built — data shape ready for future integration

### Confidence limitations
- City normalization is hardcoded for Bay Area — extensible but not auto-discovering
- Region terms (bay area, silicon valley) are excluded from city-level analysis to avoid double-counting
- Coverage status thresholds are heuristic (strong ≥50 citations, moderate ≥10, weak <10, absent = 0)
- Concentration HHI is computed only from cities with owned citations — thin coverage may skew
- Gap detection requires ≥5 competitor pages — avoids noise from scattered data
- No geocoding or distance-based proximity — purely name-based matching

### Build verification (Phase 27)
- `npx tsc --noEmit` — pass (0 errors)
- `npm run build` — pass (all 22 routes, static + dynamic)
- `npm test` — pass (26/26 tests)
- 0 lint errors on all created/modified files

---

## Phase 28 — Journey + Score + Extractability

**Date:** 2026-04-10

### Task 1: Journey Intelligence Foundation — SHIPPED

**Files created:**
- `src/domains/prompts/journey-coverage.ts` — `computeJourneyCoverage()` from prompt library. Computes per-stage prompt counts, pct, status (strong/moderate/weak/absent). Identifies strongest stage, weakest covered stage, absent core stages. Concentration warning if >80% in one stage. Summary assessment string.

**Current data reality:** 92 consideration, 8 comparison, 0 in awareness/decision/support/adversarial. This is a real gap that the system correctly surfaces.

### Task 2: Beacon Score Foundation — SHIPPED

**Files created:**
- `src/domains/product/beacon-score-types.ts` — `ScoreDimension`, `DimensionStatus`, `BeaconScoreResult` types
- `src/domains/product/beacon-score.ts` — `computeBeaconScore()` with 6 independent dimensions: visibility strength (log-scaled citations), coverage breadth (topics + cities + stages), consistency (decay stability rate), competitive position (owned share), representation quality (discrepancy count), local strength (geo presence rate - gap penalty)

**Score integrity:**
- Each dimension independently computed with explicit sufficiency checks
- `insufficient` status produces `null` value — no fake numbers
- Composite only produced when ≥4/6 dimensions are sufficient
- `partial` composite when 3+ dimensions have values but <4 sufficient
- `unavailable` when <3 dimensions have any data
- Summary string always explains the state honestly

### Task 3: Structured Data / Extractability Layer — SHIPPED

**Files created:**
- `src/domains/pages/extractability.ts` — `analyzeExtractability()` per page: 6 factors (FAQ, schema, H2 structure, meta description, word count, direct answers) with weighted scoring. Grade: good/fair/needs_work/poor. Per-page suggestions tied to actual content gaps. `analyzeAllExtractability()` prioritizes high-citation low-score pages. `generateLlmsTxtDraft()` produces draft llms.txt from snapshot data. `summarizeExtractability()` for aggregate stats.

### Task 4: Integration — SHIPPED

**Diagnostics (deep view):**
- Journey stage section: 4 core stage stat cards, assessment summary, missing stage warning
- Beacon Score section: composite display (only if available), dimension breakdown with progress bars, sufficiency labels
- Extractability section: aggregate stats, expandable page-by-page analysis with graded suggestions

**Today (quiet signals):**
- Journey gap: shows absent stages as next-move candidate only when ≥10 active prompts and absent core stages exist
- No score shown on Today (not stable enough yet — composite depends on data sufficiency)

**Pages:**
- No per-page extractability indicator added yet — extractability analysis available in Diagnostics; per-page integration deferred to avoid clutter

### Build verification (Phase 28)
- `npx tsc --noEmit` — pass (0 errors)
- `npm run build` — pass (all 22 routes, static + dynamic)
- `npm test` — pass (26/26 tests)
- 0 lint errors on all created/modified files

---

## Phase 29 — Competitive Intelligence (battlecards, snippets, signals)

**Date:** 2026-04-10

### Task 1: Competitive Battlecards — SHIPPED

**Files created:**
- `src/domains/competitors/battlecard-types.ts` — `CompetitorBattlecard`, `DimensionComparison`, `BattlecardDimension`, `BattlecardIndex`
- `src/domains/competitors/battlecards.ts` — `computeBattlecards()` from citation index + co-mention + trust index + geo coverage. 5 comparison dimensions: citation share, topic pressure, co-mention frequency, geographic presence, platform reliance. Threat assessment: high/moderate/low. Max 8 cards, min 10 citations to qualify.

**Files created (UI):**
- `src/app/(shell)/competitors/battlecard-section.tsx` — Progressive disclosure "Competitive comparison" section with expandable per-competitor cards showing dimension-by-dimension advantage bars and pressure topics.

### Task 2: Snippet Intelligence — SHIPPED

**Files created:**
- `src/domains/competitors/snippet-types.ts` — `SnippetSignal`, `SnippetSignalType`, `SnippetIntelligence`
- `src/domains/competitors/snippet-intel.ts` — `computeSnippetIntelligence()` from owned extractability + citation index. 4 signal types: owned extractable patterns, extractability gaps, competitor citation context, strengthening opportunities. All signals labeled "grounded" or "inferred."

### Task 3: Stronger Competitive Signals — SHIPPED

Integrated into battlecards and snippet intelligence:
- Strongest competitor by citation count + multi-dimensional comparison
- Competitor pressure by topic (topics where competitor leads)
- Competitor pressure by city (markets with weak owned presence)
- Competitor citation context (topics where competitors dominate 3:1+)
- Extractability comparison (owned page structure vs competitor citation patterns)

### Task 4: Integration — SHIPPED

**Competitors:**
- `src/app/(shell)/competitors/page.tsx` — Computes battlecards from citation index + co-mention + trust + geo. Renders `BattlecardSection` behind progressive disclosure after local pressure.

**Diagnostics:**
- `src/app/(shell)/diagnostics/page.tsx` — New "Content intelligence" section with grounded + inferred snippet signals in separate disclosures.

**Today:**
- `src/app/(shell)/page.tsx` — High-priority extractability gaps added to nextCandidates. Only fires when snippet intelligence finds high-priority signals.

### Confidence limitations
- Battlecard dimensions are computed from imported Profound data — not native answer capture
- Snippet intelligence does NOT scrape competitor pages or extract exact copied text
- "Inferred" signals are labeled as such — reasoned from citation patterns, not directly provable
- Geographic pressure in battlecards uses shared geo gap data — not per-competitor city breakdowns
- Platform reliance shows only the most relevant platform per competitor to avoid noise
- Topic pressure thresholds require ≥5 competitor citations and competitor lead to qualify

### Build verification (Phase 29)
- `npx tsc --noEmit` — pass (0 errors)
- `npm run build` — pass (all 22 routes, static + dynamic)
- `npm test` — pass (26/26 tests)
- 0 lint errors on all created/modified files

---

## Phase 30 — Advanced Intelligence Scaffolds

**Date:** 2026-04-10

### Task 1: Adversarial Prompt Stress Foundation — SHIPPED

**Files created:**
- `src/domains/prompts/adversarial-types.ts` — `AdversarialCategory` (6 types), `AdversarialPromptTemplate`, `AdversarialReadiness`
- `src/domains/prompts/adversarial.ts` — `seedAdversarialTemplates()` generates 10 templates across 6 categories (negative framing, skeptical comparison, omission pressure, trust challenge, cost scrutiny, alternative suggestion). `assessAdversarialReadiness()` checks library state. No adversarial testing has been performed — scaffold only.

### Task 2: What-If Simulator Foundation — SHIPPED

**Files created:**
- `src/domains/product/whatif-types.ts` — `SimulationActionType` (9 types), `SimulationInput`, `HistoricalEvidence`, `SimulationResult`, `WhatIfReadiness`
- `src/domains/product/whatif-engine.ts` — `computeEvidence()` maps outcome records to action types. `simulateAction()` only reports direction when ≥5 historical outcomes exist. `assessWhatIfReadiness()` checks overall data sufficiency. No fake forecasts — reports "insufficient data" honestly.

### Task 3: Founder Authority Starter — SHIPPED

**Files created:**
- `src/domains/entity/founder-types.ts` — `FounderPresenceStatus` (4 states), `FounderProfile`, `FounderAuthorityResult`
- `src/domains/entity/founder-authority.ts` — `assessFounderAuthority()` checks configured founders (`BEACON_FOUNDER_NAMES` env var) against PAO mention data. Distinguishes: not configured, configured but not observed, observed lightly (<5), observed repeatedly (≥5). No authority scores invented.

### Task 4: Conversion-Path Placeholder — SHIPPED

**Files created:**
- `src/domains/product/conversion-path-types.ts` — `ConversionPathStage` (5 stages: prompt → answer → citation → visit → conversion), `ConversionPathEntry`, `ConversionPathSummary`
- `src/domains/product/conversion-path.ts` — `assessConversionPathReadiness()` honestly reports which stages Beacon can observe (1-3) vs which require external integration (4-5). No fake funnel data.

### Task 5: Training-Data Pipeline Scaffold — SHIPPED

**Files created:**
- `src/domains/product/training-data-types.ts` — `ContentVisibilityChannel` (6 channels), `ChannelReadiness`, `TrainingDataReadiness`
- `src/domains/product/training-data.ts` — `assessTrainingDataReadiness()` checks website pages, structured data, llms.txt, sitemap, social profiles, directory listings. Reports active/partial/missing/unknown per channel. Does not claim to know what models have ingested.

### Integration — SHIPPED

**Diagnostics:**
- `src/app/(shell)/diagnostics/page.tsx` — New "Advanced intelligence readiness" section showing scaffold status for all 5 systems. Each item shows label, readiness status (color-coded), and honest assessment. Founder detail disclosure when configured.

**Today:** No new signals from scaffolds (correct — these are foundations, not active intelligence yet).

### Build verification (Phase 30)
- `npx tsc --noEmit` — pass (0 errors)
- `npm run build` — pass (all 22 routes, static + dynamic)
- `npm test` — pass (26/26 tests)
- 0 lint errors on all created/modified files

---

## Phase 31 — Visual Intelligence Layer + Pulse + Report Foundation

**Date:** 2026-04-10

### Visual Primitive Components — SHIPPED (10 components)

**Files created:**
- `src/components/viz/score-rail.tsx` — Multi-segment score visualization with composite header. Handles insufficient/partial states with hatched patterns. Hover-interactive per-segment detail. Color-coded thresholds.
- `src/components/viz/stacked-bar.tsx` — Proportional stacked segments per row. Hover reveals segment detail with percentage. Supports custom colors and totals.
- `src/components/viz/rank-ladder.tsx` — Ranked entity list with proportional bars, badges, owned highlighting, hover metadata. Expandable beyond initial visible count.
- `src/components/viz/delta-strip.tsx` — Previous→current change visualization with delta and percentage annotations. Color-coded positive/negative.
- `src/components/viz/platform-split.tsx` — Proportional color strip for platform distribution with interactive legend. Platform-aware colors (emerald=ChatGPT, blue=AI Overviews, violet=Perplexity). Supports owned-position display.
- `src/components/viz/coverage-trellis.tsx` — Small-multiples grid for geographic or categorical coverage. Status-colored chips (strong/moderate/weak/absent) with hover metadata. Built-in legend.
- `src/components/viz/threat-meter.tsx` — 5-segment threat level indicator for competitive cards. Compact mode for inline use.
- `src/components/viz/confidence-badge.tsx` — Reusable confidence/status badge for grounded/inferred/insufficient/partial states.
- (Previously built) `src/components/viz/sparkline.tsx`, `mini-bar-chart.tsx`, `donut-ring.tsx`, `heat-grid.tsx`

### Route Visual Upgrades — SHIPPED

**Today (`today-client.tsx`):**
- Visibility summary upgraded with `PlatformSplit` proportional strip — replaces text-only platform listing
- Track record section replaced with visual `MiniBarChart` showing accepted/acted-on/validated/outcomes bars with hover metadata
- Momentum header with avg citation delta highlight

**Diagnostics (`diagnostics/page.tsx`):**
- Pulse banner at top — aggregated signal summary from all intelligence layers with severity badges and linked events
- Journey stage section now uses `DonutRing` + `MiniBarChart` side-by-side for stage distribution
- Beacon Score section now uses `ScoreRail` — full dimension visualization with insufficient-data hatched patterns
- Geographic section enhanced with `MiniBarChart` for city citations and `CoverageTrellis` for market-at-a-glance grid

**Competitors (`competitors/battlecard-section.tsx`):**
- Battlecard threat badges replaced with `ThreatMeter` visual indicator
- Dimension comparison bars now show proportional owned-vs-competitor fill bars with percentage breakdown

### Report Generator Foundation — SHIPPED

**Files created:**
- `src/domains/product/report-types.ts` — `BeaconReport`, `ReportSection` types
- `src/domains/product/report-generator.ts` — `generateVisibilityReport()`, `generateCompetitiveReport()`, `serializeReport()` for JSON export

### Pulse / Notification Foundation — SHIPPED

**Files created:**
- `src/domains/product/pulse-types.ts` — `PulseEvent`, `PulseEventType` (7 types), `PulseSeverity`, `PulseSummary`
- `src/domains/product/pulse.ts` — `computePulse()` aggregates decay alerts, discrepancies, geo gaps, journey gaps, extractability gaps, and sampling freshness into deduplicated severity-sorted pulse events

### Build verification (Phase 31)
- `npx tsc --noEmit` — pass (0 errors)
- `npm run build` — pass (all 22 routes, static + dynamic)
- `npm test` — pass (26/26 tests)
- 0 lint errors on all created/modified files

---

## Phase 31B — Maximum Visual Expansion

**Date:** 2026-04-10

### New Visual Primitives — SHIPPED (7 new, 17 total)

| Component | Type | Interaction |
|-----------|------|-------------|
| `AreaChart` | Multi-series area/stacked area with grid | Crosshair hover, series readout, gradient fills |
| `KpiCard` | KPI metric with optional sparkline + delta | Hover border, trend-aware color |
| `ComparisonBar` | Owned-vs-competitor proportional bars | Hover expand, metadata reveal |
| `RadialScore` | Radar/radial polygon for multi-dimensional scores | Hover per-dimension with slide-in detail |
| `ViewToggle` | Segmented control for view mode switching | Pill transition, size variants |
| `FilterChips` | Toggle chip system for multi-select filters | Active/inactive state, label prefix |
| `VizSection` / `ChartTableSection` | Section wrappers with toggle controls | Collapsible, chart↔table toggle built in |

### Route Visual Upgrades — SHIPPED

**Today:**
- KPI grid: 4 `KpiCard` cells (Citations with delta, Mentions, Platforms, Snapshots) replacing single text hero
- Platform distribution: dedicated bordered section with `PlatformSplit`
- Track record: visual `MiniBarChart` momentum bars
- Impact signals: `ConfidenceBadge` replacing text confidence labels

**Diagnostics:**
- Beacon Score: toggleable `Bars` ↔ `Radial` view via `BeaconScoreVisual` client component with `ViewToggle`
- RadialScore shows polygon visualization of all 6 score dimensions
- ScoreRail shows bar visualization with insufficient-data hatching
- Journey stages: `DonutRing` + `MiniBarChart` side-by-side
- Geographic: `CoverageTrellis` grid + `MiniBarChart` city citations
- Pulse banner with severity-coded event links

**Competitors:**
- Battlecard `ThreatMeter` visual indicators
- Dimension comparison proportional fill bars

### Build verification (Phase 31B)
- `npx tsc --noEmit` — pass (0 errors)
- `npm run build` — pass (all 22 routes, static + dynamic)
- `npm test` — pass (26/26 tests)
- 0 lint errors

---

## Abstraction Refactor — Visual + Data Swappability

**Date:** 2026-04-10

### 1. Standardized Chart Prop Interfaces — SHIPPED

**File created:** `src/components/viz/chart-types.ts`

Defines canonical prop interfaces for every chart type: `BarChartProps`, `AreaChartProps`, `DonutChartProps`, `ScoreViewProps`, `ComparisonProps`, `KpiProps`, `CoverageCell`, `RankEntryProps`, `HeatCellProps`, `ThreatLevel`, `ConfidenceLevel`, plus shared primitives (`ChartPoint`, `ChartSeries`).

Any future chart library (Visx, Recharts, D3) implements these same interfaces — consumers don't change.

### 2. Domain View-Model Adapters — SHIPPED

**Files created:** `src/lib/view-models/` (6 files)
- `visibility-vm.ts` — `visibilityKpis()`, `platformDonut()`, `platformBars()`
- `score-vm.ts` — `scoreView()`, `scoreDimensions()`
- `geo-vm.ts` — `geoKpis()`, `cityCoverageCells()`, `cityCitationBars()`, `cityComparisonBars()`
- `journey-vm.ts` — `journeyDonut()`, `journeyBars()`
- `competitors-vm.ts` — `coMentionBars()`, `trustRankEntries()`, `battlecardComparisons()`
- `index.ts` — barrel export

Each function takes domain computation output → returns chart-ready props conforming to `chart-types.ts` interfaces. Routes pass these to any chart implementation.

### 3. Data Source Adapter Interfaces — SHIPPED

**Files created:** `src/lib/data-adapters/` (3 files)
- `types.ts` — 10 adapter interfaces: `VisibilityAdapter`, `GeoAdapter`, `JourneyAdapter`, `ScoreAdapter`, `CompetitiveAdapter`, `EntityAdapter`, `AttributionAdapter`, `OutcomeAdapter`, `SnippetAdapter`, `PulseAdapter` + `BeaconDataAdapters` bundle
- `profound-adapter.ts` — Current implementation: `createProfoundAdapters()` delegates to existing stores with lazy computation caching
- `index.ts` — `getAdapters()` entry point (the swap point)

To swap data sources: create `native-adapter.ts` implementing same interfaces, change the import in `index.ts`.

### Architecture properties established
- **Visual swappability:** Chart components receive standardized props → replace SVG implementations with any library without touching routes or domain logic
- **Data swappability:** Routes call `getAdapters()` → adapters abstract whether source is Profound, native querying, or hybrid → domain computations stay the same
- **View-model separation:** No business logic in chart components, no data shaping in routes → view-model functions handle all transformation
- **Lazy computation:** Adapters cache expensive computations (geo, decay, entity, co-mention) so multiple consumers don't recompute

### Zero regression
- All existing visuals unchanged
- All existing routes unchanged
- All existing data flows unchanged
- `tsc --noEmit` — pass
- `npm run build` — pass (all 22 routes)
- `npm test` — pass (26/26 tests)
- 0 lint errors

---

## 2026-04-10 — Phase 31C: Route visual saturation + documentation checkpoint

### What shipped (UI only; same domain inputs)

| Route / area | Change |
|--------------|--------|
| **Competitors** | `page.tsx`: `KpiCard` strip replaces text-only “At a glance”; leaderboard rows: inline share bar; topic “Thinnest share” uses bar + percent like other columns. |
| **Co-mention** | `co-mention-section.tsx`: `FilterChips` (All / Known / Discovered); `ViewToggle` Table vs Chart; chart mode `MiniBarChart`; table rows: co-mention strength bar scaled to column max. |
| **Local pressure** | `local-pressure-section.tsx`: default chart view `ComparisonBar` (your pages vs competitor pages); `ViewToggle` Chart vs Table. |
| **Source trust** | `source-trust-section.tsx`: expanded source rows include proportional citation bar (owned / comp / neutral coloring). |
| **Pages** | `pages-client.tsx`: top summary → four `KpiCard` + optional `DonutRing` for portfolio status mix (strong / building / follow up / low signal). |
| **History** | `results-client.tsx`: “At a glance” → four `KpiCard`; below: `PlatformSplit` when multiple platforms; `DonutRing` for review-locked vs auto-cleared vs pending when counts exist. |
| **Today** | `today-client.tsx`: system details — crawl block and visibility sample block use `KpiCard` grids; secondary opportunities use `ConfidenceBadge` for confidence. |
| **Diagnostics** | `page.tsx`: `StatBlock` styling aligned with KPI visual language; cluster disclosure “By status” uses `StackedBar`; “Model outcome labels” uses `StackedBar` instead of per-row `Bar` only. |

### Documentation (this checkpoint)

Updated only: `docs/master_execution_plan.md` (new § under surface spec: Phases 24–31C + abstraction), `docs/NEXT_PHASE_EXECUTION_PLAN.md` (Phase 31 shipped vs partial), `docs/HANDOFF_VERIFIED_STATE.md` (31C table + primitive count), `docs/architecture.md` (nav bullets, Phase 31 component table, presentation + swap layers), `docs/VERIFICATION_LOG.md` (this entry).

### Build verification (Phase 31C + docs)

- `npx tsc --noEmit` — pass
- `npm run build` — pass (22 routes)
- `npm test` — pass (26/26)
- No new markdown files created

---

## 2026-04-11 — Product Truth + Usability Stabilization

### What was broken

1. **Crawl truth hidden:** `meta_description`, `canonical_url`, `http_status` were captured by the extractor but never surfaced to the operator. `PageDiffSummary` was computed and serialized but never rendered.
2. **Vague system language:** "ObservationRun on file", "not a crawl ObservationRun", "not causal proof", "heuristic" — operator-facing strings used internal jargon.
3. **Stale data invisible:** No prominent warning when crawl data was >14 days old, visibility data >7 days old, or visibility sample older than crawl. Data freshness buried in collapsed system details.
4. **Pages detail view:** Only showed FAQ count and schema presence as chips. No title, meta description, canonical, H1, word count, or robots inspection. Diff (what changed) was serialized but never shown.
5. **Today too abstract:** System details hidden by default. Primary data freshness not visible without expanding.

### What was fixed

**Pages route (pages-client.tsx + page.tsx):**
- `PageSnapshotSummary` expanded: added `metaDescription`, `canonicalUrl`, `httpStatus` fields from extractor
- New "What the crawl saw" inspection panel in page detail: shows title, meta description, H1, canonical (with mismatch warning), Q&A blocks, schema types, word count, internal links, robots meta, HTTP status, and crawl timestamp
- New "Changed since last crawl" section: renders `PageDiffSummary` when a diff exists (title/H1/Q&A/schema/content changes as labeled chips + summary)
- Stale crawl warning banner: prominent if >14 days old or 0 pages crawled
- "Not crawled" chip on list rows for uncrawled pages
- "Canonical mismatch" chip on list rows
- `CrawlRow`, `CrawlChip`, `DiffChip` helper components for consistent inspection layout
- Fixed "ObservationRun" in user-visible strings → "View run" / "Older verification"

**Today route (today-client.tsx + page.tsx + today-summary.ts):**
- Stale data banner at top of page: crawl age, visibility age, and mismatch warnings — always visible, not hidden
- "Data sources" section replaces "System details": compact crawl + visibility cards always visible, expandable detail behind "More detail" link
- Crawl age computed and compared against 14-day threshold
- Queue item evidence strings rewritten from jargon to plain language:
  - "ObservationRun on file" → "Found during crawl"
  - "not a ranking prediction" → "Found during the latest crawl"
  - "Ship verification runs a live HTML fetch..." → "This change was marked as shipped. Verify it..."
  - "not an ObservationRun and not causal proof" → "Imported visibility shifts with unreviewed attribution"
  - "trend detection, not prediction" → "Citations to this page are declining..."
- `reviewHeuristicLine` rewritten: "Attribution is based on imported visibility data and change timing. It is correlation-based, not proven cause and effect."

**History route (results-client.tsx):**
- Header description simplified: "Every row is a raw visibility measurement. Suggested causes are separate — they do not change the measurement."
- "Reading each row" explainer rewritten: "Metric = what was measured · Cause = what Beacon thinks happened · Trust = whether you confirmed it."
- Removed intro paragraph (duplicative with header)

**Review route (review-queue-client.tsx):**
- "heuristic scores" → "match scores" with clearer explanation
- "Match scores rank heuristics only" → removed jargon

**Changes route (changes/[id]/page.tsx):**
- "Hypothesis" label → "Expected outcome"

### Routes changed

| Route | Files changed |
|-------|---------------|
| Pages | `pages-client.tsx`, `page.tsx` |
| Today | `today-client.tsx`, `page.tsx`, `today-summary.ts` |
| History | `results-client.tsx` |
| Review | `review-queue-client.tsx` |
| Changes detail | `changes/[id]/page.tsx` |

### What remains uncertain

- **Render checks** (`render-checks.json`): Only run for top citation URLs during scan, not universally. A page can appear crawled but render verification only covered a subset.
- **Schema detection**: Only JSON-LD. Pages with microdata or RDFa show "No structured data" even when structured data exists.
- **FAQ detection**: Heuristic-based (JSON-LD FAQPage, `<details>/<summary>`, heading-based). Can over- or under-count vs human "FAQ section" expectations.
- **Word count**: From raw HTML body text after script/style removal. CSR-heavy pages may under-report.
- **Verify vs crawl timing**: Verify overwrites a page's stored snapshot but timestamps come from verify, not the bulk crawl. The "last crawl" in UI still refers to the most recent bulk `website_crawl` run.

### Is crawl truth now trustworthy?

**Yes, with caveats.** The operator can now see exactly what the crawler extracted — title, meta, H1, canonical, FAQ, schema, word count, links, HTTP status, and when. They can see what changed since the prior crawl. They get explicit warnings when data is stale. The remaining uncertainty (render checks, schema detection limits, CSR) is inherent to the extraction approach and documented above.

### Build verification

- `npx tsc --noEmit` — pass
- `npm run build` — pass (22 routes)
- `npm test` — pass (26/26)
- 0 lint errors

---

## 2026-04-11 — Phase 32: Daily Detection + Approval Loop

### What was built

| System | Files | Purpose |
|--------|-------|---------|
| Finding types | `src/domains/scanning/types.ts` | `Finding`, `FindingType`, `FindingStatus`, `FindingSeverity`, `ScanSettings` types + labels |
| Scan settings | `src/domains/scanning/scan-settings.ts` | `getScanSettings()`, `updateScanSettings()`, `isScanOverdue()` — timezone-aware overdue detection |
| Detection engine | `src/domains/scanning/detect-findings.ts` | `generateFindings()` — compares snapshots, guardrails, changelog to produce structured findings |
| Findings store | `src/domains/scanning/findings-store.ts` | CRUD for `scan-findings.json` — add, update status, prune old resolved |
| Server actions | `src/app/(shell)/finding-actions.ts` | `resolveFinding()`, `saveScanSettings()` |
| Auto-scan | `src/app/(shell)/page.tsx` | On Today load: check overdue, trigger scan, generate findings, pass to client |
| Today UI | `src/app/(shell)/today-client.tsx` | "Since last scan" approval queue, scan result banner, FindingRow component |
| Pages integration | `src/app/(shell)/pages/page.tsx`, `pages-client.tsx` | Per-page pending finding count, "N new" chip on list rows |

### Detection types (15)

`title_changed`, `meta_changed`, `h1_changed`, `canonical_changed`, `faq_changed`, `schema_changed`, `content_changed`, `links_changed`, `new_guardrail`, `guardrail_cleared`, `deploy_mismatch`, `unexpected_change`, `page_added`, `page_removed`, `stale_visibility`

### Finding approval statuses

`pending` → operator reviews → `accepted` / `rejected` / `ignored` / `expected`

### How auto-scan works

1. `TodayPage()` (server component) calls `isScanOverdue()` — checks configured preferred hour + timezone vs last crawl date
2. If overdue → triggers `triggerPageScan()` (existing CLI script via `exec`)
3. After scan → reads fresh snapshots + guardrails from disk
4. Calls `generateFindings()` comparing current vs previous state
5. Persists new findings to `scan-findings.json`
6. Passes pending findings to `TodayClient` for approval queue rendering

### Deploy mismatch detection

For changelog entries in the last 30 days that mention FAQ/schema/structured data, the engine checks whether the targeted page's current snapshot actually has those elements. If not → `deploy_mismatch` finding with `high` severity. This catches "shipped but not deployed" situations.

### Build verification (Phase 32)

- `npx tsc --noEmit` — pass
- `npm run build` — pass (22 routes)
- `npm test` — pass (26/26)
- 0 lint errors

---

## 2026-04-11 — Phase 32B: Finding Triage + Workflow Consequence + Operator Loop

### What was built

1. **Priority scoring engine** — every finding gets a `priorityScore` (0–100+) computed from severity, finding type impact weight, page citation volume, homepage flag, changelog contradiction, and whether the same type was previously rejected. Score maps to 4 buckets: critical (≥60), important (≥35), minor (≥15), informational (<15).

2. **Consequence-aware resolution** — each action now has explicit downstream behavior:
   - Accept → marks trusted, clears for promotion
   - Expected → suppresses duplicates for 14 days on same page+type
   - Ignore → low-priority dismissal, retained in history
   - Not real → logged as false positive, future same-type detections deprioritized

3. **Promotion workflow** — accepted findings can be promoted to Changelog, Secondary note, or History only. No auto-promotion.

4. **Today re-anchored** — findings queue is now section 1, grouped by priority (critical/important/minor/FYI). Accepted findings awaiting promotion appear in separate block. Recommendations demoted from primary to section 4.

5. **Pages re-anchored** — pending scan findings surfaced at top of page detail with link to Today for triage. Ordering: findings → crawl truth → diff → visibility → next step.

6. **Review/Findings distinction** — Review described as "why did visibility change?" (attribution). Findings are "what changed on site?" (state detection). Cross-references clarified.

7. **Copy cleanup** — removed "heuristic" from operator-facing copy, simplified attribution description, cleaner scan banner.

### Files changed

| File | Change |
|------|--------|
| `src/domains/scanning/types.ts` | `FindingPriority`, `PromotionStatus`, priority/promotion fields, label maps |
| `src/domains/scanning/detect-findings.ts` | `computePriorityScore`, `scoreToPriority`, context fields on all `makeFinding` calls |
| `src/domains/scanning/findings-store.ts` | Migration for old findings, priority sorting, suppression window, rejection tracking |
| `src/app/(shell)/finding-actions.ts` | `resolveFinding` with consequences + feedback, new `promoteFinding` action |
| `src/app/(shell)/page.tsx` | Pass homepageUrl, rejected types, accepted findings to client |
| `src/app/(shell)/today-client.tsx` | Priority-grouped queue, promotion UI, consequence feedback, section reorder |
| `src/app/(shell)/pages/pages-client.tsx` | Pending findings banner at detail top |
| `src/app/(shell)/review/page.tsx` | Updated description |
| `src/app/(shell)/review/review-queue-client.tsx` | "Heuristic" → "Pattern match" |
| `src/lib/today-summary.ts` | Attribution line simplified |
| `src/app/(shell)/diagnostics/page.tsx` | Removed "Heuristic" label |

### Build verification (Phase 32B)

- `npx tsc --noEmit` — pass
- `npm run build` — pass (22 routes)
- `npm test` — pass (26/26)

---

## 2026-04-11 — Master Product Plan Phases 33–37 (batch verification)

### Scope

Cross-cutting product work: operator truth on Today/Pages, Today information architecture, verdict + navigation layer on Pages/Changes/History, configurable business profile + import automation, competitor typing, optional tenant-scoped data dirs, and `/setup` onboarding.

### Phase 33 — Product truth stabilization

- **Since last scan** on Today is always rendered; shows **All clear** when there are no pending findings; shows queue + **pending** counts otherwise.
- **FindingRow** displays **`detectedAt`** timestamps.
- User-facing copy on **Today** and **Pages** uses **scan** (not crawl) where applicable.
- **PagesClient** / `pages/page.tsx`: removed dead **`onVerify`** prop path.
- Pages diff: explicit **"No changes since last scan"** when there is nothing to report.
- **Recommendations** on Pages: **warning** when the selected page still has **pending** findings.
- **`pages/page.tsx`**: server lookups use **normalized URLs** for consistent joins across registry, snapshots, and findings.

### Phase 34 — Today simplification

- Primary layout: **Findings inbox** → **Top recommendation** → **System status** (data sources).
- Secondary block: KPIs, momentum, experiments, what-changed, secondary opportunities, work queue → single **"Visibility, momentum & queue"** disclosure.
- **Accepted findings awaiting promotion** remain visible in the findings story.
- **System status** retained at bottom.

### Phase 35 — Pages + Changes verdict layer

- **Pages** detail: **ship / scan status** verdict (e.g. verified live with date, changes detected, not scanned yet, N changes — verify in Today).
- **Changes**: **outcome category** tabs — All changes · Proven winners · Mixed signals · No measurable impact · Too early.
- **History** (`/results`) ↔ **Changes**: **companion tabs** linking **Outcomes** ↔ **Measurement detail**.

### Phase 36 — Business abstraction + launch prep

- **`src/lib/business-config.ts`** — `BusinessConfig` type and accessors (name, domain, industry, locations, services, competitors, directoryDomains, scanSettings).
- **`src/domains/pages/extractor.ts`** — location/service signals from business config.
- **`postImportSetup()`** in **`src/lib/import/actions.ts`** — post workbook import: **registry build + scan**.
- **`src/domains/competitors/classify-type.ts`** — Direct / Directory / Editorial / Other; badges on **`/competitors`**.

### Phase 37 — First external users (infrastructure)

- **`src/lib/tenant.ts`** — `BEACON_TENANT` env var; per-tenant **`.data/tenants/{slug}/`** data roots.
- **`/setup`** — two-step onboarding (`setup/page.tsx`, `setup/actions.ts`).
- **`src/lib/navigation.ts`** — **Setup** under **System** group.

### Files created (this batch)

- `src/lib/business-config.ts`
- `src/domains/competitors/classify-type.ts`
- `src/lib/tenant.ts`
- `src/app/(shell)/setup/page.tsx`
- `src/app/(shell)/setup/actions.ts`
- `tests/domains/pages/extractor.test.ts` (extractor behavior with business-config-driven terms; counts toward Vitest total below)

### Files modified (representative)

- `src/app/(shell)/today-client.tsx`
- `src/app/(shell)/pages/pages-client.tsx`
- `src/app/(shell)/pages/page.tsx`
- `src/app/(shell)/changes/page.tsx`
- `src/app/(shell)/changes/scorecard-client.tsx`
- `src/app/(shell)/competitors/page.tsx`
- `src/app/(shell)/results/results-client.tsx`
- `src/app/(shell)/import/page.tsx`
- `src/lib/import/actions.ts`
- `src/lib/navigation.ts`
- `src/domains/pages/extractor.ts`

### Build verification (Phases 33–37)

- `npm run typecheck` (`tsc --noEmit`) — **pass**
- `npm run build` — **pass** (full Next.js production build)
- `npm test` (Vitest) — **pass** — **34** tests total at checkpoint (includes `tests/domains/pages/extractor.test.ts` and existing suite)
- 0 TypeScript errors reported at checkpoint

### What is intentionally **not** in this batch

- No auth, billing, teams, or hosted multi-tenant RLS (tenant switch remains env + disk path).
- Intelligence roadmap **Phase 33 — Native Querying Expansion** in `NEXT_PHASE_EXECUTION_PLAN.md` remains **future** work; these product phases use the same numbers on a **different** track (documented in `NEXT_PHASE_EXECUTION_PLAN.md` and `master_execution_plan.md`).

### Next verification focus

- Exercise **`BEACON_TENANT`** + **`/setup`** + **import** on a clean tree and confirm `.data/tenants/{slug}/` population.
- Capture first **external user** sessions and feed copy/IA tweaks (no new phase number required until the next planning pass).

---

## Phase 1C-3 — Audit `page.tsx` for remaining write ops in render (2026-04-12)

### Goal
Confirm Today is fully read-only during server render. If any render-time write remains, remove it.

### What was found
Line-by-line audit of `src/app/(shell)/page.tsx` identified **one remaining write path**:

- **`syncMilestonesFromWorkspace()`** (lines 907–913): calls `applyMilestoneSync()` which may set `dirty = true`, then calls `persistState()` → `writeStore("milestone-state", [state])` — a disk write during render.

All other call sites were verified as **read-only**:
- Data imports (`results`, `changelogEntries`, `opportunities`, etc.) — module-level reads
- Pure computations (`computeScorecard`, `enrichWithImpact`, `minePatterns`, `generateBriefs`, `planWaves`, `computeRecommendations`, `rankAndSelect`, etc.) — no side effects
- Store reads (`getPageSnapshots`, `getGuardrailAlerts`, `getPendingFindings`, `getActiveExperiments`, `getMilestoneState`, etc.) — read-only accessors
- Server action refs passed as props (`respondToRecommendation`, `resolveFinding`, `promoteFinding`, `startExperimentAction`) — not invoked during render
- `buildTodaySummary`, `buildTodayCompetitorLine`, `pickTodayMilestoneTeaser` — pure functions

### What changed

| File | Change |
|------|--------|
| `src/app/(shell)/page.tsx` | Replaced `syncMilestonesFromWorkspace()` (write) with `getMilestoneState()` (read-only) + `pickTodayMilestoneTeaser(state, [])`. Removed dead `perfCompetitorRank` computation and imports (`buildCompetitorRank`, `classifyCompetitorType`). |
| `src/domains/milestones/post-import-sync.ts` | **Created.** `runMilestoneSync()` — server-only helper that calls `syncMilestonesFromWorkspace()` after import, so milestones are up-to-date without writing during render. |
| `src/lib/import/actions.ts` | Added `runMilestoneSync().catch(() => {})` to both `executeImport()` and `importWorkbook()`, after the existing `runOutcomeBackfill` and `runExperimentCitationSync` calls. |
| `docs/HANDOFF_VERIFIED_STATE.md` | Track 1C marked COMPLETE; render-time side effects → DONE |
| `docs/NEXT_PHASE_EXECUTION_PLAN.md` | 1C-3 marked done with implementation notes |

### Behavior equivalence
- New milestone events are now computed during import and written to `state.events` in the persisted store.
- During render, `pickTodayMilestoneTeaser(state, [])` reads from persisted `state.events` to find recent milestones — equivalent behavior since events are already there from the last import.
- `newEvents` from `syncMilestonesFromWorkspace` was previously used only to prefer brand-new-this-render milestones; after import sync, these events are already in `state.events` and will be found by `pickTodayMilestoneTeaser`.

### Validation

- `npm run typecheck` — **pass**
- `npm run test` (77/77) — **pass**
- `npm run build` — **pass** (21 static pages generated)
- `GET /` — **200 OK**, full content rendered, no errors
- Render-time write audit — **pass** (zero `persist`/`writeStore`/`update`/`sync` calls remain in `page.tsx` render path)

### Result
**REMOVAL** — `syncMilestonesFromWorkspace()` was the last remaining render-time write. Moved to post-import. **Today RSC is now fully read-only.** Track 1C is complete.

---

## Phase 2A-1 — Create `DemoBanner` component (2026-04-12)

### Goal
Create a sticky, dismissable banner component that clearly communicates demo/sample state and links to the import flow.

### What changed

| File | Change |
|------|--------|
| `src/components/shell/demo-banner.tsx` | **Created.** Client component (`"use client"`) with `useState` dismiss. Sticky positioning (`sticky top-0 z-40`). Warning-toned strip (`border-status-warning/25 bg-status-warning/[0.06]`). Copy: "Sample data. You're viewing demo content. Import your data to see your real visibility briefing." X button dismisses in-session. Link to `/settings/import`. |

### Design decisions
- **Placed in `components/shell/`** — this is a shell-level banner, not Today-specific. Matches the pattern of other shell components (`app-sidebar`, `app-header`, `command-palette`).
- **Session-only dismiss** — `useState(false)` resets on page reload. No persistence needed for demo state (user either imports or doesn't). If needed later, localStorage dismiss can be added.
- **Not mounted yet** — per the phase plan, 2A-2 computes `isDemoMode` flag and 2A-3 conditionally renders the banner. This step is component creation only.
- **Visual treatment** — warning-toned to signal "this isn't your real data" without being alarming. Consistent with existing banner patterns (`scan-status-banner`, `narrative-banner`).

### Validation

- `npm run typecheck` — **pass**
- `npm run test` (77/77) — **pass**
- `npm run build` — **pass** (21 static pages)
- Lint check — **pass** (no errors)
- Component creation — **verified** (file exists, types check, builds clean)
- Not mounted — **confirmed** (no import of `DemoBanner` in any layout or page file)

---

## Phase 2A-2 — Pass `isDemoMode` from shell layout (2026-04-12)

### Signal
`hasActiveExperiment()` in `src/lib/seed-data.server.ts` returns `_importRuns.length > 0` — when **false**, the app hydrates from static `seed-data` (walkthrough / sample workspace). That matches audit copy: demo state when no import runs.

`isDemoMode = !hasActiveExperiment()`.

### Where computed / passed
- **Computed:** `src/app/(shell)/layout.tsx` (server layout), after badge computation.
- **Passed:** `ShellProvider` receives `isDemoMode={isDemoMode}`.
- **Exposed:** `src/components/shell/shell-provider.tsx` — `isDemoMode` on context value; default `false` if omitted (only `(shell)/layout` uses `ShellProvider`).

### Banner
**Intentionally not mounted** — Phase 2A-3 will render `DemoBanner` when `isDemoMode` (via `useShell().isDemoMode` or prop from layout).

### Validation
- `npm run typecheck` — **pass**
- `npm run test` (77/77) — **pass**
- `npm run build` — **pass**
- Wiring: `DemoBanner` still not imported in `layout.tsx` — **confirmed**

---

## Phase 2A-3 — Render `DemoBanner` when `isDemoMode` (2026-04-12)

### Where mounted
- **Single point:** `src/app/(shell)/layout.tsx` — first child inside `<main className="flex-1 overflow-y-auto">`, immediately above the `max-w-[1120px]` content wrapper.
- **Gate:** `DemoBannerGate` exported from `src/components/shell/demo-banner.tsx` — reads `useShell().isDemoMode`; returns `null` when false, otherwise `<DemoBanner />`.

### Conditional
`if (!isDemoMode) return null` in `DemoBannerGate` (no duplicate demo computation; flag still supplied by server layout → `ShellProvider` from 2A-2).

### Layout tweak
`main` no longer has horizontal padding; padding applied to inner `div` wrapping `{children}` so the banner spans the full main column width while sticky behavior remains tied to the main scroll area.

### New domain logic
**None** — only UI wiring + `DemoBannerGate` client wrapper.

### Validation
- `npm run typecheck` — **pass**
- `npm run test` (77/77) — **pass**
- `npm run build` — **pass**
- Manual: with empty import-runs, SSR/HTML should include “Sample data”; after import, `isDemoMode` false and gate returns null — operator verifies on their machine.

---

## Phase 2B-1 — Today empty state when demo / no real data (2026-04-12)

### Condition
`isDemoMode === !hasActiveExperiment()` — identical to Phase 2A shell demo signal (`import-runs` empty ⇒ seed sample workspace).

### Where rendered
- **`src/app/(shell)/page.tsx`** — computes `isDemoMode`, passes `isDemoMode={isDemoMode}` to `TodayClient`.
- **`src/app/(shell)/today-client.tsx`** — after `ScanStatusBanner`, when `isDemoMode`: a single `<section>` with heading “Import your data to see your real briefing”, explanatory copy, and `Link` to **`/settings/import`** (same destination as `DemoBanner`). When not demo: that section is omitted (`null`).

### Normal Today unchanged when false
All prior Today UI from `HowWeKnowPanel` through the System status line is wrapped in `{!isDemoMode && ( <> … </> )}`. `localUrgentStrip` also gated with `!isDemoMode` so it does not appear above the hidden briefing in demo mode.

### New domain logic
**None** — only prop + conditional JSX.

### Validation
- `npm run typecheck` — **pass**
- `npm run test` (77/77) — **pass**
- `npm run build` — **pass**

---

## Phase 2B-2 — Pages empty state when demo / no real data (2026-04-12)

### Condition
`!hasActiveExperiment()` — same as Phase 2A shell / Today 2B-1 (`import-runs` empty ⇒ sample workspace).

### Where rendered
- **`src/app/(shell)/pages/page.tsx`** — at the start of `PagesPage()`, before any page-row computation: if `!hasActiveExperiment()`, return `max-w-5xl` with the same Pages title + proof subtitle block as the normal route, then a compact `<section>` (“Import your data to see your real page list”), copy, and **`next/link`** to **`/settings/import`**.

### Normal Pages unchanged when false
When at least one import run exists, execution continues into the existing function body; **`PagesClient` and all row logic are unchanged**.

### New domain logic
**None** — only `hasActiveExperiment` + early return + `Link` import.

### Validation
- `npm run typecheck` — **pass**
- `npm run test` (77/77) — **pass**
- `npm run build` — **pass**

---

## Phase 2B-3 — Changes empty state when demo / no real data (2026-04-12)

### Condition
`!hasActiveExperiment()` — same as Phase 2A shell / Today 2B-1 / Pages 2B-2.

### Where rendered
- **`src/app/(shell)/changes/page.tsx`** — first lines of `ChangeScorecardPage()`: if `!hasActiveExperiment()`, return `<div>` with existing **`PageHeader`** (“Changes” / same description as live route) plus a compact `<section>` with heading “Import your data to see your real Changes workspace”, copy referencing scorecard / attribution / replication, and **`Link`** to **`/settings/import`**.

### Normal Changes unchanged when false
When at least one import run exists, the function continues with the existing body (scorecard, `ChangesTabShell`, milestone sync, etc.).

### New domain logic
**None** — only `hasActiveExperiment` import + early return branch.

### Validation
- `npm run typecheck` — **pass**
- `npm run test` (77/77) — **pass**
- `npm run build` — **pass**

---

## Phase 2B-4 — Market empty / import path verification (2026-04-12)

### Verification
- **`src/app/(shell)/competitors/page.tsx`** already had import guidance when **`benchmark === null`** (no `citationEvidenceIndex`): “No citation evidence yet” + **Link** to **`/settings/import`** (“Go to Import”).
- That path does **not** use **`!hasActiveExperiment()`** — in demo/no-import mode the citation index from bundled/sample data is often present, so the full Market UI could render without the Phase 2B “import your real data” signal.

### Result: **ADDED** (not NO-OP)
- Inserted **`!hasActiveExperiment()`** early return at the top of `CompetitorsPage()` (same signal as Today / Pages / Changes / shell): **`PageHeader`** (“Market”) + restrained `<section>` + **`/settings/import`** CTA (“Go to Import →”).
- Skips heavy Market computation and **`syncMilestonesFromWorkspace`** when demo.
- The existing **`benchmark ? … : …`** “No citation evidence yet” block remains for **post-import** runs where the citation index is still missing.

### Validation
- `npm run typecheck` — **pass**
- `npm run test` (77/77) — **pass**
- `npm run build` — **pass**

---

## Phase 2B-5 — Today “All Clear” hidden in demo / no-real-data (2026-04-12)

### Signal
**`isDemoMode`** on Today — same as elsewhere: **`!hasActiveExperiment()`** (passed from `src/app/(shell)/page.tsx` into `TodayClient` since 2B-1).

### Where changed
- **`src/lib/today-ritual.ts`** — `shouldShowTodayAllClear` params gain optional **`isDemoMode?: boolean`**. If truthy, return **`false`** before existing queue/coverage checks.
- **`src/app/(shell)/today-client.tsx`** — passes **`isDemoMode`** into **`shouldShowTodayAllClear({ …, isDemoMode })`**.

### Real-data behavior
When **`isDemoMode`** is false or omitted, logic is **unchanged** from prior criteria (pending findings, primary response, crawl/visibility staleness, partial coverage).

### Note
The All Clear **UI** was already inside **`{!isDemoMode && (<>…</>)}`** from 2B-1; this step **centralizes** the rule in the ritual helper so the decision cannot drift if layout changes.

### Validation
- `npm run typecheck` — **pass**
- `npm run test` (78/78) — **pass**
- `npm run build` — **pass**

---

## Phase 2C-1 — Create `DataFreshnessStrip` component (2026-04-12)

### Created
- **`src/components/shell/data-freshness-strip.tsx`** — server-safe presentational component (no `"use client"`).

### Inputs
- **`lastImportAt: string | null`** — intended to mirror **`getDataCoverage().lastImportAt`** / newest import run `started_at`.
- **`lastScanCompletedAt: string | null`** — intended to mirror **`latestWebsiteCrawlRun()?.completed_at`**.
- Optional **`className`** for layout integration in 2C-2.

### Mounting
**Intentionally not mounted** in this step (Phase **2C-2** wires into shell layout).

### Validation
- `npm run typecheck` — **pass**
- `npm run test` (78/78) — **pass**
- `npm run build` — **pass**
