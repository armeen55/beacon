/**
 * SOURCES — DataForSEO provider boundaries (Core 100K lane S merge).
 * Spend-cap / dry-run fail-closed pins survive here per the risk register.
 */
import { describe, it, expect, vi } from "vitest";

import { runSerpQuery, type SerpRunDeps } from "@/domains/evidence/readers/dataforseo-serp";
import type { SerpSnapshot } from "@/domains/evidence/readers/serp-provider";

/**
 * The parseDataForSeoSerp / parseFeaturedSnippet / parsePaaQuestions parse paths
 * (featured-snippet owner+format, PAA with/without answering domain, malformed-
 * body honesty) are exercised end to end against a recorded REAL response body in
 * tests/contracts/dataforseo-serp.contract.test.ts; the duplicate hand-built-body
 * unit assertions and the thin buildSerpHistoryRow DTO-shape assertions were
 * removed. What remains here is UNIQUE: the runSerpQuery forceFresh cache bypass
 * proving forceFresh skips ONLY the cache read, never the spend-cap gauntlet.
 */

/**
 * Item 19: forceFresh is a minimal, additive bypass of the 14-day cache on
 * runSerpQuery - used by the rank re-check pass so a day-7/14/28 "now" read is
 * never served a stale cached snapshot from before the ship. The full safety
 * gauntlet (configured / dry-run / cap / ledger) still applies; ONLY the cache
 * read is skipped.
 */

const okSnapshot: SerpSnapshot = {
  query: "persian singers",
  results: [{ rank: 4, url: "https://fixture-content.example/singers", title: "Singers", domain: "fixture-content.example" }],
  features: [],
  source: "dataforseo",
  fetchedAt: "2026-06-08T00:00:00.000Z",
};

function baseDeps(overrides: Partial<SerpRunDeps> = {}): Partial<SerpRunDeps> {
  return {
    env: { ...process.env, BEACON_SERP_PROVIDER: "dataforseo", DATAFORSEO_AUTH_B64: "abc123", DATAFORSEO_DRY_RUN: "false" },
    now: () => new Date("2026-06-08T00:00:00Z"),
    tenantId: async () => "tenant-fixture-content",
    spentThisMonthUsd: async () => 0,
    recordSpend: async () => {},
    readCache: async () => [{ key: "2840|en|persian singers", snapshot: okSnapshot, fetchedAt: "2026-06-07T00:00:00Z" }],
    writeCache: async () => {},
    tenantDomain: async () => "fixture-content.example",
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
        JSON.stringify({ tasks: [{ result: [{ items: [{ type: "organic", url: "https://fixture-content.example/singers", title: "Singers" }] }] }] }),
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

  it("still honors the hard monthly cap even with forceFresh - fails closed", async () => {
    // The full not_configured / dry_run / capped / breaker gauntlet is pinned at
    // the dataForSeoRequest transport in dataforseo-client.test.ts. Here we prove
    // the ONE thing unique to runSerpQuery: forceFresh skips only the cache read,
    // never the spend gauntlet - the cap still fails closed with zero fetch.
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
});
