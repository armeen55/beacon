/**
 * DataForSEO env truth + the ONE shared HTTP transport core. The money policy
 * (configured / dry-run / breaker / atomic reservation / single-flight cache)
 * is pinned end to end in tests/sources/evidence-cache.test.ts; this file pins
 * what every call shares: credential resolution, the dry-run DEFAULT, the
 * fail-safe monthly cap, and transport status/cost extraction.
 */
import { describe, it, expect, vi } from "vitest";
import {
  isDataForSeoConfigured, isDryRun, monthlyCapUsd, resolveAuthB64,
  runDataForSeoTransport, DEFAULT_MONTHLY_CAP_USD,
} from "@/domains/evidence/dataforseo/client";

const ENV = { BEACON_SERP_PROVIDER: "dataforseo", DATAFORSEO_LOGIN: "u", DATAFORSEO_PASSWORD: "p" } as unknown as NodeJS.ProcessEnv;

describe("DataForSEO env truth", () => {
  it("configured requires the provider selection AND usable auth; base64 wins over login/password", () => {
    expect(isDataForSeoConfigured(ENV)).toBe(true);
    expect(isDataForSeoConfigured({ ...ENV, BEACON_SERP_PROVIDER: undefined } as never)).toBe(false);
    expect(isDataForSeoConfigured({ BEACON_SERP_PROVIDER: "dataforseo" } as never)).toBe(false);
    expect(resolveAuthB64({ ...ENV, DATAFORSEO_AUTH_B64: "Basic abc123" } as never)).toBe("abc123"); // prefix stripped, used verbatim
    expect(resolveAuthB64(ENV)).toBe(Buffer.from("u:p").toString("base64"));
  });
  it("dry-run is the DEFAULT (only an explicit false disables) and the cap never resolves to unlimited", () => {
    expect(isDryRun(ENV)).toBe(true);
    expect(isDryRun({ ...ENV, DATAFORSEO_DRY_RUN: "false" } as never)).toBe(false);
    expect(monthlyCapUsd(ENV)).toBe(DEFAULT_MONTHLY_CAP_USD);
    expect(monthlyCapUsd({ ...ENV, DATAFORSEO_MONTHLY_CAP_USD: "12.5" } as never)).toBe(12.5);
    expect(monthlyCapUsd({ ...ENV, DATAFORSEO_MONTHLY_CAP_USD: "-3" } as never)).toBe(DEFAULT_MONTHLY_CAP_USD); // never unlimited
  });
});

describe("the shared transport core", () => {
  it("returns the body with the provider-reported cost (falling back to the estimate) and never throws", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ cost: 0.004, tasks: [] }), { status: 200 }));
    const ok = await runDataForSeoTransport({ url: "https://x/v3/e", payload: [], estCostUsd: 0.01, env: ENV, fetchImpl: fetchImpl as never });
    expect(ok).toEqual({ ok: true, body: { cost: 0.004, tasks: [] }, costUsd: 0.004 });
    const noCost = await runDataForSeoTransport({ url: "https://x/v3/e", payload: [], estCostUsd: 0.01, env: ENV, fetchImpl: (async () => new Response("{}", { status: 200 })) as never });
    expect(noCost.ok && noCost.costUsd).toBe(0.01); // unreported cost -> conservative estimate
    const bad = await runDataForSeoTransport({ url: "https://x/v3/e", payload: [], estCostUsd: 0.01, env: ENV, fetchImpl: (async () => new Response("x", { status: 500 })) as never });
    expect(bad).toEqual({ ok: false, status: 500, message: "http 500" });
    const threw = await runDataForSeoTransport({ url: "https://x/v3/e", payload: [], estCostUsd: 0.01, env: ENV, fetchImpl: (async () => { throw new Error("net down"); }) as never });
    expect(threw.ok).toBe(false);
  });
  it("GET mode sends no body (the free Standard task_get path)", async () => {
    let captured: RequestInit | undefined;
    const fetchImpl = vi.fn(async (_u: string, init?: RequestInit) => { captured = init; return new Response("{}", { status: 200 }); });
    await runDataForSeoTransport({ url: "https://x/v3/task_get/1", payload: [], estCostUsd: 0, env: ENV, fetchImpl: fetchImpl as never, method: "GET" });
    expect(captured?.method).toBe("GET");
    expect(captured?.body).toBeUndefined();
  });
});
