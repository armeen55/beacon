import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], history: [] as Array<Record<string, unknown>>, patches: [] as Record<string, unknown>[] }));
vi.mock("@/lib/connector-store", () => ({
  getGoogleConnectorToken: async () => ({ access_token: "token", refresh_token: "refresh", expires_at: Date.parse("2099-01-01"), scopes: ["https://www.googleapis.com/auth/analytics.readonly"], ga4_property_id: "123", connected_at: "2026-01-01" }),
  updateConnectorToken: async (_p: string, patch: Record<string, unknown>) => { state.patches.push(patch); }, persistRefreshedGoogleToken: async () => {}, getConnectorInfo: async () => ({ status: "connected" }),
}));
vi.mock("@/domains/account", () => ({ getTenant: async () => ({}), websiteOf: () => ({ domain: "example.com" }) }));
vi.mock("@/lib/persistence/supabase", () => ({ getSupabaseAdmin: () => ({ from: () => ({ upsert: async (rows: Record<string, unknown>[]) => { state.rows.push(...rows); return { error: null }; } }) }) }));
vi.mock("@/domains/runtime/ops/refresh-runs-store", () => ({
  listRecentRefreshRuns: async () => state.history, deriveSyncFailureEscalation: () => ({ escalate: false }),
}));
import { syncGa4UrlTrafficForTenant } from "@/lib/connectors/ga4/sync-url-traffic";
afterEach(() => { vi.unstubAllGlobals(); state.rows = []; state.history = []; state.patches = []; });

it("saves a later-page failure as partial, never requests revenue, and holds an unchanged automatic replay", async () => {
  const firstPage = { rowCount: 10001, rows: Array.from({ length: 10000 }, (_, i) => ({ dimensionValues: [{ value: "20260901" }, { value: `/p-${i}` }], metricValues: [{ value: "1" }, { value: "1" }, { value: "0" }] })) };
  const requests: Array<Record<string, unknown>> = [];
  let failManual = false;
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>; requests.push(body);
    return !failManual && Number(body.offset) === 0 ? new Response(JSON.stringify(firstPage), { status: 200 }) : new Response("unavailable", { status: 503 });
  }));
  const partial = await syncGa4UrlTrafficForTenant({ tenantId: "tenant-a", now: new Date("2026-09-22") });
  expect(partial).toMatchObject({ synced: false, reason: "partial_report", truncated: true, rows_upserted: 10000 });
  expect(state.patches).toEqual([{ auth_failed_at: null }]);
  const ledger = await vi.importActual<typeof import("@/domains/runtime/ops/refresh-runs-store")>("@/domains/runtime/ops/refresh-runs-store");
  expect(ledger.classifyRefreshOutcome("ga4", partial)).toMatchObject({ result: "partial", rowsPersisted: 10000 });
  expect([state.rows.length, requests.map((r) => r.offset), requests.every((r) => (r.metrics as Array<{ name: string }>).every((m) => m.name !== "totalRevenue"))]).toEqual([10000, [0, 10000], true]);
  state.history = [{ result: "partial", failure_category: "partial_report" }];
  expect(await syncGa4UrlTrafficForTenant({ tenantId: "tenant-a" })).toEqual({ synced: false, reason: "partial_report_held" });
  expect(requests).toHaveLength(2);
  failManual = true;
  expect(await syncGa4UrlTrafficForTenant({ tenantId: "tenant-a", manualRetry: true })).toEqual({ synced: false, reason: "api_error" });
  state.history = [{ result: "failed", failure_category: "api_error" }, ...state.history];
  expect(await syncGa4UrlTrafficForTenant({ tenantId: "tenant-a" })).toEqual({ synced: false, reason: "partial_report_held" });
  expect(requests).toHaveLength(3);
});
