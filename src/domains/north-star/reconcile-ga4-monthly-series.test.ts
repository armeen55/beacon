/**
 * 2026-07-10 - Wave 2A - reconcileGa4MonthlySeries pins:
 *   - DEAD TOKEN (today's reality) -> honest not_connected, reusing the connector
 *     health reason; NEVER a fake pass/fail. Marker persisted as not_connected.
 *   - PASS within tolerance -> status pass; marker persisted as pass.
 *   - MISMATCH beyond tolerance -> status mismatch (drives the alert), NOT a claim.
 *   - exact match passes.
 *   - no property -> not_connected.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

let _token: { ga4_property_id?: string } | null = { ga4_property_id: "p1" };
const _health = { healthReason: "Reconnect Google to refresh. Google access needs renewing, reconnect now." };
vi.mock("@/lib/connector-store", () => ({
  getGoogleConnectorToken: vi.fn(async () => _token),
  getConnectorHealth: vi.fn(async () => _health),
}));

const _monthlyMock = vi.fn();
vi.mock("@/lib/connectors/ga4/data-api", () => ({
  runGa4SitewideMonthlyReport: (...a: unknown[]) => _monthlyMock(...a),
}));

const _rollupMock = vi.fn();
const _writeMock = vi.fn(async (..._a: unknown[]) => true);
vi.mock("@/domains/north-star/ga4-sitewide-rollup", () => ({
  loadGa4MonthlyRollupForTenant: (...a: unknown[]) => _rollupMock(...a),
  writeGa4Reconciliation: (...a: unknown[]) => _writeMock(...a),
}));

vi.mock("@/lib/logger", () => ({
  log: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  reconcileGa4MonthlySeries,
  GA4_NOT_CONNECTED_LINE,
} from "./reconcile-ga4-monthly-series";

const NOW = new Date("2026-07-10T12:00:00Z");

beforeEach(() => {
  _token = { ga4_property_id: "p1" };
  _monthlyMock.mockReset();
  _rollupMock.mockReset();
  _writeMock.mockClear();
});

describe("reconcileGa4MonthlySeries - dead token / not connected", () => {
  it("dead grant (token_expired) -> not_connected with the honest reused reason; marker not_connected", async () => {
    _monthlyMock.mockResolvedValue({ ok: false, reason: "token_expired" });
    const r = await reconcileGa4MonthlySeries("tenant-a", NOW);
    expect(r.status).toBe("not_connected");
    if (r.status === "not_connected") {
      expect(r.message).toBe(GA4_NOT_CONNECTED_LINE);
      expect(r.healthReason).toContain("Reconnect Google");
    }
    expect(_writeMock).toHaveBeenCalled();
    const written = _writeMock.mock.calls[0]![0] as { status: string };
    expect(written.status).toBe("not_connected");
  });

  it("no configured property -> not_connected (no live report attempted)", async () => {
    _token = { ga4_property_id: "" };
    const r = await reconcileGa4MonthlySeries("tenant-a", NOW);
    expect(r.status).toBe("not_connected");
    expect(_monthlyMock).not.toHaveBeenCalled();
  });
});

describe("reconcileGa4MonthlySeries - pass / mismatch", () => {
  it("uses the GA4 property-local date at a UTC month boundary", async () => {
    const boundaryNow = new Date("2026-07-01T01:30:00.000Z");
    _monthlyMock.mockResolvedValue({
      ok: true,
      propertyTimezone: "America/Los_Angeles",
      rows: [{ month: "2026-05-01", sessions: 100 }],
    });
    _rollupMock.mockResolvedValue({
      months: [
        { month: "2026-05-01", sessions: 100, engagedSessions: 50, partial: false },
        { month: "2026-06-01", sessions: 20, engagedSessions: 10, partial: true },
      ],
      latestSyncAt: "2026-07-01T01:00:00Z",
      propertyTimezone: "America/Los_Angeles",
      propertyId: "p1",
    });
    const r = await reconcileGa4MonthlySeries("tenant-a", boundaryNow);
    expect(r.status).toBe("pass");
    expect(_monthlyMock).toHaveBeenCalledWith(expect.objectContaining({ endDate: "2026-06-30" }));
  });

  it("fails closed when stored and live GA4 property timezones disagree", async () => {
    _monthlyMock.mockResolvedValue({ ok: true, propertyTimezone: "UTC", rows: [] });
    _rollupMock.mockResolvedValue({
      months: [{ month: "2026-06-01", sessions: 100, engagedSessions: 50, partial: false }],
      latestSyncAt: "2026-07-10T02:00:00Z",
      propertyTimezone: "America/Los_Angeles",
      propertyId: "p1",
    });
    const r = await reconcileGa4MonthlySeries("tenant-a", NOW);
    expect(r).toMatchObject({ status: "error", reason: "property_timezone_mismatch" });
  });

  it("fails closed when stored daily rows lack a property timezone", async () => {
    _monthlyMock.mockResolvedValue({ ok: true, propertyTimezone: "America/Los_Angeles", rows: [] });
    _rollupMock.mockResolvedValue({
      months: [{ month: "2026-06-01", sessions: 100, engagedSessions: 50, partial: false }],
      latestSyncAt: "2026-07-10T02:00:00Z",
      propertyTimezone: null,
      propertyId: "p1",
    });
    const r = await reconcileGa4MonthlySeries("tenant-a", NOW);
    expect(r).toMatchObject({ status: "error", reason: "property_timezone_missing" });
  });

  it("daily rollup matches the direct monthly total within tolerance -> pass", async () => {
    _monthlyMock.mockResolvedValue({
      ok: true,
      propertyTimezone: "America/Los_Angeles",
      rows: [{ month: "2026-06-01", sessions: 12540 }],
    });
    _rollupMock.mockResolvedValue({
      months: [
        { month: "2026-06-01", sessions: 12540, engagedSessions: 9000, partial: false },
        { month: "2026-07-01", sessions: 3120, engagedSessions: 2000, partial: true },
      ],
      latestSyncAt: "2026-07-10T02:00:00Z",
      propertyTimezone: "America/Los_Angeles",
      propertyId: "p1",
    });
    const r = await reconcileGa4MonthlySeries("tenant-a", NOW);
    expect(r.status).toBe("pass");
    if (r.status === "pass") expect(r.reconciledThrough).toBe("2026-06-01");
    const written = _writeMock.mock.calls[0]![0] as { status: string; perMonth: unknown[] };
    expect(written.status).toBe("pass");
    // The current (partial) month is NOT reconciled - only full months are checked.
    expect(written.perMonth).toHaveLength(1);
  });

  it("daily rollup off by more than tolerance -> mismatch (alert, never a claim)", async () => {
    _monthlyMock.mockResolvedValue({
      ok: true,
      propertyTimezone: "America/Los_Angeles",
      rows: [{ month: "2026-06-01", sessions: 12540 }],
    });
    _rollupMock.mockResolvedValue({
      months: [{ month: "2026-06-01", sessions: 15000, engagedSessions: 9000, partial: false }],
      latestSyncAt: "2026-07-10T02:00:00Z",
      propertyTimezone: "America/Los_Angeles",
      propertyId: "p1",
    });
    const r = await reconcileGa4MonthlySeries("tenant-a", NOW);
    expect(r.status).toBe("mismatch");
    const written = _writeMock.mock.calls[0]![0] as { status: string };
    expect(written.status).toBe("mismatch");
  });

  it("exact match passes", async () => {
    _monthlyMock.mockResolvedValue({ ok: true, propertyTimezone: "America/Los_Angeles", rows: [{ month: "2026-06-01", sessions: 999 }] });
    _rollupMock.mockResolvedValue({
      months: [{ month: "2026-06-01", sessions: 999, engagedSessions: 500, partial: false }],
      latestSyncAt: "2026-07-10T02:00:00Z",
      propertyTimezone: "America/Los_Angeles",
      propertyId: "p1",
    });
    const r = await reconcileGa4MonthlySeries("tenant-a", NOW);
    expect(r.status).toBe("pass");
  });

  it("no stored full months to reconcile -> error (card keeps holding back)", async () => {
    _monthlyMock.mockResolvedValue({ ok: true, propertyTimezone: "America/Los_Angeles", rows: [{ month: "2026-07-01", sessions: 10 }] });
    _rollupMock.mockResolvedValue({
      months: [{ month: "2026-07-01", sessions: 10, engagedSessions: 5, partial: true }],
      latestSyncAt: "2026-07-10T02:00:00Z",
      propertyTimezone: "America/Los_Angeles",
      propertyId: "p1",
    });
    const r = await reconcileGa4MonthlySeries("tenant-a", NOW);
    expect(r.status).toBe("error");
  });

  it("VACUOUS zero-vs-zero comparison is NOT a pass (empty data -> error, card holds back)", async () => {
    // The direct report and the stored rollup both report a completed month of ZERO
    // sessions. An empty-vs-empty comparison proves nothing - it must never write pass.
    _monthlyMock.mockResolvedValue({ ok: true, propertyTimezone: "America/Los_Angeles", rows: [{ month: "2026-06-01", sessions: 0 }] });
    _rollupMock.mockResolvedValue({
      months: [{ month: "2026-06-01", sessions: 0, engagedSessions: 0, partial: false }],
      latestSyncAt: "2026-07-10T02:00:00Z",
      propertyTimezone: "America/Los_Angeles",
      propertyId: "p1",
    });
    const r = await reconcileGa4MonthlySeries("tenant-a", NOW);
    expect(r.status).toBe("error");
    if (r.status === "error") expect(r.reason).toBe("no_data");
    const written = _writeMock.mock.calls[0]![0] as { status: string };
    expect(written.status).not.toBe("pass");
  });

  it("a stored full month MISSING from the direct report -> mismatch (never skipped, not vacuous)", async () => {
    // Real stored traffic for June, but the direct report has no June row at all.
    // We cannot vouch for it -> mismatch, and because the stored month carries real
    // data this is NOT the vacuous no_data path.
    _monthlyMock.mockResolvedValue({ ok: true, propertyTimezone: "America/Los_Angeles", rows: [] });
    _rollupMock.mockResolvedValue({
      months: [{ month: "2026-06-01", sessions: 5000, engagedSessions: 3000, partial: false }],
      latestSyncAt: "2026-07-10T02:00:00Z",
      propertyTimezone: "America/Los_Angeles",
      propertyId: "p1",
    });
    const r = await reconcileGa4MonthlySeries("tenant-a", NOW);
    expect(r.status).toBe("mismatch");
  });

  it("a completed month GA4 reports but the rollup is MISSING (interior gap) -> mismatch", async () => {
    // GA4 directly reports April, May, June. The rollup has April + June but a GAP at
    // May. A month GA4 knows about is missing from the rollup within its covered range,
    // so the rollup cannot pass silently.
    _monthlyMock.mockResolvedValue({
      ok: true,
      propertyTimezone: "America/Los_Angeles",
      rows: [
        { month: "2026-04-01", sessions: 100 },
        { month: "2026-05-01", sessions: 5000 },
        { month: "2026-06-01", sessions: 200 },
      ],
    });
    _rollupMock.mockResolvedValue({
      months: [
        { month: "2026-04-01", sessions: 100, engagedSessions: 60, partial: false },
        { month: "2026-06-01", sessions: 200, engagedSessions: 120, partial: false },
      ],
      latestSyncAt: "2026-07-10T02:00:00Z",
      propertyTimezone: "America/Los_Angeles",
      propertyId: "p1",
    });
    const r = await reconcileGa4MonthlySeries("tenant-a", NOW);
    expect(r.status).toBe("mismatch");
    const written = _writeMock.mock.calls[0]![0] as { status: string; perMonth: Array<{ month: string; withinTolerance: boolean }> };
    expect(written.status).toBe("mismatch");
    const may = written.perMonth.find((p) => p.month === "2026-05-01");
    expect(may?.withinTolerance).toBe(false);
  });

  it("a LEADING month GA4 reports that the rollup has not synced yet is honest coverage, not a gap -> pass", async () => {
    // GA4 reports May + June, the rollup only has June (the tenant connected recently).
    // May is BEFORE the rollup's covered range, so it is legitimately not synced yet and
    // must NOT be treated as a gap - June reconciles cleanly and the card may pass.
    _monthlyMock.mockResolvedValue({
      ok: true,
      propertyTimezone: "America/Los_Angeles",
      rows: [
        { month: "2026-05-01", sessions: 9000 },
        { month: "2026-06-01", sessions: 200 },
      ],
    });
    _rollupMock.mockResolvedValue({
      months: [{ month: "2026-06-01", sessions: 200, engagedSessions: 120, partial: false }],
      latestSyncAt: "2026-07-10T02:00:00Z",
      propertyTimezone: "America/Los_Angeles",
      propertyId: "p1",
    });
    const r = await reconcileGa4MonthlySeries("tenant-a", NOW);
    expect(r.status).toBe("pass");
  });
});
