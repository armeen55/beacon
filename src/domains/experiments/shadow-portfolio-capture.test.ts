import { describe, it, expect } from "vitest";

import { buildShadowCandidates, MAX_SHADOW_CANDIDATES } from "./shadow-portfolio-capture";
import { scoreCandidate, type DailyCandidate } from "./daily-experiment-planner";

/**
 * Pure-selection matrix for the shadow portfolio (BEACON_500 item 65). Given the full eligible
 * pool a planning run scored and the subset it actually selected, buildShadowCandidates ranks
 * the REJECTED remainder the same way the planner would and keeps the top N. No I/O.
 */

const cand = (over: Partial<DailyCandidate> & { url: string }): DailyCandidate => ({
  actionFamily: "title", targetQuery: "q", impressions: 2000, position: 6, ctr: 0.004,
  ownership: 0.5, ctrOpportunityClicks: 100, effortMinutes: 1, ...over,
});

describe("buildShadowCandidates - selection", () => {
  it("excludes candidates that were selected, keeps only the rejected pool", () => {
    const eligible = [
      cand({ url: "https://iranopedia.com/a" }),
      cand({ url: "https://iranopedia.com/b" }),
      cand({ url: "https://iranopedia.com/c" }),
    ];
    const shadow = buildShadowCandidates(eligible, new Set(["https://iranopedia.com/a"]));
    expect(shadow.map((s) => s.page).sort()).toEqual(["https://iranopedia.com/b", "https://iranopedia.com/c"]);
  });

  it("ranks the rejected pool by the SAME scoreCandidate the planner uses (best rejected first)", () => {
    const strong = cand({ url: "https://iranopedia.com/strong", position: 4, ctr: 0.002, ownership: 0.6, ctrOpportunityClicks: 400 });
    const weak = cand({ url: "https://iranopedia.com/weak", position: 18, ctr: 0.02, ownership: 0.1, ctrOpportunityClicks: 20 });
    expect(scoreCandidate(strong)).toBeGreaterThan(scoreCandidate(weak));
    const shadow = buildShadowCandidates([weak, strong], new Set());
    expect(shadow[0]?.page).toBe("https://iranopedia.com/strong");
    expect(shadow[0]?.score).toBeGreaterThan(shadow[1]!.score);
  });

  it("caps the cohort at MAX_SHADOW_CANDIDATES (default 5) even with a large rejected pool", () => {
    const eligible = Array.from({ length: 12 }, (_, i) => cand({ url: `https://iranopedia.com/p${i}`, ctrOpportunityClicks: 100 - i }));
    const shadow = buildShadowCandidates(eligible, new Set());
    expect(shadow).toHaveLength(MAX_SHADOW_CANDIDATES);
  });

  it("returns [] when every eligible candidate was selected (nothing was skipped)", () => {
    const eligible = [cand({ url: "https://iranopedia.com/a" }), cand({ url: "https://iranopedia.com/b" })];
    const shadow = buildShadowCandidates(eligible, new Set(["https://iranopedia.com/a", "https://iranopedia.com/b"]));
    expect(shadow).toEqual([]);
  });

  it("returns [] on an empty eligible pool", () => {
    expect(buildShadowCandidates([], new Set())).toEqual([]);
  });

  it("is deterministic - ties break by url so repeated runs match exactly", () => {
    const eligible = [
      cand({ url: "https://iranopedia.com/z", ctrOpportunityClicks: 50 }),
      cand({ url: "https://iranopedia.com/a", ctrOpportunityClicks: 50 }),
    ];
    const shadow = buildShadowCandidates(eligible, new Set());
    expect(shadow.map((s) => s.page)).toEqual(["https://iranopedia.com/a", "https://iranopedia.com/z"]);
  });
});

describe("buildShadowCandidates - row shape", () => {
  it("carries lever (actionFamily), pageFamily, targetQuery, and the numeric score", () => {
    const c = cand({ url: "https://iranopedia.com/persian-cat-names/main-coon", actionFamily: "meta", targetQuery: "maine coon persian cat" });
    const [row] = buildShadowCandidates([c], new Set());
    expect(row!.lever).toBe("meta");
    expect(row!.targetQuery).toBe("maine coon persian cat");
    expect(row!.pageFamily).toBe("persian-cat-names");
    expect(row!.pagePath).toBe("/persian-cat-names/main-coon");
    expect(typeof row!.score).toBe("number");
  });

  it("uses the candidate's explicit pageFamily when present instead of re-deriving it", () => {
    const c = cand({ url: "https://iranopedia.com/some/deep/path", pageFamily: "custom-family" });
    const [row] = buildShadowCandidates([c], new Set());
    expect(row!.pageFamily).toBe("custom-family");
  });

  it("attaches a numeric forecast range when the opportunity is large enough to forecast honestly", () => {
    const c = cand({ url: "https://iranopedia.com/big-opportunity", ctrOpportunityClicks: 400 });
    const [row] = buildShadowCandidates([c], new Set());
    expect(row!.forecastLow).toBeGreaterThan(0);
    expect(row!.forecastHigh).toBeGreaterThanOrEqual(row!.forecastLow!);
  });

  it("omits the forecast range when the opportunity is too small to forecast honestly", () => {
    const c = cand({ url: "https://iranopedia.com/tiny-opportunity", ctrOpportunityClicks: 1 });
    const [row] = buildShadowCandidates([c], new Set());
    expect(row!.forecastLow).toBeUndefined();
    expect(row!.forecastHigh).toBeUndefined();
  });

  it("applies the correction factor to the shadow forecast the same way a selected pick would get", () => {
    const c = cand({ url: "https://iranopedia.com/x", ctrOpportunityClicks: 400 });
    const neutral = buildShadowCandidates([c], new Set(), 1)[0]!;
    const corrected = buildShadowCandidates([c], new Set(), 0.8)[0]!;
    expect(corrected.forecastHigh!).toBeLessThan(neutral.forecastHigh!);
  });
});
