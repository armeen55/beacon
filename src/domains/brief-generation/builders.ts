import type { ActionItem } from "@/domains/actions/types";
import type { ActionCluster } from "@/domains/action-clusters/types";
import type { Pattern } from "@/domains/patterns/types";
import type { Opportunity } from "@/domains/opportunities/types";
import type { OpportunityCandidate } from "@/domains/opportunity-candidates/types";
import type {
  ProposedBrief,
  ProposedBriefType,
  PersistedBriefState,
} from "./types";
import { getTemplate } from "./templates";
import {
  scoreBrief,
  derivePriority,
  deriveConfidence,
  computeCaveatSeverity,
} from "./scoring";

export function buildProposedBriefs(
  actions: ActionItem[],
  clusters: ActionCluster[],
  patterns: Pattern[],
  opportunities: Opportunity[],
  candidates: OpportunityCandidate[],
  persistedStates: PersistedBriefState[]
): ProposedBrief[] {
  const stateIndex = new Map(persistedStates.map((s) => [s.briefId, s]));
  const clusterIndex = new Map(clusters.map((c) => [c.id, c]));
  const patternIndex = new Map(patterns.map((p) => [p.id, p]));
  const oppIndex = new Map(opportunities.map((o) => [o.id, o]));

  const briefs: ProposedBrief[] = [];
  const seenKeys = new Set<string>();

  for (const action of actions) {
    if (
      action.bucket !== "do_now" &&
      action.bucket !== "do_this_week" &&
      action.bucket !== "system_fix"
    )
      continue;

    if (action.status === "done" || action.status === "dismissed") continue;

    const cluster = clusterIndex.get(action.clusterId) ?? null;

    // Raised thresholds: only generate briefs when evidence is real
    if (action.actionType === "monitor_cluster" || action.actionType === "deprioritize_pattern") continue;
    if (cluster && cluster.confidenceBand === "insufficient" && action.actionType !== "fix_changelog_coverage" && action.actionType !== "fix_matching_quality") continue;
    if (action.priorityScore < 20 && action.bucket !== "system_fix") continue;

    const pattern = action.patternId
      ? patternIndex.get(action.patternId) ?? null
      : null;
    const opp =
      action.recommendedOpportunityIds.length > 0
        ? oppIndex.get(action.recommendedOpportunityIds[0]) ?? null
        : null;

    const dedupeKey = `action:${action.id}`;
    if (seenKeys.has(dedupeKey)) continue;
    seenKeys.add(dedupeKey);

    const brief = buildBriefFromAction(action, cluster, pattern, opp, stateIndex);
    if (brief) briefs.push(brief);
  }

  const promotedOpps = opportunities.filter(
    (o) =>
      o.source === "ai_suggestion" &&
      o.current_status === "new" &&
      o.priority !== "low" &&
      !briefs.some((b) => b.sourceOpportunityId === o.id)
  );

  for (const opp of promotedOpps) {
    const matchingPattern = patterns.find((p) =>
      opp.tags.some((t) => t.startsWith("pattern:") && t === `pattern:${p.label}`)
    ) ?? null;

    const dedupeKey = `opp:${opp.id}`;
    if (seenKeys.has(dedupeKey)) continue;
    seenKeys.add(dedupeKey);

    const brief = buildBriefFromOpportunity(opp, matchingPattern, stateIndex);
    if (brief) briefs.push(brief);
  }

  return deduplicateBriefs(briefs).sort((a, b) => b.score - a.score);
}

function deduplicateBriefs(briefs: ProposedBrief[]): ProposedBrief[] {
  const seen = new Map<string, ProposedBrief>();
  for (const b of briefs) {
    const dedupeKey = `${b.briefType}:${(b.targetTopic ?? "").toLowerCase()}:${(b.targetCity ?? "all").toLowerCase()}`;
    const existing = seen.get(dedupeKey);
    if (!existing || b.score > existing.score) {
      seen.set(dedupeKey, b);
    }
  }
  return [...seen.values()];
}

