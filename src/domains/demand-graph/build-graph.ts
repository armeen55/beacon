/**
 * Demand Graph (2026-06-24) — the "everything helps everything" spine.
 *
 * A bipartite graph of DEMAND nodes (a query/topic cluster people ask Google &
 * AI) <-> PAGE nodes (your URLs + the competitor URLs AI/Google actually cite).
 * An EDGE means "this page serves / is cited for this demand". Every
 * recommendation Beacon makes is a deterministic function of ONE edge — or one
 * MISSING edge:
 *
 *   • demand has a competitor edge but NO owned edge      → create_page
 *   • owned edge ranks but AI never cites you (competitor does) → answer_block
 *   • owned edge ranks weakly (low CTR / mid position)    → edit_page
 *   • owned edge with user friction (Clarity)             → fix_experience
 *   • owned edge strong + cited                           → healthy (monitor)
 *
 * This module is PURE / deterministic / no I/O — it assembles a graph from
 * ALREADY-LOADED signals (GSC, GA4, Clarity, SEMrush, Profound citations +
 * visibility + fanouts) so it is trivially testable and works for ANY tenant.
 * Loaders + trigger wiring live in sibling slices; this is the core. The
 * Iranopedia wedge (0% cited, competitors own the topic) is a first-class graph
 * fact here: a high-demand DemandNode with competitor edges and no owned edge.
 *
 * Pinned by build-graph.test.ts.
 */

// ── inputs (what the loaders will hand us) ──────────────────────────────────

/** A demand cluster: a topic / query group with its fused demand signals. */
export type DemandInput = {
  /** Stable cluster key (normalized topic or head term). */
  key: string;
  /** Human label for surfaces. */
  label: string;
  /** Member queries (GSC + SEMrush + fanout). */
  queries: string[];
  /** Profound topic id when this cluster maps to one. */
  topicId?: string | null;
  /** Real demand: 90d GSC impressions for queries you rank for. */
  gscImpressions?: number | null;
  /** Absolute monthly search volume (SEMrush / DataForSEO), when known. */
  searchVolume?: number | null;
  /** SEMrush keyword difficulty 0–100, when known. */
  difficulty?: number | null;
  /** How often AI engines were asked this (Profound executions). */
  aiExecutions?: number | null;
  /** Your share-of-voice in AI answers for this cluster, 0..1 (Profound). */
  ownedAiShare?: number | null;
  /** The hidden sub-queries the engines fan this out into (Profound fanouts) —
   *  the exact sub-questions a page must answer to get cited. */
  fanoutSubQueries?: string[];
};

/** One of YOUR pages, with its signals + the demand keys it serves (from GSC
 *  page+query rows). */
export type OwnedPageInput = {
  url: string;
  /** Demand cluster keys this page has impressions/relevance for. */
  servesDemandKeys: string[];
  gscImpressions?: number | null;
  gscClicks?: number | null;
  gscCtr?: number | null;
  gscPosition?: number | null;
  ga4Sessions?: number | null;
  ga4Conversions?: number | null;
  ga4Value?: number | null;
  clarityRageClicks?: number | null;
  clarityDeadClicks?: number | null;
  clarityScriptErrors?: number | null;
  /** Times AI cited THIS owned url (Profound citation rows). 0 = invisible. */
  aiCitationCount?: number | null;
};

/** A competitor page AI/Google cites for a demand cluster (Profound citations
 *  where root_domain != yours, or SERP top results). */
export type CompetitorCitationInput = {
  url: string;
  /** The demand cluster this citation belongs to. */
  demandKey: string;
  /** Times cited (or rank-weighted SERP presence). Higher = stronger owner. */
  weight: number;
};

export type DemandGraphConfig = {
  /** A cluster below this demand weight is ignored (no rec). */
  minDemand?: number;
  /** Owned page is "weak" if its position is worse than this (and ranks). */
  weakPositionMax?: number;
  /** Owned page is "weak" if CTR is below this fraction of expected. */
  weakCtrRatio?: number;
  /** AI-citation count at/below this counts as "not cited" (invisible to AI). */
  notCitedAtOrBelow?: number;
};

const DEFAULTS: Required<DemandGraphConfig> = {
  minDemand: 50,
  weakPositionMax: 5,
  weakCtrRatio: 0.5,
  notCitedAtOrBelow: 0,
};

// ── graph types ─────────────────────────────────────────────────────────────

export type DemandNode = {
  key: string;
  label: string;
  queries: string[];
  topicId: string | null;
  /** Fused magnitude of real demand (search + AI ask volume). */
  demandWeight: number;
  ownedAiShare: number;
  fanoutSubQueries: string[];
};

