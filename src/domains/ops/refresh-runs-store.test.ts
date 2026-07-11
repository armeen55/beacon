import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── In-memory file-store mock (the fallback path) ───────────────────────────
let fileRows: Record<string, unknown>[] = [];
vi.mock("@/lib/persistence/json-store", () => ({
  readStore: async () => fileRows,
  writeStore: async (_name: string, data: unknown[]) => {
    fileRows = data as Record<string, unknown>[];
  },
}));

// ── Supabase admin mock, toggled per test ───────────────────────────────────
let supabaseThrows = false;
let forceError: { code?: string; message: string } | null = null;
let insertedRows: Record<string, unknown>[] = [];

vi.mock("@/lib/persistence/supabase", () => ({
  getSupabaseAdmin: () => {
    if (supabaseThrows) throw new Error("no supabase env");
    return {
      from: () => ({
        insert: vi.fn(async (row: Record<string, unknown>) => {
          if (forceError) return { error: forceError };
          insertedRows.push(row);
          return { error: null };
        }),
      }),
    };
  },
}));

import {
  recordRefreshRun,
  listRecentRefreshRuns,
  latestRefreshBySource,
  buildRefreshRunRow,
  classifyRefreshOutcome,
  __testing,
} from "./refresh-runs-store";
import { classifyStore } from "@/lib/persistence/store-classification";

beforeEach(() => {
  fileRows = [];
  insertedRows = [];
  supabaseThrows = false;
  forceError = null;
});

describe("buildRefreshRunRow (pure)", () => {
  it("computes duration_ms and carries every field", () => {
    const row = buildRefreshRunRow(
      {
        tenantId: "tenant-a",
        source: "gsc",
        trigger: "cron",
        startedAt: "2026-07-11T00:00:00.000Z",
        finishedAt: "2026-07-11T00:00:05.000Z",
        result: "ok",
        rowsPersisted: 42,
        latestDataDate: "2026-07-08",
        failureCategory: null,
        nextRetryAt: "2026-07-12T00:00:00.000Z",
      },
      "id-1",
    );
    expect(row.duration_ms).toBe(5000);
    expect(row.result).toBe("ok");
    expect(row.rows_persisted).toBe(42);
    expect(row.latest_data_date).toBe("2026-07-08");
    expect(row.next_retry_at).toBe("2026-07-12T00:00:00.000Z");
  });

  it("negative durations clamp to 0", () => {
    expect(__testing.durationMs("2026-07-11T00:00:05Z", "2026-07-11T00:00:00Z")).toBe(0);
  });
});

describe("classifyRefreshOutcome (pure)", () => {
  it("a not-synced result is failed with the engine reason", () => {
    const c = classifyRefreshOutcome("gsc", { synced: false, reason: "gsc_auth_transient" });
    expect(c).toEqual({ result: "failed", rowsPersisted: null, failureCategory: "gsc_auth_transient" });
  });

  it("a synced GSC run with rows is ok (0 new rows stays ok - normal incremental night)", () => {
    expect(classifyRefreshOutcome("gsc", { synced: true, rows_upserted: 12 })).toEqual({
      result: "ok",
      rowsPersisted: 12,
      failureCategory: null,
    });
    // GSC/GA4/Clarity legitimately write 0 rows on a quiet night: still ok.
    expect(classifyRefreshOutcome("gsc", { synced: true, rows_upserted: 0 }).result).toBe("ok");
    expect(classifyRefreshOutcome("ga4", { synced: true, rows_upserted: 0 }).result).toBe("ok");
  });

  it("Profound synced with 0 rows is the silent partial (no new data)", () => {
    const c = classifyRefreshOutcome("profound", {
      synced: true,
      citation_rows: 0,
      visibility_rows: 0,
      fanout_rows: 0,
      bot_rows: 0,
      referral_rows: 0,
    });
    expect(c).toEqual({ result: "partial", rowsPersisted: 0, failureCategory: "no new data" });
  });

  it("Profound synced WITH rows is ok, summing every row kind", () => {
    const c = classifyRefreshOutcome("profound", {
      synced: true,
      citation_rows: 3,
      visibility_rows: 2,
      fanout_rows: 1,
    });
    expect(c.result).toBe("ok");
    expect(c.rowsPersisted).toBe(6);
  });
});

