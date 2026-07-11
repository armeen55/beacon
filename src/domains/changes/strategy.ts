/**
 * strategy (2026-07-01) - PURE ranking + filtering over CanonicalChange. The strategy mode changes
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

/** Goal filter - a pure predicate. "recommended" is the unfiltered default. */
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

/**
 * Wave 3C (3D) - the comparative "why this ranks above the next idea" line. Compares the two
 * changes' balanced strategyScore COMPONENTS (the same weights strategyScore uses: evidence
 * strong 300 / directional 100, ready bonus 200, effort penalty -2 per minute, risk penalty
 * 120 high / 25 medium, base impactScore) and attributes the largest positive contributors, in
 * plain language. Returns null when nothing about `a` credibly explains ranking it above `b`
 * (the caller then omits the line - as it must on the last visible card, which has no next idea).
 * PURE + deterministic: same inputs, same sentence.
 */
const EVIDENCE_RANK: Record<CanonicalChange["evidenceStrength"], number> = { strong: 2, directional: 1, tracking: 0 };
const EVIDENCE_WORD: Record<CanonicalChange["evidenceStrength"], string> = {
  strong: "strong",
  directional: "directional",
  tracking: "tracking only",
};

export function outranksReason(a: CanonicalChange, b: CanonicalChange, strategy: Strategy = "balanced"): string | null {
  // The list always ranks balanced; other strategies fall back to the same component read, which
  // is a superset of what growth/clean weigh, so the sentence stays honest for any mode.
  void strategy;
  const reasons: Array<{ delta: number; text: string }> = [];

  if (EVIDENCE_RANK[a.evidenceStrength] > EVIDENCE_RANK[b.evidenceStrength]) {
    const evDelta = (a.evidenceStrength === "strong" ? 300 : a.evidenceStrength === "directional" ? 100 : 0) -
      (b.evidenceStrength === "strong" ? 300 : b.evidenceStrength === "directional" ? 100 : 0);
    reasons.push({ delta: evDelta, text: `its evidence is stronger (${EVIDENCE_WORD[a.evidenceStrength]} vs ${EVIDENCE_WORD[b.evidenceStrength]})` });
  }

  const aReady = a.status === "ready" || a.status === "apply";
  const bReady = b.status === "ready" || b.status === "apply";
  if (aReady && !bReady) reasons.push({ delta: 200, text: "it is already prepared to ship" });

  const aEffort = Number.isFinite(a.estimatedEffortMinutes) ? a.estimatedEffortMinutes : 5;
  const bEffort = Number.isFinite(b.estimatedEffortMinutes) ? b.estimatedEffortMinutes : 5;
  if (aEffort < bEffort) {
    reasons.push({ delta: (bEffort - aEffort) * 2, text: `it takes less time (${aEffort} vs ${bEffort} minutes)` });
  }

  const aRisk = a.riskLevel === "high" ? 120 : a.riskLevel === "medium" ? 25 : 0;
  const bRisk = b.riskLevel === "high" ? 120 : b.riskLevel === "medium" ? 25 : 0;
  if (aRisk < bRisk) reasons.push({ delta: bRisk - aRisk, text: "it carries less risk" });

  // P1-3 (2026-07-10, visual audit) - a bare "it has more expected impact" (the raw
  // impactScore delta, with no number behind it) rendered as a near-identical line on ~24
  // cards, since the balanced score favors higher impact almost by definition. An impact
  // contributor may only be named here when it can be QUANTIFIED with a real forecast
  // number (the same monthly-clicks upside the card itself shows) - otherwise it is dropped
  // rather than stated vaguely.
  const aUpside = Number.isFinite(a.upside) ? (a.upside as number) : null;
  const bUpside = Number.isFinite(b.upside) ? (b.upside as number) : null;
  if (aUpside != null && bUpside != null && aUpside > bUpside) {
    reasons.push({
      delta: aUpside - bUpside,
      text: `it is forecast to add more clicks (about ${Math.round(aUpside)} vs ${Math.round(bUpside)} a month)`,
    });
  }

  if (reasons.length === 0) return null;
  // Largest positive contributors first; name at most two so the line stays readable.
  reasons.sort((x, y) => y.delta - x.delta);
  const picked = reasons.slice(0, 2).map((r) => r.text);
  const joined = picked.length === 2 ? `${picked[0]} and ${picked[1]}` : picked[0];
  return `Ranked above the next idea because ${joined}.`;
}

/** Convenience for a rendered list: the outranks line for each row against the NEXT row in display
 *  order, keyed by change id, with the last row mapped to null (nothing after it to out-rank).
 *  PURE. */
export function outranksReasonsBySequence(
  sequence: readonly CanonicalChange[],
  strategy: Strategy = "balanced",
): Map<string, string | null> {
  const out = new Map<string, string | null>();
  for (let i = 0; i < sequence.length; i++) {
    const next = sequence[i + 1];
    out.set(sequence[i]!.id, next ? outranksReason(sequence[i]!, next, strategy) : null);
  }
  return out;
}
