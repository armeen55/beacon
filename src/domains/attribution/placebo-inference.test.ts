import { describe, it, expect } from "vitest";
import {
  computePlaceboP,
  isPlaceboSignificant,
  PLACEBO_P_HIGH_CONFIDENCE_MAX,
} from "./placebo-inference";

describe("computePlaceboP — leave-one-out placebo inference", () => {
  it("returns null with fewer than 2 controls (no placebo distribution)", () => {
    expect(computePlaceboP(5, [])).toBeNull();
    expect(computePlaceboP(5, [3])).toBeNull();
  });

  it("flat controls + a large observed lift → p=0 (clearly significant)", () => {
    // Controls all moved 0; the treated page's +10 lift is unlike anything
    // the untreated pages did → no placebo pseudo-lift reaches 10.
    expect(computePlaceboP(10, [0, 0, 0, 0])).toBe(0);
  });

  it("observed lift within control noise → high p (NOT significant)", () => {
    // Controls swing ±5 (mean 0); an observed lift of 5 is the SAME size as
    // the placebo swings → most/all placebos are at least as extreme.
    const p = computePlaceboP(5, [5, -5, 5, -5]);
    expect(p).not.toBeNull();
    expect(p!).toBeGreaterThanOrEqual(0.5);
  });

  it("p is a valid probability in [0,1]", () => {
    const p = computePlaceboP(2, [1, -1, 3, 0, -2, 4]);
    expect(p).not.toBeNull();
    expect(p!).toBeGreaterThanOrEqual(0);
    expect(p!).toBeLessThanOrEqual(1);
  });

  it("zero observed lift → p=1 (every placebo is at least as extreme as 0)", () => {
    expect(computePlaceboP(0, [1, -1, 2, -2])).toBe(1);
  });

  it("is deterministic — identical inputs give identical p (no RNG)", () => {
    const a = computePlaceboP(3, [1, 4, -2, 0, 5]);
    const b = computePlaceboP(3, [1, 4, -2, 0, 5]);
    expect(a).toBe(b);
  });

  it("magnitude-based: a large NEGATIVE lift (hurting) is also significant", () => {
    expect(computePlaceboP(-10, [0, 0, 0, 0])).toBe(0);
  });

  it("isPlaceboSignificant: gates on the conservative threshold, never on null", () => {
    expect(isPlaceboSignificant(0)).toBe(true);
    expect(isPlaceboSignificant(PLACEBO_P_HIGH_CONFIDENCE_MAX)).toBe(false); // strict <
    expect(isPlaceboSignificant(0.5)).toBe(false);
    expect(isPlaceboSignificant(null)).toBe(false); // thin evidence → never over-claim
  });
});
