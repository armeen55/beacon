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

export function buildSummarySentence(args: {
  outranked: number;
  absent: number;
  close: number;
  winning: number;
  early: number;
  total: number;
}): string {
  const { outranked, absent, close, winning, early, total } = args;
  const weak = outranked + absent;
  if (total === 0) return "No prompts tracked yet.";
  if (winning > 0 && weak === 0) {
    return `Winning on ${winning} of ${total} tracked prompts.`;
  }
  if (weak > 0 && winning > 0) {
    return `Winning ${winning}, ${weak === 1 ? "weak on 1 prompt" : `weak on ${weak}`}${close > 0 ? ` · ${close} close to breaking through` : ""}.`;
  }
  if (weak > 0) {
    return `Weak on ${weak} of ${total} tracked prompts${close > 0 ? ` · ${close} close to breaking through` : ""}.`;
  }
  if (early === total) {
    return `Too early to judge. The next AI reading will add data.`;
  }
  return `${winning} winning, ${close} close, ${absent} absent, ${outranked} outranked.`;
}
