/**
 * perf-log external-call tally (W2-B, 2026-07-10).
 *
 * Outside a React request scope (this test runner, crons, scripts) the per-request
 * `react.cache` counter is a passthrough, so the module falls back to a stable
 * process-level tally. These pins exercise THAT path: the tally accumulates by
 * kind, snapshots honestly, and RESETS to zero on demand - the same reset the
 * per-request scoping performs automatically between GETs in a real request.
 */
import { beforeEach, describe, expect, it } from "vitest";

import {
  perfCountExternal,
  readExternalCallCounts,
  resetExternalCallCounts,
  type ExternalCallKind,
} from "./perf-log";

beforeEach(() => {
  resetExternalCallCounts();
});

describe("external-call tally", () => {
  it("starts (after reset) at zero for every kind", () => {
    expect(readExternalCallCounts()).toEqual({ serp: 0, llm: 0, dataforseo: 0, crawl: 0 });
  });

  it("accumulates per kind independently", () => {
    perfCountExternal("serp");
    perfCountExternal("dataforseo");
    perfCountExternal("dataforseo");
    perfCountExternal("crawl");
    const counts = readExternalCallCounts();
    expect(counts.serp).toBe(1);
    expect(counts.dataforseo).toBe(2);
    expect(counts.crawl).toBe(1);
    expect(counts.llm).toBe(0);
  });

  it("resets the tally to zero (the per-request reset semantics)", () => {
    perfCountExternal("serp");
    perfCountExternal("llm");
    expect(readExternalCallCounts().serp).toBe(1);
    resetExternalCallCounts();
    expect(readExternalCallCounts()).toEqual({ serp: 0, llm: 0, dataforseo: 0, crawl: 0 });
  });

  it("all four declared kinds are countable (serp, llm, dataforseo, crawl)", () => {
    const kinds: ExternalCallKind[] = ["serp", "llm", "dataforseo", "crawl"];
    for (const k of kinds) perfCountExternal(k);
    const counts = readExternalCallCounts();
    for (const k of kinds) expect(counts[k]).toBe(1);
  });

  it("readExternalCallCounts returns a snapshot copy, not a live handle", () => {
    perfCountExternal("serp");
    const snap = readExternalCallCounts();
    perfCountExternal("serp");
    // The earlier snapshot must not have mutated.
    expect(snap.serp).toBe(1);
    expect(readExternalCallCounts().serp).toBe(2);
  });
});
