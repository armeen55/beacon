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

export type ConfidenceLevel = "high" | "medium" | "low";

/** The Rank-&-Revenue score broken into its RAW components, exposed so the
 *  Top-25 table is a lie detector: you can see exactly why a Move ranks, and the
 *  final weighting can be wrong while the evidence is right. Do not overfit the
 *  combination early — trust the components. */
export type MoveComponents = {
  /** Raw fused demand (GSC impressions + volume + AI-ask volume). */
  demand: number;
  /** 0..1 — how beatable the incumbents are / how achievable the gain. */
  winnability: number;
  /** Raw $ signal (GA4 value of the owned page; 0 for not-yet-built pages). */
  dollarValue: number;
  /** 0..1 — how absent you are where competitors win. */
  visibilityGap: number;
  /** Raw friction (Clarity rage + dead + 2×script-errors on the owned page). */
  friction: number;
};

/** One actionable Move per demand cluster. The atomic product unit — what the
 *  operator ships. (DemandGraph → MoveCandidate → EvidencePacket → AtomicChangePack → Proof.) */
export type MoveCandidate = {
  demandKey: string;
  label: string;
  gap: GapKind;
  /** Final Rank-&-Revenue score (derived from components; the sort key). */
  score: number;
  /** Raw components — the lie detector. */
  components: MoveComponents;
  /** high = multiple independent signals agree; low = speculative (e.g. a new
   *  page from a single source — create aggressively but flag the uncertainty). */
  confidence: ConfidenceLevel;
  /** Which independent signals were present (GSC / volume / AI / $ / owned-page). */
  signals: string[];
  ownedUrl: string | null;
  /** Competitor pages AI/Google cite instead — the teardown targets. */
  competitorUrls: string[];
  /** The sub-questions a winning page must answer (Profound fanout seeds). */
  fanoutSeeds: string[];
  rationale: string;
};

