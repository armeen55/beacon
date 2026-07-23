/**
 * SOURCES — DataForSEO provider boundaries (Core 100K lane S merge).
 * Spend-cap / dry-run fail-closed pins survive here per the risk register.
 */
import { describe, it, expect, vi } from "vitest";

import { parseDataForSeoSerp, parseFeaturedSnippet, parsePaaQuestions, buildSerpHistoryRow } from "@/domains/evidence/readers/dataforseo-serp";
import type { SerpSnapshot } from "@/domains/evidence/readers/serp-provider";

/**
 * BEACON_500 item 25: featured-snippet owner + PAA question capture, at $0 added
 * spend (same response body the organic/AI-Overview parsing already reads).
 */

describe("parseFeaturedSnippet", () => {
  it("returns null for absent/malformed input", () => {
    expect(parseFeaturedSnippet(null)).toBeNull();
    expect(parseFeaturedSnippet(undefined)).toBeNull();
    expect(parseFeaturedSnippet({})).toBeNull();
    expect(parseFeaturedSnippet({ type: "organic", url: "https://example.com" })).toBeNull();
  });

  it("returns null when the item has no url", () => {
    expect(parseFeaturedSnippet({ type: "featured_snippet", description: "hello" })).toBeNull();
  });

  it("parses a paragraph snippet (default format)", () => {
    const parsed = parseFeaturedSnippet({
      type: "featured_snippet",
      url: "https://smallblog.com/iran-flag",
      domain: "smallblog.com",
      title: "Iran Flag",
      description: "The flag of Iran has three horizontal bands of green, white, and red.",
    });
    expect(parsed).toEqual({
      ownerDomain: "smallblog.com",
      ownerUrl: "https://smallblog.com/iran-flag",
      textExcerpt: "The flag of Iran has three horizontal bands of green, white, and red.",
      format: "paragraph",
    });
  });


  it("detects a list format from featured_snippet_type", () => {
    const parsed = parseFeaturedSnippet({
      type: "featured_snippet",
      url: "https://example.com/list",
      domain: "example.com",
      featured_snippet_type: "list",
      description: "step one, step two",
    });
    expect(parsed?.format).toBe("list");
  });



  it("truncates the text excerpt to 300 chars with an ellipsis", () => {
    const longText = "a".repeat(400);
    const parsed = parseFeaturedSnippet({
      type: "featured_snippet",
      url: "https://example.com/long",
      domain: "example.com",
      description: longText,
    });
    expect(parsed?.textExcerpt.length).toBe(300);
    expect(parsed?.textExcerpt.endsWith("...")).toBe(true);
  });

});

describe("parsePaaQuestions", () => {
  it("returns [] for absent/malformed input", () => {
    expect(parsePaaQuestions(null)).toEqual([]);
    expect(parsePaaQuestions(undefined)).toEqual([]);
    expect(parsePaaQuestions("not an array")).toEqual([]);
    expect(parsePaaQuestions([])).toEqual([]);
  });

  it("parses questions without an expanded answer", () => {
    const out = parsePaaQuestions([{ title: "What is the Iran flag?" }, { title: "When was it adopted?" }]);
    expect(out).toEqual([{ question: "What is the Iran flag?" }, { question: "When was it adopted?" }]);
  });

  it("parses the answering domain when an expanded_element is present", () => {
    const out = parsePaaQuestions([
      {
        title: "What is the Iran flag?",
        expanded_element: [{ url: "https://smallblog.com/answer", domain: "smallblog.com" }],
      },
    ]);
    expect(out).toEqual([{ question: "What is the Iran flag?", answerDomain: "smallblog.com" }]);
  });



});

describe("parseDataForSeoSerp wiring (item 25)", () => {
  const nowIso = "2026-07-02T00:00:00.000Z";

  it("carries snippetOwner=null and paaQuestions=[] when neither feature renders (absent-feature fixture)", () => {
    const body = {
      tasks: [{ result: [{ items: [{ type: "organic", url: "https://fixture-content.example/iran-flag", title: "Iran Flag" }] }] }],
    };
    const parsed = parseDataForSeoSerp("iran flag", body, nowIso);
    expect(parsed.snippetOwner).toBeNull();
    expect(parsed.paaQuestions).toEqual([]);
    expect(parsed.features).not.toContain("featured_snippet");
    expect(parsed.features).not.toContain("people_also_ask");
  });

  it("captures the featured snippet owner + PAA questions from the same response body", () => {
    const body = {
      tasks: [
        {
          result: [
            {
              items: [
                {
                  type: "featured_snippet",
                  url: "https://smallblog.com/iran-flag",
                  domain: "smallblog.com",
                  description: "The Iran flag has three bands.",
                },
                {
                  type: "people_also_ask",
                  items: [
                    { title: "What do the colors mean?", expanded_element: [{ url: "https://otherblog.com/colors", domain: "otherblog.com" }] },
                    { title: "When was it adopted?" },
                  ],
                },
                { type: "organic", url: "https://fixture-content.example/iran-flag", title: "Iran Flag" },
              ],
            },
          ],
        },
      ],
    };
    const parsed = parseDataForSeoSerp("iran flag", body, nowIso);
    expect(parsed.features).toContain("featured_snippet");
    expect(parsed.features).toContain("people_also_ask");
    expect(parsed.snippetOwner).toEqual({
      ownerDomain: "smallblog.com",
      ownerUrl: "https://smallblog.com/iran-flag",
      textExcerpt: "The Iran flag has three bands.",
      format: "paragraph",
    });
    expect(parsed.paaQuestions).toEqual([
      { question: "What do the colors mean?", answerDomain: "otherblog.com" },
      { question: "When was it adopted?" },
    ]);
  });

  it("never throws on a malformed body and stays honest (null/[])", () => {
    const parsed = parseDataForSeoSerp("x", { not: "expected shape" }, nowIso);
    expect(parsed.snippetOwner).toBeNull();
    expect(parsed.paaQuestions).toEqual([]);
    expect(parsed.results).toEqual([]);
  });
});

