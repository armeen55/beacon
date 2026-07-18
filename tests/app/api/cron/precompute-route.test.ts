/**
 * /api/cron/precompute auth + idempotency (2026-07-02, BEACON 500 item 13).
 *
 * Pins the fail-closed CRON_SECRET contract (identical to measure-due), the
 * Iranopedia-first tenant order, the run-marker skip (double-fire = cheap
 * no-op, warm NOT invoked), the receipt-only-marks-success posture, and the
 * per-tenant fail-soft isolation.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const state = vi.hoisted(() => ({
  tenants: [
    { id: "tenant-ritz-founder", slug: "ritz-builders" },
    { id: "tenant-iranopedia", slug: "iranopedia" },
  ],
  warmed: [] as string[],
  recorded: [] as Array<{ tenant_id: string; ok: boolean }>,
  /** Every finishCronRun call for the precompute job (the run-level ledger row
   *  whose `ok` the health panel + summary strip read). The route now opens the
   *  row with beginCronRun and closes it with finishCronRun; the finish call is
   *  what carries the run `ok` and notes. */
  cronRuns: [] as Array<{ ok: boolean; notes: Record<string, unknown> }>,
  hasRun: false,
  /** "all" = every tenant's warm throws; "core-only" = only Iranopedia throws;
   *  "noncore-only" = only Ritz (non-core) throws; false = all succeed. */
  warmFails: false as false | "all" | "core-only" | "noncore-only",
}));

vi.mock("@/domains/tenants/store", () => ({
  listTenants: vi.fn(async () => state.tenants),
  // 2026-07-18 tenant-safety: the route now enumerates via listActiveTenants.
  // The fixture tenants are all treated as active so existing expectations hold.
  listActiveTenants: vi.fn(async () => state.tenants),
}));

vi.mock("@/domains/ops/warm-caches", () => ({
  pacificDay: (now: Date) => now.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" }),
  warmTenantCaches: vi.fn(async (tenantId: string) => {
    state.warmed.push(tenantId);
    const isCore = tenantId === "tenant-iranopedia";
    const shouldFail =
      state.warmFails === "all" ||
      (state.warmFails === "core-only" && isCore) ||
      (state.warmFails === "noncore-only" && !isCore);
    if (shouldFail) throw new Error("warm blew up");
    return {
      tenant_id: tenantId,
      date: "2026-07-02",
      ran_at: new Date().toISOString(),
      ok: true,
      totalMs: 5,
      steps: [{ name: "demand-graph", ok: true, ms: 5 }],
    };
  }),
}));

vi.mock("@/domains/ops/warm-receipt-store", () => ({
  hasWarmRunForDay: vi.fn(async () => state.hasRun),
  recordWarmRun: vi.fn(async (r: { tenant_id: string; ok: boolean }) => {
    state.recorded.push({ tenant_id: r.tenant_id, ok: r.ok });
  }),
}));

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/domains/ops/cron-runs-store", () => ({
  // Started-row receipt pattern (2026-07-11): beginCronRun opens the row before
  // any work, finishCronRun closes it with the run `ok` + notes. The finish call
  // is the run-level ledger row the health panel + summary strip read.
  beginCronRun: vi.fn(async (input: { job: string; startedAt: string }) => ({
    storage: "supabase" as const,
    id: "test-receipt",
    job: input.job,
    tenantId: null,
    startedAt: input.startedAt,
  })),
  finishCronRun: vi.fn(
    async (_receipt: unknown, input: { ok: boolean; notes?: Record<string, unknown> }) => {
      state.cronRuns.push({ ok: input.ok, notes: input.notes ?? {} });
    },
  ),
}));

import { GET } from "@/app/api/cron/precompute/route";

function req(auth?: string): NextRequest {
  return new NextRequest(new URL("/api/cron/precompute", "https://beacon-bice.vercel.app"), {
    headers: auth ? { authorization: auth } : {},
  });
}

