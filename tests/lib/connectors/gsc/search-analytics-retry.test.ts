/**
 * Audit #35 hardening (2026-06-12) — gscSearchAnalyticsQuery retries
 * 429s with the connector's own exponential backoff (quota-stagger's
 * backoffDelayMs: 1s/2s/4s then give up). Other failures stay
 * single-shot fail-soft.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/connector-store", () => ({
  getGoogleConnectorToken: vi.fn(async () => null),
  saveConnectorToken: vi.fn(async () => {}),
}));
vi.mock("@/lib/connectors/google-auth", () => ({
  refreshGoogleAccessToken: vi.fn(async () => null),
}));
vi.mock("@/lib/logger", () => ({
  log: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { gscSearchAnalyticsQuery } from "@/lib/connectors/gsc/search-analytics";

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
    // attempts 1..3 back off (1s/2s/4s); attempt 4 exhausts → null.
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

  // wave-11 follow-on (2026-06-14): a 401/403 must SIGNAL auth failure so the
  // sync surfaces synced:false (fail-loud) instead of treating a dead/expired
  // GSC grant as "0 rows" (silent stale GSC).
  it("invokes onAuthFailure(status) on a 401 and still returns null", async () => {
    const onAuthFailure = vi.fn();
    const out = await gscSearchAnalyticsQuery(ARGS, {
      fetchImpl: (async () =>
        new Response("unauthorized", { status: 401 })) as unknown as typeof fetch,
      sleep: async () => {},
      onAuthFailure,
    });
    expect(out).toBeNull();
    expect(onAuthFailure).toHaveBeenCalledWith(401);
  });

  it("invokes onAuthFailure(403) on a permission/scope failure", async () => {
    const onAuthFailure = vi.fn();
    await gscSearchAnalyticsQuery(ARGS, {
      fetchImpl: (async () =>
        new Response("denied", { status: 403 })) as unknown as typeof fetch,
      sleep: async () => {},
      onAuthFailure,
    });
    expect(onAuthFailure).toHaveBeenCalledWith(403);
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

// wave-11 follow-on (2026-06-14): a 401 is a RECOVERABLE access-token expiry.
// When the caller supplies `refreshAccessToken`, the query mints a fresh token
// and retries ONCE before failing loud (mirrors ga4/data-api.ts) — so an
// expired-but-refreshable GSC grant self-heals instead of bugging the operator
// to reconnect. 403 (scope loss) is NOT retried.
describe("gscSearchAnalyticsQuery 401 refresh-retry", () => {
  it("refreshes + retries once on a 401, returns the rows, does NOT fail loud", async () => {
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
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    // The retry must use the REFRESHED token in the Authorization header.
    const retryHeaders = (fetchImpl.mock.calls[1]![1] as RequestInit)
      .headers as Record<string, string>;
    expect(retryHeaders.Authorization).toBe("Bearer newtok");
  });

  it("fails loud (onAuthFailure + null) when the refresh itself fails", async () => {
    const onAuthFailure = vi.fn();
    const refreshAccessToken = vi.fn(async () => null); // refresh token dead
    const fetchImpl = vi.fn(async () => new Response("unauthorized", { status: 401 }));
    const out = await gscSearchAnalyticsQuery(ARGS, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => {},
      onAuthFailure,
      refreshAccessToken,
    });
    expect(out).toBeNull();
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(onAuthFailure).toHaveBeenCalledWith(401);
    expect(fetchImpl).toHaveBeenCalledTimes(1); // no retry when refresh fails
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
    expect(refreshAccessToken).toHaveBeenCalledTimes(1); // exactly one refresh
    expect(fetchImpl).toHaveBeenCalledTimes(2); // original + one retry
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
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
