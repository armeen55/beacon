import "server-only";
import { cache } from "react";
import { currentTenantId } from "@/lib/tenant-context";
import { loadDemandGraphForTenantCached } from "@/domains/demand-graph/load-graph";
import { getCompetitorAuditsForTenant, whatWins } from "@/domains/demand-graph/competitor-page-audit";
import { loadSemrushKeywordGapsForTenant } from "@/domains/recommendation-intelligence/semrush-page-signals";
import { getLatestMoveDrafts, type MoveDraftRow } from "@/domains/demand-graph/move-draft-store";
import { canonicalizeCitationUrl } from "@/domains/citation-lifecycle/canonicalize-url";
import { parsePreparedVerdict, type PreparedSerpVerdict } from "@/domains/serp/prepare-create-page-verdicts";

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
  /** Real SEMrush monthly search volume, ONLY on an exact keyword match (else null —
   *  never a fuzzy guess). Grounds the demand beyond the AI-attention proxy. */
  searchVolume: number | null;
  tier: "hot" | "warm" | "emerging";
  score: number;
  /** Previously-generated + persisted AI opening (move_drafts), so it survives reload. */
  savedOpening: string | null;
  /** Competitor domains AI cites for this topic — fed to the live-SERP validation
   *  as the "does Google rank the same competitors?" overlap check. */
  competitorDomains: string[];
  /** Precomputed DataForSEO verdict (from "Prepare top N"), so the card arrives
   *  "Google checked" with no operator click. null until prepared. */
  preparedVerdict: PreparedSerpVerdict | null;
  /** Profound AEO receipt — present ONLY when the underlying Move already carries
   *  strong cached `aeoEvidence` (confidence ≠ low AND ≥1 cited competitor). Lets
   *  the card say "AI is already asked this and cites competitors", not just "a
   *  keyword idea". Read from the durable cached evidence on the Move — NO live
   *  Profound call, NO fresh matching here. Absent → no badge. */
  aeoReceipt: {
    topPrompt: string;
    fanoutCount: number;
    citedDomains: string[];
    ownAbsent: boolean;
  } | null;
};

export type NewPagesData = {
  opportunities: NewPageOpportunity[];
  totalCandidates: number;
  /** The tenant's own domain (so the SERP validator can detect "you already rank"). */
  ownDomain: string;
};

function domainOf(url: string): string | null {
  if (!url) return null;
  // Competitor URLs from the citation graph are often scheme-less
  // ("theknot.com/content/persian-wedding") — new URL() throws on those, which
  // was silently dropping the competitor's name from every New Page card.
  const withScheme = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  try {
    return new URL(withScheme).hostname.replace(/^www\./, "");
  } catch {
    // Last-ditch: take the host token before the first slash.
    const host = url.replace(/^https?:\/\//i, "").split("/")[0]?.replace(/^www\./, "");
    return host && host.includes(".") ? host : null;
  }
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** The tenant's own domain = the most common hostname across its owned pages. */
function deriveOwnDomain(pageNodes: ReadonlyArray<{ url: string }>): string {
  const counts = new Map<string, number>();
  for (const p of pageNodes) {
    const d = domainOf(p.url);
    if (d) counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
}

/** Fail-fast guard so the heavy demand-graph compute can never hang the cockpit
 *  (the /today statement-timeout class) — on timeout the board self-hides. */
function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    p.catch(() => fallback),
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

/** Tenant-explicit builder — shared by the request-cached loader AND the nightly
 *  precompute (which has no request context to derive the tenant from). */
export async function buildNewPagesData(tenantId: string): Promise<NewPagesData> {
  let moves;
  let audits: Awaited<ReturnType<typeof getCompetitorAuditsForTenant>> = new Map();
  let savedDrafts = new Map<string, MoveDraftRow>();
  let ownDomain = "";
  const volumeByKeyword = new Map<string, number>();
  try {
    const [graphRes, auditRes, draftRes, semrushGaps] = await Promise.all([
      withTimeout<Awaited<ReturnType<typeof loadDemandGraphForTenantCached>> | null>(
        loadDemandGraphForTenantCached(tenantId),
        8000,
        null,
      ),
      getCompetitorAuditsForTenant().catch(() => new Map()),
      // Persisted AI openings (degrade-safe: empty map if the table isn't migrated).
      withTimeout(getLatestMoveDrafts(tenantId), 4000, new Map<string, MoveDraftRow>()),
      // Real SEMrush search volume by keyword (bounded, fail-soft []) — for EXACT
      // topic→keyword grounding (no fuzzy matching → no wrong numbers).
      withTimeout(loadSemrushKeywordGapsForTenant(tenantId), 4000, [] as Awaited<ReturnType<typeof loadSemrushKeywordGapsForTenant>>),
    ]);
    if (!graphRes) return { opportunities: [], totalCandidates: 0, ownDomain: "" };
    moves = graphRes.graph.moves;
    ownDomain = deriveOwnDomain(graphRes.graph.pageNodes);
    audits = auditRes;
    savedDrafts = draftRes;
    for (const g of semrushGaps) {
      const k = g.keyword?.trim().toLowerCase().replace(/\s+/g, " ");
      if (k && g.volume > 0 && !volumeByKeyword.has(k)) volumeByKeyword.set(k, g.volume);
    }
  } catch {
    return { opportunities: [], totalCandidates: 0, ownDomain: "" };
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
    // AEO receipt: read the Move's ALREADY-ATTACHED cached evidence (no live call,
    // no fresh matching). Eligible only when confident AND a competitor is cited.
    const e = m.aeoEvidence;
    const aeoReceipt =
      e && e.confidence !== "low" && e.topCitedDomains.length > 0 && (e.prompts[0] ?? "").length > 0
        ? {
            topPrompt: e.prompts[0]!,
            fanoutCount: e.fanoutQueries.length,
            citedDomains: e.topCitedDomains.slice(0, 3).map((d) => d.hostname),
            ownAbsent: e.ownCitationCount === 0,
          }
        : null;
    return {
      id: m.demandKey,
      topic: titleCase(m.label),
      competitorCount: m.competitorUrls.length,
      topCompetitor: topUrl ? domainOf(topUrl) : null,
      whatWins: ww && ww !== "—" ? ww : null,
      // Real volume ONLY on an exact normalized keyword match (else null — honest).
      searchVolume: volumeByKeyword.get(m.label.trim().toLowerCase().replace(/\s+/g, " ")) ?? null,
      tier: i < 3 ? "hot" : i < 6 ? "warm" : "emerging",
      score: Math.round(m.score),
      savedOpening: savedDrafts.get(`${m.demandKey}::answer_block`)?.content ?? null,
      competitorDomains: [...new Set(m.competitorUrls.map((u) => domainOf(u)).filter((d): d is string => !!d))].slice(0, 6),
      preparedVerdict: parsePreparedVerdict(savedDrafts.get(`${m.demandKey}::serp_verdict`)?.content),
      aeoReceipt,
    };
  });

  return { opportunities, totalCandidates: createMoves.length, ownDomain };
}

export const loadNewPagesData = cache(
  async (): Promise<NewPagesData> => buildNewPagesData(await currentTenantId()),
);
