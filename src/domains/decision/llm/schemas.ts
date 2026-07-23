/**
 * llm/schemas (2026-06-25, P4 — structured drafts) — Zod schemas for every
 * product-critical LLM artifact. No loose blob text is ever the final product
 * artifact: a draft is only trusted once it parses against one of these schemas.
 *
 * Every draft carries `evidenceRefs` (≥1 — what grounds it), `confidence`,
 * `risks`, and `operatorSteps`; content drafts also carry a `proofPlan` so the
 * Move ships with its measurement attached. These schemas are the validation
 * contract for `structured-drafter.ts` (validate → retry-once → fail-closed) and
 * the typed shape the PreparedMovePack (P3) carries forward.
 *
 * PURE — types + validators only, no I/O. Tenant-agnostic.
 */

import { z } from "zod";

// ── shared building blocks ──────────────────────────────────────────────────

/** Where a claim is grounded — points at a real signal/source the team read.
 *  `source` mirrors the EvidenceRef sources used by the specialist layer. */
export const EvidenceRefSchema = z.object({
  source: z.enum([
    "gsc",
    "ga4",
    "clarity",
    "profound",
    "dataforseo",
    "competitor_teardown",
    "owned_snapshot",
    "fanout",
  ]),
  detail: z.string().min(1).max(300),
});
export type EvidenceRef = z.infer<typeof EvidenceRefSchema>;

export const ConfidenceSchema = z.enum(["high", "medium", "low"]);

/**
 * W5 (2026-07-09, J-69/J-71), one citation attached to a factual draft. The
 * LLM may PROPOSE a source (url/title/domain/claim); it never gets to decide
 * `authority`, only `src/domains/decision/drafts/source-authority.ts`'s deterministic
 * classifier stamps that field (a .gov/.edu domain, a small named encyclopedic/
 * major-press set, or the tenant's own allowlist earns "authoritative"; a real
 * URL with a claim but no authoritative domain is "weak"; a bare URL with no
 * claim attached is "unverified", it counts as no source at all). `claim` is
 * the specific fact this source backs, so a source can be checked for actually
 * covering the draft's claim, not just cited in passing. */
export const SourceRefSchema = z.object({
  url: z.string().min(1).max(500),
  title: z.string().min(1).max(200),
  domain: z.string().min(1).max(120),
  /** ISO date (or plain-English date string) the source was read/retrieved. */
  retrievedAt: z.string().min(1).max(40),
  /** The specific fact/claim this source backs, never a bare citation. */
  claim: z.string().min(1).max(400),
  authority: z.enum(["authoritative", "weak", "unverified"]),
  /** W5 P0-1 (2026-07-09), set at GENERATION time ONLY (structured-drafter.ts
   *  fetches the URL and checks the fetched text actually carries this claim's
   *  tokens - never on a render/eval path). `true` means the cited page was
   *  reachable AND its text matches the claim; the source-authority gate
   *  (`hasQualifyingAuthoritativeSource`) requires this true so a hallucinated
   *  .gov/.edu URL can never earn "authoritative" on domain class alone.
   *  Defaults to false so every persisted pre-P0-1 draft deserializes clean and
   *  honestly surfaces "Needs a source" until regenerated. */
  verified: z.boolean().default(false),
  /** W5 P0-1, ISO timestamp the generation-time verification confirmed the
   *  source. Present only alongside verified === true. */
  verifiedAt: z.string().min(1).max(40).optional(),
  /** W5 stop-ship F2 (2026-07-09): the exact excerpt (a sentence or adjacent
   *  pair) on the fetched page that entails this claim - persisted so the
   *  operator can see WHAT backed it, not just that something did. Set only
   *  alongside verified === true. */
  supportingExcerpt: z.string().max(600).optional(),
  /** W5 stop-ship F2: the FINAL URL the source-verify fetch actually landed on
   *  after redirects (authority is recomputed from this host, not the proposed
   *  one). Set only alongside verified === true. */
  finalUrl: z.string().max(500).optional(),
  /** W5 stop-ship F2: sha256(supportingExcerpt) first 16 hex chars - a stable
   *  fingerprint of the backing passage. Set only alongside verified === true. */
  contentHash: z.string().max(64).optional(),
  /** Drafter last-mile G5 (2026-07-10): set at GENERATION time when the cited
   *  URL is from an authority-strong domain BUT the fetch was refused with a
   *  robots/anti-bot status (403 class) so the claim could not be confirmed by
   *  reading the page. `authority` stays "authoritative" (the domain is trusted)
   *  while `verified` stays false (we never read it). The draft gate turns this
   *  into a `needs_source_check` hold ("I could not read <domain> myself - check
   *  this citation"), NEVER silently ready. Absent/false on every reachable or
   *  unreachable source. Reset before any fetch, so an LLM-supplied value can
   *  never survive. */
  fetchBlocked: z.boolean().optional(),
});
export type SourceRef = z.infer<typeof SourceRefSchema>;

