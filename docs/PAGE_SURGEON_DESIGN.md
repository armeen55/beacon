# Page Surgeon — Atomic Change Evidence Evaluator (Design / Governing Spec)

**Status:** DESIGN — awaiting operator approval. No implementation, no paid-API
pulls, no regeneration, no publish until approved.

**Author:** 2026-06-18. Supersedes the per-action composers (`composeTitle`,
`composeMeta`, …) as the *decider*. Governs EVERY recommendation / atomic change.

---

## 0. The one principle

Beacon has **no fixed style and no hardcoded SEO rules**. For every atomic
change it behaves like an expert operator: it assembles the evidence, generates
**multiple candidate options**, **scores** each against structured evidence,
and **chooses** the best — or returns `keep_current` / `needs_more_evidence`
when the evidence doesn't support a change. Deterministic safety gates — never
the LLM — decide publishability. The LLM may *evaluate* candidates over the
structured evidence; it may never *invent* a metric.

Forbidden (these are the rules we are deleting, not adding): "always use the top
query", "always remove brand", "always add brand", "always rewrite", "always
keep current", "skip if the query appears anywhere". Each must instead **fall
out of a candidate comparison**, differently per page, from evidence.

---

## 1. Where it sits in the pipeline (replaces the composers as decider)

```
TODAY:   trigger ──► composer (hardcoded action)        ──► QA gate ──► promotion
                     e.g. composeTitle picks ONE title

NEW:     trigger ──► CANDIDATE-SITE detector            (says "evaluate this page/element + why")
              └────► Atomic Change Evidence Evaluator    (assemble packet → generate candidates → score → decide)
                            │
                            ▼
                     deterministic publishability gate   (enforceExpertConfidence + push-readiness; UNCHANGED authority)
                            │
                            ▼
                     promotion ──► recommended_edits      (carries the full Evidence Packet + Decision)
```

- **Triggers become detectors, not prescribers.** `gsc-low-ctr`,
  `gsc-striking-distance`, `gsc-decay`, `semrush-striking-distance`,
  `clarity-friction`, `title-h1-mismatch`, etc. flag *that a page/element is
  worth evaluating and why* (the firing signal becomes one piece of evidence).
  They no longer name the final action.
- **The Evaluator decides the action** by comparing candidates.
- **The deterministic gate keeps final authority** over confidence +
  publishable/staged/review-only (existing `enforceExpertConfidence` /
  `recommendation-qa.ts` / push-readiness policy — see `recommendation-qa.ts`,
  `expert-verdict.ts`, `PUSH_READINESS_BY_ACTION`).

Integration points (real files): triggers `src/domains/recommendation-intelligence/triggers/*`;
composers (become candidate *generators*) `draft-enrichment.ts`; signal loaders
`gsc-page-signals.ts`, `semrush-page-signals.ts`, `clarity-page-signals.ts`,
GA4 page-values, `page_snapshots`; gate `recommendation-qa.ts` /
`expert-verdict.ts`; promotion `promotion-writer.ts`.

---

## 2. Data contract (exact)

