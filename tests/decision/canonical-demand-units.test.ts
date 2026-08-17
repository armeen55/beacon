/** THE CANONICAL DEMAND UNIT: one audience need joined across every stream, disagreements preserved as
 *  tensions, lost audiences seeded from history alone, and nothing invented on a stream that is absent. */
import { describe, expect, it } from "vitest";
import { canonicalDemandUnits, type CanonicalUnitInputs } from "@/domains/evidence/demand-units";

const at = () => 0.05;
const base: CanonicalUnitInputs = { pageQueries: [], history: [], windows: { earlyDays: 300, recentDays: 90 },
  keywords: [], serps: [], observations: [], winning: [], expectedCtrAt: at };

describe("one audience need across every stream", () => {
  it("joins queries, history, volume, serp, prompts, fan-outs and winners onto ONE unit and preserves the disagreements", () => {
    const input: CanonicalUnitInputs = { ...base,
      pageQueries: [
        { page: "https://x.example/girl-names", rows: [{ query: "persian girl names", impressions: 5000, clicks: 300, position: 5 }, { query: "list of persian girl names", impressions: 1200, clicks: 40, position: 7 }] },
        { page: "https://x.example/names", rows: [{ query: "persian girl names", impressions: 2000, clicks: 60, position: 9 }] }],
      history: [{ query: "persian girl names", earlyClicks: 9000, earlyImpressions: 200000, earlyPosition: 3,
        recentClicks: 1200, recentImpressions: 40000, recentPosition: 6,
        earlyTopPage: "https://x.example/names", recentTopPage: "https://x.example/girl-names" }],
      keywords: [{ query: "persian girl names", searchVolume: 8100, intent: "commercial", difficulty: 20 }],
      serps: [{ query: "persian girl names", observedAt: "2026-08-01", organic: [{ rank: 1, domain: "rival.example", url: "https://rival.example/names" }], paa: ["What are rare Persian girl names?"], related: ["persian female names"] }],
      observations: [
        { promptId: "p1", promptText: "What are popular Persian girl names?", creditedOwn: false, citations: [{ domain: "rival.example", url: "https://rival.example/names" }], fanOutQueries: ["persian baby girl names 2026"] },
        { promptId: "p1", promptText: "What are popular Persian girl names?", creditedOwn: true, citations: [{ domain: "x.example", url: "https://x.example/girl-names" }], fanOutQueries: null }],
      winning: [{ url: "https://rival.example/names", domain: "rival.example", queries: ["persian girl names"], promptIds: [] }] };
    const [u] = canonicalDemandUnits(input);
    expect([u!.label, u!.pages, u!.queries.length]).toEqual(["persian girl names", ["https://x.example/girl-names", "https://x.example/names"], 2]);
    // History: per-day loss over the named windows, and the swap said out loud as a tension.
    expect([u!.history!.lostClicksPerMonth, u!.history!.pageSwapped]).toEqual([Math.round((9000 / 300 - 1200 / 90) * 30), true]);
    expect(u!.tensions.some((t) => t.includes("Google moved this audience"))).toBe(true);
    expect(u!.tensions.some((t) => t.includes("split this audience"))).toBe(true);
    // The keyword provider disagrees with the question form, and the unit says so instead of averaging.
    expect(u!.tensions.some((t) => t.includes("grades this commercial"))).toBe(true);
    expect([u!.volume!.searchVolume, u!.serp!.winners[0]!.domain]).toEqual([8100, "rival.example"]);
    // The prompt joined on shared subject tokens; its answers, credits, rivals and fan-outs ride the unit.
    expect([u!.prompts[0]!.answers, u!.prompts[0]!.credited, u!.prompts[0]!.citedRivals[0]!.domain, u!.fanouts]).toEqual([2, 1, "rival.example", ["persian baby girl names 2026"]]);
    expect(u!.winningPages[0]!.domain).toBe("rival.example");
    expect(u!.vocabulary).toContain("What are popular Persian girl names?");
  });
  it("seeds a unit from history alone when the audience vanished, and claims nothing on absent streams", () => {
    const [u] = canonicalDemandUnits({ ...base,
      history: [{ query: "iranian recipes", earlyClicks: 3000, earlyImpressions: 90000, earlyPosition: 4,
        recentClicks: 0, recentImpressions: 0, recentPosition: null, earlyTopPage: "https://x.example/recipes", recentTopPage: null }] });
    expect([u!.label, u!.history!.lostClicksPerMonth, u!.history!.pageSwapped]).toEqual(["iranian recipes", 300, false]);
    expect([u!.volume, u!.serp, u!.prompts, u!.winningPages]).toEqual([null, null, [], []]);
  });
});
