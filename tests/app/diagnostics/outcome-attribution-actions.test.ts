/**
 * 2026-05-19 — Slice 9.A2γ — refreshTenantGa4Traffic server action
 * unit tests.
 *
 * Pins:
 *   • Operator gate: isOperatorModeServer() === false →
 *     {ok:false, reason:"not_operator"}; NO downstream calls.
 *   • No GA4 token → {ok:false, reason:"no_token"}.
 *   • Token without ga4_property_id → {ok:false, reason:"no_property"}.
 *   • Happy path: reads edits, computes date range, calls persist,
 *     revalidates page on success.
 *   • Persist fail-soft passthrough: action returns the persist
 *     discriminator unchanged.
 *   • Does NOT revalidatePath on failure paths (not_operator /
 *     no_token / no_property / persist_failed).
 *   • Tenant scope: tenantId from currentTenantId() flows through
 *     to getGoogleConnectorToken AND persistGa4UrlTraffic AND
 *     repo.forTenant.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─────────────────────────────────────────────────────────────────────
// Mocks (hoisted)
// ─────────────────────────────────────────────────────────────────────

let _isOperator = true;
vi.mock("@/lib/operator-mode", () => ({
  isOperatorModeServer: () => _isOperator,
}));

const _currentTenantIdMock = vi.fn(async () => "tenant-test");
vi.mock("@/lib/tenant-context", () => ({
  currentTenantId: () => _currentTenantIdMock(),
}));

const _getTokenMock = vi.fn();
vi.mock("@/lib/connector-store", () => ({
  getGoogleConnectorToken: (...a: unknown[]) => _getTokenMock(...a),
}));

type EditFixture = { live_at?: string | null; implementation_status?: string };
const _getRecommendedEditsMock = vi.fn(
  async (_tenantId: string): Promise<EditFixture[]> => [],
);
vi.mock("@/lib/persistence/repositories", () => ({
  getRepository: () => ({
    forTenant: (tenantId: string) => ({
      getRecommendedEdits: () => _getRecommendedEditsMock(tenantId),
    }),
  }),
}));

const _persistMock = vi.fn();
vi.mock("@/lib/connectors/ga4/persist-url-traffic", async () => {
  const real = await vi.importActual<
    typeof import("@/lib/connectors/ga4/persist-url-traffic")
  >("@/lib/connectors/ga4/persist-url-traffic");
  return {
    // Use the REAL computeRefreshDateRange so the action's date math
    // is exercised end-to-end.
    computeRefreshDateRange: real.computeRefreshDateRange,
    persistGa4UrlTraffic: (...a: unknown[]) => _persistMock(...a),
  };
});

const _revalidatePathMock = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (...a: unknown[]) => _revalidatePathMock(...a),
}));

vi.mock("@/lib/logger", () => ({
  log: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

beforeEach(() => {
  _isOperator = true;
  _currentTenantIdMock.mockReset();
  _currentTenantIdMock.mockResolvedValue("tenant-test");
  _getTokenMock.mockReset();
  _getRecommendedEditsMock.mockReset();
  _getRecommendedEditsMock.mockResolvedValue([]);
  _persistMock.mockReset();
  _revalidatePathMock.mockReset();
});

// Re-import after mocks.
import { refreshTenantGa4Traffic } from "@/app/(shell)/diagnostics/outcome-attribution/actions";

// ─────────────────────────────────────────────────────────────────────
// Operator gate
// ─────────────────────────────────────────────────────────────────────

describe("refreshTenantGa4Traffic — operator gate", () => {
  it("returns { ok:false, reason:'not_operator' } when not in operator mode", async () => {
    _isOperator = false;
    const r = await refreshTenantGa4Traffic();
    expect(r).toEqual({ ok: false, reason: "not_operator" });
  });

  it("does NOT read tenant / token / edits when blocked by gate", async () => {
    _isOperator = false;
    await refreshTenantGa4Traffic();
    expect(_currentTenantIdMock).not.toHaveBeenCalled();
    expect(_getTokenMock).not.toHaveBeenCalled();
    expect(_getRecommendedEditsMock).not.toHaveBeenCalled();
    expect(_persistMock).not.toHaveBeenCalled();
  });

  it("does NOT revalidatePath when blocked by gate", async () => {
    _isOperator = false;
    await refreshTenantGa4Traffic();
    expect(_revalidatePathMock).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────
// Connector preconditions
// ─────────────────────────────────────────────────────────────────────

describe("refreshTenantGa4Traffic — connector preconditions", () => {
  it("returns no_token when no GA4 connector token exists", async () => {
    _getTokenMock.mockResolvedValue(null);
    const r = await refreshTenantGa4Traffic();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("no_token");
    expect(_persistMock).not.toHaveBeenCalled();
    expect(_revalidatePathMock).not.toHaveBeenCalled();
  });

  it("returns no_property when token exists but ga4_property_id is missing", async () => {
    _getTokenMock.mockResolvedValue({
      provider: "google_ga4",
      access_token: "AT",
      refresh_token: "RT",
      expires_at: Date.now() + 60_000,
      connected_at: "2026-05-19T00:00:00Z",
      scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
      ga4_property_id: undefined,
    });
    const r = await refreshTenantGa4Traffic();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("no_property");
    expect(_persistMock).not.toHaveBeenCalled();
    expect(_revalidatePathMock).not.toHaveBeenCalled();
  });

  it("returns no_property when ga4_property_id is empty string", async () => {
    _getTokenMock.mockResolvedValue({
      provider: "google_ga4",
      access_token: "AT",
      refresh_token: "RT",
      expires_at: Date.now() + 60_000,
      connected_at: "2026-05-19T00:00:00Z",
      scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
      ga4_property_id: "",
    });
    const r = await refreshTenantGa4Traffic();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("no_property");
    expect(_persistMock).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────
// Happy path
// ─────────────────────────────────────────────────────────────────────

describe("refreshTenantGa4Traffic — happy path", () => {
  function setHappyToken(propertyId = "12345678") {
    _getTokenMock.mockResolvedValue({
      provider: "google_ga4",
      access_token: "AT",
      refresh_token: "RT",
      expires_at: Date.now() + 60_000,
      connected_at: "2026-05-19T00:00:00Z",
      scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
      ga4_property_id: propertyId,
    });
  }

  it("calls persist with explicit tenantId + propertyId + computed dates", async () => {
    setHappyToken("999");
    _getRecommendedEditsMock.mockResolvedValue([]);
    _persistMock.mockResolvedValue({
      ok: true,
      rows_fetched: 5,
      rows_upserted: 5,
      startDate: "x",
      endDate: "y",
    });

    await refreshTenantGa4Traffic();

    expect(_persistMock).toHaveBeenCalledTimes(1);
    const call = _persistMock.mock.calls[0]![0] as Record<string, string>;
    expect(call.tenantId).toBe("tenant-test");
    expect(call.propertyId).toBe("999");
    expect(call.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(call.endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("threads tenantId from currentTenantId() into getGoogleConnectorToken AND repo.forTenant", async () => {
    _currentTenantIdMock.mockResolvedValue("tenant-from-context");
    setHappyToken();
    _persistMock.mockResolvedValue({
      ok: true,
      rows_fetched: 0,
      rows_upserted: 0,
      startDate: "a",
      endDate: "b",
    });

    await refreshTenantGa4Traffic();

    expect(_getTokenMock).toHaveBeenCalledWith("ga4", "tenant-from-context");
    expect(_getRecommendedEditsMock).toHaveBeenCalledWith("tenant-from-context");
  });

  it("revalidates /diagnostics/outcome-attribution on success", async () => {
    setHappyToken();
    _persistMock.mockResolvedValue({
      ok: true,
      rows_fetched: 3,
      rows_upserted: 3,
      startDate: "a",
      endDate: "b",
    });

    const r = await refreshTenantGa4Traffic();

    expect(r).toMatchObject({
      ok: true,
      rows_fetched: 3,
      rows_upserted: 3,
    });
    expect(_revalidatePathMock).toHaveBeenCalledWith(
      "/diagnostics/outcome-attribution",
    );
  });

  it("does NOT revalidatePath on persist failure", async () => {
    setHappyToken();
    _persistMock.mockResolvedValue({
      ok: false,
      reason: "persist_failed",
      message: "boom",
    });

    const r = await refreshTenantGa4Traffic();

    expect(r).toMatchObject({
      ok: false,
      reason: "persist_failed",
      message: "boom",
    });
    expect(_revalidatePathMock).not.toHaveBeenCalled();
  });

  it("passes through persist api_error with status", async () => {
    setHappyToken();
    _persistMock.mockResolvedValue({
      ok: false,
      reason: "api_error",
      status: 503,
      message: "non-2xx response",
    });

    const r = await refreshTenantGa4Traffic();

    expect(r).toMatchObject({
      ok: false,
      reason: "api_error",
      status: 503,
      message: "non-2xx response",
    });
    expect(_revalidatePathMock).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────
// Date-range expansion based on edits
// ─────────────────────────────────────────────────────────────────────

describe("refreshTenantGa4Traffic — date range expansion", () => {
  function setHappyToken() {
    _getTokenMock.mockResolvedValue({
      provider: "google_ga4",
      access_token: "AT",
      refresh_token: "RT",
      expires_at: Date.now() + 60_000,
      connected_at: "2026-05-19T00:00:00Z",
      scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
      ga4_property_id: "12345678",
    });
  }

  it("uses 90-day default startDate when no live_at is supplied", async () => {
    setHappyToken();
    _getRecommendedEditsMock.mockResolvedValue([
      { live_at: null, implementation_status: "recommended" },
    ]);
    _persistMock.mockResolvedValue({
      ok: true,
      rows_fetched: 0,
      rows_upserted: 0,
      startDate: "x",
      endDate: "y",
    });

    await refreshTenantGa4Traffic();

    const call = _persistMock.mock.calls[0]![0] as Record<string, string>;
    // Just verify it's a valid date range; the date-range pure helper
    // is exhaustively tested in persist-url-traffic.test.ts.
    expect(call.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(call.endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(call.startDate <= call.endDate).toBe(true);
  });
});
