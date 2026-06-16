/**
 * 2026-06-15 — buildSparklinePath (pure SVG geometry) unit tests.
 * Pins the contract the Today Search-card momentum line depends on:
 * <2 points → null, all-equal series → a flat mid-line (no fake slope,
 * no divide-by-zero), and a real series → a normalized M…L… path that
 * fills the box with the highest value at the top.
 */

import { describe, it, expect } from "vitest";

import {
  buildSparklinePath,
  SPARKLINE_VIEWBOX,
} from "@/domains/today-summary/build-sparkline-path";

const { width, height } = SPARKLINE_VIEWBOX;

/** Parse a `d` string into {x,y} points (M/L commands). */
function parsePoints(d: string): { x: number; y: number }[] {
  return d
    .trim()
    .split(/\s+/)
    .map((cmd) => {
      const [x, y] = cmd.slice(1).split(",").map(Number);
      return { x, y };
    });
}

describe("buildSparklinePath — degenerate inputs", () => {
  it("returns null for an empty series", () => {
    expect(buildSparklinePath([])).toBeNull();
  });

  it("returns null for a single point (not a trend)", () => {
    expect(buildSparklinePath([42])).toBeNull();
  });

  it("draws a FLAT mid-line for an all-equal series (no fake slope, no NaN)", () => {
    const d = buildSparklinePath([5, 5, 5, 5]);
    expect(d).not.toBeNull();
    const pts = parsePoints(d!);
    // Every y at the vertical middle, no NaN from divide-by-zero.
    for (const p of pts) {
      expect(p.y).toBeCloseTo(height / 2, 5);
      expect(Number.isNaN(p.x)).toBe(false);
      expect(Number.isNaN(p.y)).toBe(false);
    }
  });
});

describe("buildSparklinePath — real series", () => {
  it("starts with M, follows with L, one command per value", () => {
    const d = buildSparklinePath([1, 2, 3, 4, 5])!;
    const cmds = d.trim().split(/\s+/);
    expect(cmds).toHaveLength(5);
    expect(cmds[0].startsWith("M")).toBe(true);
    expect(cmds.slice(1).every((c) => c.startsWith("L"))).toBe(true);
  });

  it("spans the full width: first x=0, last x=width", () => {
    const d = buildSparklinePath([3, 1, 4, 1, 5])!;
    const pts = parsePoints(d);
    expect(pts[0].x).toBeCloseTo(0, 5);
    expect(pts[pts.length - 1].x).toBeCloseTo(width, 5);
  });

  it("puts the MAX value at the top (smaller y) and the MIN at the bottom (larger y)", () => {
    // index 0 = min, index 2 = max
    const d = buildSparklinePath([0, 5, 10])!;
    const pts = parsePoints(d);
    expect(pts[2].y).toBeLessThan(pts[0].y); // max is higher on screen
    // y stays within the padded box (never clips the viewBox edges).
    for (const p of pts) {
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(height);
    }
  });

  it("honors a custom viewBox", () => {
    const d = buildSparklinePath([1, 2, 3], { width: 200, height: 40 })!;
    const pts = parsePoints(d);
    expect(pts[pts.length - 1].x).toBeCloseTo(200, 5);
  });
});
