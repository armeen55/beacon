import "server-only";

/**
 * funnel/normalize (integrity closure, Agent B) - the PURE broad-then-narrow
 * core: keyword normalize + dedupe, deterministic relevance/constraint/junk
 * filters with a bounded reject taxonomy, a thin mapper from the registry's typed
 * ParsedKeywordItem onto the funnel row, and winning-page ranking that preserves
 * TRUE per-appearance provenance. No I/O, no envelope-poking, never throws.
 */

import { GEMINI_WRAPPER_HOST } from "@/domains/evidence/competitor-intel/polite-fetch";
import type { ParsedKeywordItem } from "@/domains/evidence/dataforseo/funnel-boundary";
import { rootDomain } from "@/domains/evidence/readers/serp-provider";
import type { ResearchWinningAppearance } from "./research-evidence";
import type { FunnelKeyword, FunnelReject } from "./state";

// ── keyword normalization + dedupe ──────────────────────────────────────────

/** Lowercase, strip punctuation to spaces, collapse whitespace. */
export function normalizeKeyword(raw: string): string {
  return (raw ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Order-insensitive dedupe identity: sorted unique tokens. */
function coreIdentity(keyword: string): string {
  const toks = [...new Set(normalizeKeyword(keyword).split(" ").filter(Boolean))].sort();
  return toks.join(" ");
}

function tokenize(s: string): string[] {
  return normalizeKeyword(s).split(" ").filter(Boolean);
}

/** Map the registry's typed keyword items onto lean funnel rows. Pure. */
export function keywordsFromParsed(items: ParsedKeywordItem[], via: FunnelKeyword["discoveredVia"]): FunnelKeyword[] {
  const out: FunnelKeyword[] = [];
  for (const it of items) {
    if (!it || typeof it.keyword !== "string" || !it.keyword.trim()) continue;
    out.push({ keyword: it.keyword, searchVolume: it.searchVolume, competition: it.competition, difficulty: it.difficulty, intent: it.intent, discoveredVia: via });
  }
  return out;
}

/** Dedupe a raw candidate pool by core identity, keeping the richest row per key
 *  (the one carrying a search volume wins over a bare keyword). Pure. */
export function dedupeKeywords(raw: FunnelKeyword[]): FunnelKeyword[] {
  const byKey = new Map<string, FunnelKeyword>();
  for (const k of raw) {
    const norm = normalizeKeyword(k.keyword);
    if (!norm) continue;
    const id = coreIdentity(norm);
    const prev = byKey.get(id);
    const row: FunnelKeyword = { ...k, keyword: norm };
    if (!prev) byKey.set(id, row);
    else if ((row.searchVolume ?? -1) > (prev.searchVolume ?? -1)) byKey.set(id, row);
  }
  return [...byKey.values()];
}

// ── deterministic filters + reject taxonomy ─────────────────────────────────

/** The complete, bounded reject-reason vocabulary. */
type RejectReason = "banned_term" | "excluded_topic" | "junk" | "competitor_brand" | "irrelevant";

type FilterContext = {
  relevanceTokens: Set<string>;
  excludeTerms: string[];
  bannedTerms: string[];
  competitorBrands: string[];
};

const JUNK_RE =
  /\b(login|log in|sign ?in|sign ?up|download|app store|google play|porn|xxx|nude|sex|escort|casino|torrent|crack|free download)\b/i;

/** Build the relevance/constraint context from a confirmed BusinessProfile's
 *  offerings, topics-to-own, and customer problems (all token sources). Pure. */
export function filterContextFrom(input: {
  offerings: string[];
  topicsToOwn: string[];
  customerProblems: string[];
  topicsToExclude: string[];
  bannedTerms: string[];
  competitors: string[];
}): FilterContext {
  const relevanceTokens = new Set<string>();
  for (const phrase of [...input.offerings, ...input.topicsToOwn, ...input.customerProblems]) {
    for (const t of tokenize(phrase)) if (t.length >= 3) relevanceTokens.add(t);
  }
  return {
    relevanceTokens,
    excludeTerms: input.topicsToExclude.map((t) => t.toLowerCase().trim()).filter(Boolean),
    bannedTerms: input.bannedTerms.map((t) => t.toLowerCase().trim()).filter(Boolean),
    competitorBrands: input.competitors.map((t) => t.toLowerCase().trim()).filter(Boolean),
  };
}

/** Classify ONE normalized keyword: keep, or the first reason it fails. Pure. */
function classifyKeyword(keyword: string, ctx: FilterContext): { keep: boolean; reason?: RejectReason } {
  const norm = normalizeKeyword(keyword);
  if (!norm) return { keep: false, reason: "junk" };
  const toks = new Set(norm.split(" "));
  if (ctx.bannedTerms.some((b) => b && norm.includes(b))) return { keep: false, reason: "banned_term" };
  if (ctx.excludeTerms.some((e) => e && norm.includes(e))) return { keep: false, reason: "excluded_topic" };
  if (JUNK_RE.test(norm)) return { keep: false, reason: "junk" };
  const overlaps = [...toks].some((t) => ctx.relevanceTokens.has(t));
  const hitsCompetitor = ctx.competitorBrands.some((c) => c && norm.includes(c));
  if (hitsCompetitor && !overlaps) return { keep: false, reason: "competitor_brand" };
  if (!overlaps && ctx.relevanceTokens.size > 0) return { keep: false, reason: "irrelevant" };
  return { keep: true };
}

/** Split a normalized pool into retained + bounded rejects (broad -> narrow). Pure. */
export function applyFilters(
  pool: FunnelKeyword[],
  ctx: FilterContext,
  maxRejected: number,
): { retained: FunnelKeyword[]; rejected: FunnelReject[] } {
  const retained: FunnelKeyword[] = [];
  const rejected: FunnelReject[] = [];
  for (const k of pool) {
    const verdict = classifyKeyword(k.keyword, ctx);
    if (verdict.keep) retained.push(k);
    else if (rejected.length < maxRejected) rejected.push({ keyword: k.keyword, reason: verdict.reason ?? "irrelevant" });
  }
  return { retained, rejected };
}

/** Rank retained keywords by volume (desc), then cap. Pure. */
export function rankAndCap(retained: FunnelKeyword[], cap: number): FunnelKeyword[] {
  return [...retained].sort((a, b) => (b.searchVolume ?? 0) - (a.searchVolume ?? 0)).slice(0, cap);
}

// ── winning-page ranking (pure, TRUE provenance) ────────────────────────────

type WinningCandidate = { url: string; domain: string; weight: number; appearances: ResearchWinningAppearance[] };

/** Exact host of a URL, lowercased ("" when unparseable). */
function exactHost(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/** Defensive mode-blind dedupe for AI answers (Slice 6I). The chatgpt consumer
 *  look and the standardized ask are TWO observations of one engine, so the same
 *  prompt + engine + url must count ONCE; consumer_search wins the tie. Collection
 *  already dedupes, so this only stops a duplicate from ever inflating weight.
 *  SERP appearances are untouched. Order preserved. Pure. */
function dedupeAppearances(appearances: ResearchWinningAppearance[]): ResearchWinningAppearance[] {
  const slotOf = new Map<string, number>();
  const out: ResearchWinningAppearance[] = [];
  for (const a of appearances) {
    if (a.kind !== "ai_answer") {
      out.push(a);
      continue;
    }
    const id = `${a.promptId ?? ""}|${a.engine ?? ""}|${a.citedUrl}`;
    const slot = slotOf.get(id);
    if (slot === undefined) {
      slotOf.set(id, out.length);
      out.push(a);
    } else if (a.observationMode === "consumer_search" && out[slot]!.observationMode !== "consumer_search") {
      out[slot] = a;
    }
  }
  return out;
}

/** Aggregate winning pages from a flat appearance stream, each appearance carrying
 *  its ACTUAL source (query or real prompt id + text, engine, rank). AI surfaces
 *  weight double; organic top-10 single; the account's own domain is excluded. A
 *  page's engines/prompts derive from ITS OWN appearances only. Pure. */
export function rankWinningPages(
  appearances: ResearchWinningAppearance[],
  ownDomain: string | null,
  topN: number,
): WinningCandidate[] {
  const own = (ownDomain ?? "").toLowerCase();
  const byUrl = new Map<string, WinningCandidate>();
  for (const a of dedupeAppearances(appearances)) {
    const url = a.citedUrl;
    if (!url) continue;
    // An UNRESOLVED Gemini redirect wrapper is infrastructure, not a page: it can
    // never rank as a competitor or winning page. Resolved citations arrive here
    // as their real target (viaUrl keeps the raw wrapper), so they rank normally.
    if (exactHost(url) === GEMINI_WRAPPER_HOST) continue;
    const d = rootDomain(url).toLowerCase();
    if (!d) continue;
    if (own && (d === own || d.endsWith(`.${own}`))) continue;
    if (a.kind === "serp_organic" && (a.rank == null || a.rank > 10)) continue;
    const weight = a.kind === "serp_organic" ? 1 : 2;
    const prev = byUrl.get(url) ?? { url, domain: d, weight: 0, appearances: [] };
    prev.weight += weight;
    prev.appearances.push(a);
    byUrl.set(url, prev);
  }
  return [...byUrl.values()].sort((x, y) => y.weight - x.weight || x.url.localeCompare(y.url)).slice(0, topN);
}