/** One concrete, operator-facing step to execute the Move. */
export const OperatorStepSchema = z.string().min(3).max(280);

/** Shared implementation-checklist row (used by the PreparedMovePack). */
export const ImplementationStepSchema = z.object({
  step: z.string().min(3).max(280),
  pushMethod: z.enum(["wix_field", "paste", "manual", "code"]).default("manual"),
  done: z.boolean().default(false),
});
export type ImplementationStep = z.infer<typeof ImplementationStepSchema>;

/** Proof plan attached to a content Move — metrics + windows + control basis. */
export const ProofPlanSchema = z.object({
  metrics: z.array(z.string().min(1)).min(1).max(8),
  windowsDays: z.array(z.number().int().positive()).min(1).default([7, 14, 28]),
  controls: z.string().min(1).max(300),
});
export type ProofPlan = z.infer<typeof ProofPlanSchema>;

/** Fields EVERY structured draft must carry — the trust floor. evidenceRefs is
 *  REQUIRED and non-empty: a draft with no grounding is rejected by validation. */
const base = {
  evidenceRefs: z.array(EvidenceRefSchema).min(1),
  confidence: ConfidenceSchema,
  risks: z.array(z.string().min(1)).max(8).default([]),
  operatorSteps: z.array(OperatorStepSchema).min(1).max(12),
};

// ── the draft schemas (the Sprint 2 minimum set) ────────────────────────────

/** 1. AnswerBlockDraft, the 80-150 word extractable AEO answer block (J-71:
 *  "80-150 words WITH source citations - 40-60 is too thin"). `answer`'s max
 *  is widened to 1200 chars (150 words needs ~1050), the 80-150 word BAND
 *  itself is enforced by draft-quality.ts's evaluateDraftQuality, not here;
 *  this schema only bounds the shape. `sources` is additive with a `[]`
 *  default so every persisted pre-W5 draft still deserializes clean.
 *  W5 P2 (2026-07-09): the min is raised to 450 chars (a coarse floor for the
 *  80-word contract) so the drafter cannot cache an obviously-too-thin answer
 *  the quality gate would reject; the precise 80-word check is the gate plus
 *  the drafter's own word-count retry (structured-drafter.ts). */
export const AnswerBlockDraftSchema = z.object({
  answer: z.string().min(450).max(1200),
  citationHook: z.string().max(200).nullable().default(null),
  /** W5 (J-69): the 1-2 authoritative sources backing this answer's claims.
   *  Defaults to [], an empty list is exactly what "no source yet" means; the
   *  quality gate (never this schema) decides whether that blocks copy. */
  sources: z.array(SourceRefSchema).default([]),
  proofPlan: ProofPlanSchema,
  ...base,
});
export type AnswerBlockDraft = z.infer<typeof AnswerBlockDraftSchema>;

/** 2. CreatePageBrief — the brief for a brand-new page. */
export const CreatePageBriefSchema = z.object({
  proposedTitle: z.string().min(10).max(70),
  metaDescription: z.string().min(50).max(170),
  openingAnswer: z.string().min(120).max(700),
  outline: z.array(z.string().min(2).max(160)).min(3).max(16),
  faqQuestions: z.array(z.string().min(6).max(200)).max(8).default([]),
  schemaTypes: z.array(z.string().min(2).max(60)).max(8).default([]),
  /** W5 (J-69): same additive sources list as AnswerBlockDraftSchema. */
  sources: z.array(SourceRefSchema).default([]),
  proofPlan: ProofPlanSchema,
  ...base,
});
export type CreatePageBrief = z.infer<typeof CreatePageBriefSchema>;

