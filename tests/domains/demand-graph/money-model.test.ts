import { describe, it, expect } from "vitest";
import { commercialIntent, computeMoneySignal } from "@/domains/demand-graph/money-model";

describe("money-model (L8, deterministic, no LLM)", () => {
  it("commercialIntent: money queries score higher than informational ones", () => {
    expect(commercialIntent("custom home builder cost")).toBeGreaterThan(commercialIntent("history of persian empire"));
    expect(commercialIntent("adu cost calculator")).toBeGreaterThanOrEqual(0.5);
    expect(commercialIntent("best builders near me")).toBeGreaterThanOrEqual(0.5);
    expect(commercialIntent("what is nowruz")).toBeLessThan(0.25);
  });

  it("commercialIntent is bounded 0..1 and handles empty input", () => {
    expect(commercialIntent("")).toBe(0);
    expect(commercialIntent("buy price cost quote hire service")).toBeLessThanOrEqual(1);
    expect(commercialIntent("buy price cost quote hire service")).toBeGreaterThan(0.5);
  });

  it("computeMoneySignal: measured conversions → money page + high potential", () => {
    const m = computeMoneySignal({ conversions: 8, sessions: 200, query: "adu feasibility" });
    expect(m.isMoneyPage).toBe(true);
    expect(m.conversionRate).toBeCloseTo(0.04, 5);
    expect(m.dollarPotential).toBe("high");
  });

  it("computeMoneySignal: no conversions but commercial intent → money page (pre-conversion)", () => {
    const m = computeMoneySignal({ conversions: 0, sessions: 0, query: "custom home builder quote" });
    expect(m.conversionRate).toBeNull();
    expect(m.isMoneyPage).toBe(true);
    expect(m.dollarPotential).toBe("medium");
  });

  it("computeMoneySignal: informational page, no conversions → not a money page", () => {
    const m = computeMoneySignal({ conversions: 0, sessions: 5000, query: "history of nowruz" });
    expect(m.isMoneyPage).toBe(false);
    expect(m.dollarPotential).toBe("low");
  });

  it("is deterministic + clamps negatives", () => {
    const a = computeMoneySignal({ conversions: -3, sessions: -10, query: "price" });
    expect(a.conversions).toBe(0);
    expect(a.sessions).toBe(0);
    expect(computeMoneySignal({ conversions: 2, sessions: 100, query: "x" })).toEqual(
      computeMoneySignal({ conversions: 2, sessions: 100, query: "x" }),
    );
  });
});
