/** Update data with NOTHING connected (V1 closure, launch blocker 13). The action used to return the
 *  moment it found zero third-party connectors, which skipped everything Beacon gathers for itself: the
 *  extra reading of today's AI answers was requested only by accounts that happened to have Google. An
 *  account running on Beacon's own research now gets the same native work, and one honest line about it. */
import { describe, it, expect, beforeEach, vi } from "vitest";

type Verdict = { granted: boolean; reason: string; due: { promptId: string }[] };
const GRANTED: Verdict = { granted: true, reason: "I will take a second reading on 3 question and engine pairs on the next pass.", due: [{ promptId: "p1" }, { promptId: "p2" }, { promptId: "p3" }] };
const REFUSED: Verdict = { granted: false, due: [], reason: "I still owe today's one reading on 11 question and engine pairs, and an extra read before that is done would tilt today's average. I finish today's round first, then a second read is worth taking." };
const CALLS = vi.hoisted(() => ({ extraSample: 0, warm: 0, synced: 0, connected: false,
  verdict: { granted: true, reason: "I will take a second reading on 3 question and engine pairs on the next pass.", due: [{ promptId: "p1" }, { promptId: "p2" }, { promptId: "p3" }] } as { granted: boolean; reason: string; due: { promptId: string }[] } }));

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
  requestExtraSample: async () => { CALLS.extraSample += 1; return CALLS.verdict; },
  warmFreeSurfaces: async () => { CALLS.warm += 1; },
  recordSourceRefresh: async () => {},
}));

import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { refreshAllConnectedDataNow } from "@/app/(shell)/settings/connectors/actions";
import { RefreshResultList } from "@/components/today/refresh-my-data-button";

beforeEach(() => { CALLS.extraSample = 0; CALLS.warm = 0; CALLS.synced = 0; CALLS.connected = false; CALLS.verdict = GRANTED; });

describe("Update data with no third-party connection", () => {
  it("still asks for the extra AI reading and warms what the operator is about to look at", async () => {
    await refreshAllConnectedDataNow();
    expect(CALLS.extraSample).toBe(1);
    expect(CALLS.warm).toBe(1);
    expect(CALLS.synced).toBe(0);
  });

  it("says what the readings ACTUALLY did, on the granted branch and on the refused one", async () => {
    // GRANTED: the number of readings the planner really authorized, never a vague "I refreshed things".
    const granted = (await refreshAllConnectedDataNow()).results[0]!;
    expect(granted.ok).toBe(true);
    expect(`${granted.label} ${granted.detail}`).toBe(
      "My own research. I am taking 3 fresh AI readings now. Connect Google to refresh your search data too.",
    );
    // REFUSED: the planner's OWN sentence, which used to be dropped into a log line while the operator
    // read that Beacon had refreshed its own research.
    CALLS.verdict = REFUSED;
    const refused = (await refreshAllConnectedDataNow()).results[0]!;
    expect(refused.detail).toBe(`${REFUSED.reason} Connect Google to refresh your search data too.`);
    expect(refused.detail).not.toContain("I refreshed what I gather myself");
    // Beacon voice: first person, a next step, and never a dash.
    for (const line of [granted, refused]) expect(line.detail).not.toMatch(/[\u2013\u2014]/);
  });

  it("tells the truth when the press itself failed, instead of claiming nothing is connected", async () => {
    // The action now always answers with at least its own research line, so an empty list can only mean the
    // press failed. "Nothing connected to refresh yet." was a claim about the account, not about the press.
    const failed = renderToStaticMarkup(createElement(RefreshResultList, { results: [] }));
    expect(failed).toContain("I could not refresh anything just now; try again in a minute.");
    expect(failed).not.toContain("Nothing connected");
    const line = (await refreshAllConnectedDataNow()).results[0]!;
    expect(renderToStaticMarkup(createElement(RefreshResultList, { results: [line] }))).toContain(line.detail);
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
