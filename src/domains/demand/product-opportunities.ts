/**
 * product-opportunities (2026-06-25, Sprint 4E) — the store/product opportunity
 * layer. PURE / deterministic / no I/O.
 *
 * Turns commerce-intent keyword demand into product/collection opportunities
 * WITHOUT inventing inventory or legal risk:
 *  - Inventory is `concept_only` by DEFAULT — a product is only "verified" when it
 *    maps to a real product page / supplied inventory evidence. Beacon never implies
 *    a product exists.
 *  - Licensing/IP risk is attached to risky concepts (world-cup / team / jersey /
 *    league / official-brand merch) so the operator sees the legal exposure.
 *  - Maps to existing product/collection pages when possible → improve, not
 *    duplicate. Recommends create_product / improve_product_page / create_collection
 *    / improve_collection / no_action.
 *  - NO fabrication: demand/trend come from the connector; weak demand → no_action.
 *
 * Pinned by product-opportunities.test.ts.
 */

import type { KeywordDemand } from "@/domains/serp/dataforseo-keywords";
import { COMMERCE, slugify, tokens, trendOf, type MatchStrength, type TrendDirection } from "./keyword-opportunities";

export type ProductAction =
  | "create_product"
  | "improve_product_page"
  | "create_collection"
  | "improve_collection"
  | "no_action";

export type InventoryStatus = "verified" | "concept_only" | "unknown";
export type PageKind = "product" | "collection" | "content";

export type ProductPageLite = {
  url: string;
  title?: string | null;
  /** When known (Wix store / CMS). Inferred from the URL path otherwise. */
  kind?: PageKind;
  /** True when the caller has CONFIRMED this is live inventory (Wix store product). */
  inStock?: boolean;
};

export type ProductOpportunity = {
  id: string;
  keyword: string;
  estDemand: number;
  trend: TrendDirection;
  inventoryStatus: InventoryStatus;
  conceptOnly: boolean;
  matchedPageUrl: string | null;
  matchedPageKind: PageKind | null;
  matchStrength: MatchStrength;
  recommendedAction: ProductAction;
  licensingRisk: string | null;
  confidence: "high" | "medium" | "low";
  risk: string | null;
  whyNow: string;
  proposedSlug: string | null;
  proofMetrics: string[];
  evidence: string[];
  operatorSteps: string[];
  shouldBeTodayMove: boolean;
  source: "dataforseo";
};

export type BuildProductOpportunitiesInput = {
  keywords: KeywordDemand[];
  /** Owned product + collection + content pages (kind inferred from URL if absent). */
  pages: ProductPageLite[];
  minVolume?: number;
};

/** Licensing / IP exposure lexicon — team kits, leagues, events, official-brand merch. */
const LICENSING = new Set([
  "world", "cup", "worldcup", "fifa", "jersey", "kit", "team", "club", "league", "olympic", "olympics",
  "official", "nike", "adidas", "puma", "messi", "ronaldo", "nba", "nfl", "uefa", "champions",
]);
/** Broad-category tokens → a COLLECTION (landing) rather than a single product. */
const CATEGORY = new Set([
  "gifts", "gift", "jewelry", "products", "merch", "accessories", "clothing", "apparel", "shirts", "decor",
  "collection", "ideas",
]);
const MIN_VOLUME_DEFAULT = 50;

function inferKind(p: ProductPageLite): PageKind {
  if (p.kind) return p.kind;
  const path = (() => {
    try {
      return new URL(p.url.startsWith("http") ? p.url : `https://${p.url}`).pathname.toLowerCase();
    } catch {
      return p.url.toLowerCase();
    }
  })();
  if (/\/products?\//.test(path)) return "product";
  if (/\/(collections?|category|categories|shop|store)\b/.test(path)) return "collection";
  return "content";
}

function pageTokens(p: ProductPageLite): Set<string> {
  let path = p.url;
  try {
    path = new URL(p.url.startsWith("http") ? p.url : `https://${p.url}`).pathname;
  } catch {
    /* raw */
  }
  return new Set([...tokens(path), ...tokens(p.title ?? "")]);
}

function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  return inter / new Set([...a, ...b]).size;
}

/** Best matching owned product/collection page for a keyword. PURE. */
function matchProductPage(
  kwTokens: Set<string>,
  pages: ProductPageLite[],
): { url: string | null; kind: PageKind | null; strength: MatchStrength; inStock: boolean } {
  let best: { url: string; kind: PageKind; score: number; inStock: boolean } | null = null;
  for (const p of pages) {
    const score = overlap(kwTokens, pageTokens(p));
    if (!best || score > best.score) best = { url: p.url, kind: inferKind(p), score, inStock: p.inStock ?? false };
  }
  if (!best || best.score < 0.3) return { url: null, kind: null, strength: "none", inStock: false };
  return { url: best.url, kind: best.kind, strength: best.score >= 0.55 ? "strong" : "partial", inStock: best.inStock };
}

