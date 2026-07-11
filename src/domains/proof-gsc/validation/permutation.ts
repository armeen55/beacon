/**
 * Matched-null construction for the C4 permutation gate.
 *
 * Fixes the two deployed defects the protocol names:
 *   - UNIT BUG (run-measurement.ts near lines 445 to 457): the deployed gate
 *     ranked a CTR lift (a 0 to 1 rate) inside a null of absolute click
 *     deltas. Here the null is built from the SAME lane statistic as the
 *     treated read, in the same unit, computed the same way (C6, L10).
 *   - STATISTIC MISMATCH (permutation-null.ts): deployed null pages
 *     subtracted the pool mean of 59 pages while the treated page subtracted
 *     its 2 to 3 matched controls. Here every null page gets its OWN matched
 *     control set selected by the SAME frozen matching rules, so the null is
 *     the distribution of the actual treated statistic on untreated pages.
 *
 * Clustering (L2): placements are BLOCK moves over calendar, whole weeks
 * only (offsets are multiples of 7 days), never day-level scrambling, and
 * the offset-zero placements share the treated unit's exact calendar so
 * sitewide shocks appear inside the null.
 */

import { addDays } from "../measure";
import type { C4FrozenConfig, C4Lane } from "./types";
import { computeLaneStat } from "./classifier";
import { selectMatchedControls } from "./matching";
import { preStatsFor, windowAgg, windowCovered, type SeriesIndex } from "./series";
import { hashKey } from "./rng";

export type NullBuildResult = {
  stats: number[];
  pagesUsed: number;
  placementsUsed: number;
};

/**
 * Build the matched-null statistics for one treated read. Deterministic
 * (hash-ordered under `salt`), pure given the series index. Null pages that
 * fail the same eligibility gates a treated unit faces (baseline floor,
 * strict matched controls, rate data) are skipped, so the null is the
 * distribution of the statistic among units that COULD have been judged.
 */
export function buildMatchedNullStats(args: {
  index: SeriesIndex;
  lane: C4Lane;
  shipDate: string;
  windowDays: number;
  /** Pages eligible to serve as null units or null-control donors: the
   *  untreated pool minus the treated unit's own page, controls, alternates. */
  poolPaths: ReadonlyArray<string>;
  config: Pick<
    C4FrozenConfig,
    "preWindowDays" | "matching" | "minBaselineImpressions" | "minControls" | "maxControls" | "permutation"
  >;
  /** Salt for deterministic ordering, typically the unit id. */
  salt: string;
}): NullBuildResult {
  const { index, config } = args;
  const preDays = config.preWindowDays;
  const nullPages = [...args.poolPaths].sort(
    (a, b) => hashKey(a, `${args.salt}:nullpage`) - hashKey(b, `${args.salt}:nullpage`),
  ).slice(0, config.permutation.maxNullPages);

  // Placement dates: the treated calendar plus whole-week block shifts that
  // still fit inside the finalized snapshot.
  const placements: string[] = [];
  for (const offset of config.permutation.placementOffsetsDays) {
    const d = addDays(args.shipDate, offset);
    const preStart = addDays(d, -preDays);
    const postEnd = addDays(d, args.windowDays);
    if (windowCovered(index, preStart, d) && windowCovered(index, d, postEnd)) placements.push(d);
  }

  const stats: number[] = [];
  const pagesWithStats = new Set<string>();
  let placementsUsed = 0;
  for (const placement of placements) {
    // Fresh reuse bookkeeping per placement (a donor may anchor nulls on
    // different calendar blocks; within one block the cap holds).
    const usage = new Map<string, number>();
    // Pre stats for every pool page at this placement, computed once.
    const preByPath = new Map(nullPages.map((p) => [p, preStatsFor(index, p, placement, preDays)]));
    const donorsAll = args.poolPaths.map((p) => preStatsFor(index, p, placement, preDays));
    let usedThisPlacement = 0;
    for (const nullPage of nullPages) {
      const treatedPre = preByPath.get(nullPage)!;
      if (treatedPre.impressions < config.minBaselineImpressions) continue;
      const matched = selectMatchedControls({
        treated: treatedPre,
        candidates: donorsAll.filter((d) => d.path !== nullPage),
        bands: config.matching,
        minControls: config.minControls,
        maxControls: config.maxControls,
        alternateCount: 0,
        usage,
        reuseCap: config.permutation.nullControlReuseCap,
        salt: `${args.salt}:${placement}`,
      });
      if (matched.insufficient) continue;
      const preStart = addDays(placement, -preDays);
      const postEnd = addDays(placement, args.windowDays);
      const stat = computeLaneStat({
        lane: args.lane,
        treatedPre: windowAgg(index, nullPage, preStart, placement),
        treatedPost: windowAgg(index, nullPage, placement, postEnd),
        controls: matched.controls.map((c) => ({
          pre: windowAgg(index, c, preStart, placement),
          post: windowAgg(index, c, placement, postEnd),
        })),
        minControls: config.minControls,
      });
      if (!stat.ok) continue;
      stats.push(stat.stat);
      pagesWithStats.add(nullPage);
      usedThisPlacement += 1;
    }
    if (usedThisPlacement > 0) placementsUsed += 1;
  }
  return { stats, pagesUsed: pagesWithStats.size, placementsUsed };
}
