/**
 * 2026-06-10 — nightly generation runner helpers (P0 wall 1).
 * Pins: mode resolution mirrors isPromotionLiveWriteEnabled() STRICT
 * semantics ("true" and nothing else), and the kill-switch truthy set
 * matches BEACON_SCAN_DISABLED's contract.
 */

import { describe, it, expect } from "vitest";

import {
  resolveGenerationMode,
  isGenerationDisabled,
} from "../../scripts/run-scheduled-generation";

function env(vars: Record<string, string>): NodeJS.ProcessEnv {
  return vars as unknown as NodeJS.ProcessEnv;
}

describe("resolveGenerationMode — strict live-write gate", () => {
  it('only the exact string "true" enables live writes', () => {
    expect(resolveGenerationMode(env({ BEACON_PROMOTION_LIVE_WRITE_ENABLED: "true" })))
      .toEqual({ dryRun: false, reason: "live_write_enabled" });
  });

  it("everything else is a dry-run report (unset, '1', 'True', 'yes')", () => {
    for (const v of [undefined, "", "1", "True", "yes", "on", "TRUE"]) {
      const e = v === undefined ? env({}) : env({ BEACON_PROMOTION_LIVE_WRITE_ENABLED: v });
      expect(resolveGenerationMode(e)).toEqual({
        dryRun: true,
        reason: "live_write_disabled_report_only",
      });
    }
  });
});

describe("isGenerationDisabled — kill switch", () => {
  it("matches the BEACON_SCAN_DISABLED truthy set (1/true/yes/on, case-insensitive)", () => {
    for (const v of ["1", "true", "TRUE", "yes", "on", " On "]) {
      expect(isGenerationDisabled(env({ BEACON_GENERATION_DISABLED: v }))).toBe(true);
    }
  });

  it("anything else does not disable", () => {
    for (const v of [undefined, "", "0", "false", "off", "no"]) {
      const e = v === undefined ? env({}) : env({ BEACON_GENERATION_DISABLED: v });
      expect(isGenerationDisabled(e)).toBe(false);
    }
  });
});
