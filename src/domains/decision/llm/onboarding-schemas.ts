/**
 * llm/onboarding-schemas (Slice 5, 2026-07-24) - the three strict kinds the
 * onboarding flow uses. Kept in their own file so the frozen schemas.ts stays
 * within its size ceiling; SCHEMA_BY_KIND imports them for dispatch.
 *
 * All three go through callStructuredLLM (validate -> fail closed) with
 * budgetPlatform 'onboarding-openai' (the $2 pre-activation lifetime cap). The
 * MODEL can never touch identity, provenance, domain, status, cost, or
 * authorization: those fields are not representable here, and the onboarding
 * facade also server-checks the allowed set. PURE - validators only, no I/O.
 */

import { z } from "zod";

/** The business type the model classifies the site as (mirrors BusinessType). */
const OnboardingBusinessTypeEnum = z.enum([
  "local_service",
  "content_publisher",
  "ecommerce",
  "saas",
  "other",
]);

/** The seven intent families every core-prompt set must cover. */
const PromptIntentEnum = z.enum([
  "category",
  "problem",
  "comparison",
  "commercial",
  "factual",
  "trust",
  "brand",
]);

/** 1. business_profile_inference - the first structured read of a site from its
 *  crawl facts. Flat, editable fields only; `sourceUrls` is server-validated to
 *  the URLs actually supplied in the request (any outside URL is stripped). */
export const BusinessProfileInferenceSchema = z.object({
  name: z.string().min(1).max(160),
  businessType: OnboardingBusinessTypeEnum,
  siteArchetype: z.string().min(1).max(120).nullable().default(null),
  offerings: z.array(z.string().min(1).max(160)).max(40).default([]),
  audiences: z.array(z.string().min(1).max(160)).max(40).default([]),
  customerProblems: z.array(z.string().min(1).max(220)).max(40).default([]),
  geographicScope: z.array(z.string().min(1).max(120)).max(40).default([]),
  differentiators: z.array(z.string().min(1).max(220)).max(40).default([]),
  trustClaims: z.array(z.string().min(1).max(220)).max(40).default([]),
  topicsToOwn: z.array(z.string().min(1).max(160)).max(60).default([]),
  topicsToExclude: z.array(z.string().min(1).max(160)).max(40).default([]),
  importantPages: z.array(z.string().min(1).max(500)).max(40).default([]),
  confidence: z.number().min(0).max(1),
  sourceUrls: z.array(z.string().min(1).max(500)).max(60).default([]),
});

/** Editable string-array constraint buckets a natural-language patch may touch. */
const OnboardingConstraintsSchema = z.object({
  factual: z.array(z.string().min(1).max(220)).max(20).default([]),
  legal: z.array(z.string().min(1).max(220)).max(20).default([]),
  brand: z.array(z.string().min(1).max(220)).max(20).default([]),
  editorial: z.array(z.string().min(1).max(220)).max(20).default([]),
  bannedTerms: z.array(z.string().min(1).max(120)).max(40).default([]),
});

/** 2. business_profile_patch - a natural-language edit turned into a strict patch.
 *  Every field is nullable: null means "leave this field unchanged". Only the
 *  editable business fields are representable; identity/provenance/domain/status
 *  are absent by construction (and the facade re-checks the whitelist). */
export const BusinessProfilePatchSchema = z.object({
  changeSummary: z.string().min(3).max(400),
  name: z.string().min(1).max(160).nullable().default(null),
  businessType: OnboardingBusinessTypeEnum.nullable().default(null),
  siteArchetype: z.string().min(1).max(120).nullable().default(null),
  offerings: z.array(z.string().min(1).max(160)).max(40).nullable().default(null),
  audiences: z.array(z.string().min(1).max(160)).max(40).nullable().default(null),
  customerProblems: z.array(z.string().min(1).max(220)).max(40).nullable().default(null),
  geographicScope: z.array(z.string().min(1).max(120)).max(40).nullable().default(null),
  differentiators: z.array(z.string().min(1).max(220)).max(40).nullable().default(null),
  trustClaims: z.array(z.string().min(1).max(220)).max(40).nullable().default(null),
  topicsToOwn: z.array(z.string().min(1).max(160)).max(60).nullable().default(null),
  topicsToExclude: z.array(z.string().min(1).max(160)).max(40).nullable().default(null),
  constraints: OnboardingConstraintsSchema.nullable().default(null),
  trustedSourceDomains: z.array(z.string().min(1).max(160)).max(40).nullable().default(null),
  competitors: z.array(z.string().min(1).max(160)).max(30).nullable().default(null),
});

/** 3. prompt_candidates - the broad candidate universe organized into topic
 *  groups. The facade dedupes, validates counts, and trims/promotes to EXACTLY
 *  50 recommended before persisting inactive tracked-prompt rows. */
export const PromptCandidatesSchema = z.object({
  groups: z
    .array(
      z.object({
        slug: z.string().min(1).max(60),
        name: z.string().min(1).max(120),
        intent: PromptIntentEnum,
        prompts: z
          .array(
            z.object({
              text: z.string().min(4).max(300),
              recommended: z.boolean(),
            }),
          )
          .min(1)
          .max(40),
      }),
    )
    .min(3)
    .max(12),
});
