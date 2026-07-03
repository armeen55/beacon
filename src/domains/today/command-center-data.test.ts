/**
 * Behavioral tests — command-center-data.
 *
 * `resolveCommandCenterData` and `deriveBrainSummaryFromCounts` (the
 * Command Center brain/manifest resolver) were deleted 2026-07-02 (UX5
 * legacy sweep) — the whole Command Center feature was orphaned by the
 * 2026-06-28 deletion of `today-v2-sections.tsx`, its only host, and
 * had zero production callers left. `isOperatorMode` remains: it is a
 * live, actively-used export (5 `/diagnostics/*` pages read it).
 */

import { describe, expect, it } from "vitest";
import { isOperatorMode } from "./command-center-data";

describe("isOperatorMode", () => {
  it("returns boolean", () => {
    expect(typeof isOperatorMode()).toBe("boolean");
  });

  it("respects BEACON_OPERATOR_MODE env (set in test context)", () => {
    const prev = process.env.BEACON_OPERATOR_MODE;
    try {
      process.env.BEACON_OPERATOR_MODE = "true";
      expect(isOperatorMode()).toBe(true);
      process.env.BEACON_OPERATOR_MODE = "false";
      expect(isOperatorMode()).toBe(false);
      delete process.env.BEACON_OPERATOR_MODE;
      expect(isOperatorMode()).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.BEACON_OPERATOR_MODE;
      else process.env.BEACON_OPERATOR_MODE = prev;
    }
  });
});
