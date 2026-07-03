/**
 * trust-receipts (R14b) - pins the named-controls chart legend and the
 * prep-spend join line on the /results cards.
 */
import { describe, expect, it } from "vitest";
import { controlsLegendLine, prepSpendLine } from "./trust-receipts";

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
