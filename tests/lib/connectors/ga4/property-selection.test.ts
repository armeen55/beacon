/**
 * 2026-05-18 — Slice 9.A1 — `listGa4PropertiesForTenant` +
 * `flattenAccountSummaries` unit tests.
 *
 * Pins:
 *   • Happy path flattens accountSummaries[*].propertySummaries[*]
 *     into Ga4Property[] with stripped resource-name prefixes.
 *   • Defensive flattening drops malformed entries (missing
 *     account / property resource names, missing display names).
 *   • Cap at MAX_PROPERTIES (100).
 *   • Fail-soft surface: no_token / token_expired / disconnected /
 *     api_error all returned verbatim from the fetch helper.
 *   • Empty / nullable input → [] (never throws).
 *
 * Mocks `ga4ApiFetch` so the tests don't depend on the network or
 * the connector store.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

import type { Ga4ApiFetchResult } from "@/lib/connectors/ga4/types";

// ─────────────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────────────

let _fetchResult: Ga4ApiFetchResult<unknown> = {
  ok: true,
  data: { accountSummaries: [] },
};
let _fetchCalls: Array<{ tenantId: string; url: string }> = [];

vi.mock("@/lib/connectors/ga4/client", () => ({
  ga4ApiFetch: vi.fn(
    async (args: { tenantId: string; url: string }) => {
      _fetchCalls.push({ tenantId: args.tenantId, url: args.url });
      return _fetchResult;
    },
  ),
}));

import {
  listGa4PropertiesForTenant,
  flattenAccountSummaries,
  __testing,
} from "@/lib/connectors/ga4/property-selection";

beforeEach(() => {
  _fetchResult = { ok: true, data: { accountSummaries: [] } };
  _fetchCalls = [];
});

// ─────────────────────────────────────────────────────────────────────
// flattenAccountSummaries — pure helper
// ─────────────────────────────────────────────────────────────────────

describe("flattenAccountSummaries — happy path", () => {
  it("flattens accountSummaries[*].propertySummaries[*]", () => {
    const body = {
      accountSummaries: [
        {
          account: "accounts/100",
          displayName: "Ritz Builders LLC",
          propertySummaries: [
            { property: "properties/1001", displayName: "Production" },
            { property: "properties/1002", displayName: "Staging" },
          ],
        },
      ],
    };
    expect(flattenAccountSummaries(body)).toEqual([
      {
        id: "1001",
        displayName: "Production",
        accountId: "100",
        accountDisplayName: "Ritz Builders LLC",
      },
      {
        id: "1002",
        displayName: "Staging",
        accountId: "100",
        accountDisplayName: "Ritz Builders LLC",
      },
    ]);
  });

  it("handles multiple accounts", () => {
    const body = {
      accountSummaries: [
        {
          account: "accounts/100",
          displayName: "Account A",
          propertySummaries: [
            { property: "properties/1", displayName: "P-A1" },
          ],
        },
        {
          account: "accounts/200",
          displayName: "Account B",
          propertySummaries: [
            { property: "properties/2", displayName: "P-B1" },
          ],
        },
      ],
    };
    const r = flattenAccountSummaries(body);
    expect(r).toHaveLength(2);
    expect(r[0]!.accountId).toBe("100");
    expect(r[1]!.accountId).toBe("200");
  });
});

describe("flattenAccountSummaries — defensive", () => {
  it("returns [] for null body", () => {
    expect(flattenAccountSummaries(null)).toEqual([]);
  });

  it("returns [] for undefined body", () => {
    expect(flattenAccountSummaries(undefined)).toEqual([]);
  });

  it("returns [] when accountSummaries field missing", () => {
    expect(flattenAccountSummaries({} as never)).toEqual([]);
  });

  it("skips account entries missing display name", () => {
    const body = {
      accountSummaries: [
        {
          account: "accounts/100",
          // displayName missing
          propertySummaries: [
            { property: "properties/1", displayName: "P-1" },
          ],
        },
      ],
    };
    expect(flattenAccountSummaries(body)).toEqual([]);
  });

  it("skips property entries missing display name", () => {
    const body = {
      accountSummaries: [
        {
          account: "accounts/100",
          displayName: "Account A",
          propertySummaries: [
            { property: "properties/1" /* displayName missing */ },
            { property: "properties/2", displayName: "P-2" },
          ],
        },
      ],
    };
    const r = flattenAccountSummaries(body);
    expect(r).toHaveLength(1);
    expect(r[0]!.id).toBe("2");
  });

  it("caps at MAX_PROPERTIES (100)", () => {
    const propertySummaries: Array<{ property: string; displayName: string }> = [];
    for (let i = 0; i < 150; i++) {
      propertySummaries.push({
        property: `properties/${i}`,
        displayName: `P-${i}`,
      });
    }
    const body = {
      accountSummaries: [
        {
          account: "accounts/100",
          displayName: "Account",
          propertySummaries,
        },
      ],
    };
    const r = flattenAccountSummaries(body);
    expect(r).toHaveLength(__testing.MAX_PROPERTIES);
  });
});

// ─────────────────────────────────────────────────────────────────────
// listGa4PropertiesForTenant — wraps ga4ApiFetch
// ─────────────────────────────────────────────────────────────────────

describe("listGa4PropertiesForTenant", () => {
  it("calls the Admin API account-summaries endpoint with the tenant id", async () => {
    _fetchResult = {
      ok: true,
      data: { accountSummaries: [] },
    };
    await listGa4PropertiesForTenant("tenant-x");
    expect(_fetchCalls).toEqual([
      {
        tenantId: "tenant-x",
        url: __testing.ACCOUNT_SUMMARIES_URL,
      },
    ]);
  });

  it("returns ok:true with flattened properties on happy path", async () => {
    _fetchResult = {
      ok: true,
      data: {
        accountSummaries: [
          {
            account: "accounts/100",
            displayName: "Acc",
            propertySummaries: [
              { property: "properties/1", displayName: "P-1" },
            ],
          },
        ],
      },
    };
    const r = await listGa4PropertiesForTenant("tenant-x");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.properties).toHaveLength(1);
      expect(r.properties[0]!.id).toBe("1");
    }
  });

  it("surfaces ga4ApiFetch fail-soft reason verbatim", async () => {
    _fetchResult = { ok: false, reason: "no_token" };
    const r = await listGa4PropertiesForTenant("tenant-x");
    expect(r).toEqual({ ok: false, reason: "no_token" });
  });

  it("surfaces api_error with optional message", async () => {
    _fetchResult = {
      ok: false,
      reason: "api_error",
      message: "missing url",
    };
    const r = await listGa4PropertiesForTenant("tenant-x");
    expect(r).toEqual({
      ok: false,
      reason: "api_error",
      message: "missing url",
    });
  });

  it("surfaces token_expired", async () => {
    _fetchResult = { ok: false, reason: "token_expired" };
    const r = await listGa4PropertiesForTenant("tenant-x");
    expect(r).toEqual({ ok: false, reason: "token_expired" });
  });

  it("surfaces disconnected", async () => {
    _fetchResult = { ok: false, reason: "disconnected" };
    const r = await listGa4PropertiesForTenant("tenant-x");
    expect(r).toEqual({ ok: false, reason: "disconnected" });
  });
});
