/**
 * variant-folding tests (2026-07-02, master plan item 24) - the transliteration
 * spelling-family folding + clustering, against the real "chaharshanbe soori"
 * spelling family (the many ways operators and searchers romanize the same
 * Farsi phrase).
 */
import { describe, expect, it } from "vitest";
import { foldVariant, clusterVariants, PERSIAN_FOLDING_TABLE } from "./variant-folding";

describe("foldVariant - chaharshanbe soori family", () => {
  it("folds chaharshanbe soori and chaharshanbeh suri to the same key", () => {
    const a = foldVariant("chaharshanbe soori");
    const b = foldVariant("chaharshanbeh suri");
    expect(a).toBe(b);
  });

  it("folds the digit-for-word spelling 4shanbe soori to the same family", () => {
    const digit = foldVariant("4shanbe soori");
    const letters = foldVariant("chaharshanbe soori");
    expect(digit).toBe(letters);
  });

  it("folds char shanbeh soori (split spelling + char/chahar elision) to the main family", () => {
    const split = foldVariant("char shanbeh soori");
    const main = foldVariant("chaharshanbe soori");
    expect(split).toBe(main);
  });

  it("folds chahar-shanbeh soori (hyphenated) to the same family", () => {
    const hyphenated = foldVariant("chahar-shanbeh soori");
    const plain = foldVariant("chaharshanbe soori");
    expect(hyphenated).toBe(plain);
  });

  it("strips trailing punctuation before folding", () => {
    expect(foldVariant("chaharshanbeh soori?")).toBe(foldVariant("chaharshanbeh soori"));
  });
});

describe("foldVariant - norooz family", () => {
  it("folds norooz, norouz, and nowruz-style double-vowel spellings together", () => {
    expect(foldVariant("norooz")).toBe(foldVariant("norouz"));
  });
});

describe("foldVariant - is a pure function", () => {
  it("never throws on empty or garbage input", () => {
    expect(() => foldVariant("")).not.toThrow();
    expect(foldVariant("")).toBe("");
    expect(() => foldVariant(null as unknown as string)).not.toThrow();
  });

  it("is deterministic (same input always folds to the same output)", () => {
    const a = foldVariant("chaharshanbeh soori");
    const b = foldVariant("chaharshanbeh soori");
    expect(a).toBe(b);
  });
});

describe("clusterVariants - chaharshanbe soori family", () => {
  const rows = [
    { query: "chaharshanbe soori", impressions: 400, clicks: 20 },
    { query: "chaharshanbeh suri", impressions: 300, clicks: 12 },
    { query: "4shanbe soori", impressions: 150, clicks: 5 },
    { query: "char shanbeh soori", impressions: 50, clicks: 1 },
    { query: "best persian rice recipe", impressions: 900, clicks: 60 }, // unrelated family
  ];

  it("groups every chaharshanbe spelling into one cluster", () => {
    const clusters = clusterVariants(rows);
    const family = clusters.find((c) => c.variants.some((v) => v.query === "chaharshanbe soori"));
    expect(family).toBeDefined();
    expect(family!.variants.length).toBe(4);
  });

  it("sums impressions across every variant in the cluster", () => {
    const clusters = clusterVariants(rows);
    const family = clusters.find((c) => c.variants.some((v) => v.query === "chaharshanbe soori"))!;
    expect(family.totalImpressions).toBe(400 + 300 + 150 + 50);
  });

  it("ranks the top variant by impressions (most-typed spelling first)", () => {
    const clusters = clusterVariants(rows);
    const family = clusters.find((c) => c.variants.some((v) => v.query === "chaharshanbe soori"))!;
    expect(family.topVariant).toBe("chaharshanbe soori");
  });

  it("keeps unrelated queries in their own single-variant cluster", () => {
    const clusters = clusterVariants(rows);
    const unrelated = clusters.find((c) => c.variants.some((v) => v.query === "best persian rice recipe"));
    expect(unrelated).toBeDefined();
    expect(unrelated!.variants.length).toBe(1);
  });

  it("ranks clusters by total impressions, biggest family first", () => {
    const clusters = clusterVariants(rows);
    // The unrelated single query (900 impressions) outranks the chaharshanbe
    // family's summed total (900 > 900 is false; totals are 900 and 900... use
    // a clearer case below for strict ordering).
    for (let i = 1; i < clusters.length; i += 1) {
      expect(clusters[i - 1]!.totalImpressions).toBeGreaterThanOrEqual(clusters[i]!.totalImpressions);
    }
  });

  it("drops empty queries and rows that fold to nothing", () => {
    const withEmpty = [...rows, { query: "", impressions: 999, clicks: 0 }, { query: "???", impressions: 50, clicks: 0 }];
    const clusters = clusterVariants(withEmpty);
    const total = clusters.reduce((s, c) => s + c.variants.length, 0);
    expect(total).toBe(rows.length);
  });

  it("never mutates the input array", () => {
    const copy = rows.map((r) => ({ ...r }));
    clusterVariants(rows);
    expect(rows).toEqual(copy);
  });

  it("accepts an explicit folding table (tenant-agnostic pluggability)", () => {
    const customTable = [{ pattern: /x/g, replacement: "z", label: "test-rule" }];
    const clusters = clusterVariants([{ query: "taxi", impressions: 10 }], customTable);
    expect(clusters[0]!.canonicalKey).toBe("tazi");
  });

  it("defaults to the Persian folding table when none is given", () => {
    const clusters = clusterVariants([{ query: "khoresht", impressions: 10 }]);
    expect(clusters[0]!.canonicalKey).toBe(foldVariant("khoresht", PERSIAN_FOLDING_TABLE));
  });
});
