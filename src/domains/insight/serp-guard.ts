/**
 * Insight layer — SERP guard (operator-OS rebuild, Phase 1 "cheap" guard).
 *
 * PURE. Stops Beacon from over-claiming a "title/snippet problem" when a SERP
 * feature (AI Overview / featured snippet / image pack / knowledge panel) may
 * actually own the clicks. On a top-ranked low-CTR page with NO SERP-feature
 * data, we must say "verify the SERP first" — not "rewrite your title."
 *
 * Phase 1 only sets status from what we know (broad scan ⇒ "unknown").
 * Phase 3 will populate "observed"/"suspected" from SEMrush / synthetic / API.
 */

export type SerpStatus = "observed" | "suspected" | "unknown";

export type SerpGuard = {
  status: SerpStatus;
  /** True ⇒ a SERP feature likely owns the answer; do NOT call it a title fix. */
  featureLikelyOwnsAnswer: boolean;
  /** True ⇒ downgrade confidence + use guarded copy for title/meta claims. */
  downgrade: boolean;
  /** Short status label for the UI (exact strings, see manual §4). */
  label: string;
  rationale: string;
};

/** A page ranking in the top 5 is where SERP features most often steal clicks. */
const TOP_RANK_MAX = 5;

/**
 * Classify the SERP situation for a (position, ctr, serpStatus) tuple. Pure.
 * Defaults serpStatus to "unknown" (the broad-scan reality in Phase 1).
 */
export function deriveSerpGuard(args: {
  position: number;
  serpStatus?: SerpStatus;
  /** From observed data (SEMrush/API/manual) when available. */
  featureOwns?: boolean;
}): SerpGuard {
  const status = args.serpStatus ?? "unknown";
  const topRank = args.position <= TOP_RANK_MAX;

  if (status === "observed" && args.featureOwns) {
    return {
      status,
      featureLikelyOwnsAnswer: true,
      downgrade: true,
      label: "Likely SERP-owned click loss",
      rationale:
        "A SERP feature (AI Overview / featured snippet / image pack) owns the answer for this query — a title rewrite won't recover those clicks.",
    };
  }
  if (status === "suspected") {
    return {
      status,
      featureLikelyOwnsAnswer: false,
      downgrade: true,
      label: "SERP feature suspected",
      rationale:
        "A SERP feature is suspected (from SEMrush / synthetic signal) — verify before treating this as a title/snippet fix.",
    };
  }
  if (status === "unknown" && topRank) {
    return {
      status,
      featureLikelyOwnsAnswer: false,
      downgrade: true,
      label: "Needs SERP check before title rewrite",
      rationale:
        "Ranks top-5 with low CTR — a SERP feature (AI Overview / featured snippet / image pack) may own the clicks. Verify the live SERP before rewriting the title.",
    };
  }
  return {
    status,
    featureLikelyOwnsAnswer: false,
    downgrade: false,
    label: status === "observed" ? "SERP clear" : "SERP unknown",
    rationale: "",
  };
}

/** UI status chip text for an Opportunity Map row. */
export function serpStatusChip(status: SerpStatus): string {
  return status === "observed"
    ? "SERP observed"
    : status === "suspected"
      ? "SERP suspected"
      : "SERP unknown";
}
