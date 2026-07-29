import "server-only";

/**
 * funnel/normalize (integrity closure, Agent B) - the PURE broad-then-narrow core: keyword normalize +
 * dedupe, deterministic relevance/constraint/junk filters with a bounded reject taxonomy, a thin mapper
 * from the registry's typed ParsedKeywordItem onto the funnel row, and winning-page ranking that
 * preserves TRUE per-appearance provenance. No I/O, no envelope-poking, never throws.
 */

import { GEMINI_WRAPPER_HOST } from "@/domains/evidence/competitor-intel/polite-fetch";
import type { ParsedKeywordItem } from "@/domains/evidence/dataforseo/funnel-boundary";
import { rootDomain } from "@/domains/evidence/readers/serp-provider";
import { isNoiseDomain } from "@/domains/evidence/relevance-gate";
import { anchoredTopicMatch, canonicalQueryKey, topicTokens, weakAnchorTokens } from "@/domains/evidence/relevance-gate";
import { publisherHost } from "@/domains/evidence/serp-shape";
import { canonicalUrlKey } from "@/domains/evidence/snapshot";
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

/** Map the registry's typed keyword items onto lean funnel rows. The SEED is carried so
 *  retention can keep each seed's own discovery alive instead of letting one broad seed
 *  evict every other theme. Pure. */
export function keywordsFromParsed(items: ParsedKeywordItem[], via: FunnelKeyword["discoveredVia"], seed?: string): FunnelKeyword[] {
  const out: FunnelKeyword[] = [];
  for (const it of items) {
    if (!it || typeof it.keyword !== "string" || !it.keyword.trim()) continue;
    out.push({ keyword: it.keyword, searchVolume: it.searchVolume, competition: it.competition, competitionLevel: it.competitionLevel, difficulty: it.difficulty, intent: it.intent, rankedUrl: it.rankedUrl, rankedRank: it.rankedRank, discoveredVia: via, ...(seed ? { seed } : {}) });
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
    // The page that ranks is carried FORWARD through the merge either way: it arrives only on the
    // ranked pull, and letting a higher-volume row from a different pull evict it would throw away
    // the one fact that lets a ranked keyword name its own page.
    if (!prev) byKey.set(id, row);
    else if ((row.searchVolume ?? -1) > (prev.searchVolume ?? -1)) byKey.set(id, { ...row, rankedUrl: row.rankedUrl ?? prev.rankedUrl, rankedRank: row.rankedRank ?? prev.rankedRank });
    else if (prev.rankedUrl == null && row.rankedUrl != null) byKey.set(id, { ...prev, rankedUrl: row.rankedUrl, rankedRank: row.rankedRank });
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

/** Retain up to `cap` keywords with SOURCE DIVERSITY, not volume alone. Volume-only retention threw away
 *  most of an account's research: the biggest source (a whole-site pull) filled every slot and whole
 *  themes discovered from other seeds vanished. So each discovery source, and each SEED inside the
 *  per-seed sources, gets its best keyword before any source gets its second, volume ordering inside each
 *  group. Deterministic under any input order. Pure. */
export function retainDiverse(retained: FunnelKeyword[], cap: number): FunnelKeyword[] {
  const groups = new Map<string, FunnelKeyword[]>();
  for (const k of retained) {
    const key = `${k.discoveredVia}|${k.seed ?? ""}`;
    const list = groups.get(key);
    if (list) list.push(k);
    else groups.set(key, [k]);
  }
  const lists = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, l]) => l.sort(byVolume));
  const out: FunnelKeyword[] = [];
  for (let i = 0; out.length < cap; i += 1) {
    let moved = false;
    for (const l of lists) {
      if (out.length >= cap) break;
      if (i >= l.length) continue;
      out.push(l[i]!);
      moved = true;
    }
    if (!moved) break;
  }
  return out;
}

// ── the SERP agenda (relevance convergence, 2026-07-26) ─────────────────────

export type SerpAgendaPageQuery = { query: string; impressions?: number | null; declining?: boolean };
/** ONE tracked question: its approved text plus the fan-out queries actually observed for it. */
export type SerpAgendaPrompt = { text: string; fanOutQueries?: string[] | null };
/** queries is the ONLY thing anyone buys. uncoveredThemes and skipped are internal
 *  progress truth for the run log, never customer copy. */
export type SerpAgenda = { queries: string[]; uncoveredThemes: string[]; skipped: { query: string; reason: string }[] };

