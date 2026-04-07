import type { CandidateResult } from "./candidates";

export type TriageCategory =
  | "primary"
  | "contributing"
  | "needs_review"
  | "suppressed";

export type TriagedCandidate = CandidateResult & {
  triage: TriageCategory;
  triageReason: string;
};

export type TriageSummary = {
  primary: TriagedCandidate | null;
  contributing: TriagedCandidate[];
  needsReview: TriagedCandidate[];
  suppressed: TriagedCandidate[];
  autoResolved: boolean;
};

const PRIMARY_MIN_SCORE = 75;
const PRIMARY_MIN_GAP = 15;
const SUPPRESS_MAX_SCORE = 45;
const SUPPRESS_GAP_FROM_TOP = 20;
const CONTRIBUTING_MIN_SCORE = 55;

export function triageCandidates(
  candidates: CandidateResult[]
): TriageSummary {
  if (candidates.length === 0) {
    return {
      primary: null,
      contributing: [],
      needsReview: [],
      suppressed: [],
      autoResolved: false,
    };
  }

  const sorted = [...candidates].sort(
    (a, b) =>
      b.score - a.score ||
      a.attribution.temporal_distance_days -
        b.attribution.temporal_distance_days
  );

  const topScore = sorted[0].score;
  const secondScore = sorted.length > 1 ? sorted[1].score : 0;
  const gap = topScore - secondScore;

  let primary: TriagedCandidate | null = null;
  const contributing: TriagedCandidate[] = [];
  const needsReview: TriagedCandidate[] = [];
  const suppressed: TriagedCandidate[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const c = sorted[i];
    const m = c.attribution.matches;

    if (i === 0 && canAutoConfirm(c, gap, sorted.length)) {
      primary = {
        ...c,
        triage: "primary",
        triageReason: buildPrimaryReason(c, gap),
      };
      continue;
    }

    if (shouldSuppress(c, topScore)) {
      suppressed.push({
        ...c,
        triage: "suppressed",
        triageReason: buildSuppressReason(c, topScore),
      });
      continue;
    }

    if (
      primary &&
      contributing.length < 2 &&
      c.score >= CONTRIBUTING_MIN_SCORE &&
      (m.topic === "strong" || m.topic === "partial") &&
      (c.attribution.confidence === "high" ||
        c.attribution.confidence === "medium")
    ) {
      contributing.push({
        ...c,
        triage: "contributing",
        triageReason: "Strong secondary candidate",
      });
      continue;
    }

    needsReview.push({
      ...c,
      triage: "needs_review",
      triageReason: buildReviewReason(c, topScore, gap, i),
    });
  }

  const autoResolved =
    primary !== null && needsReview.length === 0;

  return { primary, contributing, needsReview, suppressed, autoResolved };
}

function canAutoConfirm(
  c: CandidateResult,
  gap: number,
  totalCandidates: number
): boolean {
  if (c.score < PRIMARY_MIN_SCORE) return false;

  if (totalCandidates > 1 && gap < PRIMARY_MIN_GAP) return false;

  const m = c.attribution.matches;

  if (m.topic !== "strong" && m.topic !== "partial") return false;

  if (m.temporal !== "strong") return false;

  if (m.platform !== "strong" && m.platform !== "partial") return false;

  if (
    m.topic === "partial" &&
    m.url !== "strong" &&
    m.url !== "partial" &&
    m.geo !== "strong"
  ) {
    return false;
  }

  return true;
}

function shouldSuppress(
  c: CandidateResult,
  topScore: number
): boolean {
  const m = c.attribution.matches;

  if (c.score <= SUPPRESS_MAX_SCORE && topScore - c.score >= SUPPRESS_GAP_FROM_TOP) {
    return true;
  }

  const isHollow =
    (m.topic === "none" || m.topic === "unknown") &&
    (m.url === "none" || m.url === "unknown") &&
    (m.geo === "none" || m.geo === "unknown");

  if (isHollow && c.score <= 47) {
    return true;
  }

  if (m.topic === "none" && c.score <= Math.max(40, topScore - 15)) {
    return true;
  }

  return false;
}

function buildPrimaryReason(c: CandidateResult, gap: number): string {
  const parts = [`Score ${Math.round(c.score)}`];
  if (gap > 0) parts.push(`+${Math.round(gap)} above next`);
  parts.push(c.attribution.explanation);
  return parts.join(" · ");
}

function buildSuppressReason(
  c: CandidateResult,
  topScore: number
): string {
  const m = c.attribution.matches;
  if (
    (m.topic === "none" || m.topic === "unknown") &&
    (m.url === "none" || m.url === "unknown")
  ) {
    return "No topic or URL signal";
  }
  if (topScore - c.score >= SUPPRESS_GAP_FROM_TOP) {
    return `${Math.round(topScore - c.score)} points below top candidate`;
  }
  return "Weak overall signal";
}

function buildReviewReason(
  c: CandidateResult,
  topScore: number,
  gap: number,
  rank: number
): string {
  if (rank <= 1 && gap < PRIMARY_MIN_GAP) {
    return "Close to top candidate — ambiguous primary";
  }
  if (c.attribution.matches.platform === "unknown") {
    return "Platform context missing — needs manual check";
  }
  if (c.attribution.matches.topic === "partial") {
    return "Partial topic match — needs confirmation";
  }
  return "Moderate signal — human judgment needed";
}
