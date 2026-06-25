import "server-only";
import { cache } from "react";
import { currentTenantId } from "@/lib/tenant-context";
import { loadDemandGraphForTenant } from "@/domains/demand-graph/load-graph";

/**
 * today-newpages-data (2026-06-24) — the loader behind the "New Pages to Build"
 * board: the demand-graph engine's create_page Moves (topics competitors own that
 * the tenant has no page for). These intentionally never enter the EDIT queue
 * (they're new pages, not edits) — this surface is their home. Read-only,
 * tenant-agnostic; empty → the section self-hides. Demand is an AI-attention proxy
 * (citation breadth × volume), NOT measured search volume, so it's shown as a
 * concrete "N competitor pages cited" + an honest interest tier, never a fake
 * search-volume number.
 */

export type NewPageOpportunity = {
  id: string;
  topic: string;
  competitorCount: number;
  topCompetitor: string | null;
  tier: "hot" | "warm" | "emerging";
  score: number;
};

export type NewPagesData = {
  opportunities: NewPageOpportunity[];
  totalCandidates: number;
};

function domainOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

export const loadNewPagesData = cache(async (): Promise<NewPagesData> => {
  const tenantId = await currentTenantId();
  let moves;
  try {
    const { graph } = await loadDemandGraphForTenant(tenantId);
    moves = graph.moves;
  } catch {
    return { opportunities: [], totalCandidates: 0 };
  }

  const createMoves = moves
    .filter((m) => m.gap === "create_page")
    .sort((a, b) => b.components.demand - a.components.demand);

  // Tier by rank within this tenant's own create-page set (relative, honest —
  // the underlying number is a proxy, so we bucket rather than print it).
  const opportunities: NewPageOpportunity[] = createMoves.slice(0, 9).map((m, i) => ({
    id: m.demandKey,
    topic: titleCase(m.label),
    competitorCount: m.competitorUrls.length,
    topCompetitor: m.competitorUrls[0] ? domainOf(m.competitorUrls[0]) : null,
    tier: i < 3 ? "hot" : i < 6 ? "warm" : "emerging",
    score: Math.round(m.score),
  }));

  return { opportunities, totalCandidates: createMoves.length };
});
