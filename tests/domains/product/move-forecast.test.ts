/**
 * 2026-06-09 — Move Forecast composer tests (killer-feature half A).
 * Pins the honesty discipline: fills only when this-tenant evidence is
 * thin, suppress/seeded sample floors, action-type matching, strongest-
 * pattern selection, and inert (null) at n=1 / gate-off (patterns []).
 */

import { describe, it, expect } from "vitest";
import {
  buildPeerMoveForecast,
  FORECAST_SUPPRESS_BELOW,
  FORECAST_SEEDED_BELOW,
} from "@/domains/product/move-forecast";
import type { CrossTenantPattern } from "@/domains/recommendations/cross-tenant-brain";

function pattern(over: Partial<CrossTenantPattern> = {}): CrossTenantPattern {
  return {
    patternId: "p1",
    matchKey: "edit_type:add_faq",
    sampleSize: 20,
    helpingRate: 0.75,
    description: "FAQ sections tend to help",
    ...over,
  };
}

describe("buildPeerMoveForecast — when to fill", () => {
  it("returns null when this-tenant evidence is sufficient (defer to first-party)", () => {
    const r = buildPeerMoveForecast({
      actionType: "add_faq",
      thisTenantResult: { direction: "likely_positive" },
      patterns: [pattern()],
    });
    expect(r).toBeNull();
  });

  it("fills when this-tenant result is insufficient_data", () => {
    const r = buildPeerMoveForecast({
      actionType: "add_faq",
      thisTenantResult: { direction: "insufficient_data" },
      patterns: [pattern()],
    });
    expect(r).not.toBeNull();
    expect(r!.kind).toBe("peer_forecast");
  });

  it("fills when this-tenant result is null (never computed)", () => {
    const r = buildPeerMoveForecast({
      actionType: "add_faq",
      thisTenantResult: null,
      patterns: [pattern()],
    });
    expect(r).not.toBeNull();
  });
});

describe("buildPeerMoveForecast — inert at n=1 / gate-off", () => {
  it("returns null when no patterns (producer returns [] at gate-off / n=1)", () => {
    const r = buildPeerMoveForecast({
      actionType: "add_faq",
      thisTenantResult: null,
      patterns: [],
    });
    expect(r).toBeNull();
  });

  it("returns null when no pattern matches the action type", () => {
    const r = buildPeerMoveForecast({
      actionType: "add_faq",
      thisTenantResult: null,
      patterns: [pattern({ matchKey: "edit_type:refresh_content" })],
    });
    expect(r).toBeNull();
  });
});

describe("buildPeerMoveForecast — honesty floors", () => {
  it("suppresses below FORECAST_SUPPRESS_BELOW peer attempts", () => {
    const r = buildPeerMoveForecast({
      actionType: "add_faq",
      thisTenantResult: null,
      patterns: [pattern({ sampleSize: FORECAST_SUPPRESS_BELOW - 1 })],
    });
    expect(r).toBeNull();
  });

  it("flags seeded in the [SUPPRESS_BELOW, SEEDED_BELOW) band", () => {
    const r = buildPeerMoveForecast({
      actionType: "add_faq",
      thisTenantResult: null,
      patterns: [pattern({ sampleSize: FORECAST_SEEDED_BELOW - 1, helpingRate: 0.66 })],
    });
    expect(r).not.toBeNull();
    expect(r!.seeded).toBe(true);
    expect(r!.line).toMatch(/early signal/i);
    expect(r!.line).toMatch(/still gathering data/i);
    expect(r!.line).toContain("66%");
  });

  it("confident (not seeded) at/above SEEDED_BELOW", () => {
    const r = buildPeerMoveForecast({
      actionType: "add_faq",
      thisTenantResult: null,
      patterns: [pattern({ sampleSize: FORECAST_SEEDED_BELOW, helpingRate: 0.8 })],
    });
    expect(r).not.toBeNull();
    expect(r!.seeded).toBe(false);
    expect(r!.line).not.toMatch(/early signal/i);
    expect(r!.line).toContain("80%");
    expect(r!.line).toContain(`${FORECAST_SEEDED_BELOW} similar changes`);
  });
});

describe("buildPeerMoveForecast — pattern selection + matching", () => {
  it("matches patterns whose matchKey references the action type", () => {
    const r = buildPeerMoveForecast({
      actionType: "competitive_displacement",
      thisTenantResult: null,
      patterns: [
        pattern({ matchKey: "edit_type:competitive_displacement|geo_kind:bay_area", patternId: "px" }),
      ],
    });
    expect(r).not.toBeNull();
    expect(r!.patternId).toBe("px");
  });

  it("picks the strongest: most attempts, then highest helping rate", () => {
    const r = buildPeerMoveForecast({
      actionType: "add_faq",
      thisTenantResult: null,
      patterns: [
        pattern({ patternId: "small", sampleSize: 12, helpingRate: 0.95 }),
        pattern({ patternId: "big", sampleSize: 40, helpingRate: 0.7 }),
      ],
    });
    expect(r!.patternId).toBe("big"); // sampleSize dominates
    expect(r!.sampleSize).toBe(40);
  });

  it("breaks sampleSize ties by helping rate", () => {
    const r = buildPeerMoveForecast({
      actionType: "add_faq",
      thisTenantResult: null,
      patterns: [
        pattern({ patternId: "lo", sampleSize: 20, helpingRate: 0.5 }),
        pattern({ patternId: "hi", sampleSize: 20, helpingRate: 0.9 }),
      ],
    });
    expect(r!.patternId).toBe("hi");
  });
});
