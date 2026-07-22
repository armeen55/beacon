/**
 * PLATFORM — run-receipt stores (Core 100K terminal suite; merged from
 * src/domains/ops/{refresh-runs-store,cron-runs-store}.test.ts and
 * tests/domains/ops/warm-receipt-store.test.ts).
 *
 * The shared contract across every receipt store: fail-soft (recording a
 * receipt can never break the work it records), file-mirror fallback when
 * Supabase is absent or the table is not migrated in (PGRST205/42P01), honest
 * outcome classification, tenant-scoped reads, and the 3-strike sync-failure
 * escalation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── Unified in-memory file mirror ───────────────────────────────────────────
let fileRows: Record<string, unknown>[] = [];
let failFileReads = false;
vi.mock("@/lib/persistence/json-store", () => ({
  readStore: async () => {
    if (failFileReads) throw new Error("file store down");
    return fileRows;
  },
  writeStore: async (_name: string, data: unknown[]) => {
    fileRows = data as Record<string, unknown>[];
  },
}));

// ── Unified Supabase admin mock (serves every chain shape the stores use) ───
let supabaseThrows = false;
let forceError: { code?: string; message: string } | null = null;
let insertedRows: Record<string, unknown>[] = [];
let updatedRows: Record<string, unknown>[] = [];
let selectRows: Record<string, unknown>[] = [];
let nextInsertId = 1;

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
  recordRefreshRun,
  listRecentRefreshRuns,
  latestRefreshBySource,
  classifyRefreshOutcome,
  deriveSyncFailureEscalation,
  SYNC_FAILURE_ESCALATION_MIN_STREAK,
} from "@/domains/ops/refresh-runs-store";
import {
  hasWarmRunForDay,
  recordWarmRun,
  readLastWarmReceipt,
  type WarmRunReceipt,
} from "@/domains/ops/warm-receipt-store";
import { classifyStore } from "@/lib/persistence/store-classification";

beforeEach(() => {
  fileRows = [];
  failFileReads = false;
  insertedRows = [];
  updatedRows = [];
  selectRows = [];
  supabaseThrows = false;
  forceError = null;
  nextInsertId = 1;
});

// ── refresh-runs ────────────────────────────────────────────────────────────

describe("classifyRefreshOutcome (pure)", () => {
  it("a not-synced result is failed with the engine reason", () => {
    expect(classifyRefreshOutcome("gsc", { synced: false, reason: "gsc_auth_transient" })).toEqual({
      result: "failed",
      rowsPersisted: null,
      failureCategory: "gsc_auth_transient",
    });
  });

  it("a synced GSC/GA4 run stays ok even with 0 rows (a normal quiet night)", () => {
    expect(classifyRefreshOutcome("gsc", { synced: true, rows_upserted: 12 }).result).toBe("ok");
    expect(classifyRefreshOutcome("gsc", { synced: true, rows_upserted: 0 }).result).toBe("ok");
    expect(classifyRefreshOutcome("ga4", { synced: true, rows_upserted: 0 }).result).toBe("ok");
  });

  it("Profound synced with 0 rows across every row kind is the silent partial", () => {
    const c = classifyRefreshOutcome("profound", {
      synced: true,
      citation_rows: 0,
      visibility_rows: 0,
      fanout_rows: 0,
      bot_rows: 0,
      referral_rows: 0,
    });
    expect(c).toEqual({ result: "partial", rowsPersisted: 0, failureCategory: "no new data" });
    expect(classifyRefreshOutcome("profound", { synced: true, citation_rows: 3, visibility_rows: 2, fanout_rows: 1 }).rowsPersisted).toBe(6);
  });
});

describe("recordRefreshRun fail-soft + tenant-scoped reads", () => {
  it("never throws with no Supabase env; the file mirror gets the row", async () => {
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
    expect(fileRows).toHaveLength(1);
  });

  it("latestRefreshBySource returns the newest row per source and never leaks across tenants", async () => {
    supabaseThrows = true; // exercise the file-fallback read path
    const seed = (tenantId: string, source: "gsc" | "ga4", startedAt: string, result: "ok" | "failed") =>
      recordRefreshRun({ tenantId, source, trigger: "cron", startedAt, finishedAt: startedAt, result });
    await seed("tenant-a", "gsc", "2026-07-09T00:00:00Z", "failed");
    await seed("tenant-a", "gsc", "2026-07-11T00:00:00Z", "ok");
    await seed("tenant-a", "ga4", "2026-07-10T00:00:00Z", "ok");
    await seed("tenant-b", "gsc", "2026-07-11T00:00:00Z", "failed");

    const a = await latestRefreshBySource("tenant-a");
    expect(a.gsc?.result).toBe("ok");
    expect(a.gsc?.started_at).toBe("2026-07-11T00:00:00Z");
    const b = await latestRefreshBySource("tenant-b");
    expect(b.gsc?.result).toBe("failed");
    expect(b.ga4).toBeUndefined();
    const aGsc = await listRecentRefreshRuns("tenant-a", { source: "gsc" });
    expect(aGsc.every((r) => r.tenant_id === "tenant-a" && r.source === "gsc")).toBe(true);
  });
});

describe("deriveSyncFailureEscalation — 3-strike escalation (pure)", () => {
  const NOW = new Date("2026-07-20T00:00:00Z");
  const f = (started_at: string) => ({ started_at, result: "failed" as const });
  const ok = (started_at: string) => ({ started_at, result: "ok" as const });

  it("two prior failures + this failure = streak 3 → escalate, since = last good pull", () => {
    expect(SYNC_FAILURE_ESCALATION_MIN_STREAK).toBe(3);
    const r = deriveSyncFailureEscalation(
      [f("2026-07-19T00:00:00Z"), f("2026-07-18T00:00:00Z"), ok("2026-07-15T00:00:00Z")],
      { result: "failed", startedAt: NOW.toISOString() },
      NOW,
    );
    expect(r.escalate).toBe(true);
    expect(r.streak).toBe(3);
    expect(r.since).toBe("2026-07-15T00:00:00Z");
    expect(r.daysStale).toBe(5);
  });

  it("below the threshold there is no escalation; a non-failed run never escalates", () => {
    expect(
      deriveSyncFailureEscalation([f("2026-07-19T00:00:00Z")], { result: "failed", startedAt: NOW.toISOString() }, NOW)
        .escalate,
    ).toBe(false);
    expect(
      deriveSyncFailureEscalation([f("2026-07-19T00:00:00Z"), f("2026-07-18T00:00:00Z")], { result: "ok", startedAt: NOW.toISOString() }, NOW),
    ).toEqual({ escalate: false, since: null, streak: 0, daysStale: 0 });
  });

  it("an ok/partial run BREAKS the streak (only leading failures count)", () => {
    const r = deriveSyncFailureEscalation(
      [f("2026-07-19T00:00:00Z"), f("2026-07-18T00:00:00Z"), ok("2026-07-17T00:00:00Z"), f("2026-07-16T00:00:00Z")],
      { result: "failed", startedAt: NOW.toISOString() },
      NOW,
    );
    expect(r.streak).toBe(3);
    expect(r.since).toBe("2026-07-17T00:00:00Z");
  });
});

// ── warm receipts ───────────────────────────────────────────────────────────

describe("warm-receipt store — run-marker idempotency", () => {
  const TENANT = "tenant-iranopedia";
  const receipt = (partial: Partial<WarmRunReceipt> = {}): WarmRunReceipt => ({
    tenant_id: TENANT,
    date: "2026-07-02",
    ran_at: "2026-07-02T12:00:00.000Z",
    ok: true,
    totalMs: 1234,
    steps: [{ name: "demand-graph", ok: true, ms: 1000 }],
    ...partial,
  });

  it("marks the day only after a SUCCESSFUL run; a failed attempt never blocks the retry", async () => {
    expect(await hasWarmRunForDay(TENANT, "2026-07-02")).toBe(false);
    await recordWarmRun(receipt({ ok: false }));
    expect(await hasWarmRunForDay(TENANT, "2026-07-02")).toBe(false);
    await recordWarmRun(receipt({ ok: true }));
    expect(await hasWarmRunForDay(TENANT, "2026-07-02")).toBe(true);
    expect(await hasWarmRunForDay(TENANT, "2026-07-03")).toBe(false);
  });

  it("an unreadable marker fails open (the pass is $0, a re-warm is harmless)", async () => {
    failFileReads = true;
    expect(await hasWarmRunForDay(TENANT, "2026-07-02")).toBe(false);
    expect(await readLastWarmReceipt(TENANT)).toBeNull();
  });

  it("the latest attempt per day replaces the previous one; cron and visit receipts stay independent", async () => {
    await recordWarmRun(receipt({ ok: false, ran_at: "2026-07-02T12:00:00.000Z", trigger: "visit" }));
    await recordWarmRun(receipt({ ok: true, ran_at: "2026-07-02T12:05:00.000Z", trigger: "visit", totalMs: 20 }));
    await recordWarmRun(receipt({ trigger: "cron", totalMs: 10 }));
    const mine = (fileRows as unknown as WarmRunReceipt[]).filter((r) => r.tenant_id === TENANT);
    expect(mine).toHaveLength(2); // one visit (replaced), one cron
    expect((await readLastWarmReceipt(TENANT, "visit"))?.totalMs).toBe(20);
    expect((await readLastWarmReceipt(TENANT, "cron"))?.totalMs).toBe(10);
  });
});

describe("store registration pins", () => {
  it("refresh-runs is a GLOBAL store (fleet rows, tenant_id carried in-row)", () => {
    expect(classifyStore("refresh-runs")).toBe("global");
  });
});
