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
let updatedRows: Record<string, unknown>[] = [];
let selectRows: Record<string, unknown>[] = [];
let nextInsertId = 1;

/**
 * One chainable+thenable stub that serves every query shape the store uses:
 *   recordCronRun:   await from().insert(row)                  -> { error }
 *   beginCronRun:    await from().insert(row).select("id").single() -> { data:{id}, error }
 *   finishCronRun:   await from().update(patch).eq("id", id)   -> { error }
 *   listRecentCronRuns: await from().select("*").eq().order().limit() -> { data, error }
 * Awaiting the chain itself resolves via `then` (covers the awaited-insert and
 * awaited-update-eq cases); `single()` is the only leaf that returns a row id.
 */
function chain() {
  const c: Record<string, unknown> = {
    insert: vi.fn((row: Record<string, unknown>) => {
      if (!forceError) insertedRows.push(row);
      return c;
    }),
    update: vi.fn((patch: Record<string, unknown>) => {
      if (!forceError) updatedRows.push(patch);
      return c;
    }),
    select: vi.fn(() => c),
    eq: vi.fn(() => c),
    order: vi.fn(() => c),
    limit: vi.fn(() => c),
    single: vi.fn(async () =>
      forceError ? { data: null, error: forceError } : { data: { id: String(nextInsertId++) }, error: null },
    ),
    then: (resolve: (v: unknown) => unknown) =>
      resolve(forceError ? { data: null, error: forceError } : { data: selectRows, error: null }),
  };
  return c;
}

vi.mock("@/lib/persistence/supabase", () => ({
  getSupabaseAdmin: () => {
    if (supabaseThrows) throw new Error("no supabase env");
    return { from: () => chain() };
  },
}));

import {
  recordCronRun,
  beginCronRun,
  finishCronRun,
  listRecentCronRuns,
  buildCronRunRow,
  __testing,
} from "./cron-runs-store";
import { classifyStore } from "@/lib/persistence/store-classification";

beforeEach(() => {
  fileRows = [];
  insertedRows = [];
  updatedRows = [];
  selectRows = [];
  supabaseThrows = false;
  forceError = null;
  nextInsertId = 1;
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
    expect(row.phase).toBe("finished"); // one-shot rows are always completed
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

describe("beginCronRun / finishCronRun - started-row lifecycle", () => {
  it("begin INSERTS a running receipt and returns a supabase handle", async () => {
    const handle = await beginCronRun({ job: "sync-connectors", startedAt: "2026-07-12T09:00:00.000Z" });
    expect(handle.storage).toBe("supabase");
    expect(handle.job).toBe("sync-connectors");
    expect(handle.startedAt).toBe("2026-07-12T09:00:00.000Z");
    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0]!.phase).toBe("running");
    expect(insertedRows[0]!.ok).toBe(false); // a started row is never a success
  });

  it("begin falls back to a running FILE row when there is no Supabase env", async () => {
    supabaseThrows = true;
    const handle = await beginCronRun({ job: "measure-due", startedAt: "2026-07-12T09:30:00.000Z" });
    expect(handle.storage).toBe("file");
    expect(fileRows).toHaveLength(1);
    expect(fileRows[0]!.phase).toBe("running");
    expect(fileRows[0]!.job).toBe("measure-due");
  });

  it("begin falls back to file when the phase column is not migrated in yet (PGRST204)", async () => {
    forceError = { code: "PGRST204", message: "Could not find the 'phase' column of 'cron_runs' in the schema cache" };
    const handle = await beginCronRun({ job: "precompute", startedAt: "2026-07-12T12:00:00.000Z" });
    expect(handle.storage).toBe("file");
    expect(insertedRows).toHaveLength(0);
    expect(fileRows).toHaveLength(1);
    expect(fileRows[0]!.phase).toBe("running");
  });

  it("finish UPDATES the supabase row in place (phase -> finished, ok/perSource set)", async () => {
    const handle = await beginCronRun({ job: "sync-connectors", startedAt: "2026-07-12T09:00:00.000Z" });
    await finishCronRun(handle, {
      ok: true,
      perSource: [{ tenantId: "tenant-a", provider: "google_gsc", ok: true, detail: "synced" }],
      finishedAt: "2026-07-12T09:01:40.000Z",
    });
    expect(updatedRows).toHaveLength(1);
    expect(updatedRows[0]!.phase).toBe("finished");
    expect(updatedRows[0]!.ok).toBe(true);
    expect(updatedRows[0]!.duration_ms).toBe(100_000);
    expect((updatedRows[0]!.per_source as unknown[])).toHaveLength(1);
  });

  it("finish updates the SAME file row in place (no duplicate started row left behind)", async () => {
    supabaseThrows = true; // begin + finish both land on the file mirror
    const handle = await beginCronRun({ job: "measure-due", startedAt: "2026-07-12T09:30:00.000Z" });
    expect(fileRows).toHaveLength(1);
    await finishCronRun(handle, {
      ok: false,
      perSource: [{ tenantId: "tenant-a", provider: "measure", ok: false, detail: "boom" }],
      finishedAt: "2026-07-12T09:30:05.000Z",
    });
    // Still ONE row - the running receipt became finished, not a second row.
    expect(fileRows).toHaveLength(1);
    expect(fileRows[0]!.phase).toBe("finished");
    expect(fileRows[0]!.ok).toBe(false);
    expect(fileRows[0]!.duration_ms).toBe(5_000);
  });

  it("begin never throws even when the insert throws unexpectedly", async () => {
    vi.resetModules();
    vi.doMock("@/lib/persistence/supabase", () => ({
      getSupabaseAdmin: () => ({
        from: () => ({
          insert: () => ({
            select: () => ({
              single: async () => {
                throw new Error("network blip");
              },
            }),
          }),
        }),
      }),
    }));
    const mod = await import("./cron-runs-store");
    await expect(
      mod.beginCronRun({ job: "sync-connectors", startedAt: "2026-07-12T09:00:00.000Z" }),
    ).resolves.toMatchObject({ storage: "file" });
    vi.doUnmock("@/lib/persistence/supabase");
    vi.resetModules();
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
