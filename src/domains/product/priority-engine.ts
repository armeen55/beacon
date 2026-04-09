/**
 * Priority Engine — ranks all possible actions and selects the single
 * highest-leverage move the operator should execute right now.
 *
 * Scoring dimensions (0-100 composite):
 *   - Impact confidence (0-25)
 *   - Evidence strength (0-20)
 *   - Pattern strength (0-15)
 *   - Replication potential (0-15)
 *   - Type urgency (0-15)
 *   - Recency (0-10)
 */

import type { BeaconRecommendation } from "./recommendation-engine";
import type { ScorecardRowWithImpact } from "@/domains/attribution/change-impact";
import type { MinedPattern } from "@/domains/pages/playbook";
import type { EvidenceTier } from "@/domains/pages/types";
import type { PatternTrackRecord } from "./recommendation-tracker";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PriorityBucket =
  | "critical"
  | "high_leverage"
  | "opportunistic"
  | "noise";

export type PrioritizedAction = BeaconRecommendation & {
  priorityScore: number;
  bucket: PriorityBucket;
  expectedOutcome: string;
  replicablePages: number;
};

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

const BUCKET_THRESHOLDS: Record<PriorityBucket, number> = {
  critical: 72,
  high_leverage: 50,
  opportunistic: 25,
  noise: 0,
};

function classifyBucket(score: number): PriorityBucket {
  if (score >= BUCKET_THRESHOLDS.critical) return "critical";
  if (score >= BUCKET_THRESHOLDS.high_leverage) return "high_leverage";
  if (score >= BUCKET_THRESHOLDS.opportunistic) return "opportunistic";
  return "noise";
}

function scoreDimension(
  rec: BeaconRecommendation,
  sourceRow: ScorecardRowWithImpact | undefined,
  pattern: MinedPattern | undefined,
  replicableCount: number,
  trackRecord: PatternTrackRecord | undefined,
): number {
  let s = 0;

  // Impact confidence (0-25)
  s += rec.confidence === "high" ? 25 : rec.confidence === "medium" ? 15 : 5;

  // Evidence strength from source change (0-20)
  if (sourceRow) {
    const tier: EvidenceTier = sourceRow.evidenceTier;
    s +=
      tier === "exact"
        ? 20
        : tier === "probable"
          ? 14
          : tier === "weak"
            ? 6
            : 2;
  }

  // Pattern strength (0-15) — only meaningful for replicate recs
  if (pattern) {
    s +=
      pattern.strength === "validated"
        ? 15
        : pattern.strength === "probable"
          ? 9
          : 4;
  }

  // Replication potential (0-15) — how many more pages the same move scales to
  const capped = Math.min(replicableCount, 10);
  s += Math.round((capped / 10) * 15);

  // Type urgency (0-15) — investigate is urgent, replicate is proactive
  if (rec.type === "investigate") s += 15;
  else if (rec.type === "replicate") s += 8;
  else s += 3;

  // Recency (0-10) — fresher source signals are more relevant
  if (sourceRow) {
    const fresh = Math.max(0, 1 - sourceRow.daysSinceChange / 90);
    s += Math.round(fresh * 10);
  } else {
    s += 5; // neutral when no source row
  }

  // Pattern track record (-5 to +10) — reward patterns that historically
  // produce good outcomes, penalize those with poor results
  if (trackRecord && trackRecord.actedOn >= 2) {
    const r = trackRecord.successRate;
    if (r >= 0.7) s += 10;
    else if (r >= 0.5) s += 6;
    else if (r >= 0.3) s += 2;
    else if (r > 0 && trackRecord.negative > 0) s -= 5;
  }

  return Math.max(0, Math.min(s, 100));
}

// ---------------------------------------------------------------------------
// Expected outcome generation
// ---------------------------------------------------------------------------

const PLAT_LABELS: Record<string, string> = {
  chatgpt: "ChatGPT",
  google_aio: "AI Overviews",
  perplexity: "Perplexity",
};