```ts
// ── Change taxonomy ───────────────────────────────────────────────────────
export type AtomicChangeType =
  | "title" | "h1" | "meta" | "intro_answer_block" | "faq"
  | "section_add" | "section_remove" | "section_reorder"
  | "internal_link" | "schema" | "image_alt" | "ux_cta_fix"
  | "citation_source" | "create_new_page";

export type EvidenceConfidence = "high" | "medium" | "low" | "needs_more_evidence";
export type Publishability = "publishable" | "staged" | "review_only";

// ── 1. Current state ──────────────────────────────────────────────────────
export type CurrentState = {
  tenantId: string;
  pageUrl: string;
  changeType: AtomicChangeType;
  elementKey: string | null;          // which field/section
  sectionLabel: string | null;
  currentText: string | null;         // current title/h1/meta/section text
  cmsFieldMapped: boolean;            // is there a Wix field mapping?
  publishChannel: "wix_cms" | "git_pr" | "dev_note" | "none";
};

// ── 2. Evidence used (every source optional; NEVER fabricate) ─────────────
// Each block is present only when that source actually has data for this page.
export type GscEvidence = {
  windowStart: string; windowEnd: string;
  impressions: number; clicks: number; ctr: number; avgPosition: number;
  topQueries: Array<{ query: string; impressions: number; clicks: number; ctr: number; position: number }>;
  expectedCtrForPosition: number | null;   // from the position→CTR curve
  ctrGap: number | null;                    // expected − actual (per page / per query)
  byDevice?: Array<{ device: string; impressions: number; clicks: number; ctr: number; position: number }>;
  byCountry?: Array<{ country: string; impressions: number; clicks: number }>;
};
export type Ga4Evidence = {
  sessions: number; engagedSessions: number; engagementRate: number | null;
  avgSessionDurationSec: number | null;
  keyEvents: number | null; sessionKeyEventRate: number | null; revenue: number | null;
};
export type ClarityEvidence = {
  windowStart: string; windowEnd: string;
  scrollDepthMedian: number | null; engagementTimeSec: number | null;
  deadClicks: number | null; rageClicks: number | null; quickbacks: number | null;
  scriptErrors: number | null; excessiveScroll: number | null;
  byDevice?: Array<{ device: string; deadClicks: number; rageClicks: number; scrollDepthMedian: number }>;
};
export type SemrushEvidence = {
  keywords: Array<{ keyword: string; volume: number; kd: number; cpc: number; intent: string | null; position: number | null }>;
  serpFeatures?: Array<{ query: string; features: string[]; aiOverview: boolean }>;
  relatedKeywords?: string[]; questionKeywords?: string[];
  competitorGaps?: Array<{ keyword: string; competitorDomain: string; competitorPosition: number; volume: number }>;
};
export type ProfoundEvidence = {           // later — REQUIRED before any AEO/AI-citation claim
  aiVisibility: number | null; citations: number | null;
  promptClusters?: string[]; competitorMentions?: Array<{ competitor: string; share: number }>;
};
export type CrawlEvidence = {
  title: string | null; h1: string | null; metaDescription: string | null;
  h2List: string[]; h3List: string[]; faqs: string[]; schemaTypes: string[];
  wordCount: number | null; internalLinkCount: number | null; cardTexts: string[];
};

export type EvidencePacket = {
  current: CurrentState;
  gsc?: GscEvidence; ga4?: Ga4Evidence; clarity?: ClarityEvidence;
  semrush?: SemrushEvidence; profound?: ProfoundEvidence; crawl?: CrawlEvidence;
  // Which sources were CONNECTED but returned no data (so "missing" ≠ "absent").
  sourcesPresent: string[]; sourcesConnectedButEmpty: string[];
};

// ── 3. Candidate options ──────────────────────────────────────────────────
export type CandidateOption = {
  id: string;                          // stable per (page, changeType, strategy)
  strategy: string;                    // e.g. "keep_current" | "query_first" | "query_plus_modifier" | ...
  proposedText: string | null;        // null for keep_current / do_nothing
  preservedTerms: string[]; removedTerms: string[];
  brandSuffixDecision: "include" | "omit" | "neutral";
  rationaleSeed: string;               // why this option is on the table (not the score)
};

// ── 4. Scoring ────────────────────────────────────────────────────────────
export type ScoreDimension =
  | "query_intent_fit" | "page_topic_fit" | "business_value"
  | "ctr_or_ranking_upside" | "conversion_engagement_value" | "ux_friction_impact"
  | "semrush_market_opportunity" | "aeo_serp_feature_fit"
  | "lost_term_risk" | "google_title_rewrite_risk" | "brand_trust_fit"
  | "implementation_risk" | "measurement_clarity"
  | "already_satisfies_query" | "snippet_promise_improvement";

export type DimensionScore = {
  dimension: ScoreDimension;
  score: number;                       // 0..1 (risk dims: 1 = low risk / good)
  evidenceUsed: string[];              // provenance — which packet fields drove it
  available: boolean;                  // false → this dim's source was absent (not scored, not faked)
};
export type CandidateScore = {
  candidateId: string;
  dimensions: DimensionScore[];
  weightedTotal: number;               // weights are CONFIG (per changeType/tenant), not magic constants
  vetoes: string[];                    // hard vetoes that fired (e.g. clarity_ux_veto, factual_brand_risk)
};

// ── 5. Decision ───────────────────────────────────────────────────────────
export type EvaluatorDecision = {
  changeType: AtomicChangeType;
  pageUrl: string;
  recommendedCandidateId: string | null;   // null ⇒ keep_current / needs_more_evidence
  recommendedText: string | null;
  keepCurrent: boolean;
  rejectedCandidates: Array<{ candidateId: string; title: string | null; reason: string }>;
  confidence: EvidenceConfidence;
  evidenceUsed: string[];
  evidenceGaps: string[];
  hypothesis: string;                  // exact, testable
  risks: string[];
  beforeAfterDiff: { before: string | null; after: string | null };
  measurementPlan: string;             // the specific metric + expected direction + horizon
  rollbackPlan: string;
  publishability: Publishability;      // SET BY THE DETERMINISTIC GATE, not the LLM
  // Title specialization (operator's exact shape) is derived from the above:
  titleStrategy?: {
    recommended_strategy: string; recommended_title: string | null;
    keep_current_title: boolean;
    brand_suffix_decision: "include" | "omit" | "neutral";
    preserved_terms: string[]; removed_terms: string[];
  };
};
```

