/**
 * SOURCES — GSC search-analytics connector boundaries (Core 100K lane S merge).
 *
 * Merged from tests/lib/connectors/gsc/{search-analytics-retry,
 * search-analytics-token-persist, pull-day-rows-truncation,
 * gsc-property-discovery, expiry-handler, quota-stagger, disconnect-flow}.
 *
 * Pinned boundaries (risk-register: GSC sync retry/expiry/quota/token-persist
 * merged, not dropped):
 *   • 429 exponential backoff (1s/2s/4s) then give up; non-429 single-shot.
 *   • 401 refresh-retry exactly once; refresh failure fails loud via
 *     onAuthFailure; 403 (scope loss) never refresh-retried.
 *   • resolveGscAccessToken persists the refreshed access token through the
 *     guarded compare-and-swap; persists a ROTATED refresh_token; NEVER blanks
 *     the stored refresh token; persistence is best-effort (fail-soft).
 *   • pullDayRows never returns a truncated day (null on any page failure).
 *   • Property auto-discovery picks the shape the token actually owns.
 *   • Token expiry three-state classifier + quota stagger/backoff schedule.
 *   • Soft disconnect never calls deleteConnectorToken.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  getGoogleConnectorToken: vi.fn(),
  saveConnectorToken: vi.fn(),
  updateConnectorToken: vi.fn(),
  deleteConnectorToken: vi.fn(),
  persistRefreshedGoogleToken: vi.fn(),
  refreshGoogleAccessToken: vi.fn(),
}));

vi.mock("@/lib/connector-store", () => ({
  getGoogleConnectorToken: mocks.getGoogleConnectorToken,
  saveConnectorToken: mocks.saveConnectorToken,
  updateConnectorToken: mocks.updateConnectorToken,
  deleteConnectorToken: mocks.deleteConnectorToken,
  persistRefreshedGoogleToken: mocks.persistRefreshedGoogleToken,
}));
vi.mock("@/lib/connectors/google-auth", () => ({
  refreshGoogleAccessToken: mocks.refreshGoogleAccessToken,
}));
vi.mock("@/lib/logger", () => ({
  log: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import {
  gscSearchAnalyticsQuery,
  resolveGscAccessToken,
  pullDayRows,
  GSC_SA_ROW_LIMIT,
  pickGscPropertyForDomain,
  gscListSites,
  type GscSearchAnalyticsRow,
  type GscSiteEntry,
} from "@/lib/connectors/gsc/search-analytics";
import {
  softDisconnectGsc,
  clearDisconnectedFlagGsc,
} from "@/lib/connectors/gsc/disconnect-flow";
import {
  evaluateExpiry,
  REFRESH_BUFFER_MS,
  STALE_OVER_THRESHOLD_MS,
} from "@/lib/connectors/gsc/expiry-handler";
import {
  staggerSlotHour,
  isStaggerSlotActive,
  backoffDelayMs,
  MAX_RETRIES_ON_429,
} from "@/lib/connectors/gsc/quota-stagger";
import type { GoogleConnectorToken } from "@/lib/connector-store";

const SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

const ARGS = {
  accessToken: "tok",
  siteUrl: "sc-domain:iranopedia.com",
  startDate: "2026-06-09",
  endDate: "2026-06-09",
  dimensions: ["page", "query"],
};

function res429() {
  return new Response("quota", { status: 429 });
}
function resRows(rows: unknown[]) {
  return new Response(JSON.stringify({ rows }), { status: 200 });
}

beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
  mocks.getGoogleConnectorToken.mockResolvedValue(null);
  mocks.refreshGoogleAccessToken.mockResolvedValue(null);
  mocks.persistRefreshedGoogleToken.mockResolvedValue(undefined);
  mocks.updateConnectorToken.mockResolvedValue(undefined);
});

// ─────────────────────────────────────────────────────────────────────
// gscSearchAnalyticsQuery — 429 backoff (audit #35)
// ─────────────────────────────────────────────────────────────────────

describe("gscSearchAnalyticsQuery 429 backoff", () => {
  it("retries through 429s with 1s/2s backoff and returns the eventual rows", async () => {
    const sleeps: number[] = [];
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(res429())
      .mockResolvedValueOnce(res429())
      .mockResolvedValueOnce(
        resRows([{ keys: ["p", "q"], clicks: 1, impressions: 10, ctr: 0.1, position: 2 }]),
      );
    const out = await gscSearchAnalyticsQuery(ARGS, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    expect(out).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([1000, 2000]);
  });

  it("gives up (null) after the backoff budget is exhausted", async () => {
    const fetchImpl = vi.fn(async () => res429());
    const sleeps: number[] = [];
    const out = await gscSearchAnalyticsQuery(ARGS, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    expect(out).toBeNull();
    expect(sleeps).toEqual([1000, 2000, 4000]);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("non-429 failures stay single-shot fail-soft (no retry storm)", async () => {
    const fetchImpl = vi.fn(async () => new Response("denied", { status: 403 }));
    const out = await gscSearchAnalyticsQuery(ARGS, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => {},
    });
    expect(out).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does NOT invoke onAuthFailure on a non-auth failure (500)", async () => {
    const onAuthFailure = vi.fn();
    const out = await gscSearchAnalyticsQuery(ARGS, {
      fetchImpl: (async () =>
        new Response("boom", { status: 500 })) as unknown as typeof fetch,
      sleep: async () => {},
      onAuthFailure,
    });
    expect(out).toBeNull();
    expect(onAuthFailure).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────
// gscSearchAnalyticsQuery — 401 refresh-retry (wave-11)
// ─────────────────────────────────────────────────────────────────────

describe("gscSearchAnalyticsQuery 401 refresh-retry", () => {
  it("refreshes + retries once on a 401 with the refreshed token, does NOT fail loud", async () => {
    const onAuthFailure = vi.fn();
    const refreshAccessToken = vi.fn(async () => "newtok");
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("unauthorized", { status: 401 }))
      .mockResolvedValueOnce(
        resRows([{ keys: ["p", "q"], clicks: 1, impressions: 9, ctr: 0.1, position: 3 }]),
      );
    const out = await gscSearchAnalyticsQuery(ARGS, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => {},
      onAuthFailure,
      refreshAccessToken,
    });
    expect(out).toHaveLength(1);
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(onAuthFailure).not.toHaveBeenCalled();
    const retryHeaders = (fetchImpl.mock.calls[1]![1] as RequestInit)
      .headers as Record<string, string>;
    expect(retryHeaders.Authorization).toBe("Bearer newtok");
  });

  it("fails loud (onAuthFailure + null) when the refresh itself fails", async () => {
    const onAuthFailure = vi.fn();
    const refreshAccessToken = vi.fn(async () => null);
    const fetchImpl = vi.fn(async () => new Response("unauthorized", { status: 401 }));
    const out = await gscSearchAnalyticsQuery(ARGS, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => {},
      onAuthFailure,
      refreshAccessToken,
    });
    expect(out).toBeNull();
    expect(onAuthFailure).toHaveBeenCalledWith(401);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries at most ONCE — a second 401 fails loud (no infinite loop)", async () => {
    const onAuthFailure = vi.fn();
    const refreshAccessToken = vi.fn(async () => "newtok");
    const fetchImpl = vi.fn(async () => new Response("unauthorized", { status: 401 }));
    const out = await gscSearchAnalyticsQuery(ARGS, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => {},
      onAuthFailure,
      refreshAccessToken,
    });
    expect(out).toBeNull();
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(onAuthFailure).toHaveBeenCalledWith(401);
  });

  it("does NOT refresh-retry a 403 (scope loss) even when refreshAccessToken is given", async () => {
    const onAuthFailure = vi.fn();
    const refreshAccessToken = vi.fn(async () => "newtok");
    const fetchImpl = vi.fn(async () => new Response("denied", { status: 403 }));
    const out = await gscSearchAnalyticsQuery(ARGS, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => {},
      onAuthFailure,
      refreshAccessToken,
    });
    expect(out).toBeNull();
    expect(refreshAccessToken).not.toHaveBeenCalled();
    expect(onAuthFailure).toHaveBeenCalledWith(403);
  });
});

// ─────────────────────────────────────────────────────────────────────
// resolveGscAccessToken — refreshed-token persistence (wave-9 + FIX 3)
// ─────────────────────────────────────────────────────────────────────

/** A grant whose access token JUST expired → evaluateExpiry = stale_under_7d. */
function staleToken() {
  return {
    provider: "google_gsc",
    access_token: "old-access",
    refresh_token: "refresh-abc",
    expires_at: Date.now() - 60_000,
    connected_at: "2026-06-01T00:00:00Z",
    scopes: [SCOPE],
  };
}

