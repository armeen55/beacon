/**
 * intent-clusters-loader.test.ts (BEACON_500 item N7).
 *
 * Pins the one PURE reduction in the loader file: deriving the tracked-
 * query universe from an already-loaded GSC page-signal map (dedupe,
 * lowercase/trim normalization, and the cap). The Supabase-reading
 * functions (`loadSerpSnapshotsForQueries`, `loadIntentClustersForTenant`)
 * are I/O boundaries covered by the hermetic fail-soft contract elsewhere
 * (they gate on `isSupabaseConfigured()`, matching serp-history.ts's own
 * untested-by-unit-test I/O shell), not re-tested here to avoid a live-DB
 * dependency in a `npm run test` hermetic run.
 */
import { describe, it, expect } from "vitest";

import { trackedQueriesFromGscSignals } from "./intent-clusters-loader";
import type { GscPageSignal } from "@/domains/recommendation-intelligence/gsc-page-signals";

function pageSignal(page: string, queries: string[]): GscPageSignal {
  return {
    page,
    clicks90d: 10,
    impressions90d: 100,
    ctr90d: 0.1,
    position90d: 5,
    topQueries: queries.map((query) => ({ query, clicks: 1, impressions: 10, ctr: 0.1, position: 5 })),
  };
}

describe("trackedQueriesFromGscSignals (pure)", () => {
  it("returns [] for an empty map", () => {
    expect(trackedQueriesFromGscSignals(new Map())).toEqual([]);
  });

  it("collects distinct, normalized queries across every page", () => {
    const map = new Map<string, GscPageSignal>([
      ["/a", pageSignal("/a", ["Nowruz Gifts", "  persian rugs  "])],
      ["/b", pageSignal("/b", ["nowruz gifts", "chaharshanbe suri"])],
    ]);
    const result = trackedQueriesFromGscSignals(map);
    expect(result.sort()).toEqual(["chaharshanbe suri", "nowruz gifts", "persian rugs"]);
  });

  it("drops empty/whitespace-only queries", () => {
    const map = new Map<string, GscPageSignal>([["/a", pageSignal("/a", ["   ", "real query"])]]);
    expect(trackedQueriesFromGscSignals(map)).toEqual(["real query"]);
  });

  it("respects the maxQueries cap", () => {
    const map = new Map<string, GscPageSignal>([
      ["/a", pageSignal("/a", ["q1", "q2", "q3", "q4", "q5"])],
    ]);
    const result = trackedQueriesFromGscSignals(map, 3);
    expect(result).toHaveLength(3);
  });
});
