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
import { anchoredTopicMatch, weakAnchorTokens } from "@/domains/evidence/relevance-gate";
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

/** Rank retained keywords by volume (desc), then cap. The RETENTION cap only:
 *  paid SERP selection goes through selectSerpAgenda, never through volume. Pure. */
export function rankAndCap(retained: FunnelKeyword[], cap: number): FunnelKeyword[] {
  return [...retained].sort((a, b) => (b.searchVolume ?? 0) - (a.searchVolume ?? 0)).slice(0, cap);
}

// ── the SERP agenda (relevance convergence, 2026-07-26) ─────────────────────

export type SerpAgendaPageQuery = { query: string; impressions?: number | null; declining?: boolean };

/** Volume desc with a lexicographic tiebreak: a TOTAL order, never input order. */
const byVolume = (a: FunnelKeyword, b: FunnelKeyword) =>
  (b.searchVolume ?? 0) - (a.searchVolume ?? 0) || a.keyword.localeCompare(b.keyword);

/** Normalized, deduped, lexicographically ordered topics: shuffling the caller's
 *  array can never rotate which topic gets served first. Pure. */
function stableTopics(phrases: string[]): string[] {
  return [...new Set((phrases ?? []).map(normalizeKeyword).filter(Boolean))].sort();
}

/**
 * THE agenda of keywords worth a paid search look. Volume alone bought Iranopedia
 * all 40 slots on national news ("iran cat" 368k, "bbc persian" 301k) while its own
 * money themes (persian names, 2,900/mo) sat in the retained set unchecked, because
 * an account's ubiquitous tokens ("iran", "persian") make every query look related.
 * So every topical match here is ANCHORED against the account's own weak tokens, and
 * four bounded portfolios fill the cap in priority order, unused quota flowing on:
 *   P1 (<=12) queries my strongest pages already rank for, declining ones first
 *   P2 (<=10) coverage of the questions and AI fan-out queries I actually track
 *   P3 (<=10) one strong keyword per confirmed theme, round-robin, no theme faked
 *   P4 (rest) plain volume exploration, so genuinely huge demand still gets a look
 * Never exceeds the cap, never invents a query, and the same inputs in ANY array
 * order produce the same agenda. Pure.
 */
export function selectSerpAgenda(
  input: { retained: FunnelKeyword[]; themes: string[]; promptTopics: string[]; pageQueries: SerpAgendaPageQuery[] },
  cap = 40,
): string[] {
  const weak = weakAnchorTokens(input.themes ?? []);
  const pool = new Map<string, FunnelKeyword>();
  for (const k of input.retained ?? []) {
    const keyword = normalizeKeyword(k.keyword);
    if (!keyword) continue;
    const prev = pool.get(keyword);
    if (!prev || (k.searchVolume ?? -1) > (prev.searchVolume ?? -1)) pool.set(keyword, { ...k, keyword });
  }
  const rows = [...pool.values()].sort(byVolume);
  const chosen: string[] = [];
  const used = new Set<string>();
  const take = (k: FunnelKeyword | undefined, stop: number): void => {
    if (!k || chosen.length >= stop || used.has(k.keyword)) return;
    used.add(k.keyword);
    chosen.push(k.keyword);
  };
  const matches = (topic: string) => rows.filter((r) => anchoredTopicMatch(r.keyword, topic, weak).relevant);
  /** Every topic's best candidate before any topic's second, in stable topic order. */
  const roundRobin = (groups: FunnelKeyword[][], stop: number): void => {
    const at = groups.map(() => 0);
    while (chosen.length < stop) {
      let moved = false;
      for (let g = 0; g < groups.length && chosen.length < stop; g += 1) {
        const list = groups[g]!;
        let i = at[g]!;
        while (i < list.length && used.has(list[i]!.keyword)) i += 1;
        at[g] = i + 1;
        if (i >= list.length) continue;
        take(list[i], stop);
        moved = true;
      }
      if (!moved) break;
    }
  };

  // P1: what my own strongest pages already rank for (an exact keyword match, else
  // the BEST-MATCHING anchored candidate, judged by shared strong tokens with volume
  // only as the tiebreak: rows is volume-ordered, and a bare .find() here once handed
  // a declining money page's slot to a 368k news query on volume alone), the queries
  // that are slipping checked before the steady ones.
  const stop1 = Math.min(cap, 12);
  const pageQueries = (input.pageQueries ?? [])
    .map((q) => ({ query: normalizeKeyword(q.query), impressions: q.impressions ?? 0, declining: q.declining === true }))
    .filter((q) => q.query)
    .sort((a, b) => Number(b.declining) - Number(a.declining) || b.impressions - a.impressions || a.query.localeCompare(b.query));
  const bestFor = (q: string): FunnelKeyword | undefined => {
    let best: FunnelKeyword | undefined, bestShared = 0;
    for (const r of rows) {
      if (used.has(r.keyword)) continue;
      const v = anchoredTopicMatch(r.keyword, q, weak);
      if (v.relevant && v.sharedTerms.length > bestShared) { best = r; bestShared = v.sharedTerms.length; }
    }
    return best;
  };
  for (const q of pageQueries) {
    if (chosen.length >= stop1) break;
    take(pool.get(q.query) ?? bestFor(q.query), stop1);
  }
  // P2 then P3: the questions I track, then EVERY confirmed theme, on ABSOLUTE
  // ceilings (22, 32) so quota a portfolio leaves unspent flows to the NEXT themed
  // portfolio before volume exploration ever sees it. A theme with no strongly
  // anchored candidate is skipped honestly rather than filled with noise.
  roundRobin(stableTopics(input.promptTopics ?? []).map(matches), Math.min(cap, 22));
  roundRobin(stableTopics(input.themes ?? []).map(matches), Math.min(cap, 32));
  // P4: bounded exploration, so real demand I have no theme for is still seen once.
  for (const r of rows) take(r, cap);
  return chosen;
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