/** 3. AtomicEditDraft — one precise field change on an existing page. */
export const AtomicEditDraftSchema = z.object({
  field: z.enum(["title", "meta", "h1", "answer_block", "section"]),
  before: z.string().max(2000).nullable().default(null),
  after: z.string().min(1).max(2000),
  rationale: z.string().min(1).max(400),
  /** W5 (J-69): same additive sources list, only meaningful when the edit
   *  introduces a NEW factual claim the "before" value didn't already carry
   *  (see draft-quality.ts's isFactualClaim); a pure rephrase is never gated. */
  sources: z.array(SourceRefSchema).default([]),
  proofPlan: ProofPlanSchema,
  ...base,
});
export type AtomicEditDraft = z.infer<typeof AtomicEditDraftSchema>;

/** 4. ToolAssetSpec — spec for an interactive tool/calculator. */
export const ToolAssetSpecSchema = z.object({
  toolName: z.string().min(2).max(80),
  summary: z.string().min(1).max(400),
  inputs: z
    .array(
      z.object({
        label: z.string().min(1).max(80),
        type: z.enum(["number", "text", "select", "date", "boolean"]),
      }),
    )
    .min(1)
    .max(12),
  outputs: z.array(z.string().min(1).max(120)).min(1).max(12),
  buildPath: z.enum(["embed", "static_widget", "calculator", "form"]),
  ...base,
});
export type ToolAssetSpec = z.infer<typeof ToolAssetSpecSchema>;

/** 5. CommerceAssetSpec — what a commerce opportunity should BECOME + the brief.
 *  Schema-only here (Sprint 2 doesn't generate these en masse; P8 does). */
export const CommerceAssetSpecSchema = z.object({
  assetType: z.enum([
    "product",
    "collection_page",
    "campaign_landing_page",
    "content_product_bundle",
    "lead_magnet",
    "sales_artifact",
    "trust_artifact",
  ]),
  concept: z.string().min(1).max(300),
  whyNow: z.string().min(1).max(300),
  designBrief: z.string().min(1).max(1200),
  seoTitle: z.string().min(10).max(70),
  metaDescription: z.string().min(50).max(170),
  imageAltRules: z.array(z.string().min(1).max(200)).max(8).default([]),
  proofPlan: ProofPlanSchema,
  ...base,
});
export type CommerceAssetSpec = z.infer<typeof CommerceAssetSpecSchema>;

/** 6. CROFixSpec — a conversion/UX fix from a friction signal. */
export const CROFixSpecSchema = z.object({
  frictionType: z.enum(["dead_click", "rage_click", "cta_clarity", "form_friction", "intent_mismatch"]),
  location: z.string().min(1).max(200),
  fix: z.string().min(1).max(600),
  proofPlan: ProofPlanSchema,
  ...base,
});
export type CROFixSpec = z.infer<typeof CROFixSpecSchema>;

/** 7. ExperimentPlan — a falsifiable experiment for a Move. */
export const ExperimentPlanSchema = z.object({
  hypothesis: z.string().min(1).max(300),
  primaryMetric: z.string().min(1).max(80),
  expectedDirection: z.enum(["up", "down", "neutral_hold"]),
  windowsDays: z.array(z.number().int().positive()).min(1).default([7, 14, 28]),
  controlDescription: z.string().min(1).max(300),
  ...base,
});
export type ExperimentPlan = z.infer<typeof ExperimentPlanSchema>;

/** 8. AeoPromptBrief — the structured brief to WIN one AI prompt (Profound
 *  Question Intelligence). NOT a vague summary: a quotable direct answer + the
 *  fan-out sub-questions to cover + the facts/entities/sources/competitor-pages
 *  + the schema + internal links. Field names mirror the operator's spec. */
export const AeoPromptBriefSchema = z.object({
  // 40–80 words ≈ 220–520 chars (one extractable, quotable answer).
  direct_answer_40_80_words: z.string().min(150).max(700),
  fanout_sections: z
    .array(z.object({ question: z.string().min(4).max(200), answer_goal: z.string().min(3).max(400) }))
    .min(1)
    .max(12),
  facts_to_verify: z.array(z.string().min(1).max(300)).max(20).default([]),
  entities_to_include: z.array(z.string().min(1).max(120)).max(30).default([]),
  sources_to_reference: z.array(z.string().min(1).max(300)).max(20).default([]),
  competitor_pages_to_beat: z.array(z.string().min(1).max(400)).max(10).default([]),
  schema_recommendation: z.enum(["FAQPage", "Article", "ItemList", "None"]),
  internal_links: z.array(z.string().min(1).max(300)).max(20).default([]),
  ...base,
});
export type AeoPromptBrief = z.infer<typeof AeoPromptBriefSchema>;

