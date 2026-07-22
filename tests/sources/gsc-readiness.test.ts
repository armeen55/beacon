/**
 * MAX_SEO_AEO Phase 4 (2026-06-16) — GSC readiness loader + presenter tests.
 *
 * READ-ONLY surfacing: NO live Google call. The loader composes a verdict from
 * the persisted token state (connector-store) + the synced rows in
 * `gsc_daily_rows` (Supabase). The presenter turns that into plain-English,
 * white-label, honest copy with NO invented numbers.
 *
 * Pins:
 *   • Verdict ladder: not_connected → needs_reconnect → connected_no_data →
 *     ready (each branch).
 *   • Tenant-scoped read shape: every gsc_daily_rows query carries
 *     .eq("tenant_id", tid) — verified by recording the filters.
 *   • Coverage from gsc_daily_rows: property = most-recent-data property,
 *     from/to span + row count folded correctly; single-property uses the
 *     exact HEAD count.
 *   • Soft-fail: no Supabase env → connected_no_data (never throws);
 *     undefined-table (42P01) → connected_no_data; token-store throw →
 *     not_connected.
 *   • Presenter copy per verdict (quoted), coverage formatting ("Jun 14"),
 *     freshness phrasing, and NO invented numbers (no data → no figures).
 *
 * All tests mock Supabase admin + connector-store entirely (no network, no DB).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ─────────────────────────────────────────────────────────────────────
// Mocks — connector-store.getConnectorInfo + Supabase admin
// ─────────────────────────────────────────────────────────────────────

import type { ConnectorInfo } from "@/lib/connector-store";

let _info: ConnectorInfo = {
  status: "disconnected",
  connected_at: null,
  expires_at: null,
  last_synced_at: null,
};
let _infoThrows = false;

vi.mock("@/lib/connector-store", () => ({
  getConnectorInfo: vi.fn(async () => {
    if (_infoThrows) throw new Error("token store unreadable");
    return _info;
  }),
}));

type DailyRow = { property: string; date: string };

let _rows: DailyRow[] = [];
let _adminThrows = false;
/** Force a Postgres error on the gsc_daily_rows reads (e.g. undefined_table). */
let _forceError: { code?: string; message: string } | null = null;
/** Force an error ONLY on the (property,date) span read (the .order() chain),
 *  leaving the HEAD count successful — models a statement-timeout on a large
 *  table where rows demonstrably exist. */
let _forceSpanError: { code?: string; message: string } | null = null;
/** Records the tenant_id every query was scoped to (proves tenant-scoping). */
let _scopedTenantIds: string[] = [];

function buildQueryBuilder() {
  let headOnly = false;
  const builder = {
    select(_cols: string, opts?: { count?: string; head?: boolean }) {
      headOnly = opts?.head === true;
      return builder;
    },
    eq(col: string, val: string) {
      if (col === "tenant_id") _scopedTenantIds.push(val);
      return builder;
    },
    // For the HEAD count chain, the builder itself is awaited after .eq().
    then(
      resolve: (v: {
        data: DailyRow[] | null;
        error: { code?: string; message: string } | null;
        count: number | null;
      }) => void,
    ) {
      if (_forceError) {
        resolve({ data: null, error: _forceError, count: null });
        return;
      }
      if (headOnly) {
        resolve({ data: null, error: null, count: _rows.length });
        return;
      }
      // A bare select(...).eq(...) await without .order() — not used by the
      // loader, but resolve defensively.
      resolve({ data: _rows, error: null, count: _rows.length });
    },
    order(_col: string, _opts: { ascending: boolean }) {
      // gsc_daily_rows is read date-desc. Sort our fixture to match so the
      // loader's date-desc fold assumption holds.
      const sorted = [..._rows].sort((a, b) => (a.date < b.date ? 1 : -1));
      return Promise.resolve({ data: sorted, error: _forceSpanError ?? _forceError, count: null });
    },
  };
  return builder;
}

const mockAdmin = { from: (_t: string) => buildQueryBuilder() };

vi.mock("@/lib/persistence/supabase", () => ({
  getSupabaseAdmin: () => {
    if (_adminThrows) throw new Error("Supabase env not configured");
    return mockAdmin;
  },
}));

import {
  loadGscReadiness,
  describeGscReadiness,
  type GscReadiness,
} from "@/lib/connectors/gsc/readiness";

function connectedInfo(extra: Partial<ConnectorInfo> = {}): ConnectorInfo {
  return {
    status: "connected",
    connected_at: "2026-01-12T10:00:00.000Z",
    expires_at: Date.now() + 3600 * 1000,
    last_synced_at: "2026-06-14T10:00:00.000Z",
    auth_failed_at: null,
    ...extra,
  };
}

