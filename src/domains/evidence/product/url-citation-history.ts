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
import { observationModeOf } from "@/domains/evidence/readers/native-intel";
import type { CitationObservation } from "@/domains/evidence/ai-visibility/citation-observations";

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
type UrlDailyCount = {
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
 * page match (scheme, host, `www.`, trailing slash stripped, lowercased).
 * Path-only on purpose: changelog entries carry paths while observations carry
 * full URLs, and they must align for a single-site tenant. The implementation
 * lives in `src/lib/url/normalize.ts` (T6.6) so scripts can import it without
 * this file's dependency tree; re-exported here, behavior unchanged.
 */
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
 * from exactly one regime. ~100K iterations worst case, well under a second.
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
  /**
   * Profound-connector citations for the tenant's OWNED URLs (live
   * `profound_citation_rows`, mapped to {url, date, platform, count}).
   * Fuses the operator's PAID Profound AI-visibility data into the
   * proof history as a third measurement source — so watch windows
   * measure even while native polling is OpenAI-quota-blocked.
   * GAP-FILL precedence: benchmark > native > profound (Profound never
   * overwrites a (url,date) the polling regimes already cover, so the
   * same citation is never double-counted). Absent/empty (every render
   * consumer + the default) → byte-identical behavior. The proof engine's
   * honesty gates apply to the merged history unchanged.
   */
  profoundOwnedCitations?: ReadonlyArray<{ url: string; date: string; platform: string; count: number }>;
}): Promise<UrlCitationHistory> {
  const ownedOnly = opts?.ownedOnly ?? true;
  const since = opts?.sinceDate ?? null;

  // Join table: prompt_answer_id → platform (for platform breakdown in the
  // output). Used by the Profound shard ingest path (native path uses
  // observation.platform directly — we're iterating observations, not
  // detached citation rows).
  // Slice 6I: a per-id lookup, not a counter, and it only serves the benchmark
  // regime (dates before NATIVE_REGIME_START, which no dual-mode chatgpt row can
  // carry), so it cannot double count. The native gate is buildNativeDayBuckets.
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

  // ------------------------------------------------------------------
  // Profound regime (2026-06-13) — live profound_citation_rows for the
  // tenant's OWNED URLs. GAP-FILL only: writes a (url,date) bucket ONLY
  // when neither benchmark nor native already covered it, so a citation
  // measured by both sources is never double-counted. This bridges the
  // measurement loop while native polling is quota-blocked.
  // ------------------------------------------------------------------
  if (opts?.profoundOwnedCitations && opts.profoundOwnedCitations.length > 0) {
    // Aggregate Profound rows per (normUrl, date) → per-platform counts.
    const pf = new Map<string, Map<string, Record<string, number>>>();
    for (const row of opts.profoundOwnedCitations) {
      const normUrl = normalizeUrl(row.url);
      if (!normUrl || !row.date) continue;
      if (since && row.date < since) continue;
      const byDate = pf.get(normUrl) ?? new Map<string, Record<string, number>>();
      const platforms = byDate.get(row.date) ?? {};
      const platform = normalizePlatform(row.platform || "unknown");
      platforms[platform] = (platforms[platform] ?? 0) + (row.count ?? 0);
      byDate.set(row.date, platforms);
      pf.set(normUrl, byDate);
    }
    for (const [normUrl, byDate] of pf) {
      // Compute the valid gap-fill buckets FIRST; only touch byUrl when
      // at least one lands, so an all-zero URL never creates an empty
      // owned series.
      const existing = byUrl.get(normUrl);
      const toAdd: Array<[string, Record<string, number>, number]> = [];
      for (const [date, platforms] of byDate) {
        if (existing?.days.has(date)) continue; // benchmark/native win
        const total = Object.values(platforms).reduce((a, b) => a + b, 0);
        if (total <= 0) continue;
        toAdd.push([date, platforms, total]);
      }
      if (toAdd.length === 0) continue;
      const entry =
        existing ?? { raw_urls: new Set<string>(), is_owned: true, days: new Map() };
      entry.is_owned = true; // Profound rows here are owned-domain only
      for (const [date, platforms, total] of toAdd) {
        entry.days.set(date, {
          count: total,
          by_platform: { ...platforms },
          source_type: "benchmark", // external-source (non-native) bucket
        });
        entry.raw_urls.add(date);
      }
      byUrl.set(normUrl, entry);
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

/** Bare, lowercased host (leading `www.` stripped) — the canonical form
 *  `citation_domains` is stored in, so URL hosts compare equal to it. */
function stripWww(host: string): string {
  return host.replace(/^www\./i, "").toLowerCase();
}

/**
 * Slice 6I - the one mode gate this file needs. ChatGPT can now produce TWO rows
 * for the same prompt on the same day: the consumer search look (canonical) and
 * the standardized ask (auxiliary). Counting both would hand every owned URL a
 * silent +1 per day that reads as a real citation gain in the proof/verdict
 * windows. Dropping the standardized row makes a day's chatgpt count the consumer
 * look only, and a prompt with no consumer look stays honestly uncounted. Legacy
 * rows carry no marker and count exactly as before - they predate the pair.
 */
function isAuxiliaryChatgptRow(obs: { platform: string; metadata?: Record<string, unknown> | null }): boolean {
  return normalizePlatform(obs.platform) === "chatgpt" && observationModeOf(obs.metadata) === "standardized_response";
}

/** Host of a full URL in `citation_domains` form, or null if unparseable. */
function urlHost(raw: string): string | null {
  try {
    return stripWww(new URL(raw).hostname);
  } catch {
    return null;
  }
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
 * Owned-URL determination (when `ownedOnly`):
 *   - If `ownedUrlPathSet` is supplied, it is authoritative (tests + any
 *     sitemap-driven caller).
 *   - Otherwise, fall back to the observation's OWN per-citation domain
 *     classification: `citation_domains[i]` + `citation_domain_classes[i]`
 *     are emitted ALIGNED by `classifyCitationDomains` (deduped host + its
 *     class, relative to the observation's owning tenant), so a citation
 *     URL is owned iff its host's class is "owned". This makes the builder
 *     self-contained. Before 2026-06-12 the no-set case skipped EVERY
 *     citation, which silently emptied native-regime history for all three
 *     callers (proof engine, URL watcher, /changes) since
 *     NATIVE_REGIME_START — the proof engine's computed=0-on-prod bug.
 *
 * Returns a Map<normalizedOwnedUrl, Map<YYYY-MM-DD, DayBucket>>. Caller
 * merges into the overall series.
 */
function buildNativeDayBuckets(
  observations: ReadonlyArray<{
    id: string;
    platform: string;
    observed_at: string;
    citation_urls?: string[] | null;
    citation_domains?: string[] | null;
    citation_domain_classes?: string[] | null;
    /** Slice 6I: carries `observationMode` / `scraper`. Absent on legacy rows. */
    metadata?: Record<string, unknown> | null;
  }>,
  opts: {
    ownedOnly: boolean;
    since: string | null;
    /**
     * Set of normalized owned URL paths to keep. When present, it is
     * authoritative — only these paths pass the owned filter. When absent
     * AND `ownedOnly`, the per-observation `citation_domain_classes`
     * fallback (above) decides owned-ness. When `ownedOnly` is false,
     * every URL path is kept.
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
    // Slice 6I: never count the auxiliary chatgpt row as a second observation.
    if (isAuxiliaryChatgptRow(obs)) continue;
    // Skip observations outside the native regime window.
    const isoDate = obs.observed_at.slice(0, 10);
    if (isoDate < NATIVE_REGIME_START) continue;
    if (opts.since && isoDate < opts.since) continue;
    // Skip pre-Commit-7 rows (no URLs stored).
    if (!obs.citation_urls || obs.citation_urls.length === 0) continue;

    // Owned-host fallback — built once per observation, only when no
    // explicit path set was supplied. `citation_domains[i]` and
    // `citation_domain_classes[i]` are emitted aligned (deduped host + its
    // class, relative to THIS observation's owning tenant), so a host is
    // owned iff its class is "owned".
    let ownedHosts: Set<string> | null = null;
    if (opts.ownedOnly && !opts.ownedUrlPathSet) {
      ownedHosts = new Set<string>();
      const domains = obs.citation_domains ?? [];
      const classes = obs.citation_domain_classes ?? [];
      for (let i = 0; i < domains.length; i++) {
        if (classes[i] === "owned") ownedHosts.add(stripWww(domains[i]));
      }
    }

    // INVARIANT 1: dedupe URLs within this observation via a Set. A
    // duplicate citation in one answer never contributes +2.
    const ownedUrlsInObs = new Set<string>();
    for (const raw of obs.citation_urls) {
      const normUrl = normalizeUrl(raw);
      if (!normUrl) continue;
      if (opts.ownedOnly) {
        if (opts.ownedUrlPathSet) {
          // Explicit path set is authoritative.
          if (!opts.ownedUrlPathSet.has(normUrl)) continue;
        } else {
          // Self-contained fallback: keep the citation iff its host is
          // classified "owned" in this observation's domain classes.
          const host = urlHost(raw);
          if (!host || !ownedHosts!.has(host)) continue;
        }
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
