import { describe, it, expect } from "vitest";

import { planDailyExperiments, scoreCandidate, pageFamilyOf, type DailyCandidate } from "./daily-experiment-planner";
import type { ShippedChangeRecord } from "@/domains/proof-gsc/shipped-change-store";

const NOW = new Date("2026-07-01T00:00:00Z");
const CONTROLS = ["persian-cat", "caracal", "asiatic-cheetah"].map((s) => `https://iranopedia.com/iran-animals/${s}`);

const titleRec = (slug: string): ShippedChangeRecord => ({
  id: `/iran-animals/${slug}::2026-06-30`, page: `https://iranopedia.com/iran-animals/${slug}`, path: `/iran-animals/${slug}`,
  actionType: "edit_title", before: null, after: null, shippedAt: "2026-06-30T00:00:00.000Z",
  baseline: { clicks: 0, impressions: 100, ctr: 0, position: 5, windowDays: 28 }, targetQueries: ["q"],
  controlPages: CONTROLS, windows: [], verdict: "measuring", confidence: "low", measuredAt: null,
  notes: null, verifiedLive: true, liveSourceUrl: null, recrawlRequestedAt: null, operatorVerdictOverride: null,
  createdAt: "2026-06-30T00:00:00.000Z", updatedAt: "2026-06-30T00:00:00.000Z",
});
const ledger = ["persian-wolf", "persian-leopard"].map(titleRec);

const cand = (over: Partial<DailyCandidate> & { url: string }): DailyCandidate => ({
  actionFamily: "title", targetQuery: "q", impressions: 2000, position: 6, ctr: 0.004,
  ownership: 0.5, ctrOpportunityClicks: 100, effortMinutes: 1, ...over,
});

describe("pageFamilyOf / scoreCandidate", () => {
  it("groups sub-paths by family, top-level slugs are their own", () => {
    expect(pageFamilyOf("https://iranopedia.com/iran-flags/umayyad-caliphate-flag")).toBe("iran-flags");
    expect(pageFamilyOf("/cities")).toBe("cities");
  });
  it("rewards page-1 weak-CTR clear-ownership candidates", () => {
    const strong = cand({ url: "/a", position: 4, ctr: 0.002, ownership: 0.6, ctrOpportunityClicks: 400 });
    const weak = cand({ url: "/b", position: 18, ctr: 0.02, ownership: 0.1, ctrOpportunityClicks: 20 });
    expect(scoreCandidate(strong)).toBeGreaterThan(scoreCandidate(weak));
  });
});

