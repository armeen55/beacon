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
import type { DemandGraph, GapKind } from "./build-graph";
import type { EvidencePacket } from "./evidence-packet";
import { groupMovesByOwnedPage, secondaryGapPhrase } from "./group-moves";
import { UNSUPPORTED_CLAIM_TOKENS } from "@/domains/recommendation-intelligence/safety-audit";
import { expectedCtrForPosition } from "@/domains/recommendation-intelligence/page-surgeon/expected-ctr";

/** Published CTR-gap upside (same method as the GSC predicates): clicks/90d
 *  recoverable if CTR rises to the positional benchmark. Lets the engine's edit
 *  Moves carry the impact signal so they rank FAIRLY in the queue (not buried
 *  below the GSC predicates for lack of an upside number). Only when we have the
 *  page's real GSC position + impressions. */
function upsideClicks90d(gsc: EvidencePacket["yourPage"]["gsc"]): number | undefined {
  if (!gsc || gsc.position == null || gsc.impressions <= 0) return undefined;
  const gap = expectedCtrForPosition(gsc.position) - gsc.ctr;
  if (gap <= 0) return undefined;
  const clicks = Math.round(gap * gsc.impressions);
  return clicks > 0 ? clicks : undefined;
}

/** Strip unsupported-claim tokens (best / #1 / leading / guaranteed …) from a
 *  query before it's echoed into customer_copy — the tenant's own GSC query can
 *  contain a claim word that would otherwise fail the customer-copy vocab scan. */
function safeQueryForCopy(query: string): string {
  let s = ` ${query} `;
  for (const raw of UNSUPPORTED_CLAIM_TOKENS) {
    const esc = raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const wordy = /^[a-z0-9]/i.test(raw) && /[a-z0-9]$/i.test(raw);
    s = s.replace(new RegExp(wordy ? `\\b${esc}\\b` : esc, "gi"), " ");
  }
  return s.replace(/\s+/g, " ").trim() || "this topic";
}

/** demand-graph gap → a real pipeline ActionType. */
const GAP_TO_ACTION: Partial<Record<GapKind, ActionType>> = {
  create_page: "create_page",
  answer_block: "add_answer_block",
  edit_page: "edit_title",
  fix_experience: "fix_page_experience",
};

/** Plain-language, jargon-free, competitor-name-free customer copy per gap.
 *  The query is claim-token-sanitized so a tenant's own "best …" query doesn't
 *  echo an unsupported claim into customer copy. */
function customerCopy(gap: GapKind, rawQuery: string): string {
  const query = safeQueryForCopy(rawQuery);
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

/** Plain-English "how you'll know it worked" line per gap — the proof plan in
 *  customer language (no jargon, no invented numbers, no em-dashes). This is the
 *  ONE strong-card element that's both missing from the thin queue row AND safe to
 *  surface in customer copy (the richer teardown/outline lives in operator_evidence
 *  + the /diagnostics/rank-revenue move cards). */
function proofLine(gap: GapKind): string {
  switch (gap) {
    case "answer_block":
      return " You'll know it worked if this page starts getting quoted by AI and earns more clicks for that search over the next month or two, versus pages you leave unchanged.";
    case "edit_page":
      return " You'll know it worked if this page wins more of the clicks it already shows up for over the next month or two, versus pages you leave unchanged.";
    case "fix_experience":
      return " You'll know it worked if visitors stop hitting dead ends here and stay longer over the next month or two, versus pages you leave unchanged.";
    case "create_page":
      return " Once it's live, you'll know it worked if it starts pulling in clicks and AI mentions for that topic over the next few months.";
    default:
      return "";
  }
}

/** Operator-facing brief: what the cited competitor does well + the grounded
 *  outline + answer-block brief from the EvidencePacket. Competitor specifics are
 *  fine here (operator_evidence is never shown to a customer). Empty when no packet
 *  / no teardown. */
function moveBriefForOperator(packet?: EvidencePacket): string {
  if (!packet) return "";
  const parts: string[] = [];
  const ww = packet.competitor?.whatWins?.trim();
  if (ww) parts.push(`what wins: ${ww}`);
  const outline = (packet.draft?.outline ?? []).filter(Boolean).slice(0, 5);
  if (outline.length) parts.push(`cover: ${outline.join(" · ")}`);
  const brief = packet.draft?.answerBlockBrief?.trim();
  if (brief) parts.push(`answer brief: ${brief}`);
  return parts.length ? ` | ${parts.join(" | ")}` : "";
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
  // Collapse Moves that target the SAME owned page → one primary + secondary
  // reasons, so a page never enters the queue twice (e.g. answer_block AND
  // fix_experience for /iran-flag). create_page (no URL) stays standalone.
  const groups = groupMovesByOwnedPage(actionable).slice(0, limit);
  const out: RecommendationCandidateRow[] = [];

  for (const { primary: move, secondary } of groups) {
    const actionType = GAP_TO_ACTION[move.gap];
    if (!actionType) continue;
    const alsoPhrases = secondary.map((s) => secondaryGapPhrase(s.gap));
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
      (alsoPhrases.length ? ` | also on this page: ${alsoPhrases.join(", ")}` : "") +
      (packet?.competitor?.looselyMatched ? " | competitor loosely-matched (verify w/ SERP)" : "") +
      (move.competitorUrls[0] ? ` | top competitor: ${move.competitorUrls[0]}` : "") +
      moveBriefForOperator(packet);

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
      upside_clicks_90d: upsideClicks90d(packet?.yourPage.gsc ?? null),
      customer_copy:
        customerCopy(move.gap, query) +
        proofLine(move.gap) +
        (alsoPhrases.length ? ` While you're on this page, also: ${alsoPhrases.join("; ")}.` : ""),
      operator_evidence: operatorEvidence,
      dedupe_key: sha1(`${tenantId}::${actionType}::${identityUrl}::${topicClusterLabel}`),
      cooldown_key: sha1(`${tenantId}::${actionType}::${identityUrl}`),
      created_from_signal_at: nowIso,
      safety_flags: [],
    });
  }

  return out;
}
