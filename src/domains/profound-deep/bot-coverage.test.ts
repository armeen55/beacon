import { describe, it, expect } from "vitest";
import {
  aggregateBotCoverageByPage,
  findCrawlabilityGaps,
  summarizeBots,
  type ProfoundBotRow,
} from "./bot-coverage";

const row = (path: string, bot: string, hits: number, cites = 0): ProfoundBotRow => ({
  date: "2026-06-01",
  path,
  botName: bot,
  botType: "ai_crawler",
  hitCount: hits,
  citations: cites,
});

describe("aggregateBotCoverageByPage", () => {
  it("sums hits/citations per page, ranks bots", () => {
    const out = aggregateBotCoverageByPage([
      row("/a", "GPTBot", 10, 2),
      row("/a", "PerplexityBot", 4),
      row("/a", "GPTBot", 5),
      row("/b", "GPTBot", 1),
    ]);
    const a = out.find((p) => p.path === "/a")!;
    expect(a.totalHits).toBe(19);
    expect(a.totalCitations).toBe(2);
    expect(a.bots[0]).toEqual({ bot: "GPTBot", hits: 15 });
  });
});

describe("findCrawlabilityGaps — valuable pages AI doesn't crawl", () => {
  const bots = [row("/crawled", "GPTBot", 50), row("/b", "GPTBot", 5)];
  const valuable = [
    { path: "/crawled", value: 1000 },
    { path: "/uncrawled-gold", value: 800 }, // valuable but 0 bot hits → high-severity gap
    { path: "/low-value", value: 0 },
  ];
  it("flags a valuable page with zero AI-crawler hits as high severity", () => {
    const gaps = findCrawlabilityGaps(bots, valuable);
    const gold = gaps.find((g) => g.path === "/uncrawled-gold")!;
    expect(gold).toBeDefined();
    expect(gold.botHits).toBe(0);
    expect(gold.severity).toBe("high");
    expect(gaps.find((g) => g.path === "/crawled")).toBeUndefined(); // well-crawled → not a gap
    expect(gaps.find((g) => g.path === "/low-value")).toBeUndefined(); // below value floor
  });
  it("fail closed: NO bot data at all → no gaps claimed (don't guess crawl status)", () => {
    expect(findCrawlabilityGaps([], valuable)).toEqual([]);
  });
});

describe("summarizeBots", () => {
  it("totals hits + ranks bots", () => {
    const s = summarizeBots([row("/a", "GPTBot", 10), row("/b", "ClaudeBot", 3)]);
    expect(s.totalHits).toBe(13);
    expect(s.pages).toBe(2);
    expect(s.topBots[0].bot).toBe("GPTBot");
  });
});
