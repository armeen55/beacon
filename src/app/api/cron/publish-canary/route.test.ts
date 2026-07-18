import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";

const listTenantsMock = vi.fn();
vi.mock("@/domains/tenants/store", () => ({ listActiveTenants: (...a: unknown[]) => listTenantsMock(...a) }));

const runPublishCanaryMock = vi.fn();
vi.mock("@/domains/push/publish-canary", () => ({
  runPublishCanary: (...a: unknown[]) => runPublishCanaryMock(...a),
}));

import { GET } from "./route";

const ORIGINAL_SECRET = process.env.CRON_SECRET;

function req(url: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(new Request(url, { headers }));
}

beforeEach(() => {
  process.env.CRON_SECRET = "test-secret";
  listTenantsMock.mockResolvedValue([{ id: "tenant-a" }, { id: "tenant-b" }]);
  runPublishCanaryMock.mockResolvedValue([
    { tenantId: "tenant-a", row: { tenant_id: "tenant-a", whenIso: "2026-07-02T08:51:00Z", tokenOk: true, urlMapOk: true, dryRunOk: true } },
    { tenantId: "tenant-b", row: { tenant_id: "tenant-b", whenIso: "2026-07-02T08:51:00Z", tokenOk: null, urlMapOk: null, dryRunOk: null } },
  ]);
});
afterEach(() => {
  process.env.CRON_SECRET = ORIGINAL_SECRET;
  vi.clearAllMocks();
});

describe("GET /api/cron/publish-canary - auth guard", () => {
  it("503s when CRON_SECRET is not set", async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(req("https://x.test/api/cron/publish-canary"));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("cron_secret_unset");
    expect(runPublishCanaryMock).not.toHaveBeenCalled();
  });

  it("401s without the bearer token", async () => {
    const res = await GET(req("https://x.test/api/cron/publish-canary"));
    expect(res.status).toBe(401);
    expect(runPublishCanaryMock).not.toHaveBeenCalled();
  });

  it("401s with the wrong bearer token", async () => {
    const res = await GET(req("https://x.test/api/cron/publish-canary", { authorization: "Bearer wrong" }));
    expect(res.status).toBe(401);
    expect(runPublishCanaryMock).not.toHaveBeenCalled();
  });

  it("200s and runs the canary across every tenant with the right bearer token", async () => {
    const res = await GET(req("https://x.test/api/cron/publish-canary", { authorization: "Bearer test-secret" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.results).toHaveLength(2);
    expect(runPublishCanaryMock).toHaveBeenCalledWith(["tenant-a", "tenant-b"]);
  });
});

describe("GET /api/cron/publish-canary - failure isolation", () => {
  it("never 500s the route on a canary-runner throw beyond a clean error response", async () => {
    runPublishCanaryMock.mockRejectedValueOnce(new Error("total outage"));
    const res = await GET(req("https://x.test/api/cron/publish-canary", { authorization: "Bearer test-secret" }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain("total outage");
  });

  it("propagates a listTenants failure as a clean 500, not an unhandled throw", async () => {
    listTenantsMock.mockRejectedValueOnce(new Error("registry down"));
    const res = await GET(req("https://x.test/api/cron/publish-canary", { authorization: "Bearer test-secret" }));
    expect(res.status).toBe(500);
  });
});
