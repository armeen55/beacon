import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";

const listTenantsMock = vi.fn();
vi.mock("@/domains/tenants/store", () => ({ listTenants: (...a: unknown[]) => listTenantsMock(...a) }));

const hasFactoryBatchForWeekMock = vi.fn();
vi.mock("@/domains/page-factory/batch-store", () => ({
  hasFactoryBatchForWeek: (...a: unknown[]) => hasFactoryBatchForWeekMock(...a),
}));

const runProductionLineForTenantMock = vi.fn();
vi.mock("@/domains/page-factory/production-line", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/domains/page-factory/production-line")>();
  return { ...actual, runProductionLineForTenant: (...a: unknown[]) => runProductionLineForTenantMock(...a) };
});

import { GET, isMonday } from "./route";

const ORIGINAL_SECRET = process.env.CRON_SECRET;
const RITZ_TENANT_ID = "tenant-ritz-founder";

function req(url: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(new Request(url, { headers }));
}

beforeEach(() => {
  process.env.CRON_SECRET = "test-secret";
  listTenantsMock.mockResolvedValue([{ id: "tenant-a" }, { id: "tenant-b" }]);
  hasFactoryBatchForWeekMock.mockResolvedValue(false);
  runProductionLineForTenantMock.mockResolvedValue({
    tenantId: "x",
    weekOf: "2026-07-06",
    ran: true,
    reason: "ok",
    drafted: 3,
    queued: 2,
    rejected: 1,
    costUsd: 0.18,
    batch: null,
  });
});
afterEach(() => {
  process.env.CRON_SECRET = ORIGINAL_SECRET;
  vi.clearAllMocks();
});

describe("isMonday", () => {
  it("is true on a Monday (UTC)", () => {
    expect(isMonday(new Date("2026-07-06T10:00:00Z"))).toBe(true);
  });
  it("is false on a non-Monday", () => {
    expect(isMonday(new Date("2026-07-08T10:00:00Z"))).toBe(false);
  });
});

describe("GET /api/cron/page-factory - auth guard", () => {
  it("503s when CRON_SECRET is not set", async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(req("https://x.test/api/cron/page-factory"));
    expect(res.status).toBe(503);
    expect(runProductionLineForTenantMock).not.toHaveBeenCalled();
  });

  it("401s without the bearer token", async () => {
    const res = await GET(req("https://x.test/api/cron/page-factory"));
    expect(res.status).toBe(401);
    expect(runProductionLineForTenantMock).not.toHaveBeenCalled();
  });

  it("401s with the wrong bearer token", async () => {
    const res = await GET(req("https://x.test/api/cron/page-factory", { authorization: "Bearer wrong" }));
    expect(res.status).toBe(401);
  });
});

describe("GET /api/cron/page-factory - day gate", () => {
  it("skips (ok, no tenant work) on a non-Monday without force", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-08T12:00:00Z")); // Wednesday
    const res = await GET(req("https://x.test/api/cron/page-factory", { authorization: "Bearer test-secret" }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.skipped).toBe(true);
    expect(runProductionLineForTenantMock).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("runs on a non-Monday when ?force=1 is passed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-08T12:00:00Z"));
    const res = await GET(req("https://x.test/api/cron/page-factory?force=1", { authorization: "Bearer test-secret" }));
    expect(res.status).toBe(200);
    expect(runProductionLineForTenantMock).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("runs on a Monday without force", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-06T10:00:00Z")); // Monday
    const res = await GET(req("https://x.test/api/cron/page-factory", { authorization: "Bearer test-secret" }));
    expect(res.status).toBe(200);
    expect(runProductionLineForTenantMock).toHaveBeenCalled();
    vi.useRealTimers();
  });
});

describe("GET /api/cron/page-factory - tenant fan-out + idempotency", () => {
  it("calls runProductionLineForTenant once per tenant with the same Monday's weekOf", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-06T10:00:00Z"));
    await GET(req("https://x.test/api/cron/page-factory", { authorization: "Bearer test-secret" }));
    expect(runProductionLineForTenantMock).toHaveBeenCalledTimes(2);
    expect(runProductionLineForTenantMock).toHaveBeenCalledWith("tenant-a", "2026-07-06", expect.anything());
    expect(runProductionLineForTenantMock).toHaveBeenCalledWith("tenant-b", "2026-07-06", expect.anything());
    vi.useRealTimers();
  });

  it("skips a tenant that already has a batch for the week (per-week idempotency)", async () => {
    hasFactoryBatchForWeekMock.mockImplementation(async (tenantId: string) => tenantId === "tenant-a");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-06T10:00:00Z"));
    const res = await GET(req("https://x.test/api/cron/page-factory", { authorization: "Bearer test-secret" }));
    const body = await res.json();
    expect(runProductionLineForTenantMock).toHaveBeenCalledTimes(1);
    expect(runProductionLineForTenantMock).toHaveBeenCalledWith("tenant-b", "2026-07-06", expect.anything());
    const aResult = body.results.find((r: { tenantId: string }) => r.tenantId === "tenant-a");
    expect(aResult.result.reason).toBe("already_ran");
    vi.useRealTimers();
  });

  it("continues past a tenant whose run throws and reports the error for that tenant only", async () => {
    runProductionLineForTenantMock.mockImplementation(async (tenantId: string) => {
      if (tenantId === "tenant-a") throw new Error("boom");
      return { tenantId, weekOf: "2026-07-06", ran: true, reason: "ok", drafted: 1, queued: 0, rejected: 0, costUsd: 0.03, batch: null };
    });
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-06T10:00:00Z"));
    const res = await GET(req("https://x.test/api/cron/page-factory", { authorization: "Bearer test-secret" }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.results).toHaveLength(2);
    const aResult = body.results.find((r: { tenantId: string }) => r.tenantId === "tenant-a");
    expect(aResult.result.reason).toContain("error");
    const bResult = body.results.find((r: { tenantId: string }) => r.tenantId === "tenant-b");
    expect(bResult.result.ran).toBe(true);
    vi.useRealTimers();
  });

  it("still fans out to Ritz alongside every other tenant (staging only, never a publish) - the live-write guard lives in executePush/auto-record, not here", async () => {
    listTenantsMock.mockResolvedValue([{ id: RITZ_TENANT_ID }]);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-06T10:00:00Z"));
    await GET(req("https://x.test/api/cron/page-factory", { authorization: "Bearer test-secret" }));
    expect(runProductionLineForTenantMock).toHaveBeenCalledWith(RITZ_TENANT_ID, "2026-07-06", expect.anything());
    vi.useRealTimers();
  });
});
