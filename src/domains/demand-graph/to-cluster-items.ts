/**
 * to-cluster-items (2026-06-24, Step 5) — the create_page bridge to the page
 * factory. The factory (`push/cluster-factory.ts`) was driven by ~10 hand-
 * authored items; this lifts it to DEMAND-DRIVEN: it converts the engine's
 * `create_page` Moves (+ their EvidencePackets) into the factory's
 * `ClusterItemBrief` list (slug + title + a grounded one-line brief from the
 * competitor teardown + Profound fanouts). PURE: no LLM, no I/O. The caller
 * assembles the tenant-specific `ClusterPlan` (collection id, urlPrefix, fields,
 * content rules) around these items and runs `generateClusterCards` — the LLM
 * page generation stays the operator-gated step.
 */

import type { ClusterItemBrief } from "@/domains/push/cluster-factory";
import type { DemandGraph, MoveCandidate } from "./build-graph";
import type { EvidencePacket } from "./evidence-packet";

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "untitled";
}

function titleCase(s: string): string {
  return s.split(/\s+/).filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}

/** A grounded one-line brief from the packet (competitor teardown + fanouts),
 *  or a demand-only brief when no on-topic teardown exists. NO fabrication. */
function briefFor(query: string, packet: EvidencePacket | undefined): string {
  const parts: string[] = [];
  const cov = packet?.competitor;
  if (cov && !cov.looselyMatched && cov.facts) {
    const outline = (packet?.draft.outline ?? []).slice(0, 4).filter(Boolean);
    if (outline.length) parts.push(`Cover ${outline.join(", ")}`);
    if (packet?.draft.answerBlockBrief) parts.push(`open with a direct answer to "${query}"`);
    if (cov.domain) parts.push(`out-build ${cov.domain} (the page AI/search cite for this)`);
  } else {
    parts.push(`Create the definitive page for "${query}" — there's demand and no strong incumbent`);
    if (packet?.draft.answerBlockBrief) parts.push(`lead with a concise direct answer`);
  }
  const faqs = (packet?.draft.faqQuestions ?? []).slice(0, 3).filter(Boolean);
  if (faqs.length) parts.push(`answer: ${faqs.join("; ")}`);
  return parts.join("; ").slice(0, 280) || `Create a page for "${query}".`;
}

export type ClusterItemsInput = {
  graph: DemandGraph;
  packetsByKey?: Map<string, EvidencePacket>;
  /** Max create_page items to brief (factory caps at MAX_ITEMS_PER_RUN=10). */
  max?: number;
};

/** Demand-driven create_page item briefs, ranked by demand (highest first). */
export function createPageClusterItems(input: ClusterItemsInput): ClusterItemBrief[] {
  const { graph, packetsByKey } = input;
  const max = input.max ?? 10;
  const creates = graph.moves
    .filter((m: MoveCandidate) => m.gap === "create_page")
    .sort((a, b) => b.components.demand - a.components.demand)
    .slice(0, max);

  const seen = new Set<string>();
  const items: ClusterItemBrief[] = [];
  for (const m of creates) {
    const slug = slugify(m.label);
    if (seen.has(slug)) continue;
    seen.add(slug);
    items.push({
      slug,
      title: titleCase(m.label),
      brief: briefFor(m.label, packetsByKey?.get(m.demandKey)),
    });
  }
  return items;
}
