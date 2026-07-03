import { describe, it, expect } from "vitest";

import {
  DEFAULT_FALLBACK_CHAIN,
  validateFallbackChain,
  decideFallback,
  runModelFallbackBenchmark,
  type FallbackChain,
} from "./model-fallback";
import { REASONING_TIMEOUT_FLOOR_MS } from "@/domains/llm/gateway";

describe("validateFallbackChain - the canonical chain is well-formed", () => {
  it("the default chain passes every well-formedness check", () => {
    const v = validateFallbackChain(DEFAULT_FALLBACK_CHAIN);
    expect(v.issues).toEqual([]);
    expect(v.wellFormed).toBe(true);
  });

  it("every rung has a positive timeout at or above the reasoning floor", () => {
    for (const rung of DEFAULT_FALLBACK_CHAIN.rungs) {
      expect(rung.timeoutMs).toBeGreaterThanOrEqual(REASONING_TIMEOUT_FLOOR_MS);
      expect(rung.reasoningEffort).not.toBeNull();
    }
  });

  it("rejects a single-rung chain (nowhere to fall back)", () => {
    const chain: FallbackChain = { task: "x", rungs: [DEFAULT_FALLBACK_CHAIN.rungs[0]!] };
    const v = validateFallbackChain(chain);
    expect(v.wellFormed).toBe(false);
    expect(v.issues.some((i) => i.problem.includes("primary and at least one fallback"))).toBe(true);
  });

  it("rejects a repeated model", () => {
    const chain: FallbackChain = {
      task: "x",
      rungs: [DEFAULT_FALLBACK_CHAIN.rungs[0]!, DEFAULT_FALLBACK_CHAIN.rungs[0]!],
    };
    const v = validateFallbackChain(chain);
    expect(v.wellFormed).toBe(false);
    expect(v.issues.some((i) => i.problem.includes("appears twice"))).toBe(true);
  });

  it("rejects a reasoning rung below the timeout floor (it would silently time out)", () => {
    const chain: FallbackChain = {
      task: "x",
      rungs: [
        { model: "gpt-5-mini", timeoutMs: 40_000, reasoningEffort: "low", note: "too short" },
        { model: "gpt-5.4-mini", timeoutMs: REASONING_TIMEOUT_FLOOR_MS, reasoningEffort: "low", note: "ok" },
      ],
    };
    const v = validateFallbackChain(chain);
    expect(v.wellFormed).toBe(false);
    expect(v.issues.some((i) => i.rungModel === "gpt-5-mini")).toBe(true);
  });

  it("rejects a reasoning rung with no reasoning effort set", () => {
    const chain: FallbackChain = {
      task: "x",
      rungs: [
        { model: "gpt-5-mini", timeoutMs: REASONING_TIMEOUT_FLOOR_MS, reasoningEffort: null, note: "no effort" },
        { model: "gpt-5.4-mini", timeoutMs: REASONING_TIMEOUT_FLOOR_MS, reasoningEffort: "low", note: "ok" },
      ],
    };
    const v = validateFallbackChain(chain);
    expect(v.wellFormed).toBe(false);
    expect(v.issues.some((i) => i.problem.includes("reasoning effort"))).toBe(true);
  });
});

describe("decideFallback - the fallback is LOUD, never silent", () => {
  it("accepts an ok response", () => {
    const d = decideFallback({ kind: "ok" }, "gpt-5-mini", true);
    expect(d.action).toBe("accept");
    expect(d.silent).toBe(false);
  });

  it("advances LOUDLY on a timeout when a fallback rung remains", () => {
    const d = decideFallback({ kind: "timeout" }, "gpt-5-mini", true);
    expect(d.action).toBe("advance");
    expect(d.silent).toBe(false);
    expect(d.reason).toContain("timed out");
    expect(d.reason).toContain("I am telling you rather than switching quietly");
  });

  it("advances LOUDLY on an http error and on a malformed response", () => {
    const httpD = decideFallback({ kind: "http_error", status: 500 }, "gpt-5-mini", true);
    expect(httpD.action).toBe("advance");
    expect(httpD.reason).toContain("HTTP 500");
    const malD = decideFallback({ kind: "malformed", detail: "bad json" }, "gpt-5-mini", true);
    expect(malD.action).toBe("advance");
    expect(malD.reason).toContain("malformed");
  });

  it("stops (exhausted) on a failure when no fallback remains, and does not publish a degraded answer", () => {
    const d = decideFallback({ kind: "timeout" }, "gpt-5.4-mini", false);
    expect(d.action).toBe("exhausted");
    expect(d.silent).toBe(false);
    expect(d.reason).toContain("no fallback left");
    expect(d.reason).toContain("did not publish a degraded answer");
  });

  it("never emits a banned dash in any reason", () => {
    const reasons = [
      decideFallback({ kind: "ok" }, "gpt-5-mini", true).reason,
      decideFallback({ kind: "timeout" }, "gpt-5-mini", true).reason,
      decideFallback({ kind: "http_error", status: 429 }, "gpt-5-mini", true).reason,
      decideFallback({ kind: "malformed", detail: "x" }, "gpt-5-mini", false).reason,
    ];
    for (const r of reasons) expect(r).not.toMatch(/[‒–—―]/);
  });
});

describe("runModelFallbackBenchmark - the whole deterministic check", () => {
  it("the default chain is well-formed and its fallback is loud", () => {
    const report = runModelFallbackBenchmark();
    expect(report.chainWellFormed).toBe(true);
    expect(report.chainIssues).toEqual([]);
    expect(report.loudFallbackVerified).toBe(true);
    expect(report.sentence).not.toMatch(/[‒–—―]/);
    expect(report.sentence.startsWith("My fallback plan is sound")).toBe(true);
  });

  it("flags a malformed chain", () => {
    const report = runModelFallbackBenchmark({ task: "x", rungs: [DEFAULT_FALLBACK_CHAIN.rungs[0]!] });
    expect(report.chainWellFormed).toBe(false);
    expect(report.sentence).toContain("to fix");
  });
});
