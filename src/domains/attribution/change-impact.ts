import type {
  ChangeImpact,
  ImpactConfidence,
  ImpactDirection,
} from "./types";
import type { ScorecardRow, EventAttribution } from "./scorecard";
import { isNegativeEvent } from "./events";
import { ATTRIBUTION_CONFIG } from "./config";

export type ScorecardRowWithImpact = ScorecardRow & { impact: ChangeImpact };

export function enrichWithImpact(
  rows: ScorecardRow[],
): ScorecardRowWithImpact[] {
  return rows.map((row) => ({ ...row, impact: computeChangeImpact(row) }));
}

export function computeChangeImpact(row: ScorecardRow): ChangeImpact {
  const confidence = computeImpactConfidence(row);
  const direction = computeImpactDirection(row);
  const whyExplanation = generateWhyExplanation(row, confidence, direction);
  const nextAction = generateNextAction(row, confidence, direction);
  return { confidence, direction, whyExplanation, nextAction };
}

// ---------------------------------------------------------------------------
// Confidence
// ---------------------------------------------------------------------------

function computeImpactConfidence(row: ScorecardRow): ImpactConfidence {
  if (row.totalEventsLinked === 0) return "low";

  const primaries = row.eventAttributions.filter((a) => a.role === "primary");
  const contribs = row.eventAttributions.filter(
    (a) => a.role === "contributing",
  );
  const strongEvidence =
    row.evidenceTier === "exact" || row.evidenceTier === "probable";

  if (row.operatorConfirmedCount >= 1 && strongEvidence) return "high";
  if (primaries.length >= 2 && strongEvidence) return "high";
  if (
    primaries.length >= 1 &&
    contribs.length >= 2 &&
    (row.topScore ?? 0) >= 70
  )
    return "high";

  if (primaries.length >= 1 && row.evidenceTier !== "inferred") return "medium";
  if (contribs.length >= 2) return "medium";
  if (row.operatorConfirmedCount >= 1) return "medium";

  return "low";
}

// ---------------------------------------------------------------------------
// Direction
// ---------------------------------------------------------------------------

function eventDirection(ea: EventAttribution): "positive" | "negative" | "flat" {
  if (isNegativeEvent(ea.event)) return "negative";
  const { mentions_before, mentions_after } = ea.event.context;
  if (mentions_after > mentions_before) return "positive";
  if (mentions_after < mentions_before) return "negative";
  return "flat";
}

function computeImpactDirection(row: ScorecardRow): ImpactDirection {
  if (row.totalEventsLinked === 0) return "none";

  let pos = 0;
  let neg = 0;
  for (const ea of row.eventAttributions) {
    const d = eventDirection(ea);
    if (d === "positive") pos++;
    else if (d === "negative") neg++;
  }

  if (pos > 0 && neg === 0) return "positive";
  if (neg > 0 && pos === 0) return "negative";
  if (pos > 0 && neg > 0) return "mixed";
  return "none";
}

// ---------------------------------------------------------------------------
// Why explanation
// ---------------------------------------------------------------------------

function generateWhyExplanation(
  row: ScorecardRow,
  confidence: ImpactConfidence,
  direction: ImpactDirection,
): string {
  const parts: string[] = [];

  // What we see
  if (row.operatorConfirmedCount > 0) {
    parts.push(
      `You confirmed this change as causal for ${row.operatorConfirmedCount} event${row.operatorConfirmedCount > 1 ? "s" : ""}`,
    );
  }

  const positiveAttrs = row.eventAttributions.filter(
    (a) => !isNegativeEvent(a.event),
  );
  const negativeAttrs = row.eventAttributions.filter(
    (a) => isNegativeEvent(a.event),
  );
  const primaries = positiveAttrs.filter((a) => a.role === "primary");
  const contribs = positiveAttrs.filter(
    (a) => a.role === "contributing",
  );
  const candidates = row.eventAttributions.filter(
    (a) => a.role === "candidate",
  );

  if (negativeAttrs.length > 0) {
    const negTopics = [...new Set(negativeAttrs.map((a) => a.event.topic))];
    parts.push(
      `Visibility declined for ${negTopics.slice(0, 2).join(", ")} — ${negativeAttrs.length} negative event${negativeAttrs.length > 1 ? "s" : ""} detected in the same observation window as this change`,
    );
  }

  if (primaries.length > 0 && row.operatorConfirmedCount === 0) {
    const topicStr =
      row.topics.length > 0 ? ` for ${row.topics.slice(0, 2).join(", ")}` : "";
    parts.push(
      `Closest match in ${primaries.length} positive outcome event${primaries.length > 1 ? "s" : ""}${topicStr}`,
    );
  }
  if (contribs.length > 0) {
    parts.push(
      `Contributing factor in ${contribs.length} additional positive event${contribs.length > 1 ? "s" : ""}`,
    );
  }

  // Evidence quality
  const tierDescriptions: Record<string, string> = {
    exact: "Evidence is strong — verified page with specific description",
    probable: "Evidence is reasonable — URL present or strong description",
    weak: "Evidence is weak — vague description or no URL",
    inferred: "Evidence is inferred — reconstructed from data patterns",
  };
  parts.push(tierDescriptions[row.evidenceTier] ?? "Evidence quality unknown");

  // Direction context
  if (direction === "positive" && row.totalEventsLinked > 0) {
    const cited = row.eventAttributions.filter(
      (a) => a.event.context.cited,
    ).length;
    if (cited > 0) {
      parts.push(
        `${cited} event${cited > 1 ? "s" : ""} include direct citations — strong positive signal`,
      );
    }
  }

  // What's missing
  if (candidates.length > 0) {
    parts.push(
      `${candidates.length} unresolved candidate${candidates.length > 1 ? "s" : ""} still awaiting review`,
    );
  }

  if (row.totalEventsLinked === 0) {
    const { maxDays } = ATTRIBUTION_CONFIG.discovery;
    if (row.daysSinceChange <= 14) {
      parts.push(
        `Only ${row.daysSinceChange} days since change — outcome signals may still emerge`,
      );
    } else if (row.daysSinceChange <= maxDays) {
      parts.push(
        `${row.daysSinceChange} days since change — still within the ${maxDays}-day attribution window`,
      );
    } else {
      parts.push(
        `No outcome events detected within the ${maxDays}-day attribution window`,
      );
    }
  }

  if (
    (row.topScore ?? 0) > 0 &&
    (row.topScore ?? 0) < 50 &&
    row.totalEventsLinked > 0
  ) {
    parts.push("Match scores are below threshold for strong confidence");
  }

  return parts.join(". ") + ".";
}