export type PageNode = {
  url: string;
  isOwned: boolean;
  gscImpressions: number;
  gscClicks: number;
  gscCtr: number;
  gscPosition: number | null;
  ga4Sessions: number;
  ga4Value: number;
  frictionScore: number;
  aiCitationCount: number;
};

export type EdgeKind =
  | "owned_strong"
  | "owned_weak"
  | "owned_uncited"
  | "owned_friction"
  | "competitor_cited";

export type Edge = {
  demandKey: string;
  url: string;
  isOwned: boolean;
  kind: EdgeKind;
  weight: number;
};

export type GapKind =
  | "create_page"
  | "edit_page"
  | "answer_block"
  | "fix_experience"
  | "healthy"
  | "low_demand";

export type DemandGap = {
  demandKey: string;
  label: string;
  demandWeight: number;
  /** $-value signal: GA4 value of the owned page, when present. */
  dollarSignal: number;
  gap: GapKind;
  ownedUrl: string | null;
  /** Competitor pages AI/Google cite instead — the teardown targets. */
  competitorUrls: string[];
  /** The sub-questions a winning page must answer (fanout seeds). */
  fanoutSeeds: string[];
  rationale: string;
  /** Priority = demand × competitor pressure × ($ + 1), absent-gap boosted. */
  score: number;
};

export type DemandGraph = {
  demandNodes: DemandNode[];
  pageNodes: PageNode[];
  edges: Edge[];
  /** One actionable gap per demand cluster, ranked desc by score. */
  gaps: DemandGap[];
};

// ── helpers ─────────────────────────────────────────────────────────────────

function num(v: number | null | undefined, d = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : d;
}

/** Expected CTR for an average position — a coarse, monotonic curve (no
 *  external table; just enough to detect "ranks but under-clicked"). */
function expectedCtr(position: number | null | undefined): number {
  if (position == null || position <= 0) return 0.03;
  if (position <= 1) return 0.28;
  if (position <= 2) return 0.15;
  if (position <= 3) return 0.1;
  if (position <= 5) return 0.06;
  if (position <= 10) return 0.03;
  return 0.01;
}

function frictionOf(p: OwnedPageInput): number {
  return num(p.clarityRageClicks) + num(p.clarityDeadClicks) + num(p.clarityScriptErrors) * 2;
}

function demandWeightOf(d: DemandInput): number {
  // Real GSC demand if present, else absolute volume, plus AI ask volume.
  const search = Math.max(num(d.gscImpressions), num(d.searchVolume));
  return search + num(d.aiExecutions);
}

// ── the assembler ────────────────────────────────────────────────────────────

