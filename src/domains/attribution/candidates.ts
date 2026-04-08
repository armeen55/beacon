import type { ChangelogEntry } from "@/domains/changelog/types";
import type { Result } from "@/domains/results/types";
import type { Opportunity } from "@/domains/opportunities/types";
import type { Attribution, MatchStrength } from "./types";
import {
  computeAttribution,
  computeConfidenceScore,
  EVIDENCE_TIER_BONUS,
  EVIDENCE_TIER_CAP,
} from "./compute";
import { candidateLinks } from "./store";
import { ATTRIBUTION_CONFIG } from "./config";
import { classifyEvidenceTier } from "@/domains/pages/evidence-tier";
import type { EvidenceTier } from "@/domains/pages/types";

export type CandidateResult = {
  change: ChangelogEntry;
  attribution: Attribution;
  score: number;
};

// ── Pre-score pruning ───────────────────────────────────────────────

const EXCLUDED_SIGNAL_TYPES = new Set<string>(["measurement", "lead_form"]);

const BASELINE_PATTERNS = [
  /captured.*baseline/i,
  /first clean baseline/i,
  /baseline.*snapshot/i,
];

function shouldExcludeChange(change: ChangelogEntry): boolean {
  if (EXCLUDED_SIGNAL_TYPES.has(change.signal_type)) return true;
  const desc = change.change_description ?? "";
  return BASELINE_PATTERNS.some((p) => p.test(desc));
}

// ── Signal quality gates ────────────────────────────────────────────

/**
 * Require at least one content-specific factor (topic or URL),
 * OR both structural factors (geo + sourceCategory) together.
 * A single structural factor alone is too permissive.
 */
function hasMeaningfulSignal(matches: Attribution["matches"]): boolean {
  const meaningful = (m: MatchStrength) => m === "strong" || m === "partial";
  if (meaningful(matches.topic) || meaningful(matches.url)) return true;
  return meaningful(matches.geo) && meaningful(matches.sourceCategory);
}

/**
 * Post-score hard negatives: eliminate structurally impossible candidates.
 * Only fires when there is no content relevance (topic + url both miss).
 */
function isHardNegative(matches: Attribution["matches"]): boolean {
  const noContent =
    (matches.topic === "none" || matches.topic === "unknown") &&
    (matches.url === "none" || matches.url === "unknown");
  if (!noContent) return false;

  if (matches.temporal === "none") return true;
  if (matches.platform === "none") return true;
  return false;
}

// ── Score adjustments ───────────────────────────────────────────────

/**
 * When a candidate has no content relevance (topic + URL both miss),
 * cap its score so it can't auto-resolve or crowd out content-relevant
 * candidates. These matches rely only on structural/temporal signals
 * and need operator review if they survive at all.
 */
const NO_CONTENT_SCORE_CAP = 45;

function adjustScore(
  rawScore: number,
  tier: EvidenceTier | null,
  matches: Attribution["matches"]
): number {
  let score = rawScore;

  if (tier) {
    score = Math.min(
      score + EVIDENCE_TIER_BONUS[tier],
      EVIDENCE_TIER_CAP[tier]
    );
  }

  const noContent =
    (matches.topic === "none" || matches.topic === "unknown") &&
    (matches.url === "none" || matches.url === "unknown");
  if (noContent) {
    score = Math.min(score, NO_CONTENT_SCORE_CAP);
  }

  return score;
}

// ── Main discovery ──────────────────────────────────────────────────

export function discoverCandidates(
  result: Result,
  allChanges: ChangelogEntry[],
  allOpportunities: Opportunity[],
  options?: { maxDays?: number; minScore?: number; topK?: number }
): CandidateResult[] {
  const { maxDays, minScore, topK } = ATTRIBUTION_CONFIG.discovery;
  const maxDaysResolved = options?.maxDays ?? maxDays;
  const minScoreResolved = options?.minScore ?? minScore;
  const topKResolved = options?.topK ?? topK;

  const resultDate = new Date(result.snapshot_date).getTime();

  const excludeIds = new Set([
    ...result.attributed_changelog_ids,
    ...candidateLinks
      .filter(
        (cl) => cl.result_id === result.id && cl.status === "rejected"
      )
      .map((cl) => cl.change_id),
  ]);

  return allChanges
    .filter((change) => {
      if (excludeIds.has(change.id)) return false;
      if (shouldExcludeChange(change)) return false;
      const changeDate = new Date(change.timestamp).getTime();
      const diffDays = (resultDate - changeDate) / (1000 * 60 * 60 * 24);
      return diffDays >= 0 && diffDays <= maxDaysResolved;
    })
    .map((change) => {
      const evidenceMeta = classifyEvidenceTier(change);
      const attribution = computeAttribution(
        change,
        result,
        allOpportunities,
        evidenceMeta
      );
      const rawScore = computeConfidenceScore(attribution.matches);
      const score = adjustScore(rawScore, evidenceMeta.tier, attribution.matches);
      return { change, attribution, score };
    })
    .filter(
      ({ score, attribution }) =>
        score >= minScoreResolved &&
        hasMeaningfulSignal(attribution.matches) &&
        !isHardNegative(attribution.matches)
    )
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.attribution.temporal_distance_days -
          b.attribution.temporal_distance_days
    )
    .slice(0, topKResolved);
}
