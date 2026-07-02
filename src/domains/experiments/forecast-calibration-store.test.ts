/**
 * forecast-calibration-store (2026-07-02, master plan items 27/28).
 *
 * Round-trip on an in-memory json-store + idempotency (a pick is calibrated exactly once) +
 * the registration pins that make the store real: GLOBAL classification (fan-out, rows carry
 * tenant_id) and the Supabase mirror entry (Vercel durability).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

let stored: unknown[] = [];
vi.mock("@/lib/persistence/json-store", () => ({
  readStore: async () => stored,
  writeStore: async (_name: string, data: unknown[]) => {
    stored = data;
  },
}));

import {
  buildCalibrationRecord,
  loadCalibrationRecords,
  hasCalibrationRecord,
  appendCalibrationRecord,
  type CalibrationRecord,
} from "./forecast-calibration-store";
import { classifyStore } from "@/lib/persistence/store-classification";

beforeEach(() => {
  stored = [];
});

describe("registration pins", () => {
  it("forecast-calibration is a GLOBAL store (fan-out; rows carry tenant_id)", () => {
    expect(classifyStore("forecast-calibration")).toBe("global");
  });

  it("forecast-calibration is Supabase-mirrored (survives Vercel read-only fs)", () => {
    const src = readFileSync(resolve(__dirname, "../../lib/persistence/json-store.ts"), "utf8");
    const mirrorBlock = src.slice(src.indexOf("SUPABASE_MIRRORED_STORES"), src.indexOf("BLOBS_TABLE"));
    expect(mirrorBlock).toContain('"forecast-calibration"');
  });
});

describe("buildCalibrationRecord", () => {
  it("classifies inside/above/below from the forecast range", () => {
    const inside = buildCalibrationRecord({ pickId: "p1", tenantId: "t", proofId: "p1::x", page: "u", lever: "meta", forecastLow: 10, forecastHigh: 30, actual: 20, at: "2026-06-29T00:00:00Z" });
    expect(inside.outcome).toBe("inside");
    const above = buildCalibrationRecord({ pickId: "p2", tenantId: "t", proofId: "p2::x", page: "u", lever: "meta", forecastLow: 10, forecastHigh: 30, actual: 40, at: "2026-06-29T00:00:00Z" });
    expect(above.outcome).toBe("above");
    const below = buildCalibrationRecord({ pickId: "p3", tenantId: "t", proofId: "p3::x", page: "u", lever: "meta", forecastLow: 10, forecastHigh: 30, actual: 2, at: "2026-06-29T00:00:00Z" });
    expect(below.outcome).toBe("below");
  });

  it("boundary values count as inside (inclusive range)", () => {
    const low = buildCalibrationRecord({ pickId: "p1", tenantId: "t", proofId: "p1::x", page: "u", lever: "meta", forecastLow: 10, forecastHigh: 30, actual: 10, at: "t" });
    const high = buildCalibrationRecord({ pickId: "p2", tenantId: "t", proofId: "p2::x", page: "u", lever: "meta", forecastLow: 10, forecastHigh: 30, actual: 30, at: "t" });
    expect(low.outcome).toBe("inside");
    expect(high.outcome).toBe("inside");
  });
});

describe("round-trip", () => {
  it("appends and reads back a calibration record for the right tenant", async () => {
    const r = buildCalibrationRecord({ pickId: "p1", tenantId: "tenant-a", proofId: "p1::x", page: "https://s.com/a", lever: "meta", forecastLow: 20, forecastHigh: 60, actual: 40, at: "2026-06-29T00:00:00Z" });
    const wrote = await appendCalibrationRecord(r);
    expect(wrote).toBe(true);
    const rows = await loadCalibrationRecords("tenant-a");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.pickId).toBe("p1");
    expect(rows[0]!.outcome).toBe("inside");
  });

  it("scopes reads to the requesting tenant only", async () => {
    await appendCalibrationRecord(buildCalibrationRecord({ pickId: "p1", tenantId: "tenant-a", proofId: "x", page: "u", lever: "meta", forecastLow: 1, forecastHigh: 2, actual: 1, at: "t" }));
    await appendCalibrationRecord(buildCalibrationRecord({ pickId: "p2", tenantId: "tenant-b", proofId: "x", page: "u", lever: "meta", forecastLow: 1, forecastHigh: 2, actual: 1, at: "t" }));
    expect(await loadCalibrationRecords("tenant-a")).toHaveLength(1);
    expect(await loadCalibrationRecords("tenant-b")).toHaveLength(1);
  });

  it("idempotent: appending a second record for the same pick is a no-op (never overwrites)", async () => {
    const first = buildCalibrationRecord({ pickId: "p1", tenantId: "t", proofId: "x", page: "u", lever: "meta", forecastLow: 10, forecastHigh: 30, actual: 20, at: "2026-06-01T00:00:00Z" });
    const second = buildCalibrationRecord({ pickId: "p1", tenantId: "t", proofId: "x", page: "u", lever: "meta", forecastLow: 999, forecastHigh: 999, actual: 999, at: "2026-07-01T00:00:00Z" });
    expect(await appendCalibrationRecord(first)).toBe(true);
    expect(await appendCalibrationRecord(second)).toBe(false);
    const rows = await loadCalibrationRecords("t");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actual).toBe(20); // the FIRST write stands - never mutated
  });

  it("hasCalibrationRecord reflects the idempotency guard", async () => {
    expect(await hasCalibrationRecord("t", "p1")).toBe(false);
    await appendCalibrationRecord(buildCalibrationRecord({ pickId: "p1", tenantId: "t", proofId: "x", page: "u", lever: "meta", forecastLow: 1, forecastHigh: 2, actual: 1, at: "t" }));
    expect(await hasCalibrationRecord("t", "p1")).toBe(true);
  });

  it("read is fail-soft: a throwing store reads as an empty list", async () => {
    const mod = await import("@/lib/persistence/json-store");
    const spy = vi.spyOn(mod, "readStore").mockRejectedValueOnce(new Error("disk gone"));
    expect(await loadCalibrationRecords("t")).toEqual([]);
    spy.mockRestore();
  });

  it("write is fail-soft: a throwing store returns false, never throws", async () => {
    const mod = await import("@/lib/persistence/json-store");
    const spy = vi.spyOn(mod, "writeStore").mockRejectedValueOnce(new Error("disk gone"));
    const r = buildCalibrationRecord({ pickId: "p1", tenantId: "t", proofId: "x", page: "u", lever: "meta", forecastLow: 1, forecastHigh: 2, actual: 1, at: "t" });
    await expect(appendCalibrationRecord(r)).resolves.toBe(false);
    spy.mockRestore();
  });
});

describe("never mutates existing rows on append (additive-only ledger)", () => {
  it("keeps every prior record byte-identical after a new append", async () => {
    const a: CalibrationRecord = buildCalibrationRecord({ pickId: "p1", tenantId: "t", proofId: "x", page: "u", lever: "meta", forecastLow: 10, forecastHigh: 30, actual: 20, at: "2026-06-01T00:00:00Z" });
    await appendCalibrationRecord(a);
    const before = JSON.stringify((await loadCalibrationRecords("t"))[0]);
    await appendCalibrationRecord(buildCalibrationRecord({ pickId: "p2", tenantId: "t", proofId: "y", page: "u", lever: "title", forecastLow: 5, forecastHigh: 15, actual: 10, at: "2026-06-02T00:00:00Z" }));
    const after = (await loadCalibrationRecords("t")).find((r) => r.pickId === "p1");
    expect(JSON.stringify(after)).toBe(before);
  });
});
