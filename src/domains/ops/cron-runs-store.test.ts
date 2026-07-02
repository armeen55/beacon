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
let selectRows: Record<string, unknown>[] = [];

function chain() {
  const c: Record<string, unknown> = {
    insert: vi.fn(async (row: Record<string, unknown>) => {
      if (forceError) return { error: forceError };
      insertedRows.push(row);
      return { error: null };
    }),
    select: vi.fn(() => c),
    eq: vi.fn(() => c),
    order: vi.fn(() => c),
    limit: vi.fn(async () => {
      if (forceError) return { data: null, error: forceError };
      return { data: selectRows, error: null };
    }),
  };
  return c;
}

vi.mock("@/lib/persistence/supabase", () => ({
  getSupabaseAdmin: () => {
    if (supabaseThrows) throw new Error("no supabase env");
    return { from: () => chain() };
  },
}));

import { recordCronRun, listRecentCronRuns, buildCronRunRow, __testing } from "./cron-runs-store";
import { classifyStore } from "@/lib/persistence/store-classification";

beforeEach(() => {
  fileRows = [];
  insertedRows = [];
  selectRows = [];
  supabaseThrows = false;
  forceError = null;
});

describe("buildCronRunRow (pure)", () => {
  it("computes duration_ms from started/finished timestamps", () => {
    const row = buildCronRunRow(
      {
        job: "sync-connectors",
        startedAt: "2026-07-03T09:00:00.000Z",
        finishedAt: "2026-07-03T09:02:30.000Z",
        ok: true,
        perSource: [{ tenantId: "tenant-a", provider: "google_gsc", ok: true, detail: "synced" }],
      },
      "row-1",
      new Date("2026-07-03T09:02:31.000Z"),
    );
    expect(row.duration_ms).toBe(150_000);
    expect(row.tenant_id).toBeNull();
    expect(row.ok).toBe(true);
    expect(row.per_source).toHaveLength(1);
  });

  it("clamps a negative/garbled duration to 0 rather than a negative number", () => {
    const row = buildCronRunRow(
      {
        job: "x",
        startedAt: "not-a-date",
        finishedAt: "2026-07-03T09:02:30.000Z",
        ok: true,
        perSource: [],
      },
      "row-2",
    );
    expect(row.duration_ms).toBe(0);
  });
});

describe("isMissingTable", () => {
  it("matches 42P01, PGRST205, PGRST204, and schema-cache messages", () => {
    expect(__testing.isMissingTable({ code: "42P01" })).toBe(true);
    expect(__testing.isMissingTable({ code: "PGRST205" })).toBe(true);
    expect(__testing.isMissingTable({ code: "PGRST204" })).toBe(true);
    expect(__testing.isMissingTable({ message: "Could not find the table 'public.cron_runs'" })).toBe(true);
    expect(__testing.isMissingTable({ code: "23505" })).toBe(false);
    expect(__testing.isMissingTable(null)).toBe(false);
  });
});

describe("recordCronRun - fail-soft contract", () => {
  it("never throws when Supabase has no env (file fallback engages)", async () => {
    supabaseThrows = true;
    await expect(
      recordCronRun({
        job: "sync-connectors",
        startedAt: "2026-07-03T09:00:00.000Z",
        finishedAt: "2026-07-03T09:01:00.000Z",
        ok: true,
        perSource: [],
      }),
    ).resolves.toBeUndefined();
    expect(fileRows).toHaveLength(1);
    expect(fileRows[0]!.job).toBe("sync-connectors");
  });

  it("falls back to the file mirror on PGRST205 (table not migrated in yet)", async () => {
    forceError = { code: "PGRST205", message: "Could not find the table 'public.cron_runs' in the schema cache" };
    await expect(
      recordCronRun({
        job: "measure-due",
        startedAt: "2026-07-03T09:30:00.000Z",
        finishedAt: "2026-07-03T09:31:00.000Z",
        ok: false,
        perSource: [{ tenantId: "tenant-a", provider: "measure", ok: false, detail: "boom" }],
      }),
    ).resolves.toBeUndefined();
    expect(insertedRows).toHaveLength(0);
    expect(fileRows).toHaveLength(1);
    expect(fileRows[0]!.job).toBe("measure-due");
  });

  it("never throws even when Supabase insert throws unexpectedly", async () => {
    supabaseThrows = false;
    vi.doMock("@/lib/persistence/supabase", () => ({
      getSupabaseAdmin: () => ({
        from: () => ({
          insert: async () => {
            throw new Error("network blip");
          },
        }),
      }),
    }));
    // Re-import with the throwing mock active for this one test.
    vi.resetModules();
    const mod = await import("./cron-runs-store");
    await expect(
      mod.recordCronRun({
        job: "sync-connectors",
        startedAt: "2026-07-03T09:00:00.000Z",
        finishedAt: "2026-07-03T09:01:00.000Z",
        ok: true,
        perSource: [],
      }),
    ).resolves.toBeUndefined();
  });

  it("writes a real row to Supabase on success (no file fallback)", async () => {
    await recordCronRun({
      job: "sync-connectors",
      startedAt: "2026-07-03T09:00:00.000Z",
      finishedAt: "2026-07-03T09:01:00.000Z",
      ok: true,
      perSource: [{ tenantId: "tenant-a", provider: "google_gsc", ok: true, detail: "synced" }],
    });
    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0]!.job).toBe("sync-connectors");
    expect(fileRows).toHaveLength(0);
  });
});

describe("listRecentCronRuns", () => {
  it("reads from Supabase when available", async () => {
    selectRows = [
      {
        id: "1",
        tenant_id: null,
        job: "sync-connectors",
        started_at: "2026-07-03T09:00:00.000Z",
        finished_at: "2026-07-03T09:01:00.000Z",
        duration_ms: 60_000,
        ok: true,
        per_source: [],
        notes: {},
        created_at: "2026-07-03T09:01:00.000Z",
      },
    ];
    const runs = await listRecentCronRuns("sync-connectors");
    expect(runs).toHaveLength(1);
    expect(runs[0]!.job).toBe("sync-connectors");
  });

  it("falls back to the file when the table is missing", async () => {
    forceError = { code: "42P01", message: "undefined_table" };
    fileRows = [
      {
        id: "1",
        tenant_id: null,
        job: "sync-connectors",
        started_at: "2026-07-03T09:00:00.000Z",
        finished_at: "2026-07-03T09:01:00.000Z",
        duration_ms: 60_000,
        ok: true,
        per_source: [],
        notes: {},
        created_at: "2026-07-03T09:01:00.000Z",
      },
    ];
    const runs = await listRecentCronRuns("sync-connectors");
    expect(runs).toHaveLength(1);
  });

  it("returns [] (never throws) on an unexpected error", async () => {
    forceError = { code: "23505", message: "weird" };
    const runs = await listRecentCronRuns("sync-connectors");
    expect(runs).toEqual([]);
  });
});

describe("registration pin", () => {
  it("cron-runs is a GLOBAL store (fleet-level rows, no ambient tenant)", () => {
    expect(classifyStore("cron-runs")).toBe("global");
  });

  it("token-expiry-warnings is a GLOBAL store", () => {
    expect(classifyStore("token-expiry-warnings")).toBe("global");
  });
});