---

## 3. Candidate generation (pluggable per change type — no fixed winner)

A registry maps each `AtomicChangeType` → a pure **candidate generator** that
proposes options from the packet. For `title`, the generator emits the operator's
8 strategies (keep / query-first / query+modifier / +brand / −brand /
preserve-tail / replace-tail / new-page) **whenever the evidence makes each
plausible** — it does not pre-judge a winner. Other change types get their own
generator (e.g. `intro_answer_block` → {keep, add-40-60-word answer, rewrite
intro}; `section_reorder` → {keep, move section X above Y}). The generators reuse
the existing draft helpers (`draft-enrichment.ts`) as *option producers*.

---

## 4. Scoring model (deterministic core, optional LLM judge)

- **Deterministic scorers**: each `ScoreDimension` is a pure function
  `(candidate, packet) → DimensionScore`. If the source for a dimension is
  absent, `available:false` (the dimension is dropped, never guessed).
- **Weights are config**, keyed by `changeType` (+ tenant override), stored in a
  reviewable config object — never inline magic numbers. Aggregate =
  weighted mean over *available* dimensions, then **hard vetoes** apply
  (e.g. Clarity UX bottleneck vetoes content-expansion; factual/brand risk
  vetoes a rewrite; lost-term risk above threshold vetoes a tail-replacement).
- **LLM judge (flagged, later wave)**: given the packet + deterministic scores +
  candidates, it may re-rank, surface a nuance a scorer missed, and write the
  human-readable reasoning. Hard constraints: cannot invent metrics, cannot
  raise confidence past the deterministic gate, cannot set publishability;
  unavailable/over-budget/sanitize-reject → visible deterministic fallback
  (same pattern as the existing strategist fallback).

---

## 5. Deterministic publishability gate (authority unchanged)

`publishability` and final `confidence` are decided by the existing
`enforceExpertConfidence` / `recommendation-qa.ts` + per-action push-readiness
policy, applied to the chosen candidate + its evidence. The evaluator **feeds**
the gate; it never overrides it. Thin evidence ⇒ `needs_more_evidence` ⇒
`review_only`. This preserves every safety property already pinned by the
architecture tests.

---

## 6. Hard rules honored (your spec, mapped to mechanism)

- No "always X" — every outcome is a candidate comparison (§3/§4).
- No Iranopedia-specific logic — brand/terms come from tenant config + the
  page's own crawl; tests use fixtures only. An architecture pin scans the
  evaluator for tenant literals.
