/**
 * N40 contract test - GA4 Data API runReport.
 *
 * Feeds a checked-in fixture of the REAL response body through the ACTUAL
 * narrowing parsers the sync uses (narrowRunReportRows / narrowRevenueRows in
 * src/lib/connectors/ga4/data-api.ts), so a silent upstream change (renamed
 * metric header, new date format, restructured dimensionValues) fails a named
 * test here instead of surfacing as zero traffic rows. NO live calls.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { narrowRunReportRows, narrowRevenueRows } from "@/lib/connectors/ga4/data-api";
import type { Ga4RunReportResponseBody } from "@/lib/connectors/ga4/types";

function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(resolve(__dirname, "fixtures", name), "utf-8")) as T;
}

describe("GA4 runReport traffic contract", () => {
  const body = fixture<Ga4RunReportResponseBody>("ga4-run-report.json");
  it("parses (date, pagePath) dimensionValues + string metricValues into typed rows", () => {
    const rows = narrowRunReportRows(body);
    // 4 raw rows -> 2 valid: the "2026-07-01" (dashed date, not GA4's YYYYMMDD)
    // and the missing-pagePath row are DROPPED, never mis-parsed.
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      date: "2026-07-01", // normalized from GA4's "20260701"
      url: "/koobideh-kabob",
      sessions: 31,
      engaged_sessions: 24,
      conversions: 2,
    });
    expect(rows[1]!.url).toBe("/persian-cat");
  });
  it("carries the top-level fields the pagination loop depends on", () => {
    // rowCount drives the offset loop; metricHeaders drive name-based mapping.
    expect(typeof body.rowCount).toBe("number");
    expect(Array.isArray(body.metricHeaders)).toBe(true);
    expect(body.metricHeaders!.map((h) => h?.name)).toEqual([
      "sessions",
      "engagedSessions",
      "conversions",
    ]);
  });
  it("a null/empty body parses to [] rather than throwing", () => {
    expect(narrowRunReportRows(null)).toEqual([]);
    expect(narrowRunReportRows({} as Ga4RunReportResponseBody)).toEqual([]);
  });
});

describe("GA4 runReport revenue contract (name-mapped metrics)", () => {
  it("maps metrics BY HEADER NAME so a reordered metric set never misassigns", () => {
    // The fixture deliberately orders headers [transactions, totalRevenue,
    // purchaseRevenue] - not our request order - to pin name-based mapping.
    const body = fixture<Ga4RunReportResponseBody>("ga4-revenue-report.json");
    const rows = narrowRevenueRows(body);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      date: "2026-07-01",
      url: "/shop/saffron",
      totalRevenue: 84.5,
      purchaseRevenue: 84.5,
      transactions: 3,
    });
    expect(body.metadata?.currencyCode).toBe("USD");
  });
});
