/** THE COMPLETE PAGE-QUERY UNIVERSE FOR DECISION (Codex, 2026-08-21): pages through everything, a bound that cuts says so, and a failed read is corroboration UNKNOWN, never an account Google holds nothing for. */
import { beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({ pages: [] as Array<Array<{ query: string }>>, fail: false, calls: 0 }));
vi.mock("@/lib/persistence/supabase", () => ({
  getSupabaseAdmin: () => ({
    rpc: () => ({
      range: async (from: number) => {
        env.calls += 1;
        if (env.fail) return { data: null, error: { message: "statement timeout" } };
        return { data: env.pages[Math.floor(from / 1000)] ?? [], error: null };
      },
    }),
  }),
}));
import { loadGscQueryUniverse } from "@/domains/evidence/readers/gsc-query-universe";

const NOW = () => new Date("2026-08-21T12:00:00Z");
beforeEach(() => { vi.resetModules(); env.pages = []; env.fail = false; env.calls = 0; });

describe("the complete query universe for Decision", () => {
  it("pages through every pair and canonicalizes the keys the corroboration ask joins on", async () => {
    env.pages = [Array.from({ length: 1000 }, (_v, i) => ({ query: `search number ${i}` })), [{ query: "Haft Seen Table?" }]];
    const u = await loadGscQueryUniverse("t-universe-a", NOW()); expect(u?.pairs).toBe(1001);
    expect(u?.incomplete).toBe(false);
    expect(env.calls).toBe(2); // it kept reading past the first page
    const { canonicalQueryKey } = await import("@/domains/evidence/relevance-gate");
    expect(u?.keys.has(canonicalQueryKey("haft seen table"))).toBe(true); // capitals and punctuation are the same search
  });
  it("hands back null on a failed read, never an empty universe", async () => {
    env.fail = true;
    expect(await loadGscQueryUniverse("t-universe-b", NOW())).toBeNull();
  });
  it("reads once per tenant per reporting day, because the universe changes when the sync lands", async () => {
    env.pages = [[{ query: "one" }]];
    await loadGscQueryUniverse("t-universe-c", NOW()); await loadGscQueryUniverse("t-universe-c", NOW());
    expect(env.calls).toBe(1);
  });
});
