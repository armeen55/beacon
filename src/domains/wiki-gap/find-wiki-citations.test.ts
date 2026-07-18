import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  findWikiCitations,
  isWikipediaDomain,
  wikiArticleTitleFromUrl,
  humanizeWikiTitle,
  type FindWikiCitationsDeps,
} from "./find-wiki-citations";

describe("isWikipediaDomain", () => {
  it("matches the bare domain and language subdomains", () => {
    expect(isWikipediaDomain("wikipedia.org")).toBe(true);
    expect(isWikipediaDomain("en.wikipedia.org")).toBe(true);
    expect(isWikipediaDomain("fa.wikipedia.org")).toBe(true);
    expect(isWikipediaDomain("www.wikipedia.org")).toBe(true);
  });

  it("does not match other wikimedia-family or lookalike domains", () => {
    expect(isWikipediaDomain("wikimedia.org")).toBe(false);
    expect(isWikipediaDomain("wiktionary.org")).toBe(false);
    expect(isWikipediaDomain("notwikipedia.org")).toBe(false);
    expect(isWikipediaDomain(null)).toBe(false);
    expect(isWikipediaDomain(undefined)).toBe(false);
    expect(isWikipediaDomain("")).toBe(false);
  });
});

describe("wikiArticleTitleFromUrl", () => {
  it("extracts the article title from a standard /wiki/ path", () => {
    expect(wikiArticleTitleFromUrl("https://en.wikipedia.org/wiki/Chaharshanbe_Suri")).toBe("Chaharshanbe_Suri");
  });

  it("decodes percent-encoded titles", () => {
    expect(wikiArticleTitleFromUrl("https://en.wikipedia.org/wiki/Nowruz%20traditions")).toBe("Nowruz traditions");
  });

  it("works without a scheme", () => {
    expect(wikiArticleTitleFromUrl("en.wikipedia.org/wiki/Persian_cheetah")).toBe("Persian_cheetah");
  });

  it("returns null for non-Wikipedia domains", () => {
    expect(wikiArticleTitleFromUrl("https://example.com/wiki/Something")).toBeNull();
  });

  it("returns null for namespace pages (Special/Talk/Category/etc)", () => {
    expect(wikiArticleTitleFromUrl("https://en.wikipedia.org/wiki/Talk:Persia")).toBeNull();
    expect(wikiArticleTitleFromUrl("https://en.wikipedia.org/wiki/Category:Iran")).toBeNull();
    expect(wikiArticleTitleFromUrl("https://en.wikipedia.org/wiki/Special:Search")).toBeNull();
  });

  it("returns null for the bare domain or non-/wiki/ paths", () => {
    expect(wikiArticleTitleFromUrl("https://en.wikipedia.org/")).toBeNull();
    expect(wikiArticleTitleFromUrl("https://en.wikipedia.org/w/index.php?title=X")).toBeNull();
  });

  it("returns null for unparseable urls", () => {
    expect(wikiArticleTitleFromUrl("not a url at all ::")).toBeNull();
  });
});

describe("humanizeWikiTitle", () => {
  it("replaces underscores with spaces", () => {
    expect(humanizeWikiTitle("Chaharshanbe_Suri")).toBe("Chaharshanbe Suri");
  });
});

function deps(over: Partial<FindWikiCitationsDeps> = {}): Partial<FindWikiCitationsDeps> {
  return {
    now: () => new Date("2026-07-02T00:00:00Z"),
    loadObservations: async () => [],
    loadPromptTextById: async () => new Map(),
    loadProfoundCitations: async () => [],
    loadAiOverviewRows: async () => [],
    ...over,
  };
}

