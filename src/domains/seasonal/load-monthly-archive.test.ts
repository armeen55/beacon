/**
 * seasonal/load-monthly-archive tests (2026-07-02, master plan item 21): the
 * pure row mapper drops unusable rows and coerces numerics safely.
 */
import { describe, expect, it } from "vitest";

import { normalizeMonthlyArchiveRows } from "./load-monthly-archive";

describe("normalizeMonthlyArchiveRows", () => {
  it("maps a well-formed row through", () => {
    const out = normalizeMonthlyArchiveRows([
      { query: "nowruz table", month: "2026-03-01", impressions: 4000, clicks: 200, top_page: "/nowruz" },
    ]);
    expect(out).toEqual([{ query: "nowruz table", month: "2026-03-01", impressions: 4000, clicks: 200, topPage: "/nowruz" }]);
  });

  it("drops rows with no query or no month", () => {
    const out = normalizeMonthlyArchiveRows([
      { query: "", month: "2026-03-01", impressions: 100, clicks: 5 },
      { query: "q", month: "", impressions: 100, clicks: 5 },
      { query: null, month: "2026-03-01", impressions: 100, clicks: 5 },
    ]);
    expect(out).toEqual([]);
  });

  it("coerces non-numeric impressions/clicks to 0 instead of throwing", () => {
    const out = normalizeMonthlyArchiveRows([
      { query: "q", month: "2026-03-01", impressions: "not-a-number" as unknown as number, clicks: null },
    ]);
    expect(out).toEqual([{ query: "q", month: "2026-03-01", impressions: 0, clicks: 0, topPage: null }]);
  });

  it("returns [] for empty input", () => {
    expect(normalizeMonthlyArchiveRows([])).toEqual([]);
  });
});
