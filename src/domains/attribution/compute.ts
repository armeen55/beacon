import type { ChangelogEntry } from "@/domains/changelog/types";
import type { Result } from "@/domains/results/types";
import type { Brief } from "@/domains/briefs/types";
import type { Opportunity } from "@/domains/opportunities/types";
import type { EvidenceTier, EvidenceTierMeta } from "@/domains/pages/types";
import { normalizePageUrl, canonicalizeOwnedUrl } from "@/domains/pages/classify";
import { getSiteConfig } from "@/lib/site-config";
import { METRIC_DIRECTION } from "@/lib/constants";
import type { Platform, SignalType } from "@/lib/constants";
import {
  ATTRIBUTION_CONFIG,
  SIGNAL_PLATFORM_MAP,
  ASSET_PLATFORM_BOOST,
  SOURCE_CATEGORY_PLATFORM_WEIGHTS,
  GEO_CONTAINMENT,
  KNOWN_TOPICS,
  PLATFORM_MAX_DAYS,
} from "./config";
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

// ── Topic matching ──────────────────────────────────────────────────

/**
 * Extract the city name embedded in a prompt-topic string.
 * "Menlo Park Construction" → "menlo park"
 * "Shield: Custom Home Builder Bay Area" → "bay area"
 */
function extractTopicCity(topic: string): string | null {
  const lower = topic.toLowerCase();
  const allCities = Object.values(GEO_CONTAINMENT).flat();
  for (const metro of Object.keys(GEO_CONTAINMENT)) {
    if (lower.includes(metro)) return metro;
  }
  for (const city of allCities) {
    if (lower.includes(city)) return city;
  }
  return null;
}

/**
 * Check if a change's topic_targeted aligns with a result's topic
 * from the known prompt-topic list.
 */
function matchTopicSemantic(
  changeTopic: string,
  resultTopic: string
): MatchStrength {
  const cLower = changeTopic.toLowerCase().trim();
  const rLower = resultTopic.toLowerCase().trim();

  if (cLower === rLower) return "strong";

  const resultCity = extractTopicCity(resultTopic);
  const changeCity = extractTopicCity(changeTopic);

  if (resultCity && changeCity && resultCity === changeCity) return "strong";

  if (resultCity && cLower.includes(resultCity)) return "strong";
  if (changeCity && rLower.includes(changeCity)) return "partial";

  const isKnownTopic = KNOWN_TOPICS.some(
    (t) => t.toLowerCase() === rLower
  );
  if (isKnownTopic) {
    const topicWords = new Set(
      rLower
        .replace(/[():/\-]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 2)
    );
    const changeWords = new Set(
      cLower
        .replace(/[():/\-]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 2)
    );

    const intersection = [...topicWords].filter((w) => changeWords.has(w)).length;
    if (topicWords.size > 0 && intersection / topicWords.size >= 0.5) return "partial";
  }

  return jaccardMatch(changeTopic, resultTopic);
}

function jaccardMatch(left: string, right: string): MatchStrength {
  const minLen = ATTRIBUTION_CONFIG.matching.topicMinWordLength;
  const jaccardPartial = ATTRIBUTION_CONFIG.matching.topicJaccardPartial;

  const leftWords = new Set(
    left.toLowerCase().split(/\s+/).filter((w) => w.length > minLen)
  );
  const rightWords = new Set(
    right.toLowerCase().split(/\s+/).filter((w) => w.length > minLen)
  );

  if (leftWords.size === 0 || rightWords.size === 0) return "unknown";

  const intersection = [...leftWords].filter((w) => rightWords.has(w)).length;
  const union = new Set([...leftWords, ...rightWords]).size;
  const jaccard = intersection / union;

  if (jaccard >= jaccardPartial) return "partial";
  return "none";
}

function matchTopic(
  change: ChangelogEntry,
  result: Result,
  opportunities: Opportunity[]
): MatchStrength {
  if (!result.topic?.trim() || !change.topic_targeted?.trim()) return "unknown";

  const directMatch = matchTopicSemantic(change.topic_targeted, result.topic);
  if (directMatch === "strong") return "strong";

  const opp = change.opportunity_id
    ? opportunities.find((o) => o.id === change.opportunity_id)
    : null;

  if (opp?.topic) {
    const oppMatch = matchTopicSemantic(opp.topic, result.topic);
    if (oppMatch === "strong") return "strong";
    if (oppMatch === "partial" && directMatch !== "partial") return "partial";
  }

  return directMatch;
}

// ── Platform matching (signal-type inference) ───────────────────────