/** 9. InternalLinkDraft — a contextual internal link from a source page to a target
 *  page. NOT a bare URL pair: the exact anchor + the sentence to drop the link into +
 *  why it helps. Self-links and misleading anchors are rejected by the quality gate. */
export const InternalLinkDraftSchema = z.object({
  sourcePage: z.string().min(1).max(400),
  targetPage: z.string().min(1).max(400),
  anchorText: z.string().min(2).max(120),
  linkSentence: z.string().min(10).max(400),
  reason: z.string().min(4).max(400),
  riskNotes: z.array(z.string().min(1).max(200)).max(6).default([]),
  proofPlan: ProofPlanSchema,
  ...base,
});
export type InternalLinkDraft = z.infer<typeof InternalLinkDraftSchema>;

// ── team verdict (FINAL PREMIUM PLAN item 25) ─────────────────────────────────
// The strategist's one-paragraph synthesis of the specialist debate for a nightly pick.
// Grounded in the REAL voices (claims carry the numbers); the numeric firewall blocks any
// figure that is not in the grounding. Short, opinionated, operator language.

export const TeamVerdictSchema = z.object({
  /** 1-3 sentences: what the evidence says, why THIS change, what the bigger prize is. */
  verdict: z.string().min(60).max(520),
  evidenceRefs: z.array(EvidenceRefSchema).min(1),
});
export type TeamVerdict = z.infer<typeof TeamVerdictSchema>;

// ── batch adjudication (BEACON 500 item 12 - the final review) ────────────────
// The nightly FINAL REVIEW over the whole plan preview: one bounded call
// sanity-checks EVERY pick against its own evidence ("does the proposed text
// match what the top search actually asks for?"). Output is per-pick verdicts
// ONLY - the review can flag a pick with a one-line caution, it can never drop
// or reorder picks. The concern line is operator copy: plain language, <= 140
// chars, and it passes the same numeric-fidelity firewall as every draft.

export const BatchAdjudicationSchema = z.object({
  picks: z
    .array(
      z.object({
        /** Echoed EXACTLY from the input - a mangled id is dropped by the caller. */
        pickId: z.string().min(1).max(240),
        verdict: z.enum(["looks_right", "concern"]),
        /** Present only when verdict is "concern": one plain sentence, <= 140 chars. */
        concern: z.string().max(140).optional(),
      }),
    )
    .min(1)
    .max(24),
});
export type BatchAdjudication = z.infer<typeof BatchAdjudicationSchema>;

// ── strategy review (BEACON 500 item 51 - the weekly reallocation memo) ───────
// One Sunday-night LLM pass over the week's settled dossier proposes a lever mix
// (relative weight per actionFamily) and up to 3 page-family focus targets for the
// COMING week, plus a short signed memo explaining the change. The LLM PROPOSES;
// the caller (apply-mix.ts / run-strategy-review.ts) deterministically CLAMPS every
// weight to [0.5, 2.0], drops any family it does not recognize, and strips dashes.
// A failure here means no change this week (fail-open to the previous mix) - this
// schema only bounds the SHAPE, never the trust decision.

export const StrategyLeverWeightSchema = z.object({
  family: z.string().min(1).max(40),
  weight: z.number().min(0).max(10),
  reason: z.string().min(1).max(140),
});

export const StrategyFocusFamilySchema = z.object({
  family: z.string().min(1).max(60),
  reason: z.string().min(1).max(160),
});

export const StrategyReviewSchema = z.object({
  leverMix: z.array(StrategyLeverWeightSchema).min(1).max(12),
  focusFamilies: z.array(StrategyFocusFamilySchema).max(3).default([]),
  /** The signed memo, plain business English, <= 900 chars. */
  memo: z.string().min(20).max(900),
  confidence: ConfidenceSchema,
});
export type StrategyReview = z.infer<typeof StrategyReviewSchema>;

