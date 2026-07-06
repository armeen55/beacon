import { describe, it, expect } from "vitest";
import { linkGapsToOutreachTargets, linkGapLeadEvidence } from "./to-outreach-signals";
import type { LinkGap } from "./link-gap";

function gap(overrides: Partial<LinkGap> = {}): LinkGap {
  return {
    keyword: "persian rugs",
    volume: 1900,
    competitorDomain: "supplehomes.com",
    competitorRank: 3,
    competitorUrl: "https://supplehomes.com/persian-rugs",
    ownRank: 24,
    competitorReferringDomains: 210,
    ownReferringDomains: 3,
    referringDomainMultiple: 70,
    score: 7600,
    ...overrides,
  };
}

describe("linkGapsToOutreachTargets - feeds the outreach pipeline", () => {
  it("turns a link gap into a digital-PR target carrying the competitor + query + multiple", () => {
    const targets = linkGapsToOutreachTargets([gap()]);
    expect(targets).toHaveLength(1);
    expect(targets[0]!.competitorDomain).toBe("supplehomes.com");
    expect(targets[0]!.keyword).toBe("persian rugs");
    expect(targets[0]!.referringDomainMultiple).toBe(70);
    expect(targets[0]!.volume).toBe(1900);
  });

  it("dedupes the same competitor domain, keeping the strongest gap", () => {
    const targets = linkGapsToOutreachTargets([
      gap({ keyword: "a", referringDomainMultiple: 55 }),
      gap({ keyword: "b", referringDomainMultiple: 90 }),
    ]);
    expect(targets).toHaveLength(1);
    expect(targets[0]!.referringDomainMultiple).toBe(90);
    expect(targets[0]!.keyword).toBe("b");
  });

  it("strips a www. prefix from the competitor domain", () => {
    const targets = linkGapsToOutreachTargets([gap({ competitorDomain: "www.rival.com" })]);
    expect(targets[0]!.competitorDomain).toBe("rival.com");
  });

  it("returns [] on empty input (empty-safe)", () => {
    expect(linkGapsToOutreachTargets([])).toEqual([]);
  });

  it("sorts by the referring-domain multiple, strongest first", () => {
    const targets = linkGapsToOutreachTargets([
      gap({ competitorDomain: "weak.com", referringDomainMultiple: 51 }),
      gap({ competitorDomain: "strong.com", referringDomainMultiple: 200 }),
    ]);
    expect(targets.map((t) => t.competitorDomain)).toEqual(["strong.com", "weak.com"]);
  });
});

describe("linkGapLeadEvidence - Beacon voice", () => {
  it("names the competitor, the query, the volume, the multiple, and a next step", () => {
    const [t] = linkGapsToOutreachTargets([gap()]);
    const e = linkGapLeadEvidence(t!);
    expect(e).toContain("supplehomes.com");
    expect(e).toContain("persian rugs");
    expect(e).toContain("1,900 searches a month");
    expect(e).toContain("70x");
    expect(e).toContain("Study who links to their page");
  });

  it("omits the search count honestly when volume is unknown", () => {
    const [t] = linkGapsToOutreachTargets([gap({ volume: null })]);
    expect(linkGapLeadEvidence(t!)).not.toMatch(/searches a month/);
  });

  it("never uses an em or en dash", () => {
    const [t] = linkGapsToOutreachTargets([gap()]);
    expect(linkGapLeadEvidence(t!)).not.toMatch(/[–—]/);
  });
});
