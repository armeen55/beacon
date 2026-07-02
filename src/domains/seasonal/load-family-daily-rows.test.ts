/**
 * seasonal/load-family-daily-rows tests (BEACON_500 item 69): the pure row
 * mapper drops unusable rows and coerces numerics safely, mirroring
 * load-monthly-archive.test.ts exactly.
 */
import { describe, expect, it } from "vitest";

import { normalizeFamilyDailyRows } from "./load-family-daily-rows";

describe("normalizeFamilyDailyRows", () => {
  it("maps a well-formed row through", () => {
    const out = normalizeFamilyDailyRows([{ page: "/cheetah/species", date: "2026-06-01", impressions: 500, clicks: 20 }]);
    expect(out).toEqual([{ page: "/cheetah/species", date: "2026-06-01", impressions: 500, clicks: 20 }]);
  });

  it("drops rows with no page or no date", () => {
    const out = normalizeFamilyDailyRows([
      { page: "", date: "2026-06-01", impressions: 100, clicks: 5 },
      { page: "/x", date: "", impressions: 100, clicks: 5 },
      { page: null, date: "2026-06-01", impressions: 100, clicks: 5 },
    ]);
    expect(out).toEqual([]);
  });

  it("coerces non-numeric impressions/clicks to 0 instead of throwing", () => {
    const out = normalizeFamilyDailyRows([
      { page: "/x", date: "2026-06-01", impressions: "not-a-number" as unknown as number, clicks: null },
    ]);
    expect(out).toEqual([{ page: "/x", date: "2026-06-01", impressions: 0, clicks: 0 }]);
  });

  it("returns [] for empty input", () => {
    expect(normalizeFamilyDailyRows([])).toEqual([]);
  });
});