describe("recordRefreshRun (fail-soft)", () => {
  it("never throws when there is no Supabase env (writes the file mirror)", async () => {
    supabaseThrows = true;
    await expect(
      recordRefreshRun({
        tenantId: "tenant-a",
        source: "gsc",
        trigger: "cron",
        startedAt: "2026-07-11T00:00:00Z",
        finishedAt: "2026-07-11T00:00:01Z",
        result: "ok",
      }),
    ).resolves.toBeUndefined();
    expect(fileRows).toHaveLength(1);
    expect((fileRows[0] as { tenant_id: string }).tenant_id).toBe("tenant-a");
  });

  it("PGRST205 (table not migrated) routes to the file mirror without throwing", async () => {
    forceError = { code: "PGRST205", message: "could not find the table" };
    await recordRefreshRun({
      tenantId: "tenant-a",
      source: "profound",
      trigger: "manual",
      startedAt: "2026-07-11T00:00:00Z",
      finishedAt: "2026-07-11T00:00:01Z",
      result: "partial",
    });
    expect(__testing.isMissingTable(forceError)).toBe(true);
    expect(fileRows).toHaveLength(1);
  });

  it("writes to Supabase on the happy path", async () => {
    await recordRefreshRun({
      tenantId: "tenant-a",
      source: "ga4",
      trigger: "on-use",
      startedAt: "2026-07-11T00:00:00Z",
      finishedAt: "2026-07-11T00:00:01Z",
      result: "ok",
      rowsPersisted: 5,
    });
    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0]!.source).toBe("ga4");
    expect(insertedRows[0]!.trigger).toBe("on-use");
  });
});

describe("latestRefreshBySource + two-tenant isolation (file mirror)", () => {
  beforeEach(() => {
    supabaseThrows = true; // exercise the file-fallback read path
  });

  async function seed(tenantId: string, source: "gsc" | "ga4", startedAt: string, result: "ok" | "failed") {
    await recordRefreshRun({
      tenantId,
      source,
      trigger: "cron",
      startedAt,
      finishedAt: startedAt,
      result,
    });
  }

  it("returns the NEWEST row per source and never leaks across tenants", async () => {
    await seed("tenant-a", "gsc", "2026-07-09T00:00:00Z", "failed");
    await seed("tenant-a", "gsc", "2026-07-11T00:00:00Z", "ok"); // newest for A/gsc
    await seed("tenant-a", "ga4", "2026-07-10T00:00:00Z", "ok");
    await seed("tenant-b", "gsc", "2026-07-11T00:00:00Z", "failed"); // B only

    const a = await latestRefreshBySource("tenant-a");
    expect(a.gsc?.result).toBe("ok");
    expect(a.gsc?.started_at).toBe("2026-07-11T00:00:00Z");
    expect(a.ga4?.result).toBe("ok");

    const b = await latestRefreshBySource("tenant-b");
    expect(b.gsc?.result).toBe("failed");
    expect(b.ga4).toBeUndefined(); // A's ga4 row must not appear for B

    // A source filter also stays tenant-scoped.
    const aGsc = await listRecentRefreshRuns("tenant-a", { source: "gsc" });
    expect(aGsc.every((r) => r.tenant_id === "tenant-a" && r.source === "gsc")).toBe(true);
  });
});

describe("store registration", () => {
  it("refresh-runs is classified GLOBAL (tenant_id carried in-row)", () => {
    expect(classifyStore("refresh-runs")).toBe("global");
  });
});
