import { describe, expect, it } from "vitest";

import type { HubTerm, TopicHub } from "./build-hubs";
import { buildCoverageMap, coverageCandidateSeeds, hubSummaryLine } from "./coverage-map";

function term(text: string, demand: number, over: Partial<HubTerm> = {}): HubTerm {
  return { text, demand, source: "search", answeredBy: null, aiChecked: false, aiCited: false, ...over };
}

function hub(key: string, label: string, terms: HubTerm[]): TopicHub {
  return { key, label, terms, totalDemand: terms.reduce((s, t) => s + t.demand, 0) };
}

const NOWRUZ = hub("hub:nowruz", "Nowruz", [
  term("nowruz 2026 date", 900, { answeredBy: "https://x.com/nowruz", aiChecked: true, aiCited: true }),
  term("nowruz table setup", 500, { answeredBy: "https://x.com/haft-sin" }),
  term("nowruz gifts ideas", 400),
  term("nowruz greetings phrases", 300, { aiChecked: true, aiCited: false }),
  term("nowruz fire jumping meaning", 100),
]);

describe("buildCoverageMap", () => {
  it("computes per-hub totals, coverage percent, and AI joins", () => {
    const map = buildCoverageMap({ hubs: [NOWRUZ] });
    expect(map.rows).toHaveLength(1);
    const r = map.rows[0]!;
    expect(r.totalQuestions).toBe(5);
    expect(r.answeredCount).toBe(2);
    expect(r.coveragePercent).toBe(40);
    expect(r.aiCheckedCount).toBe(2);
    expect(r.aiCitedCount).toBe(1);
  });

  it("ranks top missing by demand desc and caps at 3", () => {
    const big = hub("hub:big", "Big", [
      term("q answered", 1000, { answeredBy: "https://x.com/a" }),
      term("missing one", 900),
      term("missing two", 800),
      term("missing three", 700),
      term("missing four", 600),
    ]);
    const r = buildCoverageMap({ hubs: [big] }).rows[0]!;
    expect(r.topMissing.map((m) => m.text)).toEqual(["missing one", "missing two", "missing three"]);
  });

  it("attaches a create-page pointer when a demand-graph move matches by tokens", () => {
    const map = buildCoverageMap({
      hubs: [NOWRUZ],
      createPageMoves: [
        { label: "nowruz gifts", demandKey: "gap:gifts-nowruz" },
        { label: "unrelated eggplant stew", demandKey: "gap:eggplant" },
      ],
    });
    const missing = map.rows[0]!.topMissing;
    const gifts = missing.find((m) => m.text === "nowruz gifts ideas")!;
    expect(gifts.createPage).toEqual({ label: "nowruz gifts", demandKey: "gap:gifts-nowruz" });
    const greetings = missing.find((m) => m.text === "nowruz greetings phrases")!;
    expect(greetings.createPage).toBeNull();
  });

  it("bounds output to maxHubs with deterministic tie-breaks", () => {
    const hubs = Array.from({ length: 15 }, (_, i) =>
      hub(`hub:h${i}`, `Hub ${i}`, [term(`topic ${i} alpha`, 10), term(`topic ${i} beta`, 5)]),
    );
    const map = buildCoverageMap({ hubs, maxHubs: 12 });
    expect(map.rows).toHaveLength(12);
    expect(map.rows[0]!.key).toBe("hub:h0");
  });

  it("ranks hubs by opportunity (unanswered + AI-uncited demand), not by trophy demand", () => {
    const trophy = hub("hub:trophy", "Trophy", [
      term("owned one", 9000, { answeredBy: "https://x.com/1" }),
      term("owned two", 8000, { answeredBy: "https://x.com/2" }),
    ]);
    const gap = hub("hub:gap", "Gap", [
      term("missing big", 500),
      term("owned small", 100, { answeredBy: "https://x.com/3" }),
    ]);
    const aiGap = hub("hub:aigap", "Ai Gap", [
      term("checked not cited", 300, { answeredBy: "https://x.com/4", aiChecked: true, aiCited: false }),
      term("owned quiet", 50, { answeredBy: "https://x.com/5" }),
    ]);
    const map = buildCoverageMap({ hubs: [trophy, gap, aiGap] });
    expect(map.rows.map((r) => r.key)).toEqual(["hub:gap", "hub:aigap", "hub:trophy"]);
  });

  it("counts the other bucket honestly", () => {
    const map = buildCoverageMap({
      hubs: [NOWRUZ],
      other: hub("hub:other", "Everything else", [term("stray one", 5), term("stray two", 3)]),
    });
    expect(map.otherCount).toBe(2);
  });

  it("aggregates map totals across rows", () => {
    const map = buildCoverageMap({ hubs: [NOWRUZ] });
    expect(map.totalQuestions).toBe(5);
    expect(map.totalAnswered).toBe(2);
  });
});

