/**
 * serp-validation (2026-06-25, Phase 4) - turn a live SERP snapshot into a
 * create-page VERDICT. Pure + dependency-free (the SERP fetch happens in
 * dataforseo-serp; this only judges the result), so it's fully testable with no
 * paid call.
 *
 * The demand graph proposes create_page candidates at LOW confidence (AI-attention
 * proxy, no measured search demand). DataForSEO's real SERP is the truth test:
 *  - top results are CONTENT pages (+ a competitor AI already cites) → upgrade, build it
 *  - SERP is marketplace/UGC-dominated, or brand/own-shop → downgrade/reject (you
 *    can't out-rank Amazon/Etsy/Reddit with an article; not a content gap)
 *
 * Item 18 (2026-07-02): the SERP-shape verdict above judges vibes (is this a
 * content SERP?). ValidateInput now optionally accepts `winnability` - the pure
 * arithmetic from winnability.ts built off three cheap reads (keyword
 * difficulty, winning-domain ranks, backlink gap). When present, arithmetic can
 * only ever DOWNGRADE a shape-optimistic "build" (to "wait" on a hard band, or
 * "reject" on a reject band) and add the concrete numbers to `reasons` - it
 * never upgrades a shape-based reject (already-rank / marketplace-UGC stay
 * authoritative; arithmetic answers "can you win a content SERP", not "is this
 * even a content SERP").
 */

import type { SerpSnapshot } from "./serp-provider";
import { computeWinnability, type WinnabilityInput, type Winnability } from "./winnability";

// Marketplaces + UGC/social: a content page can't win these SERPs, and a brand's
// listing there isn't a content gap. Matched by domain label (so subdomains/cctlds
// are caught: ru.pinterest.com, etsy.com.bh).
const MARKETPLACE_UGC = new Set([
  "amazon", "etsy", "ebay", "walmart", "aliexpress", "alibaba", "temu", "shein",
  "pinterest", "reddit", "quora", "facebook", "instagram", "tiktok", "youtube",
  "x", "twitter", "tripadvisor", "yelp",
]);

function labelOf(domain: string): string[] {
  return domain.toLowerCase().split(".");
}
function isMarketplaceUgc(domain: string): boolean {
  return labelOf(domain).some((l) => MARKETPLACE_UGC.has(l));
}

export type CreateVerdict = "build" | "wait" | "reject";
export type CreateConfidence = "high" | "medium" | "low";

export type SerpValidation = {
  /** distinct top-10 organic domains */
  topDomains: string[];
  /** SERP shape */
  marketplaceUgcCount: number;
  contentDomainCount: number;
  /** how many top-SERP domains are ALSO Profound-cited competitors for this topic */
  profoundOverlapCount: number;
  /** does the tenant ALREADY rank in the top 10 (then it's an edit, not a create)? */
  ownAlreadyRanks: boolean;
  intent: "content" | "marketplace_ugc" | "mixed";
  verdict: CreateVerdict;
  confidence: CreateConfidence;
  reasons: string[];
  /** Item 18: the difficulty/domain-rank/backlink-gap arithmetic, when reads were supplied. Absent = not read yet. */
  winnability?: Winnability;
};

export type ValidateInput = {
  snapshot: SerpSnapshot | null;
  /** the tenant's own domain (so we detect "you already rank") */
  ownDomain: string;
  /** competitor domains Profound cites for this topic (overlap = strong signal) */
  profoundDomains?: readonly string[];
  /** measured monthly search volume when DataForSEO/SEMrush has it (null = unknown) */
  searchVolume?: number | null;
  /** Item 18: optional winnability reads (difficulty, winning-domain ranks, backlink gap). Absent = shape-only verdict (unchanged behavior). */
  winnability?: WinnabilityInput;
};

/**
 * Judge a create-page candidate from its live SERP. Pure. With no snapshot
 * (SERP unknown / not fetched yet) it returns the honest LOW/"wait" default,
 * never fabricates a verdict.
 */
