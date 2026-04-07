import type { ChangelogEntry } from "@/domains/changelog/types";
import type { Result } from "@/domains/results/types";
import type { Brief } from "@/domains/briefs/types";
import type { Opportunity } from "@/domains/opportunities/types";
import { METRIC_DIRECTION } from "@/lib/constants";
import type { SignalType } from "@/lib/constants";
import type {
  Attribution,
  AttributionConfidence,
  AttributionRole,
  MatchStrength,
  ChangeVerdict,
  ChangeVerdictData,
  BriefVerdict,
  BriefVerdictData,
  SignalEffectiveness,
} from "./types";

function matchPlatform(
  change: ChangelogEntry,
  result: Result,
  opportunities: Opportunity[]
): MatchStrength {
  if (result.platform === "all") return "partial";

  const opp = change.opportunity_id
    ? opportunities.find((o) => o.id === change.opportunity_id)
    : null;

  if (!opp) return "unknown";

  if (opp.platforms.includes(result.platform)) return "strong";
  if (opp.platforms.includes("all")) return "partial";

  return "none";
}

function matchTopic(change: ChangelogEntry, result: Result): MatchStrength {
  if (!result.topic || !change.topic_targeted.trim()) return "unknown";

  const changeLower = change.topic_targeted.toLowerCase().trim();
  const resultLower = result.topic.toLowerCase().trim();

  if (changeLower === resultLower) return "strong";

  const changeWords = new Set(changeLower.split(/\s+/).filter((w) => w.length > 2));
  const resultWords = new Set(resultLower.split(/\s+/).filter((w) => w.length > 2));

  if (changeWords.size === 0 || resultWords.size === 0) return "unknown";

  const intersection = [...changeWords].filter((w) => resultWords.has(w)).length;
  const union = new Set([...changeWords, ...resultWords]).size;
  const jaccard = intersection / union;

  if (jaccard >= 0.4) return "partial";
  return "none";
}

function matchUrl(change: ChangelogEntry, result: Result): MatchStrength {
  if (!change.url && !result.url_measured) return "unknown";
  if (!change.url || !result.url_measured) return "unknown";
  if (change.url === result.url_measured) return "strong";

  const changePath = change.url.split("/").slice(0, -1).join("/");
  const resultPath = result.url_measured.split("/").slice(0, -1).join("/");
  if (changePath && resultPath && changePath === resultPath) return "partial";

  return "none";
}

function matchGeo(change: ChangelogEntry, result: Result): MatchStrength {
  if (!change.city_targeted && !result.city) return "unknown";
  if (!change.city_targeted || !result.city) return "unknown";
  if (change.city_targeted.toLowerCase() === result.city.toLowerCase())
    return "strong";
  return "none";
}

function parseImpactWindowDays(window: string | null): number {
  if (!window) return 14;
  const match = window.match(/(\d+)[\s-]*(\d+)?\s*(day|week|month)/i);
  if (!match) return 14;
  const upper = match[2] ? parseInt(match[2]) : parseInt(match[1]);
  const unit = match[3].toLowerCase();
  if (unit.startsWith("day")) return upper;
  if (unit.startsWith("week")) return upper * 7;
  if (unit.startsWith("month")) return upper * 30;
  return 14;
}

function matchTemporal(
  change: ChangelogEntry,
  result: Result
): { strength: MatchStrength; days: number; withinWindow: boolean } {
  const changeDate = new Date(change.timestamp);
  const resultDate = new Date(result.snapshot_date);
  const diffMs = resultDate.getTime() - changeDate.getTime();
  const days = Math.round(diffMs / (1000 * 60 * 60 * 24));

  if (days < 0) return { strength: "none", days: Math.abs(days), withinWindow: false };

  const windowDays = parseImpactWindowDays(change.expected_impact_window);
  const withinWindow = days <= windowDays;
  const withinDoubleWindow = days <= windowDays * 2;

  if (withinWindow) return { strength: "strong", days, withinWindow: true };
  if (withinDoubleWindow) return { strength: "partial", days, withinWindow: false };
  return { strength: "none", days, withinWindow: false };
}

export function computeConfidenceScore(matches: Attribution["matches"]): number {
  const weights = { platform: 25, topic: 25, url: 20, temporal: 20, geo: 10 };
  const strengthValue: Record<MatchStrength, number> = {
    strong: 1.0,
    partial: 0.5,
    unknown: 0.0,
    none: 0.0,
  };

  return Object.entries(matches).reduce(
    (sum, [key, strength]) =>
      sum +
      strengthValue[strength] * weights[key as keyof typeof weights],
    0
  );
}