function buildBriefFromAction(
  action: ActionItem,
  cluster: ActionCluster | null,
  pattern: Pattern | null,
  opp: Opportunity | null,
  stateIndex: Map<string, PersistedBriefState>
): ProposedBrief | null {
  const briefType = deriveBriefType(action, pattern);
  const caveats = gatherCaveats(action, cluster, pattern);
  const assumptions = gatherAssumptions(action, pattern);
  const caveatSeverity = computeCaveatSeverity(caveats);

  const templateCtx = {
    targetCity: cluster?.geoKey !== "—" ? cluster?.geoKey ?? null : null,
    targetTopic: cluster?.topicKey ?? null,
    patternLabel: pattern?.label ?? null,
    patternSuccessRate: pattern?.successRate ?? null,
    opportunityLabel: opp?.title ?? null,
    hasCaveats: caveats.length > 0,
    caveats,
  };

  const template = getTemplate(briefType, templateCtx);

  const evidenceSummary = buildEvidenceSummary(action, cluster, pattern);

  const score = scoreBrief({
    actionPriority: action.priorityScore,
    patternScore: pattern?.score ?? null,
    patternSuccessRate: pattern?.successRate ?? null,
    clusterConfidence: cluster?.confidenceBand ?? null,
    expectedImpact: action.priorityScore,
    caveatCount: caveats.length,
    caveatSeverity,
    executionClarity: template.recommendedSteps.length >= 4 ? 80 : 50,
    evidenceSharpness: evidenceSummary.length >= 3 ? 75 : 40,
    dependencyBurden: action.blockingIssue ? 1 : 0,
  });

  const priority = derivePriority(score, action.bucket, caveatSeverity);
  const confidence = deriveConfidence(
    pattern?.confidenceBand ?? null,
    cluster?.confidenceBand ?? null,
    caveats.length
  );

  const briefId = `brief-${action.id}`;
  const persisted = stateIndex.get(briefId);

  return {
    id: briefId,
    sourceActionId: action.id,
    sourceClusterId: action.clusterId,
    sourcePatternId: action.patternId,
    sourceOpportunityId: opp?.id ?? null,
    sourceCandidateId: null,

    title: deriveBriefTitle(action, briefType, cluster, pattern),
    briefType,
    priority,
    confidence,

    objective: deriveObjective(action, briefType, pattern, opp),
    whyThisNow: action.whyNow,
    expectedOutcome: action.expectedOutcome,

    targetEntityLabel: action.clusterLabel,
    targetUrl: null,
    targetTopic: cluster?.topicKey ?? null,
    targetCity: cluster?.geoKey !== "—" ? cluster?.geoKey ?? null : null,
    targetPlatform: cluster?.platformKey ?? "all",

    evidenceSummary,
    caveats,
    assumptions,

    requiredComponents: template.requiredComponents,
    recommendedSteps: template.recommendedSteps,
    blockedBy: action.blockingIssue ? [action.blockingIssue] : [],
    validationChecks: template.validationChecks,
    successCriteria: template.successCriteria,
    followThroughSignals: template.followThroughSignals,

    score,
    status: persisted?.status ?? "proposed",
  };
}

