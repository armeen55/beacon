/**
 * 2026-06-09 — "refresh all data sources" orchestrator tests (§5). The
 * three composed per-connector refresh actions are mocked; this pins the
 * operator gate + the refreshed/skipped/failed classification + counts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

let _operator = true;
vi.mock("@/lib/operator-mode", () => ({
  isOperatorModeServer: () => _operator,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

let _ga4: unknown = { ok: true, rows_upserted: 12, startDate: "2026-05-01", endDate: "2026-06-01" };
let _callrail: unknown = { ok: true, rowsUpserted: 3, persisted: true };
let _semrush: unknown = { ok: true, persisted: true, competitorCount: 5 };

const refreshTenantGa4Traffic = vi.fn(async () => _ga4);
const refreshCallRailMetrics = vi.fn(async () => _callrail);
const refreshSemrushMetrics = vi.fn(async () => _semrush);

vi.mock("@/app/(shell)/diagnostics/outcome-attribution/actions", () => ({
  refreshTenantGa4Traffic: () => refreshTenantGa4Traffic(),
}));
vi.mock("@/app/(shell)/diagnostics/semrush/actions", () => ({
  refreshSemrushMetrics: () => refreshSemrushMetrics(),
}));
vi.mock("@/app/(shell)/diagnostics/callrail/actions", () => ({
  refreshCallRailMetrics: () => refreshCallRailMetrics(),
}));

import { refreshAllDataSources } from "@/app/(shell)/diagnostics/connectors/actions";

beforeEach(() => {
  _operator = true;
  _ga4 = { ok: true, rows_upserted: 12, startDate: "2026-05-01", endDate: "2026-06-01" };
  _callrail = { ok: true, rowsUpserted: 3, persisted: true };
  _semrush = { ok: true, persisted: true, competitorCount: 5 };
  refreshTenantGa4Traffic.mockClear();
  refreshCallRailMetrics.mockClear();
  refreshSemrushMetrics.mockClear();
});

describe("refreshAllDataSources — operator gate", () => {
  it("rejects non-operators (no sub-action fires)", async () => {
    _operator = false;
    const r = await refreshAllDataSources();
    expect(r).toEqual({ ok: false, reason: "not_operator" });
    expect(refreshTenantGa4Traffic).not.toHaveBeenCalled();
    expect(refreshCallRailMetrics).not.toHaveBeenCalled();
    expect(refreshSemrushMetrics).not.toHaveBeenCalled();
  });
});

describe("refreshAllDataSources — classification", () => {
  it("all connected + ok → 3 refreshed", async () => {
    const r = await refreshAllDataSources();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.refreshedCount).toBe(3);
    expect(r.skippedCount).toBe(0);
    expect(r.failedCount).toBe(0);
    const ga4 = r.results.find((x) => x.provider === "ga4")!;
    expect(ga4.outcome).toBe("refreshed");
    expect(ga4.detail).toContain("12 URL/day rows");
    expect(r.results.find((x) => x.provider === "callrail")!.detail).toContain("3 URL/day rows");
    expect(r.results.find((x) => x.provider === "semrush")!.detail).toContain("5 organic competitors");
  });

  it("not-connected reasons → skipped (not failed)", async () => {
    _ga4 = { ok: false, reason: "no_token" };
    _callrail = { ok: false, reason: "no_key" };
    _semrush = { ok: false, reason: "no_domain" };
    const r = await refreshAllDataSources();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.skippedCount).toBe(3);
    expect(r.refreshedCount).toBe(0);
    expect(r.failedCount).toBe(0);
    expect(r.results.every((x) => x.outcome === "skipped")).toBe(true);
  });

  it("error reasons → failed; independent of the others", async () => {
    _ga4 = { ok: false, reason: "api_error" };
    _callrail = { ok: true, rowsUpserted: 0, persisted: false }; // connected, nothing new
    _semrush = { ok: false, reason: "disconnected" }; // skipped
    const r = await refreshAllDataSources();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.results.find((x) => x.provider === "ga4")!.outcome).toBe("failed");
    expect(r.results.find((x) => x.provider === "callrail")!.outcome).toBe("refreshed");
    expect(r.results.find((x) => x.provider === "semrush")!.outcome).toBe("skipped");
    expect(r.refreshedCount).toBe(1);
    expect(r.skippedCount).toBe(1);
    expect(r.failedCount).toBe(1);
  });

  it("runs all three even when the first fails", async () => {
    _ga4 = { ok: false, reason: "api_error" };
    await refreshAllDataSources();
    expect(refreshTenantGa4Traffic).toHaveBeenCalledTimes(1);
    expect(refreshCallRailMetrics).toHaveBeenCalledTimes(1);
    expect(refreshSemrushMetrics).toHaveBeenCalledTimes(1);
  });
});
