/**
 * Tier 1B — Replication engine: pattern qualification, target selection, and
 * grouped rollout cards (no separate wave planner).
 */

import type { ScorecardRowWithImpact } from "@/domains/attribution/change-impact";
import type { BeaconRecommendation } from "@/domains/product/recommendation-engine";
import type { MinedPattern } from "@/domains/pages/playbook";
import type { PersistedIssue, RolloutExecution } from "@/domains/pages/issues";
import {
  isRecSuppressedFromMap,
  type RecommendationResponse,
} from "@/domains/product/recommendation-response-store";

// Phase 4 (2026-04-19): removed dependency on experiment-store. "promising_experiment"
// tier retained in the union for existing data/test compat but no code path produces it.
// Will be rebuilt on top of url-change-outcomes `helping` verdicts in a later phase.
export type WinnerTier =
  | "validated"
  | "qualified_partial"
  | "promising_experiment";

export type ReplicationTarget = {
  recId: string;
  targetPageUrl: string;
  targetPagePath: string;
  citationOpportunity: number;
  /** Human-readable match signals */
  similarityReasons: string[];
  observed: string[];
  inferred: string[];
};

export type ReplicationCard = {
  id: string;
  winnerTier: WinnerTier;
  patternId: string | null;
  patternName: string | null;
  sourceChangeId: string | null;
  sourceAssetName: string | null;
  headline: string;
  summaryLine: string;
  confidence: "high" | "medium" | "low";
  /** Short targeting summary — answers "where to apply" (derived from target paths). */
  targetingSummary: string;
  /** Short action verb — answers "what to do" (derived from pattern type). */
  actionVerb: string;
  expectedNextStep: string;
  watchAfter: string;
  targets: ReplicationTarget[];
  cardObserved: string[];
  cardInferred: string[];
};

function normUrl(u: string): string {
  return u.replace(/\/+$/, "").toLowerCase();
}

/**
 * Explicit Tier 1B qualification rules (honest):
 * - validated: attribution verdict validated, positive direction, events linked
 * - qualified_partial: partial verdict only if impact confidence is high and >=2 events
 * - promising_experiment: accepted experiment in promising status for this rec family
 */
export function qualifyWinnerTierFromImpact(
  row: ScorecardRowWithImpact | null,
): WinnerTier | null {
  if (!row || row.totalEventsLinked <= 0 || row.impact.direction !== "positive") {
    return null;
  }
  if (row.verdict === "validated") return "validated";
  if (row.verdict === "partial") {
    if (row.impact.confidence === "high" && row.totalEventsLinked >= 2) {
      return "qualified_partial";
    }
    return null;
  }
  return null;
}

export function isReplicationTargetBlocked(
  targetUrl: string,
  rollouts: RolloutExecution[],
  issues: PersistedIssue[],
): { blocked: boolean; reason?: string } {
  const n = normUrl(targetUrl);
  for (const r of rollouts) {
    if (normUrl(r.targetPage) !== n) continue;
    if (r.verifiedAt) return { blocked: true, reason: "Rollout verified for this URL" };
    if (r.shippedAt) return { blocked: true, reason: "Rollout already shipped" };
  }
  for (const i of issues) {
    if (normUrl(i.pageUrl) !== n) continue;
    if (!i.issueId.startsWith("rollout-")) continue;
    if (
      i.status === "shipped" ||
      i.status === "verified" ||
      i.status === "in_progress"
    ) {
      return { blocked: true, reason: `Rollout issue: ${i.status}` };
    }
  }
  return { blocked: false };
}

function patternNameFrom(patterns: MinedPattern[], id: string | null): string | null {
  if (!id) return null;
  return patterns.find((p) => p.id === id)?.name ?? id.replace(/^pattern-/, "").replace(/-/g, " ");
}

function reasonsForTarget(
  rec: BeaconRecommendation,
  row: ScorecardRowWithImpact | null,
): { similarityReasons: string[]; observed: string[]; inferred: string[] } {
  const similarityReasons: string[] = [];
  const observed: string[] = [];
  const inferred: string[] = [];

  if (rec.citationOpportunity > 0) {
    similarityReasons.push(
      `Citation opportunity: ~${rec.citationOpportunity} citations on this URL`,
    );
    observed.push(`Citation rollup shows ${rec.citationOpportunity} citations (import-backed).`);
  }
  if (rec.type === "cross_page_pattern") {
    similarityReasons.push("Cross-page pattern match (different template, shared signals)");
    inferred.push(
      "Beacon matched location/service terms between source HTML and this page (inferred similarity).",
    );
  } else if (rec.type === "replicate") {
    similarityReasons.push("Same structural pattern as the source change");
    inferred.push(
      "Target was flagged by the same structural playbook pattern as the validated source change (inferred fit).",
    );
  }

  if (row) {
    observed.push(
      `Source change "${row.change.asset_name}" -- ${row.verdict}, ${row.totalEventsLinked} linked visibility event(s), ${row.evidenceTier} confidence.`,
    );
  }

  observed.push("Target gaps and crawl facts come from latest HTML snapshots and citation index.");

  return { similarityReasons, observed, inferred };
}