describe("findWikiCitations - mapping + dedupe", () => {
  it("maps a native observation's wikipedia.org citation to its article title + joined prompt text", async () => {
    const d = deps({
      loadObservations: async () => [
        {
          prompt_id: "p1",
          observed_at: "2026-06-01T00:00:00Z",
          citation_domains: ["en.wikipedia.org", "example.com"],
          citation_urls: ["https://en.wikipedia.org/wiki/Chaharshanbe_Suri", "https://example.com/x"],
        },
      ],
      loadPromptTextById: async () => new Map([["p1", "what is chaharshanbe suri"]]),
    });
    const hits = await findWikiCitations("tenant-x", d);
    expect(hits).toHaveLength(1);
    expect(hits[0].articleTitle).toBe("Chaharshanbe_Suri");
    expect(hits[0].queryText).toBe("what is chaharshanbe suri");
    expect(hits[0].source).toBe("native_observation");
  });

  it("ignores non-wikipedia citations even when Wikipedia is also cited in the same row", async () => {
    const d = deps({
      loadObservations: async () => [
        {
          prompt_id: "p1",
          observed_at: "2026-06-01T00:00:00Z",
          citation_domains: ["competitor.com"],
          citation_urls: ["https://competitor.com/page"],
        },
      ],
    });
    const hits = await findWikiCitations("tenant-x", d);
    expect(hits).toHaveLength(0);
  });

  it("maps a profound_citation_rows sighting using category_id as the honest fallback topic (no prompt text)", async () => {
    const d = deps({
      loadProfoundCitations: async () => [
        { url: "https://en.wikipedia.org/wiki/Persian_cheetah", root_domain: "en.wikipedia.org", category_id: "wildlife", date: "2026-06-10" },
      ],
    });
    const hits = await findWikiCitations("tenant-x", d);
    expect(hits).toHaveLength(1);
    expect(hits[0].articleTitle).toBe("Persian_cheetah");
    expect(hits[0].queryText).toBe("wildlife");
    expect(hits[0].source).toBe("profound_citation");
  });

  it("maps an AI Overview history row's cited wikipedia domain to its REAL query text", async () => {
    const d = deps({
      loadAiOverviewRows: async () => [
        {
          query: "chaharshanbe soori meaning",
          capturedAt: "2026-06-15T00:00:00Z",
          aiOverviewPresent: true,
          aiOverviewDomains: [{ domain: "en.wikipedia.org", url: "https://en.wikipedia.org/wiki/Chaharshanbe_Suri" }],
        },
      ],
    });
    const hits = await findWikiCitations("tenant-x", d);
    expect(hits).toHaveLength(1);
    expect(hits[0].queryText).toBe("chaharshanbe soori meaning");
    expect(hits[0].source).toBe("ai_overview");
  });

  it("skips AI Overview rows where no overview rendered", async () => {
    const d = deps({
      loadAiOverviewRows: async () => [
        {
          query: "some query",
          capturedAt: "2026-06-15T00:00:00Z",
          aiOverviewPresent: false,
          aiOverviewDomains: [{ domain: "en.wikipedia.org", url: "https://en.wikipedia.org/wiki/Something" }],
        },
      ],
    });
    const hits = await findWikiCitations("tenant-x", d);
    expect(hits).toHaveLength(0);
  });

  it("dedupes the SAME article across sources, keeping the longest/most-specific query text", async () => {
    const d = deps({
      loadObservations: async () => [
        {
          prompt_id: "p1",
          observed_at: "2026-06-01T00:00:00Z",
          citation_domains: ["en.wikipedia.org"],
          citation_urls: ["https://en.wikipedia.org/wiki/Chaharshanbe_Suri"],
        },
      ],
      loadPromptTextById: async () => new Map([["p1", "short"]]),
      loadProfoundCitations: async () => [
        { url: "https://en.wikipedia.org/wiki/Chaharshanbe_Suri", root_domain: "en.wikipedia.org", category_id: "a much longer topic label", date: "2026-06-02" },
      ],
    });
    const hits = await findWikiCitations("tenant-x", d);
    expect(hits).toHaveLength(1);
    expect(hits[0].queryText).toBe("a much longer topic label");
  });

  it("never throws when a source loader rejects - degrades to fewer hits", async () => {
    const d = deps({
      loadObservations: async () => {
        throw new Error("boom");
      },
      loadAiOverviewRows: async () => [
        {
          query: "still works",
          capturedAt: "2026-06-15T00:00:00Z",
          aiOverviewPresent: true,
          aiOverviewDomains: [{ domain: "en.wikipedia.org", url: "https://en.wikipedia.org/wiki/Still_Works" }],
        },
      ],
    });
    const hits = await findWikiCitations("tenant-x", d);
    expect(hits).toHaveLength(1);
    expect(hits[0].articleTitle).toBe("Still_Works");
  });

  it("returns [] with no sources present", async () => {
    const hits = await findWikiCitations("tenant-x", deps());
    expect(hits).toEqual([]);
  });
});