export function buildDemandGraph(input: {
  demand: ReadonlyArray<DemandInput>;
  ownedPages: ReadonlyArray<OwnedPageInput>;
  competitorCitations: ReadonlyArray<CompetitorCitationInput>;
  config?: DemandGraphConfig;
}): DemandGraph {
  const cfg = { ...DEFAULTS, ...(input.config ?? {}) };

  const demandNodes: DemandNode[] = input.demand.map((d) => ({
    key: d.key,
    label: d.label,
    queries: d.queries ?? [],
    topicId: d.topicId ?? null,
    demandWeight: demandWeightOf(d),
    ownedAiShare: num(d.ownedAiShare),
    fanoutSubQueries: d.fanoutSubQueries ?? [],
  }));
  const nodeByKey = new Map(demandNodes.map((n) => [n.key, n]));
  const rawByKey = new Map(input.demand.map((d) => [d.key, d]));

  // ── page nodes ──
  const pageNodes: PageNode[] = [];
  const edges: Edge[] = [];

  for (const p of input.ownedPages) {
    const ctr = num(p.gscCtr, p.gscImpressions ? num(p.gscClicks) / Math.max(1, num(p.gscImpressions)) : 0);
    const friction = frictionOf(p);
    pageNodes.push({
      url: p.url,
      isOwned: true,
      gscImpressions: num(p.gscImpressions),
      gscClicks: num(p.gscClicks),
      gscCtr: ctr,
      gscPosition: p.gscPosition ?? null,
      ga4Sessions: num(p.ga4Sessions),
      ga4Value: num(p.ga4Value),
      frictionScore: friction,
      aiCitationCount: num(p.aiCitationCount),
    });
    for (const key of p.servesDemandKeys) {
      if (!nodeByKey.has(key)) continue;
      const cited = num(p.aiCitationCount) > cfg.notCitedAtOrBelow;
      const weakCtr = ctr < expectedCtr(p.gscPosition) * cfg.weakCtrRatio;
      const weakPos = (p.gscPosition ?? 99) > cfg.weakPositionMax;
      let kind: EdgeKind;
      if (friction >= 15) kind = "owned_friction";
      else if (!cited) kind = "owned_uncited";
      else if (weakCtr || weakPos) kind = "owned_weak";
      else kind = "owned_strong";
      edges.push({ demandKey: key, url: p.url, isOwned: true, kind, weight: num(p.gscImpressions) });
    }
  }

  const competitorByUrl = new Map<string, PageNode>();
  for (const c of input.competitorCitations) {
    if (!nodeByKey.has(c.demandKey)) continue;
    if (!competitorByUrl.has(c.url)) {
      competitorByUrl.set(c.url, {
        url: c.url,
        isOwned: false,
        gscImpressions: 0,
        gscClicks: 0,
        gscCtr: 0,
        gscPosition: null,
        ga4Sessions: 0,
        ga4Value: 0,
        frictionScore: 0,
        aiCitationCount: c.weight,
      });
    }
    edges.push({ demandKey: c.demandKey, url: c.url, isOwned: false, kind: "competitor_cited", weight: c.weight });
  }
  pageNodes.push(...competitorByUrl.values());

  // ── gap classification per demand node ──
  const gaps: DemandGap[] = [];
  for (const node of demandNodes) {
    const ownedEdges = edges.filter((e) => e.isOwned && e.demandKey === node.key);
    const compEdges = edges
      .filter((e) => !e.isOwned && e.demandKey === node.key)
      .sort((a, b) => b.weight - a.weight);
    const competitorUrls = compEdges.map((e) => e.url);
    const raw = rawByKey.get(node.key);
    const fanoutSeeds = node.fanoutSubQueries.slice(0, 12);

    if (node.demandWeight < cfg.minDemand) {
      gaps.push(gapRow(node, "low_demand", null, competitorUrls, fanoutSeeds, 0, "Below the demand floor — not worth acting on yet.", 0));
      continue;
    }

    // best owned page for this demand (highest impressions edge)
    const bestOwned = ownedEdges.sort((a, b) => b.weight - a.weight)[0] ?? null;
    const ownedPage = bestOwned
      ? pageNodes.find((p) => p.isOwned && p.url === bestOwned.url) ?? null
      : null;
    const dollar = ownedPage ? ownedPage.ga4Value : 0;
    const compPressure = compEdges.reduce((s, e) => s + e.weight, 0);

    let gap: GapKind;
    let rationale: string;
    if (ownedEdges.length === 0) {
      if (compEdges.length > 0) {
        gap = "create_page";
        rationale = `${compEdges.length} competitor page(s) own this demand and you have NO page. Highest-leverage: create it (you have the volume, fanouts, and competitor teardown).`;
      } else {
        gap = "create_page";
        rationale = `Real demand with no owned page and no obvious incumbent — a clean land-grab.`;
      }
    } else {
      const kind = bestOwned!.kind;
      if (kind === "owned_friction") {
        gap = "fix_experience";
        rationale = `You rank here but the page frustrates visitors (Clarity friction ${ownedPage?.frictionScore}). Fix the experience before chasing more traffic.`;
      } else if (kind === "owned_uncited" && compEdges.length > 0) {
        gap = "answer_block";
        rationale = `You have a page but AI cites ${compEdges.length} competitor(s), not you. Add a direct, extractable answer block + the fanout sub-questions to win the citation.`;
      } else if (kind === "owned_weak") {
        gap = "edit_page";
        rationale = `You rank but under-perform (position ${ownedPage?.gscPosition ?? "?"}, CTR ${(num(ownedPage?.gscCtr) * 100).toFixed(1)}%). Tighten title/meta to the dominant query.`;
      } else {
        gap = "healthy";
        rationale = `Healthy — you rank and get cited. Monitor; revisit if rankings slip.`;
      }
    }

    // priority: demand × (competitor pressure + 1) × ($-weight + 1), absent boosted
    const absentBoost = gap === "create_page" ? 1.5 : gap === "answer_block" ? 1.25 : 1;
    const score = Math.round(
      node.demandWeight * (compPressure + 1) * (Math.log10(dollar + 10)) * absentBoost,
    );

    gaps.push(
      gapRow(node, gap, bestOwned?.url ?? null, competitorUrls, fanoutSeeds, dollar, rationale, score, raw),
    );
  }

  gaps.sort((a, b) => b.score - a.score);
  return { demandNodes, pageNodes, edges, gaps };
}

function gapRow(
  node: DemandNode,
  gap: GapKind,
  ownedUrl: string | null,
  competitorUrls: string[],
  fanoutSeeds: string[],
  dollarSignal: number,
  rationale: string,
  score: number,
  _raw?: DemandInput,
): DemandGap {
  return {
    demandKey: node.key,
    label: node.label,
    demandWeight: node.demandWeight,
    dollarSignal,
    gap,
    ownedUrl,
    competitorUrls: competitorUrls.slice(0, 8),
    fanoutSeeds,
    rationale,
    score,
  };
}
