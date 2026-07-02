/**
 * investigation-store (2026-07-02, master plan item 53) - the idempotency key
 * math (one investigation per family per ISO week) and the store round-trip:
 * write, dedupe by (tenant, key), staleness window, fail-soft reads.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory json-store stub (same seam every sibling store test uses).
let stored: Record<string, unknown[]> = {};
let readThrows = false;
vi.mock("@/lib/persistence/json-store", () => ({
  readStore: async (name: string, fallback: unknown[]) => {
    if (readThrows) throw new Error("boom");
    return stored[name] ?? fallback ?? [];
  },
  writeStore: async (name: string, rows: unknown[]) => {
    stored[name] = rows;
  },
}));

import {
  isoWeekStart,
  investigationKey,
  writeInvestigation,
  hasRecentInvestigation,
  readInvestigationsForTenant,
  loadLatestInvestigations,
  type InvestigationRow,
} from "./investigation-store";
import type { InvestigationDiagnosis } from "./rank-causes";

beforeEach(() => {
  stored = {};
  readThrows = false;
});

const DIAGNOSIS: InvestigationDiagnosis = {
  familyLabel: "cheetah",
  collapseDate: "2026-06-20",
  headline: "The cheetah family lost about 60 percent of its clicks starting Jun 20.",
  causes: [],
  hasCause: false,
};

function row(over: Partial<InvestigationRow> = {}): InvestigationRow {
  return {
    tenant_id: "tenant-a",
    key: investigationKey("cheetah", "2026-06-20"),
    family: "cheetah",
    collapse_date: "2026-06-20",
    investigated_at: "2026-06-21T08:00:00.000Z",
    diagnosis: DIAGNOSIS,
    ...over,
  };
}

describe("isoWeekStart", () => {
  it("maps any day of a week to that week's Monday (UTC)", () => {
    expect(isoWeekStart("2026-06-20")).toBe("2026-06-15"); // Saturday -> Monday
    expect(isoWeekStart("2026-06-15")).toBe("2026-06-15"); // Monday -> itself
    expect(isoWeekStart("2026-06-21")).toBe("2026-06-15"); // Sunday -> prior Monday
    expect(isoWeekStart("2026-06-22")).toBe("2026-06-22"); // next Monday -> itself
  });
});

describe("investigationKey - idempotency unit", () => {
  it("two collapse dates in the SAME week produce the same key", () => {
    expect(investigationKey("cheetah", "2026-06-17")).toBe(investigationKey("cheetah", "2026-06-20"));
  });

  it("the same family in DIFFERENT weeks produces different keys", () => {
    expect(investigationKey("cheetah", "2026-06-20")).not.toBe(investigationKey("cheetah", "2026-06-27"));
  });

  it("different families in the same week produce different keys", () => {
    expect(investigationKey("cheetah", "2026-06-20")).not.toBe(investigationKey("lions", "2026-06-20"));
  });
});

describe("write + read round trip", () => {
  it("writes a row and reads it back for the tenant", async () => {
    await writeInvestigation(row());
    const rows = await readInvestigationsForTenant("tenant-a", new Date("2026-06-22T00:00:00.000Z"));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.family).toBe("cheetah");
  });

  it("re-writing the same (tenant, key) replaces rather than duplicates", async () => {
    await writeInvestigation(row());
    await writeInvestigation(row({ investigated_at: "2026-06-21T09:00:00.000Z" }));
    const rows = await readInvestigationsForTenant("tenant-a", new Date("2026-06-22T00:00:00.000Z"));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.investigated_at).toBe("2026-06-21T09:00:00.000Z");
  });

  it("never returns another tenant's rows", async () => {
    await writeInvestigation(row());
    const rows = await readInvestigationsForTenant("tenant-b", new Date("2026-06-22T00:00:00.000Z"));
    expect(rows).toEqual([]);
  });

  it("a diagnosis older than 30 days is not returned (honest staleness)", async () => {
    await writeInvestigation(row({ investigated_at: "2026-05-01T00:00:00.000Z" }));
    const rows = await readInvestigationsForTenant("tenant-a", new Date("2026-06-22T00:00:00.000Z"));
    expect(rows).toEqual([]);
  });
});

describe("hasRecentInvestigation - the runner's idempotency gate", () => {
  it("true after an investigation of the same family in the same week", async () => {
    await writeInvestigation(row());
    expect(await hasRecentInvestigation("tenant-a", "cheetah", "2026-06-18")).toBe(true);
  });

  it("false for the same family in a different week", async () => {
    await writeInvestigation(row());
    expect(await hasRecentInvestigation("tenant-a", "cheetah", "2026-06-27")).toBe(false);
  });

  it("false for a different tenant", async () => {
    await writeInvestigation(row());
    expect(await hasRecentInvestigation("tenant-b", "cheetah", "2026-06-20")).toBe(false);
  });

  it("fails soft to false on a read error (never blocks a fresh investigation)", async () => {
    readThrows = true;
    expect(await hasRecentInvestigation("tenant-a", "cheetah", "2026-06-20")).toBe(false);
  });
});

describe("loadLatestInvestigations - the Today card read", () => {
  it("caps at the requested limit, newest first", async () => {
    await writeInvestigation(row({ key: "a:2026-06-15", family: "a", investigated_at: "2026-06-21T01:00:00.000Z" }));
    await writeInvestigation(row({ key: "b:2026-06-15", family: "b", investigated_at: "2026-06-21T03:00:00.000Z" }));
    await writeInvestigation(row({ key: "c:2026-06-15", family: "c", investigated_at: "2026-06-21T02:00:00.000Z" }));
    const rows = await loadLatestInvestigations("tenant-a", 2, new Date("2026-06-22T00:00:00.000Z"));
    expect(rows.map((r) => r.family)).toEqual(["b", "c"]);
  });

  it("fails soft to [] on a read error", async () => {
    readThrows = true;
    expect(await loadLatestInvestigations("tenant-a", 2)).toEqual([]);
  });
});
