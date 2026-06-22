/**
 * audit-4 — the default proof treatment day must be a PACIFIC calendar date,
 * because every GSC date in the ledger is Search-Console Pacific time. The old
 * `new Date().toISOString()` (UTC) default anchored an evening-Pacific ship one
 * day late, mis-filing a real post-change day into the baseline window.
 */
import { describe, expect, it } from "vitest";

import { defaultPacificShipDate } from "./run-measurement";

describe("defaultPacificShipDate (audit-4)", () => {
  it("US-evening ship: 2026-06-22T01:00Z (= 2026-06-21 18:00 PDT) → '2026-06-21', NOT the UTC '2026-06-22'", () => {
    const d = new Date("2026-06-22T01:00:00.000Z");
    expect(d.toISOString().slice(0, 10)).toBe("2026-06-22"); // the OLD (wrong) UTC day
    expect(defaultPacificShipDate(d)).toBe("2026-06-21"); // the correct Pacific day
  });

  it("midday UTC ship maps to the same Pacific day", () => {
    expect(defaultPacificShipDate(new Date("2026-06-21T19:00:00.000Z"))).toBe("2026-06-21");
  });

  it("returns a YYYY-MM-DD string", () => {
    expect(defaultPacificShipDate(new Date("2026-06-21T19:00:00.000Z"))).toMatch(
      /^\d{4}-\d{2}-\d{2}$/,
    );
  });
});
