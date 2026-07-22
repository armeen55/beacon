/**
 * 2026-07-02 - crawl-to-citation-to-revenue funnel tests (BEACON_500 item 7).
 *
 * Pins src/domains/ai-visibility/crawl-citation-funnel.ts:
 *   - stage logic: all four proven stages + the no_signal honesty state
 *   - missing-feed honesty: absent feeds soften sentences, never fabricate
 *   - buildFunnelReport join across path casings/trailing slashes + ranking
 *   - never-crawled internal-link hints: fail-closed, demand-gated, bounded
 *   - copy guard: first person, concrete numbers, no em/en dashes, no jargon
 */

import { describe, it, expect } from "vitest";
import {
  buildPageFunnel,
  buildFunnelReport,
  buildFunnelLinkHints,
  funnelPathKey,
  funnelSummaryLine,
  MIN_HINT_DEMAND,
  MAX_FUNNEL_LINK_HINTS_PER_NIGHT,
  type FunnelFeedPresence,
  type PageFunnelInputs,
} from "@/domains/ai-visibility/crawl-citation-funnel";

const ALL_FEEDS: FunnelFeedPresence = { crawl: true, cited: true, clicks: true, crawledPageCount: 42 };

function inputs(overrides: Partial<PageFunnelInputs> = {}): PageFunnelInputs {
  return {
    pagePath: "/iran-cheetah",
    crawled: { count: 0, lastAt: null, bots: [] },
    cited: { count: 0, prompts: 0, lastAt: null },
    aiClicks: { sessions: 0, keyEvents: 0, topSource: null },
    demand: 0,
    feeds: ALL_FEEDS,
    ...overrides,
  };
}

/** Beacon copy contract: no em/en dashes, no lab jargon on operator surfaces. */
function expectCleanCopy(sentence: string): void {
  expect(sentence).not.toMatch(/[‒–—―]/);
  expect(sentence).not.toMatch(/\b(experiment|control|baseline|treatment|reservation|SERP|funnel stage)\b/i);
}

describe("funnelPathKey", () => {
  it("canonicalizes origin, query, hash, trailing slash, case", () => {
    expect(funnelPathKey("https://iranopedia.com/Iran-Cheetah/?ref=x#top")).toBe("/iran-cheetah");
    expect(funnelPathKey("/iran-cheetah")).toBe("/iran-cheetah");
    expect(funnelPathKey("https://iranopedia.com/")).toBe("/");
    expect(funnelPathKey("")).toBe("/");
  });

  it("strips the schemeless host form profound_citation_rows stores (real-row finding)", () => {
    expect(funnelPathKey("iranopedia.com/famous-iranians")).toBe("/famous-iranians");
    expect(funnelPathKey("www.iranopedia.com/Nowruz/")).toBe("/nowruz");
  });
});