/** Volume desc with a lexicographic tiebreak: a TOTAL order, never input order. */
const byVolume = (a: FunnelKeyword, b: FunnelKeyword) =>
  (b.searchVolume ?? 0) - (a.searchVolume ?? 0) || a.keyword.localeCompare(b.keyword);

/** Normalized, deduped, lexicographically ordered topics: shuffling the caller's
 *  array can never rotate which topic gets served first. Pure. */
function stableTopics(phrases: string[]): string[] {
  return [...new Set((phrases ?? []).map(normalizeKeyword).filter(Boolean))].sort();
}

/** DataForSEO's SERP task_post documents keyword at up to 700 characters. A longer one
 *  is SKIPPED and named, never truncated: a truncated question is a different question. */
const MAX_SERP_KEYWORD_CHARS = 700;
/** A priority list answers "what is this run stuck on", never a second agenda. */
const MAX_PRIORITY_QUERIES = 3;

/**
 * THE agenda of keywords worth a paid search look, in the customer's OWN words. Volume alone once bought
 * all 40 slots on national-news queries while the money themes sat unchecked; the fix that followed then
 * substituted a merely similar RETAINED keyword for a trusted first-party query, so "boy names" was
 * bought as "last names". Both are gone: a trusted query is bought VERBATIM and never needs to exist in
 * the retained set, and only portfolio 3 may propose a researched keyword, on a strong anchored match
 * alone. Five bounded portfolios fill the cap in priority order:
 *   P0 (<=3)  the exact searches an open investigation cannot close without: bought FIRST, always
 *   P1 (<=12) the EXACT queries my own strongest pages already rank for, slipping first
 *   P2 (<=22) my tracked questions: observed fan-out queries first, then the question text
 *   P3 (<=32) researched keywords, one per confirmed theme, round-robin, no theme faked
 *   P4 (<=8 more) plain volume exploration, so genuinely huge demand still gets a look
 * If the trusted portfolios cannot fill the cap the agenda is SHORTER than the cap: buying less is the
 * honest outcome, never padding the bill with noise. Two queries are the same subject only under
 * canonicalQueryKey, so word order never buys twice and a changed modifier is never collapsed away. Same
 * inputs in ANY array order, same agenda, except priorityQueries, whose order is the CALLER's own. Pure.
 */
