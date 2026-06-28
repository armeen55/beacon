/**
 * ActionPack adapters (2026-06-26, Core Consolidation — Phase C).
 *
 * Flatten each recommendation source INTO the unified ActionPack. We do NOT
 * rewrite the sources — they keep their rich internal shape; these adapters are
 * the one-way normalization. PURE / no I/O.
 *
 *   demand-graph MoveCandidate (+ optional EvidencePacket)  -> ActionPack
 *   profound-coverage AeoActionPack                          -> ActionPack
 *
 * Evidence-source adapters (GSC/GA4/Clarity/DataForSEO/Profound/competitor) are
 * inlined here from the data already attached to those source objects.
 */
import type { MoveCandidate, GapKind } from "@/domains/demand-graph/build-graph";
import type { EvidencePacket } from "@/domains/demand-graph/evidence-packet";
import type { AeoActionPack } from "@/domains/profound-coverage/types";
import type { PreparedSerpVerdict } from "@/domains/serp/prepare-create-page-verdicts";
import type {
  ActionPack,
  ActionType,
  EvidenceSource,
  ActionPackConfidence,
  ActionPackSerpValidation,
} from "./types";

/** Map a cached DataForSEO prepared verdict → ActionPack validation evidence.
 *  Honest: only call this when a real cached verdict exists (never synthesize). */
export function serpVerdictToValidation(v: PreparedSerpVerdict): ActionPackSerpValidation {
  return {
    verdict: v.verdict === "reject" ? "skip" : v.verdict,
    confidence: v.confidence,
    topDomains: v.topDomains.slice(0, 6),
    contentDomainCount: v.contentDomainCount,
    marketplaceUgcCount: v.marketplaceUgcCount,
    profoundOverlapCount: v.profoundOverlapCount,
    ownAlreadyRanks: v.ownAlreadyRanks,
    costUsd: v.costUsd,
  };
}

