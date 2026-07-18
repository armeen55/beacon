/**
 * /api/cron/precompute per-tenant context (2026-07-11, refresh-reliability BUG 1).
 *
 * Root cause pinned here: the precompute fan-out warmed every tenant inside ONE
 * request. warm-caches resolves its scope (and its cross-tenant guard) from the
 * AMBIENT tenant context, which for the fan-out root is BEACON_TENANT_ID
 * (tenant-ritz-founder). So warming tenant-iranopedia used to resolve ambient =
 * ritz and trip the guard ("the active tenant context is tenant-ritz-founder,
 * not tenant-iranopedia, so we skipped to protect its caches"). Ritz warmed on
 * the same runs because ambient == ritz.
 *
 * The fix wraps each warm in runWithTenant(id, ...), so the REAL currentTenantId
 * resolves to the tenant being warmed. This test uses a warmTenantCaches stub
 * that captures the ambient the REAL resolver returns at warm time, and asserts
 * each tenant warmed under ITS OWN context (never ritz's), while the env
 * fallback stays ritz outside any override (the guard is still protective).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

// No request scope in vitest: headers().get() returns null so the REAL resolver
// falls through to BEACON_TENANT_ID exactly as it does in production cron.
vi.mock("next/headers", () => ({
  headers: async () => ({ get: () => null }),
}));

const state = vi.hoisted(() => ({
  tenants: [
    { id: "tenant-ritz-founder", slug: "ritz-builders" },
    { id: "tenant-iranopedia", slug: "iranopedia" },
  ],
  /** For each warm: the tenant asked for AND the ambient the real resolver saw. */
  warms: [] as Array<{ asked: string; ambient: string }>,
}));

vi.mock("@/domains/tenants/store", () => ({
  listTenants: vi.fn(async () => state.tenants),
  // 2026-07-18 tenant-safety: the route now enumerates via listActiveTenants.
  // The fixture tenants are all treated as active so existing expectations hold.
  listActiveTenants: vi.fn(async () => state.tenants),
  getTenant: (id: string) => ({ id, slug: "stub" }),
  getTenantOrThrow: (id: string) => ({ id, slug: "stub", business_name: "stub" }),
}));

vi.mock("@/domains/ops/warm-caches", () => ({
  pacificDay: (now: Date) =>
    now.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" }),
  // The stub calls the REAL currentTenantId to observe what context it runs in.
  warmTenantCaches: vi.fn(async (tenantId: string) => {
    const { currentTenantId } = await import("@/lib/tenant-context");
    const ambient = await currentTenantId();
    state.warms.push({ asked: tenantId, ambient });
    // Mirror the real guard: ok only when ambient matches the tenant warmed.
    const ok = ambient === tenantId;
    return {
      tenant_id: tenantId,
      date: "2026-07-11",
      ran_at: new Date().toISOString(),
      ok,
      totalMs: 1,
      steps: ok
        ? [{ name: "demand-graph", ok: true, ms: 1 }]
        : [{ name: "tenant-guard", ok: false, ms: 0, skipped: true, note: "skipped" }],
    };
  }),
}));

vi.mock("@/domains/ops/warm-receipt-store", () => ({
  hasWarmRunForDay: vi.fn(async () => false),
  recordWarmRun: vi.fn(async () => {}),
}));

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/domains/ops/cron-runs-store", () => ({
  // Started-row receipt pattern (2026-07-11): the route opens the row with
  // beginCronRun and closes it with finishCronRun. This test only cares about
  // per-tenant warm context, so begin returns a handle and finish is a no-op.
  beginCronRun: vi.fn(async (input: { job: string; startedAt: string }) => ({
    storage: "supabase" as const,
    id: "test-receipt",
    job: input.job,
    tenantId: null,
    startedAt: input.startedAt,
  })),
  finishCronRun: vi.fn(async () => {}),
}));

import { GET } from "@/app/api/cron/precompute/route";

function req(): NextRequest {
  return new NextRequest(new URL("/api/cron/precompute", "https://beacon-bice.vercel.app"), {
    headers: { authorization: "Bearer s3cret" },
  });
}

beforeEach(() => {
  process.env.CRON_SECRET = "s3cret";
  process.env.BEACON_TENANT_ID = "tenant-ritz-founder";
  state.warms = [];
});

describe("precompute warms each tenant under its EXPLICIT context (BUG 1)", () => {
  it("iranopedia warms under iranopedia's context, never ritz's (no guard skip)", async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);

    const iran = state.warms.find((w) => w.asked === "tenant-iranopedia");
    expect(iran).toBeDefined();
    // The exact bug: ambient used to resolve to tenant-ritz-founder here.
    expect(iran!.ambient).toBe("tenant-iranopedia");

    const ritz = state.warms.find((w) => w.asked === "tenant-ritz-founder");
    expect(ritz!.ambient).toBe("tenant-ritz-founder");

    // Both warmed under their own context -> both ok, no protect-its-caches skip.
    const body = await res.json();
    for (const r of body.results) expect(r.ok).toBe(true);
  });

  it("every warm's ambient equals the tenant being warmed (two-tenant isolation)", async () => {
    await GET(req());
    expect(state.warms).toHaveLength(2);
    for (const w of state.warms) expect(w.ambient).toBe(w.asked);
  });
});
