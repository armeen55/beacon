import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
vi.mock("server-only", () => ({}));
const STORE = "customer-surface", WRITE = "results-surface";
type Write = { scope_key: string; content: unknown[] };
const durable = vi.hoisted(() => ({ rows: null as unknown, fail: false as boolean | string, keys: [] as string[], tables: [] as string[], writer: vi.fn<(row: Write) => Promise<{ data: unknown; error: unknown }>>() }));
vi.mock("@/lib/tenant-context", async (orig) => ({ ...(await orig() as object), slugForTenantId: async (id: string) => id }));
vi.mock("@/lib/persistence/supabase", () => ({ getSupabaseAdmin: () => ({ from: (table: string) => ({
  upsert: (row: Write) => ({ select: () => ({ maybeSingle: () => durable.writer(row) }) }),
  select: () => ({ eq: (_c: string, key: string) => {
    durable.tables.push(table); const query = { order: () => query, limit: () => query, maybeSingle: async () => {
      if (!key.startsWith(STORE) && !key.startsWith(WRITE)) return { data: null, error: null };
      durable.keys.push(key);
      if (durable.fail === "throw") throw new Error("client init failed");
      if (durable.fail) return { data: null, error: { message: "read unavailable", code: durable.fail === true ? "57014" : durable.fail } };
      return { data: durable.rows === undefined ? undefined : durable.rows === null ? null : { content: durable.rows }, error: null };
    } }; return query;
  } }),
}) }) }));
import { readStore, writeStore } from "@/lib/persistence/json-store";
const blobReads = (tenant: string) => durable.keys.filter(k => k.includes(tenant)).length;
const read = (tenantId: string, name = STORE, fallback: unknown[] = []) => readStore(name, fallback, { tenantId });
const write = (tenantId: string, content: unknown[]) => writeStore(WRITE, content, { tenantId });
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(1_000_000); durable.rows = null; durable.fail = false; durable.keys = []; durable.tables = [];
  durable.writer.mockReset().mockImplementation(async row => ({ data: { scope_key: row.scope_key }, error: null }));
});
afterEach(() => vi.useRealTimers());
const age = (ms: number) => vi.setSystemTime(Date.now() + ms);
describe("canonical saved array custody", () => {
  it("requires the atomic customer publisher and rejects obsolete fallback writers", async () => {
    await expect(writeStore(STORE, [], { tenantId: "t-one" })).rejects.toThrow("publishCustomerRelease");
    await expect(writeStore("shipped-changes", [], { tenantId: "t-one" })).rejects.toThrow("canonical repository");
    expect(durable.writer).not.toHaveBeenCalled();
  });
  it("keeps warm truth through bounded outage retries and takes the recovered release", async () => {
    const A = [{ release: "A" }], B = [{ release: "B" }]; durable.rows = A;
    expect(await read("warm")).toEqual(A);
    expect([durable.tables.includes("customer_surface_releases"), durable.tables.includes("json_store_blobs")]).toEqual([true, false]);
    for (const [elapsed, failing, rows, reads] of [[0, false, A, 1], [31000, true, A, 2], [1000, true, A, 2], [6000, true, A, 3], [31000, false, B, 4]] as const) {
      age(elapsed); durable.fail = failing; durable.rows = rows;
      expect(await read("warm")).toEqual(failing ? A : rows); expect(blobReads("warm")).toBe(reads);
    }
  });
  it("isolates tenants and never caches cold database failure as absence", async () => {
    durable.rows = [{ release: "A" }]; expect(await read("owner")).toEqual(durable.rows);
    durable.rows = null; const fallback = [{ release: "mine" }]; expect(await read("other", STORE, fallback)).toEqual(fallback);
    expect(await read("owner")).toEqual([{ release: "A" }]);
    for (const [i, failure] of [true, "PGRST205", "42P01", "throw", "malformed", "undefined"].entries()) {
      durable.fail = failure === "malformed" || failure === "undefined" ? false : failure;
      durable.rows = failure === "malformed" ? {} : failure === "undefined" ? undefined : null;
      await expect(read(`cold-${i}`, STORE, fallback)).rejects.toThrow("unavailable");
      durable.fail = false; durable.rows = []; expect(await read(`cold-${i}`, STORE, fallback)).toEqual([]);
    }
  });
  it("retains acknowledged rows on missing, foreign, failed and lost write responses, then recovers", async () => {
    await write("writes", ["A"]);
    for (const result of [{ data: null, error: null }, { data: { scope_key: "foreign" }, error: null }, { data: null, error: { message: "unavailable" } }, new Error("lost response")]) {
      durable.writer.mockImplementationOnce(async () => { if (result instanceof Error) throw result; return result; });
      await expect(write("writes", ["B"])).rejects.toThrow(); expect(await read("writes", WRITE)).toEqual(["A"]);
    }
    await write("writes", ["C"]); expect(await read("writes", WRITE)).toEqual(["C"]);
  });
  it("serializes one scope without blocking another, binding the submitted content before acknowledgement", async () => {
    await write("serial", ["A"]); let release!: () => void, entered!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
    durable.writer.mockImplementation(async row => { if (row.content[0] === "B") { entered(); await held; } return { data: { scope_key: row.scope_key }, error: null }; });
    const B = ["B"], first = write("serial", B); B[0] = "mutated"; await started; const second = write("serial", ["C"]);
    await write("neighbour", ["D"]); expect(await read("serial", WRITE)).toEqual(["A"]); expect(await read("neighbour", WRITE)).toEqual(["D"]);
    expect(durable.writer.mock.calls.map(([row]) => row.content[0])).toEqual(["A", "B", "D"]);
    release(); await Promise.all([first, second]); expect(await read("serial", WRITE)).toEqual(["C"]);
    expect(durable.writer.mock.calls.map(([row]) => row.content[0])).toEqual(["A", "B", "D", "C"]);
  });
});
