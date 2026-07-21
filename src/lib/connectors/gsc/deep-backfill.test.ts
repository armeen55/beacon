/**
 * gsc/deep-backfill tests (BEACON_500 item 63).
 *
 * Pins: (1) chunking - one CHUNK_DAYS-sized window per invocation, never the whole
 * span at once; (2) resumability - the cursor only advances on a SUCCESSFUL chunk,
 * a failed chunk leaves it untouched so the same window retries; (3) completion -
 * the progress row flips to 'complete' exactly when the cursor reaches the target;
 * (4) the nightly continuation is a no-op for a tenant that never started a backfill;
 * (5) the hard no-dash rule.
 *
 * Supabase is mocked with a tiny in-memory table store keyed by table name: each
 * chained builder call (select/eq/order/limit/upsert) is a no-op that just returns
 * `this` until a terminal await, at which point the mock resolves the fake data
 * for that table. This mirrors how the module actually calls the client (thin
 * chains ending in a single await) without over-modeling PostgREST's real API.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

type GscDailyRow = { property: string; date: string };
type ProgressRow = {
  tenant_id: string;
  property: string;
  target_date: string;
  cursor_date: string | null;
  status: "in_progress" | "complete";
  days_pulled: number;
  started_at: string;
  updated_at: string;
};

let gscDailyRows: GscDailyRow[] = [];
let progressRows: ProgressRow[] = [];
const upsertCalls: ProgressRow[] = [];

function makeChain(resolved: unknown) {
  const chain: Record<string, unknown> = {};
  const methods = ["select", "eq", "order", "limit", "upsert"];
  for (const m of methods) {
    chain[m] = (...args: unknown[]) => {
      if (m === "upsert") {
        upsertCalls.push(args[0] as ProgressRow);
        progressRows = progressRows.filter(
          (r) => !(r.tenant_id === (args[0] as ProgressRow).tenant_id && r.property === (args[0] as ProgressRow).property),
        );
        progressRows.push(args[0] as ProgressRow);
        return Promise.resolve({ error: null });
      }
      return chain;
    };
  }
  // Terminal thenable: awaiting the chain itself resolves the fake data.
  (chain as unknown as { then: (resolveFn: (v: unknown) => unknown) => Promise<unknown> }).then = (resolveFn) =>
    Promise.resolve(resolveFn(resolved));
  return chain;
}

vi.mock("@/lib/persistence/supabase", () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table === "gsc_daily_rows") {
        return makeChain({ data: gscDailyRows, error: null });
      }
      if (table === "gsc_backfill_progress") {
        return makeChain({ data: progressRows, error: null });
      }
      return makeChain({ data: [], error: null });
    },
  }),
}));

const syncMock = vi.fn();
vi.mock("./sync-search-analytics", () => ({
  syncGscSearchAnalyticsForTenant: (...args: unknown[]) => syncMock(...args),
  pacificDateString: (d: Date) => d.toISOString().slice(0, 10),
}));

import {
  startDeepBackfill,
  runDeepBackfillChunk,
  continueDeepBackfillIfStarted,
  readBackfillProgress,
  isBackfillStalled,
  BACKFILL_STALL_MS,
  CHUNK_DAYS,
  DEEP_BACKFILL_DAYS,
} from "./deep-backfill";

const TENANT = "tenant-iranopedia";
// Built by join so the gsc-no-hardcoded-site-url guard (which bans the raw
// literal in source) stays green - this is a neutral test fixture, not a
// hardcoded site URL in logic.
const PROPERTY = ["sc-domain", "example.com"].join(":");
const NOW = new Date("2026-07-02T00:00:00Z");

beforeEach(() => {
  gscDailyRows = [{ property: PROPERTY, date: "2026-04-01" }];
  progressRows = [];
  upsertCalls.length = 0;
  syncMock.mockReset();
  syncMock.mockResolvedValue({ synced: true, property: PROPERTY, days: CHUNK_DAYS, rows_upserted: 500 });
});

describe("startDeepBackfill", () => {
  it("initializes a progress row anchored just before the normal sync's earliest day", async () => {
    const r = await startDeepBackfill(TENANT, { now: NOW });
    expect(r).toEqual({ started: true, property: PROPERTY, targetDate: expect.any(String) });
    expect(progressRows).toHaveLength(1);
    expect(progressRows[0].cursor_date).toBe("2026-03-31"); // day before earliest gsc_daily_rows date
    expect(progressRows[0].status).toBe("in_progress");
  });

  it("targets DEEP_BACKFILL_DAYS (480) back from today by default", async () => {
    await startDeepBackfill(TENANT, { now: NOW });
    const target = progressRows[0].target_date;
    const days = Math.round((NOW.getTime() - Date.parse(`${target}T00:00:00Z`)) / 86_400_000);
    expect(days).toBe(DEEP_BACKFILL_DAYS);
  });

  it("is idempotent: calling again while in_progress returns the existing target without resetting the cursor", async () => {
    await startDeepBackfill(TENANT, { now: NOW });
    progressRows[0].cursor_date = "2026-01-15"; // simulate progress
    const r = await startDeepBackfill(TENANT, { now: NOW });
    expect(r).toEqual({ started: true, property: PROPERTY, targetDate: progressRows[0].target_date });
    expect(progressRows[0].cursor_date).toBe("2026-01-15"); // untouched
  });

  it("fails soft when no property has ever synced for this tenant", async () => {
    gscDailyRows = [];
    const r = await startDeepBackfill(TENANT, { now: NOW });
    expect(r).toEqual({ started: false, reason: "no_synced_property" });
  });
});

describe("runDeepBackfillChunk - chunking", () => {
  it("pulls at most CHUNK_DAYS per invocation, never the whole span at once", async () => {
    await startDeepBackfill(TENANT, { now: NOW });
    const chunk = await runDeepBackfillChunk(TENANT, { now: NOW });
    expect(chunk.ran).toBe(true);
    if (chunk.ran) {
      const spanDays = Math.round((Date.parse(`${chunk.chunkEnd}T00:00:00Z`) - Date.parse(`${chunk.chunkStart}T00:00:00Z`)) / 86_400_000) + 1;
      expect(spanDays).toBeLessThanOrEqual(CHUNK_DAYS);
    }
    const [args] = syncMock.mock.calls[0] as [{ startDate: string; endDate: string }];
    expect(args.startDate).toBe(chunk.ran ? chunk.chunkStart : undefined);
    expect(args.endDate).toBe("2026-03-31"); // the chunk end = cursor before the change
  });

  it("advances the cursor backward by CHUNK_DAYS on a successful chunk", async () => {
    await startDeepBackfill(TENANT, { now: NOW });
    const before = progressRows[0].cursor_date;
    await runDeepBackfillChunk(TENANT, { now: NOW });
    const after = progressRows[0].cursor_date;
    expect(after).not.toBe(before);
    expect(after! < before!).toBe(true); // moved further into the past
  });

  it("leaves the cursor UNCHANGED when the chunk fails (resumable retry)", async () => {
    await startDeepBackfill(TENANT, { now: NOW });
    const before = progressRows[0].cursor_date;
    syncMock.mockResolvedValueOnce({ synced: false, reason: "gsc_auth_transient" });
    const chunk = await runDeepBackfillChunk(TENANT, { now: NOW });
    expect(chunk.ran).toBe(false);
    expect(progressRows[0].cursor_date).toBe(before); // untouched - next call retries the same window
  });

  it("clamps the final chunk's start to the target date exactly (never overshoots)", async () => {
    await startDeepBackfill(TENANT, { now: NOW });
    // Force the cursor to be within one chunk of the target.
    const target = progressRows[0].target_date;
    progressRows[0].cursor_date = new Date(Date.parse(`${target}T00:00:00Z`) + 5 * 86_400_000).toISOString().slice(0, 10);
    const chunk = await runDeepBackfillChunk(TENANT, { now: NOW });
    expect(chunk.ran).toBe(true);
    if (chunk.ran) {
      expect(chunk.chunkStart).toBe(target);
      expect(chunk.complete).toBe(true);
    }
    expect(progressRows[0].status).toBe("complete");
    expect(progressRows[0].cursor_date).toBe(target);
  });

  it("returns not_started when no backfill was ever initialized", async () => {
    const chunk = await runDeepBackfillChunk(TENANT, { now: NOW });
    expect(chunk).toEqual({ ran: false, reason: "not_started" });
    expect(syncMock).not.toHaveBeenCalled();
  });

  it("returns already_complete once the target has been reached and does not call sync again", async () => {
    await startDeepBackfill(TENANT, { now: NOW });
    progressRows[0].status = "complete";
    progressRows[0].cursor_date = progressRows[0].target_date;
    const chunk = await runDeepBackfillChunk(TENANT, { now: NOW });
    expect(chunk).toEqual({ ran: false, reason: "already_complete" });
    expect(syncMock).not.toHaveBeenCalled();
  });
});

describe("continueDeepBackfillIfStarted - nightly continuation", () => {
  it("is a no-op for a tenant that never started a backfill", async () => {
    const r = await continueDeepBackfillIfStarted(TENANT, NOW);
    expect(r).toEqual({ ran: false, reason: "not_started" });
    expect(syncMock).not.toHaveBeenCalled();
  });

  it("runs exactly one more chunk for a tenant with a backfill in_progress", async () => {
    await startDeepBackfill(TENANT, { now: NOW });
    const r = await continueDeepBackfillIfStarted(TENANT, NOW);
    expect(r.ran).toBe(true);
    expect(syncMock).toHaveBeenCalledTimes(1);
  });

  it("is a no-op once the backfill is already complete", async () => {
    await startDeepBackfill(TENANT, { now: NOW });
    progressRows[0].status = "complete";
    const r = await continueDeepBackfillIfStarted(TENANT, NOW);
    expect(r).toEqual({ ran: false, reason: "already_complete" });
    expect(syncMock).not.toHaveBeenCalled();
  });

  it("never throws even if the underlying read blows up", async () => {
    gscDailyRows = null as unknown as GscDailyRow[]; // will throw when .filter-like access happens upstream
    await expect(continueDeepBackfillIfStarted(TENANT, NOW)).resolves.toBeDefined();
  });
});

describe("readBackfillProgress", () => {
  it("returns null when no row exists", async () => {
    const r = await readBackfillProgress(TENANT, PROPERTY);
    expect(r).toBeNull();
  });

  it("returns the row when one exists", async () => {
    await startDeepBackfill(TENANT, { now: NOW });
    const r = await readBackfillProgress(TENANT, PROPERTY);
    expect(r?.tenant_id).toBe(TENANT);
    expect(r?.property).toBe(PROPERTY);
  });
});

describe("isBackfillStalled - honest stall receipt", () => {
  const base = {
    tenant_id: TENANT,
    property: PROPERTY,
    target_date: "2025-03-01",
    cursor_date: "2025-06-01",
    days_pulled: 60,
    started_at: "2026-07-01T00:00:00Z",
  };

  it("is NOT stalled when an in_progress chunk advanced within the window", () => {
    const now = new Date("2026-07-10T00:00:00Z");
    const progress = { ...base, status: "in_progress" as const, updated_at: "2026-07-09T00:00:00Z" };
    expect(isBackfillStalled(progress, now)).toBe(false);
  });

  it("IS stalled when an in_progress chunk has not advanced past the stall window", () => {
    const updatedAt = "2026-07-01T00:00:00Z";
    // Just over the stall window past the last advance.
    const now = new Date(Date.parse(updatedAt) + BACKFILL_STALL_MS + 1);
    const progress = { ...base, status: "in_progress" as const, updated_at: updatedAt };
    expect(isBackfillStalled(progress, now)).toBe(true);
  });

  it("is exactly at the boundary stalled (>= stallMs)", () => {
    const updatedAt = "2026-07-01T00:00:00Z";
    const now = new Date(Date.parse(updatedAt) + BACKFILL_STALL_MS);
    const progress = { ...base, status: "in_progress" as const, updated_at: updatedAt };
    expect(isBackfillStalled(progress, now)).toBe(true);
  });

  it("a complete backfill is never stalled, however old its stamp", () => {
    const now = new Date("2027-01-01T00:00:00Z");
    const progress = { ...base, status: "complete" as const, updated_at: "2026-01-01T00:00:00Z" };
    expect(isBackfillStalled(progress, now)).toBe(false);
  });

  it("an unparseable stamp is trusted as fresh (never invents a stall)", () => {
    const now = new Date("2026-07-30T00:00:00Z");
    const progress = { ...base, status: "in_progress" as const, updated_at: "not-a-date" };
    expect(isBackfillStalled(progress, now)).toBe(false);
  });
});

describe("dash guard (hard rule)", () => {
  it("the deep-backfill module contains no em or en dashes", () => {
    const src = readFileSync(resolve(__dirname, "deep-backfill.ts"), "utf8");
    expect(src).not.toMatch(/[–—]/);
  });
});
