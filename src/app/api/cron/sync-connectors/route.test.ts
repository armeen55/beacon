import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import type { CronRunHandle } from "@/domains/ops/cron-runs-store";

// Records the order of the two things that matter: the invocation receipt must
// exist BEFORE any sync work runs, so the deadman can tell "never fired" from
// "fired but died mid-run".
const calls: string[] = [];
const HANDLE: CronRunHandle = { storage: "supabase", id: "42", job: "sync-connectors", tenantId: null, startedAt: "x" };

const beginCronRun = vi.fn(async (..._a: unknown[]): Promise<CronRunHandle> => {
  calls.push("begin");
  return HANDLE;
});
const finishCronRun = vi.fn(async (..._a: unknown[]) => {
  calls.push("finish");
});
vi.mock("@/domains/ops/cron-runs-store", () => ({
  beginCronRun: (...a: unknown[]) => beginCronRun(...a),
  finishCronRun: (...a: unknown[]) => finishCronRun(...a),
}));

const syncMock = vi.fn(async (..._a: unknown[]) => {
  calls.push("sync");
  return healthyResult();
});
vi.mock("@/lib/connectors/cron-sync", () => ({
  syncAllConnectedForActiveTenants: (...a: unknown[]) => syncMock(...a),
}));

const recordAppErrorMock = vi.fn(async (..._a: unknown[]) => {});
vi.mock("@/lib/obs/error-ledger", () => ({
  recordAppError: (...a: unknown[]) => recordAppErrorMock(...a),
  errorFieldsFrom: () => ({}),
}));

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { GET } from "./route";

function healthyResult(over: Record<string, unknown> = {}) {
  return {
    ranAt: "2026-07-12T09:00:00.000Z",
    tenants: 2,
    connectedSources: 4,
    ok: 4,
    failed: 0,
    health: { state: "healthy", degraded: 0, broken: 0 },
    results: [],
    ...over,
  };
}

const ORIGINAL_SECRET = process.env.CRON_SECRET;

function req(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(new Request("https://x.test/api/cron/sync-connectors", { headers }));
}

beforeEach(() => {
  process.env.CRON_SECRET = "test-secret";
  calls.length = 0;
  syncMock.mockImplementation(async (_receipt?: unknown) => {
    calls.push("sync");
    return healthyResult();
  });
});
afterEach(() => {
  process.env.CRON_SECRET = ORIGINAL_SECRET;
  vi.clearAllMocks();
});

describe("GET /api/cron/sync-connectors - auth guard leaves no receipt", () => {
  it("503s when CRON_SECRET is unset and never begins a receipt", async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(req());
    expect(res.status).toBe(503);
    expect(beginCronRun).not.toHaveBeenCalled();
  });

  it("401s without the bearer token and never begins a receipt", async () => {
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(beginCronRun).not.toHaveBeenCalled();
  });
});

describe("GET /api/cron/sync-connectors - invocation receipt", () => {
  it("begins the receipt BEFORE any sync work runs, and hands it to the sync", async () => {
    const res = await GET(req({ authorization: "Bearer test-secret" }));
    expect(res.status).toBe(200);
    // The started receipt must exist before the sync begins.
    expect(calls).toEqual(["begin", "sync"]);
    // The sync receives the same handle so it FINISHES that row (no second row).
    expect(syncMock).toHaveBeenCalledWith(HANDLE);
    // On success the sync owns the finish; the route does not double-finish.
    expect(finishCronRun).not.toHaveBeenCalled();
  });

  it("finishes the receipt as failed when the sync throws before finishing its own", async () => {
    syncMock.mockImplementationOnce(async () => {
      calls.push("sync");
      throw new Error("total outage");
    });
    const res = await GET(req({ authorization: "Bearer test-secret" }));
    expect(res.status).toBe(500);
    expect(calls).toEqual(["begin", "sync", "finish"]);
    expect(finishCronRun).toHaveBeenCalledWith(
      HANDLE,
      expect.objectContaining({ ok: false }),
    );
    expect(recordAppErrorMock).toHaveBeenCalled();
  });

  it("returns 207 for known degradation instead of lying with ok true", async () => {
    syncMock.mockImplementationOnce(async () => {
      calls.push("sync");
      return healthyResult({
        ok: 3,
        failed: 1,
        health: { state: "degraded", degraded: 1, broken: 0 },
      });
    });
    const res = await GET(req({ authorization: "Bearer test-secret" }));
    expect(res.status).toBe(207);
    expect(await res.json()).toMatchObject({ ok: false, state: "degraded" });
  });

  it("returns 500 when any unexpected connector failure breaks the run", async () => {
    syncMock.mockImplementationOnce(async () => {
      calls.push("sync");
      return healthyResult({
        ok: 3,
        failed: 1,
        health: { state: "broken", degraded: 0, broken: 1 },
      });
    });
    const res = await GET(req({ authorization: "Bearer test-secret" }));
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ ok: false, state: "broken" });
  });

  it.each([
    ["no active tenants", { tenants: 0, connectedSources: 0 }, "no_active_tenants"],
    ["no connected sources", { tenants: 2, connectedSources: 0 }, "no_connected_sources"],
  ])("returns 503 for %s", async (_label, over, error) => {
    syncMock.mockImplementationOnce(async () => {
      calls.push("sync");
      return healthyResult(over);
    });
    const res = await GET(req({ authorization: "Bearer test-secret" }));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, state: "misconfigured", error });
  });

  it("returns 503 when the invocation receipt fell back to ephemeral file storage", async () => {
    beginCronRun.mockImplementationOnce(async () => {
      calls.push("begin");
      return { ...HANDLE, storage: "file" as const };
    });
    const res = await GET(req({ authorization: "Bearer test-secret" }));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, state: "misconfigured", error: "receipt_not_durable" });
  });
});
