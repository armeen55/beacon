/**
 * gatherPipelineReadings collector (2026-07-02, master plan item 10).
 *
 * Mocked-reads mapping test: connector flags land on the right source keys,
 * table counts/watermarks land on the right table keys with the right
 * timestamp columns, the plan candidate count sums selected + backups, the
 * demand-graph counts come from the SWR snapshot (never a rebuild), and every
 * failed read degrades to null instead of throwing.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── connector store ─────────────────────────────────────────────────
const connectorInfoMock = vi.fn();
vi.mock("@/lib/connector-store", () => ({
  getConnectorInfo: (provider: string, tenantId: string) => connectorInfoMock(provider, tenantId),
}));

// ── supabase admin (query-builder stub) ─────────────────────────────
type TableBehavior = {
  count?: number | null;
  countError?: boolean;
  latest?: string | null;
  latestError?: boolean;
};
let tableBehaviors: Record<string, TableBehavior> = {};
let supabaseConfigured = true;
const seenQueries: Array<{ table: string; column: string; kind: "count" | "watermark"; tenantId: string }> = [];

function makeBuilder(table: string, column: string, opts?: { count?: string; head?: boolean }) {
  const behavior = tableBehaviors[table] ?? {};
  const isCount = opts?.head === true;
  const chain = {
    eq(_col: string, tenantId: string) {
      chain._tenantId = tenantId;
      return chain;
    },
    gte() {
      seenQueries.push({ table, column, kind: "count", tenantId: chain._tenantId });
      if (behavior.countError) return Promise.resolve({ count: null, error: { message: "boom" } });
      return Promise.resolve({ count: behavior.count ?? 0, error: null });
    },
    order() {
      return chain;
    },
    limit() {
      seenQueries.push({ table, column, kind: "watermark", tenantId: chain._tenantId });
      if (behavior.latestError) return Promise.resolve({ data: null, error: { message: "boom" } });
      const rows = behavior.latest != null ? [{ [column]: behavior.latest }] : [];
      return Promise.resolve({ data: rows, error: null });
    },
    _tenantId: "",
    _isCount: isCount,
  };
  return chain;
}
vi.mock("@/lib/persistence/supabase", () => ({
  isSupabaseConfigured: () => supabaseConfigured,
  getSupabaseAdmin: () => ({
    from: (table: string) => ({
      select: (column: string, opts?: { count?: string; head?: boolean }) => makeBuilder(table, column, opts),
    }),
  }),
}));

// ── daily plan store ────────────────────────────────────────────────
const listPlansMock = vi.fn();
vi.mock("@/domains/experiments/daily-experiment-plan-store", () => ({
  listPlans: (tenantId: string, limit: number) => listPlansMock(tenantId, limit),
}));

// ── demand-graph SWR snapshot (must never rebuild) ──────────────────
const readGraphSnapshotMock = vi.fn();
vi.mock("@/domains/demand-graph/graph-snapshot-store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/domains/demand-graph/graph-snapshot-store")>();
  return {
    ...original,
    readGraphSnapshot: () => readGraphSnapshotMock(),
  };
});

// ── ambient tenant (guards the snapshot read) ───────────────────────
let ambientTenantId = "tenant-test";
vi.mock("@/lib/tenant-context", () => ({
  currentTenantId: async () => ambientTenantId,
}));

import { gatherPipelineReadings } from "./pipeline-readings";
import { GRAPH_SCHEMA_VERSION } from "@/domains/demand-graph/graph-snapshot-store";

const NOW = new Date("2026-07-02T12:00:00.000Z");
const T = "tenant-test";

function connectedInfo(lastSyncedAt: string | null) {
  return { status: "connected", connected_at: "2026-06-01T00:00:00Z", expires_at: null, last_synced_at: lastSyncedAt };
}

beforeEach(() => {
  vi.clearAllMocks();
  seenQueries.length = 0;
  supabaseConfigured = true;
  ambientTenantId = T;
  tableBehaviors = {
    gsc_daily_rows: { count: 1200, latest: "2026-07-02T09:00:00Z" },
    ga4_url_traffic: { count: 300, latest: "2026-07-02T08:00:00Z" },
    ga4_ai_referral_daily: { count: 4, latest: "2026-07-01T08:00:00Z" },
    profound_citation_rows: { count: 900, latest: "2026-07-02T07:00:00Z" },
    prompt_answer_observations: { count: 40, latest: "2026-07-01T07:00:00Z" },
  };
  connectorInfoMock.mockImplementation(async (provider: string) => {
    if (provider === "google_gsc") return connectedInfo("2026-07-02T09:05:00Z");
    if (provider === "google_ga4") return connectedInfo("2026-07-02T08:05:00Z");
    return { status: "disconnected", connected_at: null, expires_at: null, last_synced_at: null };
  });
  listPlansMock.mockResolvedValue([
    { createdAt: "2026-07-02T05:00:00Z", selected: [{}, {}, {}], backups: [{}] },
  ]);
  readGraphSnapshotMock.mockResolvedValue({
    schemaVersion: GRAPH_SCHEMA_VERSION,
    computedAt: "2026-07-02T06:00:00Z",
    data: { graph: { demandNodes: [{}, {}], pageNodes: [{}], moves: [{}, {}, {}] }, coverage: {} },
  });
});

describe("gatherPipelineReadings mapping", () => {
  it("maps connectors, tables, plan, and graph onto the readings shape", async () => {
    const readings = await gatherPipelineReadings(T, NOW);

    expect(readings.tenantId).toBe(T);
    expect(readings.checkedAt).toBe(NOW.toISOString());
    expect(readings.recentWindowHours).toBe(36);

    expect(readings.connectors.gsc).toEqual({ connected: true, lastSyncedAt: "2026-07-02T09:05:00Z" });
    expect(readings.connectors.ga4).toEqual({ connected: true, lastSyncedAt: "2026-07-02T08:05:00Z" });
    expect(readings.connectors.profound).toEqual({ connected: false, lastSyncedAt: null });

    expect(readings.tables.gsc_daily_rows).toEqual({ recentRows: 1200, latestRowAt: "2026-07-02T09:00:00Z" });
    expect(readings.tables.ga4_url_traffic).toEqual({ recentRows: 300, latestRowAt: "2026-07-02T08:00:00Z" });
    expect(readings.tables.profound_citation_rows).toEqual({ recentRows: 900, latestRowAt: "2026-07-02T07:00:00Z" });
    expect(readings.tables.ga4_ai_referral_daily.recentRows).toBe(4);
    expect(readings.tables.prompt_answer_observations.recentRows).toBe(40);

    expect(readings.dailyPlan).toEqual({ hasPlan: true, candidateCount: 4, planCreatedAt: "2026-07-02T05:00:00Z" });
    expect(readings.demandGraph).toEqual({ nodes: 2, moves: 3 });
  });

  it("asks each table with its own timestamp column and the tenant filter", async () => {
    await gatherPipelineReadings(T, NOW);
    const byTable = Object.fromEntries(seenQueries.map((q) => [`${q.table}:${q.kind}`, q]));
    expect(byTable["gsc_daily_rows:count"]!.column).toBe("pulled_at");
    expect(byTable["ga4_url_traffic:count"]!.column).toBe("last_synced_at");
    expect(byTable["ga4_ai_referral_daily:count"]!.column).toBe("last_synced_at");
    expect(byTable["profound_citation_rows:watermark"]!.column).toBe("pulled_at");
    expect(byTable["prompt_answer_observations:watermark"]!.column).toBe("observed_at");
    for (const q of seenQueries) expect(q.tenantId).toBe(T);
  });

  it("connector providers queried are exactly gsc/ga4/profound for this tenant", async () => {
    await gatherPipelineReadings(T, NOW);
    const providers = connectorInfoMock.mock.calls.map((c) => c[0]).sort();
    expect(providers).toEqual(["google_ga4", "google_gsc", "profound"]);
    for (const call of connectorInfoMock.mock.calls) expect(call[1]).toBe(T);
  });
});

describe("gatherPipelineReadings fail-soft", () => {
  it("a throwing connector read lands as connected: null", async () => {
    connectorInfoMock.mockRejectedValue(new Error("network down"));
    const readings = await gatherPipelineReadings(T, NOW);
    expect(readings.connectors.gsc).toEqual({ connected: null, lastSyncedAt: null });
  });

  it("a failed count lands as recentRows null; a failed watermark as latestRowAt null", async () => {
    tableBehaviors.gsc_daily_rows = { countError: true, latest: "2026-07-02T09:00:00Z" };
    tableBehaviors.ga4_url_traffic = { count: 300, latestError: true };
    const readings = await gatherPipelineReadings(T, NOW);
    expect(readings.tables.gsc_daily_rows).toEqual({ recentRows: null, latestRowAt: "2026-07-02T09:00:00Z" });
    expect(readings.tables.ga4_url_traffic).toEqual({ recentRows: 300, latestRowAt: null });
  });

  it("no Supabase env means every table reading is null (never a throw)", async () => {
    supabaseConfigured = false;
    const readings = await gatherPipelineReadings(T, NOW);
    for (const t of Object.values(readings.tables)) {
      expect(t).toEqual({ recentRows: null, latestRowAt: null });
    }
  });

  it("a throwing plan store lands as dailyPlan null; an empty list as hasPlan false", async () => {
    listPlansMock.mockRejectedValue(new Error("plans down"));
    expect((await gatherPipelineReadings(T, NOW)).dailyPlan).toBeNull();
    listPlansMock.mockResolvedValue([]);
    expect((await gatherPipelineReadings(T, NOW)).dailyPlan).toEqual({ hasPlan: false, candidateCount: 0, planCreatedAt: null });
  });

  it("skips the graph snapshot when the ambient tenant does not match (never misfiles)", async () => {
    ambientTenantId = "tenant-other";
    const readings = await gatherPipelineReadings(T, NOW);
    expect(readings.demandGraph).toBeNull();
    expect(readGraphSnapshotMock).not.toHaveBeenCalled();
  });

  it("an invalid or missing snapshot lands as demandGraph null", async () => {
    readGraphSnapshotMock.mockResolvedValue(null);
    expect((await gatherPipelineReadings(T, NOW)).demandGraph).toBeNull();
    readGraphSnapshotMock.mockResolvedValue({ schemaVersion: -1, computedAt: "x", data: {} });
    expect((await gatherPipelineReadings(T, NOW)).demandGraph).toBeNull();
  });
});
