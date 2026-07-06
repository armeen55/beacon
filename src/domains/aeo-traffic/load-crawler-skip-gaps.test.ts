import { describe, expect, it } from "vitest";

import {
  assembleCrawlerSkipGaps,
  MIN_SKIP_DEMAND,
  MAX_SKIP_GAPS,
} from "./load-crawler-skip-gaps";
import type { ProfoundBotRow } from "@/domains/profound-deep/bot-coverage";

function bot(over: Partial<ProfoundBotRow> = {}): ProfoundBotRow {
  return {
    date: "2026-07-05",
    path: "/",
    botName: "GPTBot",
    botType: "crawler",
    hitCount: 5,
    citations: 0,
    ...over,
  };
}

describe("assembleCrawlerSkipGaps", () => {
  it("finds a high-demand owned page the crawlers skipped while crawling the rest", () => {
    const botRows: ProfoundBotRow[] = [
      bot({ path: "/home", hitCount: 40 }),
      bot({ path: "/blog", hitCount: 12 }),
      // /iran-visa is NEVER crawled.
    ];
    const demandByPath = new Map<string, number>([
      ["/home", 1000],
      ["/blog", 500],
      ["/iran-visa", 340], // real demand, zero crawl hits
    ]);
    const gaps = assembleCrawlerSkipGaps(botRows, demandByPath);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.path).toBe("/iran-visa");
    expect(gaps[0]!.demand).toBe(340);
    expect(gaps[0]!.botHits).toBe(0);
    // Coverage evidence: 2 other pages were crawled.
    expect(gaps[0]!.crawledPageCount).toBe(2);
  });

  it("EMPTY-SAFE: no bot rows -> [] (fail closed, never fabricate a skip)", () => {
    const demandByPath = new Map<string, number>([["/iran-visa", 340]]);
    expect(assembleCrawlerSkipGaps([], demandByPath)).toEqual([]);
  });

  it("EMPTY-SAFE: bot rows exist but every valuable page was crawled -> []", () => {
    const botRows: ProfoundBotRow[] = [
      bot({ path: "/home", hitCount: 40 }),
      bot({ path: "/iran-visa", hitCount: 3 }),
    ];
    const demandByPath = new Map<string, number>([
      ["/home", 1000],
      ["/iran-visa", 340],
    ]);
    expect(assembleCrawlerSkipGaps(botRows, demandByPath)).toEqual([]);
  });

  it("DEMAND GATE: a skipped page below the demand floor never becomes a gap", () => {
    const botRows: ProfoundBotRow[] = [bot({ path: "/home", hitCount: 40 })];
    const demandByPath = new Map<string, number>([
      ["/home", 1000],
      ["/tiny", MIN_SKIP_DEMAND - 1], // skipped but too little demand
    ]);
    expect(assembleCrawlerSkipGaps(botRows, demandByPath)).toEqual([]);
  });

  it("EMPTY-SAFE: no valuable pages at all -> []", () => {
    const botRows: ProfoundBotRow[] = [bot({ path: "/home", hitCount: 40 })];
    expect(assembleCrawlerSkipGaps(botRows, new Map())).toEqual([]);
  });

  it("ranks highest-demand skips first and caps at MAX_SKIP_GAPS", () => {
    const botRows: ProfoundBotRow[] = [bot({ path: "/home", hitCount: 40 })];
    const demandByPath = new Map<string, number>([["/home", 5000]]);
    for (let i = 0; i < 8; i++) demandByPath.set(`/skipped-${i}`, 200 + i);
    const gaps = assembleCrawlerSkipGaps(botRows, demandByPath);
    expect(gaps.length).toBe(MAX_SKIP_GAPS);
    // /skipped-7 has the most demand -> first.
    expect(gaps[0]!.path).toBe("/skipped-7");
  });

  it("matches paths across casing / trailing slash (canonicalized join)", () => {
    const botRows: ProfoundBotRow[] = [bot({ path: "/Home/", hitCount: 40 })];
    const demandByPath = new Map<string, number>([
      ["/home", 1000], // same page as /Home/ once canonicalized -> crawled, no gap
      ["/iran-visa", 340],
    ]);
    const gaps = assembleCrawlerSkipGaps(botRows, demandByPath);
    // /home is covered by /Home/; only /iran-visa is a real skip.
    expect(gaps.map((g) => g.path)).toEqual(["/iran-visa"]);
  });
});
