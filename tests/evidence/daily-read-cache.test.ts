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

  it("pays the aggregate once and serves the banked row until the data itself moves", async () => {
    const paid: string[] = [];
    expect(await read("2026-08-24", { payload: "monday", cacheable: true }, paid)).toBe("monday");
    expect(await read("2026-08-24", { payload: "recomputed", cacheable: true }, paid)).toBe("monday");
    expect(paid, "the second read paid nothing").toEqual(["monday"]);
    // A sync lands new rows: the watermark moves, and only then is the aggregate paid again.
    expect(await read("2026-08-25", { payload: "tuesday", cacheable: true }, paid)).toBe("tuesday");
    expect(paid).toEqual(["monday", "tuesday"]); });

  it("never banks a partial or failed read as the day's truth", async () => {
    // Both GA4 readers fail SOFT to a partial map, indistinguishable from an account with no traffic. Cached,
    const paid: string[] = [];
    expect(await read("2026-08-24", { payload: "truncated", cacheable: false }, paid)).toBe("truncated");
    expect(await read("2026-08-24", { payload: "whole", cacheable: true }, paid)).toBe("whole");
    expect(paid, "the failed read was not banked, so the next read paid again").toEqual(["truncated", "whole"]); });

  it("computes live and banks nothing when the watermark probe or the store is down", async () => {
    const paid: string[] = [];
    expect(await read(null, { payload: "live", cacheable: true }, paid)).toBe("live");
    expect(store.rows, "no watermark, nothing banked").toEqual([]);
    store.readFails = true;
    expect(await read("2026-08-24", { payload: "still live", cacheable: true }, paid)).toBe("still live");
    expect(paid).toEqual(["live", "still live"]); }); });

/** TWO LOADERS RUNNING TOGETHER MAY NOT ANSWER FOR EACH OTHER. One module-level completeness flag served both  GA4 readers, which run inside the same Promise.all, so whichever started second reset it and a truncated  aggregate banked under a valid watermark (Codex, 2026-08-28). Completeness travels with its own rows now. */
describe("a truncated read never banks as the day's truth", () => {
  it("keeps each concurrent loader's completeness apart", async () => {
    store.rows = []; store.readFails = false;
    const read = (kind: string, complete: boolean, rows: number[]) => readThroughDaily<number[]>({
      tenantId: "t", kind, watermark: "w", compute: async () => { await new Promise((r) => setTimeout(r, complete ? 8 : 1)); return { payload: rows, cacheable: complete }; } });
    // The partial read starts FIRST and finishes LAST, exactly the interleaving the shared flag lost.
    const [partial, whole] = await Promise.all([read("partial", false, [1]), read("whole", true, [2])]);
    expect([partial, whole]).toEqual([[1], [2]]);
    const banked = (store.rows as { kind?: string }[]).map((r) => r.kind).filter(Boolean);
    expect(banked, "only the complete read may be banked").toEqual(["whole"]); }); });