function scoreToConfidence(score: number): AttributionConfidence {
  if (score >= 75) return "high";
  if (score >= 50) return "medium";
  if (score >= 25) return "low";
  return "uncertain";
}

function buildExplanation(
  matches: Attribution["matches"],
  days: number,
  withinWindow: boolean
): string {
  const parts: string[] = [];

  if (matches.topic === "strong") parts.push("same topic");
  else if (matches.topic === "partial") parts.push("related topic");

  if (matches.url === "strong") parts.push("same URL");
  else if (matches.url === "partial") parts.push("similar URL");
  if (matches.platform === "strong") parts.push("same platform");
  if (matches.geo === "strong") parts.push("same city");

  if (withinWindow) parts.push(`within ${days}d`);
  else if (days > 0) parts.push(`${days}d after change`);

  const unknownCount = Object.values(matches).filter((m) => m === "unknown").length;
  if (unknownCount >= 3) parts.push("limited data");

  if (parts.length === 0) return "Weak signal match";
  return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(", ");
}

export function computeAttribution(
  change: ChangelogEntry,
  result: Result,
  allOpportunities: Opportunity[]
): Attribution {
  const platformMatch = matchPlatform(change, result, allOpportunities);
  const topicMatch = matchTopic(change, result);
  const urlMatch = matchUrl(change, result);
  const geoMatch = matchGeo(change, result);
  const temporal = matchTemporal(change, result);

  const matches: Attribution["matches"] = {
    platform: platformMatch,
    topic: topicMatch,
    url: urlMatch,
    geo: geoMatch,
    temporal: temporal.strength,
  };

  const score = computeConfidenceScore(matches);
  const confidence = scoreToConfidence(score);

  return {
    change_id: change.id,
    result_id: result.id,
    role: "primary",
    confidence,
    matches,
    temporal_distance_days: temporal.days,
    within_impact_window: temporal.withinWindow,
    explanation: buildExplanation(matches, temporal.days, temporal.withinWindow),
  };
}

function assignRoles(attributions: Attribution[]): Attribution[] {
  if (attributions.length === 0) return [];

  const sorted = [...attributions].sort((a, b) => {
    const order: Record<AttributionConfidence, number> = {
      high: 0,
      medium: 1,
      low: 2,
      uncertain: 3,
    };
    return order[a.confidence] - order[b.confidence];
  });

  return sorted.map((attr, i): Attribution => {
    let role: AttributionRole;
    if (i === 0) role = "primary";
    else if (attr.confidence === "high" || attr.confidence === "medium")
      role = "contributing";
    else role = "supporting";
    return { ...attr, role };
  });
}

export function computeAttributionsForResult(
  resultId: string,
  allChanges: ChangelogEntry[],
  allResults: Result[],
  allOpportunities: Opportunity[]
): Attribution[] {
  const result = allResults.find((r) => r.id === resultId);
  if (!result || result.attributed_changelog_ids.length === 0) return [];

  const linkedChanges = allChanges.filter((c) =>
    result.attributed_changelog_ids.includes(c.id)
  );

  const attributions = linkedChanges.map((change) =>
    computeAttribution(change, result, allOpportunities)
  );

  return assignRoles(attributions);
}

function isPositiveDelta(result: Result): boolean {
  if (result.delta == null) return false;
  const dir = METRIC_DIRECTION[result.metric_type];
  return dir === "lower_is_better" ? result.delta < 0 : result.delta > 0;
}

