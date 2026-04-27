/**
 * Sprint 6A.3a (2026-04-26) — pricing helper tests.
 *
 * Pure / no I/O. Pins the cost-estimator math + fallback behavior
 * before the polling loop wires it in (6A.3c). Pricing values come
 * from `src/lib/cost/pricing.ts` constants; if those are bumped, the
 * boundary tests below will need to follow — that's intentional, the
 * test acts as a change-detector for stale pricing.
 */

import { describe, it, expect } from "vitest";
import { estimatePromptCost } from "@/lib/cost/pricing";

describe("estimatePromptCost — OpenAI", () => {
  it("computes gpt-4o cost from input + output tokens (no web_search)", () => {
    // 1M in × $2.50/M + 1M out × $10/M = $2.50 + $10.00 = $12.50
    const r = estimatePromptCost({
      provider: "openai",
      model: "gpt-4o",
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    expect(r.totalUsd).toBeCloseTo(12.5, 6);
    expect(r.breakdown.inputUsd).toBeCloseTo(2.5, 6);
    expect(r.breakdown.outputUsd).toBeCloseTo(10.0, 6);
    expect(r.breakdown.webSearchUsd).toBe(0);
    expect(r.modelMatched).toBe(true);
  });

  it("includes web_search_preview cost when webSearchCalls > 0", () => {
    // 1 web search × $30/1k = $0.03
    const r = estimatePromptCost({
      provider: "openai",
      model: "gpt-4o",
      inputTokens: 0,
      outputTokens: 0,
      webSearchCalls: 1,
    });
    expect(r.totalUsd).toBeCloseTo(0.03, 6);
    expect(r.breakdown.webSearchUsd).toBeCloseTo(0.03, 6);
  });

  it("scales web_search cost linearly", () => {
    // 100 web searches × $30/1k = $3.00
    const r = estimatePromptCost({
      provider: "openai",
      model: "gpt-4o",
      inputTokens: 0,
      outputTokens: 0,
      webSearchCalls: 100,
    });
    expect(r.totalUsd).toBeCloseTo(3.0, 6);
  });

  it("computes gpt-4o-mini cost (cheaper rates)", () => {
    // 1M in × $0.15/M + 1M out × $0.60/M = $0.15 + $0.60 = $0.75
    const r = estimatePromptCost({
      provider: "openai",
      model: "gpt-4o-mini",
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    expect(r.totalUsd).toBeCloseTo(0.75, 6);
    expect(r.modelMatched).toBe(true);
  });

  it("computes gpt-5-mini cost (Sprint 6A.2 specific-edit model)", () => {
    // Realistic packet: 4k in, 2k out → 0.004 × $0.25 + 0.002 × $2 = $0.001 + $0.004 = $0.005
    const r = estimatePromptCost({
      provider: "openai",
      model: "gpt-5-mini",
      inputTokens: 4_000,
      outputTokens: 2_000,
    });
    expect(r.totalUsd).toBeCloseTo(0.005, 6);
  });

  it("normalizes versioned model ids (gpt-4o-2024-08-06 → gpt-4o table entry)", () => {
    // Either the table has the exact id (it does) or normalization
    // strips the date suffix; both paths must hit gpt-4o pricing.
    const r = estimatePromptCost({
      provider: "openai",
      model: "gpt-4o-2024-08-06",
      inputTokens: 1_000_000,
      outputTokens: 0,
    });
    expect(r.totalUsd).toBeCloseTo(2.5, 6);
    expect(r.modelMatched).toBe(true);
  });

  it("falls back to most-expensive-in-family when model is unknown (conservative)", () => {
    // Unknown model → fallback to gpt-4o rates.
    const r = estimatePromptCost({
      provider: "openai",
      model: "gpt-future-99-pro",
      inputTokens: 1_000_000,
      outputTokens: 0,
    });
    expect(r.totalUsd).toBeCloseTo(2.5, 6);
    expect(r.modelMatched).toBe(false);
  });
});

describe("estimatePromptCost — Perplexity", () => {
  it("computes sonar cost from input + output tokens (no separate search charge)", () => {
    // 1M in × $1/M + 1M out × $1/M = $2
    const r = estimatePromptCost({
      provider: "perplexity",
      model: "sonar",
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    expect(r.totalUsd).toBeCloseTo(2.0, 6);
    expect(r.breakdown.webSearchUsd).toBe(0);
    expect(r.modelMatched).toBe(true);
  });

  it("ignores webSearchCalls for perplexity (search bundled into token pricing)", () => {
    const r = estimatePromptCost({
      provider: "perplexity",
      model: "sonar",
      inputTokens: 0,
      outputTokens: 0,
      webSearchCalls: 5, // ignored
    });
    expect(r.totalUsd).toBe(0);
    expect(r.breakdown.webSearchUsd).toBe(0);
  });

  it("computes sonar-pro cost (more expensive)", () => {
    // 1M in × $3/M + 1M out × $15/M = $18
    const r = estimatePromptCost({
      provider: "perplexity",
      model: "sonar-pro",
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    expect(r.totalUsd).toBeCloseTo(18.0, 6);
  });

  it("falls back to most-expensive-in-family (sonar-pro) for unknown perplexity model", () => {
    const r = estimatePromptCost({
      provider: "perplexity",
      model: "sonar-future-99",
      inputTokens: 1_000_000,
      outputTokens: 0,
    });
    expect(r.totalUsd).toBeCloseTo(3.0, 6);
    expect(r.modelMatched).toBe(false);
  });
});

describe("estimatePromptCost — missing usage / safe defaults", () => {
  it("returns zero cost when both token counts are absent (legacy mock)", () => {
    const r = estimatePromptCost({
      provider: "openai",
      model: "gpt-4o",
    });
    expect(r.totalUsd).toBe(0);
    expect(r.breakdown.inputUsd).toBe(0);
    expect(r.breakdown.outputUsd).toBe(0);
    expect(r.breakdown.webSearchUsd).toBe(0);
  });

  it("returns zero cost when usage is fully zero", () => {
    const r = estimatePromptCost({
      provider: "perplexity",
      model: "sonar",
      inputTokens: 0,
      outputTokens: 0,
    });
    expect(r.totalUsd).toBe(0);
  });

  it("treats undefined webSearchCalls as 0 (no NaN)", () => {
    const r = estimatePromptCost({
      provider: "openai",
      model: "gpt-4o",
      inputTokens: 1_000,
      outputTokens: 500,
      // webSearchCalls intentionally omitted
    });
    expect(Number.isFinite(r.totalUsd)).toBe(true);
    expect(r.breakdown.webSearchUsd).toBe(0);
  });
});

describe("estimatePromptCost — rounding", () => {
  it("rounds totalUsd to 6 decimal places", () => {
    // gpt-5-mini: 12345 in × $0.25/M + 6789 out × $2/M
    //  = 0.003086... + 0.013578 = 0.016664...
    const r = estimatePromptCost({
      provider: "openai",
      model: "gpt-5-mini",
      inputTokens: 12345,
      outputTokens: 6789,
    });
    const decimals = r.totalUsd.toString().split(".")[1] ?? "";
    expect(decimals.length).toBeLessThanOrEqual(6);
  });

  it("each breakdown component is independently rounded to 6 decimals", () => {
    const r = estimatePromptCost({
      provider: "openai",
      model: "gpt-4o",
      inputTokens: 7777,
      outputTokens: 3333,
      webSearchCalls: 3,
    });
    for (const v of [
      r.breakdown.inputUsd,
      r.breakdown.outputUsd,
      r.breakdown.webSearchUsd,
    ]) {
      const decimals = v.toString().split(".")[1] ?? "";
      expect(decimals.length).toBeLessThanOrEqual(6);
    }
  });
});
