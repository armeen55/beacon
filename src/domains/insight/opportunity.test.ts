import { describe, expect, it } from "vitest";
import {
  buildOpportunity,
  rankOpportunities,
  expectedCtrForPosition,
  type OpportunityItem,
} from "./opportunity";

describe("expectedCtrForPosition", () => {
  it("is monotonically non-increasing and bounded", () => {
    expect(expectedCtrForPosition(1)).toBeGreaterThan(expectedCtrForPosition(5));
    expect(expectedCtrForPosition(5)).toBeGreaterThan(expectedCtrForPosition(10));
    expect(expectedCtrForPosition(50)).toBeLessThanOrEqual(0.02);
  });
});

describe("buildOpportunity — real Iranopedia shapes", () => {
  it("flags a CTR leak (ranks top-5, big impressions, near-zero CTR)", () => {
    // iran-islamic-republic-flag-history: #3.8, 10,753 impr, 0.14% CTR
    const o = buildOpportunity({
      canonUrl: "https://www.iranopedia.com/iran-flags/iran-islamic-republic-flag-history",
      path: "/iran-flags/iran-islamic-republic-flag-history",
      gsc: { clicks90d: 15, impressions90d: 10753, ctr90d: 0.0014, position90d: 3.8, topQuery: "iran flag" },
    });
    expect(o).not.toBeNull();
    expect(o!.kind).toBe("ctr_leak");
    expect(o!.evidenceBySource[0].source).toBe("gsc");
    // recoverable clicks at expected CTR for ~pos 4 (7%) ≈ 10753*(0.07-0.0014)
    expect(o!.estClicksAtStake).toBeGreaterThan(500);
  });

  it("flags striking distance from SEMrush page-2 volume", () => {
    const o = buildOpportunity({
      canonUrl: "https://www.iranopedia.com/best-persian-restaurants",
      path: "/best-persian-restaurants",
      striking: [
        { keyword: "restaurants persian", position: 13, volume: 8100 },
        { keyword: "persian restaurants near me", position: 13, volume: 4400 },
      ],
    });
    expect(o).not.toBeNull();
    expect(o!.kinds).toContain("striking_distance");
    expect(o!.evidenceBySource.some((e) => e.source === "semrush")).toBe(true);
    expect(o!.estClicksAtStake).toBeGreaterThan(0);
  });

  it("flags decay when clicks drop vs the prior window", () => {
    const o = buildOpportunity({
      canonUrl: "https://www.iranopedia.com/persian-female-first-names",
      path: "/persian-female-first-names",
      decay: { clicksNow: 235, clicksPrior: 358 },
    });
    expect(o).not.toBeNull();
    expect(o!.kinds).toContain("decay");
    expect(o!.estClicksAtStake).toBe(123);
  });

  it("flags rising momentum", () => {
    const o = buildOpportunity({
      canonUrl: "https://www.iranopedia.com/iran-world-cup-jersey-evolution",
      path: "/iran-world-cup-jersey-evolution",
      decay: { clicksNow: 97, clicksPrior: 46 },
    });
    expect(o).not.toBeNull();
    expect(o!.kinds).toContain("rising");
  });

  it("flags Clarity friction (dead/rage clicks)", () => {
    const o = buildOpportunity({
      canonUrl: "https://www.iranopedia.com/iran-flags",
      path: "/iran-flags",
      clarity: { sessions: 21, deadClicks: 67, rageClicks: 10 },
    });
    expect(o).not.toBeNull();
    expect(o!.kinds).toContain("friction");
  });

  it("SERP-guards a top-5 low-CTR page with unknown SERP (no blind title claim)", () => {
    // pos 3.8 + unknown SERP ⇒ a feature may own the clicks; don't claim a title fix.
    const o = buildOpportunity({
      canonUrl: "https://www.iranopedia.com/iran-flags/iran-islamic-republic-flag-history",
      path: "/iran-flags/iran-islamic-republic-flag-history",
      gsc: { clicks90d: 15, impressions90d: 10753, ctr90d: 0.0014, position90d: 3.8, topQuery: "iran flag" },
    });
    expect(o).not.toBeNull();
    expect(o!.serpStatus).toBe("unknown");
    expect(o!.serpGuardLabel).toBe("Needs SERP check before title rewrite");
    expect(o!.why.toLowerCase()).toContain("serp");
    // honest estimate is still computed (it's the copy, not the number, that's guarded)
    expect(o!.estClicksAtStake).toBeGreaterThan(500);
    expect(o!.estWindow).toBe("90d");
    expect(o!.estConfidence).toBe("high"); // 10,753 impressions ≥ 3,000
  });

  it("does NOT SERP-guard a pos 6–10 CTR leak (below the feature-dominated top)", () => {
    const o = buildOpportunity({
      canonUrl: "https://www.iranopedia.com/cities",
      path: "/cities",
      gsc: { clicks90d: 70, impressions90d: 16000, ctr90d: 0.0043, position90d: 9, topQuery: "cities in iran list" },
    });
    expect(o).not.toBeNull();
    expect(o!.kind).toBe("ctr_leak");
    expect(o!.serpGuardLabel).toBeNull();
    expect(o!.why.toLowerCase()).toContain("title");
  });

  it("downgrades estimate confidence on thin impression volume", () => {
    const o = buildOpportunity({
      canonUrl: "https://x.test/thin",
      path: "/thin",
      gsc: { clicks90d: 2, impressions90d: 600, ctr90d: 0.003, position90d: 9, topQuery: "q" },
    });
    expect(o).not.toBeNull();
    expect(o!.estConfidence).toBe("low"); // 600 impressions < 800
  });

  it("passes the pack primary action through when a Change Pack exists", () => {
    const o = buildOpportunity({
      canonUrl: "https://x.test/p",
      path: "/p",
      gsc: { clicks90d: 10, impressions90d: 5000, ctr90d: 0.002, position90d: 9, topQuery: "q" },
      hasChangePack: true,
      packHeadlineAction: "Rewrite the title",
    });
    expect(o).not.toBeNull();
    expect(o!.hasChangePack).toBe(true);
    expect(o!.packAction).toBe("Rewrite the title");
  });

  it("returns null for a healthy page with no actionable signal", () => {
    const o = buildOpportunity({
      canonUrl: "https://www.iranopedia.com/persian-male-names",
      path: "/persian-male-names",
      gsc: { clicks90d: 1808, impressions90d: 41100, ctr90d: 0.044, position90d: 6.7, topQuery: "persian names boy" },
    });
    expect(o).toBeNull(); // 4.4% CTR at pos ~7 is above the leak threshold
  });

  it("picks the dominant kind by priority (ctr_leak over decay)", () => {
    const o = buildOpportunity({
      canonUrl: "https://x.test/p",
      path: "/p",
      gsc: { clicks90d: 10, impressions90d: 5000, ctr90d: 0.002, position90d: 4, topQuery: "q" },
      decay: { clicksNow: 5, clicksPrior: 40 },
    });
    expect(o!.kind).toBe("ctr_leak");
    expect(o!.kinds).toEqual(expect.arrayContaining(["ctr_leak", "decay"]));
  });

  it("importance weight scales the ranking score", () => {
    const base = buildOpportunity({
      canonUrl: "https://x.test/a",
      path: "/a",
      decay: { clicksNow: 5, clicksPrior: 105 },
      importance: 1.0,
    })!;
    const valued = buildOpportunity({
      canonUrl: "https://x.test/b",
      path: "/b",
      decay: { clicksNow: 5, clicksPrior: 105 },
      importance: 1.5,
    })!;
    expect(valued.score).toBeGreaterThan(base.score);
  });
});

describe("rankOpportunities", () => {
  it("sorts by score descending", () => {
    const base = {
      packAction: null,
      estWindow: "90d" as const,
      estConfidence: "low" as const,
      serpStatus: "unknown" as const,
      serpGuardLabel: null,
    };
    const items: OpportunityItem[] = [
      { canonUrl: "a", path: "/a", kinds: ["decay"], kind: "decay", title: "a", why: "", evidenceBySource: [], expectedLever: "", estClicksAtStake: 10, importance: 1, hasChangePack: false, score: 10, ...base },
      { canonUrl: "b", path: "/b", kinds: ["ctr_leak"], kind: "ctr_leak", title: "b", why: "", evidenceBySource: [], expectedLever: "", estClicksAtStake: 800, importance: 1, hasChangePack: false, score: 800, ...base },
      { canonUrl: "c", path: "/c", kinds: ["friction"], kind: "friction", title: "c", why: "", evidenceBySource: [], expectedLever: "", estClicksAtStake: 77, importance: 1, hasChangePack: false, score: 77, ...base },
    ];
    const ranked = rankOpportunities(items);
    expect(ranked.map((r) => r.path)).toEqual(["/b", "/c", "/a"]);
  });
});
