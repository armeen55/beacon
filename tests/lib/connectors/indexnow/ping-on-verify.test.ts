/**
 * The verify-live -> IndexNow wiring point (BEACON_500 item 75, 2026-07-02).
 *
 * Pins the safety contract:
 *   - no key configured -> the ping never fires and NO receipt is written
 *     (that is the documented self-hide, not a failure)
 *   - a key configured -> pings with the tenant's configured host/key and
 *     records a receipt regardless of ok/fail outcome
 *   - the wiring point itself NEVER throws, even if every dependency does
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  config: null as { key: string; host?: string; keyLocation?: string } | null,
  pingResult: { ok: true, status: 200 } as
    | { ok: true; status: number }
    | { ok: false; status: number | null; error: string },
  receipts: [] as unknown[],
  pingCalls: [] as unknown[],
}));

vi.mock("@/lib/connectors/indexnow/config-store", () => ({
  getIndexNowConfig: vi.fn(async () => mocks.config),
}));

vi.mock("@/lib/connectors/indexnow/client", () => ({
  pingIndexNowForUrl: vi.fn(async (args: unknown) => {
    mocks.pingCalls.push(args);
    return mocks.pingResult;
  }),
}));

vi.mock("@/lib/connectors/indexnow/receipts-store", () => ({
  appendIndexNowReceipt: vi.fn(async (r: unknown) => {
    mocks.receipts.push(r);
  }),
}));

vi.mock("@/domains/tenants/store", () => ({
  getTenant: vi.fn(async () => ({ domain: "example.com" })),
}));

import {
  pingIndexNowOnVerifiedLive,
  scheduleIndexNowPing,
} from "@/lib/connectors/indexnow/ping-on-verify";

beforeEach(() => {
  mocks.config = null;
  mocks.pingResult = { ok: true, status: 200 };
  mocks.receipts = [];
  mocks.pingCalls = [];
});

describe("pingIndexNowOnVerifiedLive", () => {
  it("self-hides with no receipt when no key is configured", async () => {
    mocks.config = null;
    await pingIndexNowOnVerifiedLive({ tenantId: "t1", url: "https://example.com/a" });
    expect(mocks.pingCalls).toHaveLength(0);
    expect(mocks.receipts).toHaveLength(0);
  });

  it("pings with the configured key/host and records a success receipt", async () => {
    mocks.config = { key: "abc12345", host: "example.com" };
    mocks.pingResult = { ok: true, status: 202 };
    await pingIndexNowOnVerifiedLive({
      tenantId: "t1",
      url: "https://example.com/a",
      now: new Date("2026-07-02T00:00:00Z"),
    });
    expect(mocks.pingCalls).toEqual([
      { url: "https://example.com/a", key: "abc12345", keyLocation: undefined },
    ]);
    expect(mocks.receipts).toHaveLength(1);
    expect(mocks.receipts[0]).toMatchObject({
      url: "https://example.com/a",
      ok: true,
      status: 202,
      detail: "accepted",
    });
  });

  it("records a failure receipt without throwing when the ping fails", async () => {
    mocks.config = { key: "abc12345", host: "example.com" };
    mocks.pingResult = { ok: false, status: null, error: "network down" };
    await expect(
      pingIndexNowOnVerifiedLive({ tenantId: "t1", url: "https://example.com/a" }),
    ).resolves.toBeUndefined();
    expect(mocks.receipts).toHaveLength(1);
    expect(mocks.receipts[0]).toMatchObject({ ok: false, detail: "network down" });
  });

  it("derives the host from the URL when config has no host override", async () => {
    mocks.config = { key: "abc12345" };
    await pingIndexNowOnVerifiedLive({ tenantId: "t1", url: "https://sub.example.com/x" });
    expect(mocks.pingCalls).toEqual([
      { url: "https://sub.example.com/x", key: "abc12345", keyLocation: undefined },
    ]);
  });

  it("never throws even if the config read itself throws", async () => {
    const { getIndexNowConfig } = await import("@/lib/connectors/indexnow/config-store");
    vi.mocked(getIndexNowConfig).mockRejectedValueOnce(new Error("boom"));
    await expect(
      pingIndexNowOnVerifiedLive({ tenantId: "t1", url: "https://example.com/a" }),
    ).resolves.toBeUndefined();
  });
});

describe("scheduleIndexNowPing", () => {
  it("fires without the caller having to await it", () => {
    mocks.config = { key: "abc12345", host: "example.com" };
    expect(() =>
      scheduleIndexNowPing({ tenantId: "t1", url: "https://example.com/a" }),
    ).not.toThrow();
  });
});
