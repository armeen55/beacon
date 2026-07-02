/**
 * citability-hints tests (2026-07-02, master plan item 26) - pins the "make
 * it quotable" lever join: only crawled_not_cited / cited_no_clicks pages
 * qualify (never never_crawled or converting), only pages scoring below
 * threshold get a hint, the feed is bounded to 2/night, and the evidence
 * line matches the exact deliverable-4 wording contract.
 */
import { describe, it, expect } from "vitest";
import { buildCitabilityHint, buildCitabilityHintNotes, MAX_CITABILITY_HINTS_PER_NIGHT, CITABILITY_SCORE_THRESHOLD } from "./citability-hints";
import type { PageFunnel, FunnelStage } from "@/domains/ai-visibility/crawl-citation-funnel";

const QUOTABLE_TEXT = [
  "Over 60 percent of Iranian households set a Haft-Sin table for Nowruz.",
  "Haft-Sin is a symbolic table of seven items representing renewal.",
  "According to UNESCO, the tradition dates back more than 3000 years.",
].join(" ");

const PLAIN_TEXT = [
  "Nowruz is a wonderful time of year for families.",
  "People enjoy spending time together and eating good food.",
  "The celebrations bring communities closer.",
].join(" ");

describe("buildCitabilityHint", () => {
  it("returns null for a never_crawled page (different fix: internal links, not rewriting)", () => {
    const hint = buildCitabilityHint({ pagePath: "/nowruz", funnelStage: "not_crawled", demand: 500, pageText: PLAIN_TEXT });
    expect(hint).toBeNull();
  });

  it("returns null for a converting page (already working, nothing to fix)", () => {
    const hint = buildCitabilityHint({ pagePath: "/nowruz", funnelStage: "converting", demand: 500, pageText: PLAIN_TEXT });
    expect(hint).toBeNull();
  });

  it("returns null for a no_signal page (no evidence either way)", () => {
    const hint = buildCitabilityHint({ pagePath: "/nowruz", funnelStage: "no_signal", demand: 500, pageText: PLAIN_TEXT });
    expect(hint).toBeNull();
  });

  it("returns null when the page already scores at or above the threshold", () => {
    const hint = buildCitabilityHint({ pagePath: "/nowruz", funnelStage: "crawled_not_cited", demand: 500, pageText: QUOTABLE_TEXT });
    expect(hint).toBeNull();
  });

  it("returns null with zero demand (no proven searcher interest to justify the rewrite)", () => {
    const hint = buildCitabilityHint({ pagePath: "/nowruz", funnelStage: "crawled_not_cited", demand: 0, pageText: PLAIN_TEXT });
    expect(hint).toBeNull();
  });

  it("fires for a crawled_not_cited page with demand and a low-scoring text", () => {
    const hint = buildCitabilityHint({ pagePath: "/nowruz", funnelStage: "crawled_not_cited", demand: 500, pageText: PLAIN_TEXT });
    expect(hint).not.toBeNull();
    expect(hint!.score).toBeLessThan(CITABILITY_SCORE_THRESHOLD);
    expect(hint!.funnelStage).toBe("crawled_not_cited");
    expect(hint!.topFixes.length).toBeGreaterThan(0);
  });

  it("fires for a cited_no_clicks page too (AI cites it but visitors do not convert)", () => {
    const hint = buildCitabilityHint({ pagePath: "/nowruz", funnelStage: "cited_no_clicks", demand: 200, pageText: PLAIN_TEXT });
    expect(hint).not.toBeNull();
  });

  it("carries the exact deliverable-4 evidence line", () => {
    const hint = buildCitabilityHint({ pagePath: "/nowruz", funnelStage: "crawled_not_cited", demand: 500, pageText: PLAIN_TEXT });
    expect(hint!.evidenceLine).toBe(
      "AI reads this page but never quotes it. The pages AI does quote lead with numbers and plain definitions; this one does neither.",
    );
  });

  it("sentence names the actual missing patterns, honest to the rubric output", () => {
    const hint = buildCitabilityHint({ pagePath: "/nowruz", funnelStage: "crawled_not_cited", demand: 500, pageText: PLAIN_TEXT });
    expect(hint!.sentence).toContain("AI already reaches this page");
    expect(hint!.sentence).not.toMatch(/[–—]/);
  });
});

