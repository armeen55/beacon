/**
 * serp-shape (research packet, 2026-07-27) - how ONE exact set of Google results
 * READS: what the winning pages are, whether they answer a single subject, and
 * when I actually looked. PURE and deterministic (no I/O, no LLM, no clock beyond
 * the caller's `builtAt`). Consumed by `topic-investigation.ts`; it decides
 * nothing about what to do next.
 *
 * The conservative rule that governs the whole file: a claim needs agreement
 * across DISTINCT DOMAINS. One domain holding four of the top ten is ONE vote,
 * not four. Below the thresholds below the honest answer is `mixed` or `unknown`,
 * and that is a real answer, not a failure.
 */

import type { FunnelResearchEvidence } from "./funnel/research-evidence";
import { rootDomain } from "@/domains/evidence/readers/serp-provider";
import { canonicalQueryKey, topicTokens } from "./relevance-gate";

/** What the pages that win an exact result page ARE, as one canonical union. */
export type SerpPageType =
  | "informational_guide"
  | "list"
  | "definition"
  | "comparison"
  | "product"
  | "category"
  | "tool"
  | "forum"
  | "mixed"
  | "unknown";

/** current = looked at inside the weekly window. stale = older than it. undated =
 *  I hold the results but not when I looked. missing = no exact look at all. */
export type Freshness = "current" | "stale" | "undated" | "missing";

/** A winning page I already read: current / stale / undated by the time of the
 *  read, unreadable when the read came back too thin to compare, missing when no
 *  read exists. Only `current` counts as present-day pattern evidence. */
export type WinnerExtractState = "current" | "stale" | "undated" | "unreadable" | "missing";

export type PageTypeVote = { pageType: SerpPageType; domains: number };

export type SerpRow = FunnelResearchEvidence["serpEvidence"][number];
type WinRow = FunnelResearchEvidence["winningPages"][number];

// ── documented thresholds ────────────────────────────────────────────────────

/** The funnel looks again after a week, so an older look is not current. */
export const SERP_FRESH_MS = 7 * 24 * 3600 * 1000;
/** A winner's body moves far slower than its ranking: a month-old read still
 *  describes today's page, an older one is not evidence of the present pattern. */
const EXTRACT_FRESH_MS = 30 * 24 * 3600 * 1000;
/** A page type needs this many DISTINCT domains to have classified at all ... */
const MIN_DOMAIN_VOTES = 3;
/** ... at least half of them agreeing ... */
const DOMINANT_SHARE = 0.5;
/** ... and a clear lead over the runner-up. Below either, the answer is mixed. */
const MIN_LEAD = 2;
/** Share of distinct domains that must be on the query's own subject. */
const MIN_SUBJECT_SHARE = 0.6;
/** A readable extract has to carry something to compare. */
const MIN_READABLE_WORDS = 120;

const norm = (s: string): string => s.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
/** ONE publisher is one vote: en.wikipedia.org and simple.wikipedia.org are the same
 *  source wearing two hostnames, and counting them twice fakes the agreement this whole
 *  file rests on. Same rootDomain the winner ranking already uses. */
const host = (url: string): string => rootDomain(url).toLowerCase();
const inter = <T,>(a: Set<T>, b: Set<T>): number => [...a].filter((t) => b.has(t)).length;

const FORUM = /(^|\.)(reddit|quora|stackexchange|stackoverflow|discourse|answers)\.[a-z.]+$/;
const MARKET = /(^|\.)(amazon|ebay|etsy|aliexpress|redbubble|walmart|alibaba)\.[a-z.]+$/;
const DICTIONARY = /(^|\.)(merriam-webster|dictionary|vocabulary|wordnik|thefreedictionary)\.[a-z.]+$/;
const ENCYCLOPEDIC = /(^|\.)(wikipedia|britannica|wikiwand|scholarpedia)\.[a-z.]+$/;

/**
 * What ONE result IS, or null when it gives no honest signal (null votes for
 * nothing rather than padding the majority). Order is precedence: the first cue
 * that matches wins, so a shop listing on a forum domain reads as the shop
 * listing it is.
 */
