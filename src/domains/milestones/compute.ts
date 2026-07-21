import type { Result } from "@/domains/results/types";
import type { CitationEvidenceIndex } from "@/domains/pages/types";
import type { CompetitorRankEntry } from "@/lib/performance-timeseries";
import type { MilestonePeakRow } from "./types";

export type ProposedPeak = MilestonePeakRow;

function normUrl(u: string): string {
  try {
    const x = new URL(u);
    return `${x.origin}${x.pathname}`.replace(/\/$/, "") || x.origin;
  } catch {
    return u.trim();
  }
}

function isOwnedUrl(url: string, siteDomain: string): boolean {
  const d = siteDomain.toLowerCase().replace(/^www\./, "");
  const u = url.toLowerCase();
  return u.includes(d);
}

/** Sum citations per calendar day (excludes platform === "all"). */
function dailyCitationTotalsByDate(results: Result[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of results) {
    if (r.platform === "all") continue;
    const d = r.snapshot_date;
    if (!d) continue;
    const n = typeof r.citation_count === "number" ? r.citation_count : 0;
    m.set(d, (m.get(d) ?? 0) + n);
  }
  return m;
}

function sortedDates(m: Map<string, number>): string[] {
  return [...m.keys()].sort();
}

/** Max single-day total citations + date. */
export function proposeCitationDailyTotal(
  results: Result[],
): ProposedPeak | null {
  const m = dailyCitationTotalsByDate(results);
  let best = 0;
  let bestDate = "";
  for (const [d, v] of m) {
    if (v > best) {
      best = v;
      bestDate = d;
    }
  }
  if (best <= 0 || !bestDate) return null;
  return {
    key: "citation_daily_total",
    kind: "citation_daily_total",
    value: best,
    achievedAt: new Date(bestDate + "T12:00:00Z").toISOString(),
    proofSummary: `Highest single-day measured citation total (${bestDate}).`,
    meta: { date: bestDate },
  };
}

/** Best rolling 7-day sum vs prior 7-day sum (same calendar ordering). */
export function proposeCitation7dSurge(results: Result[]): ProposedPeak | null {
  const m = dailyCitationTotalsByDate(results);
  const dates = sortedDates(m);
  if (dates.length < 15) return null;

  const vals = dates.map((d) => m.get(d) ?? 0);
  let bestSurge = 0;
  let endIdx = 7;
  for (let i = 14; i < vals.length; i++) {
    const last7 = vals.slice(i - 6, i + 1).reduce((a, b) => a + b, 0);
    const prev7 = vals.slice(i - 13, i - 6).reduce((a, b) => a + b, 0);
    const surge = last7 - prev7;
    if (surge > bestSurge) {
      bestSurge = surge;
      endIdx = i;
    }
  }
  if (bestSurge <= 0) return null;
  const endDate = dates[endIdx];
  const startDate = dates[endIdx - 6];
  return {
    key: "citation_7d_surge",
    kind: "citation_7d_surge",
    value: bestSurge,
    achievedAt: new Date(endDate + "T12:00:00Z").toISOString(),
    proofSummary: `Strongest 7-day citation window vs the prior 7 days (ends ${endDate}).`,
    meta: { windowStart: startDate, windowEnd: endDate, surge: bestSurge },
  };
}

/** Peak share of citations from one platform vs all non-"all" rows that day. */
export function proposePlatformSharePeak(
  results: Result[],
  platform: string,
  label: string,
): ProposedPeak | null {
  type Day = { plat: number; total: number };
  const byDay = new Map<string, Day>();
  for (const r of results) {
    if (r.platform === "all") continue;
    const d = r.snapshot_date;
    if (!d) continue;
    const c = typeof r.citation_count === "number" ? r.citation_count : 0;
    const row = byDay.get(d) ?? { plat: 0, total: 0 };
    row.total += c;
    if (r.platform === platform) row.plat += c;
    byDay.set(d, row);
  }
  let bestBps = 0;
  let bestDate = "";
  for (const [d, { plat, total }] of byDay) {
    if (total <= 0) continue;
    const bps = Math.round((plat / total) * 10_000);
    if (bps > bestBps) {
      bestBps = bps;
      bestDate = d;
    }
  }
  if (bestBps <= 0 || !bestDate) return null;
  return {
    key: `platform_share_peak:${platform}`,
    kind: "platform_citation_share_peak",
    value: bestBps,
    achievedAt: new Date(bestDate + "T12:00:00Z").toISOString(),
    proofSummary: `Peak ${label} share of measured citations in one day (${bestDate}).`,
    meta: { platform, date: bestDate, shareBps: bestBps },
  };
}

/** Rank score: higher = better rank (position 1 → 999). */
function rankScore(position: number): number {
  return 1000 - position;
}