function matchSignalPlatform(
  change: ChangelogEntry,
  result: Result,
  opportunities: Opportunity[]
): MatchStrength {
  if (result.platform === "all") return "partial";

  const opp = change.opportunity_id
    ? opportunities.find((o) => o.id === change.opportunity_id)
    : null;

  if (opp) {
    if (opp.platforms.includes(result.platform)) return "strong";
    if (opp.platforms.includes("all")) return "partial";
    return "none";
  }

  const expectedPlatforms = SIGNAL_PLATFORM_MAP[change.signal_type] ?? [];
  if (expectedPlatforms.length === 0) return "none";

  const platform = result.platform as Platform;
  if (expectedPlatforms.includes(platform)) {
    const boost = ASSET_PLATFORM_BOOST[change.asset_type]?.[platform] ?? 0;
    return boost > 0.05 ? "strong" : "partial";
  }

  return "none";
}

// ── Source-category matching ────────────────────────────────────────

function matchSourceCategory(
  change: ChangelogEntry,
  result: Result
): MatchStrength {
  const platform = result.platform;
  if (platform === "all") return "unknown";

  const weights = SOURCE_CATEGORY_PLATFORM_WEIGHTS[change.asset_type];
  if (!weights) return "unknown";

  const relevance = weights[platform] ?? 0;
  if (relevance >= 0.8) return "strong";
  if (relevance >= 0.4) return "partial";
  if (relevance > 0) return "unknown";
  return "none";
}

// ── URL matching ────────────────────────────────────────────────────

function matchUrl(change: ChangelogEntry, result: Result): MatchStrength {
  if (!change.url && !result.url_measured) return "unknown";
  if (!change.url || !result.url_measured) return "unknown";

  const { siteDomain } = getSiteConfig();
  const cp = normalizeAndCanonicalize(change.url, siteDomain);
  const rp = normalizeAndCanonicalize(result.url_measured, siteDomain);

  if (!cp || !rp) {
    if (change.url === result.url_measured) return "strong";
    return "unknown";
  }

  if (cp.url === rp.url) return "strong";
  if (cp.domain === rp.domain && cp.path === rp.path) return "strong";

  if (cp.domain === rp.domain) {
    const cDir = cp.path.replace(/\/[^/]*$/, "");
    const rDir = rp.path.replace(/\/[^/]*$/, "");
    if (cDir && rDir && cDir === rDir) return "partial";
  }

  return "none";
}

function normalizeAndCanonicalize(
  raw: string,
  siteDomain: string,
): { url: string; domain: string; path: string } | null {
  const parsed = normalizePageUrl(raw, siteDomain);
  if (!parsed) return null;
  return canonicalizeOwnedUrl(parsed);
}

// ── Geo matching (with containment) ─────────────────────────────────

function matchGeo(change: ChangelogEntry, result: Result): MatchStrength {
  if (!change.city_targeted && !result.city) return "unknown";
  if (!change.city_targeted || !result.city) return "unknown";

  const changeLower = change.city_targeted.toLowerCase().trim();
  const resultLower = result.city.toLowerCase().trim();

  if (changeLower === resultLower) return "strong";

  for (const [metro, cities] of Object.entries(GEO_CONTAINMENT)) {
    const changeIsMetro = changeLower === metro;
    const resultIsMetro = resultLower === metro;
    const changeIsChild = cities.includes(changeLower);
    const resultIsChild = cities.includes(resultLower);

    if (changeIsMetro && resultIsChild) return "partial";
    if (resultIsMetro && changeIsChild) return "strong";

    if (changeIsChild && resultIsChild) return "partial";
  }

  return "none";
}

// ── Temporal matching ───────────────────────────────────────────────

function parseImpactWindowDays(window: string | null): number {
  if (!window) return 14;
  const match = window.match(/(\d+)[\s\u2013-]*(\d+)?\s*(day|week|month)/i);
  if (!match) return 14;
  const upper = match[2] ? parseInt(match[2], 10) : parseInt(match[1], 10);
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
  const platformMax = PLATFORM_MAX_DAYS[result.platform as Platform] ?? ATTRIBUTION_CONFIG.discovery.maxDays;
  const effectiveWindow = Math.min(windowDays, platformMax);

  const withinWindow = days <= effectiveWindow;
  const withinDoubleWindow = days <= effectiveWindow * 2;

  if (withinWindow) return { strength: "strong", days, withinWindow: true };
  if (withinDoubleWindow) return { strength: "partial", days, withinWindow: false };
  return { strength: "none", days, withinWindow: false };
}