beforeEach(() => {
  process.env.CRON_SECRET = "s3cret";
  state.warmed = [];
  state.recorded = [];
  state.cronRuns = [];
  state.hasRun = false;
  state.warmFails = false;
});

describe("GET /api/cron/precompute", () => {
  it("503 when CRON_SECRET is unset (fail-closed, nothing runs)", async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(req("Bearer whatever"));
    expect(res.status).toBe(503);
    expect(state.warmed).toEqual([]);
  });

  it("401 on a missing or wrong bearer (nothing runs)", async () => {
    expect((await GET(req())).status).toBe(401);
    expect((await GET(req("Bearer wrong"))).status).toBe(401);
    expect(state.warmed).toEqual([]);
  });

  it("200 with the right bearer; Iranopedia warms FIRST; receipts recorded", async () => {
    const res = await GET(req("Bearer s3cret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(state.warmed).toEqual(["tenant-iranopedia", "tenant-ritz-founder"]);
    expect(state.recorded.map((r) => r.tenant_id)).toEqual([
      "tenant-iranopedia",
      "tenant-ritz-founder",
    ]);
  });

  it("run-marker idempotency: an already-warmed day skips the warm entirely", async () => {
    state.hasRun = true;
    const res = await GET(req("Bearer s3cret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(state.warmed).toEqual([]);
    expect(state.recorded).toEqual([]); // the skip never overwrites the real receipt
    for (const r of body.results) {
      expect(r.steps[0].name).toBe("run-marker");
      expect(r.steps[0].skipped).toBe(true);
    }
  });

  it("fail-soft per tenant: one tenant blowing up never stops the next", async () => {
    state.warmFails = "core-only";
    const res = await GET(req("Bearer s3cret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(state.warmed).toEqual(["tenant-iranopedia", "tenant-ritz-founder"]);
    const iran = body.results.find((r: { tenant_id: string }) => r.tenant_id === "tenant-iranopedia");
    expect(iran.ok).toBe(false);
    const ritz = body.results.find((r: { tenant_id: string }) => r.tenant_id === "tenant-ritz-founder");
    expect(ritz.ok).toBe(true);
  });

  // Per-tenant independence (2026-07-06): the run-level ledger `ok` (what the
  // health panel + summary strip read) must NOT go red just because a non-core
  // tenant's warm failed - as long as the core tenant (Iranopedia, warmed
  // first) succeeded. Before this, `results.every(ok)` let one non-core failure
  // mask that the core was fully warm.
  it("run stays ok when only a NON-core tenant's warm fails (core succeeded)", async () => {
    state.warmFails = "noncore-only"; // Ritz fails, Iranopedia (core) succeeds
    await GET(req("Bearer s3cret"));
    expect(state.cronRuns).toHaveLength(1);
    const run = state.cronRuns[0]!;
    expect(run.ok).toBe(true); // NOT red - the core warmed
    expect(run.notes.coreOk).toBe(true);
    expect(run.notes.degradedTenants).toBe(1); // Ritz flagged as degraded, not a red run
  });

  it("run goes red only when the CORE tenant's warm fails", async () => {
    state.warmFails = "core-only"; // Iranopedia (core) fails
    await GET(req("Bearer s3cret"));
    expect(state.cronRuns).toHaveLength(1);
    const run = state.cronRuns[0]!;
    expect(run.ok).toBe(false); // red - the core did not warm
    expect(run.notes.coreOk).toBe(false);
  });

  it("all-healthy run records ok=true (byte-identical to the healthy baseline)", async () => {
    await GET(req("Bearer s3cret"));
    expect(state.cronRuns).toHaveLength(1);
    const run = state.cronRuns[0]!;
    expect(run.ok).toBe(true);
    expect(run.notes.coreOk).toBe(true);
    expect(run.notes.degradedTenants).toBe(0);
  });

  it("dash guard: route responses carry no em/en dashes", async () => {
    const res = await GET(req("Bearer s3cret"));
    expect(JSON.stringify(await res.json())).not.toMatch(/[–—]/);
  });
});
