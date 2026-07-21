/**
 * Unified confidence/signal display labels for all operator-facing surfaces.
 *
 * Internal types (verdict "validated", confidence "high", etc.) stay unchanged.
 * Only the display labels shown to the operator are unified here.
 *
 * Principle: directional language only. No causal claims.
 */

// ---------------------------------------------------------------------------
// Recommendation / action confidence → display
// ---------------------------------------------------------------------------

/** Maps internal recommendation confidence to operator-facing label. */
export const REC_CONFIDENCE_LABEL: Record<string, string> = {
  high: "Strong signal",
  medium: "Signal detected",
  low: "Early data",
};

// ---------------------------------------------------------------------------
// Attribution confidence → display
// ---------------------------------------------------------------------------

/** Maps attribution confidence (high/medium/low/uncertain) to display. */
export const ATTRIBUTION_CONFIDENCE_LABEL: Record<string, string> = {
  high: "Closest match",
  medium: "Possible match",
  low: "Weak match",
  uncertain: "Unclear",
};

// ---------------------------------------------------------------------------
// Change verdict → display
// ---------------------------------------------------------------------------

/** Maps internal verdict values to directional display labels. */
export const CHANGE_VERDICT_LABEL: Record<string, string> = {
  validated: "Positive trend",
  partial: "Mixed signal",
  inconclusive: "Unclear",
  no_impact: "No movement detected",
  negative: "Decline detected",
  too_early: "Too early to tell",
  pending: "Not rated",
};

// ---------------------------------------------------------------------------
// Evidence basis → display (Phase 2, 2026-04-20)
// ---------------------------------------------------------------------------

/** Operator-facing label for each evidenceBasis tier on Today action cards. */
export const EVIDENCE_BASIS_LABEL: Record<string, string> = {
  // Step 1.2 (master plan) — internal enum key stays "heuristic" so data
  // layer / DB rows aren't disturbed; user-visible value reads "Pattern-based"
  // because this is an evidence/confidence context.
  heuristic: "Pattern-based",
  tenant_history: "Measured on your site",
  current_dataset: "Early signal",
  shared_pattern: "Cross-site pattern",
};

export function evidenceBasisLabel(basis: string): string {
  return EVIDENCE_BASIS_LABEL[basis] ?? "Pattern-based";
}

// ---------------------------------------------------------------------------
// Experiment status → display
// ---------------------------------------------------------------------------

export const EXPERIMENT_STATUS_LABEL: Record<string, string> = {
  testing: "Testing",
  watching: "Watching",
  promising: "Positive trend",
  inconclusive: "No clear signal",
  negative: "Declining trend",
  dropped: "Dropped",
};