export function selectSerpAgenda(
  input: { retained: FunnelKeyword[]; themes: string[]; prompts: SerpAgendaPrompt[]; pageQueries: SerpAgendaPageQuery[];
    /** PLAIN STRINGS from whoever is asking (Evidence never reads Decision): the exact searches an open question
     *  cannot be answered without. At most MAX_PRIORITY_QUERIES, first, verbatim, never swapped for a lookalike. */
    priorityQueries?: string[] },
  cap = 40,
): SerpAgenda {
  const weak = weakAnchorTokens(input.themes ?? []);
  const queries: string[] = [];
  const skipped: { query: string; reason: string }[] = [];
  const usedKeys = new Set<string>();
  const has = (raw: string): boolean => {
    const q = normalizeKeyword(raw);
    return !!q && usedKeys.has(canonicalQueryKey(q));
  };
  /** THE one gate every portfolio passes through: the exact normalized string, bounds
   *  checked, deduped by canonical identity. Returns whether a slot was spent. */
  const take = (raw: string, stop: number): boolean => {
    const q = normalizeKeyword(raw);
    if (!q || queries.length >= stop) return false;
    if (q.length > MAX_SERP_KEYWORD_CHARS) {
      if (!skipped.some((s) => s.query === q)) skipped.push({ query: q, reason: "over_provider_keyword_length" });
      return false;
    }
    const key = canonicalQueryKey(q);
    if (usedKeys.has(key)) return false;
    usedKeys.add(key);
    queries.push(q);
    return true;
  };
  /** Every group's best candidate before any group's second, in stable group order. */
  const roundRobin = (groups: string[][], stop: number): void => {
    const at = groups.map(() => 0);
    while (queries.length < stop) {
      let moved = false;
      for (let g = 0; g < groups.length && queries.length < stop; g += 1) {
        const list = groups[g]!;
        let i = at[g]!;
        while (i < list.length && has(list[i]!)) i += 1;
        at[g] = i + 1;
        if (i >= list.length) continue;
        take(list[i]!, stop);
        moved = true;
      }
      if (!moved) break;
    }
  };

  // P0: the searches an open investigation is stuck on. A diagnosed gap whose own results page is never checked can
  // never be closed, so these are bought before anything else, in the caller's own ranking, and never substituted.
  for (const q of (input.priorityQueries ?? []).slice(0, MAX_PRIORITY_QUERIES)) take(q, cap);

  // P1: my own strongest pages' queries, VERBATIM. First-party Search Console data is the
  // most trusted starting point I have, and the SERP call accepts any keyword string, so a
  // query never has to appear in the researched set to be checked. Slipping before steady.
  const stop1 = Math.min(cap, 12);
  for (const q of [...(input.pageQueries ?? [])]
    .map((q) => ({ query: normalizeKeyword(q.query), impressions: q.impressions ?? 0, declining: q.declining === true }))
    .filter((q) => q.query)
    .sort((a, b) => Number(b.declining) - Number(a.declining) || b.impressions - a.impressions || a.query.localeCompare(b.query))) {
    take(q.query, stop1);
  }

  // P2: the questions I track. An OBSERVED fan-out query is already search-shaped, so it
  // goes first; a question no usable fan-out covers is checked as its own approved text.
  // Never a researched substitute for either.
  const stop2 = Math.min(cap, 22);
  const byText = new Map<string, string[]>();
  for (const p of input.prompts ?? []) {
    const text = normalizeKeyword(p?.text ?? "");
    const fans = (p?.fanOutQueries ?? []).map(normalizeKeyword).filter(Boolean);
    if (!text && fans.length === 0) continue;
    byText.set(text, [...(byText.get(text) ?? []), ...fans]);
  }
  const prompts = [...byText.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    .map(([text, fans]) => ({ text, fans: [...new Set(fans)].sort() }));
  roundRobin(prompts.map((p) => p.fans), stop2);
  for (const p of prompts) if (p.text && !p.fans.some(has)) take(p.text, stop2);

  // P3: a RESEARCHED keyword may stand in for a theme only on a genuinely strong anchored
  // match: at least two strong shared tokens, or the theme's whole strong-token set
  // covered. One shared strong token was enough to call "female names" a match for "boy
  // names". A theme with no defensible candidate buys nothing and is named as uncovered.
  const pool = new Map<string, FunnelKeyword>();
  for (const k of input.retained ?? []) {
    const keyword = normalizeKeyword(k.keyword);
    if (!keyword) continue;
    const prev = pool.get(keyword);
    if (!prev || (k.searchVolume ?? -1) > (prev.searchVolume ?? -1)) pool.set(keyword, { ...k, keyword });
  }
  const rows = [...pool.values()].sort(byVolume);
  const themes = stableTopics(input.themes ?? []);
  const candidates = themes.map((t) => {
    const need = topicTokens(t).filter((x) => !weak.has(x));
    if (need.length === 0) return [];
    return rows.filter((r) => {
      const v = anchoredTopicMatch(r.keyword, t, weak);
      if (!v.relevant) return false;
      const shared = new Set(v.sharedTerms);
      return shared.size >= 2 || need.every((n) => shared.has(n));
    }).map((r) => r.keyword);
  });
  const uncoveredThemes = themes.filter((_, i) => candidates[i]!.length === 0);
  roundRobin(candidates, Math.min(cap, 32));

  // P4: bounded exploration, so real demand I have no theme for is still seen once.
  const stop4 = Math.min(cap, queries.length + 8);
  for (const r of rows) take(r.keyword, stop4);
  return { queries, uncoveredThemes, skipped };
}

// ── winning-page ranking (pure, TRUE provenance) ────────────────────────────

/** `standby` = a deeper distinct publisher held in reserve at the END of the list, and `ownerQuery` is the
 *  canonical priority search it belongs to (set on that search's own winners AND on its bench, absent on
 *  the global fill). A caller may read a standby ONLY as the substitute for an unreadable page of the SAME
 *  search: without the owner a single failure anywhere unlocked every bench on every topic at once. */
type WinningCandidate = { url: string; domain: string; weight: number; appearances: ResearchWinningAppearance[]; standby?: boolean; ownerQuery?: string };

/** Exact host of a URL, lowercased ("" when unparseable). */
function exactHost(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/** Defensive mode-blind dedupe for AI answers (Slice 6I). The chatgpt consumer look and the standardized
 *  ask are TWO observations of one engine, so the same prompt + engine + url must count ONCE;
 *  consumer_search wins the tie. Collection already dedupes, so this only stops a duplicate from
 *  inflating weight. SERP appearances are untouched. Order preserved. Pure. */
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

/** Exact-query winners per priority query: THREE DISTINCT PUBLISHERS, the floor a comparison needs, plus
 *  TWO deeper distinct publishers held as standbys. Reserving by URL let one publisher hold two of the
 *  three slots (two wikipedia.org pages are ONE source), so a topic could never clear its own
 *  three-publisher bar by arithmetic. The reserve counts against topN; the standby bench is bounded on its own. */
const PRIORITY_WINNERS_PER_QUERY = 3, PRIORITY_STANDBYS_PER_QUERY = 2;

/** The best organic rank this candidate holds for ONE exact query (null = none).
 *  Organic means a real page I can go and read, which is what a comparison needs. */
function organicRankFor(c: WinningCandidate, key: string): number | null {
  let best: number | null = null;
  for (const a of c.appearances) {
    if (a.kind !== "serp_organic" || a.rank == null || !a.query) continue;
    if (canonicalQueryKey(normalizeKeyword(a.query)) !== key) continue;
    if (best == null || a.rank < best) best = a.rank;
  }
  return best;
}

/** Aggregate winning pages from a flat appearance stream, each appearance carrying its ACTUAL source
 *  (query or real prompt id + text, engine, rank). AI surfaces weight double; organic top-10 single; the
 *  account's own domain is excluded. A page's engines/prompts derive from ITS OWN appearances only.
 *
 *  Ranking is HYBRID, not global: a purely global weight order returned ten winners of which not one came
 *  from the query under investigation. Each priority query banks its own top DISTINCT PUBLISHERS first, in
 *  real organic rank order, then its standbys, then the global order fills what is left. The TOTAL is
 *  unchanged, so this buys no extra page work. Standbys are returned LAST, marked. Pure. */
export function rankWinningPages(
  appearances: ResearchWinningAppearance[],
  ownDomain: string | null,
  topN: number,
  priorityQueries: string[] = [],
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
  if (topN <= 0) return [];
  const ranked = [...byUrl.values()].sort((x, y) => y.weight - x.weight || x.url.localeCompare(y.url));
  const picked: WinningCandidate[] = [], standbys: WinningCandidate[] = [];
  const taken = new Set<string>(); // canonical identity: one page is never two winners
  // STANDBYS ARE A SUBSTITUTE BENCH, NOT PART OF THE READ BUDGET. Counting them against topN spent 6 of 15 slots on pages
  // read only when a preferred one is unreadable, so the global fill got nothing. The bench is bounded on its own.
  const claim = (c: WinningCandidate, into: WinningCandidate[]): void => {
    const id = canonicalUrlKey(c.url);
    if (taken.has(id) || (into === picked ? picked.length >= topN : standbys.length >= MAX_PRIORITY_QUERIES * PRIORITY_STANDBYS_PER_QUERY)) return;
    taken.add(id);
    into.push(c);
  };
  for (const q of (priorityQueries ?? []).slice(0, MAX_PRIORITY_QUERIES)) {
    const key = canonicalQueryKey(normalizeKeyword(q));
    if (!key) continue;
    const seen = new Set<string>();
    const byPublisher = ranked
      .map((c) => ({ c, rank: organicRankFor(c, key) }))
      // A social or forum profile that happens to rank is not a page to learn from.
      .filter((r): r is { c: WinningCandidate; rank: number } => r.rank != null && !isNoiseDomain(r.c.url) && !taken.has(canonicalUrlKey(r.c.url)))
      .sort((a, b) => a.rank - b.rank || a.c.url.localeCompare(b.c.url))
      // ONE reserve slot per publisher, best organic rank first: a second page from a source I already
      // hold teaches me nothing new and used to eat the slot the third opinion needed.
      .filter((r) => { const p = publisherHost(r.c.url) || r.c.domain; return seen.has(p) ? false : !!seen.add(p); });
    byPublisher.slice(0, PRIORITY_WINNERS_PER_QUERY).forEach((r) => claim({ ...r.c, ownerQuery: key }, picked));
    byPublisher.slice(PRIORITY_WINNERS_PER_QUERY, PRIORITY_WINNERS_PER_QUERY + PRIORITY_STANDBYS_PER_QUERY)
      .forEach((r) => claim({ ...r.c, ownerQuery: key, standby: true }, standbys));
  }
  for (const c of ranked) claim(c, picked);
  return [...picked, ...standbys];
}
