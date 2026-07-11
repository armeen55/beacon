import { describe, it, expect } from "vitest";
import { copyAllowedForStaging } from "./stage-route";

/**
 * copyAllowedForStaging (P2-g, 2026-07-10 visual audit) - the "Stage in Wix" one-click
 * button must never offer a push for a draft the W5 source-safety gate (draft-quality.ts)
 * has already blocked (missing_source / needs_source_check -> copyAllowed: false).
 * Verified the server's own QA backstop (stage-change.ts) checks a DIFFERENT, older verdict
 * (recommendation-qa.ts) with no knowledge of this gate, so today-moves-data.ts's
 * staging.enabled must apply this check itself.
 */
describe("copyAllowedForStaging", () => {
  it("blocks staging when the computed quality verdict explicitly disallows copy", () => {
    expect(copyAllowedForStaging({ copyAllowed: false })).toBe(false);
  });

  it("allows staging when the computed quality verdict allows copy", () => {
    expect(copyAllowedForStaging({ copyAllowed: true })).toBe(true);
  });

  it("never newly blocks a row with no computed quality verdict at all (legacy/undrafted row)", () => {
    expect(copyAllowedForStaging(null)).toBe(true);
    expect(copyAllowedForStaging(undefined)).toBe(true);
  });
});
