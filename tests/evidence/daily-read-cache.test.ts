import { describe, expect, it, vi, beforeEach } from "vitest";
const store = vi.hoisted(() => ({ rows: [] as unknown[], readFails: false, reads: [] as string[], failKind: "" }));
vi.mock("@/lib/persistence/json-store", () => ({
  readStore: async (_n: string, _empty: unknown, scope: { tenantId: string; forceRefresh?: boolean }) => { store.reads.push(`${scope.tenantId}${scope.forceRefresh ? ":refresh" : ""}`); await Promise.resolve(); if (store.readFails) throw new Error("store down"); return store.rows; },
  writeStore: async (_n: string, [row]: { tenant_id: string; kind: string; watermark: string }[]) => {
    if (row.kind === store.failKind) throw new Error("write not acknowledged");
    store.rows = [...store.rows.filter(saved => (saved as typeof row).tenant_id !== row.tenant_id || (saved as typeof row).kind !== row.kind), row]; return store.rows; },}));
vi.mock("@/lib/logger", () => ({ log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } }));
import { readThroughDaily } from "@/domains/evidence/readers/daily-read-cache";
const read = (watermark: string | null, result: { payload: string; cacheable: boolean }, paid: string[]) =>
  readThroughDaily<string>({ tenantId: "t", kind: "gsc-signals", watermark,
    compute: async () => { paid.push(result.payload); return result; } });
describe("the day's heavy evidence is computed once per watermark", () => {
  beforeEach(() => { vi.resetModules(); store.rows = []; store.readFails = false; store.reads = []; store.failKind = ""; });
  it("banks only complete watermarked reads, reuses the bank, and computes live when the probe or store fails", async () => {
    const paid: string[] = [];
    for (const [watermark, payload, cacheable, expected] of [
      ["2026-08-24", "monday", true, "monday"], ["2026-08-24", "recomputed", true, "monday"],
      ["2026-08-25", "tuesday", true, "tuesday"], ["2026-08-26", "truncated", false, "truncated"],
      ["2026-08-26", "whole", true, "whole"],
    ] as const) expect(await read(watermark, { payload, cacheable }, paid)).toBe(expected);
    store.rows = []; expect([await read(null, { payload: "live", cacheable: true }, paid), store.rows]).toEqual(["live", []]);
    store.readFails = true; expect(await read("2026-08-24", { payload: "still live", cacheable: true }, paid)).toBe("still live");
    expect(paid).toEqual(["monday", "tuesday", "truncated", "whole", "live", "still live"]); });
  it.each(["partial", "complete", "refused"])("shares tenant reads and merges only acknowledged complete writes (%s)", async mode => {
    const one = async (tenantId: string, kind: string, complete: boolean, rows: number[]) => (kind === "ga4-values" ? (await import("@/domains/evidence/readers/daily-read-cache")).readThroughDaily : readThroughDaily)<number[]>({
      tenantId, kind, watermark: "2026-10-01", compute: async () => { await new Promise((r) => setTimeout(r, complete ? 8 : 1)); return { payload: rows, cacheable: complete }; } });
    store.rows = [{ tenant_id: "t", kind: "gsc-signals", watermark: "2026-10-01", payload: [3] }, { tenant_id: "u", kind: "gsc-signals", watermark: "2026-10-01", payload: [4] }];
    expect([await Promise.all([one("t", "gsc-signals", false, [0]), one("t", "gsc-signals", false, [0]), one("u", "gsc-signals", false, [0])]), store.reads]).toEqual([[[3], [3], [4]], ["t", "u"]]);
    store.readFails = true; expect(await Promise.all([one("t", "gsc-signals", false, [5]), one("t", "gsc-signals", false, [6])])).toEqual([[5], [6]]);
    store.readFails = false; expect(await one("t", "gsc-signals", false, [0])).toEqual([3]);
    store.rows = mode === "refused" ? [{ tenant_id: "t", kind: "gsc-signals", watermark: "2026-09-30", payload: [9] }] : []; store.failKind = mode === "refused" ? "gsc-signals" : "";
    expect(await Promise.all([one("t", "gsc-signals", mode !== "partial", [1]), one("t", "ga4-values", true, [2])])).toEqual([[1], [2]]);
    expect([await one("t", "ga4-values", false, [0]), (store.rows as { kind: string; watermark: string; payload: number[] }[]).map(row => [row.kind, row.watermark, row.payload])]).toEqual([[2], [...(mode === "partial" ? [] : [["gsc-signals", mode === "refused" ? "2026-09-30" : "2026-10-01", mode === "refused" ? [9] : [1]]]), ["ga4-values", "2026-10-01", [2]]]]); }); });