/**
 * Derive a compact targeting line from target paths.
 * Groups by common path prefix when possible, otherwise lists paths.
 */
function deriveTargetingSummary(targets: ReplicationTarget[]): string {
  if (targets.length === 0) return "";
  const paths = targets.map((t) => t.targetPagePath);
  const prefix = commonPathPrefix(paths);
  if (prefix.length > 1) {
    return `Relevant to ${prefix}* pages (${targets.length})`;
  }
  if (targets.length === 1) {
    return `Relevant to ${paths[0]}`;
  }
  return `Across ${targets.length} similar pages`;
}

function commonPathPrefix(paths: string[]): string {
  if (paths.length <= 1) return "";
  const sorted = [...paths].sort();
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  let i = 0;
  while (i < first.length && first[i] === last[i]) i++;
  const raw = first.slice(0, i);
  const lastSlash = raw.lastIndexOf("/");
  if (lastSlash <= 0) return "";
  return raw.slice(0, lastSlash + 1);
}

function deriveActionVerb(
  recType: string,
  patternName: string | null,
): string {
  if (patternName) {
    const lower = patternName.toLowerCase();
    if (lower.includes("faq")) return "Add FAQ blocks";
    if (lower.includes("schema") || lower.includes("structured"))
      return "Add structured data";
    if (lower.includes("internal link")) return "Strengthen internal links";
    if (lower.includes("content") || lower.includes("copy"))
      return "Enhance page content";
    return `Apply ${patternName} pattern`;
  }
  if (recType === "cross_page_pattern")
    return "Apply structural elements (FAQ/schema/content)";
  return "Apply similar structural changes";
}

export type BuildReplicationCardsOpts = {
  recommendations: BeaconRecommendation[];
  impactRows: ScorecardRowWithImpact[];
  patterns: MinedPattern[];
  rolloutExecutions: RolloutExecution[];
  pageIssues: PersistedIssue[];
  /** recIds already accepted into an experiment (still show in Changes, not duplicate queue) */
  activeExperimentRecIds?: Set<string>;
  /** Map of recId → response for suppression check (defaults to empty). */
  responsesByRecId?: Map<string, RecommendationResponse>;
};

const MAX_TARGETS_PER_CARD = 3;
const MAX_CARDS = 12;

/**
 * Group replicate / cross_page_pattern recs that carry a source change.
 * Fallback replicate recs without sourceChangeId stay in the main engine only -- not Tier 1B cards.
 */
