import "server-only";

import { readStore, writeStore } from "@/lib/persistence/json-store";

/**
 * wikipedia-client (2026-07-02, master plan item 23) - free, polite Wikipedia
 * reads for the beat-Wikipedia finder. Two calls per article, both on Wikipedia's
 * public FREE action API (no key, no paid budget):
 *
 *   1. action=query&prop=extracts|revisions&explaintext=1&redirects=1
 *      -> the FULL plain-text article body (real word count, not just the lead
 *      paragraph) + the last revision timestamp, page existence.
 *   2. action=parse&prop=sections&redirects=1
 *      -> section count.
 *
 * NOTE: an earlier version of this client used the REST summary endpoint
 * (.../api/rest_v1/page/summary/<title>), whose `extract` field is the LEAD
 * PARAGRAPH ONLY - a live ground-truth run against Iranopedia's real citation
 * data caught this under-counting real articles as near-zero words (e.g. a
 * redirect-heavy topic reading 103 words when the target article actually has
 * 18,000+). `explaintext=1&redirects=1` on the action API fixes both the
 * lead-only truncation and the redirect-stub trap.
 *
 * Politeness mirrors src/domains/competitor-intel/polite-fetch.ts: identified
 * User-Agent (Wikipedia's API etiquette explicitly asks for one with contact
 * info), a hard per-request timeout, and a MODULE-LEVEL sequential throttle
 * (throttledFetch) so a bounded batch of lookups never bursts more than
 * ~1 request/second at the caller.
 *
 * 30-day cache via the json-store pattern (identical TTL/shape convention to
 * dataforseo-labs.ts's LABS_CACHE_STORE): a re-run within a month costs nothing
 * and never re-hits Wikipedia. Fail-soft everywhere: any error, timeout, or
 * missing article yields `{ exists: false }`, never a thrown exception.
 */

export const WIKIPEDIA_UA =
  "BeaconBot/1.0 (https://iranopedia.com; contact: aminarmeen@gmail.com) wiki-gap-finder";

const TIMEOUT_MS = 10_000;
/** Polite pacing floor between successive Wikipedia requests - "max ~1 req/sec". */
const MIN_GAP_MS = 1100;

const WIKI_CACHE_STORE = "wiki-gap-article-cache";
/** 30 days - matches the repo's other free/paid-API cache TTL convention. */
const WIKI_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type WikipediaArticleFacts = {
  title: string;
  exists: boolean;
  /** Approximate word count of the current article extract/body. Null when
   *  unknown (fetch failed or the summary carried no usable text). */
  words: number | null;
  /** Number of top-level + nested sections the action API reports. Null when
   *  unknown. */
  sections: number | null;
  /** ISO timestamp of the last revision, or null when unknown. */
  lastRevisionAt: string | null;
};

export type WikipediaClientDeps = {
  fetchImpl?: typeof fetch;
  now?: () => Date;
  /** Injectable so tests never sleep 1.1s per lookup. */
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
};

type WikiCacheRow = {
  title: string;
  fetchedAt: string;
  facts: WikipediaArticleFacts;
};

const defaultCacheDeps = {
  readCache: () => readStore<WikiCacheRow>(WIKI_CACHE_STORE, []),
  writeCache: (rows: WikiCacheRow[]) => writeStore(WIKI_CACHE_STORE, rows),
};

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Module-level last-request timestamp - shared across all callers in one process
 *  so a bounded batch of sequential lookups never bursts past ~1 req/sec even
 *  when multiple call sites run in the same run. Reset is not needed between
 *  test files: tests inject their own `sleep`/`fetchImpl`, never touching this. */
let lastRequestAtMs = 0;

async function throttle(sleep: (ms: number) => Promise<void>, now: () => Date): Promise<void> {
  const elapsed = now().getTime() - lastRequestAtMs;
  if (elapsed < MIN_GAP_MS) await sleep(MIN_GAP_MS - elapsed);
  lastRequestAtMs = now().getTime();
}

/** Wikipedia's REST summary title form: spaces -> underscores, first path segment only. */
export function normalizeWikiTitle(title: string): string {
  return title.trim().replace(/\s+/g, "_");
}

