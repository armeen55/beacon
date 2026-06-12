/**
 * expected-value — the Move prioritization engine.
 *
 * Pins: EV = helpingRate × typicalRelativeLift (null when unforecastable,
 * never 0); tier bands; ranking puts forecastable Moves first (by EV desc,
 * then helpingRate, then sampleSize), unforecastable Moves last + stable.
 */

import { describe, it, expect } from "vitest";

import {
  expectedRelativeLift,
  evTier,
  rankByExpectedValue,
} from "./expected-value";
import type { CausalSelfForecast } from "./causal-self-forecast";

function fc(
  partial: Partial<CausalSelfForecast> & {
    helpingRate: number;
    typicalRelativeLift: number | null;
  },
): CausalSelfForecast {
  return {
    kind: "self_causal_forecast",
    primary_bucket: "content.faq.add",
    url_type: "service",
    matched_on: "bucket",
    sampleSize: 4,
    helpedCount: 3,
    hurtCount: 0,
    seeded: false,
    line: "test",
    ...partial,
  };
}

describe("expectedRelativeLift", () => {
  it("multiplies helping rate by typical lift", () => {
    expect(expectedRelativeLift(fc({ helpingRate: 0.75, typicalRelativeLift: 0.4 }))).toBe(0.3);
  });
  it("is null (not 0) when there is no forecast", () => {
    expect(expectedRelativeLift(null)).toBeNull();
  });
  it("is null when no helped prior carried a magnitude (won't invent one)", () => {
    expect(expectedRelativeLift(fc({ helpingRate: 0.8, typicalRelativeLift: null }))).toBeNull();
  });
});

describe("evTier", () => {
  it("bands EV; null → unknown", () => {
    expect(evTier(0.3)).toBe("high");
    expect(evTier(0.1)).toBe("moderate");
    expect(evTier(0.05)).toBe("low");
    expect(evTier(null)).toBe("unknown");
  });
});

describe("rankByExpectedValue", () => {
  it("ranks forecastable Moves by EV desc; unforecastable last + stable", () => {
    const ranked = rankByExpectedValue([
      { move: "low-ev", forecast: fc({ helpingRate: 0.5, typicalRelativeLift: 0.2 }) }, // 0.1
      { move: "no-forecast-A", forecast: null },
      { move: "high-ev", forecast: fc({ helpingRate: 0.8, typicalRelativeLift: 0.5 }) }, // 0.4
      { move: "no-forecast-B", forecast: null },
    ]);
    expect(ranked.map((r) => r.move)).toEqual([
      "high-ev",
      "low-ev",
      "no-forecast-A",
      "no-forecast-B",
    ]);
    expect(ranked[0]!.tier).toBe("high");
    expect(ranked[2]!.ev).toBeNull();
  });

  it("breaks EV ties by helpingRate then sampleSize", () => {
    // Both EV = 0.2, but A has the higher helping rate.
    const a = fc({ helpingRate: 0.8, typicalRelativeLift: 0.25, sampleSize: 5 }); // 0.2
    const b = fc({ helpingRate: 0.5, typicalRelativeLift: 0.4, sampleSize: 9 }); // 0.2
    const ranked = rankByExpectedValue([
      { move: "b", forecast: b },
      { move: "a", forecast: a },
    ]);
    expect(ranked.map((r) => r.move)).toEqual(["a", "b"]);
  });
});
