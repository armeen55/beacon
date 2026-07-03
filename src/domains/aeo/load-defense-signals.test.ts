import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Supabase admin boundary so the loader's fail-soft + happy paths can
// be exercised without a real database. The pure detection logic is covered
// end-to-end in detect-defense.test.ts; this file covers the I/O wiring +
// empty-safe fallback.
const _fromMock = vi.fn();
vi.mock("@/lib/persistence/supabase", () => ({
  getSupabaseAdmin: () => ({ from: _fromMock }),
}));

import { buildOwnDomainSet, loadAeoDefenseSignalsForTenant } from "./load-defense-signals";

const CONFIG: Parameters<typeof loadAeoDefenseSignalsForTenant>[1] = {
  domain: "iranopedia.com",
  industry: "persian culture guide",
  locations: ["san francisco"],
  services: ["restaurant guide"],
  profound: { topicLabel: "Iran travel" },
};

/** Build a chainable query stub that resolves to the given rows. Mirrors the
 *  PostgREST builder surface the loader uses: from().select().eq()...
 *  .order().range() -> Promise<{data,error}>. */
function queryReturning(rows: unknown[]) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  builder.select = chain;
  builder.eq = chain;
  builder.order = chain;
  builder.range = () => Promise.resolve({ data: rows, error: null });
  return builder;
}

describe("buildOwnDomainSet", () => {
  it("strips scheme/www/path down to the bare host", () => {
    expect(buildOwnDomainSet("https://www.iranopedia.com/about")).toEqual(new Set(["iranopedia.com"]));
  });
  it("is empty for a blank domain", () => {
    expect(buildOwnDomainSet("")).toEqual(new Set());
    expect(buildOwnDomainSet(null)).toEqual(new Set());
  });
});

describe("loadAeoDefenseSignalsForTenant", () => {
  beforeEach(() => {
    _fromMock.mockReset();
  });

  it("returns an all-empty bundle when every table read errors (fail-soft)", async () => {
    _fromMock.mockImplementation(() => {
      const builder: Record<string, unknown> = {};
      const chain = () => builder;
      builder.select = chain;
      builder.eq = chain;
      builder.order = chain;
      builder.range = () => Promise.resolve({ data: null, error: { message: "boom" } });
      return builder;
    });
    const out = await loadAeoDefenseSignalsForTenant("tenant-iranopedia", CONFIG);
    expect(out).toEqual({
      zeroSourceOpenings: [],
      defendCitedQueries: [],
      brandDescriptionMismatches: [],
    });
  });

  it("returns an all-empty bundle when every table is empty (self-hiding)", async () => {
    _fromMock.mockImplementation(() => queryReturning([]));
    const out = await loadAeoDefenseSignalsForTenant("tenant-iranopedia", CONFIG);
    expect(out.zeroSourceOpenings).toEqual([]);
    expect(out.defendCitedQueries).toEqual([]);
    expect(out.brandDescriptionMismatches).toEqual([]);
  });

  it("detects a defend-a-cited-query from a real 2-capture citation-row delta", async () => {
    _fromMock.mockImplementation((table: string) => {
      if (table === "profound_citation_rows") {
        // Two capture dates on one topic: prior (we own it), latest (a new
        // competitor appears alongside us).
        return queryReturning([
          { category_id: "c1", date: "2026-06-25", model: "ChatGPT", root_domain: "iranopedia.com", citation_count: 5 },
          { category_id: "c1", date: "2026-07-02", model: "ChatGPT", root_domain: "iranopedia.com", citation_count: 4 },
          { category_id: "c1", date: "2026-07-02", model: "ChatGPT", root_domain: "surfiran.com", citation_count: 3 },
        ]);
      }
      if (table === "profound_visibility_rows") {
        return queryReturning([{ category_id: "c1", executions: 20, model: "ChatGPT" }]);
      }
      return queryReturning([]); // profound_answer_rows
    });
    const out = await loadAeoDefenseSignalsForTenant("tenant-iranopedia", CONFIG);
    expect(out.defendCitedQueries).toHaveLength(1);
    expect(out.defendCitedQueries[0].competitorDomain).toBe("surfiran.com");
    expect(out.defendCitedQueries[0].priorCaptureDate).toBe("2026-06-25");
    expect(out.defendCitedQueries[0].latestCaptureDate).toBe("2026-07-02");
  });

  it("detects a brand-description mismatch from a persisted brand-mention answer", async () => {
    _fromMock.mockImplementation((table: string) => {
      if (table === "profound_answer_rows") {
        return queryReturning([
          {
            model: "ChatGPT",
            own_mentioned: true,
            response_excerpt: "Iranopedia is a hotel and resort operator based in Tehran.",
          },
        ]);
      }
      return queryReturning([]);
    });
    // Config industry "restaurant guide" contradicts an AI "hotel" descriptor.
    const out = await loadAeoDefenseSignalsForTenant("tenant-iranopedia", {
      ...CONFIG,
      industry: "restaurant guide",
    });
    expect(out.brandDescriptionMismatches).toHaveLength(1);
    expect(out.brandDescriptionMismatches[0].aiDescriptor).toBe("hotel");
    expect(out.brandDescriptionMismatches[0].ownFact).toBe("restaurant guide");
  });
});
