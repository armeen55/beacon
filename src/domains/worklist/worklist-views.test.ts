import { describe, it, expect } from "vitest";
import { buildWorklist, sliceWorklist } from "./worklist-views";

const inputs = {
  moves: [
    { id: "mv1", action: "edit_title", targetUrl: "https://x.com/a", score: 90, demand: 5000, confidence: "high" as const, prepared: true, title: "Tighten /a title" },
    { id: "mv2", action: "fix_page_experience", targetUrl: "https://x.com/b", score: 40, demand: 200, confidence: "medium" as const, prepared: false, title: "Fix /b UX" },
  ],
  opportunities: [
    { id: "op1", action: "create_page", matchedPageUrl: null, estDemand: 8000, confidence: "high" as const, primaryKeyword: "persian rugs guide", whyNow: "no page yet" },
  ],
  trends: [
    { id: "tr1", recommendedAction: "create_page", targetPageUrl: null, estDemand: 1200, confidence: "high" as const, query: "nowruz gifts", trend: "rising" as const, whyNow: "rising" },
  ],
  products: [
    { id: "pr1", recommendedAction: "create_product", matchedPageUrl: null, estDemand: 480, confidence: "medium" as const, keyword: "iran world cup jersey", whyNow: "rising", conceptOnly: true, trend: "rising" as const },
  ],
};

describe("buildWorklist", () => {
  it("normalizes all four producers into one ranked list", () => {
    const w = buildWorklist(inputs);
    expect(w).toHaveLength(5);
    expect(new Set(w.map((i) => i.kind))).toEqual(new Set(["move", "opportunity", "trend", "product"]));
    // sorted desc by rank
    for (let i = 1; i < w.length; i++) expect(w[i - 1].rank).toBeGreaterThanOrEqual(w[i].rank);
  });
  it("tags parent + isNew + conceptOnly correctly", () => {
    const w = buildWorklist(inputs);
    expect(w.find((i) => i.id === "pr1")!.parent).toBe("commerce");
    expect(w.find((i) => i.id === "pr1")!.conceptOnly).toBe(true);
    expect(w.find((i) => i.id === "op1")!.isNew).toBe(true);
    expect(w.find((i) => i.id === "mv2")!.parent).toBe("technical");
  });
});

describe("sliceWorklist views", () => {
  const w = buildWorklist(inputs);
  it("today = top N by rank", () => {
    expect(sliceWorklist(w, "today", { todayN: 2 })).toHaveLength(2);
  });
  it("new_pages = create_page / net-new content", () => {
    const np = sliceWorklist(w, "new_pages");
    expect(np.every((i) => i.action === "create_page" || (i.isNew && i.parent === "content"))).toBe(true);
    expect(np.find((i) => i.id === "op1")).toBeDefined();
  });
  it("store = commerce only (incl. concept-only products)", () => {
    const s = sliceWorklist(w, "store");
    expect(s.every((i) => i.parent === "commerce")).toBe(true);
    expect(s.find((i) => i.id === "pr1")).toBeDefined();
  });
  it("trends = trend items / rising", () => {
    const tr = sliceWorklist(w, "trends");
    expect(tr.find((i) => i.id === "tr1")).toBeDefined();
  });
  it("big_bets = high-demand net-new, by demand", () => {
    const bb = sliceWorklist(w, "big_bets");
    expect(bb.every((i) => i.isNew && (i.demand ?? 0) >= 1000)).toBe(true);
    expect(bb[0].id).toBe("op1"); // 8000 demand leads
  });
  it("all = full ranked list", () => {
    expect(sliceWorklist(w, "all")).toHaveLength(5);
  });
});

describe("buildWorklist crawlGaps", () => {
  it("includes crawlability gaps as technical fix_crawlability items", () => {
    const w = buildWorklist({
      crawlGaps: [{ path: "/gold", value: 5000, reason: "AI can't crawl it", severity: "high" }],
    });
    const g = w.find((i) => i.id === "crawl:/gold")!;
    expect(g.parent).toBe("technical");
    expect(g.action).toBe("fix_crawlability");
    expect(g.confidence).toBe("high");
  });
});