- SEMrush is directional — it contributes `semrush_market_opportunity` only;
  it cannot by itself outvote GSC truth (weight cap + it can't trigger publish).
- GSC is first-party truth but interpreted with intent/UX/business dims.
- Clarity can veto content expansion (hard veto, §4).
- GA4 can make a low-volume keyword win (business_value/conversion dims can
  outweigh semrush volume).
- Profound required before any AEO/AI-citation claim (the `aeo_serp_feature_fit`
  dim is `available:false` until Profound/SEMrush-SERP data exists).
- Thin evidence ⇒ `needs_more_evidence` / `keep_current`.

---

## 7. Additional expert improvements (explicit, not silently added)

1. **One-change-per-page opportunity ranking (safe now).** After scoring every
   candidate change type for a page, surface the single highest expected-value
   atomic change first (an EV ranking across change types), so the operator sees
   "the one move that matters", not 8 simultaneous edits. *Why:* matches "fewer,
   smarter recs." *Safe now.*
2. **Evidence-confidence weighting (safe now).** Down-weight any dimension whose
   source is stale/thin (e.g. Clarity's 3-day window, SEMrush 0-rows) so a
   decision is never dominated by a weak signal. *Safe now.*
3. **Counterfactual measurement (safe now).** Every decision's `measurementPlan`
   names the exact metric + expected direction + horizon + a comparable control
   page, so the proof loop can later grade it. *Safe now.*
4. **Title-rewrite-risk model (safe now).** Estimate Google's title-link rewrite
   risk from whether the current title already satisfies the top queries; feed
   `google_title_rewrite_risk`. *Safe now — deterministic.*
5. **LLM judge only on ambiguity (later wave).** Invoke the LLM only when the top
   deterministic candidates are within a small margin (cost discipline). *Later.*
6. **Cross-page cannibalization awareness (later wave).** When two pages compete
   for one query, the evaluator's candidate set includes "consolidate" decided
   by conversion/engagement, not just rank. *Later (needs GA4 + the GSC-first
   cannibalization detector from the audit).*

---

## 8. Build order (waves, each commit-checkpointed, nothing auto-runs)

- **W1a — contract + title evaluator.** Land the types above + the title
  candidate generator + deterministic scorers + the 7 operator tests; wire it to
  REPLACE `composeTitle` as the decider; gate unchanged. (No LLM yet — pure
  deterministic candidate comparison.)
- **W1b — generalize** to `meta`, `h1` (reuse the framework).
- **W1c — section/link/schema/intro/faq/alt/ux/citation/new_page** generators.
- **W2 — LLM judge layer** (flagged), over the structured packet.
- **W3 — evidence depth** the audit flagged (GSC device, SEMrush SERP-features,
  GA4 outcomes, Clarity section-level) feed new dimensions as data arrives.

---

## 9. The 7 title tests (acceptance — candidate comparison, not fixed rules)

1. Brand suffix **kept** when it adds trust and fits length (a +brand candidate
   wins on evidence).
2. Brand suffix **omitted** when it crowds out higher-value terms (a −brand
   candidate wins).
3. Descriptive tail **preserved** when it carries intent (preserve-tail wins).
4. Descriptive tail **removed** when boilerplate/low-value (replace-tail wins).
5. Current title **kept** when it already satisfies the query (keep_current
   wins) — by *score*, not a blanket skip.
6. Query-first title wins **only** when evidence supports it.
7. **No Iranopedia hardcoding** (architecture pin).

Each test sets up an evidence packet and asserts the *chosen candidate*, proving
selection is evidence-driven, not rule-driven.

---

## 10. What I need approved before implementing

1. The **data contract** (§2).
2. The **pipeline placement** (§1 — triggers→detector, evaluator decides, gate
   keeps authority).
3. The **wave order** (§8 — start W1a: title evaluator replacing `composeTitle`).
4. Which **Additional improvements** (§7) to fold into W1a vs defer.

On approval I implement W1a only (deterministic title evaluator + 7 tests),
commit, and show you the new title decisions on your real GSC data before going
wider. Still no SEMrush pull / regeneration / publish until you say so.