describe("buildSerpHistoryRow wiring (item 25)", () => {
  const snapshot: SerpSnapshot = {
    query: "iran flag",
    results: [{ rank: 4, url: "https://fixture-content.example/iran-flag", title: "Iran Flag", domain: "fixture-content.example" }],
    features: ["featured_snippet"],
    source: "dataforseo",
    fetchedAt: "2026-07-02T00:00:00.000Z",
  };

  it("defaults to snippet_owner=null and paa_questions=[] when omitted (backfill-script safe)", () => {
    const row = buildSerpHistoryRow({
      tenantId: "tenant-fixture-content",
      query: "iran flag",
      location: "2840|en",
      snapshot,
      tenantDomain: "fixture-content.example",
      capturedAt: "2026-07-02T00:00:00.000Z",
      costUsd: 0.003,
    });
    expect(row.snippet_owner).toBeNull();
    expect(row.paa_questions).toEqual([]);
  });

  it("persists a real snippet owner + PAA questions when provided", () => {
    const row = buildSerpHistoryRow({
      tenantId: "tenant-fixture-content",
      query: "iran flag",
      location: "2840|en",
      snapshot,
      tenantDomain: "fixture-content.example",
      capturedAt: "2026-07-02T00:00:00.000Z",
      costUsd: 0.003,
      snippetOwner: { ownerDomain: "smallblog.com", ownerUrl: "https://smallblog.com/x", textExcerpt: "text", format: "paragraph" },
      paaQuestions: [{ question: "Q1" }, { question: "Q2", answerDomain: "otherblog.com" }],
    });
    expect(row.snippet_owner).toEqual({ ownerDomain: "smallblog.com", ownerUrl: "https://smallblog.com/x", textExcerpt: "text", format: "paragraph" });
    expect(row.paa_questions).toEqual([{ question: "Q1" }, { question: "Q2", answerDomain: "otherblog.com" }]);
  });
});


import { runSerpQuery, type SerpRunDeps } from "@/domains/evidence/readers/dataforseo-serp";

/**
 * Item 19: forceFresh is a minimal, additive bypass of the 14-day cache on
 * runSerpQuery - used by the rank re-check pass so a day-7/14/28 "now" read is
 * never served a stale cached snapshot from before the ship. The full safety
 * gauntlet (configured / dry-run / cap / ledger) still applies; ONLY the cache
 * read is skipped.
 */

const okSnapshot: SerpSnapshot = {
  query: "persian singers",
  results: [{ rank: 4, url: "https://fixture-content.example/singers", title: "Singers", domain: "fixture-content.example" }],
  features: [],
  source: "dataforseo",
  fetchedAt: "2026-06-08T00:00:00.000Z",
};

function baseDeps(overrides: Partial<SerpRunDeps> = {}): Partial<SerpRunDeps> {
  return {
    env: { ...process.env, BEACON_SERP_PROVIDER: "dataforseo", DATAFORSEO_AUTH_B64: "abc123", DATAFORSEO_DRY_RUN: "false" },
    now: () => new Date("2026-06-08T00:00:00Z"),
    tenantId: async () => "tenant-fixture-content",
    spentThisMonthUsd: async () => 0,
    recordSpend: async () => {},
    readCache: async () => [{ key: "2840|en|persian singers", snapshot: okSnapshot, fetchedAt: "2026-06-07T00:00:00Z" }],
    writeCache: async () => {},
    tenantDomain: async () => "fixture-content.example",
    appendHistory: async () => {},
    ...overrides,
  };
}

describe("runSerpQuery - forceFresh cache bypass (item 19)", () => {
  it("serves the cache hit by default (no forceFresh)", async () => {
    const fetchImpl = vi.fn();
    const result = await runSerpQuery("persian singers", {}, baseDeps({ fetchImpl: fetchImpl as unknown as typeof fetch }));
    expect(result.status).toBe("cache_hit");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("skips the cache and fetches when forceFresh is true", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({ tasks: [{ result: [{ items: [{ type: "organic", url: "https://fixture-content.example/singers", title: "Singers" }] }] }] }),
        { status: 200 },
      ),
    );
    const result = await runSerpQuery(
      "persian singers",
      { forceFresh: true },
      baseDeps({ fetchImpl: fetchImpl as unknown as typeof fetch }),
    );
    expect(result.status).toBe("ok");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("still honors dry-run even with forceFresh - never spends", async () => {
    const fetchImpl = vi.fn();
    const result = await runSerpQuery(
      "persian singers",
      { forceFresh: true },
      baseDeps({
        env: { ...process.env, BEACON_SERP_PROVIDER: "dataforseo", DATAFORSEO_AUTH_B64: "abc123", DATAFORSEO_DRY_RUN: "true" },
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    );
    expect(result.status).toBe("dry_run");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("still honors the hard monthly cap even with forceFresh - fails closed", async () => {
    const fetchImpl = vi.fn();
    const result = await runSerpQuery(
      "persian singers",
      { forceFresh: true },
      baseDeps({
        spentThisMonthUsd: async () => 1000,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    );
    expect(result.status).toBe("capped");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("still reports disabled when not configured, even with forceFresh", async () => {
    const result = await runSerpQuery(
      "persian singers",
      { forceFresh: true },
      baseDeps({
        env: { ...process.env, BEACON_SERP_PROVIDER: undefined, DATAFORSEO_AUTH_B64: undefined, DATAFORSEO_LOGIN: undefined },
      }),
    );
    expect(result.status).toBe("disabled");
  });
});