describe("buildPageFunnel stages", () => {
  it("converting when AI-referred sessions exist", () => {
    const f = buildPageFunnel(
      inputs({
        cited: { count: 8, prompts: 3, lastAt: "2026-06-30" },
        aiClicks: { sessions: 14, keyEvents: 2, topSource: "ChatGPT" },
      }),
    );
    expect(f.stage).toBe("converting");
    expect(f.bottleneckSentence).toContain("14 visitors");
    expect(f.bottleneckSentence).toContain("ChatGPT");
    expect(f.bottleneckSentence).toContain("cited it 8 times");
    expect(f.bottleneckSentence).toContain("2 of those visits completed a key action");
    expectCleanCopy(f.bottleneckSentence);
  });

  it("cited_no_clicks when cited but zero AI sessions", () => {
    const f = buildPageFunnel(inputs({ cited: { count: 5, prompts: 2, lastAt: "2026-06-28" } }));
    expect(f.stage).toBe("cited_no_clicks");
    expect(f.bottleneckSentence).toContain("cited this page 5 times across 2 questions");
    expect(f.bottleneckSentence).toContain("no visitor has arrived");
    expectCleanCopy(f.bottleneckSentence);
  });

  it("crawled_not_cited when crawled but zero citations", () => {
    const f = buildPageFunnel(
      inputs({ crawled: { count: 9, lastAt: "2026-06-25", bots: [{ bot: "GPTBot", hits: 9 }] } }),
    );
    expect(f.stage).toBe("crawled_not_cited");
    expect(f.bottleneckSentence).toContain("fetched this page 9 times");
    expect(f.bottleneckSentence).toContain("no AI answer cites it yet");
    expectCleanCopy(f.bottleneckSentence);
  });

  it("not_crawled when the crawler feed reports but never fetched this page", () => {
    const f = buildPageFunnel(inputs({ demand: 12400 }));
    expect(f.stage).toBe("not_crawled");
    expect(f.bottleneckSentence).toContain("12,400 times in Google");
    expect(f.bottleneckSentence).toContain("never fetched");
    expect(f.bottleneckSentence).toContain("cannot be recommended");
    expect(f.bottleneckSentence).toContain("42 of your other pages");
    expect(f.bottleneckSentence).toContain("linking to this one");
    expectCleanCopy(f.bottleneckSentence);
  });

  it("not_crawled without demand still reads honestly", () => {
    const f = buildPageFunnel(inputs());
    expect(f.stage).toBe("not_crawled");
    expect(f.bottleneckSentence).toContain("AI crawlers have never fetched this page.");
    expectCleanCopy(f.bottleneckSentence);
  });

  it("no_signal when every feed is dark: never claims never-crawled", () => {
    const f = buildPageFunnel(
      inputs({ feeds: { crawl: false, cited: false, clicks: false, crawledPageCount: 0 }, demand: 900 }),
    );
    expect(f.stage).toBe("no_signal");
    expect(f.bottleneckSentence).toContain("I have no AI crawler or citation data");
    expect(f.bottleneckSentence).not.toContain("never fetched");
    expectCleanCopy(f.bottleneckSentence);
  });
});

describe("missing-feed honesty in sentences", () => {
  it("cited page with a dark clicks feed does not claim zero visitors", () => {
    const f = buildPageFunnel(
      inputs({
        cited: { count: 7, prompts: 0, lastAt: null },
        feeds: { ...ALL_FEEDS, clicks: false },
      }),
    );
    expect(f.stage).toBe("cited_no_clicks");
    expect(f.bottleneckSentence).toContain("cannot see AI visitors yet");
    expect(f.bottleneckSentence).not.toContain("no visitor has arrived");
    expectCleanCopy(f.bottleneckSentence);
  });

  it("crawled page with a dark citation feed does not claim not-cited", () => {
    const f = buildPageFunnel(
      inputs({
        crawled: { count: 3, lastAt: null, bots: [] },
        feeds: { ...ALL_FEEDS, cited: false },
      }),
    );
    expect(f.stage).toBe("crawled_not_cited");
    expect(f.bottleneckSentence).toContain("no citation data yet");
    expect(f.bottleneckSentence).not.toContain("no AI answer cites it");
    expectCleanCopy(f.bottleneckSentence);
  });
});

describe("buildFunnelReport", () => {
  it("joins the three feeds on canonical paths and counts stages", () => {
    const report = buildFunnelReport({
      botPages: [
        { path: "/Persian-Cats/", hits: 6, lastAt: "2026-06-20", bots: [{ bot: "GPTBot", hits: 6 }] },
        { path: "/nowruz", hits: 2, lastAt: "2026-06-22", bots: [{ bot: "ClaudeBot", hits: 2 }] },
      ],
      citedPages: [{ path: "https://iranopedia.com/persian-cats", count: 4, prompts: 2, lastAt: "2026-06-29" }],
      clickPages: [{ path: "/persian-cats", sessions: 3, keyEvents: 1, topSource: "Perplexity" }],
      demandByPath: new Map([
        ["/persian-cats", 500],
        ["/high-demand-orphan", 8000],
      ]),
    });
    expect(report.hasData).toBe(true);
    const cats = report.pages.find((p) => p.pagePath === "/persian-cats");
    expect(cats?.stage).toBe("converting");
    expect(cats?.crawled.count).toBe(6);
    expect(cats?.cited.count).toBe(4);
    expect(cats?.aiClicks.sessions).toBe(3);
    const nowruz = report.pages.find((p) => p.pagePath === "/nowruz");
    expect(nowruz?.stage).toBe("crawled_not_cited");
    // Crawler feed is live, so the high-demand page it never fetched joins.
    const orphan = report.pages.find((p) => p.pagePath === "/high-demand-orphan");
    expect(orphan?.stage).toBe("not_crawled");
    expect(report.stageCounts.converting).toBe(1);
    expect(report.stageCounts.crawled_not_cited).toBe(1);
    expect(report.stageCounts.not_crawled).toBe(1);
    // Stalled excludes the converting page and ranks by demand.
    expect(report.stalled.map((p) => p.pagePath)).toEqual(["/high-demand-orphan", "/nowruz"]);
  });

  it("without crawler data, demand-only pages stay OUT (no guessed crawl status)", () => {
    const report = buildFunnelReport({
      botPages: [],
      citedPages: [{ path: "/iran-cheetah", count: 10, prompts: 4, lastAt: "2026-06-30" }],
      clickPages: [],
      demandByPath: new Map([["/high-demand-orphan", 9000]]),
    });
    expect(report.feeds.crawl).toBe(false);
    expect(report.pages).toHaveLength(1);
    expect(report.pages[0].pagePath).toBe("/iran-cheetah");
    expect(report.pages[0].stage).toBe("cited_no_clicks");
  });

  it("all feeds empty -> hasData false, nothing to say", () => {
    const report = buildFunnelReport({ botPages: [], citedPages: [], clickPages: [], demandByPath: new Map() });
    expect(report.hasData).toBe(false);
    expect(report.stalled).toEqual([]);
    expect(funnelSummaryLine(report)).toBeNull();
  });
});

