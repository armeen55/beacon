import "server-only";
import { cache } from "react";
import { currentTenantId } from "@/lib/tenant-context";
import { loadDemandGraphForTenant } from "@/domains/demand-graph/load-graph";
import { getCompetitorAuditsForTenant, whatWins } from "@/domains/demand-graph/competitor-page-audit";
import { canonicalizeCitationUrl } from "@/domains/citation-lifecycle/canonicalize-url";

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
  /** What the cited competitor page has (deterministic teardown), when audited. */
  whatWins: string | null;
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

/** Fail-fast guard so the heavy demand-graph compute can never hang the cockpit
 *  (the /today statement-timeout class) — on timeout the board self-hides. */
function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    p.catch(() => fallback),
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

export const loadNewPagesData = cache(async (): Promise<NewPagesData> => {
  const tenantId = await currentTenantId();
  let moves;
  let audits: Awaited<ReturnType<typeof getCompetitorAuditsForTenant>> = new Map();
  try {
    const [graphRes, auditRes] = await Promise.all([
      withTimeout<Awaited<ReturnType<typeof loadDemandGraphForTenant>> | null>(
        loadDemandGraphForTenant(tenantId),
        8000,
        null,
      ),
      getCompetitorAuditsForTenant().catch(() => new Map()),
    ]);
    if (!graphRes) return { opportunities: [], totalCandidates: 0 };
    moves = graphRes.graph.moves;
    audits = auditRes;
  } catch {
    return { opportunities: [], totalCandidates: 0 };
  }

  // Find a teardown audit by URL so a create_page opportunity can show what the
  // cited competitor page actually has (when we've torn it down).
  const canonLower = (u: string) => (canonicalizeCitationUrl(u) ?? u).toLowerCase();
  const findAudit = (url: string) => {
    const target = canonLower(url);
    for (const a of audits.values()) if (canonLower(a.url) === target) return a;
    return undefined;
  };

  const createMoves = moves
    .filter((m) => m.gap === "create_page")
    .sort((a, b) => b.components.demand - a.components.demand);

  // Tier by rank within this tenant's own create-page set (relative, honest —
  // the underlying number is a proxy, so we bucket rather than print it).
  const opportunities: NewPageOpportunity[] = createMoves.slice(0, 9).map((m, i) => {
    const topUrl = m.competitorUrls[0] ?? null;
    const audit = topUrl ? findAudit(topUrl) : undefined;
    const ww = audit && audit.fetchStatus === "ok" && audit.facts ? whatWins(audit.facts) : null;
    return {
      id: m.demandKey,
      topic: titleCase(m.label),
      competitorCount: m.competitorUrls.length,
      topCompetitor: topUrl ? domainOf(topUrl) : null,
      whatWins: ww && ww !== "—" ? ww : null,
      tier: i < 3 ? "hot" : i < 6 ? "warm" : "emerging",
      score: Math.round(m.score),
    };
  });

  return { opportunities, totalCandidates: createMoves.length };
});
