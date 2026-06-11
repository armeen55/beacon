/**
 * 2026-06-11 (night shift, #147/#148) — city extraction is per-tenant.
 * Pins: injected knownCities drives matching; an EMPTY list (content
 * tenant) matches nothing in text; the legacy (undefined) path keeps
 * the Bay-Area + metro-name behavior; path extraction still trusts the
 * /locations/<slug> URL structure regardless.
 */

import { describe, it, expect } from "vitest";

import {
  extractCityFromText,
  extractCityFromPath,
} from "@/domains/pages/classify";

describe("extractCityFromText — injected vocabulary", () => {
  it("matches a city from the INJECTED tenant list", () => {
    expect(extractCityFromText("best builder in Austin TX", ["austin", "dallas"])).toBe("austin");
  });

  it("an EMPTY tenant list matches nothing — no false Bay-Area tags", () => {
    // The pre-fix global list contained 'fremont', 'union city', etc.;
    // a Persian-encyclopedia title must NOT tag a Bay-Area city.
    expect(
      extractCityFromText("The history of Fremont's Persian community", []),
    ).toBeNull();
  });

  it("legacy callers (undefined) keep the Bay-Area + metro fallback", () => {
    expect(extractCityFromText("custom homes in Palo Alto")).toBe("palo alto");
  });
});

describe("extractCityFromPath — structure first", () => {
  it("returns the configured city when the slug matches the tenant list", () => {
    expect(extractCityFromPath("/locations/austin", ["austin"])).toBe("austin");
  });

  it("still extracts the slug for a /locations/<slug> page even off-list", () => {
    // The URL structure IS the signal — an unconfigured city slug on a
    // /locations/ page is still a city page.
    expect(extractCityFromPath("/locations/reno", ["austin"])).toBe("reno");
  });

  it("non-location paths return null", () => {
    expect(extractCityFromPath("/persian-food/ghormeh-sabzi", [])).toBeNull();
  });
});
