/**
 * page-intersection (2026-07-28) - the ONE comparison that turns "I know what wins
 * for this topic" into "and here is what you already own against it". Two pure
 * halves, no I/O and no clock: the parser that turns the bought envelope into
 * evidence without inventing a number, and the reading a verdict can act on.
 *
 * Two rules govern the whole file. AGREEMENT NEEDS DISTINCT PUBLISHERS: one publisher
 * holding three of the requested pages is ONE vote, so the shared set counts publishers
 * and never pages. And OVERLAPPING VARIANTS ARE NEVER SUMMED: the provider reports one
 * bucketed figure across close variants, so adding them invents demand nobody searched.
 * The largest single figure plus a count is the honest form, per-keyword list beside it.
 */
import type { ProviderEnvelope } from "./dataforseo/funnel-boundary";
import { publisherHost } from "@/domains/evidence/serp-shape";

// ── the ask (normalized BEFORE it becomes a cache identity) ───────────────────

/** What a caller asks for. `pages` are the winning pages to compare; `exclude_pages`
 *  is where the page the business already owns rides when the ask is "what do they
 *  cover that I do not". Documented ceilings: 20 pages, 10 excludes, limit max 1000. */
export type PageIntersectionAsk = { pages: string[]; exclude_pages?: string[]; intersection_mode?: "union" | "intersect"; limit?: number };

export const MAX_INTERSECTION_PAGES = 20;
const MAX_EXCLUDE_PAGES = 10, INTERSECTION_DEFAULT_LIMIT = 100, INTERSECTION_MAX_LIMIT = 1000;
/** The only page identity the endpoint documents: an absolute http(s) url. A
 *  wildcard "*" after a slash is documented and rides through untouched. */
const usableUrl = (u: unknown): string => { const s = String(u ?? "").trim(); return /^https?:\/\/\S+$/.test(s) ? s : ""; };
const canonicalPages = (list: unknown, max: number): string[] =>
  [...new Set((Array.isArray(list) ? list : []).map(usableUrl).filter(Boolean))].sort().slice(0, max);

/** NORMALIZE THE ASK BEFORE IT BECOMES AN IDENTITY. The same page set in another
 *  order, an omitted limit and an explicit 100 all build the SAME single request, so
 *  keying on the raw ask would buy identical rows twice (a previous slice shipped
 *  exactly that defect). Registry-owned, so no caller can skip it. */
export function normalizePageIntersection(i: PageIntersectionAsk): PageIntersectionAsk {
  return {
    pages: canonicalPages(i.pages, MAX_INTERSECTION_PAGES),
    exclude_pages: canonicalPages(i.exclude_pages, MAX_EXCLUDE_PAGES),
    intersection_mode: i.intersection_mode === "intersect" ? "intersect" : "union",
    limit: Math.min(Math.max(1, Math.trunc(i.limit ?? INTERSECTION_DEFAULT_LIMIT)), INTERSECTION_MAX_LIMIT),
  };
}

// ── the parsed evidence ──────────────────────────────────────────────────────

/** Where ONE requested page ranks for ONE keyword. `rank` is rank_group, the
 *  ORGANIC position; rank_absolute counts ads and packs and is never a position. */
export type PageIntersectionRank = { page: number; url: string; title: string | null; rank: number | null };
export type PageIntersectionKeyword = {
  keyword: string; searchVolume: number | null; competition: number | null; competitionLevel: "low" | "medium" | "high" | null;
  difficulty: number | null; mainIntent: string | null; ranks: PageIntersectionRank[];
};
/** The comparison AS ASKED plus what came back: which page rode which numbered slot,
 *  what was excluded, which mode was bought. Counts with no named pages behind them
 *  let a packet claim a gap without naming the page it compared against. */
export type ParsedPageIntersection = {
  pages: { page: number; url: string }[];
  excludePages: string[];
  intersectionMode: "union" | "intersect";
  keywords: PageIntersectionKeyword[];
};

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const text = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const level = (v: unknown): "low" | "medium" | "high" | null => { const s = typeof v === "string" ? v.toLowerCase() : ""; return s === "low" || s === "medium" || s === "high" ? s : null; };

