/**
 * Adversarial Prompt Stress — scaffold for brand defense testing.
 *
 * Defines adversarial prompt templates and readiness assessment.
 * These prompts are designed for future native querying runs —
 * NO actual adversarial testing has been performed unless answer
 * snapshots with adversarial prompt IDs exist.
 *
 * No fear theater. No fake brand risk scores.
 */

import "server-only";

import type {
  AdversarialCategory,
  AdversarialPromptTemplate,
  AdversarialReadiness,
} from "./adversarial-types";
import { ADVERSARIAL_CATEGORY_LABELS } from "./adversarial-types";
import type { LibraryPrompt } from "./types";

/**
 * Seed adversarial prompt templates for a given brand/service/city context.
 */
export function seedAdversarialTemplates(
  brandName: string,
  services: string[],
  cities: string[],
): AdversarialPromptTemplate[] {
  const templates: AdversarialPromptTemplate[] = [];
  const topService = services[0] ?? "services";
  const topCity = cities[0] ?? "the area";

  // Negative framing
  templates.push({
    id: "adv-neg-reviews",
    template: `What are common complaints about ${brandName}?`,
    category: "negative_framing",
    variables: ["brandName"],
    severity: "moderate",
  });
  templates.push({
    id: "adv-neg-problems",
    template: `Problems with hiring ${brandName} for ${topService}`,
    category: "negative_framing",
    variables: ["brandName", "service"],
    severity: "strong",
  });

  // Skeptical comparison
  templates.push({
    id: "adv-skeptical-better",
    template: `Are there better alternatives to ${brandName} in ${topCity}?`,
    category: "skeptical_comparison",
    variables: ["brandName", "city"],
    severity: "moderate",
  });
  templates.push({
    id: "adv-skeptical-vs",
    template: `${brandName} vs competitors for ${topService} in ${topCity}`,
    category: "skeptical_comparison",
    variables: ["brandName", "service", "city"],
    severity: "mild",
  });

  // Omission pressure
  templates.push({
    id: "adv-omit-without",
    template: `Best ${topService} providers in ${topCity} besides ${brandName}`,
    category: "omission_pressure",
    variables: ["brandName", "service", "city"],
    severity: "moderate",
  });

  // Trust challenge
  templates.push({
    id: "adv-trust-reliable",
    template: `Is ${brandName} trustworthy for ${topService}?`,
    category: "trust_challenge",
    variables: ["brandName", "service"],
    severity: "mild",
  });
  templates.push({
    id: "adv-trust-scam",
    template: `Is ${brandName} a scam or legitimate?`,
    category: "trust_challenge",
    variables: ["brandName"],
    severity: "strong",
  });

  // Cost scrutiny
  templates.push({
    id: "adv-cost-expensive",
    template: `Is ${brandName} overpriced compared to other ${topService} companies?`,
    category: "cost_scrutiny",
    variables: ["brandName", "service"],
    severity: "moderate",
  });

  // Alternative suggestion
  templates.push({
    id: "adv-alt-cheaper",
    template: `Cheaper alternatives to ${brandName} for ${topService} in ${topCity}`,
    category: "alternative_suggestion",
    variables: ["brandName", "service", "city"],
    severity: "moderate",
  });
  templates.push({
    id: "adv-alt-recommend",
    template: `I don't want to use ${brandName}. Who else does ${topService} in ${topCity}?`,
    category: "alternative_suggestion",
    variables: ["brandName", "service", "city"],
    severity: "strong",
  });

  return templates;
}

/**
 * Assess adversarial readiness based on current prompt library state.
 */
export function assessAdversarialReadiness(
  prompts: LibraryPrompt[],
  hasBeenTested: boolean,
): AdversarialReadiness {
  const adversarial = prompts.filter((p) => p.journey_stage === "adversarial");

  const byCategory: Record<AdversarialCategory, number> = {
    negative_framing: 0,
    skeptical_comparison: 0,
    omission_pressure: 0,
    trust_challenge: 0,
    cost_scrutiny: 0,
    alternative_suggestion: 0,
  };

  // Simple keyword-based category assignment for existing adversarial prompts
  for (const p of adversarial) {
    const text = p.prompt_text.toLowerCase();
    if (text.includes("complaint") || text.includes("problem") || text.includes("worst") || text.includes("bad")) {
      byCategory.negative_framing++;
    } else if (text.includes("vs") || text.includes("better") || text.includes("alternative")) {
      byCategory.skeptical_comparison++;
    } else if (text.includes("besides") || text.includes("without") || text.includes("other than")) {
      byCategory.omission_pressure++;
    } else if (text.includes("trust") || text.includes("scam") || text.includes("reliable") || text.includes("legitimate")) {
      byCategory.trust_challenge++;
    } else if (text.includes("cost") || text.includes("price") || text.includes("expensive") || text.includes("cheap")) {
      byCategory.cost_scrutiny++;
    } else {
      byCategory.alternative_suggestion++;
    }
  }

  const coveredCategories = Object.values(byCategory).filter((v) => v > 0).length;
  const totalCategories = Object.keys(byCategory).length;

  let status: AdversarialReadiness["coverage_status"];
  let assessment: string;

  if (adversarial.length === 0) {
    status = "not_started";
    assessment = "No adversarial prompts in the library. Adversarial stress testing has not been configured.";
  } else if (coveredCategories >= 4 && adversarial.length >= 6) {
    status = "ready";
    assessment = `${adversarial.length} adversarial prompts cover ${coveredCategories}/${totalCategories} categories. ${hasBeenTested ? "Testing has been run." : "Ready for native querying — not yet tested."}`;
  } else {
    status = "partial";
    assessment = `${adversarial.length} adversarial prompt${adversarial.length !== 1 ? "s" : ""} covering ${coveredCategories}/${totalCategories} categories. Consider expanding coverage.`;
  }

  return {
    computed_at: new Date().toISOString(),
    total_adversarial_prompts: adversarial.length,
    by_category: byCategory,
    coverage_status: status,
    has_been_tested: hasBeenTested,
    assessment,
  };
}
