import { describe, it, expect } from "vitest";
import {
  buildGroundedNumbers,
  allowNumbers,
  extractNumericTokens,
  findUngroundedNumbers,
  groundedNumberList,
  stripThousandsSeparators,
} from "./numeric-fidelity";

describe("numeric-fidelity - tokenization", () => {
  it("strips thousands separators between digits only", () => {
    expect(stripThousandsSeparators("5,400 visits, then rest")).toBe("5400 visits, then rest");
  });

  it("extracts decimals, percents, and percent-words as single tokens", () => {
    const tokens = extractNumericTokens("CTR 2.5% on 5,400 impressions, 45 percent of clicks");
    expect(tokens.map((t) => t.normalized)).toEqual(["2.5", "5400", "45"]);
    expect(tokens[0]!.isPercent).toBe(true);
    expect(tokens[1]!.isPercent).toBe(false);
    expect(tokens[2]!.isPercent).toBe(true);
  });
});

describe("numeric-fidelity - formatting tolerance (the mandate examples)", () => {
  it("5,400 in the output matches 5400 in the evidence (and vice versa)", () => {
    expect(findUngroundedNumbers("The page earned 5,400 impressions.", buildGroundedNumbers("gsc shows 5400 impressions"))).toEqual([]);
    expect(findUngroundedNumbers("The page earned 5400 impressions.", buildGroundedNumbers("gsc shows 5,400 impressions"))).toEqual([]);
  });

  it("percentages match ROUNDED: output 45% is grounded by evidence 44.6%", () => {
    expect(findUngroundedNumbers("About 45% of searches click.", buildGroundedNumbers("ctr is 44.6% this month"))).toEqual([]);
  });

  it("trailing zeros normalize: 3.50 matches 3.5", () => {
    expect(findUngroundedNumbers("position 3.50 on average", buildGroundedNumbers("avg position 3.5"))).toEqual([]);
  });

  it("still REJECTS a genuinely invented number", () => {
    const out = findUngroundedNumbers("The tradition dates to 1847.", buildGroundedNumbers("sofreh aghd ceremony"));
    expect(out).toEqual(["1847"]);
  });

  it("percent tolerance does not rescue a far-off figure (80% vs 44.6%)", () => {
    expect(findUngroundedNumbers("80% of searches click.", buildGroundedNumbers("ctr is 44.6%"))).toEqual(["80%"]);
  });
});

describe("numeric-fidelity - legacy compatibility (strictly more permissive)", () => {
  it("keeps the single-digit floor: lone digits are never flagged", () => {
    expect(findUngroundedNumbers("Top 3 of 5 items", buildGroundedNumbers("nothing numeric"))).toEqual([]);
  });

  it("accepts a token whose >=2-digit runs are each grounded (legacy digit-run rule)", () => {
    // Legacy accepted "12.34" when "12" and "34" both appeared as digit runs.
    expect(findUngroundedNumbers("about 12.34 units", buildGroundedNumbers("12 units and 34 boxes"))).toEqual([]);
  });

  it("allowNumbers whitelists structural constants (years, proof windows)", () => {
    const ledger = allowNumbers(buildGroundedNumbers(""), ["2026", "7", "14", "28"]);
    expect(findUngroundedNumbers("Measured over 14 and 28 days in 2026.", ledger)).toEqual([]);
  });

  it("dedupes flagged tokens and preserves order", () => {
    const out = findUngroundedNumbers("In 1847 and again 1847, then 1902.", buildGroundedNumbers(""));
    expect(out).toEqual(["1847", "1902"]);
  });
});

describe("numeric-fidelity - repair payload", () => {
  it("groundedNumberList caps the injected list", () => {
    const grounded = buildGroundedNumbers(Array.from({ length: 50 }, (_, i) => `${1000 + i}`).join(" "));
    expect(groundedNumberList(grounded, 30)).toHaveLength(30);
  });
});