function buildBriefFromOpportunity(
  opp: Opportunity,
  pattern: Pattern | null,
  stateIndex: Map<string, PersistedBriefState>
): ProposedBrief | null {
  const briefType: ProposedBriefType = opp.city
    ? "coverage_expansion"
    : "new_page";

  const caveats: string[] = [];
  if (opp.notes) {
    const lines = opp.notes.split("\n");
    for (const line of lines) {
      if (line.startsWith("⚠")) caveats.push(line.slice(1).trim());
    }
  }

  const assumptions = [
    `Promoted from expansion engine — not yet validated with real execution`,
    ...(pattern
      ? [`Assumes pattern "${pattern.label}" transfers to this context`]
      : []),
  ];

  const caveatSeverity = computeCaveatSeverity(caveats);

  const templateCtx = {
    targetCity: opp.city,
    targetTopic: opp.topic,
    patternLabel: pattern?.label ?? null,
    patternSuccessRate: pattern?.successRate ?? null,
    opportunityLabel: opp.title,
    hasCaveats: caveats.length > 0,
    caveats,
  };
  const template = getTemplate(briefType, templateCtx);

  const evidenceSummary: string[] = [];
  if (pattern) {
    evidenceSummary.push(
      `Source pattern "${pattern.label}" has ${pattern.successRate}% success rate`
    );
    evidenceSummary.push(
      `Pattern executed ${pattern.executionCount} times across ${pattern.clustersImpacted} clusters`
    );
  }
  evidenceSummary.push(`Opportunity promoted from expansion engine`);

  const score = scoreBrief({
    actionPriority: opp.priority === "high" ? 70 : opp.priority === "medium" ? 50 : 30,
    patternScore: pattern?.score ?? null,
    patternSuccessRate: pattern?.successRate ?? null,
    clusterConfidence: null,
    expectedImpact: opp.estimated_impact === "high" ? 75 : 50,
    caveatCount: caveats.length,
    caveatSeverity,
    executionClarity: 60,
    evidenceSharpness: pattern ? 60 : 30,
    dependencyBurden: 0,
  });

  const priority = derivePriority(
    score,
    "do_this_week",
    caveatSeverity
  );
  const confidence = deriveConfidence(
    pattern?.confidenceBand ?? null,
    null,
    caveats.length
  );

  const briefId = `brief-opp-${opp.id}`;
  const persisted = stateIndex.get(briefId);

  return {
    id: briefId,
    sourceActionId: null,
    sourceClusterId: null,
    sourcePatternId: pattern?.id ?? null,
    sourceOpportunityId: opp.id,
    sourceCandidateId: null,

    title: `${briefType === "coverage_expansion" ? "Expand" : "Create"}: ${opp.title}`,
    briefType,
    priority,
    confidence,

    objective: `Create execution plan for "${opp.title}" based on pattern intelligence and expansion analysis.`,
    whyThisNow: opp.description ?? "Promoted opportunity with pattern-backed evidence.",
    expectedOutcome: `New visibility and potential citations for "${opp.topic}"${opp.city ? ` in ${opp.city}` : ""}.`,

    targetEntityLabel: opp.title,
    targetUrl: opp.target_url,
    targetTopic: opp.topic,
    targetCity: opp.city,
    targetPlatform: opp.platforms[0] ?? "all",

    evidenceSummary,
    caveats,
    assumptions,

    requiredComponents: template.requiredComponents,
    recommendedSteps: template.recommendedSteps,
    blockedBy: [],
    validationChecks: template.validationChecks,
    successCriteria: template.successCriteria,
    followThroughSignals: template.followThroughSignals,

    score,
    status: persisted?.status ?? "proposed",
  };
}

function deriveBriefType(
  action: ActionItem,
  pattern: Pattern | null
): ProposedBriefType {
  switch (action.actionType) {
    case "replicate_pattern":
      if (pattern) {
        const key = pattern.patternKey;
        if (key.includes("faq")) return "faq_upgrade";
        if (key.includes("service_page") || key.includes("page"))
          return "coverage_expansion";
        if (key.includes("technical") || key.includes("citation"))
          return "internal_linking";
        if (key.includes("content")) return "page_refresh";
      }
      return "coverage_expansion";
    case "expand_adjacent_opportunity":
      return "coverage_expansion";
    case "fix_changelog_coverage":
      return "measurement_fix";
    case "fix_matching_quality":
      return "measurement_fix";
    case "review_cluster":
      return "page_refresh";
    case "investigate_external":
      return "measurement_fix";
    default:
      return "page_refresh";
  }
}

function deriveBriefTitle(
  action: ActionItem,
  briefType: ProposedBriefType,
  cluster: ActionCluster | null,
  pattern: Pattern | null
): string {
  const target = cluster?.topicKey ?? action.clusterLabel;

  switch (briefType) {
    case "coverage_expansion":
      return `Expand coverage: ${target}${cluster?.geoKey && cluster.geoKey !== "—" ? ` (${cluster.geoKey})` : ""}`;
    case "new_page":
      return `Create new page: ${target}`;
    case "page_rebuild":
      return `Rebuild page: ${target}`;
    case "page_refresh":
      return `Refresh content: ${target}`;
    case "faq_upgrade":
      return `Upgrade FAQ: ${target}`;
    case "schema_alignment":
      return `Align schema: ${target}`;
    case "internal_linking":
      return `Improve internal linking: ${target}`;
    case "crawlability_fix":
      return `Fix crawlability: ${target}`;
    case "measurement_fix":
      return `Fix measurement: ${target}`;
  }
}

