/**
 * keyword-opportunities (2026-06-25, Sprint 4B+4C) — turn real keyword demand
 * (DataForSEO, Sprint 4A) into deduped, gap-mapped, evidence-backed Beacon
 * opportunities. PURE / deterministic / no I/O.
 *
 * Guarantees the operator asked for:
 *  - NO garbage long-tail: a min-volume floor + a tenant-relevance gate drop
 *    thin/irrelevant keywords (unless a clear rising trend justifies a low-volume one).
 *  - DEDUP: near-duplicate keywords cluster into ONE opportunity (head-token group).
 *  - GAP MAP (4C): each cluster is matched to an existing owned page → strong /
 *    partial / none, which decides the action (refresh/expand vs create), so Beacon
 *    never recommends a new page when an existing one can be improved.
 *  - NO fabrication: demand/CPC/competition/trend come straight from the connector;
 *    a keyword with no volume contributes nothing invented.
 *  - TENANT-AGNOSTIC: "relevance" is overlap with the tenant's OWN page topics
 *    (derived, not a hardcoded category list), so this works for any site.
 *
 * Pinned by keyword-opportunities.test.ts.
 */

import type { KeywordDemand } from "@/domains/serp/dataforseo-keywords";

export type OpportunityAction =
  | "create_page"
  | "create_product"
  | "expand_page"
  | "add_answer_block"
  | "update_title_meta"
  | "content_refresh"
  | "no_action";

export type MatchStrength = "strong" | "partial" | "none";
export type TrendDirection = "rising" | "flat" | "declining" | "unknown";

export type OwnedPageLite = {
  url: string;
  title?: string | null;
};

export type DemandOpportunity = {
  id: string;
  action: OpportunityAction;
  parentType: "content_move" | "commerce_move";
  primaryKeyword: string;
  cluster: string[];
  estDemand: number;
  cpcUsd: number | null;
  competition: number | null;
  matchedPageUrl: string | null;
  matchStrength: MatchStrength;
  proposedSlug: string | null;
  relevance: number;
  confidence: "high" | "medium" | "low";
  trend: TrendDirection;
  whyNow: string;
  risk: string | null;
  evidence: string[];
  operatorSteps: string[];
  proofMetrics: string[];
  shouldBeTodayMove: boolean;
  source: "dataforseo";
};

export type BuildOpportunitiesInput = {
  keywords: KeywordDemand[];
  ownedPages: OwnedPageLite[];
  /** The tenant's own topic vocabulary (derived from owned pages by the caller) —
   *  the relevance anchor. Empty = relevance gate is skipped (accept all). */
  tenantTopics?: string[];
  minVolume?: number;
};

const STOP = new Set([
  "the", "a", "an", "and", "or", "of", "for", "to", "in", "on", "is", "are", "what", "how", "best", "vs",
  "with", "your", "you", "near", "me", "list", "top", "guide",
]);
/** Generic commercial-intent tokens (tenant-agnostic SEO lexicon) → a product
 *  opportunity, never live inventory. */
const COMMERCE = new Set([
  "buy", "shop", "gift", "gifts", "shirt", "shirts", "tshirt", "t-shirt", "tee", "jersey", "mug", "poster",
  "jewelry", "necklace", "bracelet", "ring", "print", "sticker", "hoodie", "merch", "store", "sale", "price",
]);
const MIN_VOLUME_DEFAULT = 50;

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !STOP.has(t))
    .map((t) => (t.length > 4 && t.endsWith("s") ? t.slice(0, -1) : t));
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 80);
}

/** Jaccard token overlap, 0..1. */
function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  return inter / new Set([...a, ...b]).size;
}

/** Group near-duplicate keywords into clusters (shared head token + high overlap).
 *  Largest-volume keyword leads each cluster. PURE. */
export function clusterKeywords(keywords: KeywordDemand[]): KeywordDemand[][] {
  const sorted = [...keywords].sort((a, b) => (b.searchVolume ?? 0) - (a.searchVolume ?? 0));
  const clusters: { lead: Set<string>; members: KeywordDemand[] }[] = [];
  for (const kw of sorted) {
    const t = new Set(tokens(kw.keyword));
    if (t.size === 0) continue;
    const hit = clusters.find((c) => overlap(c.lead, t) >= 0.5);
    if (hit) hit.members.push(kw);
    else clusters.push({ lead: t, members: [kw] });
  }
  return clusters.map((c) => c.members);
}

function trendOf(monthly: KeywordDemand["monthlySearches"]): TrendDirection {
  if (monthly.length < 6) return "unknown";
  const recent = monthly.slice(-3).reduce((s, m) => s + m.volume, 0) / 3;
  const prior = monthly.slice(-6, -3).reduce((s, m) => s + m.volume, 0) / 3;
  if (prior <= 0) return recent > 0 ? "rising" : "unknown";
  const delta = (recent - prior) / prior;
  if (delta >= 0.2) return "rising";
  if (delta <= -0.2) return "declining";
  return "flat";
}

/** Tokens from a URL's PATH only (not scheme/domain, which would dilute overlap). */
function urlPathTokens(url: string): string[] {
  let path = url;
  try {
    path = new URL(url.startsWith("http") ? url : `https://${url}`).pathname;
  } catch {
    /* use raw */
  }
  return tokens(path);
}