function topicKey(topic: string): string {
  const t = topic.trim().toLowerCase().slice(0, 80);
  return t.replace(/\s+/g, "_").replace(/[^a-z0-9_-]/g, "");
}

/** Best (lowest) position per topic across all snapshots. */
export function proposeTopicRankBests(results: Result[]): ProposedPeak[] {
  const bestPos = new Map<string, { pos: number; at: string }>();
  for (const r of results) {
    if (r.platform === "all") continue;
    const topic = (r.topic ?? "").trim();
    if (!topic) continue;
    const p = r.position;
    if (typeof p !== "number" || p < 1) continue;
    const d = r.snapshot_date;
    if (!d) continue;
    const prev = bestPos.get(topic);
    if (!prev || p < prev.pos) bestPos.set(topic, { pos: p, at: d });
  }
  const out: ProposedPeak[] = [];
  for (const [topic, { pos, at }] of bestPos) {
    const tk = topicKey(topic);
    out.push({
      key: `topic_rank_best:${tk}`,
      kind: "topic_rank_best",
      value: rankScore(pos),
      achievedAt: new Date(at + "T12:00:00Z").toISOString(),
      proofSummary: `Best recorded rank for “${topic.slice(0, 60)}${topic.length > 60 ? "…" : ""}”: #${pos} (${at}).`,
      meta: { topic, position: pos, date: at },
    });
  }
  return out;
}

/** Chronological first time topic hits top-3 / #1. */
export function proposeTopicFirsts(results: Result[]): ProposedPeak[] {
  const byTopic = new Map<string, Result[]>();
  for (const r of results) {
    if (r.platform === "all") continue;
    const topic = (r.topic ?? "").trim();
    if (!topic) continue;
    const arr = byTopic.get(topic) ?? [];
    arr.push(r);
    byTopic.set(topic, arr);
  }
  const out: ProposedPeak[] = [];
  for (const [topic, rows] of byTopic) {
    const sorted = [...rows].sort((a, b) =>
      (a.snapshot_date ?? "").localeCompare(b.snapshot_date ?? ""),
    );
    let first3: string | null = null;
    let first1: string | null = null;
    for (const r of sorted) {
      const p = r.position;
      const d = r.snapshot_date;
      if (typeof p !== "number" || !d) continue;
      if (first3 === null && p <= 3) first3 = d;
      if (first1 === null && p === 1) first1 = d;
      if (first3 && first1) break;
    }
    const tk = topicKey(topic);
    if (first3) {
      out.push({
        key: `topic_first_top3:${tk}`,
        kind: "topic_first_top3",
        value: 1,
        achievedAt: new Date(first3 + "T12:00:00Z").toISOString(),
        proofSummary: `First top-3 appearance for “${topic.slice(0, 60)}${topic.length > 60 ? "…" : ""}” (${first3}).`,
        meta: { topic, date: first3 },
      });
    }
    if (first1) {
      out.push({
        key: `topic_first_rank1:${tk}`,
        kind: "topic_first_rank1",
        value: 1,
        achievedAt: new Date(first1 + "T12:00:00Z").toISOString(),
        proofSummary: `First #1 rank for “${topic.slice(0, 60)}${topic.length > 60 ? "…" : ""}” (${first1}).`,
        meta: { topic, date: first1 },
      });
    }
  }
  return out;
}

/**
 * Strongest single-day citation count on any one owned page (keeps one stable key).
 */
export function proposeOwnedPageCitationPeak(
  results: Result[],
  siteDomain: string,
): ProposedPeak | null {
  let best = 0;
  let bestUrl = "";
  let bestDate = "";
  for (const r of results) {
    if (r.platform === "all") continue;
    const u = r.url_measured;
    if (!u || !isOwnedUrl(u, siteDomain)) continue;
    const nu = normUrl(u);
    const c = typeof r.citation_count === "number" ? r.citation_count : 0;
    const d = r.snapshot_date;
    if (!d) continue;
    if (c > best) {
      best = c;
      bestUrl = nu;
      bestDate = d;
    }
  }
  if (best <= 0 || !bestUrl || !bestDate) return null;
  return {
    key: "page_citation_peak_global",
    kind: "page_citation_peak",
    value: best,
    achievedAt: new Date(bestDate + "T12:00:00Z").toISOString(),
    proofSummary: `Highest measured citations on a single day for one owned page (${bestDate}).`,
    meta: { url: bestUrl, date: bestDate, citations: best },
  };
}

