/**
 * 2026-05-18 — Section 8 J5 — `softDisconnectGsc` +
 * `clearDisconnectedFlagGsc` unit tests.
 *
 * Pins:
 *   • Soft disconnect sets `disconnected_at` on the token payload
 *     WITHOUT calling `deleteConnectorToken`.
 *   • Soft disconnect on a non-existing token row → no-op success
 *     (applied=false).
 *   • Soft disconnect is idempotent — invoking twice yields the
 *     second timestamp on the payload; no destructive write.
 *   • Reconnect (clearDisconnectedFlagGsc) on a token with
 *     `disconnected_at` set issues a patch that clears the field.
 *   • Reconnect on a fresh-connected token → no-op (applied=false).
 *   • Tests mock the connector-store helpers — no Supabase admin
 *     calls.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

import type { GoogleConnectorToken } from "@/lib/connector-store";

// ─────────────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────────────

let _gscToken: GoogleConnectorToken | null = null;
let _updateCalls: Array<{
  provider: string;
  patch: Record<string, unknown>;
  tenantId?: string;
}> = [];
let _deleteCalls: Array<{ provider: string; tenantId?: string }> = [];

vi.mock("@/lib/connector-store", () => ({
  getGoogleConnectorToken: vi.fn(async (kind: "gsc" | "gbp") => {
    if (kind !== "gsc") return null;
    return _gscToken;
  }),
  updateConnectorToken: vi.fn(
    async (
      provider: string,
      patch: Record<string, unknown>,
      tenantId?: string,
    ) => {
      _updateCalls.push({ provider, patch, tenantId });
      // Simulate the real updateConnectorToken's merge behavior so
      // subsequent reads see the updated payload.
      if (_gscToken != null && provider === "google_gsc") {
        _gscToken = { ..._gscToken, ...patch } as GoogleConnectorToken;
        // Match the real serialization: undefined values drop on
        // upsert. Mirror that here so the test surface matches
        // production read-back.
        if (Object.prototype.hasOwnProperty.call(patch, "disconnected_at") && patch.disconnected_at === undefined) {
          delete (_gscToken as { disconnected_at?: string }).disconnected_at;
        }
      }
    },
  ),
  deleteConnectorToken: vi.fn(async (provider: string, tenantId?: string) => {
    _deleteCalls.push({ provider, tenantId });
  }),
}));

// Re-import after mocking.
import {
  softDisconnectGsc,
  clearDisconnectedFlagGsc,
} from "@/lib/connectors/gsc/disconnect-flow";

// ─────────────────────────────────────────────────────────────────────
// Fixtures + reset
// ─────────────────────────────────────────────────────────────────────

const TENANT = "tenant-test";

function makeToken(over: Partial<GoogleConnectorToken> = {}): GoogleConnectorToken {
  return {
    provider: "google_gsc",
    access_token: "access-abc",
    refresh_token: "refresh-xyz",
    expires_at: Date.now() + 60 * 60 * 1000,
    connected_at: new Date().toISOString(),
    scopes: ["https://www.googleapis.com/auth/webmasters.readonly"],
    ...over,
  };
}

beforeEach(() => {
  _gscToken = null;
  _updateCalls = [];
  _deleteCalls = [];
});

// ─────────────────────────────────────────────────────────────────────
// softDisconnectGsc
// ─────────────────────────────────────────────────────────────────────

describe("softDisconnectGsc — happy path", () => {
  it("sets disconnected_at on the token payload via updateConnectorToken", async () => {
    _gscToken = makeToken();
    const result = await softDisconnectGsc({
      tenantId: TENANT,
      now: new Date("2026-05-18T12:00:00Z"),
    });
    expect(result.applied).toBe(true);
    expect(result.disconnected_at).toBe("2026-05-18T12:00:00.000Z");
    expect(_updateCalls).toHaveLength(1);
    expect(_updateCalls[0]).toEqual({
      provider: "google_gsc",
      patch: { disconnected_at: "2026-05-18T12:00:00.000Z" },
      tenantId: TENANT,
    });
  });

  it("does NOT call deleteConnectorToken (no destructive write)", async () => {
    _gscToken = makeToken();
    await softDisconnectGsc({ tenantId: TENANT });
    expect(_deleteCalls).toHaveLength(0);
  });

  it("uses current time when `now` omitted", async () => {
    _gscToken = makeToken();
    const before = Date.now();
    const result = await softDisconnectGsc({ tenantId: TENANT });
    const after = Date.now();
    expect(result.applied).toBe(true);
    const ts = Date.parse(result.disconnected_at as string);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });
});

describe("softDisconnectGsc — no-token cases", () => {
  it("returns applied=false when no GSC token exists for the tenant", async () => {
    _gscToken = null;
    const result = await softDisconnectGsc({ tenantId: TENANT });
    expect(result.applied).toBe(false);
    expect(result.disconnected_at).toBeNull();
    expect(_updateCalls).toHaveLength(0);
  });
});

describe("softDisconnectGsc — idempotent", () => {
  it("invoking twice overwrites disconnected_at with the latest timestamp; no destructive writes", async () => {
    _gscToken = makeToken();
    const first = await softDisconnectGsc({
      tenantId: TENANT,
      now: new Date("2026-05-18T12:00:00Z"),
    });
    const second = await softDisconnectGsc({
      tenantId: TENANT,
      now: new Date("2026-05-18T15:30:00Z"),
    });
    expect(first.disconnected_at).toBe("2026-05-18T12:00:00.000Z");
    expect(second.disconnected_at).toBe("2026-05-18T15:30:00.000Z");
    expect(_updateCalls).toHaveLength(2);
    expect(_deleteCalls).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// clearDisconnectedFlagGsc
// ─────────────────────────────────────────────────────────────────────

describe("clearDisconnectedFlagGsc", () => {
  it("clears disconnected_at when set", async () => {
    _gscToken = makeToken({
      disconnected_at: "2026-05-10T08:00:00.000Z",
    });
    const result = await clearDisconnectedFlagGsc({ tenantId: TENANT });
    expect(result.applied).toBe(true);
    expect(_updateCalls).toHaveLength(1);
    expect(_updateCalls[0]?.patch).toEqual({ disconnected_at: undefined });
  });

  it("is a no-op when disconnected_at is already absent", async () => {
    _gscToken = makeToken();
    const result = await clearDisconnectedFlagGsc({ tenantId: TENANT });
    expect(result.applied).toBe(false);
    expect(_updateCalls).toHaveLength(0);
  });

  it("is a no-op when no token exists", async () => {
    _gscToken = null;
    const result = await clearDisconnectedFlagGsc({ tenantId: TENANT });
    expect(result.applied).toBe(false);
    expect(_updateCalls).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Architecture-style invariants embedded as runtime guards
// ─────────────────────────────────────────────────────────────────────

describe("softDisconnectGsc — guards", () => {
  it("never calls deleteConnectorToken across the full happy path", async () => {
    _gscToken = makeToken();
    await softDisconnectGsc({ tenantId: TENANT });
    await softDisconnectGsc({ tenantId: TENANT });
    await clearDisconnectedFlagGsc({ tenantId: TENANT });
    expect(_deleteCalls).toHaveLength(0);
  });
});
