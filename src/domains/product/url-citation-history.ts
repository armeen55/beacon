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
import { getPromptAnswerObservations } from "@/storage/canonical-store";
import { normalizePlatform } from "@/lib/platform";
import type { CitationObservation } from "@/domains/citation-observations/types";

/**
 * Commit 7 (2026-04-24) — hardcoded boundary date between the Profound
 * benchmark regime (everything through this date - 1 day) and the native
 * polling regime (this date forward). Native polls began 2026-04-22.
 *
 * T3.1 (2026-05-06) — extracted to `./native-regime.ts` so client
 * components can import it without dragging in this server-only module.
 * Re-exported here so existing server-side imports keep working.
 *
 * Intentionally hardcoded rather than derived dynamically from data. A
 * "find the last benchmark date" heuristic silently shifts as shards land
 * out of order, which is the bug we're trying to avoid. If ever needed,
 * this constant moves to business-config with the same semantics.
 */
export { NATIVE_REGIME_START } from "./native-regime";
import { NATIVE_REGIME_START } from "./native-regime";

/** One day's citation count on one URL, with platform breakdown. */
export type UrlDailyCount = {
  date: string; // YYYY-MM-DD
  count: number; // total citations on that day
  by_platform: Record<string, number>;
  /**
   * Commit 7 (2026-04-24). Which measurement regime produced this day's
   * count. Tag flows into `denseSeries` output so the url-verdict engine's
   * pure-split abstain guard can fire correctly.
   */
  source_type?: "benchmark" | "derived";
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
// Re-export the canonical helper from `src/lib/url/normalize.ts` (T6.6).
// The helper was extracted out of this file so analysis scripts +
// future write-time normalization callers can import it without pulling
// in the citation-history transitive dependency tree. Behavior is
// byte-identical to the previous in-file implementation; the public
// `normalizeUrl` symbol is unchanged.
import { normalizeUrl } from "@/lib/url/normalize";
export { normalizeUrl };

/**
 * Build the URL citation history index from existing stores.
 *
 * Commit 7 (2026-04-24): two-regime build. Dates STRICTLY before
 * NATIVE_REGIME_START read from Profound cold-store shards and tag points
 * as source_type='benchmark'. Dates ON OR AFTER NATIVE_REGIME_START read
 * from the `prompt_answer_observations` canonical store, via the
 * `buildNativeDayBuckets` helper which enforces the 1-per-observation-
 * per-URL dedup invariant. Tagged source_type='derived'.
 *
 * No date interpolation, no cross-regime summing. Each day's count comes
 * from exactly one regime.
 *
 * Performance: ~40 daily shards × ~2,500 citations each + ~200 native
 * observations/day with ~10 citations each ≈ 100K iterations. Runs in well
 * under a second on a laptop.
 */
export async function buildUrlCitationHistory(opts?: {
  ownedOnly?: boolean;
  sinceDate?: string;
  /**
   * Injected native-regime observations. When provided, used verbatim
   * instead of the canonical-store read — the Proof Engine passes the FULL
   * per-tenant observation set (via the repository) so it can attribute
   * historical changes whose pre/post windows predate the canonical-store's
   * 60-day render-perf window. Render-path consumers omit it and keep the
   * windowed read.
   */
  observations?: Awaited<ReturnType<typeof getPromptAnswerObservations>>;
}): Promise<UrlCitationHistory> {
  const ownedOnly = opts?.ownedOnly ?? true;
  const since = opts?.sinceDate ?? null;

  // Join table: prompt_answer_id → platform (for platform breakdown in the
  // output). Used by the Profound shard ingest path (native path uses
  // observation.platform directly — we're iterating observations, not
  // detached citation rows).
  const promptAnswerObservations =
    opts?.observations ?? (await getPromptAnswerObservations());
  const paoPlatform = new Map<string, string>();
  for (const pao of promptAnswerObservations) {
    // Canonicalize platform case here so a single platform never splits
    // across the per-platform breakdown (prod data has both "chatgpt" and
    // "ChatGPT"). The total daily count is unaffected either way.
    paoPlatform.set(pao.id, normalizePlatform(pao.platform));
  }

  type DayBucket = {
    count: number;
    by_platform: Record<string, number>;
    source_type: "benchmark" | "derived";
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

  // ------------------------------------------------------------------
  // Benchmark (pre-Apr-22) regime — Profound cold-store shards.
  // ------------------------------------------------------------------
  const allDates = getAllCitationDates();
  const benchmarkDates = allDates.filter((d) => d < NATIVE_REGIME_START);
  const sinceBenchmarkDates = since
    ? benchmarkDates.filter((d) => d >= since)
    : benchmarkDates;

  for (const date of sinceBenchmarkDates) {
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
        day = { count: 0, by_platform: {}, source_type: "benchmark" };
        entry.days.set(date, day);
      }
      day.count += 1;

      const platform = paoPlatform.get(c.prompt_answer_id) ?? "unknown";
      day.by_platform[platform] = (day.by_platform[platform] ?? 0) + 1;
    }
  }

  // ------------------------------------------------------------------
  // Native (Apr-22+) regime — prompt_answer_observations.citation_urls.
  // Delegates to buildNativeDayBuckets which enforces the 1-per-observation-
  // per-URL invariant explicitly so duplicate citations inside a single
  // answer never inflate the daily count.
  // ------------------------------------------------------------------
  const nativeBuckets = buildNativeDayBuckets(
    promptAnswerObservations,
    { ownedOnly, since },
  );
  for (const [normUrl, byDate] of nativeBuckets) {
    let entry = byUrl.get(normUrl);
    if (!entry) {
      entry = { raw_urls: new Set(), is_owned: true, days: new Map() };
      byUrl.set(normUrl, entry);
    }
    entry.is_owned = true; // native builder only emits owned-URL buckets
    for (const [date, bucket] of byDate) {
      // If a benchmark row also wrote this date (shouldn't happen since
      // allDates only includes Profound shards through the day before
      // NATIVE_REGIME_START), prefer the benchmark value — the regime
      // boundary is definitional, not dynamic. Native never overwrites
      // benchmark.
      if (entry.days.has(date)) continue;
      entry.days.set(date, bucket);
      // Record one representative raw URL (first one seen). url-citation-
      // history doesn't store full URL lists on daily rows; the raw_urls
      // Set is the union across all dates for this URL key.
      entry.raw_urls.add(date);
    }
  }

  const series: UrlCitationSeries[] = [];
  for (const [url, entry] of byUrl) {
    const daily = [...entry.days.entries()]
      .map(([date, b]) => ({
        date,
        count: b.count,
        by_platform: b.by_platform,
        source_type: b.source_type,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
    series.push({
      url,
      raw_urls: [...entry.raw_urls].sort(),
      is_owned: entry.is_owned,
      daily,
    });
  }

  series.sort((a, b) => a.url.localeCompare(b.url));

  const benchmarkFirst = sinceBenchmarkDates[0] ?? null;
  const nativeDates = Array.from(
    new Set(
      [...byUrl.values()].flatMap((e) =>
        [...e.days.entries()]
          .filter(([, b]) => b.source_type === "derived")
          .map(([d]) => d),
      ),
    ),
  ).sort();
  const nativeFirst = nativeDates[0] ?? null;
  const nativeLast = nativeDates[nativeDates.length - 1] ?? null;
  const first = benchmarkFirst ?? nativeFirst;
  const last = nativeLast ?? sinceBenchmarkDates[sinceBenchmarkDates.length - 1] ?? null;

  return {
    built_at: new Date().toISOString(),
    date_range: {
      first,
      last,
    },
    distinct_urls: series.length,
    series,
  };
}

/**
 * Commit 7 (2026-04-24) — native per-URL per-day citation builder.
 *
 * INVARIANTS (covered by url-citation-history.test.ts):
 *   1. One observation contributes at most 1 count per owned URL per day.
 *      Duplicate occurrences of the same owned URL inside a single answer's
 *      citations list are collapsed via a per-observation Set<url>.
 *   2. Two different observations on the same day each contribute +1 to
 *      their URL's daily count.
 *   3. Pre-NATIVE_REGIME_START observations are skipped — the benchmark
 *      regime owns those dates. No cross-regime stitching.
 *   4. Observations whose `citation_urls` is null or empty contribute
 *      nothing. Pre-Commit-7 rows (citation_urls=null) are invisible to
 *      this builder by design — domain-level is the only signal they carry.
 *
 * Returns a Map<normalizedOwnedUrl, Map<YYYY-MM-DD, DayBucket>>. Caller
 * merges into the overall series.
 */
export function buildNativeDayBuckets(
  observations: ReadonlyArray<{
    id: string;
    platform: string;
    observed_at: string;
    citation_urls?: string[] | null;
    citation_domains?: string[] | null;
  }>,
  opts: {
    ownedOnly: boolean;
    since: string | null;
    /**
     * Set of normalized owned URL paths to keep. When present, only owned
     * URLs pass the filter. When absent, every URL path is kept (useful
     * when `ownedOnly=false`). In production this is computed from the
     * tracked_entities table's is_owned domains + site sitemap; in tests
     * it's injected.
     */
    ownedUrlPathSet?: ReadonlySet<string>;
  },
): Map<string, Map<string, {
  count: number;
  by_platform: Record<string, number>;
  source_type: "benchmark" | "derived";
}>> {
  const out = new Map<
    string,
    Map<
      string,
      { count: number; by_platform: Record<string, number>; source_type: "benchmark" | "derived" }
    >
  >();

  for (const obs of observations) {
    // Skip observations outside the native regime window.
    const isoDate = obs.observed_at.slice(0, 10);
    if (isoDate < NATIVE_REGIME_START) continue;
    if (opts.since && isoDate < opts.since) continue;
    // Skip pre-Commit-7 rows (no URLs stored).
    if (!obs.citation_urls || obs.citation_urls.length === 0) continue;

    // INVARIANT 1: dedupe URLs within this observation via a Set. A
    // duplicate citation in one answer never contributes +2.
    const ownedUrlsInObs = new Set<string>();
    for (const raw of obs.citation_urls) {
      const normUrl = normalizeUrl(raw);
      if (!normUrl) continue;
      if (opts.ownedOnly) {
        if (!opts.ownedUrlPathSet) {
          // When ownedOnly is true but no owned set was provided, skip —
          // caller must supply the set. Safer than matching against a
          // domain-only heuristic and silently including non-owned paths.
          continue;
        }
        if (!opts.ownedUrlPathSet.has(normUrl)) continue;
      }
      ownedUrlsInObs.add(normUrl);
    }

    // Emit one +1 per unique owned URL in this observation.
    for (const normUrl of ownedUrlsInObs) {
      let byDate = out.get(normUrl);
      if (!byDate) {
        byDate = new Map();
        out.set(normUrl, byDate);
      }
      let bucket = byDate.get(isoDate);
      if (!bucket) {
        bucket = { count: 0, by_platform: {}, source_type: "derived" };
        byDate.set(isoDate, bucket);
      }
      bucket.count += 1;
      // Canonicalize platform case (prod has "chatgpt" AND "ChatGPT") so the
      // per-platform diff-in-diff breakdown doesn't split one platform in two.
      const canonPlatform = normalizePlatform(obs.platform);
      bucket.by_platform[canonPlatform] =
        (bucket.by_platform[canonPlatform] ?? 0) + 1;
    }
  }

  return out;
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
 * Commit 7 (2026-04-24): each emitted point's `source_type` tag comes from
 * the matching `UrlDailyCount.source_type` (set by `buildUrlCitationHistory`).
 * Pre-NATIVE_REGIME_START dates resolve to "benchmark"; on-or-after resolves
 * to "derived"; zero-filled days (no matching daily row) use the regime the
 * date falls in, so the pure-split abstain guard in url-verdict.ts still
 * fires on pre/post splits that span the boundary even when post-dates
 * have no observed citations.
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
  const byDate = new Map<string, UrlDailyCount>();
  for (const d of series.daily) byDate.set(d.date, d);

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
    const entry = byDate.get(iso);
    // Resolve the source_type: prefer the observed row's tag; fall back to
    // the regime the date falls in (so zero-fills on pre-boundary dates
    // carry "benchmark" and post-boundary zero-fills carry "derived").
    const source_type: "benchmark" | "derived" = entry?.source_type
      ?? (iso < NATIVE_REGIME_START ? "benchmark" : "derived");
    out.push({
      date: iso,
      count: entry?.count ?? 0,
      source_type,
    });
  }
  return out;
}
