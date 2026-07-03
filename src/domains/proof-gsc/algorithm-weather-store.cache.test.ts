/**
 * algorithm-weather-store.cache.test.ts (R23 P17, 2026-07-03, read-path perf).
 *
 * Pins the request-cache wrap on `loadDetectedChangepoints`. A single cockpit
 * render reads it from two components (cumulative-outcome strip + scoreboard) AND
 * three times inside the demand-graph build's learning gates; each call is a
 * Supabase-mirrored blob read on hosted prod.
 *
 * BEHAVIOR-PRESERVING: the wrap changes only the read count within a request,
 * never the output. These tests pin identical output + a single store read per
 * caller invocation in this (scope-less) env. In a real React request scope the
 * SAME-args repeat calls are served from the cache, so the DB read count drops to
 * one — the same mechanism the other request-caches in this codebase use.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

let storeRows: unknown[] = [];
let readCalls = 0;
vi.mock("@/lib/persistence/json-store", () => ({
  readStore: async () => {
    readCalls += 1;
    return storeRows;
  },
  writeStore: async (_name: string, data: unknown[]) => {
    storeRows = data;
  },
}));

import { loadDetectedChangepoints, type AlgorithmWeatherRow } from "./algorithm-weather-store";
import type { Changepoint } from "./changepoint";

const NOW = new Date("2026-07-03T12:00:00.000Z");

function cp(over: Partial<Changepoint> = {}): Changepoint {
  return { date: "2026-06-28", direction: "up", magnitude: 0.55, ...over };
}

function summary(over: Partial<AlgorithmWeatherRow> = {}): AlgorithmWeatherRow {
  return {
    tenant_id: "tenant-a",
    computed_at: NOW.toISOString(),
    anchor_date: "2026-06-28",
    clicksChangepoints: [cp()],
    impressionsChangepoints: [cp({ date: "2026-06-20", direction: "down", magnitude: 0.4 })],
    ...over,
  };
}

beforeEach(() => {
  storeRows = [];
  readCalls = 0;
});

describe("loadDetectedChangepoints request-cache wrap (R23 P17)", () => {
  it("merges clicks + impressions changepoints identically to the uncached reader", async () => {
    storeRows = [summary()];
    const out = await loadDetectedChangepoints("tenant-a", NOW);
    // Both series merged, deduped by date:direction, order preserved.
    expect(out.map((c) => `${c.date}:${c.direction}`)).toEqual([
      "2026-06-28:up",
      "2026-06-20:down",
    ]);
  });

  it("returns IDENTICAL output on repeated calls (same store in → same changepoints out)", async () => {
    storeRows = [summary()];
    const first = await loadDetectedChangepoints("tenant-a", NOW);
    const second = await loadDetectedChangepoints("tenant-a", NOW);
    expect(second).toEqual(first);
  });

  it("dedupes a changepoint that appears in BOTH series (behavior unchanged)", async () => {
    storeRows = [
      summary({
        clicksChangepoints: [cp({ date: "2026-06-28", direction: "up" })],
        impressionsChangepoints: [cp({ date: "2026-06-28", direction: "up" })],
      }),
    ];
    const out = await loadDetectedChangepoints("tenant-a", NOW);
    expect(out).toHaveLength(1);
  });

  it("returns [] when no fresh pass exists (unchanged honest empty)", async () => {
    storeRows = [];
    const out = await loadDetectedChangepoints("tenant-a", NOW);
    expect(out).toEqual([]);
  });

  it("each caller invocation drives exactly one store read in a scope-less env", async () => {
    storeRows = [summary()];
    await loadDetectedChangepoints("tenant-a", NOW);
    // One readStore round-trip per invocation — the wrap never double-reads.
    expect(readCalls).toBe(1);
  });

  it("is a react.cache-wrapped callable (dedupes per request in a real scope)", () => {
    // react.cache returns a variadic wrapper (arity 0) — the tell that the
    // request-cache wrap is actually in place, not a bare async function.
    expect(typeof loadDetectedChangepoints).toBe("function");
    expect(loadDetectedChangepoints.length).toBe(0);
  });
});
