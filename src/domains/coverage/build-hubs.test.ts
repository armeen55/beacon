import { describe, expect, it } from "vitest";

import { buildTopicHubs, sharedTokenCount, tokenizeTopic, type HubTerm } from "./build-hubs";

function term(text: string, demand: number, over: Partial<HubTerm> = {}): HubTerm {
  return { text, demand, source: "search", answeredBy: null, aiChecked: false, aiCited: false, ...over };
}

describe("tokenizeTopic", () => {
  it("tokenizes English, drops stopwords + pure numbers + short tokens", () => {
    expect(tokenizeTopic("What is the best haft sin table for 2026?")).toEqual(["haft", "sin", "table"]);
  });

  it("keeps content-bearing words the stopword list must not eat", () => {
    expect(tokenizeTopic("persian new year")).toContain("year");
    expect(tokenizeTopic("persian new year")).toContain("persian");
  });

  it("tokenizes Persian text (Unicode-aware, not ASCII-blind)", () => {
    const toks = tokenizeTopic("سفره هفت سین چیست");
    expect(toks).toContain("سفره");
    expect(toks).toContain("هفت");
    expect(toks).toContain("سین");
    // the Persian question word is a stopword
    expect(toks).not.toContain("چیست");
  });

  it("drops Persian digits as pure numbers", () => {
    expect(tokenizeTopic("نوروز ۱۴۰۵")).toEqual(["نوروز"]);
  });

  it("normalizes Arabic yeh/kaf to Persian forms so variants match", () => {
    // Arabic yeh (U+064A) vs Persian yeh (U+06CC)
    const arabic = tokenizeTopic("ايراني");
    const persian = tokenizeTopic("ایرانی");
    expect(arabic).toEqual(persian);
  });

  it("dedupes repeated tokens preserving first-appearance order", () => {
    expect(tokenizeTopic("nowruz nowruz table")).toEqual(["nowruz", "table"]);
  });

  it("returns [] for empty input", () => {
    expect(tokenizeTopic("")).toEqual([]);
  });

  it("drops first-person contractions (curly or straight apostrophe)", () => {
    expect(tokenizeTopic("I'm hosting a Nowruz celebration")).toEqual(["hosting", "nowruz", "celebration"]);
    expect(tokenizeTopic("I’m dating someone Persian")).toEqual(["dating", "someone", "persian"]);
  });
});

describe("sharedTokenCount", () => {
  it("counts intersection", () => {
    expect(sharedTokenCount(new Set(["a", "b", "c"]), new Set(["b", "c", "d"]))).toBe(2);
    expect(sharedTokenCount(new Set(["a"]), new Set(["b"]))).toBe(0);
  });
});