/** Rough word count from a plain-text extract - split on whitespace. */
function wordCount(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

type ExtractAndRevisionResult = { exists: boolean; words: number | null; lastRevisionAt: string | null };

/**
 * Action API, ONE call: the full plain-text article body (`prop=extracts` with
 * `explaintext=1`) plus the latest revision timestamp (`prop=revisions`).
 *
 * `redirects=1` is load-bearing: without it, a redirect title (e.g. "Ancient
 * Persia" -> "History of Iran") resolves to a stub page whose own extract is
 * empty, which under-reports word count as near-zero for a topic that actually
 * has a full article under its canonical name. `explaintext=1` returns the
 * FULL article body, not just the lead paragraph - the REST summary endpoint's
 * `extract` field is lead-only and previously under-counted every article's
 * real length (verified live: "Ancient Persia" read 103 lead words vs 18,425
 * real words under its redirect target).
 */
async function fetchExtractAndRevision(
  title: string,
  deps: Required<Pick<WikipediaClientDeps, "fetchImpl" | "timeoutMs">>,
): Promise<ExtractAndRevisionResult> {
  const url =
    `https://en.wikipedia.org/w/api.php?action=query&prop=extracts%7Crevisions&explaintext=1&redirects=1` +
    `&rvprop=timestamp&rvlimit=1&titles=${encodeURIComponent(title)}&format=json&formatversion=2`;
  try {
    const res = await deps.fetchImpl(url, {
      headers: { "User-Agent": WIKIPEDIA_UA, Accept: "application/json" },
      signal: AbortSignal.timeout(deps.timeoutMs),
    });
    if (!res.ok) return { exists: false, words: null, lastRevisionAt: null };
    const body = (await res.json()) as {
      query?: { pages?: Array<{ missing?: boolean; extract?: string; revisions?: Array<{ timestamp?: string }> }> };
    };
    const page = body.query?.pages?.[0];
    if (!page || page.missing) return { exists: false, words: null, lastRevisionAt: null };
    const extract = typeof page.extract === "string" ? page.extract : "";
    const ts = page.revisions?.[0]?.timestamp;
    return {
      exists: true,
      words: extract ? wordCount(extract) : null,
      lastRevisionAt: typeof ts === "string" ? ts : null,
    };
  } catch {
    return { exists: false, words: null, lastRevisionAt: null };
  }
}

/** Action API: section count via `action=parse&prop=sections`, followed under
 *  the same `redirects=1` posture as the extract call. Fail-soft to null. */
async function fetchSectionCount(
  title: string,
  deps: Required<Pick<WikipediaClientDeps, "fetchImpl" | "timeoutMs">>,
): Promise<number | null> {
  try {
    const url =
      `https://en.wikipedia.org/w/api.php?action=parse&prop=sections&redirects=1` +
      `&page=${encodeURIComponent(title)}&format=json&formatversion=2`;
    const res = await deps.fetchImpl(url, {
      headers: { "User-Agent": WIKIPEDIA_UA, Accept: "application/json" },
      signal: AbortSignal.timeout(deps.timeoutMs),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { parse?: { sections?: unknown[] }; error?: unknown };
    if (body.error || !Array.isArray(body.parse?.sections)) return null;
    return body.parse!.sections!.length;
  } catch {
    return null;
  }
}

/**
 * Fetch (or serve from the 30-day cache) the beatability-relevant facts for one
 * Wikipedia article. Never throws - any failure yields `{ exists: false, ... }`
 * with null facts so callers can skip it without special-casing errors.
 */
export async function fetchArticleFacts(
  title: string,
  depsOverride: WikipediaClientDeps = {},
): Promise<WikipediaArticleFacts> {
  const norm = normalizeWikiTitle(title);
  const empty: WikipediaArticleFacts = { title: norm, exists: false, words: null, sections: null, lastRevisionAt: null };
  if (!norm) return empty;

  const now = depsOverride.now ?? (() => new Date());
  const deps = {
    fetchImpl: depsOverride.fetchImpl ?? fetch,
    now,
    sleep: depsOverride.sleep ?? defaultSleep,
    timeoutMs: depsOverride.timeoutMs ?? TIMEOUT_MS,
  };

  // 30-day cache first - a re-run within a month never re-hits Wikipedia.
  try {
    const cached = await defaultCacheDeps.readCache();
    const hit = cached.find((r) => r.title === norm);
    if (hit && now().getTime() - Date.parse(hit.fetchedAt) < WIKI_CACHE_TTL_MS) {
      return hit.facts;
    }
  } catch {
    /* cache read failure is non-fatal - fall through to a live fetch */
  }

  await throttle(deps.sleep, deps.now);
  const extractResult = await fetchExtractAndRevision(norm, deps);
  if (!extractResult.exists) {
    // Still cache the miss so a bounded batch doesn't re-probe a dead title
    // every run for 30 days.
    const facts: WikipediaArticleFacts = { ...empty };
    try {
      const cached = await defaultCacheDeps.readCache();
      const others = cached.filter((r) => r.title !== norm);
      await defaultCacheDeps.writeCache([...others, { title: norm, fetchedAt: now().toISOString(), facts }]);
    } catch {
      /* cache write failure is non-fatal */
    }
    return facts;
  }

  await throttle(deps.sleep, deps.now);
  const sections = await fetchSectionCount(norm, deps);
  const facts: WikipediaArticleFacts = {
    title: norm,
    exists: true,
    words: extractResult.words,
    sections,
    lastRevisionAt: extractResult.lastRevisionAt,
  };

  try {
    const cached = await defaultCacheDeps.readCache();
    const others = cached.filter((r) => r.title !== norm);
    await defaultCacheDeps.writeCache([...others, { title: norm, fetchedAt: now().toISOString(), facts }]);
  } catch {
    /* cache write failure is non-fatal */
  }

  return facts;
}
