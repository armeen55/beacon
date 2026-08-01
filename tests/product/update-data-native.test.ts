/** Update data with NOTHING connected (V1 closure, launch blocker 13). The action used to return the
 *  moment it found zero third-party connectors, which skipped everything Beacon gathers for itself: the
 *  extra reading of today's AI answers was requested only by accounts that happened to have Google. An
 *  account running on Beacon's own research now gets the same native work, and one honest line about it. */
import { describe, it, expect, beforeEach, vi } from "vitest";

const CALLS = vi.hoisted(() => ({ extraSample: 0, warm: 0, synced: 0, connected: false }));

const sync = vi.hoisted(() => async () => { CALLS.synced += 1; return { synced: true, rows_upserted: 4 }; });
vi.mock("@/lib/connectors/gsc/sync-search-analytics", () => ({ syncGscSearchAnalyticsForTenant: sync }));
vi.mock("@/lib/connectors/ga4/sync-url-traffic", () => ({ syncGa4UrlTrafficForTenant: sync }));
vi.mock("@/lib/connectors/clarity/sync-daily-metrics", () => ({ syncClarityDailyMetricsForTenant: sync }));

vi.mock("@/lib/tenant-context", () => ({ currentTenantId: async () => "acct-native" }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/connector-store", () => ({
  getConnectorInfo: async () => ({ status: CALLS.connected ? "connected" : "not_connected" }),
  getGoogleConnectorToken: async () => null,
  getYelpConnectorToken: async () => null,
  deleteConnectorToken: async () => {},
  saveConnectorToken: async () => {},
  updateConnectorToken: async () => {},
}));
vi.mock("@/domains/runtime", () => ({
  continueResearch: async () => ({ hop: 1, more: false }),
  researchTick: async () => ({ hop: 0, next: "stop" }),
  requestExtraSample: async () => { CALLS.extraSample += 1; return { granted: 2, due: [], reason: "granted" }; },
  warmFreeSurfaces: async () => { CALLS.warm += 1; },
  recordSourceRefresh: async () => {},
}));

import { refreshAllConnectedDataNow } from "@/app/(shell)/settings/connectors/actions";

beforeEach(() => { CALLS.extraSample = 0; CALLS.warm = 0; CALLS.synced = 0; CALLS.connected = false; });

describe("Update data with no third-party connection", () => {
  it("still asks for the extra AI reading and warms what the operator is about to look at", async () => {
    await refreshAllConnectedDataNow();
    expect(CALLS.extraSample).toBe(1);
    expect(CALLS.warm).toBe(1);
    expect(CALLS.synced).toBe(0);
  });

  it("says honestly what it refreshed and what is still missing", async () => {
    const result = await refreshAllConnectedDataNow();
    expect(result.results).toHaveLength(1);
    const line = result.results[0]!;
    expect(line.ok).toBe(true);
    expect(`${line.label} ${line.detail}`).toBe(
      "My own research. I refreshed what I gather myself. Connect Google to refresh your search data too.",
    );
    // Beacon voice: first person, a next step, and never a dash.
    expect(line.detail).not.toMatch(/[\u2013\u2014]/);
  });

  it("leaves a connected account exactly as it was: the sources still sync and no native line is added", async () => {
    CALLS.connected = true;
    const result = await refreshAllConnectedDataNow();
    expect(CALLS.synced).toBe(3);
    expect(CALLS.extraSample).toBe(1);
    expect(result.results.map((r) => r.provider)).toEqual(["google_gsc", "google_ga4", "clarity"]);
    expect(result.results.every((r) => r.ok)).toBe(true);
  });
});
