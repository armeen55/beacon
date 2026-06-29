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
    "semrush",
    "competitor_teardown",
    "owned_snapshot",
    "fanout",
  ]),
  detail: z.string().min(1).max(300),
});
export type EvidenceRef = z.infer<typeof EvidenceRefSchema>;

export const ConfidenceSchema = z.enum(["high", "medium", "low"]);

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

/** 1. AnswerBlockDraft — the 40–60 word extractable AEO answer block. */
export const AnswerBlockDraftSchema = z.object({
  answer: z.string().min(120).max(700),
  citationHook: z.string().max(200).nullable().default(null),
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
  | "aeo_prompt_brief";

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
} as const satisfies Record<StructuredDraftKind, z.ZodTypeAny>;

/** Every string field in a parsed draft, flattened — fed to the content firewalls
 *  (numeric-fidelity / placeholder / em-dash / superlative) in the drafter. */
export function draftStringValues(value: unknown): string[] {
  const out: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === "string") out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v as Record<string, unknown>).forEach(walk);
  };
  walk(value);
  return out;
}
