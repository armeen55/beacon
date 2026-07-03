/**
 * rank-to-visits (BEACON_500 R23 P19, v1 item 367, 2026-07-03) - convert a Google
 * rank move into expected monthly visits, so a Move can say a concrete number
 * like "moving from #8 to #3 is worth about 120 more visits a month."
 *
 * This does NOT invent a new CTR table. It reuses the ONE canonical
 * position-to-clicks model (forecast/tenant-ctr-curve.ts): the industry-default
 * curve when the caller passes none, or the tenant's OWN fitted curve when they
 * loaded one (load-tenant-ctr-curve.ts). Expected visits at a position =
 * expectedCtrAt(position) x monthly impressions.
 *
 * PURE, no I/O. The caller supplies the current position, a target position, and
 * the query's monthly impressions (from persisted GSC), and optionally a fitted
 * curve.
 *
 * HONESTY RULE: with no impressions, no positions, or a target that is not
 * actually higher than the current rank, this returns a NULL gain and says so in
 * plain words - it never fabricates a visits number. Beacon voice: first person,
 * a concrete number, no lab words, no em or en dashes.
 */

import { defaultExpectedCtrAt, type TenantCtrCurve } from "@/domains/forecast/tenant-ctr-curve";

export type RankToVisitsInput = {
  /** Current Google average position for the query (1-based). Null = no rank yet. */
  currentPosition: number | null | undefined;
  /** The rank we would move to (1-based, lower = better). Null = no target. */
  targetPosition: number | null | undefined;
  /** The query's monthly impressions (Search Console). This is the denominator
   *  every expected-visits number rides on; 0/null = nothing to size. */
  monthlyImpressions: number | null | undefined;
  /** Optional: the tenant's OWN fitted position-to-CTR curve. Omitted = the
   *  industry-default curve, byte-identical to what the rest of Beacon assumes. */
  curve?: TenantCtrCurve | null;
};

export type RankToVisits = {
  /** Expected monthly visits at the CURRENT position, or null when unsized. */
  currentVisits: number | null;
  /** Expected monthly visits at the TARGET position, or null when unsized. */
  targetVisits: number | null;
  /** Extra monthly visits the move is worth (target minus current), or null. */
  monthlyGain: number | null;
  /** Plain "your own search data" / "industry default" basis for the curve used. */
  basis: string;
  /** One first-person sentence with the concrete number, or the honest
   *  not-enough-yet line. Never a lab word, never a dash. */
  sentence: string;
};

/** Round expected visits to a friendly unit so a caller never shows 117.3. Same
 *  shape opportunity-math.ts uses (10s over 100, 5s over 10, else 1s). */
function friendly(n: number): number {
  if (n >= 100) return Math.round(n / 10) * 10;
  if (n >= 10) return Math.round(n / 5) * 5;
  return Math.round(n);
}

/**
 * Expected monthly visits at a single position for a given monthly-impressions
 * count. PURE. Uses the caller's fitted curve when supplied, else the industry
 * default. Returns null when there is nothing to size (no position, no
 * impressions).
 */
export function expectedVisitsAt(
  position: number | null | undefined,
  monthlyImpressions: number | null | undefined,
  curve?: TenantCtrCurve | null,
): number | null {
  if (position == null || !Number.isFinite(position) || position <= 0) return null;
  if (
    monthlyImpressions == null ||
    !Number.isFinite(monthlyImpressions) ||
    monthlyImpressions <= 0
  ) {
    return null;
  }
  const ctrAt = curve?.expectedCtrAt ?? defaultExpectedCtrAt;
  return ctrAt(position) * monthlyImpressions;
}

/**
 * Convert a rank MOVE into expected monthly visits. PURE.
 *
 * currentVisits/targetVisits come from expectedVisitsAt on the same curve;
 * monthlyGain is target minus current. When the target is not actually higher
 * than the current rank (or either side cannot be sized), monthlyGain is null and
 * the sentence says so honestly.
 */
export function rankToVisits(input: RankToVisitsInput): RankToVisits {
  const curve = input.curve ?? null;
  const basis = curve?.source === "tenant"
    ? "based on how your own pages convert position to clicks"
    : "based on the typical click rate at each Google position";

  const currentVisits = expectedVisitsAt(input.currentPosition, input.monthlyImpressions, curve);
  const targetVisits = expectedVisitsAt(input.targetPosition, input.monthlyImpressions, curve);

  // Nothing to size: no impressions, or neither position is a real rank.
  if (currentVisits == null && targetVisits == null) {
    return {
      currentVisits: null,
      targetVisits: null,
      monthlyGain: null,
      basis,
      sentence:
        "I do not have a rank and monthly impressions for this yet, so I cannot put a visits number on it. Once Search Console shows both, I will.",
    };
  }

  // A one-sided read (e.g. only the target is a real rank) is still honest about
  // what it can say, but a GAIN needs both sides AND a genuine improvement.
  if (
    currentVisits == null ||
    targetVisits == null ||
    input.currentPosition == null ||
    input.targetPosition == null ||
    !(input.targetPosition < input.currentPosition)
  ) {
    return {
      currentVisits,
      targetVisits,
      monthlyGain: null,
      basis,
      sentence:
        "This target is not a real move up from where the page ranks now, so there is no extra-visits number to show yet.",
    };
  }

  const rawGain = targetVisits - currentVisits;
  const gain = friendly(Math.max(0, rawGain));
  const fromRank = Math.round(input.currentPosition);
  const toRank = Math.round(input.targetPosition);

  return {
    currentVisits,
    targetVisits,
    monthlyGain: gain,
    basis,
    sentence:
      gain > 0
        ? `Moving from #${fromRank} to #${toRank} is worth about ${gain.toLocaleString("en-US")} more visits a month, ${basis}.`
        : `Moving from #${fromRank} to #${toRank} would not add a meaningful number of visits a month, ${basis}.`,
  };
}
