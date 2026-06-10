/**
 * 2026-06-09 — Competitor-URL citation series (pure).
 *
 * Builds per-URL daily citation counts for TRACKED COMPETITOR pages from
 * prompt-answer observations. Schema v2.2 Commit 7 (2026-04-24) made
 * `citation_urls` carry EVERY URL an answer cited (parallel to
 * `citation_domains`), competitor URLs included — that's the substrate.
 * Pre-Commit-7 rows have `citation_urls: null` and contribute nothing
 * (domain-level only; honestly omitted rather than guessed).
 *
 * PURE (no I/O). The loader feeds observations + the configured
 * competitor universe in; move detection consumes the series.
 */

import { canonicalizeCitationUrl } from "@/domains/citation-lifecycle/canonicalize-url";
import type {
  CompetitorUrlCitationSeries,
  CompetitorUrlDailyCount,
} from "./types";

/** Minimal observation shape this module needs (subset of
 *  PromptAnswerObservation — keeps the pure module decoupled). */
export type CitationObservationInput = {
  observed_at: string;
  platform: string;
  citation_urls?: string[] | null;
};

export type CompetitorDomainInput = {
  /** Hostname only, e.g. "supplehomesinc.com". */
  domain: string;
  displayName: string;
};

/** Lowercase host, strip a single leading "www.". */
export function normalizeHost(host: string): string {
  const h = host.toLowerCase().trim();
  return h.startsWith("www.") ? h.slice(4) : h;
}

function hostOf(url: string): string | null {
  try {
    return normalizeHost(new URL(url).hostname);
  } catch {
    return null;
  }
}

function matchDomain(
  host: string,
  domains: ReadonlyArray<CompetitorDomainInput>,
): CompetitorDomainInput | null {
  for (const d of domains) {
    const dom = normalizeHost(d.domain);
    if (dom === "") continue;
    if (host === dom || host.endsWith(`.${dom}`)) return d;
  }
  return null;
}

/**
 * Bucket competitor-URL citations by canonical URL + UTC date.
 * Deterministic: series sorted by total desc then url asc; daily sorted
 * by date asc; platforms deduped + sorted.
 */
export function buildCompetitorCitationSeries(
  observations: ReadonlyArray<CitationObservationInput>,
  competitors: ReadonlyArray<CompetitorDomainInput>,
): CompetitorUrlCitationSeries[] {
  if (competitors.length === 0) return [];

  type Bucket = {
    domain: string;
    displayName: string;
    days: Map<string, { count: number; platforms: Set<string> }>;
    total: number;
  };
  const byUrl = new Map<string, Bucket>();

  for (const obs of observations) {
    const urls = obs.citation_urls;
    if (urls == null || urls.length === 0) continue;
    const date = obs.observed_at.slice(0, 10);
    if (date.length !== 10) continue;

    for (const raw of urls) {
      const canonical = canonicalizeCitationUrl(raw);
      if (canonical == null || canonical === "") continue;
      const host = hostOf(canonical);
      if (host == null) continue;
      const match = matchDomain(host, competitors);
      if (match == null) continue;

      let bucket = byUrl.get(canonical);
      if (bucket == null) {
        bucket = {
          domain: normalizeHost(match.domain),
          displayName: match.displayName,
          days: new Map(),
          total: 0,
        };
        byUrl.set(canonical, bucket);
      }
      let day = bucket.days.get(date);
      if (day == null) {
        day = { count: 0, platforms: new Set() };
        bucket.days.set(date, day);
      }
      day.count += 1;
      day.platforms.add(obs.platform);
      bucket.total += 1;
    }
  }

  const series: CompetitorUrlCitationSeries[] = [];
  for (const [url, b] of byUrl) {
    const daily: CompetitorUrlDailyCount[] = [...b.days.entries()]
      .map(([date, d]) => ({
        date,
        count: d.count,
        platforms: [...d.platforms].sort(),
      }))
      .sort((a, z) => (a.date < z.date ? -1 : a.date > z.date ? 1 : 0));
    series.push({
      url,
      domain: b.domain,
      displayName: b.displayName,
      daily,
      total: b.total,
    });
  }
  return series.sort(
    (a, z) => z.total - a.total || (a.url < z.url ? -1 : 1),
  );
}

/** Sum counts in [startDate, endDateExclusive). Dates are YYYY-MM-DD. */
export function windowCount(
  daily: ReadonlyArray<CompetitorUrlDailyCount>,
  startDate: string,
  endDateExclusive: string,
): number {
  let n = 0;
  for (const d of daily) {
    if (d.date >= startDate && d.date < endDateExclusive) n += d.count;
  }
  return n;
}

/** First citation date on/after `dateIso` (YYYY-MM-DD), or null. */
export function firstCitationOnOrAfter(
  daily: ReadonlyArray<CompetitorUrlDailyCount>,
  dateIso: string,
): string | null {
  for (const d of daily) {
    if (d.date >= dateIso && d.count > 0) return d.date;
  }
  return null;
}