beforeEach(() => {
  _info = {
    status: "disconnected",
    connected_at: null,
    expires_at: null,
    last_synced_at: null,
  };
  _infoThrows = false;
  _rows = [];
  _adminThrows = false;
  _forceError = null;
  _forceSpanError = null;
  _scopedTenantIds = [];
});

// ─────────────────────────────────────────────────────────────────────
// Loader — verdict ladder
// ─────────────────────────────────────────────────────────────────────

describe("loadGscReadiness — verdict ladder", () => {
  it("no token → not_connected (no property, no coverage)", async () => {
    _info = {
      status: "disconnected",
      connected_at: null,
      expires_at: null,
      last_synced_at: null,
    };
    const r = await loadGscReadiness("tenant-a");
    expect(r.verdict).toBe("not_connected");
    expect(r.property).toBeNull();
    expect(r.coverage).toBeNull();
    expect(r.lastDataDate).toBeNull();
    expect(r.freshnessDays).toBeNull();
  });

  it("connected but auth_failed_at set → needs_reconnect (highest priority over data)", async () => {
    _info = connectedInfo({ auth_failed_at: "2026-06-15T10:00:00.000Z" });
    // Even WITH synced rows, a dead grant outranks "ready".
    _rows = [
      { property: "sc-domain:iranopedia.com", date: "2026-06-14" },
      { property: "sc-domain:iranopedia.com", date: "2026-01-12" },
    ];
    const r = await loadGscReadiness("tenant-a");
    expect(r.verdict).toBe("needs_reconnect");
    // Cached property/coverage still surface so the card can show what was last seen.
    expect(r.property).toBe("sc-domain:iranopedia.com");
    expect(r.coverage).not.toBeNull();
  });

  it("connected + healthy + zero rows → connected_no_data (no invented numbers)", async () => {
    _info = connectedInfo();
    _rows = [];
    const r = await loadGscReadiness("tenant-a");
    expect(r.verdict).toBe("connected_no_data");
    expect(r.property).toBeNull();
    expect(r.coverage).toBeNull();
    expect(r.lastDataDate).toBeNull();
    expect(r.freshnessDays).toBeNull();
  });

  it("connected + healthy + has rows → ready with resolved property + coverage", async () => {
    _info = connectedInfo();
    _rows = [
      { property: "sc-domain:iranopedia.com", date: "2026-06-14" },
      { property: "sc-domain:iranopedia.com", date: "2026-03-01" },
      { property: "sc-domain:iranopedia.com", date: "2026-01-12" },
    ];
    const now = new Date("2026-06-16T12:00:00Z");
    const r = await loadGscReadiness("tenant-a", now);
    expect(r.verdict).toBe("ready");
    expect(r.property).toBe("sc-domain:iranopedia.com");
    expect(r.coverage).toEqual({
      fromDate: "2026-01-12",
      toDate: "2026-06-14",
      rowCount: 3,
    });
    expect(r.lastDataDate).toBe("2026-06-14");
    expect(r.freshnessDays).toBe(2); // Jun 14 → Jun 16
  });
});

// ─────────────────────────────────────────────────────────────────────
// Loader — coverage derivation (multi-property + tenant-scoping)
// ─────────────────────────────────────────────────────────────────────

