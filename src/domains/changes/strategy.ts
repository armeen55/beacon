/**
 * strategy (2026-07-01) — PURE ranking + filtering over CanonicalChange. The strategy mode changes
 * ORDER and ELIGIBILITY only; it never changes underlying truth, never creates separate records, and
 * learning is always on regardless of mode. Goal + status filters are pure predicates.
 */
import type { CanonicalChange, Strategy, Goal, StatusView } from "./canonical-change";
import { statusView } from "./canonical-change";

const BLOCKED_LAST = 1_000_000; // blocked items always sort to the bottom (visible, not actionable)

function strategyScore(c: CanonicalChange, strategy: Strategy): number {
  const base = c.impactScore;
  const blocked = c.status === "blocked" ? BLOCKED_LAST : 0;
  const riskPenalty = c.riskLevel === "high" ? 120 : c.riskLevel === "medium" ? 25 : 0;
  if (strategy === "growth") {
    // Pure credible upside; directional/tracking evidence is acceptable.
    return base - blocked;
  }
  if (strategy === "clean") {
    // Reward measurable changes; penalize weak evidence + risk heavily.
    const ev = c.evidenceStrength === "strong" ? 1000 : c.evidenceStrength === "directional" ? 0 : -1000;
    return base + ev - riskPenalty - blocked;
  }
  // balanced: upside + evidence + ready-now, minus effort + risk.
  const ev = c.evidenceStrength === "strong" ? 300 : c.evidenceStrength === "directional" ? 100 : 0;
  const readyBonus = c.status === "ready" || c.status === "apply" ? 200 : 0;
  return base + ev + readyBonus - c.estimatedEffortMinutes * 2 - riskPenalty - blocked;
}

/**
 * Rank (and, for "clean", filter) the changes for a strategy. Skipped items are always dropped.
 * "Clean tests" keeps only strong-comparison, non-blocked, non-high-risk changes (the operator asked
 * for changes Beacon can measure most confidently). Balanced/Growth reorder without hiding.
 */
export function rankChanges(changes: CanonicalChange[], strategy: Strategy): CanonicalChange[] {
  let pool = changes.filter((c) => c.status !== "skipped");
  if (strategy === "clean") {
    pool = pool.filter((c) => c.evidenceStrength === "strong" && c.riskLevel !== "high" && c.status !== "blocked");
  }
  return [...pool].sort((a, b) => strategyScore(b, strategy) - strategyScore(a, strategy));
}

/** Goal filter — a pure predicate. "recommended" is the unfiltered default. */
export function goalMatches(c: CanonicalChange, goal: Goal): boolean {
  switch (goal) {
    case "recommended":
      return true;
    case "quick_wins":
      return c.estimatedEffortMinutes <= 3 && c.status !== "blocked" && c.changeFamily !== "new_page";
    case "biggest_upside":
      return (c.upside ?? 0) > 0 || c.impactScore > 0;
    case "recover_traffic":
      return /capture clicks|recover|declin|losing/i.test(`${c.opportunityType} ${c.rationale}`);
    case "ai_visibility":
      return /ai citation|ai visibility|win the ai|cited/i.test(`${c.opportunityType} ${c.recommendation} ${c.rationale}`);
    case "new_pages":
      return c.changeFamily === "new_page";
    default:
      return true;
  }
}

/** Count changes per status view (for the segmented control badges). */
export function statusCounts(changes: CanonicalChange[]): Record<StatusView, number> {
  const counts: Record<StatusView, number> = { todo: 0, ready: 0, measuring: 0, results: 0 };
  for (const c of changes) {
    if (c.status === "skipped") continue;
    counts[statusView(c.status)] += 1;
  }
  return counts;
}

export function inStatusView(c: CanonicalChange, view: StatusView): boolean {
  return statusView(c.status) === view;
}