export function buildReplicationCards(opts: BuildReplicationCardsOpts): ReplicationCard[] {
  const { recommendations, impactRows, patterns, rolloutExecutions, pageIssues } = opts;
  const activeExp = opts.activeExperimentRecIds ?? new Set();
  const responsesByRecId = opts.responsesByRecId ?? new Map();

  const rowByChange = new Map<string, ScorecardRowWithImpact>();
  for (const row of impactRows) {
    rowByChange.set(row.change.id, row);
  }

  const eligible = recommendations.filter(
    (r) =>
      !isRecSuppressedFromMap(r.id, responsesByRecId) &&
      (r.type === "replicate" || r.type === "cross_page_pattern") &&
      r.sourceChangeId &&
      r.targetPageUrl,
  );

  type Group = {
    key: string;
    sourceChangeId: string;
    patternId: string | null;
    recs: BeaconRecommendation[];
  };

  const groups = new Map<string, Group>();
  for (const r of eligible) {
    if (activeExp.has(r.id)) continue;
    const key = `${r.sourceChangeId}::${r.patternId ?? r.type}`;
    const g = groups.get(key);
    if (g) g.recs.push(r);
    else {
      groups.set(key, {
        key,
        sourceChangeId: r.sourceChangeId!,
        patternId: r.patternId,
        recs: [r],
      });
    }
  }

  const cards: ReplicationCard[] = [];

  for (const g of groups.values()) {
    const row = rowByChange.get(g.sourceChangeId) ?? null;
    const tierFromImpact = qualifyWinnerTierFromImpact(row);
    if (!tierFromImpact) continue;

    g.recs.sort((a, b) => b.priority - a.priority);

    const targets: ReplicationTarget[] = [];
    const seen = new Set<string>();

    for (const rec of g.recs) {
      if (targets.length >= MAX_TARGETS_PER_CARD) break;
      const url = rec.targetPageUrl!;
      const n = normUrl(url);
      if (seen.has(n)) continue;
      const { blocked } = isReplicationTargetBlocked(url, rolloutExecutions, pageIssues);
      if (blocked) continue;
      seen.add(n);

      const { similarityReasons, observed, inferred } = reasonsForTarget(rec, row);
      targets.push({
        recId: rec.id,
        targetPageUrl: url,
        targetPagePath: rec.targetPagePath ?? url.replace(/^https?:\/\/[^/]+/, ""),
        citationOpportunity: rec.citationOpportunity,
        similarityReasons,
        observed,
        inferred,
      });
    }

    if (targets.length === 0) continue;

    const totalCitOpp = targets.reduce((s, t) => s + t.citationOpportunity, 0);
    const headRec = g.recs[0];
    const patternName = patternNameFrom(patterns, g.patternId);

    if (!patternName && totalCitOpp === 0) continue;
    const asset = row?.change.asset_name ?? "Source change";
    const headline =
      patternName != null
        ? `Observed pattern: ${patternName}`
        : `Observed pattern from "${asset}"`;

    const summaryLine =
      tierFromImpact === "validated"
        ? `Positive trend across ${targets.length} similar page${targets.length !== 1 ? "s" : ""}.`
        : tierFromImpact === "qualified_partial"
          ? `Partial signal across ${targets.length} similar page${targets.length !== 1 ? "s" : ""}.`
          : `Early data across ${targets.length} similar page${targets.length !== 1 ? "s" : ""}.`;

    const confRank = (c: "high" | "medium" | "low") =>
      c === "high" ? 2 : c === "medium" ? 1 : 0;
    let confidence: "high" | "medium" | "low" = headRec.confidence;
    if (tierFromImpact === "qualified_partial" && confRank(confidence) > 1) {
      confidence = "medium";
    }

    const expectedNextStep =
      headRec.type === "cross_page_pattern"
        ? "Consider applying the same structural elements (FAQ/schema/content) to these pages, then verify in Pages."
        : "Consider applying a similar pattern to these pages, then run crawl + watch citations on the next import.";

    const watchAfter =
      "After shipping, re-import visibility data and check whether citations or mentions move for this URL within 1-2 cycles.";

    const cardObserved: string[] = [
      `Source qualification: ${tierFromImpact === "validated" ? "positive trend" : "partial signal"} with positive visibility direction.`,
      `Evidence tier on source: ${row?.evidenceTier ?? "unknown"}.`,
    ];
    const cardInferred: string[] = [
      "Target list is based on playbook, structure, and topic overlap — not proof the page will respond the same way.",
    ];

    cards.push({
      id: `repl-card-${g.key.replace(/[^a-z0-9]+/gi, "-")}`,
      winnerTier: tierFromImpact,
      patternId: g.patternId,
      patternName,
      sourceChangeId: g.sourceChangeId,
      sourceAssetName: row?.change.asset_name ?? null,
      headline,
      summaryLine,
      confidence,
      targetingSummary: deriveTargetingSummary(targets),
      actionVerb: deriveActionVerb(headRec.type, patternName),
      expectedNextStep,
      watchAfter,
      targets,
      cardObserved,
      cardInferred,
    });

    if (cards.length >= MAX_CARDS) break;
  }

  cards.sort((a, b) => {
    const tierOrder = (t: WinnerTier) =>
      t === "validated" ? 0 : t === "qualified_partial" ? 1 : 2;
    const d = tierOrder(a.winnerTier) - tierOrder(b.winnerTier);
    if (d !== 0) return d;
    const ta = a.targets.reduce((s, t) => s + t.citationOpportunity, 0);
    const tb = b.targets.reduce((s, t) => s + t.citationOpportunity, 0);
    return tb - ta;
  });

  return cards;
}

// Phase 4 (2026-04-19): buildPromisingExperimentReplicationHints removed \u2014
// it depended on the experiment-store which is gone.

const MAX_PROMISING_CARDS = 2;

/**
 * Soft signal seed: replicate / cross_page recs that used to be promoted by
 * experiment status. After Phase 4 (experiment-store removal), this function
 * is a no-op returning an empty list. A future phase will rebuild it on top
 * of url-change-outcomes `helping` verdicts.
 */
export function buildPromisingReplicationCards(
  _experiments: unknown[],
  recommendations: BeaconRecommendation[],
  impactRows: ScorecardRowWithImpact[],
  patterns: MinedPattern[],
  rolloutExecutions: RolloutExecution[],
  pageIssues: PersistedIssue[],
  excludeRecIds: Set<string>,
): ReplicationCard[] {
  void recommendations; void impactRows; void patterns; void rolloutExecutions; void pageIssues; void excludeRecIds;
  void MAX_PROMISING_CARDS;
  return [];
}
