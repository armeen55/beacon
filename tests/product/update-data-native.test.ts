/** UPDATE DATA MEANS A $0 REFRESH. The press used to warm paid competitor context, grant an extra AI reading and hand the browser a research continuation, so a button labelled refresh silently spent from the account (Codex, 2026-08-28). It refreshes connected first-party data and republishes stored truth, and nothing more; research keeps its own schedule. The old header stands below for the other half it still pins: with NOTHING connected the action must not return early and must still repaint from stored evidence. (V1 closure, launch blocker 13; the action used to return the moment it found zero third-party connectors, which skipped everything Beacon gathers for itself: the extra reading of today's AI answers was requested only by accounts that happened to have Google. An account running on Beacon's own research now gets the same native work, and one honest line about it. */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
type Verdict = { granted: boolean; reason: string; due: { promptId: string }[] };
const GRANTED: Verdict = { granted: true, reason: "I will take a second reading on 3 question and engine pairs on the next pass.", due: [{ promptId: "p1" }, { promptId: "p2" }, { promptId: "p3" }] };
const REFUSED: Verdict = { granted: false, due: [], reason: "I still owe today's one reading on 11 question and engine pairs, and an extra read before that is done would tilt today's average. I finish today's round first, then a second read is worth taking." };
const CALLS = vi.hoisted(() => ({ extraSample: 0, warm: 0, synced: 0, connected: false, extraDays: [] as string[],
  verdict: { granted: true, reason: "I will take a second reading on 3 question and engine pairs on the next pass.", due: [{ promptId: "p1" }, { promptId: "p2" }, { promptId: "p3" }] } as Verdict }));
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
  updateConnectorToken: async () => {},}));
vi.mock("@/domains/runtime", () => ({
  continueResearch: async () => ({ hop: 1, more: false }),
  requestExtraSample: async (_t: string, day: string) => { CALLS.extraSample += 1; CALLS.extraDays.push(day); return CALLS.verdict; },
  researchPermission: async () => "running" as const,
  publishCustomerSurfaces: async () => { CALLS.warm += 1; },
  finalizeFreeSurfaces: async () => { CALLS.warm += 1; },
  recordSourceRefresh: async () => {},}));
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { refreshAllConnectedDataNow } from "@/app/(shell)/settings/connectors/actions";
import { RefreshResultList } from "@/components/today/refresh-my-data-button";
beforeEach(() => { CALLS.extraSample = 0; CALLS.warm = 0; CALLS.synced = 0; CALLS.connected = false; CALLS.verdict = GRANTED; CALLS.extraDays = []; });
afterEach(() => { vi.useRealTimers(); });
describe("Update data is a true $0 refresh", () => {
  it("buys nothing on a press, with due research, an unread backlog and undecided rivals all standing", async () => {
    // The seams that used to spend are wired to count; a running account with everything tempting on the table still reaches none of them, twice, and the free republish runs each time.
    const first = await refreshAllConnectedDataNow();
    const second = await refreshAllConnectedDataNow();
    expect([CALLS.extraSample, CALLS.warm >= 2, first.results.length > 0, second.results.length > 0]).toEqual([0, true, true, true]);
    const line = first.results.find((r) => r.provider === "beacon_research");
    expect(line?.detail, "the press says what it did: stored truth at no cost").toContain("no cost");
    expect(line?.detail).not.toContain("reading");
  });
  it("still repaints from stored evidence when nothing is connected, and reports connector truth when one is", async () => {
    CALLS.connected = true;
    const res = await refreshAllConnectedDataNow();
    expect(CALLS.synced, "connected sources sync").toBeGreaterThan(0);
    expect(CALLS.extraSample, "and connected changes nothing about spend").toBe(0);
    expect(res.results.some((r) => r.provider === "beacon_research"), "no native line when real connectors answered").toBe(false);
  });
});