export function computeChangeVerdict(
  change: ChangelogEntry,
  allResults: Result[],
  allOpportunities: Opportunity[]
): ChangeVerdictData {
  const attributed = allResults.filter((r) =>
    r.attributed_changelog_ids.includes(change.id)
  );

  if (attributed.length === 0) {
    return {
      verdict: "pending",
      attributions: [],
      summary: "No results attributed yet",
    };
  }

  const attributions = attributed.map((r) =>
    computeAttribution(change, r, allOpportunities)
  );

  const positive = attributed.filter(isPositiveDelta);
  const negative = attributed.filter(
    (r) => r.delta != null && !isPositiveDelta(r) && r.delta !== 0
  );

  let verdict: ChangeVerdict;
  if (positive.length === attributed.length) {
    verdict = "validated";
  } else if (positive.length > 0 && negative.length === 0) {
    verdict = "partial";
  } else if (negative.length > 0 && positive.length === 0) {
    verdict = "no_impact";
  } else if (positive.length > 0 && negative.length > 0) {
    verdict = "partial";
  } else {
    verdict = "inconclusive";
  }

  const summary =
    verdict === "validated"
      ? `${positive.length} result${positive.length !== 1 ? "s" : ""} show positive impact`
      : verdict === "partial"
        ? `${positive.length} of ${attributed.length} results show positive impact`
        : verdict === "no_impact"
          ? "Results show no positive impact"
          : verdict === "inconclusive"
            ? "Results are inconclusive"
            : "No results attributed yet";

  return { verdict, attributions, summary };
}

export function computeBriefVerdict(brief: Brief): BriefVerdictData {
  const outcomes = brief.expected_outcomes;
  if (outcomes.length === 0) {
    return { verdict: "pending", hit_rate: 0, summary: "No predictions defined" };
  }

  const judged = outcomes.filter((o) => o.verdict !== "pending");
  if (judged.length === 0) {
    return {
      verdict: "pending",
      hit_rate: 0,
      summary: `${outcomes.length} prediction${outcomes.length !== 1 ? "s" : ""} awaiting results`,
    };
  }

  const hits = judged.filter((o) => o.verdict === "hit").length;
  const partials = judged.filter((o) => o.verdict === "partial").length;
  const misses = judged.filter((o) => o.verdict === "missed").length;
  const hit_rate = judged.length > 0 ? (hits + partials * 0.5) / judged.length : 0;

  let verdict: BriefVerdict;
  if (hits === judged.length) {
    verdict = "validated";
  } else if (misses === 0) {
    verdict = "partially_validated";
  } else if (hits === 0 && partials === 0) {
    verdict = "not_validated";
  } else {
    verdict = "mixed";
  }

  const summary =
    verdict === "validated"
      ? `All ${hits} prediction${hits !== 1 ? "s" : ""} validated`
      : verdict === "partially_validated"
        ? `${hits} hit, ${partials} partial of ${judged.length} predictions`
        : verdict === "not_validated"
          ? `${misses} of ${judged.length} predictions missed`
          : `${hits} hit, ${partials} partial, ${misses} missed of ${judged.length}`;

  return { verdict, hit_rate, summary };
}

export function computeSignalEffectiveness(
  allChanges: ChangelogEntry[],
  allResults: Result[],
  allOpportunities: Opportunity[]
): SignalEffectiveness[] {
  const byType = new Map<SignalType, ChangelogEntry[]>();
  for (const c of allChanges) {
    const list = byType.get(c.signal_type) ?? [];
    list.push(c);
    byType.set(c.signal_type, list);
  }

  const effectiveness: SignalEffectiveness[] = [];

  for (const [signal_type, changes] of byType) {
    let withResults = 0;
    let positiveImpact = 0;
    const daysToImpact: number[] = [];

    for (const change of changes) {
      const attributed = allResults.filter((r) =>
        r.attributed_changelog_ids.includes(change.id)
      );

      if (attributed.length > 0) {
        withResults++;
        const hasPositive = attributed.some(isPositiveDelta);
        if (hasPositive) {
          positiveImpact++;
          const firstPositive = attributed
            .filter(isPositiveDelta)
            .sort(
              (a, b) =>
                new Date(a.snapshot_date).getTime() -
                new Date(b.snapshot_date).getTime()
            )[0];
          if (firstPositive) {
            const days = Math.round(
              (new Date(firstPositive.snapshot_date).getTime() -
                new Date(change.timestamp).getTime()) /
                (1000 * 60 * 60 * 24)
            );
            daysToImpact.push(days);
          }
        }
      }
    }

    effectiveness.push({
      signal_type,
      total_changes: changes.length,
      with_results: withResults,
      positive_impact: positiveImpact,
      hit_rate: withResults > 0 ? positiveImpact / withResults : 0,
      average_days_to_impact:
        daysToImpact.length > 0
          ? Math.round(
              daysToImpact.reduce((s, d) => s + d, 0) / daysToImpact.length
            )
          : null,
    });
  }

  return effectiveness.sort((a, b) => b.hit_rate - a.hit_rate);
}