function funnelPage(over: Partial<PageFunnel> = {}): PageFunnel {
  return {
    pagePath: "/nowruz",
    crawled: { count: 10, lastAt: "2026-06-30", bots: [] },
    cited: { count: 0, prompts: 0, lastAt: null },
    aiClicks: { sessions: 0, keyEvents: 0, topSource: null },
    demand: 500,
    stage: "crawled_not_cited",
    bottleneckSentence: "test fixture",
    ...over,
  };
}

describe("buildCitabilityHintNotes", () => {
  it("is bounded to MAX_CITABILITY_HINTS_PER_NIGHT even with many qualifying pages", () => {
    const pages = Array.from({ length: 5 }, (_, i) => funnelPage({ pagePath: `/page-${i}` }));
    const textByPath = new Map(pages.map((p) => [p.pagePath, PLAIN_TEXT]));
    const out = buildCitabilityHintNotes({ stalled: pages }, textByPath);
    expect(out.size).toBe(MAX_CITABILITY_HINTS_PER_NIGHT);
  });

  it("keeps the funnel's own demand-first ordering (first N win)", () => {
    const pages = [funnelPage({ pagePath: "/a" }), funnelPage({ pagePath: "/b" }), funnelPage({ pagePath: "/c" })];
    const textByPath = new Map(pages.map((p) => [p.pagePath, PLAIN_TEXT]));
    const out = buildCitabilityHintNotes({ stalled: pages }, textByPath, 2);
    expect([...out.keys()]).toEqual(["/a", "/b"]);
  });

  it("skips a page with no cached text (nothing to score, never guess)", () => {
    const pages = [funnelPage({ pagePath: "/no-text" })];
    const out = buildCitabilityHintNotes({ stalled: pages }, new Map());
    expect(out.size).toBe(0);
  });

  it("skips pages already converting or never crawled, even if they are in stalled (defense in depth)", () => {
    const pages = [funnelPage({ pagePath: "/never", stage: "not_crawled" }), funnelPage({ pagePath: "/ok", stage: "converting" })];
    const textByPath = new Map(pages.map((p) => [p.pagePath, PLAIN_TEXT]));
    const out = buildCitabilityHintNotes({ stalled: pages }, textByPath);
    expect(out.size).toBe(0);
  });

  it("skips a page already scoring above the threshold", () => {
    const pages = [funnelPage({ pagePath: "/good" })];
    const textByPath = new Map([["/good", QUOTABLE_TEXT]]);
    const out = buildCitabilityHintNotes({ stalled: pages }, textByPath);
    expect(out.size).toBe(0);
  });

  it("one hint per page (first wins, no duplicate keys)", () => {
    const pages = [funnelPage({ pagePath: "/dup" }), funnelPage({ pagePath: "/dup" })];
    const textByPath = new Map([["/dup", PLAIN_TEXT]]);
    const out = buildCitabilityHintNotes({ stalled: pages }, textByPath);
    expect(out.size).toBe(1);
  });

  it("normalizes page paths the same way the rest of the daily plan pipeline does", () => {
    const pages = [funnelPage({ pagePath: "https://iranopedia.com/Nowruz/" })];
    const textByPath = new Map([["/nowruz", PLAIN_TEXT]]);
    const out = buildCitabilityHintNotes({ stalled: pages }, textByPath);
    expect(out.has("/nowruz")).toBe(true);
  });

  it("returns an empty map when stalled is empty", () => {
    const out = buildCitabilityHintNotes({ stalled: [] }, new Map());
    expect(out.size).toBe(0);
  });
});

describe("FunnelStage coverage (documentation pin)", () => {
  it("the funnel defines exactly the 5 stages this lever's TARGET_STAGES logic depends on", () => {
    const stages: FunnelStage[] = ["not_crawled", "crawled_not_cited", "cited_no_clicks", "converting", "no_signal"];
    for (const stage of stages) {
      const hint = buildCitabilityHint({ pagePath: "/x", funnelStage: stage, demand: 500, pageText: PLAIN_TEXT });
      if (stage === "crawled_not_cited" || stage === "cited_no_clicks") {
        expect(hint).not.toBeNull();
      } else {
        expect(hint).toBeNull();
      }
    }
  });
});