describe("resolveGscAccessToken — persists the refreshed token via the CAS", () => {
  it("routes the refreshed access_token + expiry through persistRefreshedGoogleToken for the tenant", async () => {
    mocks.getGoogleConnectorToken.mockResolvedValue(staleToken());
    mocks.refreshGoogleAccessToken.mockResolvedValue({
      access_token: "new-access",
      expires_in: 3600,
    });

    const result = await resolveGscAccessToken("tenant-x");

    expect(result).toBe("new-access");
    expect(mocks.persistRefreshedGoogleToken).toHaveBeenCalledTimes(1);
    const [provider, refreshed, tenantId] = mocks.persistRefreshedGoogleToken.mock
      .calls[0] as unknown as [
      string,
      { access_token: string; expires_in: number; refresh_token?: string },
      string,
    ];
    expect(provider).toBe("google_gsc");
    expect(tenantId).toBe("tenant-x");
    expect(refreshed.access_token).toBe("new-access");
    expect(refreshed.expires_in).toBe(3600);
  });

  it("still returns the refreshed token when persistence fails (best-effort; sync not broken)", async () => {
    mocks.getGoogleConnectorToken.mockResolvedValue(staleToken());
    mocks.refreshGoogleAccessToken.mockResolvedValue({
      access_token: "new-access",
      expires_in: 3600,
    });
    mocks.persistRefreshedGoogleToken.mockRejectedValue(
      new Error("supabase write failed"),
    );

    expect(await resolveGscAccessToken("tenant-x")).toBe("new-access");
  });

  it("persists a ROTATED refresh_token when Google returns one (FIX 3)", async () => {
    mocks.getGoogleConnectorToken.mockResolvedValue(staleToken());
    mocks.refreshGoogleAccessToken.mockResolvedValue({
      access_token: "new-access",
      expires_in: 3600,
      refresh_token: "rotated-refresh-xyz",
    });

    const result = await resolveGscAccessToken("tenant-x");

    expect(result).toBe("new-access");
    const refreshed = mocks.persistRefreshedGoogleToken.mock.calls[0]![1] as {
      refresh_token?: string;
    };
    expect(refreshed.refresh_token).toBe("rotated-refresh-xyz");
  });

  it("does NOT write refresh_token when Google rotates none (never blanks the stored token)", async () => {
    mocks.getGoogleConnectorToken.mockResolvedValue(staleToken());
    mocks.refreshGoogleAccessToken.mockResolvedValue({
      access_token: "new-access",
      expires_in: 3600,
    });

    await resolveGscAccessToken("tenant-x");

    const refreshed = mocks.persistRefreshedGoogleToken.mock.calls[0]![1] as Record<
      string,
      unknown
    >;
    expect("refresh_token" in refreshed).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────
// pullDayRows — truncation (audit-3 #6)
// ─────────────────────────────────────────────────────────────────────

function fullPage(n: number): GscSearchAnalyticsRow[] {
  return Array.from({ length: n }, (_, i) => ({
    keys: [`/p${i}`, `q${i}`],
    clicks: 1,
    impressions: 10,
    ctr: 0.1,
    position: 5,
  }));
}

const dayArgs = {
  accessToken: "tok",
  siteUrl: "sc-domain:example.com",
  day: "2026-06-01",
  dimensions: ["page", "query"] as string[],
};

describe("pullDayRows truncation", () => {
  it("returns NULL (not partial) when a later page fails mid-pagination", async () => {
    const queryImpl = vi
      .fn()
      .mockResolvedValueOnce(fullPage(GSC_SA_ROW_LIMIT))
      .mockResolvedValueOnce(null);
    const result = await pullDayRows({ ...dayArgs, queryImpl: queryImpl as never });
    expect(result).toBeNull();
    expect(queryImpl).toHaveBeenCalledTimes(2);
  });

  it("returns the full set when every page succeeds (last page short)", async () => {
    const queryImpl = vi
      .fn()
      .mockResolvedValueOnce(fullPage(GSC_SA_ROW_LIMIT))
      .mockResolvedValueOnce(fullPage(3));
    const result = await pullDayRows({ ...dayArgs, queryImpl: queryImpl as never });
    expect(result!.length).toBe(GSC_SA_ROW_LIMIT + 3);
  });

  it("returns null when the FIRST page fails", async () => {
    const queryImpl = vi.fn().mockResolvedValueOnce(null);
    expect(await pullDayRows({ ...dayArgs, queryImpl: queryImpl as never })).toBeNull();
  });

  it("returns a single short page as the complete day", async () => {
    const queryImpl = vi.fn().mockResolvedValueOnce(fullPage(42));
    const result = await pullDayRows({ ...dayArgs, queryImpl: queryImpl as never });
    expect(result!.length).toBe(42);
    expect(queryImpl).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Property auto-discovery (URL-prefix vs sc-domain, 2026-06-13)
// ─────────────────────────────────────────────────────────────────────

const owner = (siteUrl: string): GscSiteEntry => ({ siteUrl, permissionLevel: "siteOwner" });

describe("pickGscPropertyForDomain", () => {
  it("picks the URL-prefix property when that's what the account owns", () => {
    const sites = [owner("https://www.iranopedia.com/")];
    expect(pickGscPropertyForDomain(sites, "iranopedia.com")).toBe("https://www.iranopedia.com/");
    expect(pickGscPropertyForDomain(sites, "https://www.iranopedia.com/")).toBe("https://www.iranopedia.com/");
  });

  it("prefers a domain property (broadest) when both shapes exist", () => {
    const sites = [owner("https://www.x.com/"), owner("sc-domain:x.com")];
    expect(pickGscPropertyForDomain(sites, "x.com")).toBe("sc-domain:x.com");
  });

  it("prefers the www URL-prefix over a non-www one", () => {
    const sites = [owner("https://x.com/"), owner("https://www.x.com/")];
    expect(pickGscPropertyForDomain(sites, "x.com")).toBe("https://www.x.com/");
  });

  it("skips unverified properties and returns null when nothing matches", () => {
    const unverified: GscSiteEntry[] = [
      { siteUrl: "https://www.x.com/", permissionLevel: "siteUnverifiedUser" },
    ];
    expect(pickGscPropertyForDomain(unverified, "x.com")).toBeNull();
    expect(pickGscPropertyForDomain([owner("https://other.com/")], "x.com")).toBeNull();
    expect(pickGscPropertyForDomain([], "x.com")).toBeNull();
    expect(pickGscPropertyForDomain([owner("https://www.x.com/")], "")).toBeNull();
  });
});

describe("gscListSites", () => {
  it("parses verified site entries and drops rows without a siteUrl", async () => {
    const fetchImpl = (async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        siteEntry: [
          { siteUrl: "https://www.iranopedia.com/", permissionLevel: "siteOwner" },
          { siteUrl: "sc-domain:other.com", permissionLevel: "siteFullUser" },
          { permissionLevel: "siteOwner" },
        ],
      }),
    })) as unknown as typeof fetch;
    expect(await gscListSites("tok", { fetchImpl })).toEqual([
      { siteUrl: "https://www.iranopedia.com/", permissionLevel: "siteOwner" },
      { siteUrl: "sc-domain:other.com", permissionLevel: "siteFullUser" },
    ]);
  });

  it("fail-soft to [] on non-2xx and on network throw", async () => {
    const denied = (async () => ({ ok: false, status: 403, json: async () => ({}) })) as unknown as typeof fetch;
    expect(await gscListSites("tok", { fetchImpl: denied })).toEqual([]);
    const thrower = (async () => {
      throw new Error("network");
    }) as unknown as typeof fetch;
    expect(await gscListSites("tok", { fetchImpl: thrower })).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────
// evaluateExpiry — three-state classifier (Section 8 J2)
// ─────────────────────────────────────────────────────────────────────

const NOW_MS = Date.UTC(2026, 4, 18, 12, 0, 0);

function makeToken(over: Partial<GoogleConnectorToken> = {}): GoogleConnectorToken {
  return {
    provider: "google_gsc",
    access_token: "access-abc",
    refresh_token: "refresh-xyz",
    expires_at: NOW_MS + 30 * 60 * 1000,
    connected_at: new Date(NOW_MS - 24 * 60 * 60 * 1000).toISOString(),
    scopes: [SCOPE],
    ...over,
  } as GoogleConnectorToken;
}

describe("evaluateExpiry — three-state boundaries", () => {
  it("fresh while expires_at is beyond the 60s refresh buffer", () => {
    expect(
      evaluateExpiry({ token: makeToken({ expires_at: NOW_MS + REFRESH_BUFFER_MS + 1 }), now: NOW_MS }),
    ).toBe("fresh");
  });

  it("stale_under_7d inside the buffer and just after expiry", () => {
    expect(evaluateExpiry({ token: makeToken({ expires_at: NOW_MS + 30_000 }), now: NOW_MS })).toBe(
      "stale_under_7d",
    );
    expect(evaluateExpiry({ token: makeToken({ expires_at: NOW_MS - 1 }), now: NOW_MS })).toBe(
      "stale_under_7d",
    );
  });

  it("stale_under_7d at the 7-day boundary minus 1ms; stale_over_7d exactly at 7 days", () => {
    expect(
      evaluateExpiry({
        token: makeToken({ expires_at: NOW_MS - STALE_OVER_THRESHOLD_MS + 1 }),
        now: NOW_MS,
      }),
    ).toBe("stale_under_7d");
    expect(
      evaluateExpiry({
        token: makeToken({ expires_at: NOW_MS - STALE_OVER_THRESHOLD_MS }),
        now: NOW_MS,
      }),
    ).toBe("stale_over_7d");
  });

  it("stale_over_7d when expires_at is missing or non-finite (corrupted payload)", () => {
    expect(evaluateExpiry({ token: makeToken({ expires_at: NaN }), now: NOW_MS })).toBe(
      "stale_over_7d",
    );
    const token = makeToken();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (token as any).expires_at;
    expect(evaluateExpiry({ token, now: NOW_MS })).toBe("stale_over_7d");
  });
});


// ─────────────────────────────────────────────────────────────────────
// Quota stagger + backoff schedule (Section 8 J3)
// ─────────────────────────────────────────────────────────────────────

describe("quota-stagger", () => {
  it("staggerSlotHour is deterministic and bounded to {0,4,8,12,16,20}", () => {
    expect(staggerSlotHour("tenant-ritz-founder")).toBe(staggerSlotHour("tenant-ritz-founder"));
    const allowed = new Set([0, 4, 8, 12, 16, 20]);
    for (const t of ["tenant-a", "tenant-b", "tenant-ritz-founder", "a", "z"]) {
      expect(allowed.has(staggerSlotHour(t))).toBe(true);
    }
  });


  it("isStaggerSlotActive is true inside the 4-hour window and false outside", () => {
    const TENANT = "tenant-fixture-slot-zero";
    const slot = staggerSlotHour(TENANT);
    const utcHourDate = (hour: number) => new Date(Date.UTC(2026, 4, 18, hour, 0, 0));
    expect(isStaggerSlotActive({ tenantId: TENANT, now: utcHourDate(slot) })).toBe(true);
    expect(isStaggerSlotActive({ tenantId: TENANT, now: utcHourDate(slot + 3) })).toBe(true);
    expect(isStaggerSlotActive({ tenantId: TENANT, now: utcHourDate((slot + 4) % 24) })).toBe(false);
  });

  it("backoffDelayMs follows 1000 × 2^(n−1) then -1 above the cap or on invalid input", () => {
    expect(backoffDelayMs(1)).toBe(1000);
    expect(backoffDelayMs(2)).toBe(2000);
    expect(backoffDelayMs(3)).toBe(4000);
    expect(backoffDelayMs(MAX_RETRIES_ON_429 + 1)).toBe(-1);
    expect(backoffDelayMs(0)).toBe(-1);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Soft disconnect (Section 8 J5) — never destructive
// ─────────────────────────────────────────────────────────────────────

describe("softDisconnectGsc / clearDisconnectedFlagGsc", () => {
  const TENANT = "tenant-test";
  let token: GoogleConnectorToken | null;

  beforeEach(() => {
    token = null;
    mocks.getGoogleConnectorToken.mockImplementation(async (kind: string) =>
      kind === "gsc" ? token : null,
    );
    mocks.updateConnectorToken.mockImplementation(
      async (provider: string, patch: Record<string, unknown>) => {
        if (token != null && provider === "google_gsc") {
          token = { ...token, ...patch } as GoogleConnectorToken;
          if (
            Object.prototype.hasOwnProperty.call(patch, "disconnected_at") &&
            patch.disconnected_at === undefined
          ) {
            delete (token as { disconnected_at?: string }).disconnected_at;
          }
        }
      },
    );
  });

  it("sets disconnected_at via updateConnectorToken WITHOUT calling deleteConnectorToken", async () => {
    token = makeToken({ expires_at: Date.now() + 3600_000 });
    const result = await softDisconnectGsc({
      tenantId: TENANT,
      now: new Date("2026-05-18T12:00:00Z"),
    });
    expect(result.applied).toBe(true);
    expect(result.disconnected_at).toBe("2026-05-18T12:00:00.000Z");
    expect(mocks.updateConnectorToken).toHaveBeenCalledTimes(1);
    expect(mocks.updateConnectorToken.mock.calls[0]).toEqual([
      "google_gsc",
      { disconnected_at: "2026-05-18T12:00:00.000Z" },
      TENANT,
    ]);
    expect(mocks.deleteConnectorToken).not.toHaveBeenCalled();
  });

  it("returns applied=false (no write) when no GSC token exists", async () => {
    token = null;
    const result = await softDisconnectGsc({ tenantId: TENANT });
    expect(result.applied).toBe(false);
    expect(result.disconnected_at).toBeNull();
    expect(mocks.updateConnectorToken).not.toHaveBeenCalled();
  });

  it("clearDisconnectedFlagGsc clears the flag when set, no-op when absent", async () => {
    token = makeToken({
      expires_at: Date.now() + 3600_000,
      disconnected_at: "2026-05-10T08:00:00.000Z",
    } as Partial<GoogleConnectorToken>);
    const cleared = await clearDisconnectedFlagGsc({ tenantId: TENANT });
    expect(cleared.applied).toBe(true);
    expect(mocks.updateConnectorToken.mock.calls[0]?.[1]).toEqual({
      disconnected_at: undefined,
    });

    const again = await clearDisconnectedFlagGsc({ tenantId: TENANT });
    expect(again.applied).toBe(false);
    expect(mocks.updateConnectorToken).toHaveBeenCalledTimes(1);
  });

});
