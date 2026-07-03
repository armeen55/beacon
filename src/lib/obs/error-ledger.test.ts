/**
 * error-ledger tests (BEACON_500 R7 / N39, 2026-07-03).
 *
 * Pins the spine's three contracts:
 *   1. CAP + PRUNE: at most MAX_ERRORS_PER_TENANT rows per tenant bucket,
 *      newest kept, pruned on every write, buckets independent.
 *   2. NEVER THROWS: recordAppError absorbs read failures, write failures,
 *      and its own bugs - a failing error write must never break the caller.
 *   3. Read model: listAppErrorsForTenant returns the tenant's rows plus
 *      fleet-level (null tenant) rows newest first; groupAppErrors folds
 *      route+message groups with counts and most recent time.
 *
 * json-store is mocked in memory (cron-runs-store.test.ts sibling pattern)
 * so no test ever touches the operator's real .data directory.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

let fileRows: unknown[] = [];
let readThrows = false;
let writeThrows = false;

vi.mock("@/lib/persistence/json-store", () => ({
  readStore: async () => {
    if (readThrows) throw new Error("read exploded");
    return fileRows;
  },
  writeStore: async (_name: string, data: unknown[]) => {
    if (writeThrows) throw new Error("write exploded");
    fileRows = data;
  },
}));

import {
  buildAppErrorRow,
  pruneAppErrorRows,
  recordAppError,
  listAppErrorsForTenant,
  groupAppErrors,
  errorFieldsFrom,
  MAX_ERRORS_PER_TENANT,
  type AppErrorRow,
} from "./error-ledger";
import { classifyStore } from "@/lib/persistence/store-classification";

function row(overrides: Partial<AppErrorRow>): AppErrorRow {
  return {
    id: overrides.id ?? `id-${Math.random().toString(36).slice(2)}`,
    at: overrides.at ?? "2026-07-03T10:00:00.000Z",
    tenantId: overrides.tenantId === undefined ? "tenant-a" : overrides.tenantId,
    route: overrides.route ?? "cron/sync-connectors",
    action: overrides.action ?? "trend-radar",
    message: overrides.message ?? "boom",
    stack: overrides.stack ?? null,
    context: overrides.context ?? {},
  };
}

beforeEach(() => {
  fileRows = [];
  readThrows = false;
  writeThrows = false;
});

describe("store registration", () => {
  it("app-errors is classified (global: rows carry tenantId, cron fan-out writers)", () => {
    expect(classifyStore("app-errors")).toBe("global");
  });

  it("app-errors is Supabase-mirrored so hosted-prod errors survive lambda recycling", () => {
    const src = require("node:fs").readFileSync(
      require("node:path").resolve(__dirname, "../persistence/json-store.ts"),
      "utf-8",
    );
    expect(src).toContain('"app-errors"');
  });
});

describe("buildAppErrorRow (pure)", () => {
  it("bounds message, stack, route, and action so one error can never bloat the store", () => {
    const built = buildAppErrorRow(
      {
        route: "r".repeat(500),
        action: "a".repeat(500),
        tenantId: "tenant-a",
        message: "m".repeat(5000),
        stack: "s".repeat(50_000),
      },
      "id-1",
      new Date("2026-07-03T10:00:00Z"),
    );
    expect(built.message.length).toBeLessThanOrEqual(500);
    expect((built.stack ?? "").length).toBeLessThanOrEqual(2000);
    expect(built.route.length).toBeLessThanOrEqual(120);
    expect(built.action.length).toBeLessThanOrEqual(120);
    expect(built.at).toBe("2026-07-03T10:00:00.000Z");
  });

  it("defaults tenantId to null (fleet-level) and context to {}", () => {
    const built = buildAppErrorRow({ route: "r", action: "a", message: "m" }, "id-2");
    expect(built.tenantId).toBeNull();
    expect(built.context).toEqual({});
    expect(built.stack).toBeNull();
  });
});

describe("errorFieldsFrom (pure)", () => {
  it("pulls message + stack from an Error, message only from anything else", () => {
    const fromError = errorFieldsFrom(new Error("kaboom"));
    expect(fromError.message).toBe("kaboom");
    expect(fromError.stack).toBeTruthy();
    expect(errorFieldsFrom("plain string")).toEqual({ message: "plain string", stack: null });
    expect(errorFieldsFrom(42)).toEqual({ message: "42", stack: null });
  });
});

describe("pruneAppErrorRows (pure cap)", () => {
  it("caps each tenant bucket at MAX_ERRORS_PER_TENANT keeping the newest", () => {
    const rows: AppErrorRow[] = [];
    for (let i = 0; i < 250; i++) {
      rows.push(
        row({
          id: `a-${i}`,
          tenantId: "tenant-a",
          at: new Date(Date.UTC(2026, 6, 1, 0, 0, i)).toISOString(),
        }),
      );
    }
    const pruned = pruneAppErrorRows(rows);
    expect(pruned).toHaveLength(MAX_ERRORS_PER_TENANT);
    // Newest kept: the last-written second (i=249) survives, the first 50 don't.
    expect(pruned.some((r) => r.id === "a-249")).toBe(true);
    expect(pruned.some((r) => r.id === "a-0")).toBe(false);
  });

  it("buckets are independent per tenant, with null tenant as its own bucket", () => {
    const rows: AppErrorRow[] = [];
    for (let i = 0; i < 210; i++) rows.push(row({ id: `a-${i}`, tenantId: "tenant-a", at: new Date(Date.UTC(2026, 6, 1, 0, 0, i)).toISOString() }));
    for (let i = 0; i < 5; i++) rows.push(row({ id: `b-${i}`, tenantId: "tenant-b" }));
    for (let i = 0; i < 5; i++) rows.push(row({ id: `n-${i}`, tenantId: null }));
    const pruned = pruneAppErrorRows(rows);
    expect(pruned.filter((r) => r.tenantId === "tenant-a")).toHaveLength(MAX_ERRORS_PER_TENANT);
    expect(pruned.filter((r) => r.tenantId === "tenant-b")).toHaveLength(5);
    expect(pruned.filter((r) => r.tenantId == null)).toHaveLength(5);
  });
});

describe("recordAppError", () => {
  it("appends a row and prunes on write", async () => {
    for (let i = 0; i < MAX_ERRORS_PER_TENANT; i++) {
      fileRows.push(
        row({
          id: `old-${i}`,
          tenantId: "tenant-a",
          at: new Date(Date.UTC(2026, 6, 1, 0, 0, i)).toISOString(),
        }),
      );
    }
    await recordAppError({
      route: "cron/sync-connectors",
      tenantId: "tenant-a",
      action: "trend-radar",
      message: "spike compute failed",
    });
    expect(fileRows).toHaveLength(MAX_ERRORS_PER_TENANT); // capped, not 201
    const stored = fileRows as AppErrorRow[];
    expect(stored.some((r) => r.message === "spike compute failed")).toBe(true);
    expect(stored.some((r) => r.id === "old-0")).toBe(false); // oldest pruned
  });

  it("NEVER throws when the store read explodes", async () => {
    readThrows = true;
    await expect(
      recordAppError({ route: "r", action: "a", message: "m" }),
    ).resolves.toBeUndefined();
  });

  it("NEVER throws when the store write explodes", async () => {
    writeThrows = true;
    await expect(
      recordAppError({ route: "r", action: "a", message: "m" }),
    ).resolves.toBeUndefined();
  });
});

describe("listAppErrorsForTenant", () => {
  it("returns the tenant's rows plus fleet-level rows, newest first", async () => {
    fileRows = [
      row({ id: "mine-old", tenantId: "tenant-a", at: "2026-07-01T00:00:00.000Z" }),
      row({ id: "theirs", tenantId: "tenant-b", at: "2026-07-02T00:00:00.000Z" }),
      row({ id: "fleet", tenantId: null, at: "2026-07-03T00:00:00.000Z" }),
      row({ id: "mine-new", tenantId: "tenant-a", at: "2026-07-04T00:00:00.000Z" }),
    ];
    const rows = await listAppErrorsForTenant("tenant-a");
    expect(rows.map((r) => r.id)).toEqual(["mine-new", "fleet", "mine-old"]);
  });

  it("fail-soft: a read explosion answers []", async () => {
    readThrows = true;
    expect(await listAppErrorsForTenant("tenant-a")).toEqual([]);
  });
});

describe("groupAppErrors (pure)", () => {
  it("groups by route+message with count and most recent time, biggest first", () => {
    const rows = [
      row({ route: "/changes", message: "timeout", at: "2026-07-03T01:00:00.000Z" }),
      row({ route: "/changes", message: "timeout", at: "2026-07-03T03:00:00.000Z" }),
      row({ route: "/changes", message: "timeout", at: "2026-07-03T02:00:00.000Z" }),
      row({ route: "cron/sync-connectors", message: "401", at: "2026-07-03T04:00:00.000Z" }),
    ];
    const groups = groupAppErrors(rows);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({
      route: "/changes",
      message: "timeout",
      count: 3,
      lastAt: "2026-07-03T03:00:00.000Z",
    });
    expect(groups[1]).toMatchObject({ route: "cron/sync-connectors", count: 1 });
  });
});