/**
 * Pure: the bought envelope -> the comparison. `ask` is the ask that BOUGHT this
 * answer and is the ONLY exact source of which url rode which numbered slot: the
 * money core's envelope rule strips the provider's request echo, and the url that
 * ranked is not the url that was asked for. It is normalized here with the SAME
 * function the request builder used, so slot 1 here is slot 1 there. Read without
 * the ask, the slots and their ranks still survive and the requested identities read
 * EMPTY rather than guessed. A metric the provider did not send stays NULL, never 0:
 * "I do not know the difficulty" and "the difficulty is 0" are different claims.
 */
export function parsePageIntersection(env: ProviderEnvelope, ask?: PageIntersectionAsk): ParsedPageIntersection {
  const a = ask ? normalizePageIntersection(ask) : null;
  const result = env.tasks?.[0]?.result;
  const result0 = Array.isArray(result) ? (result[0] as Record<string, unknown> | undefined) : undefined;
  const items = Array.isArray(result0?.items) ? (result0!.items as Record<string, unknown>[]) : [];
  return {
    pages: (a?.pages ?? []).map((url, n) => ({ page: n + 1, url })),
    excludePages: a?.exclude_pages ?? [],
    intersectionMode: a?.intersection_mode ?? "union",
    keywords: items.map((raw) => {
      const kd = (raw.keyword_data ?? {}) as Record<string, unknown>;
      const ki = (kd.keyword_info ?? {}) as Record<string, unknown>, kp = (kd.keyword_properties ?? {}) as Record<string, unknown>, si = (kd.search_intent_info ?? {}) as Record<string, unknown>;
      return {
        keyword: String(kd.keyword ?? ""), searchVolume: num(ki.search_volume), competition: num(ki.competition),
        competitionLevel: level(ki.competition_level), difficulty: num(ki.keyword_difficulty) ?? num(kp.keyword_difficulty), mainIntent: text(si.main_intent),
        ranks: Object.entries((raw.intersection_result ?? {}) as Record<string, unknown>)
          .map(([slot, v]) => { const h = (v ?? {}) as Record<string, unknown>; return { page: Number(slot), url: String(h.url ?? ""), title: text(h.title), rank: num(h.rank_group) }; })
          .filter((r) => Number.isFinite(r.page) && r.url.length > 0).sort((a, b) => a.page - b.page),
      };
    }).filter((k) => k.keyword.length > 0),
  };
}

// ── the reading a verdict can act on ─────────────────────────────────────────

/** Agreement needs TWO distinct publishers; one publisher is one vote however many
 *  of the requested pages it holds. */
const MIN_PUBLISHERS = 2;
/** One intent has to hold this share of the shared keywords that named an intent ... */
const INTENT_AGREE_SHARE = 0.6;
/** ... across at least this many of them, else I say I do not know rather than guess. */
const MIN_INTENT_KEYWORDS = 3;
/** The owner already holds a material part of the cluster at this share of it. */
const MATERIAL_SHARE = 0.3;

/** `publishers` = the DISTINCT publishers among the requested winners that rank for it.
 *  `bestRank` = best organic position among them; `ownedRank` = the owner's own, null
 *  when it does not rank (or was excluded from the ask and so was never measured). */
export type SharedKeyword = {
  keyword: string; searchVolume: number | null; difficulty: number | null; intent: string | null;
  publishers: string[]; bestRank: number | null; ownedRank: number | null;
};

export type PageCoverageReading = {
  ownedHost: string | null;
  /** Where the owned page sat in the ask I actually bought. `excluded` means its own
   *  keywords were filtered OUT of the answer, so "the owner does not cover this" is
   *  what I ASKED for rather than what I measured, and the coverage share stays null. */
  ownedRepresentation: "included" | "excluded" | "absent";
  winnerPublishers: string[];
  /** Keywords at least MIN_PUBLISHERS distinct winners share, biggest demand first. */
  shared: SharedKeyword[];
  uncoveredByOwned: string[];
  intent: "agrees" | "conflicts" | "unknown";
  /** The LARGEST single figure in the shared set and how many keywords carried one.
   *  NEVER a sum: an earlier slice summed bucketed variants and invented 756,000 searches. */
  largestSearchVolume: number | null;
  keywordsWithVolume: number;
  ownedCoveredKeywords: number;
  ownedCoverageShare: number | null;
  ownedHoldsMaterialShare: boolean | null;
};