// ── section draft (BEACON 500 item 55 - outline-to-draft pipeline) ───────────
// One drafted section of a full-page walk. NOT part of the shared `base` set:
// a section carries its OWN lightweight sources list (not the heavier
// evidenceRefs/confidence/risks/operatorSteps shape) because it is one small
// unit in a sequential walk, not a standalone Move draft. `containsNumber` lets
// the assembler know at a glance which sections carry a verified figure.

export const SectionSourceSchema = z.object({
  kind: z.enum(["own_data", "competitor_observation", "fanout_question", "keyword"]),
  detail: z.string().min(1).max(300),
});
export type SectionSource = z.infer<typeof SectionSourceSchema>;

export const SectionDraftSchema = z.object({
  heading: z.string().min(2).max(160),
  body: z.string().min(40).max(1200),
  /** At least one source — a section with zero grounding is rejected by validation. */
  sources: z.array(SectionSourceSchema).min(1).max(6),
  containsNumber: z.boolean(),
});
export type SectionDraft = z.infer<typeof SectionDraftSchema>;

// ── outreach pitch (BEACON_500 item 57 - get-cited/link-reclaim pitches) ─────
// A cold-outreach email pitch for ONE lead. NOT part of the shared `base` set:
// an outreach pitch is a short email, not a Move draft, so it skips proofPlan
// and operatorSteps but keeps evidenceRefs (the personalization must be real)
// and confidence. subject/body length caps keep it a real, sendable email.

export const OutreachPitchSchema = z.object({
  subject: z.string().min(4).max(80),
  body: z.string().min(40).max(900),
  evidenceRefs: z.array(EvidenceRefSchema).min(1),
  confidence: ConfidenceSchema,
  risks: z.array(z.string().min(1)).max(8).default([]),
});
export type OutreachPitch = z.infer<typeof OutreachPitchSchema>;

// ── registry: kind → schema (the structured-drafter dispatches on this) ──────

export type StructuredDraftKind =
  | "answer_block"
  | "create_page_brief"
  | "atomic_edit"
  | "tool_asset"
  | "commerce_asset"
  | "cro_fix"
  | "internal_link"
  | "experiment_plan"
  | "aeo_prompt_brief"
  | "team_verdict"
  | "batch_adjudication"
  | "strategy_review"
  | "section_draft"
  | "outreach_pitch";

export const SCHEMA_BY_KIND = {
  answer_block: AnswerBlockDraftSchema,
  create_page_brief: CreatePageBriefSchema,
  atomic_edit: AtomicEditDraftSchema,
  tool_asset: ToolAssetSpecSchema,
  commerce_asset: CommerceAssetSpecSchema,
  cro_fix: CROFixSpecSchema,
  internal_link: InternalLinkDraftSchema,
  experiment_plan: ExperimentPlanSchema,
  aeo_prompt_brief: AeoPromptBriefSchema,
  team_verdict: TeamVerdictSchema,
  batch_adjudication: BatchAdjudicationSchema,
  strategy_review: StrategyReviewSchema,
  section_draft: SectionDraftSchema,
  outreach_pitch: OutreachPitchSchema,
} as const satisfies Record<StructuredDraftKind, z.ZodTypeAny>;

// ── R16 (P6 LLM engine pack): the FULL output-shape registry ─────────────────
// Every structured LLM output shape used ANYWHERE in the product, as a named
// entry - including the shapes whose production parsers are hand-rolled and
// pinned (judge, strategist, critic, SERP hypothesis) and the deterministic
// title-lab variants. The gateway (callStructuredLLM) dispatches on
// SCHEMA_BY_KIND above (validate -> retry once -> fail closed); the extra
// entries below are the canonical contract each hand-rolled parser must keep
// producing, pinned by tests/llm-regression/schema-registry.test.ts (every
// entry must parse its recorded fixture).
//
// NOT here by design: the specific-edit bundle (providers/openai.ts) - its
// schema is PACKET-DERIVED (actionType/targetUrl enums are built per request),
// so a static entry cannot represent it; it is pinned instead by
// tests/contracts/openai-structured-response.contract.test.ts.

/** FAQ Q/A pairs (llm-answer-block's FAQPage JSON-LD generator). */
export const FaqPairsSchema = z.object({
  pairs: z.array(z.object({ q: z.string().min(3).max(300), a: z.string().min(3).max(1200) })).min(1).max(8),
});
export type FaqPairs = z.infer<typeof FaqPairsSchema>;

