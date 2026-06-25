/**
 * to-candidate-rows (2026-06-24) — the BRIDGE that makes the demand-graph engine
 * REAL in the product: it converts ranked Moves (+ their EvidencePackets) into
 * `RecommendationCandidateRow`s, the unit the live recommendation pipeline
 * (`load-trigger-candidates-for-tenant`) already consumes. So the engine's
 * worklist flows into the operator's real /today, /opportunities, /recommendations
 * — not just the diagnostic. PURE: no I/O, no LLM. Wired in behind the
 * `BEACON_DEMAND_GRAPH_RECS` flag (off by default) so the live pipeline is
 * unchanged until the operator flips it on.
 *
 * Copy is plain-language + competitor-name-free (passes the customer-copy vocab
 * scan); the operator_evidence carries the raw move trace.
 */

import { createHash } from "node:crypto";
import type { ActionType } from "@/domains/recommendations/action-types";
import type { RecommendationCandidateRow, CandidateConfidence, CandidateImpactEstimate } from "@/domains/recommendation-intelligence/emitter/candidate-row";
import type { DemandGraph, MoveCandidate, GapKind } from "./build-graph";
import type { EvidencePacket } from "./evidence-packet";

/** demand-graph gap → a real pipeline ActionType. */
const GAP_TO_ACTION: Partial<Record<GapKind, ActionType>> = {
  create_page: "create_page",
  answer_block: "add_answer_block",
  edit_page: "edit_title",
  fix_experience: "fix_page_experience",
};

/** Plain-language, jargon-free, competitor-name-free customer copy per gap. */
function customerCopy(gap: GapKind, query: string): string {
  switch (gap) {
    case "create_page":
      return `Create a new page about "${query}". There's real demand for it and none of your pages covers it yet — this is a chance to own the topic.`;
    case "answer_block":
      return `Add a short, direct answer to "${query}" near the top of the page, so AI assistants and search can quote you for it.`;
    case "edit_page":
      return `Improve your page for "${query}" — tighten the headline and content so it earns more of the clicks it already shows up for.`;
    case "fix_experience":
      return `Fix the on-page experience for "${query}" — visitors are hitting dead ends, which costs you results even when traffic is fine.`;
    default:
      return `Review the opportunity for "${query}".`;
  }
}

function titleCaseQuery(s: string): string {
  return s.split(/\s+/).filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}

function sha1(s: string): string {
  return createHash("sha1").update(s).digest("hex");
}

/** Impact from the move's strength — confidence is a sound proxy for signal weight. */
function impactFromConfidence(c: CandidateConfidence): CandidateImpactEstimate {
  return c; // high/medium/low align 1:1
}

export type DemandGraphCandidateInput = {
  tenantId: string;
  graph: DemandGraph;
  /** EvidencePackets keyed by move.demandKey, for richer evidence/proof. */
  packetsByKey?: Map<string, EvidencePacket>;
  /** Cap the number of top-by-score Moves emitted (keeps the queue focused). */
  limit?: number;
  nowIso: string;
};

export function demandGraphToCandidateRows(input: DemandGraphCandidateInput): RecommendationCandidateRow[] {
  const { tenantId, graph, packetsByKey, nowIso } = input;
  const limit = input.limit ?? 25;
  const actionable = graph.moves.filter((m) => m.gap !== "healthy" && m.gap !== "low_demand");
  // NOTE: create_page Moves (no owned URL yet) are emitted here but the live
  // edit-queue gate (apply-queue-rules Rule 1) drops on-site rows with a null
  // target_url — a NEW page belongs in the page-factory path, not the edit queue.
  // So in practice this source surfaces the EDIT Moves (answer_block / edit /
  // fix, which target existing pages); create_page Moves are surfaced on the
  // engine diagnostic + are wired to the factory as a separate step.
  const selected = actionable.slice(0, limit);
  const out: RecommendationCandidateRow[] = [];

  for (const move of selected) {
    const actionType = GAP_TO_ACTION[move.gap];
    if (!actionType) continue;
    const query = move.label;
    const topicClusterLabel = titleCaseQuery(query);
    // create_page has no owned URL; use the demand key as a stable identity.
    const targetUrl = move.ownedUrl ?? null;
    const identityUrl = targetUrl ?? `demand:${move.demandKey}`;
    const packet = packetsByKey?.get(move.demandKey);

    const evidence: RecommendationCandidateRow["evidence"] =
      move.competitorUrls.length > 0
        ? [{ kind: "citation_observation", ref: identityUrl, detail: `AI/search cite ${move.competitorUrls.length} competitor page(s) for this topic; demand-graph score ${Math.round(move.score)}` }]
        : [{ kind: "page_snapshot", ref: identityUrl, detail: `demand-graph ${move.gap} move, score ${Math.round(move.score)}` }];

    const components = move.components;
    const operatorEvidence =
      `demand-graph Move (${move.gap}): demand=${Math.round(components.demand)} win=${components.winnability.toFixed(2)} ` +
      `$val=${Math.round(components.dollarValue)} visGap=${components.visibilityGap.toFixed(2)} friction=${Math.round(components.friction)} ` +
      `conf=${move.confidence} signals=[${move.signals.join(",")}]` +
      (packet?.competitor?.looselyMatched ? " | competitor loosely-matched (verify w/ SERP)" : "") +
      (move.competitorUrls[0] ? ` | top competitor: ${move.competitorUrls[0]}` : "");

    out.push({
      tenant_id: tenantId,
      trigger_signal: `demand_graph_${move.gap}`,
      action_type: actionType,
      generator_kind: "deterministic",
      target_url: targetUrl,
      topic_cluster_label: topicClusterLabel,
      evidence,
      confidence: move.confidence,
      impact_estimate: impactFromConfidence(move.confidence),
      customer_copy: customerCopy(move.gap, query),
      operator_evidence: operatorEvidence,
      dedupe_key: sha1(`${tenantId}::${actionType}::${identityUrl}::${topicClusterLabel}`),
      cooldown_key: sha1(`${tenantId}::${actionType}::${identityUrl}`),
      created_from_signal_at: nowIso,
      safety_flags: [],
    });
  }

  return out;
}
