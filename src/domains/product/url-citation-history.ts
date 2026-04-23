/**
 * URL-level citation time series.
 *
 * For each owned URL on your site, produces a daily citation count derived from
 * the Profound citation shards (`.data/citations-by-date/YYYY-MM-DD.json`).
 * This is the data source the Z-score verdict engine (`url-verdict.ts`) reads
 * to decide whether a change helped, hurt, or moved nothing.
 *
 * Reads (existing stores, no new ingestion):
 *   - .data/citations-by-date/*.json        → per-day citation observations
 *   - .data/prompt-answer-observations.json → join for platform lookup
 *
 * Writes:
 *   - Returns an in-memory index. A snapshot can be persisted to
 *     .data/url-daily-citations.json via `persistUrlCitationHistory()`.
 */

import "server-only";

import { writeStore } from "@/lib/persistence/json-store";
import {
  getCitationsForDate,
  getAllCitationDates,
} from "@/lib/persistence/cold-store";
import { promptAnswerObservations } from "@/storage/canonical-store";
import type { CitationObservation } from "@/domains/citation-observations/types";

/** One day's citation count on one URL, with platform breakdown. */
export type UrlDailyCount = {
  date: string; // YYYY-MM-DD
  count: number; // total citations on that day
  by_platform: Record<string, number>;
};

/** Complete time series for a single owned URL. */
export type UrlCitationSeries = {
  url: string; // normalized — trailing slash removed, lowercased
  raw_urls: string[]; // all raw URLs that normalize to `url`
  is_owned: boolean;
  daily: UrlDailyCount[]; // sorted ascending by date, dates with zero citations are OMITTED
};

export type UrlCitationHistory = {
  built_at: string; // ISO timestamp
  date_range: { first: string | null; last: string | null };
  distinct_urls: number;
  series: UrlCitationSeries[];
};

/**
 * Normalize a URL to a path-only key so different representations of the same
 * page match. We strip scheme, host, `www.`, trailing slashes, and lowercase.
 *
 * This is intentionally path-only (not host+path) because changelog entries
 * carry paths ("/locations/palo-alto") while citation observations carry full
 * URLs ("https://ritzbuilders.com/locations/palo-alto/"). Matching on path
 * alone makes them align for a single-site tenant, which is the current model.
 *
 * Examples:
 *   https://ritzbuilders.com/locations/palo-alto/  →  /locations/palo-alto
 *   /locations/palo-alto                            →  /locations/palo-alto
 *   ritzbuilders.com/services/whole-home-remodel   →  /services/whole-home-remodel
 *   https://example.com                             →  /
 */
