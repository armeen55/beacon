import "server-only";

/**
 * funnel/normalize (Slice 6, Agent B) - the PURE broad-then-narrow core:
 * keyword normalize + dedupe, deterministic relevance/constraint/junk filters
 * with a bounded reject taxonomy, and tolerant adapters over the real DataForSEO
 * bodies. No I/O, never throws; a malformed body answers "nothing observed".
 */

import { rootDomain } from "@/domains/evidence/readers/serp-provider";
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

// ── provider response adapters (tolerant; never throw) ──────────────────────

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

function items(payload: unknown): Record<string, unknown>[] {
  const p = asRecord(payload);
  const task = asRecord((p?.tasks as unknown[] | undefined)?.[0]);
  const result = asRecord((task?.result as unknown[] | undefined)?.[0]);
  const raw = result?.items;
  return Array.isArray(raw) ? raw.filter((x): x is Record<string, unknown> => !!asRecord(x)) : [];
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Read one labs keyword item (keywords_for_site / ranked / related / suggestion
 *  / overview) into a lean row. Handles the `keyword_data` wrapper of the ranked
 *  and related endpoints. */
export function extractKeywordItems(payload: unknown, via: FunnelKeyword["discoveredVia"]): FunnelKeyword[] {
  const out: FunnelKeyword[] = [];
  for (const it of items(payload)) {
    const kd = asRecord(it.keyword_data) ?? it;
    const keyword = typeof kd.keyword === "string" ? kd.keyword : "";
    if (!keyword.trim()) continue;
    const info = asRecord(kd.keyword_info);
    const props = asRecord(kd.keyword_properties);
    const intentInfo = asRecord(kd.search_intent_info);
    out.push({
      keyword,
      searchVolume: num(info?.search_volume),
      competition: num(info?.competition),
      difficulty: num(props?.keyword_difficulty),
      intent: typeof intentInfo?.main_intent === "string" ? (intentInfo.main_intent as string) : null,
      discoveredVia: via,
    });
  }
  return out;
}

type SerpParse = {
  organicItems: { rank: number; domain: string; url: string }[];
  aiOverview: { present: boolean; references: { url: string; domain: string; title: string | null }[]; excerpt: string | null } | null;
  snippetOwner: { domain: string; url: string } | null;
  paaQuestions: { question: string; answeringDomain: string | null }[];
  relatedSearches: string[];
};

/** Parse a SERP task body into the lean SERP evidence Beacon keeps. Pure. */
export function parseSerpTask(payload: unknown): SerpParse {
  const organicItems: SerpParse["organicItems"] = [];
  let aiOverview: SerpParse["aiOverview"] = null;
  let snippetOwner: SerpParse["snippetOwner"] = null;
  const paaQuestions: SerpParse["paaQuestions"] = [];
  const relatedSearches: string[] = [];
  let rank = 0;
  for (const it of items(payload)) {
    const type = String(it.type ?? "");
    if (type === "organic" && typeof it.url === "string") {
      rank += 1;
      organicItems.push({ rank, url: it.url, domain: rootDomain(it.url) });
    } else if (type === "ai_overview") {
      const refs = Array.isArray(it.references) ? it.references : [];
      const references = refs
        .map((r) => asRecord(r))
        .filter((r): r is Record<string, unknown> => !!r && typeof r.url === "string")
        .map((r) => ({ url: r.url as string, domain: rootDomain(r.url as string), title: typeof r.title === "string" ? r.title : null }));
      const md = typeof it.markdown === "string" ? it.markdown : typeof it.text === "string" ? it.text : "";
      const excerpt = md ? md.replace(/\s+/g, " ").trim().slice(0, 300) : null;
      aiOverview = { present: true, references, excerpt };
    } else if (type === "featured_snippet" && typeof it.url === "string") {
      snippetOwner = { url: it.url, domain: rootDomain(it.url) };
    } else if (type === "people_also_ask" && Array.isArray(it.items)) {
      for (const q of it.items) {
        const qr = asRecord(q);
        const question = typeof qr?.title === "string" ? qr.title : "";
        if (!question.trim()) continue;
        const exp = asRecord(Array.isArray(qr?.expanded_element) ? (qr!.expanded_element as unknown[])[0] : null);
        const url = typeof exp?.url === "string" ? exp.url : "";
        paaQuestions.push({ question: question.trim(), answeringDomain: url ? rootDomain(url) : null });
      }
    } else if (type === "related_searches" && Array.isArray(it.items)) {
      for (const r of it.items) if (typeof r === "string") relatedSearches.push(r);
    }
  }
  return { organicItems, aiOverview, snippetOwner, paaQuestions, relatedSearches };
}

type AiAnswerParse = {
  modelServed: string | null;
  webSearchReported: boolean | null;
  answerText: string | null;
  citations: { url: string; domain: string; title: string | null }[] | null;
  fanOutQueries: string[] | null;
  brands: string[] | null;
};

/** Parse an ai_optimization / llm_scraper answer body. `scraper` = true reads the
 *  fan-out queries + brands the scraper path exposes; the plain llm_responses path
 *  leaves both null (not observable, distinct from empty). Pure. */
export function parseAiAnswer(payload: unknown, scraper: boolean): AiAnswerParse {
  const p = asRecord(payload);
  const task = asRecord((p?.tasks as unknown[] | undefined)?.[0]);
  const result = asRecord((task?.result as unknown[] | undefined)?.[0]);
  const first = asRecord(items(payload)[0]) ?? result;
  if (!first) return { modelServed: null, webSearchReported: null, answerText: null, citations: null, fanOutQueries: null, brands: null };

  const content = asRecord(first.content);
  const answerText =
    typeof content?.text === "string" ? content.text : typeof first.text === "string" ? first.text : typeof first.message === "string" ? (first.message as string) : null;
  const modelServed = typeof first.model_name === "string" ? first.model_name : typeof result?.model_name === "string" ? (result.model_name as string) : null;
  const webSearchReported = typeof first.web_search === "boolean" ? first.web_search : typeof result?.web_search === "boolean" ? (result.web_search as boolean) : null;

  const annos = Array.isArray(first.annotations) ? first.annotations : Array.isArray(content?.annotations) ? content!.annotations : null;
  const citations = annos
    ? (annos as unknown[])
        .map((a) => asRecord(a))
        .filter((a): a is Record<string, unknown> => !!a && typeof a.url === "string")
        .map((a) => ({ url: a.url as string, domain: rootDomain(a.url as string), title: typeof a.title === "string" ? a.title : null }))
    : null;

  let fanOutQueries: string[] | null = null;
  let brands: string[] | null = null;
  if (scraper) {
    const fo = first.search_queries ?? first.fan_out_queries;
    fanOutQueries = Array.isArray(fo) ? (fo as unknown[]).filter((x): x is string => typeof x === "string") : [];
    const br = first.brands ?? first.mentioned_brands;
    brands = Array.isArray(br) ? (br as unknown[]).filter((x): x is string => typeof x === "string") : [];
  }
  return { modelServed, webSearchReported, answerText, citations, fanOutQueries, brands };
}

// ── winning-page detection (pure) ───────────────────────────────────────────

type WinningAppearance = { query: string; rank: number | null; surface: "organic" | "ai_overview" | "ai_answer" | "ai_mode" };
type WinningCandidate = { url: string; domain: string; weight: number; appearances: WinningAppearance[] };

/** Weight recurring domains/URLs across SERP + AI evidence. AI citations count
 *  double; organic top-10 counts single; the account's own domain is excluded. Pure. */
export function detectWinningPages(
  serps: { query: string; organic: { rank: number; url: string; domain: string }[]; aiOverview: { url: string; domain: string }[] }[],
  aiAnswers: { query: string; citations: { url: string; domain: string }[] }[],
  ownDomain: string | null,
  topN: number,
): WinningCandidate[] {
  const own = (ownDomain ?? "").toLowerCase();
  const byUrl = new Map<string, WinningCandidate>();
  const bump = (url: string, domain: string, weight: number, appearance: WinningAppearance) => {
    if (!url) return;
    const d = domain.toLowerCase();
    if (own && (d === own || d.endsWith(`.${own}`))) return;
    const prev = byUrl.get(url) ?? { url, domain: d, weight: 0, appearances: [] };
    prev.weight += weight;
    prev.appearances.push(appearance);
    byUrl.set(url, prev);
  };
  for (const s of serps) {
    for (const o of s.organic) if (o.rank <= 10) bump(o.url, o.domain, 1, { query: s.query, rank: o.rank, surface: "organic" });
    for (const a of s.aiOverview) bump(a.url, a.domain, 2, { query: s.query, rank: null, surface: "ai_overview" });
  }
  for (const a of aiAnswers) for (const c of a.citations) bump(c.url, c.domain, 2, { query: a.query, rank: null, surface: "ai_answer" });
  return [...byUrl.values()].sort((x, y) => y.weight - x.weight).slice(0, topN);
}