// Findings B + C (2026-07-18): the prompt-text join must be tenant-scoped.
// The prior code read the GLOBAL prompt-library singleton (Ritz's questions
// leaked into Iranopedia's miner) plus a BARE getRepository().getTrackedPrompts()
// (an unscoped select *). Both are gone; the join now goes through
// loadPromptTextById(tenantId), which the default wires to
// getRepository().forTenant(tenantId).getTrackedPrompts().
describe("findWikiCitations - tenant-scoped prompt join (findings B/C)", () => {
  it("forwards the caller's tenantId to loadPromptTextById (no shared corpus)", async () => {
    const seenTenants: string[] = [];
    const d = deps({
      loadObservations: async () => [
        {
          prompt_id: "p1",
          observed_at: "2026-06-01T00:00:00Z",
          citation_domains: ["en.wikipedia.org"],
          citation_urls: ["https://en.wikipedia.org/wiki/Nowruz"],
        },
      ],
      loadPromptTextById: async (tenantId) => {
        seenTenants.push(tenantId);
        return new Map([["p1", `question owned by ${tenantId}`]]);
      },
    });
    const hits = await findWikiCitations("tenant-iranopedia", d);
    expect(seenTenants).toEqual(["tenant-iranopedia"]);
    expect(hits[0].queryText).toBe("question owned by tenant-iranopedia");
  });

  it("tenant A and tenant B each resolve their OWN prompt text (isolation)", async () => {
    const perTenant: Record<string, Map<string, string>> = {
      "tenant-a": new Map([["p1", "A question"]]),
      "tenant-b": new Map([["p1", "B question"]]),
    };
    const makeDeps = () =>
      deps({
        loadObservations: async () => [
          {
            prompt_id: "p1",
            observed_at: "2026-06-01T00:00:00Z",
            citation_domains: ["en.wikipedia.org"],
            citation_urls: ["https://en.wikipedia.org/wiki/Nowruz"],
          },
        ],
        loadPromptTextById: async (tenantId) => perTenant[tenantId] ?? new Map(),
      });
    const aHits = await findWikiCitations("tenant-a", makeDeps());
    const bHits = await findWikiCitations("tenant-b", makeDeps());
    expect(aHits[0].queryText).toBe("A question");
    expect(bHits[0].queryText).toBe("B question");
  });
});

// Guard: never call the module's real defaults during tests (no live Supabase).
describe("findWikiCitations - safety", () => {
  it("is a plain async function that accepts injected deps (never touches vi.mock internals)", () => {
    expect(typeof findWikiCitations).toBe("function");
    expect(vi.isMockFunction(findWikiCitations)).toBe(false);
  });

  it("source no longer imports the GLOBAL prompt-library singleton (finding B)", () => {
    const src = readFileSync(resolve(__dirname, "find-wiki-citations.ts"), "utf-8");
    expect(src).not.toContain('from "@/domains/prompts/prompt-library"');
    expect(src).not.toContain("getPromptLibrary(");
    // The tenant-scoped seam must be present.
    expect(src).toContain("forTenant(tenantId).getTrackedPrompts()");
  });
});
