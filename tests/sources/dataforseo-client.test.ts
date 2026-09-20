/** DataForSEO env truth + the ONE shared HTTP transport core. The atomic money policy is pinned in evidence-cache.test; this file pins credentials, the fail-safe cap, and transport envelopes. */
import { describe, it, expect, vi } from "vitest";
import { isDataForSeoConfigured, monthlyCapUsd, resolveAuthB64, runDataForSeoTransport, DEFAULT_MONTHLY_CAP_USD } from "@/domains/evidence/dataforseo/client";
const ENV = { DATAFORSEO_LOGIN: "u", DATAFORSEO_PASSWORD: "p" } as unknown as NodeJS.ProcessEnv;
describe("DataForSEO env truth", () => {
  it("usable auth is the complete configuration; base64 wins over login/password", () => {
    expect(isDataForSeoConfigured(ENV)).toBe(true); expect(isDataForSeoConfigured({} as never)).toBe(false);
    expect(resolveAuthB64({ ...ENV, DATAFORSEO_AUTH_B64: "Basic abc123" } as never)).toBe("abc123"); // prefix stripped, used verbatim
    expect(resolveAuthB64(ENV)).toBe(Buffer.from("u:p").toString("base64")); });
  it("the cap never resolves to unlimited", () => {
    expect(monthlyCapUsd(ENV)).toBe(DEFAULT_MONTHLY_CAP_USD); expect(monthlyCapUsd({ ...ENV, DATAFORSEO_MONTHLY_CAP_USD: "12.5" } as never)).toBe(12.5);
    expect(monthlyCapUsd({ ...ENV, DATAFORSEO_MONTHLY_CAP_USD: "-3" } as never)).toBe(DEFAULT_MONTHLY_CAP_USD); // never unlimited
  });});
describe("the shared transport core", () => {
  it("returns the provider body without inventing a missing cost and never throws", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ cost: 0.004, tasks: [] }), { status: 200 }));
    const ok = await runDataForSeoTransport({ url: "https://x/v3/e", payload: [], env: ENV, fetchImpl: fetchImpl as never }); expect(ok).toEqual({ ok: true, body: { cost: 0.004, tasks: [] } });
    const noCost = await runDataForSeoTransport({ url: "https://x/v3/e", payload: [], env: ENV, fetchImpl: (async () => new Response("{}", { status: 200 })) as never }); expect(noCost).toEqual({ ok: true, body: {} });
    const bad = await runDataForSeoTransport({ url: "https://x/v3/e", payload: [], env: ENV, fetchImpl: (async () => new Response("x", { status: 500 })) as never });
    expect(bad).toEqual({ ok: false, status: 500, message: "http 500" });
    const threw = await runDataForSeoTransport({ url: "https://x/v3/e", payload: [], env: ENV, fetchImpl: (async () => { throw new Error("net down"); }) as never }); expect(threw.ok).toBe(false); });
  it("GET mode sends no body (the free Standard task_get path)", async () => {
    let captured: RequestInit | undefined; const fetchImpl = vi.fn(async (_u: string, init?: RequestInit) => { captured = init; return new Response("{}", { status: 200 }); });
    await runDataForSeoTransport({ url: "https://x/v3/task_get/1", payload: [], env: ENV, fetchImpl: fetchImpl as never, method: "GET" }); expect(captured?.method).toBe("GET"); expect(captured?.body).toBeUndefined(); });
});
describe("free task collection admission", () => {
  it("selects only elapsed poll clocks, oldest first and bounded", async () => { vi.resetModules(); const now = Date.now(), rows = [{ cache_key: "due-2", next_poll_at: new Date(now - 1).toISOString() }, { cache_key: "future", next_poll_at: new Date(now + 60_000).toISOString() }, { cache_key: "due-1", next_poll_at: new Date(now - 2).toISOString() }];
    vi.doMock("@/lib/persistence/supabase", () => ({ getSupabaseAdmin: () => ({ from: () => { let eligible = rows; const q = { select: () => q, eq: () => q, not: () => q, or: () => (eligible = rows.filter((r) => r.next_poll_at <= new Date(now).toISOString()), q), order: () => q, limit: async (n: number) => ({ data: [...eligible].sort((a, b) => a.next_poll_at.localeCompare(b.next_poll_at)).slice(0, n), error: null }) }; return q; } }) }));
    const { pendingProviderTaskKeys } = await import("@/domains/evidence/dataforseo/default-deps"); expect(await pendingProviderTaskKeys(2)).toEqual(["due-1", "due-2"]); vi.doUnmock("@/lib/persistence/supabase"); vi.resetModules(); });
});