/** CTR Title Lab variants (demand-graph/ctr-title-scorer.ts - deterministic today,
 *  registered so any future LLM-generated variant list validates the same shape). */
export const TitleVariantsSchema = z.object({
  variants: z
    .array(
      z.object({
        title: z.string().min(3).max(200),
        score: z.number(),
        signals: z.array(z.string().min(1).max(120)).max(12).default([]),
        strategy: z.string().min(1).max(60).optional(),
        reason: z.string().min(1).max(300).optional(),
      }),
    )
    .min(1)
    .max(12),
});
export type TitleVariants = z.infer<typeof TitleVariantsSchema>;

/** Page Surgeon judge verdict (llm-judge.ts raw JSON contract; the hand-rolled
 *  sanitize() + the deterministic gate remain the runtime authority). */
const JudgeChangeSchema = z.object({
  action: z.string().min(1).max(40),
  exact_change: z.string().max(4000).default(""),
  evidence: z.string().max(2000).default(""),
  hypothesis: z.string().max(1000).default(""),
  risk: z.string().max(1000).default(""),
  before_after: z
    .object({ before: z.string().nullable().default(null), after: z.string().nullable().default(null) })
    .default({ before: null, after: null }),
  measurement: z.string().max(1000).default(""),
  rollback: z.string().max(1000).default(""),
  dependency_order: z.number().int().default(1),
  artifact_text: z.string().max(6000).nullable().default(null),
  faq_items: z
    .array(z.object({ question: z.string().min(1), answer: z.string().min(1) }))
    .nullable()
    .default(null),
});
export const JudgeVerdictSchema = z.object({
  diagnosis: z.object({
    bottleneck: z.string().min(1).max(1000),
    evidence: z.string().max(2000).default(""),
    ruled_out: z.string().max(2000).default(""),
  }),
  recommended_atomic_action: z.string().min(1).max(40),
  primary_atomic_change: JudgeChangeSchema.nullable(),
  supporting_atomic_changes: z.array(JudgeChangeSchema).max(12).default([]),
  rejected_changes: z.array(z.object({ action: z.string(), reason: z.string() })).max(20).default([]),
  wording_research: z
    .array(z.object({ variant: z.string(), evidence: z.string().default(""), best_placement: z.string().default("") }))
    .max(20)
    .default([]),
  confidence: z.enum(["high", "medium", "low", "needs_more_evidence"]),
  operator_insight: z.string().max(2000).default(""),
  what_normal_seo_misses: z.string().max(2000).default(""),
  why_not_just_title: z.string().max(2000).default(""),
});
export type JudgeVerdict = z.infer<typeof JudgeVerdictSchema>;

/** Expert strategist take (llm-expert-strategist.ts raw JSON contract). */
export const StrategistTakeSchema = z.object({
  opportunity_summary: z.string().min(1).max(1000),
  why_this_now: z.string().min(1).max(1000),
  best_action: z.string().min(1).max(1000),
  alternatives_considered: z.array(z.string().min(1).max(500)).max(8).default([]),
  why_not_alternatives: z.array(z.string().min(1).max(500)).max(8).default([]),
  expected_outcome: z.string().min(1).max(1000),
  risk_level: z.enum(["low", "medium", "high"]),
  risks: z.array(z.string().min(1).max(500)).max(8).default([]),
});
export type StrategistTake = z.infer<typeof StrategistTakeSchema>;

/** Adversarial critic review (llm-expert-strategist.ts critic pass contract). */
export const CriticReviewSchema = z.object({
  critic_verdict: z.enum(["approve", "lower_confidence", "needs_more_evidence", "reject"]),
  confidence_ceiling: z.enum(["high", "medium", "low", "needs_more_evidence", "rejected"]),
  unsupported_claims: z.array(z.string()).max(10).default([]),
  evidence_gaps: z.array(z.string()).max(10).default([]),
  query_page_mismatch_risks: z.array(z.string()).max(10).default([]),
  copy_risks: z.array(z.string()).max(10).default([]),
  publishing_risks: z.array(z.string()).max(10).default([]),
  factual_risks: z.array(z.string()).max(10).default([]),
  what_would_make_this_high_confidence: z.array(z.string()).max(10).default([]),
  human_review_note: z.string().max(1000).default(""),
});
export type CriticReviewShape = z.infer<typeof CriticReviewSchema>;

