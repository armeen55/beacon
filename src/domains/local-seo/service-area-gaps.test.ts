import { describe, expect, it } from "vitest";

import { detectServiceAreaGaps } from "./service-area-gaps";
import type { CityCoverage } from "@/domains/geo/types";

function coverage(over: Partial<CityCoverage> = {}): CityCoverage {
  return {
    city: "oakland",
    owned_pages: 0,
    owned_citations: 0,
    competitor_pages: 0,
    competitor_citations: 0,
    prompt_count: 0,
    share_pct: null,
    coverage_status: "absent",
    ...over,
  };
}

describe("detectServiceAreaGaps", () => {
  it("EMPTY / NO-OP: no locations config yields [] (a content tenant is a no-op)", () => {
    expect(
      detectServiceAreaGaps({ cities: [], services: ["plumbing"], ownedUrls: [] }),
    ).toEqual([]);
  });

  it("EMPTY / NO-OP: no services config yields []", () => {
    expect(
      detectServiceAreaGaps({ cities: ["Oakland"], services: [], ownedUrls: [] }),
    ).toEqual([]);
  });

  it("EMPTY / NO-OP: both empty yields [] (byte-identical to no engine)", () => {
    expect(detectServiceAreaGaps({ cities: [], services: [], ownedUrls: [] })).toEqual([]);
  });

  it("detects the full city x service matrix as gaps when nothing is owned", () => {
    const gaps = detectServiceAreaGaps({
      cities: ["Oakland", "Fremont"],
      services: ["plumbing", "drain cleaning"],
      ownedUrls: [],
    });
    // 2 cities x 2 services = 4 gaps.
    expect(gaps).toHaveLength(4);
    expect(gaps.every((g) => g.needsDemandValidation)).toBe(true);
    const pairs = gaps.map((g) => `${g.service}|${g.city}`).sort();
    expect(pairs).toEqual([
      "drain cleaning|Fremont",
      "drain cleaning|Oakland",
      "plumbing|Fremont",
      "plumbing|Oakland",
    ]);
  });

  it("does NOT propose a page an owned URL already covers (dedup)", () => {
    const gaps = detectServiceAreaGaps({
      cities: ["Oakland"],
      services: ["plumbing", "drain cleaning"],
      ownedUrls: ["https://acme.com/plumbing-oakland"],
    });
    expect(gaps.find((g) => g.slug === "plumbing-oakland")).toBeUndefined();
    expect(gaps.find((g) => g.service === "drain cleaning")).toBeDefined();
  });

  it("ranks coverage-proven openings (absent + rival pages) above unknown-coverage cities", () => {
    const gaps = detectServiceAreaGaps({
      cities: ["Oakland", "Fremont"],
      services: ["plumbing"],
      ownedUrls: [],
      cityCoverage: [
        // Oakland: absent + 8 competitor pages -> a proven opening.
        coverage({ city: "oakland", coverage_status: "absent", competitor_pages: 8 }),
        // Fremont: we already cover it strongly -> lowest priority.
        coverage({ city: "fremont", coverage_status: "strong", competitor_pages: 2 }),
      ],
    });
    expect(gaps[0]!.city).toBe("Oakland");
    expect(gaps[0]!.competitorPages).toBe(8);
    expect(gaps[0]!.coverageStatus).toBe("absent");
    expect(gaps[gaps.length - 1]!.city).toBe("Fremont");
  });

  it("attaches competitor-page proof from the coverage matrix (canonical-city match)", () => {
    const gaps = detectServiceAreaGaps({
      cities: ["Palo Alto"],
      services: ["plumbing"],
      ownedUrls: [],
      // Coverage key is normalized ("palo alto"); config city is "Palo Alto".
      cityCoverage: [coverage({ city: "palo alto", coverage_status: "weak", competitor_pages: 5 })],
    });
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.competitorPages).toBe(5);
    expect(gaps[0]!.coverageStatus).toBe("weak");
  });

  it("still produces config-declared gaps when no coverage signal exists (competitorPages 0, coverage null)", () => {
    const gaps = detectServiceAreaGaps({
      cities: ["Reno"],
      services: ["plumbing"],
      ownedUrls: [],
    });
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.competitorPages).toBe(0);
    expect(gaps[0]!.coverageStatus).toBeNull();
  });

  it("caps the returned gaps at maxGaps", () => {
    const cities = Array.from({ length: 10 }, (_, i) => `City ${i}`);
    const services = Array.from({ length: 5 }, (_, i) => `Service ${i}`);
    const gaps = detectServiceAreaGaps({ cities, services, ownedUrls: [], maxGaps: 6 });
    expect(gaps).toHaveLength(6);
  });

  it("is generic: no city or trade is hardcoded (works for an arbitrary vertical)", () => {
    const gaps = detectServiceAreaGaps({
      cities: ["Austin"],
      services: ["dog grooming"],
      ownedUrls: [],
    });
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.service).toBe("dog grooming");
    expect(gaps[0]!.city).toBe("Austin");
  });
});
