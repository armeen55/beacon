import { describe, it, expect } from "vitest";
import {
  computeLinkGaps,
  linkGapEvidenceSentence,
  type LinkGapCandidate,
  LINK_GAP_MULTIPLE,
} from "./link-gap";

function candidate(overrides: Partial<LinkGapCandidate> = {}): LinkGapCandidate {
  return {
    keyword: "persian rugs",
    volume: 1900,
    competitorDomain: "supplehomes.com",
    competitorRank: 3,
    competitorUrl: "https://supplehomes.com/persian-rugs",
    ownRank: 24,
    competitorReferringDomains: 210,
    ownReferringDomains: 3,
    difficulty: null,
    ...overrides,
  };
}

describe("computeLinkGaps - fires when a competitor out-links you badly", () => {
  it("emits a gap when the competitor ranks, you rank poorly, and the multiple is huge", () => {
    const gaps = computeLinkGaps([candidate()]);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.keyword).toBe("persian rugs");
    expect(gaps[0]!.competitorDomain).toBe("supplehomes.com");
    // 210 / 3 = 70x
    expect(gaps[0]!.referringDomainMultiple).toBe(70);
    expect(gaps[0]!.competitorReferringDomains).toBe(210);
    expect(gaps[0]!.ownReferringDomains).toBe(3);
  });

  it("treats zero own referring domains as the full competitor count as the multiple", () => {
    const gaps = computeLinkGaps([candidate({ competitorReferringDomains: 60, ownReferringDomains: 0 })]);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.referringDomainMultiple).toBe(60);
  });

  it("fires when you do not rank at all (ownRank absent)", () => {
    const gaps = computeLinkGaps([candidate({ ownRank: null })]);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.ownRank).toBeNull();
  });

  it("sorts by score (demand x gap strength), highest first", () => {
    const gaps = computeLinkGaps([
      candidate({ keyword: "small demand", volume: 100 }),
      candidate({ keyword: "big demand", volume: 9000 }),
    ]);
    expect(gaps.map((g) => g.keyword)).toEqual(["big demand", "small demand"]);
  });
});

describe("computeLinkGaps - empty-safe + within-threshold no-op (the pins)", () => {
  it("returns [] on an empty input (byte-identical to before RANK-7)", () => {
    expect(computeLinkGaps([])).toEqual([]);
  });

  it("skips a candidate with no competitor referring-domain read (never invents)", () => {
    expect(computeLinkGaps([candidate({ competitorReferringDomains: null })])).toEqual([]);
  });

  it("skips a candidate with no own referring-domain read (never invents)", () => {
    expect(computeLinkGaps([candidate({ ownReferringDomains: null })])).toEqual([]);
  });

  it("skips when the referring-domain multiple is within the threshold (a beatable gap)", () => {
    // 20 / 5 = 4x, well under LINK_GAP_MULTIPLE (50) -> not a link-authority problem.
    expect(computeLinkGaps([candidate({ competitorReferringDomains: 20, ownReferringDomains: 5 })])).toEqual([]);
    expect(LINK_GAP_MULTIPLE).toBe(50);
  });

  it("skips when the competitor does not actually rank (rank > 20)", () => {
    expect(computeLinkGaps([candidate({ competitorRank: 40 })])).toEqual([]);
  });

  it("skips when you already win it (ownRank <= 10)", () => {
    expect(computeLinkGaps([candidate({ ownRank: 6 })])).toEqual([]);
  });

  it("stays winnable on merit when Google's difficulty is low, even with a huge link gap", () => {
    // A low-difficulty query (< 30) is not capped by the backlink gap - the
    // winnability exception. So no link-authority Move fires.
    expect(computeLinkGaps([candidate({ difficulty: 12 })])).toEqual([]);
  });

  it("still fires when difficulty is present but not low", () => {
    const gaps = computeLinkGaps([candidate({ difficulty: 55 })]);
    expect(gaps).toHaveLength(1);
  });
});

describe("linkGapEvidenceSentence - Beacon voice", () => {
  it("names the competitor, rank, demand, the multiple, and a build-authority next step", () => {
    const [gap] = computeLinkGaps([candidate()]);
    const s = linkGapEvidenceSentence(gap!);
    expect(s).toContain("supplehomes.com ranks 3 on Google");
    expect(s).toContain("persian rugs");
    expect(s).toContain("1,900");
    expect(s).toContain("70x");
    expect(s).toContain("210 referring domains to your 3");
    expect(s).toContain("build authority first");
  });

  it("is honest when volume is unknown (no fabricated search number)", () => {
    const [gap] = computeLinkGaps([candidate({ volume: null })]);
    expect(linkGapEvidenceSentence(gap!)).not.toMatch(/\d+ times a month/);
  });

  it("never uses an em or en dash", () => {
    const [gap] = computeLinkGaps([candidate()]);
    const s = linkGapEvidenceSentence(gap!);
    expect(s).not.toMatch(/[–—]/);
  });
});
