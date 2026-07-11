/**
 * Operator-facing framing for Today’s primary recommendation.
 * Uses only fields already on the recommendation, no new scoring or metrics.
 */

export type PrimaryDecisionCopyInput = {
  rationale: string;
  expectedOutcome: string;
  bucket: "critical" | "high_leverage" | "opportunistic";
  confidence: "high" | "medium" | "low";
  confidenceReason?: string;
  type: string;
};

export type PrimaryDecisionCopy = {
  whyItMatters: string;
  ifYouIgnore: string;
  successLooksLike: string;
  /** Bucket + how sure Beacon is + `confidenceReason` only (freshness lives in Basis when present). */
  leverageAndConfidence: string;
};

function ifYouIgnoreLine(p: PrimaryDecisionCopyInput): string {
  switch (p.type) {
    case "investigate":
      return "If you park this, you still will not know whether the dip was your change, the market, or noise. The story stays fuzzy on the next import.";
    case "strengthen":
      return "If you ignore it, linked attribution rows can stay stuck in weaker evidence tiers instead of clearing when the changelog is honest.";
    case "strengthen_structure":
      return "If you ignore it, the page keeps earning mentions without the structure AI systems use to interpret it. You are not losing citations overnight, you are under-using what you already have.";
    case "improve_internal_links":
      return "If you skip it, this page stays an island. Citations continue, but authority does not flow to the rest of the site the way it could.";
    case "refresh_content":
      return "If you wait, the page can stay thin while still picking up mentions. You risk looking fine in a rollup while answers stay weak in practice.";
    case "competitive_displacement":
      return "If you do nothing, competitors keep owning the same topic slice you already show up in. Your share stays where it is.";
    case "cross_page_pattern":
      return "If you skip it, you leave a pattern that already worked elsewhere unapplied here. No new downside, just missed lift.";
    case "topic_cluster_gap":
      return "If you ignore it, you keep winning slices of the topic without the page type that captures the next intent layer.";
    case "refresh_stale_citation":
      return "If you wait, stale mentions can linger on a page that no longer earns them cleanly. Drift becomes harder to read later.";
    default:
      break;
  }

  if (p.bucket === "critical") {
    return "If you do nothing, Beacon will keep treating this as an open risk tied to your site or changelog story. Expect the same class of signal until something ships.";
  }
  if (p.bucket === "high_leverage") {
    return "If you ignore it, nothing is guaranteed to break tomorrow. You are simply choosing not to pull a lever that lines up with evidence you already have.";
  }
  return "If you skip it, you are mostly choosing timing. This is a smaller bet, so nothing urgent should be on fire.";
}

function leverageLabel(bucket: PrimaryDecisionCopyInput["bucket"]): string {
  if (bucket === "critical") return "Treat as urgent. Beacon put this in the critical bucket.";
  if (bucket === "high_leverage") return "Treat as high leverage. Beacon ranked it that way versus other open items.";
  return "Treat as opportunistic, a real option, not the only adult in the room.";
}

function confidenceLabel(c: PrimaryDecisionCopyInput["confidence"]): string {
  if (c === "high") return "Beacon is relatively sure given what is on file";
  if (c === "medium") return "Beacon is moderately sure, worth reading the basis below";
  return "Beacon is treating this as an early signal. Act if it matches your gut, not because the score bluffed you";
}

export function buildPrimaryDecisionCopy(
  p: PrimaryDecisionCopyInput,
): PrimaryDecisionCopy {
  const reason = p.confidenceReason?.trim()
    ? ` ${p.confidenceReason.trim()}.`
    : "";

  const leverageAndConfidence = `${leverageLabel(p.bucket)} ${confidenceLabel(p.confidence)}.${reason}`
    .replace(/\s+/g, " ")
    .replace(/\.\s*\./g, ".")
    .trim();

  return {
    whyItMatters: p.rationale.trim(),
    ifYouIgnore: ifYouIgnoreLine(p),
    successLooksLike: p.expectedOutcome.trim(),
    leverageAndConfidence,
  };
}
