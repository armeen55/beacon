/**
 * 2026-05-19 — Slice 9.A2γ — persist-url-traffic.ts unit tests.
 *
 * Pins:
 *   • computeRefreshDateRange — pure date-range policy across:
 *     - no edits / no parseable live_at
 *     - all edits within default 90-day window
 *     - one edit older than 90d → expand back to it
 *     - edit older than 180-day cap → clamped to 180d max
 *     - mixed valid + invalid live_at strings
 *     - endDate is today (UTC)
 *   • persistGa4UrlTraffic happy path:
 *     - calls runGa4UrlTrafficReport with explicit
 *       tenantId / propertyId / startDate / endDate
 *     - upserts every returned row with tenant_id + raw + last_synced_at
 *     - uses onConflict "tenant_id,url,date"
 *     - returns rows_fetched + rows_upserted on success
 *   • persistGa4UrlTraffic fail-soft paths:
 *     - missing tenantId / propertyId / dates → invalid_args
 *     - runGa4UrlTrafficReport non-ok → passthrough reason + status
 *     - getSupabaseAdmin throws → admin_unavailable
 *     - upsert returns error → persist_failed (NEVER throws)
 *   • Empty rows path returns ok: true with zero counts (NO upsert call).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─────────────────────────────────────────────────────────────────────
// Mocks (hoisted)
// ─────────────────────────────────────────────────────────────────────

const _runReportMock = vi.fn();
vi.mock("@/lib/connectors/ga4/data-api", () => ({
  runGa4UrlTrafficReport: (...args: unknown[]) => _runReportMock(...args),
}));

const _upsertMock = vi.fn();
let _supabaseAdminThrows = false;
let _adminThrowMessage = "admin unavailable";
vi.mock("@/lib/persistence/supabase", () => ({
  getSupabaseAdmin: () => {
    if (_supabaseAdminThrows) {
      throw new Error(_adminThrowMessage);
    }
    return {
      from: (_table: string) => ({
        upsert: (rows: unknown, opts: unknown) => _upsertMock(rows, opts),
      }),
    };
  },
}));

const _logWarn = vi.fn();
const _logInfo = vi.fn();
vi.mock("@/lib/logger", () => ({
  log: {
    warn: (...a: unknown[]) => _logWarn(...a),
    info: (...a: unknown[]) => _logInfo(...a),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

beforeEach(() => {
  _runReportMock.mockReset();
  _upsertMock.mockReset();
  _supabaseAdminThrows = false;
  _logWarn.mockReset();
  _logInfo.mockReset();
});

// Re-import after mocks.
import {
  computeRefreshDateRange,
  persistGa4UrlTraffic,
  __testing,
} from "@/lib/connectors/ga4/persist-url-traffic";

// ─────────────────────────────────────────────────────────────────────
// computeRefreshDateRange — pure
// ─────────────────────────────────────────────────────────────────────

describe("computeRefreshDateRange — pure policy", () => {
  const NOW = new Date("2026-05-19T12:00:00Z");
  // 2026-05-19 UTC

  it("defaults to last 90 days when no edits supplied", () => {
    const r = computeRefreshDateRange([], NOW);
    expect(r.endDate).toBe("2026-05-19");
    expect(r.startDate).toBe("2026-02-18"); // 2026-05-19 − 90d
  });

  it("defaults to last 90 days when all edits have null live_at", () => {
    const r = computeRefreshDateRange(
      [{ live_at: null }, { live_at: "" }, {}],
      NOW,
    );
    expect(r.startDate).toBe("2026-02-18");
  });

  it("ignores malformed live_at strings (defaults to 90-day window)", () => {
    const r = computeRefreshDateRange(
      [{ live_at: "not-a-date" }, { live_at: "garbage" }],
      NOW,
    );
    expect(r.startDate).toBe("2026-02-18");
  });

  it("keeps 90-day default when all edits are within the default window", () => {
    const r = computeRefreshDateRange(
      [
        { live_at: "2026-04-01T00:00:00Z" },
        { live_at: "2026-05-10T12:00:00Z" },
      ],
      NOW,
    );
    expect(r.startDate).toBe("2026-02-18");
  });

  it("expands startDate back to min(live_at) when an edit is older than 90 days", () => {
    const r = computeRefreshDateRange(
      [
        { live_at: "2026-01-15T00:00:00Z" }, // older than 90d
        { live_at: "2026-04-01T00:00:00Z" },
      ],
      NOW,
    );
    expect(r.startDate).toBe("2026-01-15");
  });

  it("clamps to 180-day cap when min(live_at) is older than the cap", () => {
    const r = computeRefreshDateRange(
      [{ live_at: "2025-01-01T00:00:00Z" }], // > 180 days ago
      NOW,
    );
    // 2026-05-19 − 180d = 2025-11-20
    expect(r.startDate).toBe("2025-11-20");
  });

  it("returns YYYY-MM-DD strings only (no time component)", () => {
    const r = computeRefreshDateRange([], NOW);
    expect(r.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(r.endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("uses today UTC as endDate (truncates time)", () => {
    const lateNow = new Date("2026-05-19T23:59:59.999Z");
    const r = computeRefreshDateRange([], lateNow);
    expect(r.endDate).toBe("2026-05-19");
  });

  it("exposes locked defaults via __testing for visibility", () => {
    expect(__testing.DEFAULT_LOOKBACK_DAYS).toBe(90);
    expect(__testing.MAX_LOOKBACK_DAYS).toBe(180);
    expect(__testing.TABLE).toBe("ga4_url_traffic");
  });
});

// ─────────────────────────────────────────────────────────────────────
// persistGa4UrlTraffic — invalid args
// ─────────────────────────────────────────────────────────────────────

const HAPPY_ARGS = {
  tenantId: "tenant-test",
  propertyId: "12345678",
  startDate: "2026-02-18",
  endDate: "2026-05-19",
};

describe("persistGa4UrlTraffic — invalid args (no API call, no upsert)", () => {
  it("rejects missing tenantId with invalid_args", async () => {
    const r = await persistGa4UrlTraffic({ ...HAPPY_ARGS, tenantId: "" });
    expect(r).toEqual(
      expect.objectContaining({ ok: false, reason: "invalid_args" }),
    );
    expect(_runReportMock).not.toHaveBeenCalled();
    expect(_upsertMock).not.toHaveBeenCalled();
  });

  it("rejects missing propertyId with invalid_args", async () => {
    const r = await persistGa4UrlTraffic({ ...HAPPY_ARGS, propertyId: "" });
    expect(r).toEqual(
      expect.objectContaining({ ok: false, reason: "invalid_args" }),
    );
    expect(_runReportMock).not.toHaveBeenCalled();
  });

  it("rejects missing startDate with invalid_args", async () => {
    const r = await persistGa4UrlTraffic({ ...HAPPY_ARGS, startDate: "" });
    expect(r).toEqual(
      expect.objectContaining({ ok: false, reason: "invalid_args" }),
    );
    expect(_runReportMock).not.toHaveBeenCalled();
  });

  it("rejects missing endDate with invalid_args", async () => {
    const r = await persistGa4UrlTraffic({ ...HAPPY_ARGS, endDate: "" });
    expect(r).toEqual(
      expect.objectContaining({ ok: false, reason: "invalid_args" }),
    );
    expect(_runReportMock).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────
// persistGa4UrlTraffic — Data API fail-soft passthrough
// ─────────────────────────────────────────────────────────────────────

describe("persistGa4UrlTraffic — Data API non-ok passthrough", () => {
  it("passes through reason=no_token", async () => {
    _runReportMock.mockResolvedValue({ ok: false, reason: "no_token" });
    const r = await persistGa4UrlTraffic(HAPPY_ARGS);
    expect(r).toEqual({ ok: false, reason: "no_token" });
    expect(_upsertMock).not.toHaveBeenCalled();
  });

  it("passes through reason=disconnected", async () => {
    _runReportMock.mockResolvedValue({ ok: false, reason: "disconnected" });
    const r = await persistGa4UrlTraffic(HAPPY_ARGS);
    expect(r).toEqual({ ok: false, reason: "disconnected" });
  });

  it("passes through reason=token_expired with message", async () => {
    _runReportMock.mockResolvedValue({
      ok: false,
      reason: "token_expired",
      message: ">7d past expiry",
    });
    const r = await persistGa4UrlTraffic(HAPPY_ARGS);
    expect(r).toMatchObject({
      ok: false,
      reason: "token_expired",
      message: ">7d past expiry",
    });
  });

  it("passes through reason=api_error with status + message", async () => {
    _runReportMock.mockResolvedValue({
      ok: false,
      reason: "api_error",
      status: 503,
      message: "non-2xx response",
    });
    const r = await persistGa4UrlTraffic(HAPPY_ARGS);
    expect(r).toMatchObject({
      ok: false,
      reason: "api_error",
      status: 503,
      message: "non-2xx response",
    });
    expect(_upsertMock).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────
// persistGa4UrlTraffic — happy path + upsert shape
// ─────────────────────────────────────────────────────────────────────

describe("persistGa4UrlTraffic — happy path", () => {
  it("returns ok:true with zero counts when Data API returns empty rows (NO upsert call)", async () => {
    _runReportMock.mockResolvedValue({ ok: true, rows: [] });
    const r = await persistGa4UrlTraffic(HAPPY_ARGS);
    expect(r).toEqual({
      ok: true,
      rows_fetched: 0,
      rows_upserted: 0,
      startDate: HAPPY_ARGS.startDate,
      endDate: HAPPY_ARGS.endDate,
    });
    expect(_upsertMock).not.toHaveBeenCalled();
  });

  it("upserts every row with tenant_id and onConflict on (tenant_id, url, date)", async () => {
    const rows = [
      {
        url: "/a",
        date: "2026-05-18",
        sessions: 12,
        engaged_sessions: 8,
        conversions: 1,
      },
      {
        url: "/b",
        date: "2026-05-19",
        sessions: 3,
        engaged_sessions: 2,
        conversions: 0,
      },
    ];
    _runReportMock.mockResolvedValue({ ok: true, rows });
    _upsertMock.mockResolvedValue({ error: null });

    const r = await persistGa4UrlTraffic(HAPPY_ARGS);

    expect(r).toMatchObject({
      ok: true,
      rows_fetched: 2,
      rows_upserted: 2,
      startDate: HAPPY_ARGS.startDate,
      endDate: HAPPY_ARGS.endDate,
    });

    // Inspect upsert call shape.
    expect(_upsertMock).toHaveBeenCalledTimes(1);
    const [upsertedRows, opts] = _upsertMock.mock.calls[0]!;
    expect(opts).toEqual({ onConflict: "tenant_id,url,date" });
    const arr = upsertedRows as Array<Record<string, unknown>>;
    expect(arr).toHaveLength(2);
    for (let i = 0; i < arr.length; i++) {
      expect(arr[i]).toMatchObject({
        tenant_id: HAPPY_ARGS.tenantId,
        url: rows[i]!.url,
        date: rows[i]!.date,
        sessions: rows[i]!.sessions,
        engaged_sessions: rows[i]!.engaged_sessions,
        conversions: rows[i]!.conversions,
        raw: rows[i],
      });
      expect(typeof arr[i]!.last_synced_at).toBe("string");
      expect(typeof arr[i]!.updated_at).toBe("string");
    }
  });

  it("calls runGa4UrlTrafficReport with explicit args (tenant/property/dates)", async () => {
    _runReportMock.mockResolvedValue({ ok: true, rows: [] });
    await persistGa4UrlTraffic(HAPPY_ARGS);
    expect(_runReportMock).toHaveBeenCalledWith({
      tenantId: HAPPY_ARGS.tenantId,
      propertyId: HAPPY_ARGS.propertyId,
      startDate: HAPPY_ARGS.startDate,
      endDate: HAPPY_ARGS.endDate,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────
// persistGa4UrlTraffic — admin / upsert fail-soft
// ─────────────────────────────────────────────────────────────────────

describe("persistGa4UrlTraffic — Supabase fail-soft", () => {
  it("returns admin_unavailable when getSupabaseAdmin throws", async () => {
    _runReportMock.mockResolvedValue({
      ok: true,
      rows: [{ url: "/x", date: "2026-05-19", sessions: 1, engaged_sessions: 1, conversions: 0 }],
    });
    _supabaseAdminThrows = true;
    const r = await persistGa4UrlTraffic(HAPPY_ARGS);
    expect(r).toMatchObject({ ok: false, reason: "admin_unavailable" });
    expect(_logWarn).toHaveBeenCalledTimes(1);
    expect(_upsertMock).not.toHaveBeenCalled();
  });

  it("returns persist_failed when upsert returns an error", async () => {
    _runReportMock.mockResolvedValue({
      ok: true,
      rows: [{ url: "/x", date: "2026-05-19", sessions: 1, engaged_sessions: 1, conversions: 0 }],
    });
    _upsertMock.mockResolvedValue({
      error: { message: "boom", code: "23505" },
    });
    const r = await persistGa4UrlTraffic(HAPPY_ARGS);
    expect(r).toMatchObject({ ok: false, reason: "persist_failed", message: "boom" });
    expect(_logWarn).toHaveBeenCalledTimes(1);
  });

  it("NEVER throws on documented fail-soft paths", async () => {
    _runReportMock.mockResolvedValue({
      ok: true,
      rows: [{ url: "/x", date: "2026-05-19", sessions: 1, engaged_sessions: 1, conversions: 0 }],
    });
    _upsertMock.mockResolvedValue({ error: { message: "boom" } });
    await expect(persistGa4UrlTraffic(HAPPY_ARGS)).resolves.toBeDefined();
  });
});
