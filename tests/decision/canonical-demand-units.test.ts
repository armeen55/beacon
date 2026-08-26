/** THE CANONICAL DEMAND UNIT: one audience need joined across every stream, disagreements preserved as tensions, lost audiences seeded from history alone, and nothing invented on a stream that is absent. */
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
        earlyTopPage: "https://x.example/names", recentTopPage: "https://x.example/girl-names",
        earlyPagePosition: 3.2, recentPagePosition: 7.1, earlyPageShare: 0.5, recentPageShare: 0.95 }],
      keywords: [{ query: "persian girl names", searchVolume: 8100, intent: "commercial", difficulty: 20 }],
      serps: [{ query: "persian girl names", observedAt: "2026-08-01", organic: [{ rank: 1, domain: "rival.example", url: "https://rival.example/names" }], paa: ["What are rare Persian girl names?"], related: ["persian female names"] }],
      observations: [
        { promptId: "p1", promptText: "What are popular Persian girl names?", creditedOwn: false, citations: [{ domain: "rival.example", url: "https://rival.example/names" }], fanOutQueries: ["persian baby girl names 2026"] },
        { promptId: "p1", promptText: "What are popular Persian girl names?", creditedOwn: true, citations: [{ domain: "x.example", url: "https://x.example/girl-names" }], fanOutQueries: null }],
      winning: [{ url: "https://rival.example/names", domain: "rival.example", queries: ["persian girl names"], promptIds: [] }] };
    const [u] = canonicalDemandUnits(input); expect([u!.label, u!.pages, u!.queries.length]).toEqual(["persian girl names", ["https://x.example/girl-names", "https://x.example/names"], 2]);
    // History: per-day loss over the named windows, and the swap said out loud as a tension.
    expect([u!.history!.lostClicksPerMonth, u!.history!.pageSwapped]).toEqual([Math.round((9000 / 300 - 1200 / 90) * 30), true]); expect(u!.tensions.some((t) => t.includes("Google moved this audience"))).toBe(true);
    expect(u!.tensions.some((t) => t.includes("split this audience"))).toBe(true);
    // The keyword provider disagrees with the question form, and the unit says so instead of averaging.
    expect(u!.tensions.some((t) => t.includes("grades this commercial"))).toBe(true); expect([u!.volume!.searchVolume, u!.serp!.winners[0]!.domain]).toEqual([8100, "rival.example"]);
    // The prompt joined on shared subject tokens; its answers, credits, rivals and fan-outs ride the unit.
    expect([u!.prompts[0]!.answers, u!.prompts[0]!.credited, u!.prompts[0]!.citedRivals[0]!.domain, u!.fanouts]).toEqual([2, 1, "rival.example", ["persian baby girl names 2026"]]); expect(u!.winningPages[0]!.domain).toBe("rival.example");
    expect(u!.vocabulary).toContain("What are popular Persian girl names?");});
  it("seeds a unit from history alone when the audience vanished, and claims nothing on absent streams", () => {
    const [u] = canonicalDemandUnits({ ...base,
      history: [{ query: "iranian recipes", earlyClicks: 3000, earlyImpressions: 90000, earlyPosition: 4,
        recentClicks: 0, recentImpressions: 0, recentPosition: null, earlyTopPage: "https://x.example/recipes", recentTopPage: null }] });
    expect([u!.label, u!.history!.lostClicksPerMonth, u!.history!.pageSwapped]).toEqual(["iranian recipes", 300, false]); expect([u!.volume, u!.serp, u!.prompts, u!.winningPages]).toEqual([null, null, [], []]);});});
