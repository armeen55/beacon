import { describe, it, expect } from "vitest";

import {
  buildOpportunityFeed,
  feedClicksAtStake,
  type DeclineInput,
  type StrikingInput,
} from "@/app/(shell)/today-opportunities-feed-rows";
import { estimatedCtr, clicksAtStakeForStriking } from "@/domains/recommendation-intelligence/ctr-curve";

const decl = (page: string, query: string, prior: number, recent: number, dropPct = 50): DeclineInput => ({
  page,
  topDecline: { query, priorClicks: prior, recentClicks: recent, dropPct },
});
const strike = (page: string, query: string, impressions: number, position: number): StrikingInput => ({
  page,
  topQuery: { query, impressions, position },
});

describe("ctr-curve", () => {
  it("decays with position and interpolates fractionally", () => {
    expect(estimatedCtr(1)).toBeGreaterThan(estimatedCtr(3));
    expect(estimatedCtr(3)).toBeGreaterThan(estimatedCtr(10));
    const mid = estimatedCtr(4.5);
    expect(mid).toBeLessThan(estimatedCtr(4));
    expect(mid).toBeGreaterThan(estimatedCtr(5));
  });

  it("clicks-at-stake is positive climbing toward target, zero if already there", () => {
    expect(clicksAtStakeForStriking(1000, 8)).toBeGreaterThan(0);
    expect(clicksAtStakeForStriking(1000, 2)).toBe(0); // already above target pos 3
    expect(clicksAtStakeForStriking(0, 8)).toBe(0);
  });
});

describe("buildOpportunityFeed", () => {
  it("merges recover + win into one list ranked by clicks at stake", () => {
    const feed = buildOpportunityFeed(
      [decl("https://x/a", "lost big", 300, 50)], // 250 recoverable
      [strike("https://x/b", "winnable", 5000, 8)], // ~ impressions * uplift
      clicksAtStakeForStriking,
    );
    expect(feed.length).toBe(2);
    expect(feed[0]!.clicksAtStake).toBeGreaterThanOrEqual(feed[1]!.clicksAtStake);
    expect(new Set(feed.map((f) => f.kind))).toEqual(new Set(["recover", "win"]));
  });

  it("dedupes the same page+query, keeping the bigger-stake framing", () => {
    const feed = buildOpportunityFeed(
      [decl("https://x/a", "shared", 100, 90)], // only 10 lost
      [strike("https://x/a", "shared", 9000, 9)], // big winnable
      clicksAtStakeForStriking,
    );
    expect(feed).toHaveLength(1);
    expect(feed[0]!.kind).toBe("win"); // the larger stake won
  });

  it("drops sub-threshold items and caps", () => {
    const feed = buildOpportunityFeed(
      [decl("https://x/a", "tiny", 10, 10)], // 0 lost → dropped
      [strike("https://x/b", "ok", 2000, 7), strike("https://x/c", "ok2", 1800, 6)],
      clicksAtStakeForStriking,
      { cap: 1 },
    );
    expect(feed).toHaveLength(1);
  });

  it("sums clicks at stake", () => {
    const feed = buildOpportunityFeed([decl("https://x/a", "q", 300, 100)], [], clicksAtStakeForStriking);
    expect(feedClicksAtStake(feed)).toBe(200);
  });

  it("routes to /proof with the page prefilled", () => {
    const feed = buildOpportunityFeed([decl("https://x/a", "q", 300, 50)], [], clicksAtStakeForStriking);
    expect(feed[0]!.route).toContain("/proof?page=");
  });
});
