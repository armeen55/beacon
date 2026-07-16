import type { ActionBucket, StalenessBand } from "./types";
import type { ActionCluster } from "@/domains/action-clusters/types";

/**
 * Score an action for prioritization.
 * system_fix actions can outrank growth actions when trust quality is blocked.
 */
export function scoreAction(
  cluster: ActionCluster,
  actionType: string,
  bucket: ActionBucket
): { priorityScore: number; urgency: number } {
  const base = cluster.score;
  const clusterUrgency = cluster.urgency;

  let multiplier = 1;
  let urgencyBonus = 0;

  switch (bucket) {
    case "do_now":
      multiplier = 1.5;
      urgencyBonus = 30;
      break;
    case "system_fix":
      multiplier = 1.3;
      urgencyBonus = 25;
      break;
    case "do_this_week":
      multiplier = 1.1;
      urgencyBonus = 10;
      break;
    case "monitor":
      multiplier = 0.6;
      break;
    case "deprioritized":
      multiplier = 0.3;
      break;
  }

  if (actionType === "fix_changelog_coverage" || actionType === "fix_matching_quality") {
    urgencyBonus += 15;
  }

  if (cluster.confidenceBand === "high") {
    multiplier += 0.15;
  }

  if (cluster.attributedEventCount >= 3) {
    multiplier += 0.1;
  }

  const priorityScore = Math.round(base * multiplier + urgencyBonus);
  const urgency = Math.min(100, clusterUrgency + urgencyBonus);

  return { priorityScore: Math.min(100, priorityScore), urgency };
}

export function computeStalenessBand(
  latestEventDate: string,
  nowMs: number = Date.now()
): StalenessBand {
  const daysSince = (nowMs - new Date(latestEventDate).getTime()) / 86_400_000;
  if (daysSince <= 7) return "fresh";
  if (daysSince <= 21) return "aging";
  return "stale";
}