/** Synthetic SERP hypothesis (page-surgeon/serp-hypothesis.ts raw JSON contract). */
export const SerpHypothesisSchema = z.object({
  queries: z
    .array(
      z.object({
        query: z.string().min(1).max(300),
        likely_features: z.array(z.string().min(1).max(40)).max(10).default([]),
        feature_likely_owns_answer: z.boolean(),
        click_loss_cause: z.string().max(500).default(""),
        confidence: z.enum(["low", "medium"]),
        rationale: z.string().max(500).default(""),
        recommended_check: z.string().max(500).default(""),
      }),
    )
    .min(1)
    .max(10),
  overall: z.object({
    feature_likely_owns_answer: z.boolean(),
    summary: z.string().max(1000).default(""),
  }),
});
export type SerpHypothesisShape = z.infer<typeof SerpHypothesisSchema>;

/** The complete named registry: every structured LLM output shape in the product.
 *  tests/llm-regression/schema-registry.test.ts requires a parsed fixture per entry. */
export const LLM_OUTPUT_SCHEMAS = {
  ...SCHEMA_BY_KIND,
  faq_pairs: FaqPairsSchema,
  title_variants: TitleVariantsSchema,
  judge_verdict: JudgeVerdictSchema,
  strategist_take: StrategistTakeSchema,
  critic_review: CriticReviewSchema,
  serp_hypothesis: SerpHypothesisSchema,
} as const;
export type LlmOutputSchemaName = keyof typeof LLM_OUTPUT_SCHEMAS;

/** Every CUSTOMER-FACING PROSE string in a parsed draft, flattened - fed to the
 *  content firewalls (numeric-fidelity / placeholder / em-dash / superlative) at
 *  the ONE call site that runs them, generation time in structured-drafter.ts's
 *  `callStructuredLLM` (there is no second, later re-scan - this helper's scope
 *  IS the firewall's scope, so a key skipped here is skipped everywhere). Three
 *  kinds of field are deliberately EXCLUDED because they are not prose an
 *  operator ever pastes onto their site:
 *   - `sources`: machine-emitted citation METADATA (retrievedAt, url, finalUrl,
 *     contentHash, domain, claim) - re-stamped by source-authority.ts and
 *     verified against the real fetched page by the drafter's source-
 *     verification step. Scanning it made the firewall reject a whole draft for
 *     the digits of a citation's own retrievedAt date ("2026-07-11" -> "07,11")
 *     that the product's own prompt told the model to emit.
 *   - `proofPlan`: the MEASUREMENT METHODOLOGY the product's own prompt asks the
 *     model to write ("measure clicks over a 7/14/28-day window, target a
 *     stated lift") - an aspirational target/method description, not a factual
 *     claim about the world that needs grounding. Pilot loop 6 (2026-07-11)
 *     found BOTH live attempt-1s dying on the model's own `proofPlan.metrics`
 *     text ("target 100%") - a false reject of a field the product itself
 *     instructed the model to fill in, not an invented customer-facing fact.
 *   - `operatorSteps` / `risks`: procedural implementation instructions and
 *     internal caution notes addressed TO the operator ("Add this answer block
 *     directly under the H1", "keep claims neutral") - never copy the operator
 *     publishes verbatim.
 *  `evidenceRefs.detail` stays SCANNED on purpose (unchanged): it is the
 *  model's own description of REAL grounding data (a GSC/GA4/Clarity/Profound/
 *  ... signal Beacon already retrieved) - an invented number there means the
 *  model fabricated its OWN evidence, exactly the case this firewall exists to
 *  catch, not methodology the product asked it to write.
 *  The grounded-number ledger is unchanged, so a fabricated number IN PROSE -
 *  including one that also happens to appear inside the now-excluded proofPlan/
 *  operatorSteps/risks text - still fails: those fields are never added to the
 *  ledger, so they can never launder an invented prose number as "grounded". */
export function draftProseStringValues(value: unknown): string[] {
  // Non-prose methodology/procedural keys, skipped at every object level (see
  // the doc comment above for the one-line reason each is excluded).
  const NON_PROSE_KEYS = new Set(["sources", "proofPlan", "operatorSteps", "risks"]);
  const out: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === "string") out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        if (NON_PROSE_KEYS.has(k)) continue;
        walk(val);
      }
    }
  };
  walk(value);
  return out;
}
