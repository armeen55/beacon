/**
 * 2026-06-09 — "refresh all data sources" orchestrator tests (§5). The
 * composed per-connector refresh actions / sync engines are mocked; this pins
 * the operator gate + the refreshed/skipped/failed classification + counts.
 *
 * 2026-06-15 — extended for the no-cron golden path: GSC + Profound + Clarity
 * sync engines are now part of refreshAllDataSources (6 sources total), so the
 * operator can refresh every connected source on demand with no cron.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

let _operator = true;
vi.mock("@/lib/operator-mode", () => ({
  isOperatorModeServer: () => _operator,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/tenant-context", () => ({
  currentTenantId: async () => "tenant-test",
}));
// call_tracking on so the CallRail branch participates (matches the original
// 3-source expectation); the orchestrator dynamic-imports this module.
vi.mock("@/domains/tenants/tenant-features", () => ({
  getCurrentTenantFeatures: async () => ({ call_tracking: true }),
}));

let _ga4: unknown = { ok: true, rows_upserted: 12, startDate: "2026-05-01", endDate: "2026-06-01" };
let _callrail: unknown = { ok: true, rowsUpserted: 3, persisted: true };
let _gsc: unknown = { synced: true, property: "sc-domain:x.com", days: 5, rows_upserted: 100 };
let _profound: unknown = { synced: true, citation_rows: 7 };
let _clarity: unknown = { synced: true, rows_upserted: 4 };

const refreshTenantGa4Traffic = vi.fn(async () => _ga4);
const refreshCallRailMetrics = vi.fn(async () => _callrail);
const syncGsc = vi.fn(async () => _gsc);
const syncProfound = vi.fn(async () => _profound);
const syncClarity = vi.fn(async () => _clarity);

vi.mock("@/app/(shell)/diagnostics/outcome-attribution/actions", () => ({
  refreshTenantGa4Traffic: () => refreshTenantGa4Traffic(),
}));
vi.mock("@/app/(shell)/diagnostics/callrail/actions", () => ({
  refreshCallRailMetrics: () => refreshCallRailMetrics(),
}));
vi.mock("@/lib/connectors/gsc/sync-search-analytics", () => ({
  syncGscSearchAnalyticsForTenant: () => syncGsc(),
}));
vi.mock("@/lib/connectors/profound/sync-nightly", () => ({
  syncProfoundNightlyForTenant: () => syncProfound(),
}));
vi.mock("@/lib/connectors/clarity/sync-daily-metrics", () => ({
  syncClarityDailyMetricsForTenant: () => syncClarity(),
}));

import { refreshAllDataSources } from "@/app/(shell)/diagnostics/connectors/actions";

beforeEach(() => {
  _operator = true;
  _ga4 = { ok: true, rows_upserted: 12, startDate: "2026-05-01", endDate: "2026-06-01" };
  _callrail = { ok: true, rowsUpserted: 3, persisted: true };
  _gsc = { synced: true, property: "sc-domain:x.com", days: 5, rows_upserted: 100 };
  _profound = { synced: true, citation_rows: 7 };
  _clarity = { synced: true, rows_upserted: 4 };
  refreshTenantGa4Traffic.mockClear();
  refreshCallRailMetrics.mockClear();
  syncGsc.mockClear();
  syncProfound.mockClear();
  syncClarity.mockClear();
});

describe("refreshAllDataSources — operator gate", () => {
  it("rejects non-operators (no sub-action fires)", async () => {
    _operator = false;
    const r = await refreshAllDataSources();
    expect(r).toEqual({ ok: false, reason: "not_operator" });
    expect(refreshTenantGa4Traffic).not.toHaveBeenCalled();
    expect(refreshCallRailMetrics).not.toHaveBeenCalled();
    expect(syncGsc).not.toHaveBeenCalled();
    expect(syncProfound).not.toHaveBeenCalled();
    expect(syncClarity).not.toHaveBeenCalled();
  });
});

describe("refreshAllDataSources — classification", () => {
  it("all connected + ok → 5 refreshed (gsc, ga4, callrail, profound, clarity)", async () => {
    const r = await refreshAllDataSources();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.refreshedCount).toBe(5);
    expect(r.skippedCount).toBe(0);
    expect(r.failedCount).toBe(0);
    expect(r.results.find((x) => x.provider === "gsc")!.outcome).toBe("refreshed");
    expect(r.results.find((x) => x.provider === "gsc")!.detail).toContain("100");
    const ga4 = r.results.find((x) => x.provider === "ga4")!;
    expect(ga4.outcome).toBe("refreshed");
    expect(ga4.detail).toContain("12 URL/day rows");
    expect(r.results.find((x) => x.provider === "callrail")!.detail).toContain("3 URL/day rows");
    expect(r.results.find((x) => x.provider === "profound")!.outcome).toBe("refreshed");
    expect(r.results.find((x) => x.provider === "clarity")!.outcome).toBe("refreshed");
  });

  it("not-connected reasons → skipped (not failed), all 5", async () => {
    _ga4 = { ok: false, reason: "no_token" };
    _callrail = { ok: false, reason: "no_key" };
    _gsc = { synced: false, reason: "no_usable_gsc_token" };
    _profound = { synced: false, reason: "no_key_or_api_error" };
    _clarity = { synced: false, reason: "no_token_or_api_error" };
    const r = await refreshAllDataSources();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.skippedCount).toBe(5);
    expect(r.refreshedCount).toBe(0);
    expect(r.failedCount).toBe(0);
    expect(r.results.every((x) => x.outcome === "skipped")).toBe(true);
  });

  it("error reasons → failed; independent of the others", async () => {
    _ga4 = { ok: false, reason: "api_error" }; // failed
    _callrail = { ok: true, rowsUpserted: 0, persisted: false }; // refreshed
    // gsc/profound/clarity keep their default ok (synced:true) → refreshed
    const r = await refreshAllDataSources();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.results.find((x) => x.provider === "ga4")!.outcome).toBe("failed");
    expect(r.results.find((x) => x.provider === "callrail")!.outcome).toBe("refreshed");
    // callrail + gsc + profound + clarity = 4 refreshed
    expect(r.refreshedCount).toBe(4);
    expect(r.skippedCount).toBe(0);
    expect(r.failedCount).toBe(1);
  });

  it("a genuine GSC/Clarity failure (supabase_unavailable) classifies as failed, not skipped", async () => {
    _gsc = { synced: false, reason: "supabase_unavailable" };
    _clarity = { synced: false, reason: "upsert_failed" };
    const r = await refreshAllDataSources();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.results.find((x) => x.provider === "gsc")!.outcome).toBe("failed");
    expect(r.results.find((x) => x.provider === "clarity")!.outcome).toBe("failed");
  });

  // #87/#88 (2026-06-14) — the engines now distinguish "never connected"
  // (benign skip) from "connected but auth broke / API errored" (failed).
  it("a CONNECTED-but-expired GSC token (gsc_token_expired) is a FAILURE, not a skip", async () => {
    _gsc = { synced: false, reason: "gsc_token_expired" };
    const r = await refreshAllDataSources();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.results.find((x) => x.provider === "gsc")!.outcome).toBe("failed");
  });

  it("Profound with a key but a failed API call (profound_api_error) is a FAILURE", async () => {
    _profound = { synced: false, reason: "profound_api_error" };
    const r = await refreshAllDataSources();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.results.find((x) => x.provider === "profound")!.outcome).toBe("failed");
  });

  it("Profound with NO key (no_profound_key) is a benign skip", async () => {
    _profound = { synced: false, reason: "no_profound_key" };
    const r = await refreshAllDataSources();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.results.find((x) => x.provider === "profound")!.outcome).toBe("skipped");
  });

  it("Profound zero genuine results (synced:true, citation_rows:0) is refreshed, not failed", async () => {
    _profound = { synced: true, citation_rows: 0 };
    const r = await refreshAllDataSources();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.results.find((x) => x.provider === "profound")!.outcome).toBe("refreshed");
  });

  it("runs every source even when the first fails", async () => {
    _gsc = { synced: false, reason: "supabase_unavailable" };
    await refreshAllDataSources();
    expect(syncGsc).toHaveBeenCalledTimes(1);
    expect(refreshTenantGa4Traffic).toHaveBeenCalledTimes(1);
    expect(refreshCallRailMetrics).toHaveBeenCalledTimes(1);
    expect(syncProfound).toHaveBeenCalledTimes(1);
    expect(syncClarity).toHaveBeenCalledTimes(1);
  });
});
