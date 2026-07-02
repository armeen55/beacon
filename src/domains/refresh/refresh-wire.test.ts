/**
 * refresh-wire.test.ts (BEACON_500 item 56) - BEHAVIOR pins for the bounded additive refresh
 * source inside buildDailyCandidates: emits a real "refresh" candidate from the queue, bounds
 * at 2/night decayed-winners-first, respects the shared eligibility gate (a mid-measurement
 * content-family page never queues), scores controls from the same clean pool as every other
 * lever, and an ABSENT queue produces a byte-identical batch (additive, never a regression).
 */
import { describe, expect, it } from "vitest";

import { buildDailyCandidates, type GscPageInput, type PageFacts } from "@/domains/experiments/build-daily-candidates";
import type { ShippedChangeRecord } from "@/domains/proof-gsc/shipped-change-store";
import type { RefreshBrief } from "./refresh-brief";

const NOW = new Date("2026-07-01T00:00:00Z");
const gsc = (over: Partial<GscPageInput> & { url: string }): GscPageInput => ({
  pageLabel: "x", impressions: 2000, clicks: 5, ctr: 0.0025, position: 6,
  topQuery: "some other query", topQueryImpressions: 1200, topQueryPosition: 4, topQueryCtr: 0.002, ownership: 0.5, ...over,
});

function fadingBrief(page: string, clicksLostQuarter = 180): RefreshBrief {
  return {
    page,
    rank: {
      page,
      clicksLostPerMonth: Number((clicksLostQuarter / 3).toFixed(1)),
      clicksLostQuarter,
      positionDrift: 1.5,
      priorClicks: 480,
      currentClicks: 480 - clicksLostQuarter,
      priorPosition: 4.2,
      currentPosition: 5.7,
      currentImpressions: 3000,
      sentence: "This page earned 160 clicks a month last quarter and is fading, down about 60 clicks a month since. A refresh usually brings these back.",
    },
    newQueryGaps: [{ query: "persian cat price", impressions: 400 }],
    losingQueries: [{ query: "persian cat breeders", priorClicks: 200, recentClicks: 80, dropPct: 60 }],
    winnerSection: { domain: "rival.com", sectionTitle: "2026 Pricing Guide", freshnessDate: "2026-02-01" },
    hasEvidence: true,
  };
}

// A family of clean sibling pages so controls exist (titles are query-first + meta present +
// H1 aligned -> chooseProposal yields NO candidate for them, keeping the batch refresh-only).
function siblingPool(): { pages: GscPageInput[]; facts: Map<string, PageFacts> } {
  const pages: GscPageInput[] = [];
  const facts = new Map<string, PageFacts>();
  for (let i = 1; i <= 4; i++) {
    const url = `/iran-cats/sibling-${i}`;
    pages.push(gsc({ url, topQuery: `sibling query ${i}` }));
    facts.set(url, { title: `Sibling Query ${i} - Cats History`, meta: "A bespoke real meta for this page.", h1: `Sibling Query ${i}` });
  }
  return { pages, facts };
}

describe("buildDailyCandidates - item 56 refresh source (wire behavior)", () => {
  it("emits a bounded refresh candidate from the queue with the brief riding the card", () => {
    const { pages, facts } = siblingPool();
    const out = buildDailyCandidates({
      tenantId: "t", pages, facts, proofLedger: [], now: NOW,
      refreshQueue: [fadingBrief("/iran-cats/persian-cats")],
    });
    const refresh = out.filter((c) => c.leverField === "refresh");
    expect(refresh).toHaveLength(1);
    const c = refresh[0]!;
    expect(c.url).toBe("/iran-cats/persian-cats");
    expect(c.actionFamily).toBe("content");
    expect(c.proposedText).toBe("2026 Pricing Guide"); // the winner's missing section
    expect(c.whyNow).toContain("fading");
    expect(c.whyNow).toContain("rival.com");
    expect(c.refreshDetail?.briefSentences.length).toBe(3);
    expect(c.ctrOpportunityClicks).toBeCloseTo(60, 1); // the fade IS the forecast
    // Controls come from the SAME clean pool machinery as every other lever.
    expect(c.suggestedControls.length).toBeGreaterThanOrEqual(3);
    expect(c.enoughControls).toBe(true);
    expect(c.eligibility.eligible).toBe(true);
  });

  it("bounds at 2 per night, decayed-winners-first (queue order)", () => {
    const { pages, facts } = siblingPool();
    const out = buildDailyCandidates({
      tenantId: "t", pages, facts, proofLedger: [], now: NOW,
      refreshQueue: [fadingBrief("/iran-cats/worst", 300), fadingBrief("/iran-cats/second", 200), fadingBrief("/iran-cats/third", 100)],
    });
    const refresh = out.filter((c) => c.leverField === "refresh");
    expect(refresh.map((c) => c.url)).toEqual(["/iran-cats/worst", "/iran-cats/second"]);
  });

  it("an ABSENT queue is byte-identical to the pre-item-56 batch (additive only)", () => {
    const { pages, facts } = siblingPool();
    const without = buildDailyCandidates({ tenantId: "t", pages, facts, proofLedger: [], now: NOW });
    const withEmpty = buildDailyCandidates({ tenantId: "t", pages, facts, proofLedger: [], now: NOW, refreshQueue: [] });
    expect(withEmpty).toEqual(without);
    expect(without.filter((c) => c.leverField === "refresh")).toHaveLength(0);
  });

  it("a page mid-measurement on the content family never gets a refresh candidate", () => {
    const { pages, facts } = siblingPool();
    const measuring: ShippedChangeRecord = {
      id: "p1", tenantId: "t", page: "/iran-cats/persian-cats", path: "/iran-cats/persian-cats",
      actionType: "add_h2_section", shippedAt: "2026-06-25T00:00:00Z", verdict: "measuring",
      controlPages: [], windows: [],
    } as unknown as ShippedChangeRecord;
    const out = buildDailyCandidates({
      tenantId: "t", pages, facts, proofLedger: [measuring], now: NOW,
      refreshQueue: [fadingBrief("/iran-cats/persian-cats")],
    });
    expect(out.filter((c) => c.leverField === "refresh")).toHaveLength(0);
  });

  it("refresh whyNow and brief sentences carry no em or en dashes", () => {
    const { pages, facts } = siblingPool();
    const out = buildDailyCandidates({
      tenantId: "t", pages, facts, proofLedger: [], now: NOW,
      refreshQueue: [fadingBrief("/iran-cats/persian-cats")],
    });
    const c = out.find((x) => x.leverField === "refresh")!;
    expect(c.whyNow).not.toMatch(/[–—]/);
    for (const s of c.refreshDetail?.briefSentences ?? []) expect(s).not.toMatch(/[–—]/);
  });
});
