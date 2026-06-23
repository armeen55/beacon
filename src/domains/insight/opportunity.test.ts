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
  it("ROUNDS a fractional position to the nearest rank (not floor to the better rank)", () => {
    // 3.8 must map to rank 4 (0.07), NOT floor to rank 3's higher 0.10 — the
    // floor overstated every CTR-leak / cannibalization estimate ~40%.
    expect(expectedCtrForPosition(3.8)).toBe(0.07);
    expect(expectedCtrForPosition(3.4)).toBe(0.1); // rounds to 3
    expect(expectedCtrForPosition(9.6)).toBe(0.018); // rounds to 10
    expect(expectedCtrForPosition(12)).toBe(0.012); // page-2 floor
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
    // The "why" still tells the operator to check how Google shows the page
    // before a title change (plain-language campaign dropped the "SERP" acronym).
    expect(o!.why.toLowerCase()).toContain("before changing the title");
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

describe("buildOpportunity — cannibalization (one signal, never buries title money)", () => {
  it("does NOT headline over a real CTR leak; the title money wins and the estimate matches it", () => {
    const o = buildOpportunity({
      canonUrl: "https://x.test/iran-flags/achaemenid-empire-flag",
      path: "/iran-flags/achaemenid-empire-flag",
      // Page ranks #4 with 10,000 impressions at 0.1% CTR ⇒ a big CTR leak (~690).
      gsc: { clicks90d: 10, impressions90d: 10000, ctr90d: 0.001, position90d: 4, topQuery: "achaemenid empire flag" },
      // One query (600 impr) is also split across pages ⇒ a small cannibalization (~41).
      cannibalization: {
        query: "achaemenid empire flag",
        urlCount: 2,
        combinedImpressions: 600,
        combinedClicks: 1,
        leadImpressions: 600,
        leadClicks: 1,
        bestPosition: 4,
        additionalCases: 0,
      },
    });
    expect(o).not.toBeNull();
    // The recoverable money is the title/snippet rewrite at the held rank, so
    // ctr_leak headlines, not cannibalization.
    expect(o!.kind).toBe("ctr_leak");
    // Cannibalization stays a VISIBLE secondary signal (kind list + evidence line).
    expect(o!.kinds).toEqual(expect.arrayContaining(["ctr_leak", "cannibalization"]));
    expect(o!.evidenceBySource.some((e) => /compete for/.test(e.line))).toBe(true);
    // The displayed estimate is the DOMINANT kind's (the leak's ~690), never the
    // cannibalization's ~41, and the "why" is the title/SERP narrative, never
    // "N pages compete". This is what kills the "~1,535 clicks · earning 1 click
    // from 618 impressions" incoherence the audit flagged.
    expect(o!.estClicksAtStake).toBe(690);
    expect(o!.why).not.toContain("compete");
    expect(o!.why.toLowerCase()).toMatch(/title|serp/);
  });

  it("headlines cannibalization only when it is the page's dominant blocker", () => {
    const o = buildOpportunity({
      canonUrl: "https://x.test/lead",
      path: "/lead",
      cannibalization: {
        query: "q",
        urlCount: 2,
        combinedImpressions: 800,
        combinedClicks: 0,
        // Lead URL holds 500 of the 800 combined impressions. Recovery is sized
        // off the LEAD (500 x expectedCtr(5)=0.05 = 25), NOT combined (would be
        // 40) — consolidating doesn't grant the lead the deep-rank cannibal's
        // impressions at the top CTR.
        leadImpressions: 500,
        leadClicks: 0,
        bestPosition: 5,
        additionalCases: 0,
      },
    });
    expect(o).not.toBeNull();
    expect(o!.kind).toBe("cannibalization");
    expect(o!.why).toContain("of your pages compete");
    expect(o!.expectedLever).toContain("not a title rewrite");
    expect(o!.estConfidence).toBe("low"); // recovery is inherently uncertain
    // Sized off the LEAD URL's own impressions (500 × expectedCtr(5)=0.05 − 0 = 25),
    // NOT the cluster's combined 800 (which would be 40) — consolidating doesn't
    // grant the lead the deep-rank cannibal's impressions at the top CTR.
    expect(o!.estClicksAtStake).toBe(25);
  });
});
