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
import { BusinessProfileInferenceSchema, BusinessProfilePatchSchema, PromptCandidatesSchema } from "./onboarding-schemas";

// ── shared building blocks ──────────────────────────────────────────────────

/** Where a claim is grounded — points at a real signal/source the team read.
 *  `source` mirrors the EvidenceRef sources used by the specialist layer. */
export const EvidenceRefSchema = z.object({
  source: z.enum(["gsc", "ga4", "clarity", "dataforseo", "competitor_teardown", "owned_snapshot", "fanout"]),
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

/** 2. AtomicEditDraft — one precise field change on an existing page. */
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

// ── team verdict (FINAL PREMIUM PLAN item 25) ───────────────────────────────── The strategist's one-paragraph
// synthesis of the specialist debate for a nightly pick. Grounded in the REAL voices (claims carry the numbers); the
// numeric firewall blocks any figure that is not in the grounding. Short, opinionated, operator language.

// ── batch adjudication (BEACON 500 item 12 - the final review) ──────────────── The nightly FINAL REVIEW over the
// whole plan preview: one bounded call sanity-checks EVERY pick against its own evidence ("does the proposed text
// match what the top search actually asks for?"). Output is per-pick verdicts ONLY - the review can flag a pick with
// a one-line caution, it can never drop or reorder picks. The concern line is operator copy: plain language, <= 140
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

// ── strategy review (BEACON 500 item 51 - the weekly reallocation memo) ─────── One Sunday-night LLM pass over the
// week's settled dossier proposes a lever mix (relative weight per actionFamily) and up to 3 page-family focus
// targets for the COMING week, plus a short signed memo explaining the change. The LLM PROPOSES; the caller
// (apply-mix.ts / run-strategy-review.ts) deterministically CLAMPS every weight to [0.5, 2.0], drops any family it
// does not recognize, and strips dashes. A failure here means no change this week (fail-open to the previous mix) -
// this schema only bounds the SHAPE, never the trust decision.

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

// ── section draft (BEACON 500 item 55 - outline-to-draft pipeline) ─────────── One drafted section of a full-page
// walk. NOT part of the shared `base` set: a section carries its OWN lightweight sources list (not the heavier
// evidenceRefs/confidence/risks/operatorSteps shape) because it is one small unit in a sequential walk, not a
// standalone Move draft. `containsNumber` lets the assembler know at a glance which sections carry a verified figure.

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

// ── outreach pitch (BEACON_500 item 57 - get-cited/link-reclaim pitches) ───── A cold-outreach email pitch for ONE
// lead. NOT part of the shared `base` set: an outreach pitch is a short email, not a Move draft, so it skips
// proofPlan and operatorSteps but keeps evidenceRefs (the personalization must be real) and confidence. subject/body
// length caps keep it a real, sendable email.

export const OutreachPitchSchema = z.object({
  subject: z.string().min(4).max(80),
  body: z.string().min(40).max(900),
  evidenceRefs: z.array(EvidenceRefSchema).min(1),
  confidence: ConfidenceSchema,
  risks: z.array(z.string().min(1)).max(8).default([]),
});
export type OutreachPitch = z.infer<typeof OutreachPitchSchema>;

// ── coverage adjudication (N3b, 2026-07-28) ───────────────────────────────── ONE verdict on whether this account
// ALREADY has the right page for a topic it researched. The model COMPARES the owned pages the caller supplied and
// picks a verdict; it may not invent a page, a metric, a keyword or a competitor, and it may not write copy: no field
// here can carry a title, a description, an outline or a proposed address, so a drafted page is not representable.
// `ownedUrls` and `evidenceKeys` are re-checked against the caller's allowlist AFTER validation, so one unknown id
// refuses the whole call rather than shipping half of it.

export const CoverageAdjudicationSchema = z.object({
  verdict: z.enum(["improve_existing", "create_new", "consolidate_or_choose", "do_nothing", "research_needed"]),
  /** Owned addresses the verdict names, echoed EXACTLY from the supplied list. */
  ownedUrls: z.array(z.string().min(1).max(500)).max(8),
  /** Evidence ids the verdict rests on, echoed EXACTLY from the supplied list. */
  evidenceKeys: z.array(z.string().min(1).max(60)).min(1).max(24),
  alternativesRuledOut: z.array(z.object({
    alternative: z.string().min(1).max(160),
    reason: z.string().min(1).max(400),
  })).min(1).max(5),
  /** One plain first-person sentence the operator reads. Never page copy. */
  explanation: z.string().min(20).max(400),
});
export type CoverageAdjudication = z.infer<typeof CoverageAdjudicationSchema>;

// ── new page brief (N4, 2026-07-28) ───────────────────────────────────────── The ONE call a verdict of create_new
// may make, AFTER the comparison earned it. The model writes the page's words and its section plan; it may not decide
// THAT the page should exist, and no field here can carry a shape or an intent. Every address, question and evidence
// id is echoed from the caller's lists and re-checked after.

export const NewPageBriefSchema = z.object({
  proposedTitle: z.string().min(10).max(120),
  metaDescription: z.string().min(40).max(200),
  /** The answer a searcher gets in the first paragraph, before anything else. */
  openingAnswer: z.string().min(60).max(800),
  /** Evidence ids, copied EXACTLY from the supplied list, that the title, description and
   *  opening answer rest on. One generic set stapled on afterwards proved none of them. */
  headKeys: z.array(z.string().min(1).max(40)).min(1).max(8),
  /** Why the pages this account already owns cannot carry this. Must name one of them. */
  whyExistingPagesLose: z.string().min(20).max(500),
  sections: z.array(z.object({
    heading: z.string().min(3).max(120),
    covers: z.string().min(20).max(400),
    /** Evidence ids copied EXACTLY from the supplied list. */
    evidenceKeys: z.array(z.string().min(1).max(40)).min(1).max(8),
  })).min(3).max(8),
  /** What the writer must cite, and what must be checked before this goes live. */
  sourceRequirements: z.array(z.string().min(10).max(240)).max(6),

  factRequirements: z.array(z.string().min(10).max(240)).max(6),
  /** Addresses and questions copied EXACTLY from the supplied OWN PAGES and OBSERVED QUESTIONS lists. */
  internalLinks: z.array(z.object({ url: z.string().min(1).max(300), anchor: z.string().min(2).max(120) })).max(4),
  faqQuestions: z.array(z.string().min(5).max(200)).max(6),
});
export type NewPageBrief = z.infer<typeof NewPageBriefSchema>;

// ── answer analysis (V1 Truth Convergence Phase 1, 2026-07-31) ────────────── What one AI engine's answer to one
// tracked question ACTUALLY said. The model here is a READER, never an author: every claim carries the answer's own
// wording, every entity and competitor is one the answer named, and no URL, number, ranking or fact may appear that
// the answer text does not contain. Nothing in this shape is ever published; it is the evidence a later decision
// reads. `position` is an ORDINAL within the answer (1 = named first), never a search rank.
export const AnswerAnalysisSchema = z.object({
  sections: z.array(z.object({ heading: z.string().min(1).max(200), covers: z.string().min(1).max(600) })).max(12),
  /** Each claim restated in the ANSWER'S OWN WORDING, plus what it is about. */
  claims: z.array(z.object({ subject: z.string().min(1).max(160), text: z.string().min(1).max(400) })).max(24),
  topicEntities: z.array(z.string().min(1).max(120)).max(30),
  /** Was the account's own brand named, where in the answer, and in what light. */
  ownedBrandMention: z.object({ mentioned: z.boolean(), position: z.number().int().min(1).max(100).nullable(), context: z.string().max(400).nullable() }),
  competitors: z.array(z.object({ name: z.string().min(1).max(160), position: z.number().int().min(1).max(100).nullable() })).max(20),
  contentTypesRecommended: z.array(z.string().min(1).max(80)).max(12),
  questionsAnswered: z.array(z.string().min(1).max(300)).max(15),
  /** What this answer leaves a reader still not knowing. Named, never invented. */
  materialOmissions: z.array(z.string().min(1).max(300)).max(10),
  caveats: z.array(z.string().min(1).max(300)).max(10),
});
export type AnswerAnalysis = z.infer<typeof AnswerAnalysisSchema>;
// ── case synthesis (V1 Truth Convergence Phase 2, 2026-07-31): the SEMANTIC read over the grouping the deterministic
// pass already made ── The model may only merge, split, link or nest cases the caller supplied, by the ids and
// addresses it was handed. It mints no id and invents no address, number or observation, and REPORTS a conflict in
// `reason` rather than resolving it. Advisory: one unknown id refuses it all, and the registry stands.
const CaseSynthesisSchema = z.object({ merges: z.array(z.object({ keepId: z.string().min(1).max(60), absorbIds: z.array(z.string().min(1).max(60)).min(1).max(4), reason: z.string().min(1).max(300) })).max(6), splits: z.array(z.object({ fromId: z.string().min(1).max(60), moveQueries: z.array(z.string().min(1).max(200)).min(1).max(12), reason: z.string().min(1).max(300) })).max(3), pageLinks: z.array(z.object({ caseId: z.string().min(1).max(60), url: z.string().min(1).max(500), relation: z.enum(["covers", "partially_covers", "does_not_cover"]), reason: z.string().min(1).max(300) })).max(24), parentOf: z.array(z.object({ parentId: z.string().min(1).max(60), childId: z.string().min(1).max(60) })).max(12) });
export type CaseSynthesis = z.infer<typeof CaseSynthesisSchema>;
// ── winning pattern (V1 Truth Convergence Phase 3, 2026-07-31): what the pages that WIN a search have in
// common ── The model reads bounded FACTS about pages numbered from 0 upward, never their prose. It may cite
// only the numbers it was handed and writes every pattern in its own words. The caller throws the WHOLE reading away on
// any of five: an eight-word run off a supplied line in ANY field, a heading over five words handed back verbatim, a
// section or thing no cited page carries, a gap with no page of mine supplied, or an `archetype` re-voting the shape.
const SeenOnSchema = z.array(z.number().int().min(0).max(11)).min(1).max(12);
const WinningPatternSchema = z.object({
  archetype: z.enum(["informational_guide", "list", "definition", "comparison", "product", "category", "tool", "forum", "mixed", "unknown"]),
  commonHeadings: z.array(z.object({ heading: z.string().min(1).max(160), seenOn: SeenOnSchema })).max(10), commonEntities: z.array(z.object({ entity: z.string().min(1).max(120), seenOn: SeenOnSchema })).max(15),
  questionsAnswered: z.array(z.string().min(1).max(300)).max(10), openingPattern: z.string().max(300), disagreements: z.array(z.string().min(1).max(300)).max(5),
  ownedGaps: z.array(z.object({ gap: z.string().min(1).max(300), seenOn: SeenOnSchema })).max(8), uniqueNotCommon: z.array(z.object({ detail: z.string().min(1).max(300), seenOn: SeenOnSchema })).max(5),
});
export type WinningPatternRead = z.infer<typeof WinningPatternSchema>;
// ── registry: kind → schema (the structured-drafter dispatches on this) ──────

export type StructuredDraftKind =
  | "answer_block"
  | "atomic_edit"
  | "tool_asset"
  | "commerce_asset"
  | "internal_link"
  | "experiment_plan"
  | "batch_adjudication"
  | "strategy_review"
  | "section_draft"
  | "outreach_pitch"
  | "coverage_adjudication" | "new_page_brief" | "answer_analysis" | "case_synthesis" | "winning_pattern"
  | "business_profile_inference" | "business_profile_patch" | "prompt_candidates";

export const SCHEMA_BY_KIND = {
  answer_block: AnswerBlockDraftSchema,
  atomic_edit: AtomicEditDraftSchema,
  tool_asset: ToolAssetSpecSchema,
  commerce_asset: CommerceAssetSpecSchema,
  internal_link: InternalLinkDraftSchema,
  experiment_plan: ExperimentPlanSchema,
  batch_adjudication: BatchAdjudicationSchema,
  strategy_review: StrategyReviewSchema,
  section_draft: SectionDraftSchema,
  outreach_pitch: OutreachPitchSchema,
  coverage_adjudication: CoverageAdjudicationSchema,
  new_page_brief: NewPageBriefSchema,
  answer_analysis: AnswerAnalysisSchema, case_synthesis: CaseSynthesisSchema, winning_pattern: WinningPatternSchema,
  business_profile_inference: BusinessProfileInferenceSchema,
  business_profile_patch: BusinessProfilePatchSchema,
  prompt_candidates: PromptCandidatesSchema,
} as const satisfies Record<StructuredDraftKind, z.ZodTypeAny>;

// ── R16 (P6 LLM engine pack): the FULL output-shape registry ───────────────── Every structured LLM output shape
// used ANYWHERE in the product, as a named entry - including the shapes whose production parsers are hand-rolled and
// pinned (judge, strategist, critic, SERP hypothesis) and the deterministic title-lab variants. The gateway
// (callStructuredLLM) dispatches on SCHEMA_BY_KIND above (validate -> retry once -> fail closed); the extra entries
// below are the canonical contract each hand-rolled parser must keep producing. The recorded-fixture harness that once
// pinned every entry is gone: the gateway's validate-retry-fail-closed path and each consumer's own test hold it now.

/** FAQ Q/A pairs (llm-answer-block's FAQPage JSON-LD generator). */
export const FaqPairsSchema = z.object({
  pairs: z.array(z.object({ q: z.string().min(3).max(300), a: z.string().min(3).max(1200) })).min(1).max(8),
});
export type FaqPairs = z.infer<typeof FaqPairsSchema>;

/** CTR Title Lab variants (demand-graph/ctr-title-scorer.ts - deterministic today,
 *  registered so any future LLM-generated variant list validates the same shape). */
export const TitleVariantsSchema = z.object({
  variants: z.array(z.object({
    title: z.string().min(3).max(200),
    score: z.number(),
    signals: z.array(z.string().min(1).max(120)).max(12).default([]),
    strategy: z.string().min(1).max(60).optional(),
    reason: z.string().min(1).max(300).optional(),
  })).min(1).max(12),
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
  before_after: z.object({ before: z.string().nullable().default(null), after: z.string().nullable().default(null) }).default({ before: null, after: null }),
  measurement: z.string().max(1000).default(""),
  rollback: z.string().max(1000).default(""),
  dependency_order: z.number().int().default(1),
  artifact_text: z.string().max(6000).nullable().default(null),
  faq_items: z.array(z.object({ question: z.string().min(1), answer: z.string().min(1) })).nullable().default(null),
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
  wording_research: z.array(z.object({ variant: z.string(), evidence: z.string().default(""), best_placement: z.string().default("") })).max(20).default([]),
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
  queries: z.array(z.object({
    query: z.string().min(1).max(300),
    likely_features: z.array(z.string().min(1).max(40)).max(10).default([]),
    feature_likely_owns_answer: z.boolean(),
    click_loss_cause: z.string().max(500).default(""),
    confidence: z.enum(["low", "medium"]),
    rationale: z.string().max(500).default(""),
    recommended_check: z.string().max(500).default(""),
  })).min(1).max(10),
  overall: z.object({ feature_likely_owns_answer: z.boolean(), summary: z.string().max(1000).default("") }),
});
export type SerpHypothesisShape = z.infer<typeof SerpHypothesisSchema>;

/** The complete named registry: every structured LLM output shape in the product. It is the one list a reader
 *  can check a hand-rolled parser against; no fixture harness enforces it any more (see the note above). */
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
 *  model's own description of REAL grounding data (a GSC/GA4/Clarity/DataForSEO/
 *  ... signal Beacon already retrieved) - an invented number there means the
 *  model fabricated its OWN evidence, exactly the case this firewall exists to
 *  catch, not methodology the product asked it to write.
 *  The grounded-number ledger is unchanged, so a fabricated number IN PROSE -
 *  including one that also happens to appear inside the now-excluded proofPlan/
 *  operatorSteps/risks text - still fails: those fields are never added to the
 *  ledger, so they can never launder an invented prose number as "grounded". */
export function draftProseStringValues(value: unknown): string[] {
  // Non-prose methodology/procedural keys, skipped at every object level (see the doc comment above for the one-line
  // reason each is excluded). `ownedUrls` and `evidenceKeys` are IDENTIFIERS echoed back from an allowlist, not prose
  // the model wrote. Scanning them meant a real customer address containing the word "best" tripped the superlative
  // firewall and killed the verdict on every pass, forever, at two paid calls a time. A page address cannot make a
  // claim. A case synthesis carries ids, addresses and the operator's own search phrases, all echoed from a supplied
  // list: a page whose address says "best" makes no claim, so it can never kill the reading. Its `reason` stays
  // scanned.
  const NON_PROSE_KEYS = new Set(["sources", "proofPlan", "operatorSteps", "risks", "ownedUrls", "evidenceKeys", "keepId", "absorbIds", "fromId", "caseId", "url", "parentId", "childId", "moveQueries"]);
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
