export type AdversarialCategory =
  | "negative_framing"
  | "skeptical_comparison"
  | "omission_pressure"
  | "trust_challenge"
  | "cost_scrutiny"
  | "alternative_suggestion";

export type AdversarialPromptTemplate = {
  id: string;
  template: string;
  category: AdversarialCategory;
  variables: string[];
  severity: "mild" | "moderate" | "strong";
};

export type AdversarialReadiness = {
  computed_at: string;
  total_adversarial_prompts: number;
  by_category: Record<AdversarialCategory, number>;
  coverage_status: "ready" | "partial" | "not_started";
  has_been_tested: boolean;
  assessment: string;
};

export const ADVERSARIAL_CATEGORY_LABELS: Record<AdversarialCategory, string> = {
  negative_framing: "Negative framing",
  skeptical_comparison: "Skeptical comparison",
  omission_pressure: "Omission pressure",
  trust_challenge: "Trust / reputation",
  cost_scrutiny: "Cost / value scrutiny",
  alternative_suggestion: "Alternative suggestion",
};