const hostOf = (u: string | null | undefined): string | null => { const h = u ? publisherHost(u) : ""; return h || null; };
const better = (a: number | null, b: number | null): number | null => (b == null ? a : a == null ? b : Math.min(a, b));

/**
 * Pure: what the bought comparison SAYS about a gap. `ownedUrl` names the page the
 * business already owns; absent one, the first excluded page is the owner by
 * construction of the ask. Everything is counted per PUBLISHER, so a publisher
 * holding three of the requested pages votes once.
 */
export function comparePageCoverage(parsed: ParsedPageIntersection, ownedUrl?: string | null): PageCoverageReading {
  const ownedHost = hostOf(ownedUrl) ?? hostOf(parsed.excludePages[0]);
  const askedHost = new Map(parsed.pages.map((p) => [p.page, hostOf(p.url) ?? ""]));
  const isOwned = (slot: number, url: string): boolean => ownedHost != null && (askedHost.get(slot) === ownedHost || hostOf(url) === ownedHost);
  const winnerPublishers = new Set([...askedHost.values()].filter((h) => h && h !== ownedHost));
  const shared: SharedKeyword[] = [];
  for (const k of parsed.keywords) {
    const publishers = new Set<string>(); let bestRank: number | null = null, ownedRank: number | null = null;
    for (const r of k.ranks) {
      if (isOwned(r.page, r.url)) { ownedRank = better(ownedRank, r.rank); continue; }
      const h = hostOf(r.url) ?? askedHost.get(r.page) ?? "";
      if (h) { publishers.add(h); winnerPublishers.add(h); }
      bestRank = better(bestRank, r.rank);
    }
    if (publishers.size < MIN_PUBLISHERS) continue;
    shared.push({ keyword: k.keyword, searchVolume: k.searchVolume, difficulty: k.difficulty, intent: k.mainIntent, publishers: [...publishers].sort(), bestRank, ownedRank });
  }
  shared.sort((a, b) => (b.searchVolume ?? -1) - (a.searchVolume ?? -1) || a.keyword.localeCompare(b.keyword));

  const tally = new Map<string, number>();
  for (const s of shared) if (s.intent) tally.set(s.intent, (tally.get(s.intent) ?? 0) + 1);
  const named = [...tally.values()].reduce((n, v) => n + v, 0);
  const top = Math.max(0, ...tally.values());
  const volumes = shared.map((s) => s.searchVolume).filter((v): v is number => v != null);
  const included = ownedHost != null && [...askedHost.values()].includes(ownedHost);
  const excluded = ownedHost != null && parsed.excludePages.some((u) => hostOf(u) === ownedHost);
  const covered = shared.filter((s) => s.ownedRank != null).length;
  // Measurable ONLY when the owned page rode a numbered slot: an excluded owner was
  // filtered out of the answer, so its coverage is unknown here, not zero.
  const ownedCoverageShare = included && shared.length > 0 ? covered / shared.length : null;
  return {
    ownedHost, ownedRepresentation: included ? "included" : excluded ? "excluded" : "absent",
    winnerPublishers: [...winnerPublishers].sort(), shared,
    uncoveredByOwned: shared.filter((s) => s.ownedRank == null).map((s) => s.keyword),
    intent: named < MIN_INTENT_KEYWORDS ? "unknown" : top / named >= INTENT_AGREE_SHARE ? "agrees" : "conflicts",
    largestSearchVolume: volumes.length ? Math.max(...volumes) : null, keywordsWithVolume: volumes.length,
    ownedCoveredKeywords: covered, ownedCoverageShare,
    ownedHoldsMaterialShare: ownedCoverageShare == null ? null : ownedCoverageShare >= MATERIAL_SHARE,
  };
}
