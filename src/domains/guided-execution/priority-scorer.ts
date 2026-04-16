/**
 * CX5.2 + CX5.3 — Priority scoring + top-3 move selection.
 *
 * Every detected gap is scored on 4 dimensions:
 *
 *   priority = (citation_impact × 0.30)    — how many AI citations this page gets
 *            + (pattern_confidence × 0.25)  — how strong the global pattern is
 *            + (gap_severity × 0.25)        — how critical the structural gap is
 *            + (page_importance × 0.20)     — homepage > service > city > other
 *
 * Top-3 selection enforces diversity: no two moves in the top 3 can
 * share the same fix_change_type. This prevents "add FAQ to 3 pages"
 * when "add FAQ + add comparison table + add schema" is more actionable.
 *
 * Ties are broken by affected_page_count (sitewide moves first).
 */

import type { DetectedGap, GapSeverity, ScoredMove, PriorityComponents } from "./types";
import type { PatternKey } from "@/domains/global-patterns/contracts";
import { queryPattern } from "@/domains/global-patterns/query";

// ---------------------------------------------------------------------------
// Component scoring
// ---------------------------------------------------------------------------

const SEVERITY_SCORES: Record<GapSeverity, number> = {
  critical: 100,
  high: 75,
  medium: 50,
  low: 25,
};

function scoreCitationImpact(citationCount: number): number {
  // Log scale: 0 citations=0, 10=40, 50=65, 100=75, 500=90, 1000=100
  if (citationCount <= 0) return 0;
  return Math.min(100, Math.round(Math.log10(citationCount + 1) * 33));
}

function scorePageImportance(pageUrl: string): number {
  const path = pageUrl.toLowerCase();
  if (path === "/" || path === "" || path.endsWith("/index")) return 100;
  if (path.includes("/service") || path.includes("/what-we-do")) return 80;
  if (path.includes("/location") || path.includes("/cities")) return 70;
  if (path.includes("/about")) return 60;
  if (path.includes("/project") || path.includes("/portfolio")) return 50;
  return 40;
}

function scorePatternConfidence(gap: DetectedGap): number {
  // Query the global pattern store for this gap's fix type + platform
  const key: PatternKey = {
    segment: "local_residential_builder",
    change_type: gap.fix_change_type,
    platform: gap.primary_platform,
    context_bin: "zero::established", // default bin for scoring
  };

  const result = queryPattern(key);
  if (!result) return 0;

  // Pattern confidence = positive_rate × tenant_count_factor
  const tenantFactor = Math.min(1, result.pattern.contributing_tenant_count / 10);
  return Math.round(result.pattern.positive_rate * tenantFactor * 100);
}

// ---------------------------------------------------------------------------
// Priority computation
// ---------------------------------------------------------------------------

const WEIGHTS = {
  citation_impact: 0.30,
  pattern_confidence: 0.25,
  gap_severity: 0.25,
  page_importance: 0.20,
};

/**
 * Score a single gap as a potential move.
 */
export function scoreGap(
  gap: DetectedGap,
  citationCount: number,
): ScoredMove {
  const components: PriorityComponents = {
    citation_impact: scoreCitationImpact(citationCount),
    pattern_confidence: scorePatternConfidence(gap),
    gap_severity: SEVERITY_SCORES[gap.severity],
    page_importance: scorePageImportance(gap.page_url),
  };

  const priority = Math.round(
    components.citation_impact * WEIGHTS.citation_impact +
    components.pattern_confidence * WEIGHTS.pattern_confidence +
    components.gap_severity * WEIGHTS.gap_severity +
    components.page_importance * WEIGHTS.page_importance,
  );

  return { gap, priority, components };
}

/**
 * Score all gaps and return sorted by priority (highest first).
 */
export function scoreAllGaps(
  gaps: DetectedGap[],
  citationCounts: Map<string, number>,
): ScoredMove[] {
  return gaps
    .map((gap) => scoreGap(gap, citationCounts.get(gap.page_url) ?? 0))
    .sort((a, b) => {
      if (a.priority !== b.priority) return b.priority - a.priority;
      return b.gap.affected_page_count - a.gap.affected_page_count;
    });
}

// ---------------------------------------------------------------------------
// Top-3 selector with diversity constraint
// ---------------------------------------------------------------------------

/**
 * Select the top 3 moves from scored gaps.
 *
 * Diversity constraint: no two moves share the same fix_change_type.
 * This prevents "add FAQ to 3 different pages" when a more diverse
 * set of moves ("FAQ + comparison table + schema") gives the customer
 * more actionable variety.
 *
 * Algorithm:
 *   1. Take the highest-priority gap
 *   2. Skip any subsequent gap whose fix_change_type matches an
 *      already-selected move
 *   3. Stop when 3 moves are selected or all gaps exhausted
 *
 * If fewer than 3 distinct change types exist, relaxes the constraint
 * and picks the top remaining by priority.
 */
export function selectTopMoves(
  scored: ScoredMove[],
  count: number = 3,
): ScoredMove[] {
  const selected: ScoredMove[] = [];
  const usedChangeTypes = new Set<string>();

  // Pass 1: diverse selection
  for (const move of scored) {
    if (selected.length >= count) break;
    if (usedChangeTypes.has(move.gap.fix_change_type)) continue;
    selected.push(move);
    usedChangeTypes.add(move.gap.fix_change_type);
  }

  // Pass 2: if fewer than count, fill with remaining highest-priority
  if (selected.length < count) {
    const selectedIds = new Set(selected.map((s) => s.gap.page_url + "::" + s.gap.type));
    for (const move of scored) {
      if (selected.length >= count) break;
      const id = move.gap.page_url + "::" + move.gap.type;
      if (selectedIds.has(id)) continue;
      selected.push(move);
      selectedIds.add(id);
    }
  }

  return selected;
}
