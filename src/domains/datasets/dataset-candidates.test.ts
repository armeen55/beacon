import { describe, it, expect } from "vitest";
import {
  detectTemplateFamilies,
  buildPageFamilyCandidate,
  buildQueryUniverseCandidate,
  buildFanoutVolumeCandidate,
  rankDatasetCandidates,
  MIN_FAMILY_SIZE,
  type SnapshotForFamilyDetection,
  type DatasetCandidate,
} from "./dataset-candidates";

const NOW = new Date("2026-07-02T00:00:00Z");

function snap(over: Partial<SnapshotForFamilyDetection> = {}): SnapshotForFamilyDetection {
  return {
    url: "https://example.com/thing-1",
    title: "Thing One",
    h2_list: ["History of Thing One", "Meaning of Thing One"],
    schema_types: ["Article"],
    word_count: 500,
    ...over,
  };
}

describe("detectTemplateFamilies", () => {
  it("clusters pages sharing schema types + H2 shape into one family", () => {
    const snapshots = Array.from({ length: MIN_FAMILY_SIZE }, (_, i) =>
      snap({ url: `https://example.com/thing-${i}`, title: `Thing ${i}` }),
    );
    const families = detectTemplateFamilies(snapshots);
    expect(families).toHaveLength(1);
    expect(families[0]!.members).toHaveLength(MIN_FAMILY_SIZE);
    expect(families[0]!.sharedShapeTokens).toEqual(expect.arrayContaining(["history", "meaning"]));
  });

  it("never groups by topic word - two different shapes stay separate families", () => {
    const historyFamily = Array.from({ length: MIN_FAMILY_SIZE }, (_, i) =>
      snap({ url: `https://example.com/a-${i}`, h2_list: ["History"], schema_types: ["Article"] }),
    );
    const recipeFamily = Array.from({ length: MIN_FAMILY_SIZE }, (_, i) =>
      snap({ url: `https://example.com/b-${i}`, h2_list: ["Recipe", "Ingredients"], schema_types: ["Recipe"] }),
    );
    const families = detectTemplateFamilies([...historyFamily, ...recipeFamily]);
    expect(families).toHaveLength(2);
  });

  it("drops a family below the minimum size", () => {
    const tooFew = Array.from({ length: MIN_FAMILY_SIZE - 1 }, (_, i) => snap({ url: `https://example.com/x-${i}` }));
    expect(detectTemplateFamilies(tooFew)).toEqual([]);
  });

  it("ignores a page with no structural signal (no schema, fewer than 2 shape tokens)", () => {
    const thin = Array.from({ length: MIN_FAMILY_SIZE + 2 }, (_, i) =>
      snap({ url: `https://example.com/thin-${i}`, h2_list: ["Random Heading"], schema_types: [] }),
    );
    expect(detectTemplateFamilies(thin)).toEqual([]);
  });

  it("is tenant-agnostic - the same detector groups an unrelated vocabulary with no code change", () => {
    const snapshots = Array.from({ length: MIN_FAMILY_SIZE }, (_, i) =>
      snap({
        url: `https://example.com/city-${i}`,
        title: `City ${i}`,
        h2_list: ["Population", "Climate"],
        schema_types: ["Place"],
      }),
    );
    const families = detectTemplateFamilies(snapshots);
    expect(families).toHaveLength(1);
    expect(families[0]!.sharedShapeTokens).toEqual(expect.arrayContaining(["population", "climate"]));
  });
});

