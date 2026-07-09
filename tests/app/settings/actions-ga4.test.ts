/**
 * 2026-05-18 — Slice 9.A1β — GA4 server actions unit tests.
 *
 * Pins:
 *   • getGoogleAuthUrl("ga4") builds an auth URL whose scope is
 *     analytics.readonly AND whose state.k discriminator is "ga4".
 *   • listGa4Properties wraps listGa4PropertiesForTenant with the
 *     current tenant + surfaces results verbatim (happy + fail-soft).
 *   • selectGa4Property rejects empty id / display name.
 *   • selectGa4Property rejects a property id not in the current
 *     listGa4Properties() result (defense-in-depth against stale/
 *     forged submission).
 *   • selectGa4Property persists via updateConnectorToken when the
 *     id is valid.
 *   • selectGa4Property still persists when the defense-in-depth
 *     listing fails — operator-trust path (the operator must have
 *     just seen the property in the picker to have submitted it).
 *   • disconnectGoogleGa4 sets disconnected_at AND clears the
 *     ga4_property_* fields via updateConnectorToken — no
 *     deleteConnectorToken call.
 *   • disconnectGoogle does NOT touch the google_ga4 token (GA4 is
 *     managed independently from the GSC + GBP combo).
 *
 * Mocks connector-store + listGa4PropertiesForTenant + softDisconnectGsc
 * so the tests don't depend on Supabase or the live Google API.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

import type { ConnectorProvider } from "@/lib/connector-store";
import type { Ga4PropertyListResult } from "@/lib/connectors/ga4/types";

// ─────────────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────────────

let _propertyListResult: Ga4PropertyListResult = {
  ok: true,
  properties: [
    {
      id: "1001",
      displayName: "Production",
      accountId: "100",
      accountDisplayName: "Account A",
    },
  ],
};

vi.mock("@/lib/connectors/ga4/property-selection", () => ({
  listGa4PropertiesForTenant: vi.fn(async (_t: string) => _propertyListResult),
}));

let _updateCalls: Array<{
  provider: ConnectorProvider;
  patch: Record<string, unknown>;
  tenantId?: string;
}> = [];
let _deleteCalls: Array<{ provider: ConnectorProvider; tenantId?: string }> = [];

vi.mock("@/lib/connector-store", () => ({
  getConnectorInfo: vi.fn(async () => ({
    status: "disconnected" as const,
    connected_at: null,
    expires_at: null,
    last_synced_at: null,
  })),
  // FIX 2 (OAUTH_ROOT_CAUSE_2026-07-09): getGoogleAuthUrl now reads the stored
  // token to decide prompt=consent vs select_account. No token → force consent.
  getGoogleConnectorToken: vi.fn(async () => null),
  deleteConnectorToken: vi.fn(
    async (provider: ConnectorProvider, tenantId?: string) => {
      _deleteCalls.push({ provider, tenantId });
    },
  ),
  saveConnectorToken: vi.fn(async () => {}),
  updateConnectorToken: vi.fn(
    async (
      provider: ConnectorProvider,
      patch: Record<string, unknown>,
      tenantId?: string,
    ) => {
      _updateCalls.push({ provider, patch, tenantId });
    },
  ),
}));

vi.mock("@/lib/connectors/gsc/disconnect-flow", () => ({
  softDisconnectGsc: vi.fn(async () => ({
    applied: false,
    disconnected_at: null,
  })),
}));

vi.mock("@/lib/connectors/google-reviews-sync", () => ({
  runGoogleReviewsSync: vi.fn(),
  fetchGoogleLocations: vi.fn(),
}));

vi.mock("@/lib/connectors/yelp-reviews-sync", () => ({
  runYelpReviewsSync: vi.fn(),
}));

vi.mock("@/lib/business-config", () => ({
  getBusinessConfig: () => ({ yelpBusinessId: "" }),
}));

vi.mock("@/lib/tenant-context", () => ({
  currentTenantId: vi.fn(async () => "tenant-test"),
}));

vi.mock("@/lib/actions", () => ({
  now: () => "2026-05-18T12:00:00.000Z",
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

// Re-import after mocking.
import {
  getGoogleAuthUrl,
  listGa4Properties,
  selectGa4Property,
  disconnectGoogleGa4,
  disconnectGoogle,
} from "@/app/(shell)/settings/connectors/actions";

beforeEach(() => {
  _updateCalls = [];
  _deleteCalls = [];
  _propertyListResult = {
    ok: true,
    properties: [
      {
        id: "1001",
        displayName: "Production",
        accountId: "100",
        accountDisplayName: "Account A",
      },
    ],
  };
  process.env.GOOGLE_CLIENT_ID = "test-client-id";
  process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
  process.env.BEACON_OAUTH_STATE_SECRET = "test-state-secret";
});

// ─────────────────────────────────────────────────────────────────────
// getGoogleAuthUrl — GA4 kind
// ─────────────────────────────────────────────────────────────────────

describe("getGoogleAuthUrl('ga4')", () => {
  it("returns a URL whose DATA scope is analytics.readonly (plus the openid+email identity scopes)", async () => {
    // Per-tenant OAuth (2026-07-09): the single least-privilege data scope per
    // kind is unchanged; the basic identity scopes ride along so the callback
    // can read the account's sub + email ("Connected as <email>").
    const r = await getGoogleAuthUrl("ga4");
    expect(r.url).not.toBeNull();
    const u = new URL(r.url!);
    expect(u.searchParams.get("scope")).toBe(
      "https://www.googleapis.com/auth/analytics.readonly openid email",
    );
  });

  it("does NOT include webmasters.readonly OR business.manage in the GA4 URL", async () => {
    const r = await getGoogleAuthUrl("ga4");
    expect(r.url!.includes("webmasters.readonly")).toBe(false);
    expect(r.url!.includes("business.manage")).toBe(false);
  });

  it("carries a signed state whose decoded payload has k='ga4' + t=current tenant", async () => {
    const r = await getGoogleAuthUrl("ga4");
    const u = new URL(r.url!);
    const stateRaw = u.searchParams.get("state");
    expect(stateRaw).not.toBeNull();
    const { decodeOAuthState } = await import("@/lib/connectors/google-auth");
    const decoded = decodeOAuthState(stateRaw!);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      expect(decoded.payload.k).toBe("ga4");
      expect(decoded.payload.t).toBe("tenant-test");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// listGa4Properties — wraps listGa4PropertiesForTenant
// ─────────────────────────────────────────────────────────────────────

describe("listGa4Properties", () => {
  it("surfaces happy-path properties verbatim", async () => {
    _propertyListResult = {
      ok: true,
      properties: [
        {
          id: "1001",
          displayName: "Production",
          accountId: "100",
          accountDisplayName: "Account A",
        },
      ],
    };
    const r = await listGa4Properties();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.properties).toHaveLength(1);
      expect(r.properties[0]!.id).toBe("1001");
    }
  });

  it("surfaces fail-soft no_token reason verbatim", async () => {
    _propertyListResult = { ok: false, reason: "no_token" };
    const r = await listGa4Properties();
    expect(r).toEqual({ ok: false, reason: "no_token" });
  });

  it("surfaces fail-soft api_error reason verbatim", async () => {
    _propertyListResult = {
      ok: false,
      reason: "api_error",
      message: "test",
    };
    const r = await listGa4Properties();
    expect(r).toEqual({ ok: false, reason: "api_error", message: "test" });
  });
});

// ─────────────────────────────────────────────────────────────────────
// selectGa4Property — validation + persistence
// ─────────────────────────────────────────────────────────────────────

describe("selectGa4Property — validation", () => {
  it("rejects empty id", async () => {
    const r = await selectGa4Property({
      id: "",
      displayName: "Production",
      accountDisplayName: "Account A",
    });
    expect(r.success).toBe(false);
    expect(_updateCalls).toHaveLength(0);
  });

  it("rejects empty display name", async () => {
    const r = await selectGa4Property({
      id: "1001",
      displayName: "",
      accountDisplayName: "Account A",
    });
    expect(r.success).toBe(false);
    expect(_updateCalls).toHaveLength(0);
  });

  it("rejects an id not in the latest listGa4Properties result", async () => {
    _propertyListResult = {
      ok: true,
      properties: [
        {
          id: "1001",
          displayName: "Production",
          accountId: "100",
          accountDisplayName: "Account A",
        },
      ],
    };
    const r = await selectGa4Property({
      id: "9999",
      displayName: "Forged",
      accountDisplayName: "Account A",
    });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/no longer available/i);
    expect(_updateCalls).toHaveLength(0);
  });
});

describe("selectGa4Property — persistence", () => {
  it("persists ga4_property_id + display_name via updateConnectorToken when id is known", async () => {
    const r = await selectGa4Property({
      id: "1001",
      displayName: "Production",
      accountDisplayName: "Account A",
    });
    expect(r.success).toBe(true);
    expect(_updateCalls).toHaveLength(1);
    expect(_updateCalls[0]!.provider).toBe("google_ga4");
    expect(_updateCalls[0]!.patch).toEqual({
      ga4_property_id: "1001",
      ga4_property_display_name: "Production",
      ga4_account_display_name: "Account A",
    });
  });

  it("persists when listGa4Properties fails (defense-in-depth operator-trust skip)", async () => {
    _propertyListResult = { ok: false, reason: "api_error" };
    const r = await selectGa4Property({
      id: "1001",
      displayName: "Production",
      accountDisplayName: "Account A",
    });
    expect(r.success).toBe(true);
    expect(_updateCalls).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────
// disconnectGoogleGa4 — soft-disconnect
// ─────────────────────────────────────────────────────────────────────

describe("disconnectGoogleGa4", () => {
  it("sets disconnected_at + clears ga4_property_* via updateConnectorToken", async () => {
    const r = await disconnectGoogleGa4();
    expect(r.success).toBe(true);
    expect(_updateCalls).toHaveLength(1);
    expect(_updateCalls[0]!.provider).toBe("google_ga4");
    const patch = _updateCalls[0]!.patch;
    expect(typeof patch.disconnected_at).toBe("string");
    expect(patch.ga4_property_id).toBeUndefined();
    expect(patch.ga4_property_display_name).toBeUndefined();
    expect(patch.ga4_account_display_name).toBeUndefined();
  });

  it("does NOT call deleteConnectorToken (no destructive write)", async () => {
    await disconnectGoogleGa4();
    expect(_deleteCalls).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// disconnectGoogle — leaves GA4 alone
// ─────────────────────────────────────────────────────────────────────

describe("disconnectGoogle — leaves GA4 untouched", () => {
  it("disconnects GSC + GBP but never touches the google_ga4 provider", async () => {
    await disconnectGoogle();
    const ga4Touched = [..._updateCalls, ..._deleteCalls].some(
      (c) => c.provider === "google_ga4",
    );
    expect(ga4Touched).toBe(false);
  });
});