function generateExpectedOutcome(
  rec: BeaconRecommendation,
  sourceRow: ScorecardRowWithImpact | undefined,
  replicableCount: number,
): string {
  if (rec.type === "investigate") {
    const topics = sourceRow?.topics.slice(0, 2).join(", ") ?? "affected topics";
    return `Identify the root cause of visibility decline for ${topics}. Prevents further loss and informs whether to revert.`;
  }

  if (rec.type === "strengthen") {
    const events = sourceRow?.totalEventsLinked ?? 0;
    return `Filling evidence gaps could auto-resolve ${events} attribution event${events !== 1 ? "s" : ""} and upgrade this change from ${sourceRow?.evidenceTier ?? "weak"} to probable or exact evidence.`;
  }

  // replicate
  if (sourceRow) {
    const platforms = sourceRow.platforms
      .map((p) => PLAT_LABELS[p] ?? p)
      .join(", ");
    const topics = sourceRow.topics.slice(0, 2).join(", ");
    const scale =
      replicableCount > 1
        ? ` Pattern applies to ${replicableCount} additional pages.`
        : "";
    return `Visibility improvement for ${topics || "target topics"}${platforms ? ` on ${platforms}` : ""}, based on ${sourceRow.totalEventsLinked} proven event${sourceRow.totalEventsLinked !== 1 ? "s" : ""} from similar change.${scale}`;
  }

  if (rec.citationOpportunity > 0) {
    return `Structural gap on a page with ${rec.citationOpportunity} existing citations. Adding the missing structure should improve AI platform comprehension.`;
  }

  return "Applying a validated structural pattern to close an identified gap.";
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function rankAndSelect(opts: {
  recommendations: BeaconRecommendation[];
  impactRows: ScorecardRowWithImpact[];
  patterns: MinedPattern[];
  briefPatternCounts: Map<string, number>;
  patternTrackRecords?: PatternTrackRecord[];
}): {
  primaryAction: PrioritizedAction | null;
  secondary: PrioritizedAction[];
} {
  const changeIndex = new Map<string, ScorecardRowWithImpact>();
  for (const row of opts.impactRows) {
    changeIndex.set(row.change.id, row);
  }
  const patternIndex = new Map<string, MinedPattern>();
  for (const p of opts.patterns) {
    patternIndex.set(p.id, p);
  }
  const trackIndex = new Map<string, PatternTrackRecord>();
  if (opts.patternTrackRecords) {
    for (const tr of opts.patternTrackRecords) {
      trackIndex.set(tr.patternId, tr);
    }
  }

  const prioritized: PrioritizedAction[] = opts.recommendations.map((rec) => {
    const sourceRow = rec.sourceChangeId
      ? changeIndex.get(rec.sourceChangeId)
      : undefined;
    const pattern = rec.patternId
      ? patternIndex.get(rec.patternId)
      : undefined;
    const replicable = rec.patternId
      ? (opts.briefPatternCounts.get(rec.patternId) ?? 0)
      : 0;
    const trackRecord = rec.patternId
      ? trackIndex.get(rec.patternId)
      : undefined;

    const priorityScore = scoreDimension(
      rec,
      sourceRow,
      pattern,
      replicable,
      trackRecord,
    );
    const bucket = classifyBucket(priorityScore);
    const expectedOutcome = generateExpectedOutcome(rec, sourceRow, replicable);

    return {
      ...rec,
      priorityScore,
      bucket,
      expectedOutcome,
      replicablePages: replicable,
    };
  });

  prioritized.sort((a, b) => b.priorityScore - a.priorityScore);

  const nonNoise = prioritized.filter((a) => a.bucket !== "noise");
  const primary = nonNoise[0] ?? null;
  const secondary = primary ? nonNoise.slice(1) : nonNoise;

  return { primaryAction: primary, secondary };
}