export function normalizeUrl(u: string | null | undefined): string | null {
  if (!u) return null;
  let raw = u.trim();
  if (!raw) return null;

  // If it's a full URL, parse and extract path.
  if (/^https?:\/\//i.test(raw)) {
    try {
      const url = new URL(raw);
      const path = url.pathname.replace(/\/+$/, "") || "/";
      return path.toLowerCase();
    } catch {
      // Fall through to string-based parse below.
    }
  }

  // Strip protocol if present in weird form, then strip leading host token if any.
  raw = raw.replace(/^https?:\/\//i, "");
  // If it starts with a host-looking segment (contains a "." before any "/"), strip it.
  const firstSlash = raw.indexOf("/");
  const headSegment = firstSlash >= 0 ? raw.slice(0, firstSlash) : raw;
  if (firstSlash >= 0 && headSegment.includes(".")) {
    raw = raw.slice(firstSlash); // keep the path onwards
  }
  // Ensure leading slash.
  if (!raw.startsWith("/")) raw = "/" + raw;
  // Strip trailing slashes, lowercase.
  raw = raw.replace(/\/+$/, "") || "/";
  return raw.toLowerCase();
}

/**
 * Build the URL citation history index from existing stores.
 *
 * Performance: ~40 daily shards × ~2,500 citations each ≈ 100K iterations.
 * Runs in well under a second on a laptop. Safe to call on every watcher tick.
 */
export function buildUrlCitationHistory(opts?: {
  ownedOnly?: boolean;
  sinceDate?: string;
}): UrlCitationHistory {
  const ownedOnly = opts?.ownedOnly ?? true;
  const since = opts?.sinceDate ?? null;

  // Join table: prompt_answer_id → platform (for platform breakdown in the output).
  const paoPlatform = new Map<string, string>();
  for (const pao of promptAnswerObservations) {
    paoPlatform.set(pao.id, pao.platform);
  }

  type DayBucket = {
    count: number;
    by_platform: Record<string, number>;
  };
  // normalized URL → date → bucket
  const byUrl = new Map<
    string,
    {
      raw_urls: Set<string>;
      is_owned: boolean;
      days: Map<string, DayBucket>;
    }
  >();

  const allDates = getAllCitationDates();
  const dates = since ? allDates.filter((d) => d >= since) : allDates;

  for (const date of dates) {
    const shard: CitationObservation[] = getCitationsForDate(date);
    for (const c of shard) {
      if (ownedOnly && !c.is_owned) continue;
      const normUrl = normalizeUrl(c.url);
      if (!normUrl) continue;

      let entry = byUrl.get(normUrl);
      if (!entry) {
        entry = { raw_urls: new Set(), is_owned: c.is_owned, days: new Map() };
        byUrl.set(normUrl, entry);
      }
      if (c.url) entry.raw_urls.add(c.url);
      if (c.is_owned) entry.is_owned = true;

      let day = entry.days.get(date);
      if (!day) {
        day = { count: 0, by_platform: {} };
        entry.days.set(date, day);
      }
      day.count += 1;

      const platform = paoPlatform.get(c.prompt_answer_id) ?? "unknown";
      day.by_platform[platform] = (day.by_platform[platform] ?? 0) + 1;
    }
  }

  const series: UrlCitationSeries[] = [];
  for (const [url, entry] of byUrl) {
    const daily = [...entry.days.entries()]
      .map(([date, b]) => ({ date, count: b.count, by_platform: b.by_platform }))
      .sort((a, b) => a.date.localeCompare(b.date));
    series.push({
      url,
      raw_urls: [...entry.raw_urls].sort(),
      is_owned: entry.is_owned,
      daily,
    });
  }

  series.sort((a, b) => a.url.localeCompare(b.url));

  return {
    built_at: new Date().toISOString(),
    date_range: {
      first: dates[0] ?? null,
      last: dates[dates.length - 1] ?? null,
    },
    distinct_urls: series.length,
    series,
  };
}

/**
 * Persist a snapshot to `.data/url-daily-citations.json`.
 * Called by the nightly/on-demand watcher after rebuild.
 */
export async function persistUrlCitationHistory(
  history: UrlCitationHistory,
): Promise<void> {
  await writeStore("url-daily-citations", [history]);
}

/**
 * Retrieve the series for a single URL (convenience).
 */
export function getSeriesForUrl(
  history: UrlCitationHistory,
  url: string,
): UrlCitationSeries | null {
  const norm = normalizeUrl(url);
  if (!norm) return null;
  return history.series.find((s) => s.url === norm) ?? null;
}

/**
 * Expand a series into a dense day-by-day array (zero-filled).
 * The Z-score engine wants explicit zeros, not gaps.
 *
 * Phase 0 addition — optional `dataQualityFlags`: when supplied, days whose
 * date appears in the set are OMITTED from the output rather than zero-filled.
 * The verdict engine filters its window by date range, so omitting a day is
 * equivalent to treating it as missing (neither a zero nor a real count).
 *
 * Commit 2 (2026-04-24): every emitted point is tagged `source_type: "benchmark"`
 * because the underlying `buildUrlCitationHistory` reads only Profound cold-store
 * citation shards — no native polling data is in the series yet. The tag makes
 * the new pure-split abstain guard in url-verdict.ts source-aware, so when native
 * observations are integrated in a later commit the tagging branches without
 * changing this function's signature.
 */
export function denseSeries(
  series: UrlCitationSeries,
  range: { first: string; last: string },
  dataQualityFlags?: Set<string> | string[],
): Array<{
  date: string;
  count: number;
  source_type: "benchmark" | "derived";
}> {
  const bad =
    dataQualityFlags instanceof Set
      ? dataQualityFlags
      : new Set(dataQualityFlags ?? []);
  const counts = new Map<string, number>();
  for (const d of series.daily) counts.set(d.date, d.count);

  const out: Array<{
    date: string;
    count: number;
    source_type: "benchmark" | "derived";
  }> = [];
  const start = new Date(range.first + "T00:00:00Z").getTime();
  const end = new Date(range.last + "T00:00:00Z").getTime();
  for (let t = start; t <= end; t += 86_400_000) {
    const iso = new Date(t).toISOString().slice(0, 10);
    if (bad.has(iso)) continue;
    out.push({
      date: iso,
      count: counts.get(iso) ?? 0,
      source_type: "benchmark",
    });
  }
  return out;
}
