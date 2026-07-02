import "server-only";

import { readStore, writeStore } from "@/lib/persistence/json-store";

/**
 * wikidata/client (2026-07-02, item 73), free, polite Wikidata entity
 * lookups for the Person-schema grounding slice. One call per lookup, on
 * Wikidata's public FREE action API (no key, no paid budget):
 *
 *   action=wbsearchentities&search=<name>&language=en&type=item
 *     -> ranked candidate entities: QID, label, description, matched
 *        aliases. This is Wikidata's own "did you mean" search, not a
 *        SPARQL query, appropriate for a bounded, cheap name lookup.
 *
 * Politeness mirrors src/domains/wiki-gap/wikipedia-client.ts (same
 * sister API family, same posture): identified User-Agent (Wikimedia's
 * API etiquette asks for one with contact info), a hard per-request
 * timeout, and a MODULE-LEVEL sequential throttle so a bounded batch of
 * lookups never bursts more than ~1 request/second.
 *
 * Per-entity 30-day cache via the json-store pattern (same TTL/shape
 * convention as WIKI_CACHE_STORE): a re-run within a month costs nothing
 * and never re-hits Wikidata. Fail-soft everywhere: any error, timeout,
 * or empty result yields a `null` match, never a thrown exception.
 *
 * Confidence policy (deliberately conservative, never invents a link):
 *   - "high": the top candidate's label matches the queried name exactly
 *     (case-insensitive) OR one of its returned aliases does, AND the
 *     candidate's description contains at least one of the caller's
 *     supplied keyword hints (e.g. an extracted occupation word). This is
 *     the ONLY tier whose sameAs may be auto-emitted into Person schema.
 *   - "needs-confirm": a label/alias match exists but no description
 *     keyword corroborates it (common for ambiguous names, many
 *     "John Smith"-shaped entities exist), OR only a near/partial match
 *     was found. Surfaced as an operator-confirmable suggestion only.
 *   - "none": no usable candidate returned.
 */

export const WIKIDATA_UA =
  "BeaconBot/1.0 (https://iranopedia.com; contact: aminarmeen@gmail.com) wikidata-entity-grounding";

const TIMEOUT_MS = 10_000;
/** Polite pacing floor between successive Wikidata requests. */
const MIN_GAP_MS = 1100;

const WIKIDATA_CACHE_STORE = "wikidata-entity-cache";
/** 30 days, matches the repo's other free/paid-API cache TTL convention. */
const WIKIDATA_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type WikidataMatchConfidence = "high" | "needs-confirm" | "none";

export type WikidataEntityMatch = {
  /** The name that was queried (caller's input, trimmed). */
  queriedName: string;
  qid: string | null;
  label: string | null;
  description: string | null;
  confidence: WikidataMatchConfidence;
  /** wikidata.org/wiki/<QID> when a QID was found, else null. */
  wikidataUrl: string | null;
  /** English Wikipedia sitelink URL, when the search response carried
   *  one (wbsearchentities sometimes includes a `url` best-match link
   *  to the corresponding sitelink page, kept only when present, never
   *  guessed from the label). */
  wikipediaUrl: string | null;
};

export type WikidataClientDeps = {
  fetchImpl?: typeof fetch;
  now?: () => Date;
  /** Injectable so tests never sleep 1.1s per lookup. */
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
};

type WikidataCacheRow = {
  /** Cache key: queried name, lowercased and trimmed (name-only, the
   *  keyword hints only affect confidence scoring, not identity). */
  key: string;
  fetchedAt: string;
  match: WikidataEntityMatch;
};

const defaultCacheDeps = {
  readCache: () => readStore<WikidataCacheRow>(WIKIDATA_CACHE_STORE, []),
  writeCache: (rows: WikidataCacheRow[]) => writeStore(WIKIDATA_CACHE_STORE, rows),
};

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Module-level last-request timestamp, shared across all callers in one
 *  process so a bounded batch of sequential lookups never bursts past
 *  ~1 req/sec even when multiple call sites run in the same run. */
let lastRequestAtMs = 0;

async function throttle(sleep: (ms: number) => Promise<void>, now: () => Date): Promise<void> {
  const elapsed = now().getTime() - lastRequestAtMs;
  if (elapsed < MIN_GAP_MS) await sleep(MIN_GAP_MS - elapsed);
  lastRequestAtMs = now().getTime();
}

function cacheKeyFor(name: string): string {
  return name.trim().toLowerCase();
}

function normalize(text: string | null | undefined): string {
  return (text ?? "").trim().toLowerCase();
}

type WbSearchCandidate = {
  id?: string;
  label?: string;
  description?: string;
  aliases?: string[];
  url?: string;
  match?: { type?: string; text?: string };
};

type WbSearchResponse = {
  search?: WbSearchCandidate[];
  error?: unknown;
};

/**
 * One `wbsearchentities` call. Returns the raw ranked candidate list
 * (empty on any failure); scoring/confidence happens in `matchEntity`.
 */
