import { describe, expect, it } from "vitest";
import { isStrategyMixFresh, strategyMemoLine } from "./surface";
import type { StrategyMixRecord } from "./strategy-mix-store";

function record(over: Partial<StrategyMixRecord> = {}): StrategyMixRecord {
  return {
    tenant_id: "t",
    weekOf: "2026-07-06",
    leverMix: [],
    focusFamilies: [],
    memo: "I am leaning into answer blocks this week.",
    appliedAt: "2026-07-05T22:00:00.000Z",
    source: "llm",
    ...over,
  };
}

describe("isStrategyMixFresh", () => {
  it("is fresh when weekOf is today", () => {
    expect(isStrategyMixFresh(record({ weekOf: "2026-07-06" }), new Date("2026-07-06T12:00:00Z"))).toBe(true);
  });

  it("is fresh a few days into the week", () => {
    expect(isStrategyMixFresh(record({ weekOf: "2026-07-06" }), new Date("2026-07-08T12:00:00Z"))).toBe(true);
  });

  it("is stale a month later", () => {
    expect(isStrategyMixFresh(record({ weekOf: "2026-06-01" }), new Date("2026-07-06T12:00:00Z"))).toBe(false);
  });

  it("is stale for an unparseable weekOf", () => {
    expect(isStrategyMixFresh(record({ weekOf: "not-a-date" }), new Date("2026-07-06T12:00:00Z"))).toBe(false);
  });
});

describe("strategyMemoLine", () => {
  it("returns null when there is no record", () => {
    expect(strategyMemoLine(null, new Date("2026-07-06"))).toBeNull();
  });

  it("returns null when the record is stale", () => {
    expect(strategyMemoLine(record({ weekOf: "2026-01-01" }), new Date("2026-07-06"))).toBeNull();
  });

  it("returns null when the memo is empty", () => {
    expect(strategyMemoLine(record({ memo: "" }), new Date("2026-07-06"))).toBeNull();
  });

  it("signs a fresh memo", () => {
    const line = strategyMemoLine(record({ weekOf: "2026-07-06", memo: "I am leaning into answer blocks." }), new Date("2026-07-06T09:00:00Z"));
    expect(line).toBe("I am leaning into answer blocks. - your strategist, Sunday night");
  });

  it("never emits an em or en dash even if the stored memo somehow regressed", () => {
    const line = strategyMemoLine(record({ weekOf: "2026-07-06", memo: "I am leaning in — clearly" }), new Date("2026-07-06T09:00:00Z"));
    expect(line).not.toMatch(/[—–]/);
    expect(line).toBe("I am leaning in - clearly - your strategist, Sunday night");
  });
});