describe("hubSummaryLine (the operator copy contract)", () => {
  it("speaks first person with a concrete number and the AI join", () => {
    const r = buildCoverageMap({ hubs: [NOWRUZ] }).rows[0]!;
    expect(r.summary).toContain("Nowruz: I found 5 questions people ask; you answer 2 (40 percent).");
    expect(r.summary).toContain("AI recommends you on 1 of 2 I checked.");
    expect(r.summary).toContain("missing pages that would lift you most:");
  });

  it("is honest about zero AI observations (never 0 of 0)", () => {
    const quiet = hub("hub:quiet", "Quiet", [term("a b topic", 10), term("a b other", 5)]);
    const r = buildCoverageMap({ hubs: [quiet] }).rows[0]!;
    expect(r.summary).toContain("I have not checked this topic with AI yet.");
    expect(r.summary).not.toContain("0 of 0");
  });

  it("celebrates full coverage in one sentence", () => {
    const full = hub("hub:full", "Full", [
      term("covered one", 10, { answeredBy: "https://x.com/1" }),
      term("covered two", 5, { answeredBy: "https://x.com/2" }),
    ]);
    const r = buildCoverageMap({ hubs: [full] }).rows[0]!;
    expect(r.summary).toContain("You answer every question I found here.");
  });

  it("uses singular copy for one missing page", () => {
    const one = hub("hub:one", "One", [
      term("covered", 10, { answeredBy: "https://x.com/1" }),
      term("gap question", 5),
    ]);
    const r = buildCoverageMap({ hubs: [one] }).rows[0]!;
    expect(r.summary).toContain("The missing page that would lift you most: gap question.");
  });

  it("never emits em or en dashes or lab words", () => {
    const line = hubSummaryLine({
      key: "hub:x",
      label: "X",
      totalQuestions: 42,
      answeredCount: 30,
      coveragePercent: 71,
      aiCheckedCount: 19,
      aiCitedCount: 8,
      topMissing: [{ text: "missing page", demand: 10, createPage: null }],
    });
    expect(line).not.toMatch(/[\u2013\u2014]/);
    expect(line.toLowerCase()).not.toMatch(/\b(serp|experiment|baseline|treatment|reservation)\b/);
    expect(line).toContain("I found 42 questions people ask; you answer 30 (71 percent). AI recommends you on 8 of 19 I checked.");
  });
});

describe("coverageCandidateSeeds", () => {
  it("flattens top missing questions across hubs, demand desc, capped", () => {
    const map = buildCoverageMap({
      hubs: [
        NOWRUZ,
        hub("hub:tea", "Persian Tea", [
          term("persian tea brewing", 2000),
          term("persian tea brands", 1500, { answeredBy: "https://x.com/tea" }),
          term("persian tea benefits", 50),
        ]),
      ],
    });
    const seeds = coverageCandidateSeeds(map, 3);
    expect(seeds).toHaveLength(3);
    expect(seeds[0]!.question).toBe("persian tea brewing");
    expect(seeds[0]!.hubLabel).toBe("Persian Tea");
    expect(seeds[1]!.question).toBe("nowruz gifts ideas");
  });
});
