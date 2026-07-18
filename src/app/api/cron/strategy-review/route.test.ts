import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";

const listTenantsMock = vi.fn();
vi.mock("@/domains/tenants/store", () => ({ listActiveTenants: (...a: unknown[]) => listTenantsMock(...a) }));

const hasStrategyMixForWeekMock = vi.fn();
vi.mock("@/domains/strategy-review/strategy-mix-store", () => ({
  hasStrategyMixForWeek: (...a: unknown[]) => hasStrategyMixForWeekMock(...a),
}));

const runStrategyReviewMock = vi.fn();
vi.mock("@/domains/strategy-review/run-strategy-review", () => ({
  runStrategyReview: (...a: unknown[]) => runStrategyReviewMock(...a),
}));

import { GET, mondayOfWeek, isSunday } from "./route";

const ORIGINAL_SECRET = process.env.CRON_SECRET;

function req(url: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(new Request(url, { headers }));
}

beforeEach(() => {
  process.env.CRON_SECRET = "test-secret";
  listTenantsMock.mockResolvedValue([{ id: "tenant-a" }, { id: "tenant-b" }]);
  hasStrategyMixForWeekMock.mockResolvedValue(false);
  runStrategyReviewMock.mockResolvedValue({ ran: true, weekOf: "2026-07-06", record: { source: "llm" } });
});
afterEach(() => {
  process.env.CRON_SECRET = ORIGINAL_SECRET;
  vi.clearAllMocks();
});

describe("mondayOfWeek", () => {
  it("resolves a Sunday to the NEXT day (Monday)", () => {
    // 2026-07-05 is a Sunday (UTC).
    expect(mondayOfWeek(new Date("2026-07-05T22:00:00Z"))).toBe("2026-06-29");
  });

  it("resolves a Wednesday back to that week's Monday", () => {
    expect(mondayOfWeek(new Date("2026-07-08T12:00:00Z"))).toBe("2026-07-06");
  });

  it("resolves a Monday to itself", () => {
    expect(mondayOfWeek(new Date("2026-07-06T00:00:00Z"))).toBe("2026-07-06");
  });
});

describe("isSunday", () => {
  it("is true on a Sunday (UTC)", () => {
    expect(isSunday(new Date("2026-07-05T22:00:00Z"))).toBe(true);
  });
  it("is false on a non-Sunday", () => {
    expect(isSunday(new Date("2026-07-06T22:00:00Z"))).toBe(false);
  });
});

describe("GET /api/cron/strategy-review - auth guard", () => {
  it("503s when CRON_SECRET is not set", async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(req("https://x.test/api/cron/strategy-review"));
    expect(res.status).toBe(503);
    expect(runStrategyReviewMock).not.toHaveBeenCalled();
  });

  it("401s without the bearer token", async () => {
    const res = await GET(req("https://x.test/api/cron/strategy-review"));
    expect(res.status).toBe(401);
    expect(runStrategyReviewMock).not.toHaveBeenCalled();
  });

  it("401s with the wrong bearer token", async () => {
    const res = await GET(req("https://x.test/api/cron/strategy-review", { authorization: "Bearer wrong" }));
    expect(res.status).toBe(401);
  });
});

describe("GET /api/cron/strategy-review - day gate", () => {
  it("skips (ok, no tenant work) on a non-Sunday without force", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-08T12:00:00Z")); // Wednesday
    const res = await GET(req("https://x.test/api/cron/strategy-review", { authorization: "Bearer test-secret" }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.skipped).toBe(true);
    expect(runStrategyReviewMock).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("runs on a non-Sunday when ?force=1 is passed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-08T12:00:00Z"));
    const res = await GET(req("https://x.test/api/cron/strategy-review?force=1", { authorization: "Bearer test-secret" }));
    expect(res.status).toBe(200);
    expect(runStrategyReviewMock).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("runs on a Sunday without force", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-05T22:00:00Z")); // Sunday
    const res = await GET(req("https://x.test/api/cron/strategy-review", { authorization: "Bearer test-secret" }));
    expect(res.status).toBe(200);
    expect(runStrategyReviewMock).toHaveBeenCalled();
    vi.useRealTimers();
  });
});

describe("GET /api/cron/strategy-review - tenant fan-out + idempotency", () => {
  it("calls runStrategyReview once per tenant with the coming week's Monday", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-05T22:00:00Z"));
    await GET(req("https://x.test/api/cron/strategy-review", { authorization: "Bearer test-secret" }));
    expect(runStrategyReviewMock).toHaveBeenCalledTimes(2);
    expect(runStrategyReviewMock).toHaveBeenCalledWith("tenant-a", "2026-07-06", expect.anything());
    expect(runStrategyReviewMock).toHaveBeenCalledWith("tenant-b", "2026-07-06", expect.anything());
    vi.useRealTimers();
  });

  it("skips a tenant that already has a record for the week (per-week idempotency)", async () => {
    hasStrategyMixForWeekMock.mockImplementation(async (tenantId: string) => tenantId === "tenant-a");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-05T22:00:00Z"));
    const res = await GET(req("https://x.test/api/cron/strategy-review", { authorization: "Bearer test-secret" }));
    const body = await res.json();
    expect(runStrategyReviewMock).toHaveBeenCalledTimes(1);
    expect(runStrategyReviewMock).toHaveBeenCalledWith("tenant-b", "2026-07-06", expect.anything());
    const aResult = body.results.find((r: { tenantId: string }) => r.tenantId === "tenant-a");
    expect(aResult.result.reason).toBe("already_ran");
    vi.useRealTimers();
  });

  it("continues past a tenant whose review throws and reports the error for that tenant only", async () => {
    runStrategyReviewMock.mockImplementation(async (tenantId: string) => {
      if (tenantId === "tenant-a") throw new Error("boom");
      return { ran: true, weekOf: "2026-07-06", record: { source: "llm" } };
    });
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-05T22:00:00Z"));
    const res = await GET(req("https://x.test/api/cron/strategy-review", { authorization: "Bearer test-secret" }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.results).toHaveLength(2);
    const aResult = body.results.find((r: { tenantId: string }) => r.tenantId === "tenant-a");
    expect(aResult.result.reason).toContain("error");
    const bResult = body.results.find((r: { tenantId: string }) => r.tenantId === "tenant-b");
    expect(bResult.result.ran).toBe(true);
    vi.useRealTimers();
  });
});