describe("loadGscReadiness — coverage derivation", () => {
  it("multiple properties → reports the one with the MOST RECENT data + its own row count", async () => {
    _info = connectedInfo();
    _rows = [
      // Older URL-prefix property (3 rows, newest 2026-04-01).
      { property: "https://www.iranopedia.com/", date: "2026-04-01" },
      { property: "https://www.iranopedia.com/", date: "2026-02-01" },
      { property: "https://www.iranopedia.com/", date: "2026-01-12" },
      // Newer domain property (2 rows, newest 2026-06-14) — should WIN.
      { property: "sc-domain:iranopedia.com", date: "2026-06-14" },
      { property: "sc-domain:iranopedia.com", date: "2026-06-10" },
    ];
    const r = await loadGscReadiness("tenant-a", new Date("2026-06-16T12:00:00Z"));
    expect(r.verdict).toBe("ready");
    expect(r.property).toBe("sc-domain:iranopedia.com");
    expect(r.coverage).toEqual({
      fromDate: "2026-06-10",
      toDate: "2026-06-14",
      rowCount: 2, // picked property's own count, NOT the 5-row total
    });
  });

  it("reads are tenant-scoped — every gsc_daily_rows query carries .eq('tenant_id', tid)", async () => {
    _info = connectedInfo();
    _rows = [{ property: "sc-domain:x.com", date: "2026-06-14" }];
    await loadGscReadiness("tenant-xyz");
    // Two reads (HEAD count + span) → both scoped to the same tenant.
    expect(_scopedTenantIds.length).toBeGreaterThanOrEqual(2);
    expect(_scopedTenantIds.every((t) => t === "tenant-xyz")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Loader — soft-fail
// ─────────────────────────────────────────────────────────────────────

describe("loadGscReadiness — soft-fail (never throws)", () => {
  it("no Supabase env (admin throws) + connected → connected_no_data", async () => {
    _info = connectedInfo();
    _adminThrows = true;
    const r = await loadGscReadiness("tenant-a");
    expect(r.verdict).toBe("connected_no_data");
    expect(r.coverage).toBeNull();
  });

  it("undefined table (42P01) + connected → connected_no_data", async () => {
    _info = connectedInfo();
    _forceError = { code: "42P01", message: "undefined_table" };
    const r = await loadGscReadiness("tenant-a");
    expect(r.verdict).toBe("connected_no_data");
  });

  it("token store throws → not_connected (can't prove a connection)", async () => {
    _infoThrows = true;
    const r = await loadGscReadiness("tenant-a");
    expect(r.verdict).toBe("not_connected");
    expect(r.coverage).toBeNull();
  });


  it("count proves rows exist but the span read times out → ready, NOT 'no data yet'", async () => {
    // The bug this guards: a large gsc_daily_rows table can statement-timeout on
    // the (property,date) span read; the HEAD count already proved rows exist, so
    // we must report ready (data present, span unknown), never connected_no_data.
    _info = connectedInfo();
    _rows = [
      { property: "sc-domain:iranopedia.com", date: "2026-06-14" },
      { property: "sc-domain:iranopedia.com", date: "2026-06-10" },
    ];
    _forceSpanError = { code: "57014", message: "canceling statement due to statement timeout" };
    const r = await loadGscReadiness("tenant-a");
    expect(r.verdict).toBe("ready");
    // We don't fabricate a date span we couldn't read.
    expect(r.coverage).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────
// Presenter — copy per verdict + no invented numbers
// ─────────────────────────────────────────────────────────────────────

function readiness(over: Partial<GscReadiness>): GscReadiness {
  return {
    verdict: "not_connected",
    property: null,
    coverage: null,
    lastDataDate: null,
    freshnessDays: null,
    lastSyncedAt: null,
    ...over,
  };
}

describe("describeGscReadiness — presenter copy", () => {
  const NOW = new Date("2026-06-16T12:00:00Z");

  it("ready → headline + 'Search data … · N rows · <data-age> · checked <sync-age>'", () => {
    const d = describeGscReadiness(
      readiness({
        verdict: "ready",
        property: "sc-domain:iranopedia.com",
        coverage: { fromDate: "2026-01-12", toDate: "2026-06-14", rowCount: 12431 },
        lastDataDate: "2026-06-14",
        freshnessDays: 2, // within Google's ~3-day lag → NORMAL, not stale
        lastSyncedAt: "2026-06-16T11:55:00Z", // 5 min before NOW
      }),
      NOW,
    );
    expect(d.headline).toBe("Using property sc-domain:iranopedia.com");
    // Data-age (Google's lag) and sync-age (when WE pulled) are now distinct:
    // 2 days behind is the normal publish lag, and the refresh was 5 min ago.
    expect(d.detail).toBe(
      "Search data Jan 12 to Jun 14 · 12,431 rows · Google's latest (it publishes ~3 days behind) · checked 5 min ago",
    );
    expect(d.tone).toBe("ready");
  });


  it("ready → GENUINELY stale data (>3 days behind) is flagged, sync recency stays separate", () => {
    const d = describeGscReadiness(
      readiness({
        verdict: "ready",
        property: "sc-domain:x.com",
        coverage: { fromDate: "2026-06-01", toDate: "2026-06-04", rowCount: 50 },
        lastDataDate: "2026-06-04",
        freshnessDays: 12, // beyond the lag → genuinely behind
        lastSyncedAt: "2026-06-16T08:00:00Z", // 4 hours before NOW
      }),
      NOW,
    );
    expect(d.detail).toContain("data 12 days behind");
    expect(d.detail).toContain("checked 4 hours ago");
    // Old bug: data-age was shown as "refreshed N days ago" — never again.
    expect(d.detail).not.toContain("refreshed");
  });

  it("connected_no_data → backfill prompt, no numbers invented", () => {
    const d = describeGscReadiness(readiness({ verdict: "connected_no_data" }));
    expect(d.headline).toBe("Connected, but no Search Console data yet");
    expect(d.detail).toBe(
      "Click “Pull my Search Console data” to backfill your search history.",
    );
    expect(d.tone).toBe("attention");
    // No invented figures anywhere.
    expect(/\d/.test(d.headline + d.detail)).toBe(false);
  });



});