describe("planDailyExperiments — eligibility + diversification", () => {
  it("excludes active treatments and active controls; keeps unrelated families", () => {
    const candidates = [
      cand({ url: "https://iranopedia.com/iran-animals/persian-wolf" }), // active treatment
      cand({ url: "https://iranopedia.com/iran-animals/asiatic-cheetah", actionFamily: "meta" }), // active control
      cand({ url: "https://iranopedia.com/iran-flags/umayyad-caliphate-flag" }), // clean
    ];
    const plan = planDailyExperiments({ tenantId: "t", date: "2026-07-01", candidates, proofLedger: ledger, config: { now: NOW } });
    expect(plan.selected.map((s) => s.url)).toEqual(["https://iranopedia.com/iran-flags/umayyad-caliphate-flag"]);
    expect(plan.excluded.find((e) => e.url.includes("persian-wolf"))?.reason).toBe("same_family_measuring");
    expect(plan.excluded.find((e) => e.url.includes("asiatic-cheetah"))?.reason).toBe("active_control");
  });

  it("caps per page family (e.g. ≤4 flags), overflow → backups then excluded", () => {
    const flags = Array.from({ length: 8 }, (_, i) => cand({ url: `https://iranopedia.com/iran-flags/flag-${i}`, ctrOpportunityClicks: 100 - i }));
    const plan = planDailyExperiments({ tenantId: "t", date: "d", candidates: flags, proofLedger: [], config: { now: NOW, maxPerPageFamily: 4, backups: 2 } });
    expect(plan.selected.length).toBe(4);
    expect(plan.familyDistribution["iran-flags"]).toBe(4);
    expect(plan.backups.length).toBe(2);
    expect(plan.excluded.filter((e) => e.reason === "page_family_cap").length).toBe(2);
  });

  it("caps per action family across pages", () => {
    const titles = Array.from({ length: 6 }, (_, i) => cand({ url: `/p${i}`, pageFamily: `fam${i}`, actionFamily: "title", ctrOpportunityClicks: 100 - i }));
    const plan = planDailyExperiments({ tenantId: "t", date: "d", candidates: titles, proofLedger: [], config: { now: NOW, maxPerActionFamily: 3 } });
    expect(plan.leverDistribution["title"]).toBe(3);
  });

  it("respects the effort-minute budget", () => {
    const big = Array.from({ length: 10 }, (_, i) => cand({ url: `/p${i}`, pageFamily: `fam${i}`, effortMinutes: 5, ctrOpportunityClicks: 100 - i }));
    const plan = planDailyExperiments({ tenantId: "t", date: "d", candidates: big, proofLedger: [], config: { now: NOW, effortBudgetMinutes: 20, maxPerActionFamily: 99 } });
    expect(plan.estimatedMinutes).toBeLessThanOrEqual(20);
    expect(plan.selected.length).toBe(4);
  });

  it("a mixed-lever batch keeps each lever distinct (meta-vs-title is allowed on different pages)", () => {
    const mixed = [
      cand({ url: "/flags/a", pageFamily: "flags", actionFamily: "title" }),
      cand({ url: "/flags/b", pageFamily: "flags", actionFamily: "meta" }),
      cand({ url: "/people/c", pageFamily: "people", actionFamily: "answer" }),
    ];
    const plan = planDailyExperiments({ tenantId: "t", date: "d", candidates: mixed, proofLedger: [], config: { now: NOW } });
    expect(plan.selected.length).toBe(3);
    expect(Object.keys(plan.leverDistribution).sort()).toEqual(["answer", "meta", "title"]);
  });

  it("reports control availability (clean unselected pages by family)", () => {
    const candidates = [
      cand({ url: "/flags/a", pageFamily: "flags" }),
      cand({ url: "/flags/b", pageFamily: "flags" }),
      cand({ url: "/flags/c", pageFamily: "flags" }),
    ];
    const plan = planDailyExperiments({ tenantId: "t", date: "d", candidates, proofLedger: [], config: { now: NOW } });
    // 3 clean pages, some selected; the rest count as clean controls
    expect(plan.controlAvailability.cleanPages).toBe(candidates.length - plan.selected.length);
  });

  it("layers candidate external flags (high-risk excluded)", () => {
    const candidates = [cand({ url: "/x", external: { highRisk: true } }), cand({ url: "/y" })];
    const plan = planDailyExperiments({ tenantId: "t", date: "d", candidates, proofLedger: [], config: { now: NOW } });
    expect(plan.selected.map((s) => s.url)).toEqual(["/y"]);
    expect(plan.excluded.find((e) => e.url === "/x")?.reason).toBe("high_risk_page");
  });
});

