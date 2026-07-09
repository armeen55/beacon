import { describe, it, expect } from "vitest";

import { buildProofHonestySentence } from "./proof-summary-section";

/**
 * Presentation pin for BEACON_500 item 22: the "Proof at a glance" honesty
 * sentence (item 75) gains ", worth about $X a month at your rates" ONLY
 * when at least one mature win actually has a positive dollar value. No
 * change touches counts.measuring here, and the append never fires when
 * winsWithDollarCount is 0 (no revenue model configured, or all wins are
 * clicks-only).
 */

describe("buildProofHonestySentence - dollar clause (item 22)", () => {
  it("appends the dollar clause when at least one win has a positive dollar value and real revenue is connected", () => {
    const s = buildProofHonestySentence({
      counts: { measuring: 1, helped: 2, noLift: 0, didNotHelp: 0 },
      winsDollarUsdPerMonth: 340,
      winsWithDollarCount: 1,
      soonestLabel: null,
      hasRealRevenue: true,
    });
    expect(s).toBe("1 measuring, 2 wins, worth about $340 a month at your rates.");
  });

  it("never appends the dollar clause when no win has a dollar value (no revenue model)", () => {
    const s = buildProofHonestySentence({
      counts: { measuring: 1, helped: 2, noLift: 0, didNotHelp: 0 },
      winsDollarUsdPerMonth: 0,
      winsWithDollarCount: 0,
      soonestLabel: null,
      hasRealRevenue: false,
    });
    expect(s).toBe("1 measuring, 2 wins.");
    expect(s).not.toMatch(/\$/);
  });

  // operator spec 2026-07-09 E-38: hide dollar estimates until real revenue
  // data is connected, even when the underlying sum is mathematically positive
  // (it is still built from an operator-set rate, not tracked revenue).
  it("never appends the dollar clause when real revenue is not connected yet, even with a positive dollar sum", () => {
    const s = buildProofHonestySentence({
      counts: { measuring: 1, helped: 2, noLift: 0, didNotHelp: 0 },
      winsDollarUsdPerMonth: 340,
      winsWithDollarCount: 1,
      soonestLabel: null,
      hasRealRevenue: false,
    });
    expect(s).toBe("1 measuring, 2 wins.");
    expect(s).not.toMatch(/\$/);
  });

  it("never appends when there are zero wins even if a stray positive sum leaked in", () => {
    const s = buildProofHonestySentence({
      counts: { measuring: 3, helped: 0, noLift: 1, didNotHelp: 0 },
      winsDollarUsdPerMonth: 50,
      winsWithDollarCount: 0,
      soonestLabel: null,
      hasRealRevenue: true,
    });
    expect(s).not.toMatch(/\$/);
  });

  it("never appends a negative or zero total even if a win has a dollar value flag set", () => {
    const s = buildProofHonestySentence({
      counts: { measuring: 0, helped: 1, noLift: 0, didNotHelp: 0 },
      winsDollarUsdPerMonth: -20,
      winsWithDollarCount: 1,
      soonestLabel: null,
      hasRealRevenue: true,
    });
    expect(s).not.toMatch(/\$/);
  });

  it("keeps the next-verdicts clause after the dollar clause", () => {
    const s = buildProofHonestySentence({
      counts: { measuring: 2, helped: 1, noLift: 0, didNotHelp: 0 },
      winsDollarUsdPerMonth: 120,
      winsWithDollarCount: 1,
      soonestLabel: "Tuesday",
      hasRealRevenue: true,
    });
    expect(s).toBe("2 measuring, 1 win, worth about $120 a month at your rates, next verdicts Tuesday.");
  });

  it("returns null when there is nothing to report at all", () => {
    const s = buildProofHonestySentence({
      counts: { measuring: 0, helped: 0, noLift: 0, didNotHelp: 0 },
      winsDollarUsdPerMonth: 0,
      winsWithDollarCount: 0,
      soonestLabel: null,
      hasRealRevenue: false,
    });
    expect(s).toBeNull();
  });

  it("has no em or en dash in any rendered sentence", () => {
    const s = buildProofHonestySentence({
      counts: { measuring: 1, helped: 3, noLift: 2, didNotHelp: 1 },
      winsDollarUsdPerMonth: 1234,
      winsWithDollarCount: 2,
      soonestLabel: "any day now",
      hasRealRevenue: true,
    });
    expect(s).not.toMatch(/[–—]/);
  });
});
