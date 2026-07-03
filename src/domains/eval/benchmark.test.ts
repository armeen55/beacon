import { describe, it, expect } from "vitest";

import { runBenchmark, benchmarkOperatorLine } from "./benchmark";
import { goldCaseCount } from "./gold-library";

describe("runBenchmark - Beacon agrees with the expert on every gold case", () => {
  const report = runBenchmark();

  it("gets every gold case fully right (the regression floor)", () => {
    // If this drops, a change to the scorer / abstention / planner made Beacon
    // disagree with a known-good case. The misses list points at which one.
    expect(report.misses).toEqual([]);
    expect(report.casesPassed).toBe(report.casesTotal);
    expect(report.casesTotal).toBe(goldCaseCount());
  });

  it("scores every axis of every case (case x 4 axes)", () => {
    expect(report.total).toBe(goldCaseCount() * 4);
    expect(report.passed).toBe(report.total);
  });

  it("is deterministic (same report on a second run)", () => {
    const again = runBenchmark();
    expect(again).toEqual(report);
  });
});

describe("benchmarkOperatorLine - the honest operator line", () => {
  it("names the concrete count and reads in Beacon voice, no dashes", () => {
    const report = runBenchmark();
    const line = benchmarkOperatorLine(report);
    expect(line).toBe(`I checked myself against ${report.casesTotal} known-good cases and got ${report.casesPassed} right.`);
    expect(line).not.toMatch(/[‒–—―]/);
    expect(line.startsWith("I ")).toBe(true);
  });

  it("owns misses plainly when not perfect", () => {
    const line = benchmarkOperatorLine({ passed: 20, total: 24, casesPassed: 5, casesTotal: 6, misses: [] });
    expect(line).toContain("got 5 right");
    expect(line).toContain("the 1 I missed");
    expect(line).not.toMatch(/[‒–—―]/);
  });
});
