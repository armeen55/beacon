/**
 * 2026-05-19 — Slice 4.5.B.α₀ — minimal queue-rules gate.
 *
 * MINIMAL 4-of-10 rules per master plan §4.5.12. Full 10-rule
 * layer ships in Slice 4.5.D before the customer-queue flip. α₀
 * surfaces results only on the operator diagnostic page.
 *
 * Rules applied in order:
 *   1. SPECIFIC — `target_url` is non-null, non-empty, non-sentinel.
 *   2. EVIDENCE-BACKED — `evidence.length >= 1`.
 *   3. CONFIDENCE — `low` routes to `diagnostic_only`.
 *   4. SAFETY-FLAG-EMPTY — flagged rows route to `diagnostic_only`.
 *
 * Slice 4.5.D adds: customer-vocab scan, accepted-ancestor
 * suppression, dismissed cooldown, signal-stale, prerequisite-
 * blocked, max-per-page + max-per-family caps.
 */

import type { RecommendationCandidateRow } from "./candidate-row";

export type ApplyQueueRulesResult = {
  candidates: RecommendationCandidateRow[];
  diagnostic_only: RecommendationCandidateRow[];
};

const FORBIDDEN_TARGET_URLS = new Set<string>(["", "needs_new_page"]);

export function applyQueueRules(
  rows: ReadonlyArray<RecommendationCandidateRow>,
): ApplyQueueRulesResult {
  const candidates: RecommendationCandidateRow[] = [];
  const diagnostic_only: RecommendationCandidateRow[] = [];
  for (const row of rows) {
    if (row.target_url == null || FORBIDDEN_TARGET_URLS.has(row.target_url)) continue;
    if (row.evidence.length === 0) continue;
    if (row.confidence === "low") {
      diagnostic_only.push(row);
      continue;
    }
    if (row.safety_flags.length > 0) {
      diagnostic_only.push(row);
      continue;
    }
    candidates.push(row);
  }
  return { candidates, diagnostic_only };
}
