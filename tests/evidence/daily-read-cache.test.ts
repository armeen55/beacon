/** THE DAY'S HEAVY EVIDENCE IS COMPUTED ONCE, and a failure is never banked as the day's truth. The four  GSC/GA4 aggregates cost 1.6 to 6.3 seconds of PostgREST pool time each and were re-paid by every scheduler  tick (request-scoped cache() is a no-op outside a React request), which saturated the 9-connection pool,  stalled the customer release for 8+ hours and timed out the sign-in membership read on the same jam. */
import { describe, expect, it, vi, beforeEach } from "vitest";
const store = vi.hoisted(() => ({ rows: [] as unknown[], readFails: false }));
vi.mock("@/lib/persistence/json-store", () => ({
  readStore: async () => { if (store.readFails) throw new Error("store down"); return store.rows; },
  writeStore: async (_n: string, rows: unknown[]) => { store.rows = rows; },}));
vi.mock("@/lib/logger", () => ({ log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } }));
vi.mock("server-only", () => ({}));
import { readThroughDaily } from "@/domains/evidence/readers/daily-read-cache";

const read = (watermark: string | null, result: { payload: string; cacheable: boolean }, paid: string[]) =>
  readThroughDaily<string>({ tenantId: "t", kind: "gsc-signals", watermark,
    compute: async () => { paid.push(result.payload); return result; } });

describe("the day's heavy evidence is computed once per watermark", () => {
  beforeEach(() => { store.rows = []; store.readFails = false; });
  it("pays the aggregate once per watermark, banks no partial or failed read as the day's truth, and computes live while the probe or the store is down", async () => {
    const paid: string[] = [];
    expect([await read("2026-08-24", { payload: "monday", cacheable: true }, paid), await read("2026-08-24", { payload: "recomputed", cacheable: true }, paid)]).toEqual(["monday", "monday"]);
    expect(paid, "the second read paid nothing").toEqual(["monday"]);
    expect(await read("2026-08-25", { payload: "tuesday", cacheable: true }, paid)).toBe("tuesday"); // A sync lands new rows: the watermark moves, and only then is the aggregate paid again.
    // Both GA4 readers fail SOFT to a partial map, indistinguishable from an account with no traffic, so a read that says it is incomplete is served and never banked.
    expect([await read("2026-08-26", { payload: "truncated", cacheable: false }, paid), await read("2026-08-26", { payload: "whole", cacheable: true }, paid)]).toEqual(["truncated", "whole"]);
    store.rows = []; expect(await read(null, { payload: "live", cacheable: true }, paid)).toBe("live");
    expect(store.rows, "no watermark, nothing banked").toEqual([]);
    store.readFails = true; expect(await read("2026-08-24", { payload: "still live", cacheable: true }, paid)).toBe("still live");
    expect(paid).toEqual(["monday", "tuesday", "truncated", "whole", "live", "still live"]); });
  /** TWO LOADERS RUNNING TOGETHER MAY NOT ANSWER FOR EACH OTHER. One module-level completeness flag served both GA4 readers, which run inside the same Promise.all, so whichever started second reset it and a truncated aggregate banked under a valid watermark (Codex, 2026-08-28). Completeness travels with its own rows now. */
  it("keeps each concurrent loader's completeness apart", async () => {
    const one = (kind: string, complete: boolean, rows: number[]) => readThroughDaily<number[]>({
      tenantId: "t", kind, watermark: "w", compute: async () => { await new Promise((r) => setTimeout(r, complete ? 8 : 1)); return { payload: rows, cacheable: complete }; } });
    expect(await Promise.all([one("partial", false, [1]), one("whole", true, [2])])).toEqual([[1], [2]]); // the partial read starts FIRST and finishes LAST, exactly the interleaving the shared flag lost
    expect((store.rows as { kind?: string }[]).map((r) => r.kind).filter(Boolean), "only the complete read may be banked").toEqual(["whole"]); }); });