describe("buildTopicHubs", () => {
  it("clusters terms sharing 2+ tokens; label comes from the highest-demand term", () => {
    const { hubs } = buildTopicHubs(
      [
        term("haft sin table setup", 100),
        term("haft sin table meaning", 900),
        term("haft sin items list", 300),
        term("chelo kabab recipe", 50),
      ],
      { minClusterSize: 3 },
    );
    expect(hubs).toHaveLength(1);
    expect(hubs[0]!.terms).toHaveLength(3);
    expect(hubs[0]!.label).toBe("Haft Sin Table Meaning");
    expect(hubs[0]!.totalDemand).toBe(1300);
  });

  it("joins a single-token term to a multi-token term on 1 shared token", () => {
    const { hubs } = buildTopicHubs(
      [term("nowruz", 500), term("nowruz 2026 date", 400), term("nowruz celebration food", 100)],
      { minClusterSize: 3 },
    );
    expect(hubs).toHaveLength(1);
    expect(hubs[0]!.terms.map((t) => t.text)).toEqual(["nowruz", "nowruz 2026 date", "nowruz celebration food"]);
  });

  it("does NOT merge topics that share only 1 token when both are multi-token", () => {
    const { hubs, other } = buildTopicHubs(
      [term("persian cat names", 100), term("persian carpet history", 90)],
      { minClusterSize: 1 },
    );
    expect(hubs).toHaveLength(2);
    expect(other).toBeNull();
  });

  it("sends sub-threshold clusters to the other bucket", () => {
    const { hubs, other } = buildTopicHubs(
      [
        term("haft sin table setup", 100),
        term("haft sin table meaning", 900),
        term("haft sin items list", 300),
        term("chelo kabab recipe", 50),
        term("tehran metro map", 10),
      ],
      { minClusterSize: 3 },
    );
    expect(hubs).toHaveLength(1);
    expect(other).not.toBeNull();
    expect(other!.key).toBe("hub:other");
    expect(other!.terms.map((t) => t.text)).toEqual(["chelo kabab recipe", "tehran metro map"]);
  });

  it("clusters Persian terms by shared Persian tokens", () => {
    const { hubs } = buildTopicHubs(
      [term("سفره هفت سین", 300), term("هفت سین نوروز", 200), term("چیدمان هفت سین", 100)],
      { minClusterSize: 3 },
    );
    expect(hubs).toHaveLength(1);
    expect(hubs[0]!.terms).toHaveLength(3);
    expect(hubs[0]!.label).toBe("سفره هفت سین");
  });

  it("dedupes identical text across sources, merging flags and keeping max demand", () => {
    const { hubs } = buildTopicHubs(
      [
        term("haft sin table", 100, { aiChecked: true, aiCited: false }),
        term("Haft Sin Table", 400, { answeredBy: "https://x.com/haft-sin", aiCited: true, aiChecked: true }),
        term("haft sin history", 50),
        term("haft sin items", 20),
      ],
      { minClusterSize: 3 },
    );
    expect(hubs).toHaveLength(1);
    const merged = hubs[0]!.terms.find((t) => t.text.toLowerCase() === "haft sin table")!;
    expect(hubs[0]!.terms).toHaveLength(3);
    expect(merged.demand).toBe(400);
    expect(merged.aiChecked).toBe(true);
    expect(merged.aiCited).toBe(true);
    expect(merged.answeredBy).toBe("https://x.com/haft-sin");
  });

  it("orders hubs by total demand desc, deterministically across input order", () => {
    const input = [
      term("haft sin table setup", 10),
      term("haft sin table meaning", 20),
      term("haft sin items", 30),
      term("persian cat names list", 500),
      term("persian cat breeds guide", 400),
      term("persian cat food ideas", 300),
    ];
    const a = buildTopicHubs(input, { minClusterSize: 3 });
    const b = buildTopicHubs([...input].reverse(), { minClusterSize: 3 });
    expect(a.hubs.map((h) => h.key)).toEqual(b.hubs.map((h) => h.key));
    expect(a.hubs[0]!.totalDemand).toBe(1200);
    expect(a.hubs[1]!.totalDemand).toBe(60);
  });

  it("prunes corpus glue tokens on large corpora so a qualifier cannot chain everything", () => {
    // 40 terms; "persian" is in every one (df 100% > 25%) so it is glue; each
    // topic pair still shares its own 2 tokens.
    const input: HubTerm[] = [];
    for (let i = 0; i < 10; i++) input.push(term(`persian cat names volume ${String.fromCharCode(97 + i)}`, 100 - i));
    for (let i = 0; i < 10; i++) input.push(term(`persian carpet history era ${String.fromCharCode(97 + i)}`, 80 - i));
    for (let i = 0; i < 10; i++) input.push(term(`persian food recipes dish ${String.fromCharCode(97 + i)}`, 60 - i));
    for (let i = 0; i < 10; i++) input.push(term(`persian music artists singer ${String.fromCharCode(97 + i)}`, 40 - i));
    const { hubs } = buildTopicHubs(input, { minClusterSize: 3 });
    expect(hubs.length).toBeGreaterThanOrEqual(4);
    // no mega hub swallowed everything
    expect(Math.max(...hubs.map((h) => h.terms.length))).toBeLessThanOrEqual(10);
  });

  it("clamps very long labels on a word boundary", () => {
    const long = "ceo or owner of persian rug yazd at yazd province yazd char sooq bazaar street iran";
    const { hubs } = buildTopicHubs(
      [term(long, 100), term("persian rug yazd shop", 50), term("yazd rug bazaar hours", 25)],
      { minClusterSize: 3 },
    );
    expect(hubs).toHaveLength(1);
    expect(hubs[0]!.label.length).toBeLessThanOrEqual(63);
    expect(hubs[0]!.label.endsWith("...")).toBe(true);
  });

  it("splits a chained mega component so no hub exceeds the size cap", () => {
    // 100 terms chained a0 a1 a2 / a1 a2 a3 / ... : every neighbor pair shares
    // 2 tokens, welding one giant component; token df stays tiny (<= 3) so
    // glue pruning cannot help. The anchor split must break it up.
    const input: HubTerm[] = [];
    for (let i = 0; i < 100; i++) input.push(term(`a${i} a${i + 1} a${i + 2}`, 1000 - i));
    const { hubs, other } = buildTopicHubs(input, { minClusterSize: 2 });
    const total = hubs.reduce((s, h) => s + h.terms.length, 0) + (other?.terms.length ?? 0);
    expect(total).toBe(100); // nothing lost
    expect(Math.max(...hubs.map((h) => h.terms.length), 0)).toBeLessThanOrEqual(60);
  });

  it("is deterministic after a mega-component split", () => {
    const input: HubTerm[] = [];
    for (let i = 0; i < 80; i++) input.push(term(`b${i} b${i + 1} b${i + 2}`, 500 - i));
    const a = buildTopicHubs(input, { minClusterSize: 2 });
    const b = buildTopicHubs([...input].reverse(), { minClusterSize: 2 });
    expect(a.hubs.map((h) => `${h.key}:${h.terms.length}`)).toEqual(b.hubs.map((h) => `${h.key}:${h.terms.length}`));
  });

  it("folds em and en dashes in source texts to plain hyphens", () => {
    const em = String.fromCharCode(0x2014);
    const en = String.fromCharCode(0x2013);
    const { hubs } = buildTopicHubs(
      [
        term(`persian wedding ${em} what to expect`, 100),
        term(`persian wedding gifts ${en} ideas`, 50),
        term("persian wedding sofreh", 25),
      ],
      { minClusterSize: 3 },
    );
    expect(hubs).toHaveLength(1);
    expect(JSON.stringify(hubs)).not.toMatch(/[\u2013\u2014]/);
    expect(hubs[0]!.terms[0]!.text).toBe("persian wedding - what to expect");
  });

  it("returns empty result for no terms and never emits em or en dashes", () => {
    expect(buildTopicHubs([])).toEqual({ hubs: [], other: null });
    const { hubs, other } = buildTopicHubs(
      [term("haft sin table", 1), term("haft sin items", 1), term("haft sin meaning", 1), term("solo topic", 1)],
      { minClusterSize: 3 },
    );
    const all = JSON.stringify({ hubs, other });
    expect(all).not.toMatch(/[\u2013\u2014]/);
  });
});