async function fetchSearchCandidates(
  name: string,
  deps: Required<Pick<WikidataClientDeps, "fetchImpl" | "timeoutMs">>,
): Promise<WbSearchCandidate[]> {
  const url =
    `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(name)}` +
    `&language=en&type=item&limit=5&format=json`;
  try {
    const res = await deps.fetchImpl(url, {
      headers: { "User-Agent": WIKIDATA_UA, Accept: "application/json" },
      signal: AbortSignal.timeout(deps.timeoutMs),
    });
    if (!res.ok) return [];
    const body = (await res.json()) as WbSearchResponse;
    if (body.error || !Array.isArray(body.search)) return [];
    return body.search;
  } catch {
    return [];
  }
}

/**
 * Score a candidate list against the queried name + optional keyword
 * hints (e.g. an extracted occupation word, used to corroborate an
 * ambiguous name). Pure, no I/O. Exported for direct unit testing of
 * the confidence tiers without mocking fetch.
 */
export function scoreWikidataCandidates(
  queriedName: string,
  candidates: WbSearchCandidate[],
  keywordHints: string[] = [],
): WikidataEntityMatch {
  const empty: WikidataEntityMatch = {
    queriedName,
    qid: null,
    label: null,
    description: null,
    confidence: "none",
    wikidataUrl: null,
    wikipediaUrl: null,
  };
  if (candidates.length === 0) return empty;

  const target = normalize(queriedName);
  const hints = keywordHints.map(normalize).filter(Boolean);

  // Prefer the first candidate whose label or an alias matches the
  // queried name exactly (Wikidata already ranks by relevance, so the
  // top exact match is the right pick even if it isn't index 0).
  const exactMatch = candidates.find((c) => {
    const label = normalize(c.label);
    if (label === target) return true;
    return (c.aliases ?? []).some((a) => normalize(a) === target);
  });

  const chosen = exactMatch ?? candidates[0];
  if (!chosen || !chosen.id) return empty;

  const qid = chosen.id;
  const label = chosen.label ?? null;
  const description = chosen.description ?? null;
  const wikidataUrl = `https://www.wikidata.org/wiki/${qid}`;
  const wikipediaUrl =
    typeof chosen.url === "string" && chosen.url.includes("wikipedia.org")
      ? chosen.url
      : null;

  const isExact = Boolean(exactMatch);
  const descriptionCorroborates =
    hints.length > 0 && hints.some((h) => normalize(description).includes(h));

  const confidence: WikidataMatchConfidence =
    isExact && descriptionCorroborates ? "high" : "needs-confirm";

  return {
    queriedName,
    qid,
    label,
    description,
    confidence,
    wikidataUrl,
    wikipediaUrl,
  };
}

/**
 * Fetch (or serve from the 30-day cache) the best Wikidata entity match
 * for a person's name. `keywordHints` (e.g. an extracted occupation
 * word like "actor" or "poet") corroborate an exact label match into
 * "high" confidence; without a corroborating hint, even an exact label
 * match stays "needs-confirm" (many names are ambiguous). Never throws,
 * any failure yields `{ confidence: "none" }`.
 *
 * NOTE: the cache key is name-only (case-insensitive). Keyword hints are
 * NOT part of the cache key by design, the identity lookup is the same
 * regardless of which hint the caller passes, and re-scoring from a
 * cached raw match is out of scope for this slice (a cache miss simply
 * re-fetches, which is cheap and rare given the 30-day TTL).
 */
export async function matchWikidataEntity(
  name: string,
  keywordHints: string[] = [],
  depsOverride: WikidataClientDeps = {},
): Promise<WikidataEntityMatch> {
  const trimmed = (name ?? "").trim();
  const empty: WikidataEntityMatch = {
    queriedName: trimmed,
    qid: null,
    label: null,
    description: null,
    confidence: "none",
    wikidataUrl: null,
    wikipediaUrl: null,
  };
  if (!trimmed) return empty;

  const now = depsOverride.now ?? (() => new Date());
  const deps = {
    fetchImpl: depsOverride.fetchImpl ?? fetch,
    now,
    sleep: depsOverride.sleep ?? defaultSleep,
    timeoutMs: depsOverride.timeoutMs ?? TIMEOUT_MS,
  };

  const key = cacheKeyFor(trimmed);

  // 30-day cache first, a re-run within a month never re-hits Wikidata.
  try {
    const cached = await defaultCacheDeps.readCache();
    const hit = cached.find((r) => r.key === key);
    if (hit && now().getTime() - Date.parse(hit.fetchedAt) < WIKIDATA_CACHE_TTL_MS) {
      return hit.match;
    }
  } catch {
    /* cache read failure is non-fatal, fall through to a live fetch */
  }

  await throttle(deps.sleep, deps.now);
  const candidates = await fetchSearchCandidates(trimmed, deps);
  const match = scoreWikidataCandidates(trimmed, candidates, keywordHints);

  try {
    const cached = await defaultCacheDeps.readCache();
    const others = cached.filter((r) => r.key !== key);
    await defaultCacheDeps.writeCache([
      ...others,
      { key, fetchedAt: now().toISOString(), match },
    ]);
  } catch {
    /* cache write failure is non-fatal */
  }

  return match;
}