/** Tiny stable string hash (djb2) → hex; deterministic id without node:crypto. */
function hashId(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

function packId(tenantId: string, actionType: ActionType, key: string): string {
  return `${actionType}:${hashId(`${tenantId}|${actionType}|${key.toLowerCase()}`)}`;
}

const GAP_TO_ACTION: Partial<Record<GapKind, ActionType>> = {
  create_page: "create_new_page",
  edit_page: "edit_existing_page",
  answer_block: "add_answer_block",
  fix_experience: "fix_conversion_friction",
  // healthy / low_demand → not actionable (no mapping → skipped)
};

const AEO_TO_ACTION: Record<AeoActionPack["action"], ActionType | null> = {
  add_answer_block: "add_answer_block",
  expand_existing_page: "edit_existing_page",
  create_new_page: "create_new_page",
  create_hub: "create_hub",
  consolidate_pages: "consolidate_pages",
  add_internal_links: "add_internal_links",
  ignore: null,
};

function domainOf(url: string): string {
  const w = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  try {
    return new URL(w).hostname.replace(/^www\./i, "");
  } catch {
    return url.replace(/^https?:\/\//i, "").split("/")[0]?.replace(/^www\./i, "") ?? url;
  }
}

/** demand-graph MoveCandidate → ActionPack. Pass the EvidencePacket when
 *  available for the RAW GSC/GA4/Clarity values (the move only carries the
 *  fused/scored components). Returns null for non-actionable gaps. */
export function moveCandidateToActionPack(
  tenantId: string,
  m: MoveCandidate,
  packet?: EvidencePacket | null,
  serpVerdict?: PreparedSerpVerdict | null,
): ActionPack | null {
  const actionType = GAP_TO_ACTION[m.gap];
  if (!actionType) return null;

  const sources: EvidenceSource[] = ["rank_revenue"];
  const ae = m.aeoEvidence ?? null;
  const profoundReceipt = ae
    ? {
        topPrompt: ae.prompts[0] ?? "",
        promptCount: ae.promptCount,
        fanoutCount: ae.fanoutQueries.length,
        citedDomains: ae.topCitedDomains.slice(0, 3).map((d) => d.hostname),
        ownAbsent: ae.ownCitationCount === 0,
      }
    : null;
  if (profoundReceipt) sources.push("profound");

  const gsc = packet?.yourPage.gsc ?? null;
  const gscDemand = gsc ? { clicks: gsc.clicks, impressions: gsc.impressions, ctr: gsc.ctr, position: gsc.position } : null;
  if (gscDemand && (gscDemand.impressions > 0 || gscDemand.clicks > 0)) sources.push("gsc");

  const dollar = packet?.yourPage.dollarValue ?? m.components.dollarValue;
  const ga4Value = dollar > 0 ? { sessions: 0, conversions: 0, revenue: dollar } : null;
  if (ga4Value) sources.push("ga4");

  const frictionScore = packet?.yourPage.friction ?? m.components.friction;
  const clarityFriction = frictionScore > 0 ? { score: Math.round(frictionScore * 100) / 100 } : null;
  if (clarityFriction) sources.push("clarity");

  const competitors = (packet ? [packet.competitor.topUrl, ...packet.competitor.otherUrls].filter((u): u is string => !!u) : m.competitorUrls).slice(0, 5);
  if (competitors.length > 0 && packet?.competitor.facts) sources.push("competitor_teardown");

  const dataforseoValidation = serpVerdict ? serpVerdictToValidation(serpVerdict) : null;
  if (dataforseoValidation) sources.push("dataforseo");

  const draftStatus: ActionPack["draftStatus"] = packet?.draft && (packet.draft.titleSuggestion || packet.draft.answerBlockBrief || packet.draft.outline.length > 0) ? "ready" : "none";

  return {
    id: packId(tenantId, actionType, m.ownedUrl ?? m.label),
    tenantId,
    actionType,
    targetUrl: m.ownedUrl,
    newPageSlug: m.ownedUrl ? null : slugFromLabel(m.label),
    label: m.label,
    priorityScore: Math.round(m.score),
    confidence: m.confidence,
    evidenceSources: sources,
    gscDemand,
    ga4Value,
    clarityFriction,
    profoundReceipt,
    competitorPagesToBeat: competitors,
    draftStatus,
    proofPlan: packet?.proofPlan ?? null,
    dataforseoValidation,
    whyNotNoise: whyNotNoiseForMove(m, profoundReceipt, gscDemand, competitors),
    origin: "rank_revenue",
    evidenceHash: packet?.evidenceHash ?? hashId(`${m.demandKey}|${m.score}`),
  };
}

/** profound-coverage AeoActionPack → ActionPack. Returns null for `ignore`. */
export function aeoActionPackToActionPack(tenantId: string, p: AeoActionPack): ActionPack | null {
  const actionType = AEO_TO_ACTION[p.action];
  if (!actionType) return null;

  const sources: EvidenceSource[] = ["profound"];
  const competitors = (p.competitorPagesToBeat ?? []).slice(0, 5);
  const profoundReceipt = {
    topPrompt: p.prompt,
    promptCount: 1,
    fanoutCount: p.faqQuestions.length,
    citedDomains: [...new Set(competitors.map(domainOf))].slice(0, 3),
    ownAbsent: true, // coverage packs are surfaced where you're absent/under-cited
  };
  // Honest sourcing: coverage packs are PROFOUND-sourced only. The competitor
  // URLs come from Profound citations (not a deterministic teardown), and
  // `needsSerpValidation===false` does NOT mean a DataForSEO verdict is attached —
  // so we claim neither "dataforseo" nor "competitor_teardown" here. Those sources
  // appear only when a real verdict / real audit is fused in (documented next step).

  const confidence: ActionPackConfidence = competitors.length > 0 && !p.needsSerpValidation ? "high" : competitors.length > 0 ? "medium" : "low";

  return {
    id: packId(tenantId, actionType, p.targetUrl ?? p.newPageSlug ?? p.prompt),
    tenantId,
    actionType,
    targetUrl: p.targetUrl,
    newPageSlug: p.newPageSlug,
    label: p.title ?? p.prompt,
    priorityScore: Math.round(p.priorityScore),
    confidence,
    evidenceSources: sources,
    gscDemand: null,
    ga4Value: null,
    clarityFriction: null,
    profoundReceipt,
    dataforseoValidation: null,
    competitorPagesToBeat: competitors,
    draftStatus: p.directAnswerBrief ? "ready" : "none",
    proofPlan: p.measurementPlan.length > 0 ? { metrics: p.measurementPlan, windowsDays: [7, 14, 28], controls: "topic-matched control pages" } : null,
    whyNotNoise: `AI is asked "${p.prompt}"${p.faqQuestions.length ? ` (+${p.faqQuestions.length} fan-outs)` : ""}${competitors.length ? `, cites ${profoundReceipt.citedDomains.join(", ")}` : ""}; you are absent.`,
    origin: "profound_coverage",
    evidenceHash: hashId(`${p.promptId ?? p.prompt}|${p.priorityScore}`),
  };
}

function slugFromLabel(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 80);
}

function whyNotNoiseForMove(
  m: MoveCandidate,
  receipt: ActionPack["profoundReceipt"],
  gsc: ActionPack["gscDemand"],
  competitors: string[],
): string {
  const bits: string[] = [];
  if (gsc && gsc.impressions > 0) bits.push(`${gsc.impressions.toLocaleString()} GSC impressions${gsc.position != null ? ` @ pos ${gsc.position.toFixed(0)}` : ""}`);
  else if (m.components.demand > 0) bits.push(`demand ${Math.round(m.components.demand).toLocaleString()}`);
  if (receipt) bits.push(`AI asks "${receipt.topPrompt}"${receipt.ownAbsent ? " (you absent)" : ""}`);
  if (competitors.length > 0) bits.push(`${competitors.length} competitor page${competitors.length === 1 ? "" : "s"} cited`);
  if (m.components.dollarValue > 0) bits.push(`$-signal ${Math.round(m.components.dollarValue)}`);
  if (m.components.friction > 0) bits.push(`friction ${Math.round(m.components.friction)}`);
  return bits.length > 0 ? bits.join(" · ") : `${m.signals.join(" + ")} signal`;
}

/** Collapse duplicates across sources by (actionType + normalized target/slug).
 *  The higher-priority pack wins; evidence sources + competitors + Profound
 *  receipt are MERGED so the surviving pack is strictly richer. Returns the
 *  deduped list + the count removed (for the consolidation truth dump). */
export function dedupeActionPacks(packs: ActionPack[]): { packs: ActionPack[]; removed: number } {
  const byKey = new Map<string, ActionPack>();
  let removed = 0;
  for (const p of [...packs].sort((a, b) => b.priorityScore - a.priorityScore)) {
    const key = `${p.actionType}|${(p.targetUrl ?? p.newPageSlug ?? p.label).toLowerCase().replace(/\/+$/, "")}`;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, p);
      continue;
    }
    removed++;
    // Merge the weaker into the stronger (prev has higher/equal score).
    prev.evidenceSources = [...new Set([...prev.evidenceSources, ...p.evidenceSources])];
    prev.competitorPagesToBeat = [...new Set([...prev.competitorPagesToBeat, ...p.competitorPagesToBeat])].slice(0, 5);
    prev.profoundReceipt = prev.profoundReceipt ?? p.profoundReceipt;
    prev.gscDemand = prev.gscDemand ?? p.gscDemand;
    prev.ga4Value = prev.ga4Value ?? p.ga4Value;
    prev.clarityFriction = prev.clarityFriction ?? p.clarityFriction;
    prev.dataforseoValidation = prev.dataforseoValidation ?? p.dataforseoValidation;
  }
  return { packs: [...byKey.values()].sort((a, b) => b.priorityScore - a.priorityScore), removed };
}
