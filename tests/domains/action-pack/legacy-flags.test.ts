import { describe, it, expect, afterEach } from "vitest";
import { isLegacyQuarantined, legacyQuarantineStatus, LEGACY_SYSTEMS } from "@/lib/legacy-flags";

afterEach(() => { delete process.env.BEACON_QUARANTINE_SEMRUSH; });

describe("legacy kill-switch flags", () => {
  it("defaults every legacy system to LIVE (not quarantined) — customer surfaces unchanged", () => {
    for (const s of LEGACY_SYSTEMS) expect(isLegacyQuarantined(s)).toBe(false);
    expect(legacyQuarantineStatus().every((q) => !q.quarantined)).toBe(true);
  });
  it("quarantines only when the exact env flag is 'true'", () => {
    process.env.BEACON_QUARANTINE_SEMRUSH = "true";
    expect(isLegacyQuarantined("semrush")).toBe(true);
    expect(isLegacyQuarantined("visibility_score")).toBe(false); // others unaffected
  });
});
