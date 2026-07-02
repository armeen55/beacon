import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * wiring pin (2026-07-02, master plan item 51) - build-today-preview.ts is a large,
 * heavily-fixtured file other agents actively edit (move-router, planner internals,
 * standup); a full integration test of buildTodayExperimentPreview is out of scope
 * for this item's surgical one-line wire. Instead, pin that the wire itself exists
 * and reads through the SAME clamp/store functions the unit tests above already
 * cover, so a future edit that silently drops the composition call is caught here
 * even without re-running the full daily-preview fixture graph.
 */
describe("build-today-preview.ts wires the weekly strategy mix", () => {
  const src = readFileSync(resolve(__dirname, "../experiments/build-today-preview.ts"), "utf8");

  it("imports the strategy-mix store, the deterministic clamp, and the known-family vocabulary", () => {
    expect(src).toContain('from "@/domains/strategy-review/strategy-mix-store"');
    expect(src).toContain('from "@/domains/strategy-review/apply-mix"');
    expect(src).toContain('from "@/domains/strategy-review/run-strategy-review"');
  });

  it("calls the mix-application helper additively (never blocks the preview build)", () => {
    expect(src).toContain("applyWeeklyStrategyMixToCandidates(teamReviewed, tenantId)");
  });

  it("clamps before composing (never applies a raw LLM weight)", () => {
    const fnStart = src.indexOf("async function applyWeeklyStrategyMixToCandidates");
    const fnBody = src.slice(fnStart, fnStart + 900);
    expect(fnBody).toContain("clampStrategyMix(");
    expect(fnBody).toContain("teamScoreMultiplier");
  });
});
