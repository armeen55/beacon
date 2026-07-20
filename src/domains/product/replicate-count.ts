/**
 * Replicate-count — the single number the change-detail "Replicate this pattern"
 * CTA needs.
 *
 * This is a faithful extraction of the replicate branch of the retired legacy
 * recommendation engine (former recommendation-engine.ts lines ~277-345). The
 * detail page only ever consumed `replicateRecs.length` — the count of replicate
 * recommendations whose `sourceChangeId` equals the change being viewed — so the
 * whole 2000-line engine was overkill. This module reproduces that count with
 * identical semantics (same filters, same URL normalization, same best-proven
 * tie-break) without materializing any recommendation objects.
 *
 * Semantics preserved exactly:
 *   1. Proven-positive rows = validated|partial verdict, positive impact
 *      direction, at least one linked event.
 *   2. Pages that already carry a proven change (by normalized URL) are excluded
 *      from replicate targeting.
 *   3. Each proven-positive row is bucketed to a mined pattern via the shared
 *      matchChangeToPattern helper (re-used from recommendation-tracker so we
 *      never keep two copies of that logic).
 *   4. For every playbook brief whose pattern has a proven change and whose page
 *      is not itself already proven, the highest-topScore proven change in that
 *      pattern bucket is the replicate rec's source change.
 *   5. The CTA count for a change id = how many such briefs resolve to that id.
 */

import type { ScorecardRowWithImpact } from "@/domains/attribution/change-impact";
import type { MinedPattern, PlaybookBrief } from "@/domains/pages/playbook";
import { matchChangeToPattern } from "./recommendation-tracker";

const normalizeUrl = (url: string): string =>
  url.replace(/\/+$/, "").toLowerCase();

export function countReplicateRecsForChange(opts: {
  changeId: string;
  impactRows: ScorecardRowWithImpact[];
  patterns: MinedPattern[];
  briefs: PlaybookBrief[];
}): number {
  const { changeId, impactRows, patterns, briefs } = opts;

  const provenPositive = impactRows.filter(
    (r) =>
      (r.verdict === "validated" || r.verdict === "partial") &&
      r.impact.direction === "positive" &&
      r.totalEventsLinked > 0,
  );

  const pagesWithProvenChange = new Set(
    provenPositive
      .filter((r) => r.change.url)
      .map((r) => normalizeUrl(r.change.url!)),
  );

  const provenByPattern = new Map<string, ScorecardRowWithImpact[]>();
  for (const row of provenPositive) {
    const matched = matchChangeToPattern(row.change, patterns);
    if (!matched) continue;
    const existing = provenByPattern.get(matched.id) ?? [];
    existing.push(row);
    provenByPattern.set(matched.id, existing);
  }
  const provenPatternIds = new Set(provenByPattern.keys());

  let count = 0;
  for (const brief of briefs) {
    if (!provenPatternIds.has(brief.patternId)) continue;

    const briefUrl = normalizeUrl(brief.pageUrl);
    if (pagesWithProvenChange.has(briefUrl)) continue;

    const provenChanges = provenByPattern.get(brief.patternId) ?? [];
    const bestProven = [...provenChanges].sort(
      (a, b) => (b.topScore ?? 0) - (a.topScore ?? 0),
    )[0];
    if (!bestProven) continue;

    if (bestProven.change.id === changeId) count++;
  }

  return count;
}
