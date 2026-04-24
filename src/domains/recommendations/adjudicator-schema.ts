/**
 * JSON schema for the GPT-5-mini adjudicator (Phase v7 Commit 3, 2026-04-23).
 *
 * Passed to OpenAI's strict structured-outputs mode. Strict mode requires:
 *   - `additionalProperties: false` on every object
 *   - Every property listed in `required`
 *   - Enum-constrained strings use the `enum` array
 *   - Conditionally optional fields are modeled as `["type", "null"]` unions
 *     because strict mode doesn't support conditional required lists.
 *
 * The enum for `targetUrl` is NOT defined here — it's filled in per-call
 * from the evidence packet's `allowedTargetUrls`, so the model literally
 * cannot pick a URL outside the allowed list. URL hallucination is
 * structurally impossible.
 *
 * Shape mirrors the AdjudicatorOutput TypeScript type in this module.
 */

import type {
  RecommendationAction,
  RecommendationMotive,
} from "./resolved-types";

// ---------------------------------------------------------------------------
// TypeScript mirror of the schema — what the adjudicator returns.
// ---------------------------------------------------------------------------

export type SuggestedEditType =
  | "new_page"
  | "section"
  | "faq"
  | "heading"
  | "meta_description"
  | "schema_markup"
  | "internal_link";

export type SuggestedEditScope =
  | "above_the_fold"
  | "body"
  | "sidebar"
  | "footer"
  | "metadata";

export type SuggestedEdit = {
  type: SuggestedEditType;
  scope: SuggestedEditScope;
  title: string | null;
  body: string | null;
  why: string;
};

export type PageBrief = {
  recommendedTitle: string;
  recommendedH1: string;
  targetPrompts: string[];
  mustCoverAngles: string[];
  competitorAnglesToCounter: string[];
  internalLinksToAdd: string[];
};

export type AdjudicatorEvidenceRef =
  | { type: "prompt"; id: string }
  | { type: "url"; url: string }
  | { type: "competitor"; name: string };

export type AdjudicatorOutput = {
  finalAction: RecommendationAction;
  primaryMotive: RecommendationMotive;
  /** Either a URL from allowedTargetUrls or the "needs_new_page" sentinel. */
  targetUrl: string;
  confidence: "high" | "medium" | "low";
  confidenceReason: string;
  needsHumanReview: boolean;
  operatorTitle: string;
  why: string;
  specificRecommendation: string;
  suggestedEdits: SuggestedEdit[];
  /** Required when `finalAction` is "create_new_page" or major "expand_existing_page". Null otherwise. */
  pageBrief: PageBrief | null;
  /** Required when `finalAction === "create_new_page"`. Null otherwise. */
  proposedSlug: string | null;
  evidenceRefs: AdjudicatorEvidenceRef[];
  risks: string[];
  /** Required when `finalAction === "merge_or_dedupe"`. Null otherwise. */
  mergeWithUrls: string[] | null;
  /** Required when `finalAction` is "needs_review" or "watch". Null otherwise. */
  noActionReason: string | null;
};

// ---------------------------------------------------------------------------
// Schema factory — per-call because targetUrl enum is dynamic.
// ---------------------------------------------------------------------------

const ALLOWED_ACTIONS: ReadonlyArray<RecommendationAction> = [
  "strengthen_existing_page",
  "expand_existing_page",
  "add_section_or_faq",
  "create_new_page",
  "merge_or_dedupe",
  "needs_review",
  "watch",
] as const;

const ALLOWED_MOTIVES: ReadonlyArray<RecommendationMotive> = [
  "counter_competitor",
  "capture_absent_cluster",
  "improve_close_prompt",
  "defend_winning_cluster",
  "resolve_cannibalization",
  "improve_citation_depth",
] as const;

const ALLOWED_EDIT_TYPES: ReadonlyArray<SuggestedEditType> = [
  "new_page",
  "section",
  "faq",
  "heading",
  "meta_description",
  "schema_markup",
  "internal_link",
] as const;

const ALLOWED_EDIT_SCOPES: ReadonlyArray<SuggestedEditScope> = [
  "above_the_fold",
  "body",
  "sidebar",
  "footer",
  "metadata",
] as const;

export function buildAdjudicatorJsonSchema(opts: {
  allowedTargetUrls: ReadonlyArray<string>;
}): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "finalAction",
      "primaryMotive",
      "targetUrl",
      "confidence",
      "confidenceReason",
      "needsHumanReview",
      "operatorTitle",
      "why",
      "specificRecommendation",
      "suggestedEdits",
      "pageBrief",
      "proposedSlug",
      "evidenceRefs",
      "risks",
      "mergeWithUrls",
      "noActionReason",
    ],
    properties: {
      finalAction: { type: "string", enum: [...ALLOWED_ACTIONS] },
      primaryMotive: { type: "string", enum: [...ALLOWED_MOTIVES] },
      targetUrl: { type: "string", enum: [...opts.allowedTargetUrls] },
      confidence: { type: "string", enum: ["high", "medium", "low"] },
      confidenceReason: { type: "string" },
      needsHumanReview: { type: "boolean" },
      operatorTitle: { type: "string" },
      why: { type: "string" },
      specificRecommendation: { type: "string" },
      suggestedEdits: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["type", "scope", "title", "body", "why"],
          properties: {
            type: { type: "string", enum: [...ALLOWED_EDIT_TYPES] },
            scope: { type: "string", enum: [...ALLOWED_EDIT_SCOPES] },
            title: { type: ["string", "null"] },
            body: { type: ["string", "null"] },
            why: { type: "string" },
          },
        },
      },
      pageBrief: {
        anyOf: [
          { type: "null" },
          {
            type: "object",
            additionalProperties: false,
            required: [
              "recommendedTitle",
              "recommendedH1",
              "targetPrompts",
              "mustCoverAngles",
              "competitorAnglesToCounter",
              "internalLinksToAdd",
            ],
            properties: {
              recommendedTitle: { type: "string" },
              recommendedH1: { type: "string" },
              targetPrompts: { type: "array", items: { type: "string" } },
              mustCoverAngles: { type: "array", items: { type: "string" } },
              competitorAnglesToCounter: {
                type: "array",
                items: { type: "string" },
              },
              internalLinksToAdd: { type: "array", items: { type: "string" } },
            },
          },
        ],
      },
      proposedSlug: { type: ["string", "null"] },
      evidenceRefs: {
        type: "array",
        items: {
          anyOf: [
            {
              type: "object",
              additionalProperties: false,
              required: ["type", "id"],
              properties: {
                type: { type: "string", enum: ["prompt"] },
                id: { type: "string" },
              },
            },
            {
              type: "object",
              additionalProperties: false,
              required: ["type", "url"],
              properties: {
                type: { type: "string", enum: ["url"] },
                url: { type: "string" },
              },
            },
            {
              type: "object",
              additionalProperties: false,
              required: ["type", "name"],
              properties: {
                type: { type: "string", enum: ["competitor"] },
                name: { type: "string" },
              },
            },
          ],
        },
      },
      risks: { type: "array", items: { type: "string" } },
      mergeWithUrls: {
        anyOf: [
          { type: "null" },
          { type: "array", items: { type: "string" } },
        ],
      },
      noActionReason: { type: ["string", "null"] },
    },
  };
}
