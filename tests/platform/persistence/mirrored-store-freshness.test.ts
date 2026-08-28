/** A FAILED REFRESH MAY NOT REPLACE SAVED TRUTH WITH NOTHING. A mirrored slot ages out after its TTL and the  durable read then answered `null` to both "no row" and "could not be read", so one transient Supabase  failure sent the read to a file hosted does not have, then to the caller's `[]`, which was cached and  stamped freshly read: a saved release could vanish from Today and Changes for a TTL while valid truth sat  in hand. Behavioural, on the real readStore: an injected clock ages the slot and a seam fails the read. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
vi.mock("server-only", () => ({}));
const STORE = "customer-surface";
const durable = vi.hoisted(() => ({ rows: null as unknown[] | null, fail: false as boolean | string, keys: [] as string[] }));
// Path resolution asks for a tenant's slug; that is not what this test is about, so it answers deterministically.
vi.mock("@/lib/tenant-context", async (orig) => ({ ...(await orig() as object), slugForTenantId: async (id: string) => id }));
vi.mock("@/lib/persistence/supabase", () => ({
  getSupabaseAdmin: () => ({
    from: () => ({ select: () => ({ eq: (_c: string, key: string) => ({ maybeSingle: async () => {
      // ONLY the store under test answers here; every other key a path resolution touches reads as "no row", so this fixture cannot accidentally reshape where the store resolves to.
      if (!String(key).startsWith(STORE)) return { data: null, error: null };
      durable.keys.push(String(key));
      if (durable.fail) return durable.fail === true ? { data: null, error: { message: "read timed out", code: "57014" } }
        : durable.fail === "throw" ? Promise.reject(new Error("client init failed"))
          : { data: null, error: { message: "schema cache stale", code: durable.fail } };
      return { data: durable.rows == null ? null : { content: durable.rows }, error: null };
    } }) }) }),
  }),
}));
/** How many times the DURABLE BLOB for this key was asked for, ignoring any other read a path resolution makes. */
const blobReads = (tenant: string): number => durable.keys.filter((k) => k.includes(tenant)).length;
import { readStore } from "@/lib/persistence/json-store";

let clock = 1_000_000;
beforeEach(() => { clock = 1_000_000; vi.useFakeTimers(); vi.setSystemTime(clock); durable.rows = null; durable.fail = false; durable.keys = []; });
afterEach(() => { vi.useRealTimers(); });
const age = (ms: number) => { clock += ms; vi.setSystemTime(clock); };

describe("a mirrored store refreshes, and a failed refresh keeps the last known good", () => {
  it("holds row A through an outage, retries in a bounded way, and takes row B when the durable read returns", async () => {
    const A = [{ release: "A" }], B = [{ release: "B" }];
    durable.rows = A;
    expect(await readStore(STORE, [], { tenantId: "t-one" }), "the saved release is read and cached").toEqual(A);
    const first = blobReads("t-one");
    expect(first, "the durable blob was asked for once").toBe(1);

    expect(await readStore(STORE, [], { tenantId: "t-one" })).toEqual(A);
    expect(blobReads("t-one"), "a warm slot asks the durable store nothing").toBe(first);

    // The slot ages out and the durable read FAILS: the previous truth stands, and [] never becomes the answer.
    age(31_000); durable.fail = true;
    expect(await readStore(STORE, [], { tenantId: "t-one" }), "a failed refresh keeps the last known good").toEqual(A);
    const afterOutage = blobReads("t-one");
    expect(afterOutage, "and it did try").toBe(first + 1);

    age(1_000);
    expect(await readStore(STORE, [], { tenantId: "t-one" })).toEqual(A);
    expect(blobReads("t-one"), "the failure is not retried on every read").toBe(afterOutage);

    age(6_000);
    expect(await readStore(STORE, [], { tenantId: "t-one" })).toEqual(A);
    expect(blobReads("t-one"), "but it does try again").toBe(afterOutage + 1);

    // The durable store comes back with newer rows: the stale copy is replaced.
    age(31_000); durable.fail = false; durable.rows = B;
    expect(await readStore(STORE, [], { tenantId: "t-one" }), "a successful refresh replaces the stale rows").toEqual(B);
    expect(await readStore(STORE, [], { tenantId: "t-one" })).toEqual(B); });

  it("never hands one tenant another tenant's rows, and a cold missing store still gets its fallback", async () => {
    durable.rows = [{ release: "A" }];
    expect(await readStore(STORE, [], { tenantId: "t-three" })).toEqual([{ release: "A" }]);
    durable.rows = null; // the durable store has no row for this other tenant, and the read SUCCEEDS
    const fallback = [{ release: "mine" }];
    expect(await readStore(STORE, fallback, { tenantId: "t-four" }), "a cold key falls back, never to a neighbour's rows").toEqual(fallback);
    durable.rows = [{ release: "A" }];
    expect(await readStore(STORE, [], { tenantId: "t-three" }), "and the first tenant is untouched").toEqual([{ release: "A" }]);
    // COLD AND UNAVAILABLE stays fail-closed: the fallback, never fabricated rows; and the module exports no test clock, the fake timers above being the seam.
    durable.fail = "PGRST205";
    expect(await readStore(STORE, [{ release: "cold" }], { tenantId: "t-five" }), "a cold error falls back").toEqual([{ release: "cold" }]);
    expect((await import("@/lib/persistence/json-store") as Record<string, unknown>).__setStoreClock, "no public clock seam").toBeUndefined(); }); });