export function proposeCorpusOwnedSharePeak(
  index: CitationEvidenceIndex | null,
): ProposedPeak | null {
  if (!index?.by_topic?.length) return null;
  let total = 0;
  let owned = 0;
  for (const t of index.by_topic) {
    total += t.total_citations;
    owned += t.owned_citations;
  }
  if (total <= 0) return null;
  const bps = Math.round((owned / total) * 10_000);
  if (bps <= 0) return null;
  const at = index.built_at || new Date().toISOString();
  return {
    key: "corpus_owned_share_peak",
    kind: "corpus_owned_share_peak",
    value: bps,
    achievedAt: at,
    proofSummary: `Peak owned share of citations in the indexed corpus (${(bps / 100).toFixed(1)}%).`,
    meta: { ownedBps: bps, total, owned },
  };
}

/**
 * Max gap (basis points) between owned citation share and top direct competitor
 * in the same rank slice as `buildCompetitorRank`.
 */
export function proposeDirectCompetitorLeadPeak(
  rank: CompetitorRankEntry[] | null,
): ProposedPeak | null {
  if (!rank?.length) return null;
  const owned = rank.find((r) => r.isOwned);
  if (!owned) return null;
  const directs = rank.filter((r) => !r.isOwned && r.type === "direct");
  if (!directs.length) return null;
  const top = directs.reduce((a, b) => (b.share > a.share ? b : a));
  const gapBps = Math.round((owned.share - top.share) * 100);
  if (gapBps <= 0) return null;
  return {
    key: "direct_competitor_lead_peak",
    kind: "direct_competitor_lead_peak",
    value: gapBps,
    achievedAt: new Date().toISOString(),
    proofSummary: `Widest measured citation-share lead over a direct competitor (${top.label}).`,
    meta: {
      competitor: top.label,
      ownedShare: owned.share,
      competitorShare: top.share,
      gapBps,
    },
  };
}

export function collectAllProposedPeaks(
  results: Result[],
  citationIndex: CitationEvidenceIndex | null,
  siteDomain: string,
  competitorRank: CompetitorRankEntry[] | null,
): ProposedPeak[] {
  const list: ProposedPeak[] = [];
  const a = proposeCitationDailyTotal(results);
  if (a) list.push(a);
  const b = proposeCitation7dSurge(results);
  if (b) list.push(b);
  const c1 = proposePlatformSharePeak(results, "chatgpt", "ChatGPT");
  if (c1) list.push(c1);
  const c2 = proposePlatformSharePeak(results, "google_aio", "Google AI Overview");
  if (c2) list.push(c2);
  list.push(...proposeTopicRankBests(results));
  list.push(...proposeTopicFirsts(results));
  const pg = proposeOwnedPageCitationPeak(results, siteDomain);
  if (pg) list.push(pg);
  const d = proposeCorpusOwnedSharePeak(citationIndex);
  if (d) list.push(d);
  const e = proposeDirectCompetitorLeadPeak(competitorRank);
  if (e) list.push(e);
  return list;
}

export function eventTitleForPeak(p: ProposedPeak): string {
  switch (p.kind) {
    case "citation_daily_total":
      return "New high: daily citations";
    case "citation_7d_surge":
      return "New high: 7-day citation momentum";
    case "platform_citation_share_peak":
      return "New high: platform share of citations";
    case "topic_rank_best":
      return "New best rank for a topic";
    case "topic_first_top3":
      return "First top-3 for a topic";
    case "topic_first_rank1":
      return "First #1 for a topic";
    case "page_citation_peak":
      return "New high: citations on an owned page";
    case "corpus_owned_share_peak":
      return "New high: owned share in corpus";
    case "direct_competitor_lead_peak":
      return "New high: lead over a direct competitor";
    default:
      return "Record updated";
  }
}

export function eventSubtitleForPeak(p: ProposedPeak): string {
  if (p.kind === "platform_citation_share_peak" && p.meta?.platform) {
    const bps = p.value as number;
    return `${String(p.meta.platform)} · ${(bps / 100).toFixed(1)}% peak day`;
  }
  if (p.kind === "corpus_owned_share_peak") {
    return `${(p.value / 100).toFixed(1)}% owned citations`;
  }
  if (p.kind === "direct_competitor_lead_peak") {
    const comp = p.meta?.competitor;
    return comp ? `vs ${comp}` : "Competitive slice";
  }
  if (p.kind === "topic_rank_best" && p.meta?.topic) {
    return `#${String(p.meta.position)} · ${String(p.meta.topic).slice(0, 48)}`;
  }
  if (
    (p.kind === "topic_first_top3" || p.kind === "topic_first_rank1") &&
    p.meta?.topic
  ) {
    return String(p.meta.topic).slice(0, 56);
  }
  if (p.kind === "page_citation_peak" && p.meta?.url) {
    return String(p.meta.url).replace(/^https?:\/\//, "").slice(0, 56);
  }
  if (p.kind === "citation_daily_total") {
    return `${p.value} citations (single day)`;
  }
  if (p.kind === "citation_7d_surge") {
    return `+${p.value} vs prior week (7-day window)`;
  }
  return p.proofSummary.slice(0, 80);
}