describe("buildPageFamilyCandidate", () => {
  it("builds a candidate with real demand summed across member pages", () => {
    const members = Array.from({ length: MIN_FAMILY_SIZE }, (_, i) => snap({ url: `https://example.com/thing-${i}` }));
    const families = detectTemplateFamilies(members);
    const demandByUrl = new Map(members.map((m, i) => [m.url, (i + 1) * 100]));
    const candidate = buildPageFamilyCandidate(families[0]!, demandByUrl, NOW);
    expect(candidate).not.toBeNull();
    expect(candidate!.rowCountEstimate).toBe(MIN_FAMILY_SIZE);
    expect(candidate!.demandScore).toBe(100 + 200 + 300 + 400 + 500);
    expect(candidate!.methodologyLine).toContain("2026-07-02");
    expect(candidate!.whyItWins).toMatch(/\d/); // a concrete number, never vague
    expect(candidate!.datasetTag).toBe("dataset_page");
  });

  it("still returns a candidate with no demand data (row count alone is a real signal)", () => {
    const members = Array.from({ length: MIN_FAMILY_SIZE }, (_, i) => snap({ url: `https://example.com/thing-${i}` }));
    const families = detectTemplateFamilies(members);
    const candidate = buildPageFamilyCandidate(families[0]!, new Map(), NOW);
    expect(candidate).not.toBeNull();
    expect(candidate!.demandScore).toBe(0);
    expect(candidate!.whyItWins).not.toMatch(/impressions/);
  });

  it("returns null for a family under the minimum size", () => {
    const tinyFamily = {
      fingerprint: "x",
      members: [snap()],
      sharedShapeTokens: ["history"],
      sharedSchemaTypes: [],
    };
    expect(buildPageFamilyCandidate(tinyFamily, new Map(), NOW)).toBeNull();
  });

  it("never emits an em or en dash in any candidate text", () => {
    const members = Array.from({ length: MIN_FAMILY_SIZE }, (_, i) => snap({ url: `https://example.com/thing-${i}` }));
    const families = detectTemplateFamilies(members);
    const candidate = buildPageFamilyCandidate(families[0]!, new Map([[members[0]!.url, 500]]), NOW)!;
    const text = [candidate.title, candidate.description, candidate.methodologyLine, candidate.whyItWins].join(" ");
    expect(text).not.toMatch(/[–—]/);
  });

  it("falls back to the shared schema type for the title when there are no H2 shape tokens (real prod shape: ImageObject/Product galleries with only a generic 'Iranopedia' H2)", () => {
    const members = Array.from({ length: MIN_FAMILY_SIZE }, (_, i) =>
      snap({ url: `https://example.com/item-${i}`, h2_list: ["Iranopedia"], schema_types: ["Product"] }),
    );
    const families = detectTemplateFamilies(members);
    expect(families).toHaveLength(1);
    expect(families[0]!.sharedShapeTokens).toEqual([]);
    const candidate = buildPageFamilyCandidate(families[0]!, new Map(), NOW)!;
    expect(candidate.title).toContain("Product");
    expect(candidate.title).not.toContain("Profile");
  });
});

describe("buildQueryUniverseCandidate", () => {
  it("builds a candidate from the tenant's own GSC query universe", () => {
    const queries = Array.from({ length: 20 }, (_, i) => `query ${i}`);
    const candidate = buildQueryUniverseCandidate({ gscQueries: queries, fanoutQueries: [], totalImpressions: 5000 }, NOW);
    expect(candidate).not.toBeNull();
    expect(candidate!.rowCountEstimate).toBe(20);
    expect(candidate!.demandScore).toBe(5000);
    expect(candidate!.kind).toBe("beacon_aggregate");
    expect(candidate!.methodologyLine).toContain("Google Search Console");
    expect(candidate!.methodologyLine).toContain("2026-07-02");
  });

  it("returns null below the minimum row count (not a real dataset yet)", () => {
    expect(buildQueryUniverseCandidate({ gscQueries: ["a", "b"], fanoutQueries: [], totalImpressions: 10 }, NOW)).toBeNull();
  });
});

describe("buildFanoutVolumeCandidate", () => {
  it("builds a candidate from Beacon's own AI fanout tracking", () => {
    const fanouts = Array.from({ length: 12 }, (_, i) => `sub question ${i}`);
    const candidate = buildFanoutVolumeCandidate({ gscQueries: [], fanoutQueries: fanouts, totalImpressions: 0 }, NOW);
    expect(candidate).not.toBeNull();
    expect(candidate!.rowCountEstimate).toBe(12);
    expect(candidate!.demandScore).toBe(12);
    expect(candidate!.methodologyLine).toContain("AI prompt tracking");
  });

  it("returns null below the minimum row count", () => {
    expect(buildFanoutVolumeCandidate({ gscQueries: [], fanoutQueries: ["one"], totalImpressions: 0 }, NOW)).toBeNull();
  });
});

describe("rankDatasetCandidates", () => {
  function cand(demandScore: number, rowCountEstimate = 5): DatasetCandidate {
    return {
      slug: `c-${demandScore}-${rowCountEstimate}`,
      title: "t",
      description: "d",
      kind: "page_family",
      columns: [],
      rowCountEstimate,
      sourceFamilies: [],
      methodologyLine: "m",
      whyItWins: "w",
      demandScore,
      datasetTag: "dataset_page",
    };
  }

  it("ranks by demand score, highest first, capped to topN", () => {
    const out = rankDatasetCandidates([cand(10), cand(500), cand(200), cand(1)], 3);
    expect(out.map((c) => c.demandScore)).toEqual([500, 200, 10]);
  });

  it("breaks ties by row count", () => {
    const out = rankDatasetCandidates([cand(100, 3), cand(100, 9)], 2);
    expect(out[0]!.rowCountEstimate).toBe(9);
  });
});