export type DemandGraph = {
  demandNodes: DemandNode[];
  pageNodes: PageNode[];
  edges: Edge[];
  /** One actionable Move per demand cluster, ranked desc by score. */
  moves: MoveCandidate[];
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
      // Edge kind is GSC-driven (works even with NO Profound/citation data).
      // The AEO "uncited" gap is decided in the Move loop, and only when there
      // is actual competitor-citation evidence — so a tenant with no Profound
      // data never gets a false answer_block storm.
      const weakCtr = ctr < expectedCtr(p.gscPosition) * cfg.weakCtrRatio;
      const weakPos = (p.gscPosition ?? 99) > cfg.weakPositionMax;
      let kind: EdgeKind;
      if (friction >= 15) kind = "owned_friction";
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

  // ── Move classification + component scoring per demand node ──
  const moves: MoveCandidate[] = [];
  for (const node of demandNodes) {
    const ownedEdges = edges.filter((e) => e.isOwned && e.demandKey === node.key);
    const compEdges = edges
      .filter((e) => !e.isOwned && e.demandKey === node.key)
      .sort((a, b) => b.weight - a.weight);
    const competitorUrls = compEdges.map((e) => e.url).slice(0, 8);
    const raw = rawByKey.get(node.key);
    const fanoutSeeds = node.fanoutSubQueries.slice(0, 12);

    // best owned page for this demand (highest impressions edge)
    const bestOwned = ownedEdges.sort((a, b) => b.weight - a.weight)[0] ?? null;
    const ownedPage = bestOwned
      ? pageNodes.find((p) => p.isOwned && p.url === bestOwned.url) ?? null
      : null;
    const dollar = ownedPage ? ownedPage.ga4Value : 0;
    const friction = ownedPage ? ownedPage.frictionScore : 0;

    // ── independent-signal confidence (the lie detector's honesty gate) ──
    const signals: string[] = [];
    if (num(raw?.gscImpressions) > 0) signals.push("GSC");
    if (num(raw?.searchVolume) > 0) signals.push("volume");
    if (num(raw?.aiExecutions) > 0 || compEdges.length > 0) signals.push("AI");
    if (dollar > 0) signals.push("$");
    if (ownedPage) signals.push("owned-page");
    const confidence: ConfidenceLevel =
      signals.length >= 3 ? "high" : signals.length === 2 ? "medium" : "low";

    // A create_page candidate (competitors cited, you have no page) is evidenced
    // by AI-citation breadth, NOT GSC impressions — so the GSC-scale demand floor
    // doesn't apply. It surfaces with honest LOW confidence (no measured search
    // volume yet — that arrives with SERP/DataForSEO in Step L7).
    const isCreateCandidate = compEdges.length > 0 && ownedEdges.length === 0;
    if (node.demandWeight < cfg.minDemand && !isCreateCandidate) {
      moves.push(moveRow(node, "low_demand", null, competitorUrls, fanoutSeeds,
        { demand: node.demandWeight, winnability: 0.1, dollarValue: dollar, visibilityGap: 0, friction },
        confidence, signals, "Below the demand floor — not worth acting on yet.", 0));
      continue;
    }

    let gap: GapKind;
    let winnability: number;
    let visibilityGap: number;
    let rationale: string;
    if (ownedEdges.length === 0) {
      gap = "create_page";
      winnability = 0.6; // from scratch — more work than an edit, but full control
      visibilityGap = 1; // you are completely absent
      rationale = compEdges.length > 0
        ? `${compEdges.length} competitor page(s) own this demand and you have NO page. Create it — you have the volume, fanouts, and the competitor teardown.`
        : `Real demand with no owned page and no obvious incumbent — a clean land-grab.`;
    } else {
      const kind = bestOwned!.kind;
      const citedHere = ownedPage ? ownedPage.aiCitationCount > cfg.notCitedAtOrBelow : false;
      if (kind === "owned_friction") {
        gap = "fix_experience";
        winnability = 0.8;
        visibilityGap = Math.max(0.2, 1 - node.ownedAiShare);
        rationale = `You rank here but the page frustrates visitors (Clarity friction ${friction}). Fix the experience before chasing more traffic.`;
      } else if (compEdges.length > 0 && !citedHere) {
        gap = "answer_block";
        winnability = 0.85; // you already rank — just not cited
        visibilityGap = 0.9;
        rationale = `You have a page but AI cites ${compEdges.length} competitor(s), not you. Add a direct, extractable answer block + the fanout sub-questions to win the citation.`;
      } else if (kind === "owned_weak") {
        gap = "edit_page";
        winnability = 0.9; // striking distance
        // Real AEO gap only where competitors are actually cited; otherwise this
        // is a pure CTR/GSC play, so keep visibilityGap low (no AEO evidence).
        visibilityGap = compEdges.length > 0 ? Math.max(0.3, 1 - node.ownedAiShare) : 0.25;
        rationale = `You rank but under-perform (position ${ownedPage?.gscPosition ?? "?"}, CTR ${(num(ownedPage?.gscCtr) * 100).toFixed(1)}%). Tighten title/meta to the dominant query.`;
      } else {
        gap = "healthy";
        winnability = 0.1;
        visibilityGap = 0.1;
        rationale = `Healthy — you rank and get cited. Monitor; revisit if rankings slip.`;
      }
    }

    // Final score from EXPOSED components (kept simple/transparent — money-first):
    //   demand × winnability-band × visibility-band × $-multiplier, + friction boost
    //   only where friction IS the move. Do not overfit; the components are the truth.
    const dollarMult = 1 + Math.log10(dollar + 1) / 2; // $0→1.0, $100→2.0, $10k→3.0
    let score = Math.round(
      node.demandWeight * (0.5 + winnability) * (0.5 + visibilityGap) * dollarMult,
    );
    if (gap === "fix_experience") score += Math.round(friction * 5);
    if (gap === "healthy") score = Math.round(score * 0.05);

    moves.push(moveRow(node, gap, bestOwned?.url ?? null, competitorUrls, fanoutSeeds,
      { demand: node.demandWeight, winnability, dollarValue: dollar, visibilityGap, friction },
      confidence, signals, rationale, score));
  }

  moves.sort((a, b) => b.score - a.score);
  return { demandNodes, pageNodes, edges, moves };
}

function moveRow(
  node: DemandNode,
  gap: GapKind,
  ownedUrl: string | null,
  competitorUrls: string[],
  fanoutSeeds: string[],
  components: MoveComponents,
  confidence: ConfidenceLevel,
  signals: string[],
  rationale: string,
  score: number,
): MoveCandidate {
  return {
    demandKey: node.key,
    label: node.label,
    gap,
    score,
    components,
    confidence,
    signals,
    ownedUrl,
    competitorUrls,
    fanoutSeeds,
    rationale,
  };
}