export function classifyResult(title: string | null, url: string): SerpPageType | null {
  const t = norm(title ?? "");
  const u = url.toLowerCase();
  const h = host(u);
  const path = u.replace(/^https?:\/\/[^/]+/, "");
  if (/\bvs\.?\b|\bversus\b|difference between|compared to/.test(t)) return "comparison";
  // NO srsltid rule: that is a Google Merchant click id which rides on ANY url reached
  // from a feed, editorial posts included, and it turned two rug HISTORY guides into
  // products on the one query whose shape mattered most. Shape decides, not tracking.
  if (/\/(dp|itm|product|products|listing|item)\//.test(path) || (MARKET.test(h) && !/\/(wiki|blog|article)\//.test(path))) return "product";
  if (/\bfor sale\b|\bbuy\b|\d+\s?x\s?\d+\s?(ft|cm|in)\b/.test(t)) return "product";
  if (/^category:/.test(t) || /\/(category|categories|collections|tag|tags|topics)\//.test(path) || /\/search\b|[?&]k=|\/ideas\//.test(u) || /\bbrowse\b|stock photos/.test(t)) return "category";
  if (/\b(calculator|converter|generator|translator|checker)\b/.test(t) || /\/(tools?|calculator)\//.test(path)) return "tool";
  if (FORUM.test(h) || /\br\/[a-z0-9_]+/.test(t) || /\/(forum|forums|thread|discussion)\//.test(path)) return "forum";
  if (DICTIONARY.test(h) || /\bdefinition\b|\bmeaning of\b|\bdefined\b/.test(t)) return "definition";
  // A COUNT leads a listicle ("21 greatest", "10+ ways"); a DATE RANGE inside a title does
  // not ("550-330 B.C." made an encyclopedia essay a list), so the bare number rule is gone.
  if (/^\d+\+?\s/.test(t) || /\b(top|best)\s+\d+\b/.test(t) || /\blist of\b/.test(t) || /\/lists?\//.test(path)) return "list";
  if (/\bhow to\b|\bguide\b|\bexplained\b|\bhistory of\b|\bintroduction to\b|\beverything you\b|\btutorial\b|\bwhy\b/.test(t)) return "informational_guide";
  if (ENCYCLOPEDIC.test(h) && /\/(wiki|topic|article)/.test(path)) return "informational_guide";
  return null;
}

/** ONE vote per distinct domain: that domain's most common classification, ties
 *  broken by name so the same results always vote the same way. */
export function pageTypeVotesOf(serps: SerpRow[]): PageTypeVote[] {
  const byDomain = new Map<string, Map<SerpPageType, number>>();
  for (const s of serps) {
    for (const o of s.organic) {
      const type = classifyResult(o.title, o.url);
      if (!type) continue;
      const d = host(o.url) || o.domain.replace(/^www\./, "").toLowerCase();
      if (!byDomain.has(d)) byDomain.set(d, new Map());
      const m = byDomain.get(d)!;
      m.set(type, (m.get(type) ?? 0) + 1);
    }
  }
  const tally = new Map<SerpPageType, number>();
  for (const m of byDomain.values()) {
    const winner = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
    tally.set(winner, (tally.get(winner) ?? 0) + 1);
  }
  return [...tally.entries()]
    .map(([pageType, domains]) => ({ pageType, domains }))
    .sort((a, b) => b.domains - a.domains || a.pageType.localeCompare(b.pageType));
}

/** The type enough distinct domains agree on, else `mixed`; `unknown` when too
 *  few domains classified to have an opinion at all. */
export function dominantPageType(votes: PageTypeVote[]): SerpPageType {
  const total = votes.reduce((n, v) => n + v.domains, 0);
  if (total < MIN_DOMAIN_VOTES) return "unknown";
  const top = votes[0];
  if (top.domains / total < DOMINANT_SHARE || top.domains - (votes[1]?.domains ?? 0) < MIN_LEAD) return "mixed";
  return top.pageType;
}

/**
 * Do these results read as ONE subject? `mixed` when the results themselves say
 * the word carries a second meaning (an entry for the plain subject beside an
 * entry that brackets a different sense, the way an encyclopedia separates an
 * animal from a siege weapon) or when the results drift off the subject.
 * `unknown` when there is too little to judge.
 */
export function coherenceOf(serps: SerpRow[], strong: Set<string>): "coherent" | "mixed" | "unknown" {
  const organic = serps.flatMap((s) => s.organic);
  const domainsOf = (rows: typeof organic): Set<string> => new Set(rows.map((o) => host(o.url) || o.domain));
  const domains = domainsOf(organic);
  if (organic.length === 0 || domains.size < MIN_DOMAIN_VOTES || strong.size === 0) return "unknown";
  const qualifiers: Set<string>[] = [];
  let bare = false;
  for (const o of organic) {
    const title = o.title ?? "";
    const outside = new Set(topicTokens(title.replace(/\([^)]*\)/g, " ")));
    // Only the subject's OWN entry can disambiguate the subject.
    if (outside.size === 0 || [...outside].some((t) => !strong.has(t))) continue;
    const q = new Set(topicTokens(title.match(/\(([^)]+)\)/)?.[1] ?? "").filter((t) => !strong.has(t)));
    if (q.size === 0) bare = true;
    else if (!qualifiers.some((seen) => inter(seen, q) > 0)) qualifiers.push(q);
  }
  if (qualifiers.length >= 2 || (qualifiers.length >= 1 && bare)) return "mixed";
  const onSubject = domainsOf(organic.filter((o) => inter(strong, new Set(topicTokens(o.title ?? o.url))) > 0));
  return onSubject.size / domains.size >= MIN_SUBJECT_SHARE ? "coherent" : "mixed";
}

// ── when I looked ────────────────────────────────────────────────────────────

export const freshnessAt = (at: string | null, builtAt: number, windowMs: number): Freshness =>
  at == null ? "undated" : builtAt - Date.parse(at) <= windowMs ? "current" : "stale";

/** When this exact look actually landed. The results projection carries no
 *  timestamp of its own, so the honest source is the provenance of a page seen IN
 *  it; absent that I say I do not know rather than assuming today. */
export function serpObservedAt(serp: SerpRow, winners: WinRow[]): string | null {
  const own = (serp as { observedAt?: unknown }).observedAt;
  if (typeof own === "string" && own.trim()) return own.trim();
  const key = canonicalQueryKey(serp.query);
  return winners
    .flatMap((w) => w.appearances)
    .filter((a) => a.query && canonicalQueryKey(a.query) === key && a.observedAt)
    .map((a) => a.observedAt)
    .sort()
    .at(-1) ?? null;
}

/** How much a winning page's read is worth today. A page never read, read too
 *  thin, or read too long ago is NEVER counted as current pattern evidence. */
export function winnerStateOf(win: WinRow, builtAt: number): WinnerExtractState {
  const x = win.extract;
  if (!x) return "missing";
  if (x.wordCount < MIN_READABLE_WORDS || (x.headings.length === 0 && !x.title)) return "unreadable";
  const f = freshnessAt(x.fetchedAt ?? null, builtAt, EXTRACT_FRESH_MS);
  return f === "current" ? "current" : f === "stale" ? "stale" : "undated";
}
