/** The day's heavy evidence is computed once per watermark, and failed or partial reads are never banked. */
import { describe, expect, it, vi, beforeEach } from "vitest";
const store = vi.hoisted(() => ({ rows: [] as unknown[], readFails: false, reads: [] as string[], failKind: "" }));
vi.mock("@/lib/persistence/json-store", () => ({
  readStore: async (_n: string, _empty: unknown, scope: { tenantId: string; forceRefresh?: boolean }) => { store.reads.push(`${scope.tenantId}${scope.forceRefresh ? ":refresh" : ""}`); await Promise.resolve(); if (store.readFails) throw new Error("store down"); return store.rows; },
  writeStore: async (_n: string, rows: { kind?: string; watermark?: string }[]) => { if (rows.some(row => row.kind === store.failKind && row.watermark === "w")) throw new Error("write not acknowledged"); store.rows = rows; },}));
vi.mock("@/lib/logger", () => ({ log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } }));
import { readThroughDaily } from "@/domains/evidence/readers/daily-read-cache";
const read = (watermark: string | null, result: { payload: string; cacheable: boolean }, paid: string[]) =>
  readThroughDaily<string>({ tenantId: "t", kind: "gsc-signals", watermark,
    compute: async () => { paid.push(result.payload); return result; } });
describe("the day's heavy evidence is computed once per watermark", () => {
  beforeEach(() => { store.rows = []; store.readFails = false; store.reads = []; store.failKind = ""; });
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
    const one = (tenantId: string, kind: string, complete: boolean, rows: number[]) => readThroughDaily<number[]>({
      tenantId, kind, watermark: "w", compute: async () => { await new Promise((r) => setTimeout(r, complete ? 8 : 1)); return { payload: rows, cacheable: complete }; } });
    store.rows = [{ tenant_id: "t", kind: "bank", watermark: "w", payload: [3] }, { tenant_id: "u", kind: "bank", watermark: "w", payload: [4] }];
    expect([await Promise.all([one("t", "bank", false, [0]), one("t", "bank", false, [0]), one("u", "bank", false, [0])]), store.reads]).toEqual([[[3], [3], [4]], ["t", "u"]]);
    store.readFails = true; expect(await Promise.all([one("t", "bank", false, [5]), one("t", "bank", false, [6])])).toEqual([[5], [6]]);
    store.readFails = false; expect(await one("t", "bank", false, [0])).toEqual([3]);
    store.rows = mode === "refused" ? [{ tenant_id: "t", kind: "partial", watermark: "prior", payload: [9] }] : []; store.failKind = mode === "refused" ? "partial" : "";
    expect(await Promise.all([one("t", "partial", mode !== "partial", [1]), one("t", "whole", true, [2])])).toEqual([[1], [2]]);
    expect([await one("t", "whole", false, [0]), (store.rows as { kind: string; watermark: string; payload: number[] }[]).map(row => [row.kind, row.watermark, row.payload])]).toEqual([[2], [...(mode === "partial" ? [] : [["partial", mode === "refused" ? "prior" : "w", mode === "refused" ? [9] : [1]]]), ["whole", "w", [2]]]]); }); });
