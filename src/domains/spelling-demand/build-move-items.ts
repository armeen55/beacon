/**
 * build-spelling-demand-move-items (P20, v1 129, 2026-07-03).
 *
 * PURE. Turns consolidated spelling groups into the input the
 * `spelling-demand-move` trigger predicate consumes, keeping only the groups
 * worth a Move:
 *   • combined demand clears a floor (real money), and
 *   • no single owned page already captures 2+ of the group's spellings (an
 *     existing page that already ranks for several variants owns the demand —
 *     no new page needed).
 *
 * The caller supplies `ownedCoverageBySpelling`: for each NORMALIZED spelling,
 * the set of owned page URLs that already show demand for it (built from GSC in
 * the loader). If one URL covers 2+ of a group's spellings, that page is the
 * de-facto owner and the group is skipped.
 *
 * GENERIC + language-agnostic; empty inputs -> empty output.
 * No em or en dashes anywhere.
 */

import { normalizeSpelling } from "./consolidate";
import type { ConsolidatedSpellingGroup } from "./types";

/** A group ready to become a create-page Move. */
export type SpellingDemandMoveItem = {
  /** Canonical spelling to own (verbatim from config). */
  canonical: string;
  /** Combined monthly demand across all spellings. */
  combinedDemand: number;
  /** The biggest single spelling's demand (what one query would have shown). */
  topSpellingDemand: number;
  /** Number of spellings folded together (canonical + variants with demand). */
  spellingCount: number;
  /** The alternate spellings (not the canonical), highest demand first. */
  otherSpellings: string[];
};

export type BuildSpellingDemandMoveInput = {
  groups: ReadonlyArray<ConsolidatedSpellingGroup>;
  /** normalized spelling -> owned page URLs already showing demand for it. */
  ownedCoverageBySpelling: ReadonlyMap<string, ReadonlySet<string>>;
  /** Minimum combined demand for a group to earn a Move. */
  minCombinedDemand?: number;
};

/** A group needs at least this much combined demand to justify a new page. */
export const DEFAULT_MIN_COMBINED_DEMAND = 100;

/** True when one owned URL already covers 2+ of the group's spellings. */
function anOwnedPageAlreadyCaptures(
  group: ConsolidatedSpellingGroup,
  coverage: ReadonlyMap<string, ReadonlySet<string>>,
): boolean {
  const hitsByUrl = new Map<string, number>();
  for (const member of group.members) {
    const urls = coverage.get(normalizeSpelling(member.term));
    if (!urls) continue;
    for (const url of urls) {
      const next = (hitsByUrl.get(url) ?? 0) + 1;
      hitsByUrl.set(url, next);
      if (next >= 2) return true;
    }
  }
  return false;
}

export function buildSpellingDemandMoveItems(
  input: BuildSpellingDemandMoveInput,
): SpellingDemandMoveItem[] {
  const min = input.minCombinedDemand ?? DEFAULT_MIN_COMBINED_DEMAND;
  const out: SpellingDemandMoveItem[] = [];
  for (const group of input.groups) {
    if (group.combinedDemand < min) continue;
    if (anOwnedPageAlreadyCaptures(group, input.ownedCoverageBySpelling)) continue;
    const canonicalNorm = normalizeSpelling(group.canonical);
    const otherSpellings = group.members
      .filter((m) => normalizeSpelling(m.term) !== canonicalNorm)
      .map((m) => m.term);
    // Nothing to fold beyond the canonical spelling itself -> no Move.
    if (otherSpellings.length === 0) continue;
    out.push({
      canonical: group.canonical,
      combinedDemand: group.combinedDemand,
      topSpellingDemand: group.topSpellingDemand,
      spellingCount: group.spellingsWithDemand,
      otherSpellings,
    });
  }
  return out;
}
