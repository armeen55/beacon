/**
 * trust-receipts (R14b) - pins the named-controls chart legend and the
 * prep-spend join line on the /results cards.
 */
import { describe, expect, it } from "vitest";
import { controlsLegendLine, prepSpendLine, verifyGaveUpLine } from "./trust-receipts";

describe("controlsLegendLine", () => {
  it("names two comparison pages", () => {
    expect(controlsLegendLine(["/iran-animals", "/iran-food"])).toBe(
      "Compared against /iran-animals and /iran-food, chosen before shipping.",
    );
  });
  it("names one comparison page", () => {
    expect(controlsLegendLine(["/iran-animals"])).toBe(
      "Compared against /iran-animals, chosen before shipping.",
    );
  });
  it("caps at two and normalizes full URLs to paths", () => {
    expect(
      controlsLegendLine(["https://iranopedia.com/iran-animals?x=1", "/iran-food", "/third"]),
    ).toBe("Compared against /iran-animals and /iran-food, chosen before shipping.");
  });
  it("is null with nothing to name", () => {
    expect(controlsLegendLine([])).toBeNull();
  });
  it("never emits an em or en dash", () => {
    expect(controlsLegendLine(["/a", "/b"])).not.toMatch(/[‒–—―]/);
  });
});

describe("prepSpendLine", () => {
  it("names the real cents spent preparing the change", () => {
    expect(prepSpendLine(0.04)).toBe("Preparing this change cost $0.04 in checks.");
  });
  it("says under a cent instead of a lying $0.00", () => {
    expect(prepSpendLine(0.003)).toBe("Preparing this change cost under a cent in checks.");
  });
  it("is null at zero, null, or garbage (a free change never grows a line)", () => {
    expect(prepSpendLine(0)).toBeNull();
    expect(prepSpendLine(null)).toBeNull();
    expect(prepSpendLine(undefined)).toBeNull();
    expect(prepSpendLine(Number.NaN)).toBeNull();
  });
});

describe("verifyGaveUpLine (W5 stop-ship F6)", () => {
  const exhausted = { canonical: null, exhausted: true, attempts: 5, nextRetryAt: null };
  it("names the honest terminal state when the pass gave up and it's not live", () => {
    expect(verifyGaveUpLine(exhausted, false)).toBe(
      "I could not verify this after several tries; check it yourself.",
    );
  });
  it("is null for a verified-live row (the receipt wins)", () => {
    expect(verifyGaveUpLine(exhausted, true)).toBeNull();
  });
  it("is null while still retrying (not yet exhausted)", () => {
    expect(verifyGaveUpLine({ canonical: null, exhausted: false, attempts: 2 }, false)).toBeNull();
  });
  it("is null when never verified (no envelope at all)", () => {
    expect(verifyGaveUpLine(null, false)).toBeNull();
    expect(verifyGaveUpLine(undefined, false)).toBeNull();
  });
  it("is null when a canonical success is latched (never 'gave up')", () => {
    expect(
      verifyGaveUpLine({ canonical: { outcome: "verified_live", kind: "exact" }, exhausted: false }, false),
    ).toBeNull();
  });
  it("never emits an em or en dash", () => {
    expect(verifyGaveUpLine(exhausted, false)).not.toMatch(/[‒–—―]/);
  });
});