// ---------------------------------------------------------------------------
// Next action
// ---------------------------------------------------------------------------

const PLATFORM_LABELS: Record<string, string> = {
  chatgpt: "ChatGPT",
  google_aio: "AI Overviews",
  perplexity: "Perplexity",
};

function platformList(platforms: string[]): string {
  return platforms.map((p) => PLATFORM_LABELS[p] ?? p).join(" and ");
}

function generateNextAction(
  row: ScorecardRow,
  confidence: ImpactConfidence,
  direction: ImpactDirection,
): string {
  const { verdict, topics, platforms, evidenceTier, change } = row;
  const topicStr = topics.length > 0 ? topics[0] : null;
  const { maxDays } = ATTRIBUTION_CONFIG.discovery;

  if (direction === "negative") {
    return "Metrics declined in the same observation window as this change. Investigate whether it introduced a regression or if external factors are at play.";
  }

  if (direction === "mixed") {
    return `Mixed results across ${platformList(platforms)}. Check which platforms improved and which declined — the change may help some channels more than others.`;
  }

  if (verdict === "validated" && confidence === "high") {
    if (platforms.length > 1) {
      return `Positive trend across ${platformList(platforms)}. Consider replicating this ${change.signal_type} pattern for other pages.`;
    }
    if (topicStr) {
      return `Positive trend for ${topicStr}. Consider replicating this change type for adjacent topics and pages.`;
    }
    return "Positive trend detected. Consider applying this pattern to similar pages.";
  }

  if (verdict === "validated") {
    if (row.operatorConfirmedCount === 0) {
      return "Positive signal — confirm in Review to lock it in and strengthen the attribution chain.";
    }
    if (topicStr) {
      return `Confirmed for ${topicStr}. Look for similar pages that could benefit from the same change.`;
    }
    return "Positive signal confirmed. Look for other pages where this approach applies.";
  }

  if (verdict === "partial") {
    if (evidenceTier === "weak") {
      return "Improve this changelog entry — add the specific URL and topic targeted so Beacon can measure more precisely.";
    }
    const candidates = row.eventAttributions.filter(
      (a) => a.role === "candidate",
    );
    if (candidates.length > 0) {
      return `Mixed signal with ${candidates.length} unresolved candidate${candidates.length > 1 ? "s" : ""}. Review and decide to strengthen this verdict.`;
    }
    return "Some positive signal but not conclusive. Monitor for additional outcome events.";
  }

  if (verdict === "inconclusive") {
    const candidates = row.eventAttributions.filter(
      (a) => a.role === "candidate",
    );
    if (candidates.length > 0) {
      return `Resolve ${candidates.length} pending candidate${candidates.length > 1 ? "s" : ""} in Review to clarify whether this change had impact.`;
    }
    if (evidenceTier === "weak") {
      return "Not enough signal and weak evidence. Add URL and topic to future changelog entries of this type.";
    }
    return "Not enough data to determine impact. Check back as more sample results arrive.";
  }

  if (verdict === "too_early") {
    const remaining = maxDays - row.daysSinceChange;
    if (remaining > 0) {
      return `Check back in ~${remaining} days. Change is ${row.daysSinceChange} days old — still building signal.`;
    }
    return "Still within the attribution window. Results will surface as new samples arrive.";
  }

  if (verdict === "no_impact") {
    if (evidenceTier === "weak") {
      return "No lift detected, but evidence is weak — this may be a measurement gap. Improve changelog precision for next time.";
    }
    if (topicStr) {
      return `No outcome events after ${row.daysSinceChange} days for ${topicStr}. Reassess whether this page targets the right topic.`;
    }
    return `No lift detected in ${maxDays}-day window. Consider whether this change was substantial enough to move the needle.`;
  }

  if (verdict === "negative") {
    return "Performance declined in the same observation window as this change. Review whether it introduced a regression or if external factors are at play.";
  }

  return "Awaiting more evidence before a recommendation can be made.";
}
