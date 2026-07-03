/**
 * N40 contract test - DataForSEO Google organic live/advanced SERP.
 *
 * Feeds a checked-in fixture of the REAL response body (tasks[0].result[0]
 * .items with organic / ai_overview / featured_snippet / people_also_ask
 * items) through the ACTUAL parser (parseDataForSeoSerp - the exact function
 * runSerpQuery calls on every paid read), so a silent upstream change fails
 * a named test here instead of surfacing as empty SERP evidence on paid-for
 * calls. NO live calls, $0.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parseDataForSeoSerp, resolveOwnRank } from "@/domains/serp/dataforseo-serp";

const NOW_ISO = "2026-07-03T12:00:00.000Z";

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(resolve(__dirname, "fixtures", name), "utf-8"));
}

describe("DataForSEO SERP items contract", () => {
  const parsed = parseDataForSeoSerp("koobideh kabob", fixture("dataforseo-serp.json"), NOW_ISO);

  it("ranks organic items in order with www-stripped domains", () => {
    expect(parsed.results).toHaveLength(3);
    expect(parsed.organicItems.map((i) => i.rank)).toEqual([1, 2, 3]);
    expect(parsed.organicItems[0]).toEqual({
      rank: 1,
      domain: "seriouseats.com",
      url: "https://www.seriouseats.com/kabab-koobideh",
    });
    // Every result carries a non-empty title + url.
    for (const r of parsed.results) {
      expect(r.url).toMatch(/^https:\/\//);
      expect(r.title.length).toBeGreaterThan(0);
    }
  });

  it("detects the SERP features present in the body", () => {
    expect(parsed.features).toEqual(
      expect.arrayContaining(["ai_overview", "featured_snippet", "people_also_ask"]),
    );
  });

  it("parses the AI Overview: top-level references only, normalized domains, bounded excerpt", () => {
    expect(parsed.aiOverview.present).toBe(true);
    // 3 raw references -> 2 kept (the url-less one dropped); nested per-element
    // references are NEVER double-counted.
    expect(parsed.aiOverview.citedDomains).toHaveLength(2);
    expect(parsed.aiOverview.citedDomains[0]).toMatchObject({
      domain: "seriouseats.com",
      position: 1,
    });
    expect(parsed.aiOverview.citedDomains[1]).toMatchObject({
      domain: "iranopedia.com",
      position: 2,
    });
    expect(parsed.aiOverview.overviewTextExcerpt.length).toBeGreaterThan(0);
    expect(parsed.aiOverview.overviewTextExcerpt.length).toBeLessThanOrEqual(300);
  });

  it("parses the featured-snippet owner + format", () => {
    expect(parsed.snippetOwner).toMatchObject({
      ownerDomain: "thecaspianchef.com",
      ownerUrl: "https://www.thecaspianchef.com/koobideh-kabob",
      format: "paragraph",
    });
    expect(parsed.snippetOwner!.textExcerpt).toContain("ground lamb");
  });

  it("parses People Also Ask questions with the answering domain when expanded", () => {
    expect(parsed.paaQuestions).toHaveLength(2);
    expect(parsed.paaQuestions[0]).toEqual({
      question: "What is koobideh made of?",
      answerDomain: "iranopedia.com",
    });
    // No expanded answer -> no answerDomain (never guessed).
    expect(parsed.paaQuestions[1]).toEqual({
      question: "Why does my koobideh fall off the skewer?",
    });
  });

  it("resolves the tenant's own rank from the parsed items", () => {
    expect(resolveOwnRank(parsed.organicItems, "iranopedia.com")).toEqual({
      ownRank: 2,
      ownUrl: "https://www.iranopedia.com/koobideh-kabob",
    });
  });

  it("a malformed body parses to the honest empty shape, never throws", () => {
    const empty = parseDataForSeoSerp("q", { tasks: "not-an-array" }, NOW_ISO);
    expect(empty.results).toEqual([]);
    expect(empty.aiOverview.present).toBe(false);
    expect(empty.snippetOwner).toBeNull();
    expect(empty.paaQuestions).toEqual([]);
  });
});