export function validateCreatePage(input: ValidateInput): SerpValidation {
  const { snapshot, ownDomain } = input;
  const profound = new Set((input.profoundDomains ?? []).map((d) => d.toLowerCase()));
  const reasons: string[] = [];

  if (!snapshot || snapshot.results.length === 0) {
    return {
      topDomains: [],
      marketplaceUgcCount: 0,
      contentDomainCount: 0,
      profoundOverlapCount: 0,
      ownAlreadyRanks: false,
      intent: "content",
      verdict: "wait",
      confidence: "low",
      reasons: ["No live SERP yet, confidence stays low until DataForSEO confirms real demand."],
    };
  }

  const top = snapshot.results.slice(0, 10);
  const topDomains = [...new Set(top.map((r) => r.domain).filter(Boolean))];
  const marketplaceUgcCount = topDomains.filter(isMarketplaceUgc).length;
  const contentDomainCount = topDomains.length - marketplaceUgcCount;
  const ownLabel = ownDomain.toLowerCase().replace(/^www\./, "").split(".")[0] ?? "";
  const ownAlreadyRanks = ownLabel.length >= 3 && topDomains.some((d) => labelOf(d).includes(ownLabel));
  const profoundOverlapCount = topDomains.filter((d) => profound.has(d)).length;
  const volume = input.searchVolume ?? null;

  const intent: SerpValidation["intent"] =
    marketplaceUgcCount >= 6 ? "marketplace_ugc" : marketplaceUgcCount >= 3 ? "mixed" : "content";

  // ── verdict ──
  let verdict: CreateVerdict;
  let confidence: CreateConfidence;
  if (ownAlreadyRanks) {
    verdict = "reject";
    confidence = "low";
    reasons.push("You already rank for this, it's an EDIT, not a new page.");
  } else if (intent === "marketplace_ugc") {
    verdict = "reject";
    confidence = "low";
    reasons.push(`SERP is marketplace/UGC-dominated (${marketplaceUgcCount}/10), a content page can't win it.`);
  } else if (intent === "content" && contentDomainCount >= 5) {
    // Real content SERP → buildable. Strength depends on corroborating signals.
    const corroborated = (volume != null && volume > 0 ? 1 : 0) + (profoundOverlapCount > 0 ? 1 : 0);
    verdict = "build";
    confidence = corroborated >= 2 ? "high" : corroborated === 1 ? "medium" : "low";
    reasons.push(`Content-page SERP (${contentDomainCount}/10 editorial), out-buildable.`);
    if (volume != null && volume > 0) reasons.push(`Real search volume: ${volume.toLocaleString()}/mo.`);
    if (profoundOverlapCount > 0) reasons.push(`${profoundOverlapCount} of the ranking pages are competitors AI already cites, double-confirmed demand.`);
    if (corroborated === 0) reasons.push("No measured volume and no AI-citation overlap yet, so it's buildable but unproven; keep confidence low.");
  } else {
    verdict = "wait";
    confidence = "low";
    reasons.push(`Mixed SERP (${contentDomainCount} content / ${marketplaceUgcCount} marketplace), verify intent before building.`);
  }

  // ── item 18: arithmetic downgrade only. Shape-based rejects (already-rank,
  // marketplace/UGC) stay authoritative; winnability never fires for them. A
  // shape-optimistic build/wait can be downgraded (never upgraded) once the real
  // difficulty/domain-strength/backlink numbers are in. ──
  let winnability: Winnability | undefined;
  if (input.winnability && verdict !== "reject") {
    winnability = computeWinnability({ ...input.winnability, serpShape: { intent, contentDomainCount } });
    reasons.push(winnability.sentence);
    if (winnability.band === "reject") {
      verdict = "reject";
      confidence = "low";
    } else if (winnability.band === "hard" && verdict === "build") {
      verdict = "wait";
      confidence = "low";
    }
  }

  return {
    topDomains,
    marketplaceUgcCount,
    contentDomainCount,
    profoundOverlapCount,
    ownAlreadyRanks,
    intent,
    winnability,
    verdict,
    confidence,
    reasons,
  };
}
