import { describe, expect, it } from "vitest";
import { densifyDailyClicks } from "./densify-daily-series";

describe("densifyDailyClicks", () => {
  it("fills internal missing GSC dates with zero and sorts the series", () => {
    expect(densifyDailyClicks([
      { date: "2026-07-03", clicks: 3 },
      { date: "2026-07-01", clicks: 1 },
    ])).toEqual([
      { date: "2026-07-01", clicks: 1 },
      { date: "2026-07-02", clicks: 0 },
      { date: "2026-07-03", clicks: 3 },
    ]);
  });

  it("combines duplicate dates without inventing edge dates", () => {
    expect(densifyDailyClicks([
      { date: "2026-07-01", clicks: 1 },
      { date: "2026-07-01", clicks: 2 },
    ])).toEqual([{ date: "2026-07-01", clicks: 3 }]);
  });
});