describe("AI can seed demand, and only exact identity ever joins it (AEO reconstruction, 2026-08-19)", () => {
  const gsc = { pageQueries: [{ page: "https://x.example/girl-names", rows: [{ query: "persian girl names", impressions: 5000, clicks: 300, position: 5 }] }] };
  it("never joins a tracked question onto a unit by shared words alone: the three-token join is deleted", () => {
    const units = canonicalDemandUnits({ ...base, ...gsc, observations: [
      { promptId: "p9", promptText: "persian girl cat names", creditedOwn: false, citations: [{ domain: "rival.example", url: "https://rival.example/c" }], fanOutQueries: null, engine: "chatgpt", day: "2026-08-01" }] });
    const search = units.find((u) => u.label === "persian girl names")!;
    expect(search.prompts).toEqual([]); // three shared words are not the same audience
    const ai = units.find((u) => u.seededBy === "ai")!; // the unjoined question seeds ITS OWN unit instead of vanishing
    expect([ai.label, ai.audience.impressions90d, ai.audience.aiAnswers]).toEqual(["persian girl cat names", 0, 1]); // unknown volume stays unknown, never borrowed
  });
  it("joins a question whose OWN fan-out is the search, and stamps who seeded what", () => {
    const units = canonicalDemandUnits({ ...base, ...gsc, observations: [
      { promptId: "p1", promptText: "What names do Persian families pick for daughters?", creditedOwn: false, citations: [{ domain: "rival.example", url: "https://rival.example/n" }], fanOutQueries: ["persian girl names"], engine: "chatgpt", day: "2026-08-01" }] });
    const search = units.find((u) => u.label === "persian girl names")!;
    expect([search.prompts.length, search.seededBy]).toEqual([1, "both"]); // the assistant itself ran this exact search while answering
  });
  it("seeds a unit from a fan-out that recurs across assistants and days with no Google rows at all", () => {
    const runs = ["chatgpt", "gemini"].map((engine, i) => (
      { promptId: "p1", promptText: "What goes on a haft seen table?", creditedOwn: true, citations: [{ domain: "x.example", url: "https://x.example/h" }], fanOutQueries: ["haft seen table items list"], engine, day: `2026-08-0${i + 2}` }));
    const fan = canonicalDemandUnits({ ...base, observations: runs }).find((u) => u.label === "haft seen table items list");
    expect(fan).toBeDefined(); // two assistants across two days: recurring demand no Google row reports
    expect([fan!.seededBy, fan!.audience.impressions90d]).toEqual(["ai", 0]);});
  it("carries the parent questions the search was issued from, so the AEO path can join it at all", () => {
    // A UNIT WITH AN EMPTY `prompts` LIST IS UNREACHABLE: every consumer joins by prompt identity, so the strongest recurring search in the account sat in the demand layer and never reached a page or a refusal.
    const runs = ["2026-08-01", "2026-08-02", "2026-08-03"].map((day) => (
      { promptId: "p9", promptText: "Where do families buy a haft seen set?", creditedOwn: false,
        citations: [{ domain: "rival.example", url: "https://rival.example/h" }], fanOutQueries: ["haft seen set delivery"], engine: "chatgpt", day }));
    const fan = canonicalDemandUnits({ ...base, observations: runs }).find((u) => u.label === "haft seen set delivery")!; expect(fan.prompts.map((p) => [p.promptId, p.answers, p.credited])).toEqual([["p9", 3, 0]]);
    expect(fan.audience.aiAnswers).toBe(3); // the answers behind it, so the ranker is not weighing a bare label
    expect(fan.prompts[0]!.citedRivals[0]!.domain).toBe("rival.example"); // who takes the credit instead
  });
  it("refuses to seed a unit from one same-day sighting on two assistants", () => {
    const runs = ["chatgpt", "gemini"].map((engine) => (
      { promptId: "p1", promptText: "What goes on a haft seen table?", creditedOwn: true, citations: [{ domain: "x.example", url: "https://x.example/h" }], fanOutQueries: ["one off curiosity"], engine, day: "2026-08-02" }));
    expect(canonicalDemandUnits({ ...base, observations: runs }).find((u) => u.label === "one off curiosity")).toBeUndefined();});});
