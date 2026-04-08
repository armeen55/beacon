import type { Attribution, MatchStrength } from "./types";
import type { TriagedCandidate } from "./triage";

export type JudgmentSummary = {
  whatHappened: string;
  bestExplanation: string | null;
  confidenceLine: string;
  verdict: "clear" | "ambiguous" | "no_candidates" | "all_suppressed";
  topCandidateChangeId: string | null;
  candidateCount: number;
  reviewCount: number;
};

export function buildJudgment(
  topic: string,
  platform: string,
  eventType: string,
  triggerDate: string,
  metricValue: number,
  delta: number | null,
  cited: boolean,
  mentionsBefore: number,
  mentionsAfter: number,
  gapDays: number,
  primary: TriagedCandidate | null,
  needsReview: TriagedCandidate[],
  contributing: TriagedCandidate[],
  suppressed: TriagedCandidate[],
  totalCandidates: number
): JudgmentSummary {
  const what = buildWhatHappened(topic, platform, eventType, triggerDate, cited, mentionsBefore, mentionsAfter, gapDays);
  const reviewCount = needsReview.length;

  if (totalCandidates === 0) {
    return {
      whatHappened: what,
      bestExplanation: null,
      confidenceLine: "Nothing in your ship log lines up with this move.",
      verdict: "no_candidates",
      topCandidateChangeId: null,
      candidateCount: 0,
      reviewCount: 0,
    };
  }

  if (primary) {
    const explanation = buildExplanationLine(primary);
    const confidence = buildConfidenceLine(primary.attribution, primary.score, needsReview.length);
    return {
      whatHappened: what,
      bestExplanation: explanation,
      confidenceLine: confidence,
      verdict: "clear",
      topCandidateChangeId: primary.change.id,
      candidateCount: totalCandidates,
      reviewCount,
    };
  }

  if (needsReview.length >= 2) {
    const top = needsReview[0];
    const second = needsReview[1];
    const explanation = `Two plausible drivers — "${top.change.asset_name}" and "${second.change.asset_name}" both fit`;
    const confidence = buildAmbiguousConfidenceLine(top, second);
    return {
      whatHappened: what,
      bestExplanation: explanation,
      confidenceLine: confidence,
      verdict: "ambiguous",
      topCandidateChangeId: top.change.id,
      candidateCount: totalCandidates,
      reviewCount,
    };
  }

  if (needsReview.length === 1) {
    const top = needsReview[0];
    const explanation = `Possible driver: "${top.change.asset_name}"`;
    const confidence = buildConfidenceLine(top.attribution, top.score, 0);
    return {
      whatHappened: what,
      bestExplanation: explanation,
      confidenceLine: confidence,
      verdict: "ambiguous",
      topCandidateChangeId: top.change.id,
      candidateCount: totalCandidates,
      reviewCount,
    };
  }

  return {
    whatHappened: what,
    bestExplanation: null,
    confidenceLine: "All candidates were set aside as low fit.",
    verdict: "all_suppressed",
    topCandidateChangeId: null,
    candidateCount: totalCandidates,
    reviewCount: 0,
  };
}

function buildWhatHappened(
  topic: string,
  platform: string,
  eventType: string,
  triggerDate: string,
  cited: boolean,
  mentionsBefore: number,
  mentionsAfter: number,
  gapDays: number
): string {
  const dateStr = new Date(triggerDate).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const citedSuffix = cited ? " and was cited" : "";

  switch (eventType) {
    case "first_appearance":
      return `${topic} showed up in ${platform} for the first time${citedSuffix} on ${dateStr}`;
    case "visibility_regained":
      return `${topic} came back in ${platform} after ${gapDays} days off the map${citedSuffix} on ${dateStr}`;
    case "mention_surge":
      return `${topic} spiked from ${mentionsBefore} to ${mentionsAfter} mentions in ${platform} on ${dateStr}`;
    default:
      return `${topic} moved in ${platform} on ${dateStr}`;
  }
}

function buildExplanationLine(candidate: TriagedCandidate): string {
  const name = candidate.change.asset_name;
  const parts: string[] = [];

  const desc = candidate.change.change_description;
  if (desc && desc.length > 0) {
    const short = desc.length > 60 ? desc.slice(0, 57) + "…" : desc;
    parts.push(short);
  }

  const matchParts = describeMatches(candidate.attribution.matches);
  if (matchParts) parts.push(matchParts);

  const suffix = parts.length > 0 ? ` — ${parts.join("; ")}` : "";
  return `Most likely: "${name}"${suffix}`;
}

function buildConfidenceLine(
  attribution: Attribution,
  score: number,
  ambiguousCount: number
): string {
  const m = attribution.matches;
  const strongFactors = getStrongFactors(m);
  const partialFactors = getPartialFactors(m);

  if (score >= 75 && strongFactors.length >= 3) {
    return `Likely — ${strongFactors.join(", ")} all line up`;
  }
  if (score >= 75) {
    return `Likely — strong overall fit`;
  }
  if (score >= 50) {
    if (partialFactors.length > 0) {
      return `Possible — ${strongFactors.join(", ")} match but ${partialFactors.join(", ")} ${partialFactors.length === 1 ? "is" : "are"} only a partial fit`;
    }
    return `Possible — some signals line up but not all`;
  }
  if (score >= 25) {
    return `Weak — only ${strongFactors.length > 0 ? strongFactors.join(" and ") : "a few signals"} match`;
  }
  return `Not enough overlap to be confident`;
}

function buildAmbiguousConfidenceLine(
  top: TriagedCandidate,
  second: TriagedCandidate
): string {
  const gap = Math.round(top.score - second.score);
  if (gap < 5) {
    return `Very close fit — pick whichever you know actually shipped for this`;
  }
  if (gap < 15) {
    return `Close scores — the top candidate edges it but both are plausible`;
  }
  return `Top candidate leads but second is worth checking`;
}

function describeMatches(matches: Attribution["matches"]): string | null {
  const parts: string[] = [];
  if (matches.topic === "strong") parts.push("topic matches");
  if (matches.temporal === "strong") parts.push("timing fits");
  else if (matches.temporal === "partial") parts.push("timing is close");
  if (matches.platform === "strong") parts.push("expected platform");
  else if (matches.platform === "partial") parts.push("likely platform");
  if (matches.sourceCategory === "strong") parts.push("high-relevance change type");
  if (matches.url === "strong") parts.push("same URL");
  if (matches.geo === "strong") parts.push("same city");
  else if (matches.geo === "partial") parts.push("same metro");
  return parts.length > 0 ? parts.join(", ") : null;
}

const FACTOR_NAMES: Record<keyof Attribution["matches"], string> = {
  platform: "platform",
  topic: "topic",
  url: "URL",
  geo: "city",
  temporal: "timing",
  sourceCategory: "change type",
};

function getStrongFactors(matches: Attribution["matches"]): string[] {
  return (Object.entries(matches) as [keyof Attribution["matches"], MatchStrength][])
    .filter(([, s]) => s === "strong")
    .map(([k]) => FACTOR_NAMES[k]);
}

function getPartialFactors(matches: Attribution["matches"]): string[] {
  return (Object.entries(matches) as [keyof Attribution["matches"], MatchStrength][])
    .filter(([, s]) => s === "partial")
    .map(([k]) => FACTOR_NAMES[k]);
}