describe("funnelSummaryLine", () => {
  it("states the tenant-wide funnel shape with concrete counts", () => {
    const report = buildFunnelReport({
      botPages: [
        { path: "/a", hits: 5, lastAt: null, bots: [] },
        { path: "/b", hits: 1, lastAt: null, bots: [] },
      ],
      citedPages: [{ path: "/a", count: 3, prompts: 1, lastAt: null }],
      clickPages: [{ path: "/a", sessions: 2, keyEvents: 0, topSource: "ChatGPT" }],
      demandByPath: new Map(),
    });
    const line = funnelSummaryLine(report);
    expect(line).toBeTruthy();
    expect(line).toContain("I tracked 2 pages");
    expect(line).toContain("AI crawlers fetched 2");
    expect(line).toContain("AI answers cite 1");
    expect(line).toContain("1 already bring AI visitors");
    expectCleanCopy(line!);
  });
});

describe("buildFunnelLinkHints (candidate signal)", () => {
  const liveCrawlReport = () =>
    buildFunnelReport({
      botPages: [{ path: "/covered", hits: 12, lastAt: "2026-06-30", bots: [{ bot: "GPTBot", hits: 12 }] }],
      citedPages: [],
      clickPages: [],
      demandByPath: new Map([
        ["/big-orphan", 5000],
        ["/mid-orphan", 800],
        ["/small-orphan", MIN_HINT_DEMAND - 1],
        ["/covered", 300],
      ]),
    });

  it("emits demand-ranked add_internal_links hints for never-crawled pages only", () => {
    const hints = buildFunnelLinkHints(liveCrawlReport());
    expect([...hints.keys()]).toEqual(["/big-orphan", "/mid-orphan"]);
    const hint = hints.get("/big-orphan")!;
    expect(hint.actionType).toBe("add_internal_links");
    expect(hint.demand).toBe(5000);
    expect(hint.crawledPageCount).toBe(1);
    expect(hint.sentence).toContain("never this one");
    expect(hint.sentence).toContain("5,000 times in Google");
    expect(hint.sentence).toContain("Add links to it");
    expectCleanCopy(hint.sentence);
  });

  it("is bounded by the nightly limit", () => {
    const hints = buildFunnelLinkHints(liveCrawlReport(), { limit: 1 });
    expect(hints.size).toBe(1);
    expect(MAX_FUNNEL_LINK_HINTS_PER_NIGHT).toBeLessThanOrEqual(5);
  });

  it("fail-closed: no crawler feed -> no hints, ever", () => {
    const report = buildFunnelReport({
      botPages: [],
      citedPages: [{ path: "/x", count: 2, prompts: 0, lastAt: null }],
      clickPages: [],
      demandByPath: new Map([["/big-orphan", 9999]]),
    });
    expect(buildFunnelLinkHints(report).size).toBe(0);
  });
});