/** Gap map (4C): match a cluster to the best existing owned page. PURE. */
export function matchClusterToPage(
  clusterTokens: Set<string>,
  ownedPages: OwnedPageLite[],
): { url: string | null; strength: MatchStrength; score: number } {
  let best: { url: string; score: number } | null = null;
  for (const p of ownedPages) {
    const pt = new Set([...urlPathTokens(p.url), ...tokens(p.title ?? "")]);
    const score = overlap(clusterTokens, pt);
    if (!best || score > best.score) best = { url: p.url, score };
  }
  // A single shared generic token (e.g. "persian") is NOT a match — require real
  // topical overlap (>=0.3) for a partial, >=0.55 for a strong page match.
  if (!best || best.score < 0.3) return { url: null, strength: "none", score: best?.score ?? 0 };
  return { url: best.url, strength: best.score >= 0.55 ? "strong" : "partial", score: best.score };
}

/**
 * Build deduped, gap-mapped opportunities from real keyword demand. PURE.
 */
export function buildOpportunities(input: BuildOpportunitiesInput): DemandOpportunity[] {
  const minVolume = input.minVolume ?? MIN_VOLUME_DEFAULT;
  const topicSet = new Set((input.tenantTopics ?? []).flatMap((t) => tokens(t)));
  const out: DemandOpportunity[] = [];

  for (const cluster of clusterKeywords(input.keywords)) {
    const lead = cluster[0]!;
    const estDemand = cluster.reduce((s, k) => s + (k.searchVolume ?? 0), 0);
    const clusterTokens = new Set(cluster.flatMap((k) => tokens(k.keyword)));
    const trend = trendOf(lead.monthlySearches);

    // No-garbage gate: needs real demand OR a clear rising trend.
    if (estDemand < minVolume && trend !== "rising") continue;

    // Relevance gate (tenant-agnostic): overlap with the tenant's own topics.
    const relevance = topicSet.size > 0 ? overlap(clusterTokens, topicSet) : 1;
    if (topicSet.size > 0 && relevance < 0.15) continue; // off-brand → drop

    const isCommerce = [...clusterTokens].some((t) => COMMERCE.has(t));
    // A product is distinct from any content page → never match it to one.
    const match = isCommerce
      ? { url: null as string | null, strength: "none" as MatchStrength, score: 0 }
      : matchClusterToPage(clusterTokens, input.ownedPages);

    let action: OpportunityAction;
    if (isCommerce) action = "create_product";
    else if (match.strength === "none") action = "create_page";
    else if (match.strength === "strong") action = trend === "declining" ? "content_refresh" : "update_title_meta";
    else action = "add_answer_block"; // partial match → strengthen the existing page

    const corroborated = (lead.searchVolume != null ? 1 : 0) + (trend === "rising" ? 1 : 0) + (match.strength !== "none" ? 1 : 0);
    const confidence: DemandOpportunity["confidence"] = corroborated >= 2 ? "high" : corroborated === 1 ? "medium" : "low";

    const whyNow =
      trend === "rising"
        ? `Search demand is rising for "${lead.keyword}" (${estDemand.toLocaleString()}/mo across ${cluster.length} terms).`
        : match.strength === "none"
        ? `Real demand (${estDemand.toLocaleString()}/mo) with no page of yours covering it.`
        : `Real demand (${estDemand.toLocaleString()}/mo); your page can capture more of it.`;

    const operatorSteps =
      action === "create_product"
        ? ["Spec the product concept + design brief (no inventory assumed)", "Add SEO title/meta + image alt", "Place in the right collection"]
        : action === "create_page"
        ? ["Draft the page targeting the cluster's primary query", "Open with a direct answer block", "Add FAQ + schema"]
        : action === "content_refresh"
        ? ["Refresh the existing page (it's losing ground)", "Update facts + re-verify the answer block"]
        : action === "update_title_meta"
        ? ["Tighten the title/meta to the dominant query", "Measure CTR over 7/14/28 days"]
        : ["Add an extractable answer block for the cluster", "Add the cluster's questions as FAQ"];

    out.push({
      id: `kwopp:${slugify(lead.keyword)}`,
      action,
      parentType: isCommerce ? "commerce_move" : "content_move",
      primaryKeyword: lead.keyword,
      cluster: cluster.map((k) => k.keyword),
      estDemand,
      cpcUsd: lead.cpcUsd,
      competition: lead.competition,
      matchedPageUrl: match.url,
      matchStrength: match.strength,
      proposedSlug: match.strength === "none" ? slugify(lead.keyword) : null,
      relevance,
      confidence,
      trend,
      whyNow,
      risk:
        action === "create_product"
          ? "Concept only — confirm inventory/licensing before listing; no live product created."
          : lead.searchVolume == null
          ? "Volume unconfirmed for the lead term — treat as exploratory."
          : null,
      evidence: [
        `dataforseo: ${estDemand.toLocaleString()}/mo${lead.cpcUsd != null ? `, $${lead.cpcUsd.toFixed(2)} CPC` : ""}`,
        `trend: ${trend}`,
        match.strength === "none" ? "no existing page match" : `matches ${match.url} (${match.strength})`,
      ],
      operatorSteps,
      proofMetrics: isCommerce ? ["impressions", "product clicks", "conversions"] : ["impressions", "clicks", "position"],
      // A Today Move when it's confident + demand-backed.
      shouldBeTodayMove: confidence !== "low" && estDemand >= minVolume,
      source: "dataforseo",
    });
  }

  // Rank by demand × confidence, strongest first.
  const confW = { high: 1, medium: 0.7, low: 0.4 } as const;
  return out.sort((a, b) => b.estDemand * confW[b.confidence] - a.estDemand * confW[a.confidence]);
}
