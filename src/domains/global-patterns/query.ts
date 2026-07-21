/**
 * CX4.4 — Pattern query with HARD confidence gates.
 *
 * Every query passes through evaluateConfidenceGate BEFORE returning.
 * Suppressed patterns are NEVER returned — not even to internal
 * consumers. This is a security boundary, not a display preference.
 *
 * Gates:
 *   contributing_tenant_count < 3  → null (suppressed)
 *   contributing_tenant_count < 10 → return with seeded_warning
 *   contributing_tenant_count ≥ 10 → full confidence
 */

import { listGlobalPatterns } from "./store";
import {
  type GlobalPattern,
  type PatternKey,
  type PopulationEvidence,
  patternKeyHash,
  evaluateConfidenceGate,
  CURRENT_TAXONOMY_VERSION,
} from "./contracts";

export type PatternQueryResult = {
  pattern: GlobalPattern;
  evidence: PopulationEvidence;
};

/**
 * Query the global pattern store for a specific key.
 *
 * Returns null when:
 *   - No pattern matches the key
 *   - The matching pattern is suppressed (contributing_tenant_count < 3)
 *   - The pattern's taxonomy version doesn't match current
 *
 * Returns the pattern + a pre-computed PopulationEvidence object when
 * the confidence gate passes.
 */
export async function queryPattern(key: PatternKey): Promise<PatternQueryResult | null> {
  const id = patternKeyHash(key);
  const all = await listGlobalPatterns();
  const pattern = all.find((p) => p.id === id);

  if (!pattern) return null;
  if (pattern.taxonomy_version !== CURRENT_TAXONOMY_VERSION) return null;

  const gate = evaluateConfidenceGate(pattern);
  if (gate === "suppressed") return null;

  const evidence: PopulationEvidence = {
    builder_count: pattern.contributing_tenant_count,
    positive_rate: pattern.positive_rate,
    median_days: pattern.median_days_to_signal,
    seeded_warning: gate === "seeded_warning",
    gate,
    narrative: buildNarrative(pattern, gate),
  };

  return { pattern, evidence };
}

// ---------------------------------------------------------------------------
// Narrative generation — directional, never causal
// ---------------------------------------------------------------------------

function buildNarrative(
  pattern: GlobalPattern,
  gate: "seeded_warning" | "confirmed",
): string {
  const count = pattern.contributing_tenant_count;
  const pct = Math.round(pattern.positive_rate * 100);
  const days = pattern.median_days_to_signal;

  const base = `${count} builder${count !== 1 ? "s" : ""} in our network made this type of change. ${pct}% saw their AI visibility move in a positive direction within ${days} days.`;

  if (gate === "seeded_warning") {
    return `${base} (Based on early data — pattern strengthens as more builders contribute.)`;
  }

  return base;
}
