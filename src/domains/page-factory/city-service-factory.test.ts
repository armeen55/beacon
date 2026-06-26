import { describe, it, expect } from "vitest";
import { generateCityServiceCandidates } from "./city-service-factory";

describe("generateCityServiceCandidates", () => {
  it("builds the city × service matrix, deduped + slugged", () => {
    const out = generateCityServiceCandidates({
      cities: ["Palo Alto", "San Jose"],
      services: ["ADU Builder", "Custom Home"],
      ownedUrls: [],
    });
    expect(out).toHaveLength(4);
    expect(out.map((c) => c.slug)).toContain("adu-builder-palo-alto");
    expect(out.every((c) => c.needsDemandValidation)).toBe(true);
  });

  it("skips a pairing already covered by an owned URL", () => {
    const out = generateCityServiceCandidates({
      cities: ["Palo Alto"],
      services: ["ADU Builder", "Custom Home"],
      ownedUrls: ["https://x.com/adu-builder-palo-alto"],
    });
    expect(out.find((c) => c.slug === "adu-builder-palo-alto")).toBeUndefined();
    expect(out.find((c) => c.service === "Custom Home")).toBeDefined();
  });

  it("ranks services echoing the tenant's vocabulary higher (relevance 1)", () => {
    const out = generateCityServiceCandidates({
      cities: ["Reno"],
      services: ["ADU Builder", "Pool Design"],
      ownedUrls: ["https://x.com/about-our-adu-builder-work"],
    });
    const adu = out.find((c) => c.service === "ADU Builder")!;
    expect(adu.relevance).toBe(1);
  });

  it("uses the title qualifier when given", () => {
    const out = generateCityServiceCandidates({
      cities: ["Austin"],
      services: ["Remodel"],
      ownedUrls: [],
      titleQualifier: "Custom home builder",
    });
    expect(out[0].title).toBe("Custom home builder in Austin");
  });

  it("fail-closed on empty cities or services", () => {
    expect(generateCityServiceCandidates({ cities: [], services: ["X"], ownedUrls: [] })).toEqual([]);
    expect(generateCityServiceCandidates({ cities: ["X"], services: [], ownedUrls: [] })).toEqual([]);
  });

  it("respects maxCandidates", () => {
    const out = generateCityServiceCandidates({
      cities: ["A", "B", "C", "D"],
      services: ["S1", "S2", "S3"],
      ownedUrls: [],
      maxCandidates: 5,
    });
    expect(out).toHaveLength(5);
  });
});
