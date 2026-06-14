import { describe, it, expect, vi, beforeEach } from "vitest";

// audit wave-2 #1 (2026-06-14): capture the .eq() filters applied to the
// daily_metric_snapshots query so we can pin that EVERY read is tenant-scoped
// (the RLS-bypassing admin client makes this the only thing standing between
// one tenant's dashboard and another's numbers).
const _eqCalls: Array<[string, unknown]> = [];
vi.mock("@/lib/persistence/supabase", () => {
  const builder: Record<string, unknown> = {};
  builder.from = () => builder;
  builder.select = () => builder;
  builder.eq = (col: string, val: unknown) => {
    _eqCalls.push([col, val]);
    return builder;
  };
  // The query is awaited; resolve to an empty result so both date probes
  // return [] (the assertion is about the filters, not the rows).
  (builder as { then: unknown }).then = (resolve: (v: unknown) => unknown) =>
    resolve({ data: [], error: null });
  return { getSupabaseAdmin: () => builder };
});

import {
  aggregateDerivedPlatformRows,
  fetchTodayDerivedKpis,
} from "@/domains/daily-metric-snapshots/today-kpis";

beforeEach(() => {
  _eqCalls.length = 0;
});

describe("fetchTodayDerivedKpis — tenant isolation (wave-2 #1)", () => {
  it("filters daily_metric_snapshots by tenant_id on every date probe", async () => {
    await fetchTodayDerivedKpis({
      tenantId: "tenant-iranopedia",
      now: new Date("2026-06-13T12:00:00Z"),
    });
    // Both today + yesterday probes ran (today returned []), each must carry
    // the tenant filter. No probe may omit it.
    const tenantFilters = _eqCalls.filter(([c]) => c === "tenant_id");
    expect(tenantFilters.length).toBeGreaterThanOrEqual(2);
    for (const [, val] of tenantFilters) {
      expect(val).toBe("tenant-iranopedia");
    }
    // Defense-in-depth: there is NO query path that filtered date but not tenant.
    const dateFilters = _eqCalls.filter(([c]) => c === "date").length;
    expect(tenantFilters.length).toBe(dateFilters);
  });
});

describe("aggregateDerivedPlatformRows", () => {
  it("sums citation_count and mention_count across rows", () => {
    const rows = [
      {
        platform: "Perplexity",
        mention_count: 103,
        citation_count: 106,
        visibility_score: 51.5,
        share_of_voice: 7.32,
      },
      {
        platform: "ChatGPT",
        mention_count: 70,
        citation_count: 68,
        visibility_score: 59.83,
        share_of_voice: 14.05,
      },
    ];
    const out = aggregateDerivedPlatformRows("2026-04-23", false, rows);
    expect(out.date).toBe("2026-04-23");
    expect(out.isFallback).toBe(false);
    expect(out.totalCitations).toBe(174);
    expect(out.totalMentions).toBe(173);
    expect(out.platformRowCount).toBe(2);
  });

  it("handles a single platform row (partial poll — only one platform completed)", () => {
    const rows = [
      {
        platform: "Perplexity",
        mention_count: 103,
        citation_count: 106,
        visibility_score: 51.5,
        share_of_voice: 7.32,
      },
    ];
    const out = aggregateDerivedPlatformRows("2026-04-23", false, rows);
    expect(out.totalCitations).toBe(106);
    expect(out.totalMentions).toBe(103);
    expect(out.platformRowCount).toBe(1);
  });

  it("returns zeros on empty input (caller filters this case, but aggregator stays defensive)", () => {
    const out = aggregateDerivedPlatformRows("2026-04-23", false, []);
    expect(out.totalCitations).toBe(0);
    expect(out.totalMentions).toBe(0);
    expect(out.platformRowCount).toBe(0);
  });

  it("propagates isFallback=true through aggregation", () => {
    const rows = [
      {
        platform: "Perplexity",
        mention_count: 100,
        citation_count: 100,
        visibility_score: 50,
        share_of_voice: 7,
      },
    ];
    const out = aggregateDerivedPlatformRows("2026-04-22", true, rows);
    expect(out.isFallback).toBe(true);
    expect(out.date).toBe("2026-04-22");
  });

  it("treats null mention_count / citation_count as 0", () => {
    // Defensive: DB columns are NOT NULL but TS types tolerate nulls.
    const rows = [
      {
        platform: "Perplexity",
        mention_count: null as unknown as number,
        citation_count: null as unknown as number,
        visibility_score: null,
        share_of_voice: null,
      },
    ];
    const out = aggregateDerivedPlatformRows("2026-04-23", false, rows);
    expect(out.totalCitations).toBe(0);
    expect(out.totalMentions).toBe(0);
  });
});
