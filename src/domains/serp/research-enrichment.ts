/**
 * research-enrichment (2026-06-29) — PURE helpers for the PageResearchPack DataForSEO
 * producer: (1) extract a compact SERP "what wins" pattern from a SERP snapshot
 * (format + title pattern + winning domains + the on-page element it implies), and
 * (2) plan the enrichment spend for a set of research packs (volume + SERP terms,
 * cached vs missing, call counts, estimated USD) BEFORE any live call.
 *
 * No I/O, no server-only — the producer (research-enrichment-producer.ts) does the
 * gauntlet calls + persistence. Deterministic so it's unit-testable.
 */

import type { SerpSnapshot } from "./serp-provider";

export type SerpFormat = "list" | "guide" | "faq" | "table" | "product" | "ugc" | "mixed";

export type SerpPattern = {
  query: string;
  format: SerpFormat;
  /** A human label for the dominant title shape ("numbered list", "guide/explainer", …). */
  titlePattern: string;
  /** Common title modifiers across the top results (best, top, with meanings, year, …). */
  modifiers: string[];
  /** Top winning domains (by rank). */
  winningDomains: string[];
  /** What this implies the page should DO (the element to add/lead with). */
  elementImplication: string;
  fetchedAt: string | null;
};

const LIST_CUE = /\b(best|top|list|ideas|examples|types|ranked|popular)\b/i;
const GUIDE_CUE = /\b(guide|how to|how-to|tutorial|explained|complete|ultimate|tips|meaning|meanings)\b/i;
const PRODUCT_DOMAIN = /(etsy|amazon|ebay|walmart|aliexpress|alibaba|shopify|\bshop\b|\bstore\b)/i;
const UGC_DOMAIN = /(reddit|quora|stackexchange|stackoverflow|pinterest|youtube|tiktok)/i;

const MODIFIERS = [
  "best", "top", "guide", "list", "with meanings", "near me", "for kids", "ideas",
  "explained", "complete", "ultimate", "vs", "reviews", "examples", "meaning",
];

const ELEMENT_IMPLICATION: Record<SerpFormat, string> = {
  list: "lead with a numbered list + a scannable table",
  guide: "open with a direct answer, then sectioned H2s (a proper guide)",
  faq: "add an answer block up top + an FAQ (FAQPage schema)",
  table: "add a comparison table near the top",
  product: "this is a product/collection SERP — optimize the product/category page (schema + images)",
  ugc: "win with a first-person, opinionated angle the forums lack",
  mixed: "add a clear answer up top + structured sections",
};

const TITLE_PATTERN: Record<SerpFormat, string> = {
  list: 'numbered list (e.g. "N Best …")',
  guide: "guide / explainer titles",
  faq: "question-led titles + People-Also-Ask",
  table: "comparison / ranked titles",
  product: "product & shop listings",
  ugc: "forum / community threads",
  mixed: "mixed intent",
};

function hasLeadingNumber(title: string): boolean {
  return /^\s*\d{1,3}\b/.test(title) || /\b\d{1,3}\s+(best|top|of)\b/i.test(title);
}

/**
 * Derive the SERP "what wins" pattern from a snapshot — deterministically, from the
 * top organic titles + SERP features + winning domains. PURE.
 */
export function extractSerpPattern(snapshot: SerpSnapshot): SerpPattern {
  const top = snapshot.results.slice(0, 10);
  const titles = top.map((r) => r.title).filter(Boolean);
  const domains = [...new Set(top.map((r) => r.domain).filter(Boolean))];
  const text = titles.join(" | ").toLowerCase();
  const feats = new Set(snapshot.features);
  const numbered = titles.filter(hasLeadingNumber).length;

  let format: SerpFormat;
  if (domains.filter((d) => PRODUCT_DOMAIN.test(d)).length >= 2) format = "product";
  else if (domains.filter((d) => UGC_DOMAIN.test(d)).length >= 2) format = "ugc";
  else if (numbered >= 3 || LIST_CUE.test(text)) format = "list";
  else if (feats.has("featured_snippet") || feats.has("people_also_ask")) format = "faq";
  else if (GUIDE_CUE.test(text)) format = "guide";
  else format = "mixed";

  const modifiers = MODIFIERS.filter((m) => text.includes(m)).slice(0, 5);

  return {
    query: snapshot.query,
    format,
    titlePattern: TITLE_PATTERN[format],
    modifiers,
    winningDomains: domains.slice(0, 5),
    elementImplication: ELEMENT_IMPLICATION[format],
    fetchedAt: snapshot.fetchedAt,
  };
}

export type ResearchPackLite = {
  url: string;
  primaryIntent: string | null;
  own: string[];
  sibling: string[];
};

export type EnrichmentPlan = {
  /** Keyword-volume terms: owned + cross-link keywords across all packs (deduped). */
  volumeTerms: string[];
  volumeCached: string[];
  volumeMissing: string[];
  /** SERP terms: one primary intent per pack (deduped). */
  serpTerms: string[];
  serpCached: string[];
  serpMissing: string[];
  /** Batched search-volume calls (≤~700 kw/task) + one SERP call per missing primary. */
  volumeCalls: number;
  serpCalls: number;
  estUsd: number;
};

const VOLUME_BATCH = 700;
const VOLUME_CALL_USD = 0.08;
const SERP_CALL_USD = 0.003;

const lc = (s: string) => s.trim().toLowerCase();
const uniq = (xs: string[]) => [...new Set(xs.map(lc).filter((x) => x.length >= 2))];

/**
 * Plan the DataForSEO enrichment for these packs against the current caches — cached
 * vs missing terms, call counts, estimated spend. PURE (caches passed as sets). The
 * cost is dominated by 1 volume batch + 1 SERP per page, so it stays tiny for top-N.
 */
export function planResearchEnrichment(
  packs: ResearchPackLite[],
  caches: { volumeCached: Set<string>; serpCached: Set<string> },
): EnrichmentPlan {
  const volumeTerms = uniq(packs.flatMap((p) => [...p.own, ...p.sibling]));
  const serpTerms = uniq(packs.map((p) => p.primaryIntent ?? "").filter(Boolean));

  const volumeCached = volumeTerms.filter((t) => caches.volumeCached.has(t));
  const volumeMissing = volumeTerms.filter((t) => !caches.volumeCached.has(t));
  const serpCached = serpTerms.filter((t) => caches.serpCached.has(t));
  const serpMissing = serpTerms.filter((t) => !caches.serpCached.has(t));

  const volumeCalls = volumeMissing.length > 0 ? Math.ceil(volumeMissing.length / VOLUME_BATCH) : 0;
  const serpCalls = serpMissing.length;
  const estUsd = Number((volumeCalls * VOLUME_CALL_USD + serpCalls * SERP_CALL_USD).toFixed(3));

  return { volumeTerms, volumeCached, volumeMissing, serpTerms, serpCached, serpMissing, volumeCalls, serpCalls, estUsd };
}
