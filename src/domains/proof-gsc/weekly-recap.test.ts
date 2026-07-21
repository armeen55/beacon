import { describe, expect, it } from "vitest";
import { shippedInLastDays } from "./weekly-recap";

// Noon UTC on 2026-07-02 = still 2026-07-02 in Pacific (UTC-7 in July), well clear of the
// midnight boundary so the fixture isn't flaky against the day computation.
const NOW = Date.parse("2026-07-02T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

describe("weekly-recap (item 8 streak)", () => {
  it("counts the 14-day streak, ignoring older and unparseable rows", () => {
    const rows = [
      { shippedAt: daysAgo(1) }, { shippedAt: daysAgo(13) },
      { shippedAt: daysAgo(20) }, { shippedAt: "garbage" },
    ];
    expect(shippedInLastDays(rows, NOW)).toBe(2);
  });
});
