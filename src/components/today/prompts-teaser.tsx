import type { CategoryGroupSummary } from "@/domains/prompts/decision-matrix";

/**
 * Small Today card that points into /prompts. Per operator guardrail for
 * Phase v5 Commit 5: "small, not a mini dashboard."
 *
 * Shows one-line per-category counts (color-coded), a tight summary
 * sentence, and a single CTA link.
 */

export type PromptsTeaserSummary = {
  totalPrompts: number;
  groupSummaries: CategoryGroupSummary[];
};

// buildSummarySentence removed 2026-07-21 (CORE 100K Lane K): no renderer
// called it; the file survives for the PromptsTeaserSummary type above.