// ── Scoring ─────────────────────────────────────────────────────────

export function computeConfidenceScore(matches: Attribution["matches"]): number {
  const weights = ATTRIBUTION_CONFIG.weights as Record<string, number>;
  const sv = ATTRIBUTION_CONFIG.strengthValue as Record<string, number>;

  return Object.entries(matches).reduce(
    (sum, [key, strength]) =>
      sum + (sv[strength] ?? 0) * (weights[key] ?? 0),
    0
  );
}

export function computeFactorScores(matches: Attribution["matches"]): Record<string, number> {
  const weights = ATTRIBUTION_CONFIG.weights as Record<string, number>;
  const sv = ATTRIBUTION_CONFIG.strengthValue as Record<string, number>;
  const scores: Record<string, number> = {};
  for (const [key, strength] of Object.entries(matches)) {
    scores[key] = (sv[strength] ?? 0) * (weights[key] ?? 0);
  }
  return scores;
}

function scoreToConfidence(score: number): AttributionConfidence {
  const { confidence } = ATTRIBUTION_CONFIG;
  if (score >= confidence.high) return "high";
  if (score >= confidence.medium) return "medium";
  if (score >= confidence.low) return "low";
  return "uncertain";
}

// ── Explanation ─────────────────────────────────────────────────────

function buildExplanation(
  matches: Attribution["matches"],
  days: number,
  withinWindow: boolean
): string {
  const parts: string[] = [];

  if (matches.topic === "strong") parts.push("same topic");
  else if (matches.topic === "partial") parts.push("related topic");

  if (matches.sourceCategory === "strong") parts.push("high-relevance change type");
  else if (matches.sourceCategory === "partial") parts.push("relevant change type");

  if (matches.url === "strong") parts.push("same URL");
  else if (matches.url === "partial") parts.push("similar URL");

  if (matches.platform === "strong") parts.push("expected platform");
  else if (matches.platform === "partial") parts.push("likely platform");

  if (matches.geo === "strong") parts.push("same city");
  else if (matches.geo === "partial") parts.push("same metro");

  if (withinWindow) parts.push(`within ${days}d`);
  else if (days > 0) parts.push(`${days}d after change`);

  const unknownCount = Object.values(matches).filter((m) => m === "unknown").length;
  if (unknownCount >= 4) parts.push("limited data");

  if (parts.length === 0) return "Weak signal match";
  return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(", ");
}

// ── Main computation ────────────────────────────────────────────────

export const EVIDENCE_TIER_BONUS: Record<EvidenceTier, number> = {
  exact: 8,
  probable: 0,
  weak: 0,
  inferred: 0,
};

export const EVIDENCE_TIER_CAP: Record<EvidenceTier, number> = {
  exact: 100,
  probable: 85,
  weak: 55,
  inferred: 50,
};

export function computeAttribution(
  change: ChangelogEntry,
  result: Result,
  allOpportunities: Opportunity[],
  evidenceMeta?: EvidenceTierMeta | null
): Attribution {
  const platformMatch = matchSignalPlatform(change, result, allOpportunities);
  const topicMatch = matchTopic(change, result, allOpportunities);
  const urlMatch = matchUrl(change, result);
  const geoMatch = matchGeo(change, result);
  const temporal = matchTemporal(change, result);
  const sourceCatMatch = matchSourceCategory(change, result);

  const matches: Attribution["matches"] = {
    platform: platformMatch,
    topic: topicMatch,
    url: urlMatch,
    geo: geoMatch,
    temporal: temporal.strength,
    sourceCategory: sourceCatMatch,
  };

  let score = computeConfidenceScore(matches);
  const factor_scores = computeFactorScores(matches);

  const tier = evidenceMeta?.tier ?? null;
  if (tier) {
    score = Math.min(score + EVIDENCE_TIER_BONUS[tier], EVIDENCE_TIER_CAP[tier]);
  }

  const confidence = scoreToConfidence(score);

  return {
    change_id: change.id,
    result_id: result.id,
    role: "primary",
    confidence,
    matches,
    factor_scores,
    evidence_tier: tier,
    temporal_distance_days: temporal.days,
    within_impact_window: temporal.withinWindow,
    explanation: buildExplanation(matches, temporal.days, temporal.withinWindow),
  };
}

// ── Roles ───────────────────────────────────────────────────────────

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

// ── Change verdict ──────────────────────────────────────────────────

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

// ── Brief verdict ───────────────────────────────────────────────────

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

// ── Signal effectiveness (kept for diagnostics) ─────────────────────

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