function deriveObjective(
  action: ActionItem,
  briefType: ProposedBriefType,
  pattern: Pattern | null,
  opp: Opportunity | null
): string {
  const parts: string[] = [];

  switch (briefType) {
    case "coverage_expansion":
      parts.push(
        `Expand proven ${pattern ? `"${pattern.label}" pattern` : "change strategy"} to ${action.clusterLabel}.`
      );
      if (pattern && pattern.successRate > 0) {
        parts.push(
          `Pattern has ${pattern.successRate}% historical success rate.`
        );
      }
      break;
    case "faq_upgrade":
      parts.push(
        `Add or improve FAQ content for ${action.clusterLabel} using proven FAQ pattern.`
      );
      break;
    case "measurement_fix":
      parts.push(
        `Fix attribution gaps blocking learning for ${action.clusterLabel}.`
      );
      parts.push(`${action.blockingIssue ?? "Improve metadata quality to enable candidate discovery."}`);
      break;
    default:
      parts.push(`Execute ${briefType.replace(/_/g, " ")} for ${action.clusterLabel}.`);
  }

  if (opp) {
    parts.push(`Linked to opportunity: "${opp.title}".`);
  }

  return parts.join(" ");
}

function buildEvidenceSummary(
  action: ActionItem,
  cluster: ActionCluster | null,
  pattern: Pattern | null
): string[] {
  const evidence: string[] = [];

  if (pattern) {
    evidence.push(
      `Pattern "${pattern.label}": ${pattern.successRate}% success rate, ${pattern.executionCount} executions`
    );
    if (pattern.avgTimeToImpact > 0) {
      evidence.push(
        `Average time to impact: ~${pattern.avgTimeToImpact} days`
      );
    }
    if (pattern.trend === "improving") {
      evidence.push("Pattern trend is improving");
    } else if (pattern.trend === "declining") {
      evidence.push("⚠ Pattern trend is declining — apply with caution");
    }
  }

  if (cluster) {
    evidence.push(
      `Cluster "${cluster.label}": ${cluster.attributedEventCount} attributed events, ${cluster.eventCount} total`
    );
    if (cluster.confirmedChangeIds.length > 0) {
      evidence.push(
        `${cluster.confirmedChangeIds.length} confirmed causal changes`
      );
    }
  }

  evidence.push(`Action priority score: ${action.priorityScore}`);

  return evidence;
}

function gatherCaveats(
  action: ActionItem,
  cluster: ActionCluster | null,
  pattern: Pattern | null
): string[] {
  const caveats: string[] = [];

  if (action.actionType === "replicate_pattern") {
    caveats.push(
      "Pattern replication is a hypothesis, not a guarantee — each new context must be validated independently"
    );
  }

  if (action.actionType === "expand_adjacent_opportunity") {
    caveats.push(
      "Geographic adjacency does not guarantee same search demand or competition level"
    );
    caveats.push(
      "Each city page must have genuinely unique local content to avoid doorway-page risk"
    );
  }

  if (pattern) {
    if (pattern.trend === "declining") {
      caveats.push(
        `Pattern "${pattern.label}" is showing declining effectiveness — replication may yield diminishing returns`
      );
    }
    if (pattern.confidenceBand === "low") {
      caveats.push(
        `Pattern confidence is low (${pattern.attributedEventCount} attributed events) — insufficient data for strong recommendation`
      );
    }
    if (pattern.executionCount >= 5) {
      caveats.push(
        `Pattern has been replicated ${pattern.executionCount} times — diminishing returns are likely`
      );
    }
  }

  if (cluster) {
    if (cluster.confidenceBand === "low" || cluster.confidenceBand === "insufficient") {
      caveats.push(
        "Cluster evidence is weak — brief should be treated as experimental"
      );
    }
    if (cluster.noCandidateEventCount > 0) {
      caveats.push(
        `${cluster.noCandidateEventCount} events in this cluster have no candidate causes — changelog coverage may be incomplete`
      );
    }
  }

  if (action.blockingIssue) {
    caveats.push(`Blocking issue: ${action.blockingIssue}`);
  }

  return caveats;
}

function gatherAssumptions(
  action: ActionItem,
  pattern: Pattern | null
): string[] {
  const assumptions: string[] = [];

  assumptions.push("Current attribution data is representative of ongoing performance");

  if (pattern) {
    assumptions.push(
      `Pattern "${pattern.label}" effect is transferable to new contexts within the same site`
    );
    if (pattern.avgTimeToImpact > 0) {
      assumptions.push(
        `Impact should begin to appear within ~${pattern.avgTimeToImpact} days of execution`
      );
    }
  }

  if (action.actionType === "fix_changelog_coverage" || action.actionType === "fix_matching_quality") {
    assumptions.push(
      "Missing changelog entries are the primary cause of attribution gaps (not external factors)"
    );
  }

  return assumptions;
}
