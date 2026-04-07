import type { Opportunity } from "./types";
import type { Competitor, CompetitorSnapshot } from "@/domains/competitors/types";
import type { ThreatLevel } from "@/lib/constants";

export type CompetitiveThreat = {
  competitor: Competitor;
  isPrimary: boolean;
  threatLevel: ThreatLevel;
  latestSnapshot: CompetitorSnapshot | null;
  trend: "improving" | "stable" | "declining" | "unknown";
};

export type CompetitiveLandscape = {
  threats: CompetitiveThreat[];
  overallThreatLevel: ThreatLevel;
  dominantCompetitor: Competitor | null;
};

function computeTrend(
  snapshots: CompetitorSnapshot[],
  platforms: string[]
): "improving" | "stable" | "declining" | "unknown" {
  const relevant = snapshots
    .filter((s) => platforms.includes(s.platform))
    .sort(
      (a, b) =>
        new Date(b.snapshot_date).getTime() -
        new Date(a.snapshot_date).getTime()
    );

  if (relevant.length < 2) return "unknown";

  const latest = relevant[0];
  const previous = relevant[1];

  if (latest.visibility_rank != null && previous.visibility_rank != null) {
    const delta = previous.visibility_rank - latest.visibility_rank;
    if (delta > 0) return "improving";
    if (delta < 0) return "declining";
    return "stable";
  }

  if (latest.citation_share != null && previous.citation_share != null) {
    const delta = latest.citation_share - previous.citation_share;
    if (delta > 2) return "improving";
    if (delta < -2) return "declining";
    return "stable";
  }

  return "unknown";
}

function computeThreatLevel(
  snapshot: CompetitorSnapshot | null,
  trend: "improving" | "stable" | "declining" | "unknown"
): ThreatLevel {
  if (!snapshot) return "low";

  const rank = snapshot.visibility_rank ?? 10;
  let base: ThreatLevel;

  if (rank <= 1) base = "critical";
  else if (rank <= 3) base = "high";
  else if (rank <= 5) base = "medium";
  else base = "low";

  if (trend === "improving" && base !== "critical") {
    const escalation: Record<ThreatLevel, ThreatLevel> = {
      none: "low",
      low: "medium",
      medium: "high",
      high: "critical",
      critical: "critical",
    };
    return escalation[base];
  }

  return base;
}

export function computeCompetitiveLandscape(
  opp: Opportunity,
  allCompetitors: Competitor[],
  allSnapshots: CompetitorSnapshot[]
): CompetitiveLandscape {
  if (opp.competitor_ids.length === 0) {
    return {
      threats: [],
      overallThreatLevel: "none",
      dominantCompetitor: null,
    };
  }

  const threats: CompetitiveThreat[] = [];
  for (const cid of opp.competitor_ids) {
    const competitor = allCompetitors.find((c) => c.id === cid);
    if (!competitor) continue;

    const competitorSnapshots = allSnapshots.filter(
      (s) => s.competitor_id === cid
    );
    const relevantSnapshots = competitorSnapshots.filter((s) =>
      opp.platforms.includes(s.platform)
    );
    const latestSnapshot: CompetitorSnapshot | null =
      relevantSnapshots.sort(
        (a, b) =>
          new Date(b.snapshot_date).getTime() -
          new Date(a.snapshot_date).getTime()
      )[0] ?? null;

    const trend = computeTrend(competitorSnapshots, opp.platforms);
    const threatLevel = computeThreatLevel(latestSnapshot, trend);

    threats.push({
      competitor,
      isPrimary: cid === opp.primary_competitor_id,
      threatLevel,
      latestSnapshot,
      trend,
    });
  }

  const threatOrder: ThreatLevel[] = [
    "critical",
    "high",
    "medium",
    "low",
    "none",
  ];
  const overallThreatLevel =
    threats.length > 0
      ? threats.reduce((worst, t) =>
          threatOrder.indexOf(t.threatLevel) <
          threatOrder.indexOf(worst.threatLevel)
            ? t
            : worst
        ).threatLevel
      : "none";

  const dominantCompetitor =
    threats.find((t) => t.isPrimary)?.competitor ??
    threats[0]?.competitor ??
    null;

  return { threats, overallThreatLevel, dominantCompetitor };
}
