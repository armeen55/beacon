import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * wikipedia-client tests (2026-07-02, item 23) - mocked fetch throughout, no
 * network. Mocks src/lib/persistence/json-store so the cache is an in-memory
 * array per test (readStore/writeStore mirror the real module's shape).
 *
 * Both live calls go through the action API:
 *   - action=query&prop=extracts|revisions  -> full article word count + last revision
 *   - action=parse&prop=sections            -> section count
 */

let cacheData: Array<{ title: string; fetchedAt: string; facts: unknown }> = [];

vi.mock("@/lib/persistence/json-store", () => ({
  readStore: vi.fn(async () => cacheData),
  writeStore: vi.fn(async (_name: string, rows: typeof cacheData) => {
    cacheData = rows;
  }),
}));

import { fetchArticleFacts, normalizeWikiTitle, WIKIPEDIA_UA, type WikipediaClientDeps } from "./wikipedia-client";

const jsonResponse = (body: unknown, status = 200): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as unknown as Response;

const noSleep = () => Promise.resolve();

/** Wraps a mocked fetch (kept as a real vi.fn so tests can assert on .mock)
 *  into the deps shape fetchArticleFacts expects (typeof fetch has multiple
 *  overloads a plain vi.fn signature doesn't structurally satisfy). */
function withFetch(fetchImpl: ReturnType<typeof vi.fn>, over: Partial<WikipediaClientDeps> = {}): WikipediaClientDeps {
  return { fetchImpl: fetchImpl as unknown as typeof fetch, sleep: noSleep, ...over };
}

function fakeFetch(byUrl: (url: string) => Response) {
  return vi.fn(async (input: RequestInfo | URL) => byUrl(String(input)));
}

/** Real-shaped extracts+revisions response, page found. */
const extractPage = (extract: string, timestamp: string) =>
  jsonResponse({ query: { pages: [{ extract, revisions: [{ timestamp }] }] } });

/** Real-shaped extracts+revisions response, page missing. */
const missingPage = () => jsonResponse({ query: { pages: [{ missing: true }] } });

/** Real-shaped sections response. */
const sectionsResponse = (count: number) => jsonResponse({ parse: { sections: Array.from({ length: count }, () => ({})) } });

beforeEach(() => {
  cacheData = [];
});

describe("normalizeWikiTitle", () => {
  it("replaces spaces with underscores and trims", () => {
    expect(normalizeWikiTitle("  Chaharshanbe Suri  ")).toBe("Chaharshanbe_Suri");
  });
});

describe("fetchArticleFacts - parsing", () => {
  it("parses a real article: word count from the FULL extract (not just the lead), revision timestamp, section count", async () => {
    const longExtract = Array.from({ length: 2908 }, (_, i) => `w${i}`).join(" ");
    const fetchImpl = fakeFetch((url) => {
      if (url.includes("action=query")) return extractPage(longExtract, "2019-03-01T00:00:00Z");
      if (url.includes("action=parse")) return sectionsResponse(3);
      return jsonResponse({}, 404);
    });
    const facts = await fetchArticleFacts("Some Topic", withFetch(fetchImpl));
    expect(facts.exists).toBe(true);
    expect(facts.words).toBe(2908);
    expect(facts.lastRevisionAt).toBe("2019-03-01T00:00:00Z");
    expect(facts.sections).toBe(3);
    expect(facts.title).toBe("Some_Topic");
  });

  it("requests explaintext + redirects so a redirect-heavy topic reads the real target article length, not a lead-only or stub count", async () => {
    const urls: string[] = [];
    const fetchImpl = fakeFetch((url) => {
      urls.push(url);
      if (url.includes("action=query")) return extractPage("a b c d e", "2020-01-01T00:00:00Z");
      return sectionsResponse(1);
    });
    await fetchArticleFacts("Ancient Persia", withFetch(fetchImpl));
    const queryUrl = urls.find((u) => u.includes("action=query"))!;
    expect(queryUrl).toContain("explaintext=1");
    expect(queryUrl).toContain("redirects=1");
    expect(queryUrl).toContain("prop=extracts");
    expect(queryUrl).toContain("revisions");
  });

  it("sends the identified User-Agent header", async () => {
    const seen: string[] = [];
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const ua = (init?.headers as Record<string, string>)?.["User-Agent"];
      if (ua) seen.push(ua);
      return extractPage("short extract", "2020-01-01T00:00:00Z");
    });
    await fetchArticleFacts("X", withFetch(fetchImpl));
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((ua) => ua === WIKIPEDIA_UA)).toBe(true);
  });

  it("missing page -> exists false, no section call needed", async () => {
    let sectionsCalled = false;
    const fetchImpl = fakeFetch((url) => {
      if (url.includes("action=query")) return missingPage();
      if (url.includes("action=parse")) sectionsCalled = true;
      return jsonResponse({}, 404);
    });
    const facts = await fetchArticleFacts("Nonexistent Topic", withFetch(fetchImpl));
    expect(facts.exists).toBe(false);
    expect(facts.words).toBeNull();
    expect(facts.lastRevisionAt).toBeNull();
    expect(sectionsCalled).toBe(false);
  });

  it("an existing page with an empty extract -> words null (never a fake thin score)", async () => {
    const fetchImpl = fakeFetch((url) => {
      if (url.includes("action=query")) return extractPage("", "2020-01-01T00:00:00Z");
      return sectionsResponse(0);
    });
    const facts = await fetchArticleFacts("Empty Extract Topic", withFetch(fetchImpl));
    expect(facts.exists).toBe(true);
    expect(facts.words).toBeNull();
  });

  it("network failure anywhere fails soft to a non-throwing empty-ish result", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    });
    await expect(fetchArticleFacts("Whatever", withFetch(fetchImpl))).resolves.toEqual(
      expect.objectContaining({ exists: false, words: null, sections: null, lastRevisionAt: null }),
    );
  });

  it("HTTP error status fails soft to exists false", async () => {
    const fetchImpl = fakeFetch(() => jsonResponse({}, 500));
    const facts = await fetchArticleFacts("Server Error Topic", withFetch(fetchImpl));
    expect(facts.exists).toBe(false);
  });

  it("empty title -> exists false without any fetch call", async () => {
    const fetchImpl = vi.fn();
    const facts = await fetchArticleFacts("   ", withFetch(fetchImpl));
    expect(facts.exists).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("fetchArticleFacts - throttle", () => {
  it("sleeps between successive live requests to stay near 1 req/sec", async () => {
    const sleep = vi.fn(async () => {});
    const now = new Date("2026-07-02T00:00:00.000Z").getTime();
    const nowFn = () => new Date(now);
    const fetchImpl = fakeFetch((url) => {
      if (url.includes("action=query")) return extractPage("a b c", "2020-01-01T00:00:00Z");
      return sectionsResponse(1);
    });
    await fetchArticleFacts("Alpha", withFetch(fetchImpl, { sleep, now: nowFn }));
    // 2 throttled calls per article (extracts+revisions, sections) -> sleep invoked
    // at least once since the clock never advances in this fake.
    expect(sleep).toHaveBeenCalled();
  });
});

describe("fetchArticleFacts - 30 day cache", () => {
  it("serves a fresh cache hit without calling fetch again", async () => {
    const fetchImpl = fakeFetch((url) => {
      if (url.includes("action=query")) return extractPage("a b c d e f g", "2021-05-01T00:00:00Z");
      return sectionsResponse(2);
    });
    const now = () => new Date("2026-07-02T00:00:00Z");
    const first = await fetchArticleFacts("Cached Topic", withFetch(fetchImpl, { now }));
    expect(first.exists).toBe(true);
    expect(fetchImpl).toHaveBeenCalled();

    const callsAfterFirst = fetchImpl.mock.calls.length;
    const second = await fetchArticleFacts("Cached Topic", withFetch(fetchImpl, { now }));
    expect(second).toEqual(first);
    expect(fetchImpl.mock.calls.length).toBe(callsAfterFirst); // no new network calls
  });

  it("a cache entry older than 30 days is treated as stale and re-fetched", async () => {
    const fetchImpl = fakeFetch((url) => {
      if (url.includes("action=query")) return extractPage("one two", "2020-01-01T00:00:00Z");
      return sectionsResponse(1);
    });
    const oldNow = () => new Date("2026-01-01T00:00:00Z");
    await fetchArticleFacts("Aging Topic", withFetch(fetchImpl, { now: oldNow }));
    const callsAfterFirst = fetchImpl.mock.calls.length;

    const newNow = () => new Date("2026-07-02T00:00:00Z"); // >30 days later
    await fetchArticleFacts("Aging Topic", withFetch(fetchImpl, { now: newNow }));
    expect(fetchImpl.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });

  it("caches a miss (article does not exist) so a bounded batch never re-probes it", async () => {
    const fetchImpl = fakeFetch(() => missingPage());
    const now = () => new Date("2026-07-02T00:00:00Z");
    await fetchArticleFacts("Ghost Topic", withFetch(fetchImpl, { now }));
    const callsAfterFirst = fetchImpl.mock.calls.length;
    const second = await fetchArticleFacts("Ghost Topic", withFetch(fetchImpl, { now }));
    expect(second.exists).toBe(false);
    expect(fetchImpl.mock.calls.length).toBe(callsAfterFirst);
  });
});
