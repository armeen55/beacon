import type { Opportunity } from "./types";

export type FreshnessLevel = "fresh" | "aging" | "stale" | "abandoned";

export type FreshnessStatus = {
  level: FreshnessLevel;
  daysSinceActivity: number;
  message: string;
};

const THRESHOLDS: Record<string, { aging: number; stale: number; abandoned: number }> = {
  critical: { aging: 3, stale: 7, abandoned: 14 },
  high: { aging: 5, stale: 10, abandoned: 21 },
  medium: { aging: 7, stale: 14, abandoned: 30 },
  low: { aging: 14, stale: 21, abandoned: 45 },
};

function getLastActivityDate(opp: Opportunity): Date {
  const dates = [
    opp.updated_at,
    opp.activated_at,
    opp.captured_at,
    opp.last_verified_at,
    opp.assessed_at,
    opp.regressed_at,
  ]
    .filter((d): d is string => d !== null)
    .map((d) => new Date(d).getTime());

  return new Date(Math.max(...dates, new Date(opp.created_at).getTime()));
}

export function getFreshnessStatus(
  opp: Opportunity,
  now: Date = new Date()
): FreshnessStatus {
  const terminalStates = ["captured", "closed", "deferred"] as const;
  if ((terminalStates as readonly string[]).includes(opp.current_status)) {
    return { level: "fresh", daysSinceActivity: 0, message: "" };
  }

  const lastActivity = getLastActivityDate(opp);
  const diffMs = now.getTime() - lastActivity.getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const thresholds = THRESHOLDS[opp.priority] ?? THRESHOLDS.medium;

  let level: FreshnessLevel;
  let message: string;

  if (days >= thresholds.abandoned) {
    level = "abandoned";
    message = `No activity for ${days} days — consider closing or deferring`;
  } else if (days >= thresholds.stale) {
    level = "stale";
    message = `Stale for ${days} days — needs attention`;
  } else if (days >= thresholds.aging) {
    level = "aging";
    message = `${days} days since last activity`;
  } else {
    level = "fresh";
    message = "";
  }

  return { level, daysSinceActivity: days, message };
}
