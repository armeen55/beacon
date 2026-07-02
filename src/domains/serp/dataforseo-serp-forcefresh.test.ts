import { describe, it, expect, vi } from "vitest";

import { runSerpQuery, type SerpRunDeps } from "./dataforseo-serp";
import type { SerpSnapshot } from "./serp-provider";

/**
 * Item 19: forceFresh is a minimal, additive bypass of the 14-day cache on
 * runSerpQuery - used by the rank re-check pass so a day-7/14/28 "now" read is
 * never served a stale cached snapshot from before the ship. The full safety
 * gauntlet (configured / dry-run / cap / ledger) still applies; ONLY the cache
 * read is skipped.
 */

const okSnapshot: SerpSnapshot = {
  query: "persian singers",
  results: [{ rank: 4, url: "https://iranopedia.com/singers", title: "Singers", domain: "iranopedia.com" }],
  features: [],
  source: "dataforseo",
  fetchedAt: "2026-06-08T00:00:00.000Z",
};

function baseDeps(overrides: Partial<SerpRunDeps> = {}): Partial<SerpRunDeps> {
  return {
    env: { ...process.env, BEACON_SERP_PROVIDER: "dataforseo", DATAFORSEO_AUTH_B64: "abc123", DATAFORSEO_DRY_RUN: "false" },
    now: () => new Date("2026-06-08T00:00:00Z"),
    tenantId: async () => "tenant-iranopedia",
    spentThisMonthUsd: async () => 0,
    recordSpend: async () => {},
    readCache: async () => [{ key: "2840|en|persian singers", snapshot: okSnapshot, fetchedAt: "2026-06-07T00:00:00Z" }],
    writeCache: async () => {},
    tenantDomain: async () => "iranopedia.com",
    appendHistory: async () => {},
    ...overrides,
  };
}

describe("runSerpQuery - forceFresh cache bypass (item 19)", () => {
  it("serves the cache hit by default (no forceFresh)", async () => {
    const fetchImpl = vi.fn();
    const result = await runSerpQuery("persian singers", {}, baseDeps({ fetchImpl: fetchImpl as unknown as typeof fetch }));
    expect(result.status).toBe("cache_hit");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("skips the cache and fetches when forceFresh is true", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({ tasks: [{ result: [{ items: [{ type: "organic", url: "https://iranopedia.com/singers", title: "Singers" }] }] }] }),
        { status: 200 },
      ),
    );
    const result = await runSerpQuery(
      "persian singers",
      { forceFresh: true },
      baseDeps({ fetchImpl: fetchImpl as unknown as typeof fetch }),
    );
    expect(result.status).toBe("ok");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("still honors dry-run even with forceFresh - never spends", async () => {
    const fetchImpl = vi.fn();
    const result = await runSerpQuery(
      "persian singers",
      { forceFresh: true },
      baseDeps({
        env: { ...process.env, BEACON_SERP_PROVIDER: "dataforseo", DATAFORSEO_AUTH_B64: "abc123", DATAFORSEO_DRY_RUN: "true" },
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    );
    expect(result.status).toBe("dry_run");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("still honors the hard monthly cap even with forceFresh - fails closed", async () => {
    const fetchImpl = vi.fn();
    const result = await runSerpQuery(
      "persian singers",
      { forceFresh: true },
      baseDeps({
        spentThisMonthUsd: async () => 1000,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    );
    expect(result.status).toBe("capped");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("still reports disabled when not configured, even with forceFresh", async () => {
    const result = await runSerpQuery(
      "persian singers",
      { forceFresh: true },
      baseDeps({
        env: { ...process.env, BEACON_SERP_PROVIDER: undefined, DATAFORSEO_AUTH_B64: undefined, DATAFORSEO_LOGIN: undefined },
      }),
    );
    expect(result.status).toBe("disabled");
  });
});