function licensingRiskFor(kwTokens: Set<string>): string | null {
  const hits = [...kwTokens].filter((t) => LICENSING.has(t));
  if (hits.length === 0) return null;
  return `Licensing/IP risk: "${hits.join(", ")}" implies team/league/brand IP — confirm rights before selling official-style merch.`;
}

/**
 * Build product/commerce opportunities from real keyword demand. PURE.
 * Only commerce-intent keywords with real demand are emitted; everything is
 * concept_only unless mapped to confirmed inventory.
 */
export function buildProductOpportunities(input: BuildProductOpportunitiesInput): ProductOpportunity[] {
  const minVolume = input.minVolume ?? MIN_VOLUME_DEFAULT;
  const out: ProductOpportunity[] = [];

  for (const kw of input.keywords) {
    const t = new Set(tokens(kw.keyword));
    if (t.size === 0) continue;
    const isCommerce = [...t].some((tok) => COMMERCE.has(tok));
    if (!isCommerce) continue; // commerce engine only

    const estDemand = kw.searchVolume ?? 0;
    const trend = trendOf(kw.monthlySearches);
    // No-garbage gate: real demand OR a clear rising trend ("…if demand exists").
    if (estDemand < minVolume && trend !== "rising") continue;

    const match = matchProductPage(t, input.pages);
    const licensingRisk = licensingRiskFor(t);
    const isCategory = [...t].some((tok) => CATEGORY.has(tok));

    // Inventory status: only "verified" when mapped to a CONFIRMED in-stock product
    // page. A page match without inStock evidence is still concept_only (we don't
    // imply the product exists).
    const inventoryStatus: InventoryStatus =
      match.strength !== "none" && match.kind === "product" && match.inStock ? "verified" : "concept_only";
    const conceptOnly = inventoryStatus !== "verified";

    let recommendedAction: ProductAction;
    if (match.strength === "strong" && match.kind === "product") recommendedAction = "improve_product_page";
    else if (match.strength === "strong" && match.kind === "collection") recommendedAction = "improve_collection";
    else if (match.strength === "partial" && match.kind === "collection") recommendedAction = "improve_collection";
    else if (match.strength === "partial" && match.kind === "product") recommendedAction = "improve_product_page";
    else recommendedAction = isCategory ? "create_collection" : "create_product";

    const whyNow =
      trend === "rising"
        ? `Rising commerce demand for "${kw.keyword}" (${estDemand.toLocaleString()}/mo).`
        : `Commerce demand exists for "${kw.keyword}" (${estDemand.toLocaleString()}/mo).`;

    const baseRisk = conceptOnly
      ? "Concept only — no confirmed inventory; do NOT imply the product exists. Verify CMS/stock before listing."
      : null;
    const risk = [baseRisk, licensingRisk].filter(Boolean).join(" ") || null;

    const confidence: ProductOpportunity["confidence"] =
      estDemand >= 1000 ? "high" : estDemand >= minVolume ? "medium" : "low";

    const operatorSteps = conceptOnly
      ? [
          licensingRisk ? "Confirm licensing/IP rights for this concept." : "Confirm you can source/fulfil this product.",
          recommendedAction === "create_collection"
            ? "Draft a collection/landing page concept (no live products yet)."
            : "Draft a product-concept spec (title/desc/images) — staged, not published.",
          "Decide build-vs-skip; nothing goes live without your approval.",
        ]
      : ["Improve the existing product page (title/desc/schema/images).", "Stage the change; publish on approval."];

    out.push({
      id: `product:${slugify(kw.keyword)}`,
      keyword: kw.keyword,
      estDemand,
      trend,
      inventoryStatus,
      conceptOnly,
      matchedPageUrl: match.url,
      matchedPageKind: match.kind,
      matchStrength: match.strength,
      recommendedAction,
      licensingRisk,
      confidence,
      risk,
      whyNow,
      proposedSlug: match.strength === "none" ? slugify(kw.keyword) : null,
      proofMetrics: ["product/collection page impressions + clicks (GSC)", "conversions (GA4, if measurable)"],
      evidence: [
        `${estDemand.toLocaleString()}/mo search volume`,
        `trend: ${trend}`,
        match.url ? `maps to ${match.kind} page ${match.url}` : "no existing product/collection page",
        `inventory: ${inventoryStatus}`,
      ],
      operatorSteps,
      // Concept-only products CAN be Today-Move candidates, but stay clearly labeled.
      // Weak evidence (low confidence) ⇒ not ranked today.
      shouldBeTodayMove: confidence !== "low",
      source: "dataforseo",
    });
  }

  const rank = (o: ProductOpportunity) => (o.trend === "rising" ? 1_000_000 : 0) + o.estDemand;
  return out.sort((a, b) => rank(b) - rank(a));
}