describe("planDailyExperiments — internal-link influence model", () => {
  it("caps internal links to ONE per destination (no simultaneous authority burst)", () => {
    const candidates = [
      cand({ url: "https://i.com/src-a", actionFamily: "link", influencedUrls: ["/persian-kabobs/joojeh-kabob"], ctrOpportunityClicks: 500 }),
      cand({ url: "https://i.com/src-b", actionFamily: "link", influencedUrls: ["/persian-kabobs/joojeh-kabob"], ctrOpportunityClicks: 400 }),
    ];
    const plan = planDailyExperiments({ tenantId: "t", date: "d", candidates, proofLedger: [], config: { now: NOW, maxLinksPerDestination: 1, backups: 0 } });
    expect(plan.selected).toHaveLength(1);
    expect(plan.excluded.find((e) => e.url === "https://i.com/src-b")?.reason).toBe("influenced_conflict");
  });

  it("honors maxLinksPerDestination > 1 exactly (no off-by-one)", () => {
    const candidates = [
      cand({ url: "https://i.com/a", actionFamily: "link", influencedUrls: ["/d"], ctrOpportunityClicks: 900 }),
      cand({ url: "https://i.com/b", actionFamily: "link", influencedUrls: ["/d"], ctrOpportunityClicks: 800 }),
      cand({ url: "https://i.com/c", actionFamily: "link", influencedUrls: ["/d"], ctrOpportunityClicks: 700 }),
    ];
    const plan = planDailyExperiments({ tenantId: "t", date: "d", candidates, proofLedger: [], config: { now: NOW, maxLinksPerDestination: 2, maxPerActionFamily: 9, backups: 0 } });
    expect(plan.selected).toHaveLength(2); // exactly 2 links to /d allowed, 3rd blocked
    expect(plan.excluded.find((e) => e.url === "https://i.com/c")?.reason).toBe("influenced_conflict");
  });

  it("never treats a page that another selected link feeds (influenced page is off-limits as a source)", () => {
    const candidates = [
      cand({ url: "https://i.com/hub", actionFamily: "link", influencedUrls: ["/cities/tehran"], ctrOpportunityClicks: 500 }),
      cand({ url: "https://i.com/cities/tehran", actionFamily: "meta", ctrOpportunityClicks: 400 }), // would be treated, but it's influenced
    ];
    const plan = planDailyExperiments({ tenantId: "t", date: "d", candidates, proofLedger: [], config: { now: NOW, backups: 0 } });
    expect(plan.selected.map((s) => s.url)).toEqual(["https://i.com/hub"]);
    expect(plan.excluded.find((e) => e.url === "https://i.com/cities/tehran")?.reason).toBe("influenced_conflict");
  });

  it("never links to a page already selected as a treated source", () => {
    const candidates = [
      cand({ url: "https://i.com/cities/tehran", actionFamily: "meta", ctrOpportunityClicks: 500 }), // treated first
      cand({ url: "https://i.com/hub", actionFamily: "link", influencedUrls: ["/cities/tehran"], ctrOpportunityClicks: 400 }),
    ];
    const plan = planDailyExperiments({ tenantId: "t", date: "d", candidates, proofLedger: [], config: { now: NOW, backups: 0 } });
    expect(plan.selected.map((s) => s.url)).toEqual(["https://i.com/cities/tehran"]);
    expect(plan.excluded.find((e) => e.url === "https://i.com/hub")?.reason).toBe("influenced_conflict");
  });

  it("produces a MIXED batch when both levers and distinct destinations are available", () => {
    const candidates = [
      cand({ url: "https://i.com/iran-flags/a", actionFamily: "meta", ctrOpportunityClicks: 900 }),
      cand({ url: "https://i.com/iran-flags/b", actionFamily: "meta", ctrOpportunityClicks: 800 }),
      cand({ url: "https://i.com/restaurants", actionFamily: "link", influencedUrls: ["/cities/san-diego"], ctrOpportunityClicks: 700 }),
      cand({ url: "https://i.com/food", actionFamily: "link", influencedUrls: ["/kabobs/joojeh"], ctrOpportunityClicks: 600 }),
    ];
    const plan = planDailyExperiments({ tenantId: "t", date: "d", candidates, proofLedger: [], config: { now: NOW, maxLinksPerDestination: 1, backups: 0 } });
    expect(plan.selected).toHaveLength(4);
    expect(plan.leverDistribution.meta).toBe(2);
    expect(plan.leverDistribution.link).toBe(2);
  });
});
