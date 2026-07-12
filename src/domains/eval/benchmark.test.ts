import { describe, it, expect } from "vitest";

import { runBenchmark, benchmarkOperatorLine } from "./benchmark";
import { goldCaseCount } from "./gold-library";

describe("runBenchmark - Beacon agrees with the expert on every gold case", () => {
  const report = runBenchmark();

  it("gets every gold case fully right (the regression floor)", () => {
    // If this drops, a change to the scorer / abstention / planner made Beacon
    // disagree with a known-good case. The misses list points at which one.
    expect(report.misses).toEqual([]);
    expect(report.evidenceClass).toBe("known_case_regression");
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
    expect(line).toBe(`I rechecked ${report.casesTotal} known cases and still get all ${report.casesPassed} right. This catches regressions, but it is not a blind test.`);
    expect(line).not.toMatch(/[‒–—―]/);
    expect(line.startsWith("I ")).toBe(true);
  });

  it("owns misses plainly when not perfect", () => {
    const line = benchmarkOperatorLine({ evidenceClass: "known_case_regression", passed: 20, total: 24, casesPassed: 5, casesTotal: 6, misses: [] });
    expect(line).toContain("now miss 1");
    expect(line).toContain("must be fixed before release");
    expect(line).not.toMatch(/[‒–—―]/);
  });
});
