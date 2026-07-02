import { describe, it, expect } from "vitest";

import { parseDataForSeoSerp, parseFeaturedSnippet, parsePaaQuestions, buildSerpHistoryRow } from "./dataforseo-serp";
import type { SerpSnapshot } from "./serp-provider";

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

  it("derives the owner domain from the url when domain is absent", () => {
    const parsed = parseFeaturedSnippet({
      type: "featured_snippet",
      url: "https://www.smallblog.com/iran-flag",
      description: "text",
    });
    expect(parsed?.ownerDomain).toBe("smallblog.com");
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

  it("detects a table format from a populated table array even without featured_snippet_type", () => {
    const parsed = parseFeaturedSnippet({
      type: "featured_snippet",
      url: "https://example.com/table",
      domain: "example.com",
      table: [{ row: 1 }],
      description: "a table of facts",
    });
    expect(parsed?.format).toBe("table");
  });

  it("detects a list format from populated items when featured_snippet_type is absent", () => {
    const parsed = parseFeaturedSnippet({
      type: "featured_snippet",
      url: "https://example.com/items",
      domain: "example.com",
      items: [{ text: "one" }, { text: "two" }],
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

  it("falls back to title when description/text are absent", () => {
    const parsed = parseFeaturedSnippet({
      type: "featured_snippet",
      url: "https://example.com/x",
      domain: "example.com",
      title: "Just a title",
    });
    expect(parsed?.textExcerpt).toBe("Just a title");
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

  it("derives the answer domain from the url when domain is absent", () => {
    const out = parsePaaQuestions([
      { title: "Q", expanded_element: [{ url: "https://www.example.org/a" }] },
    ]);
    expect(out).toEqual([{ question: "Q", answerDomain: "example.org" }]);
  });

  it("skips blank questions", () => {
    const out = parsePaaQuestions([{ title: "" }, { question: "  " }, { title: "Real question" }]);
    expect(out).toEqual([{ question: "Real question" }]);
  });

  it("accepts the alternate question field name", () => {
    const out = parsePaaQuestions([{ question: "Alt field question" }]);
    expect(out).toEqual([{ question: "Alt field question" }]);
  });
});

describe("parseDataForSeoSerp wiring (item 25)", () => {
  const nowIso = "2026-07-02T00:00:00.000Z";

  it("carries snippetOwner=null and paaQuestions=[] when neither feature renders (absent-feature fixture)", () => {
    const body = {
      tasks: [{ result: [{ items: [{ type: "organic", url: "https://iranopedia.com/iran-flag", title: "Iran Flag" }] }] }],
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
                { type: "organic", url: "https://iranopedia.com/iran-flag", title: "Iran Flag" },
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
    results: [{ rank: 4, url: "https://iranopedia.com/iran-flag", title: "Iran Flag", domain: "iranopedia.com" }],
    features: ["featured_snippet"],
    source: "dataforseo",
    fetchedAt: "2026-07-02T00:00:00.000Z",
  };

  it("defaults to snippet_owner=null and paa_questions=[] when omitted (backfill-script safe)", () => {
    const row = buildSerpHistoryRow({
      tenantId: "tenant-iranopedia",
      query: "iran flag",
      location: "2840|en",
      snapshot,
      tenantDomain: "iranopedia.com",
      capturedAt: "2026-07-02T00:00:00.000Z",
      costUsd: 0.003,
    });
    expect(row.snippet_owner).toBeNull();
    expect(row.paa_questions).toEqual([]);
  });

  it("persists a real snippet owner + PAA questions when provided", () => {
    const row = buildSerpHistoryRow({
      tenantId: "tenant-iranopedia",
      query: "iran flag",
      location: "2840|en",
      snapshot,
      tenantDomain: "iranopedia.com",
      capturedAt: "2026-07-02T00:00:00.000Z",
      costUsd: 0.003,
      snippetOwner: { ownerDomain: "smallblog.com", ownerUrl: "https://smallblog.com/x", textExcerpt: "text", format: "paragraph" },
      paaQuestions: [{ question: "Q1" }, { question: "Q2", answerDomain: "otherblog.com" }],
    });
    expect(row.snippet_owner).toEqual({ ownerDomain: "smallblog.com", ownerUrl: "https://smallblog.com/x", textExcerpt: "text", format: "paragraph" });
    expect(row.paa_questions).toEqual([{ question: "Q1" }, { question: "Q2", answerDomain: "otherblog.com" }]);
  });
});
