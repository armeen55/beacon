import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

type ConnectorInfoStub = { status: "connected" | "disconnected"; connected_at: string | null };
let connectorInfos: Record<string, ConnectorInfoStub> = {};
vi.mock("@/lib/connector-store", () => ({
  getConnectorInfo: async (provider: string, tenantId: string) =>
    connectorInfos[`${tenantId}::${provider}`] ?? { status: "disconnected", connected_at: null },
}));

let sendEmailResult: unknown = { sent: true, id: "email-1" };
let sentCalls: Array<{ to: string; subject: string; text: string }> = [];
vi.mock("@/lib/email/resend", () => ({
  sendEmail: async (input: { to: string; subject: string; text: string }) => {
    sentCalls.push(input);
    return sendEmailResult;
  },
}));

let warnedCycles = new Set<string>();
let recordedWarnings: Array<{ tenantId: string; provider: string; connectedAt: string }> = [];
vi.mock("./token-expiry-warning-store", () => ({
  alreadyWarnedThisCycle: async (tenantId: string, provider: string, connectedAt: string) =>
    warnedCycles.has(`${tenantId}::${provider}::${connectedAt}`),
  recordWarningSent: async (tenantId: string, provider: string, connectedAt: string) => {
    recordedWarnings.push({ tenantId, provider, connectedAt });
    warnedCycles.add(`${tenantId}::${provider}::${connectedAt}`);
  },
}));

import { checkTokenExpiryForTenants } from "./token-expiry-notify";

const NOW = new Date("2026-07-06T00:00:00.000Z"); // 5 days after a 07-01 grant -> 2 days left

beforeEach(() => {
  connectorInfos = {};
  sendEmailResult = { sent: true, id: "email-1" };
  sentCalls = [];
  warnedCycles = new Set();
  recordedWarnings = [];
  process.env.BEACON_DIGEST_TO = "operator@example.com";
});

describe("checkTokenExpiryForTenants - operator-only, deduped, fail-soft", () => {
  it("sends exactly one email to the configured operator when a connection hits T-2", async () => {
    connectorInfos["tenant-a::google_gsc"] = { status: "connected", connected_at: "2026-07-01T00:00:00.000Z" };
    const results = await checkTokenExpiryForTenants(["tenant-a"], NOW);
    const gsc = results.find((r) => r.provider === "google_gsc");
    expect(gsc?.action).toBe("sent");
    expect(sentCalls).toHaveLength(1);
    expect(sentCalls[0]!.to).toBe("operator@example.com");
  });

  it("never emails anyone but the configured operator inbox", async () => {
    connectorInfos["tenant-a::google_gsc"] = { status: "connected", connected_at: "2026-07-01T00:00:00.000Z" };
    connectorInfos["tenant-b::google_ga4"] = { status: "connected", connected_at: "2026-07-01T00:00:00.000Z" };
    await checkTokenExpiryForTenants(["tenant-a", "tenant-b"], NOW);
    for (const call of sentCalls) {
      expect(call.to).toBe("operator@example.com");
    }
  });

  it("skips and logs honestly when no operator email is configured", async () => {
    delete process.env.BEACON_DIGEST_TO;
    connectorInfos["tenant-a::google_gsc"] = { status: "connected", connected_at: "2026-07-01T00:00:00.000Z" };
    const results = await checkTokenExpiryForTenants(["tenant-a"], NOW);
    expect(sentCalls).toHaveLength(0);
    expect(results.every((r) => r.action === "skipped_not_configured")).toBe(true);
  });

  it("does not warn when the connection is not yet within the threshold", async () => {
    connectorInfos["tenant-a::google_gsc"] = { status: "connected", connected_at: "2026-07-06T00:00:00.000Z" }; // fresh
    const results = await checkTokenExpiryForTenants(["tenant-a"], NOW);
    const gsc = results.find((r) => r.provider === "google_gsc");
    expect(gsc?.action).toBe("not_due");
    expect(sentCalls).toHaveLength(0);
  });

  it("skips a provider with no connection", async () => {
    const results = await checkTokenExpiryForTenants(["tenant-a"], NOW);
    expect(results.every((r) => r.action === "no_connection")).toBe(true);
    expect(sentCalls).toHaveLength(0);
  });

  it("dedupes: sends at most one warning per (tenant, provider) per expiry cycle", async () => {
    connectorInfos["tenant-a::google_gsc"] = { status: "connected", connected_at: "2026-07-01T00:00:00.000Z" };
    await checkTokenExpiryForTenants(["tenant-a"], NOW);
    const secondRun = await checkTokenExpiryForTenants(["tenant-a"], NOW);
    expect(sentCalls).toHaveLength(1); // only the first run sent
    expect(secondRun.find((r) => r.provider === "google_gsc")?.action).toBe("already_warned");
  });

  it("opens a fresh warning cycle after a reconnect changes connected_at", async () => {
    connectorInfos["tenant-a::google_gsc"] = { status: "connected", connected_at: "2026-07-01T00:00:00.000Z" };
    await checkTokenExpiryForTenants(["tenant-a"], NOW);
    // Reconnect resets connected_at to "now" (fresh grant) -> next cycle far in the future,
    // then simulate hitting T-2 again on THAT cycle.
    connectorInfos["tenant-a::google_gsc"] = { status: "connected", connected_at: "2026-07-10T00:00:00.000Z" };
    const laterNow = new Date("2026-07-15T00:00:00.000Z"); // 5 days after new grant -> 2 left
    const results = await checkTokenExpiryForTenants(["tenant-a"], laterNow);
    expect(results.find((r) => r.provider === "google_gsc")?.action).toBe("sent");
    expect(sentCalls).toHaveLength(2);
  });

  it("reports send_failed without throwing when the email provider errors", async () => {
    sendEmailResult = { sent: false, reason: "send_failed", detail: "http_500" };
    connectorInfos["tenant-a::google_gsc"] = { status: "connected", connected_at: "2026-07-01T00:00:00.000Z" };
    const results = await checkTokenExpiryForTenants(["tenant-a"], NOW);
    expect(results.find((r) => r.provider === "google_gsc")?.action).toBe("send_failed");
  });

  it("never throws when a connector read throws for one provider", async () => {
    vi.doMock("@/lib/connector-store", () => ({
      getConnectorInfo: async () => {
        throw new Error("boom");
      },
    }));
    vi.resetModules();
    const mod = await import("./token-expiry-notify");
    await expect(mod.checkTokenExpiryForTenants(["tenant-a"], NOW)).resolves.toBeDefined();
  });
});
