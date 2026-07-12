import { describe, expect, it } from "vitest";
import { dateKeyDaysBefore, propertyDateKey, propertyMonthKey } from "./property-calendar";

describe("GA4 property-local calendar", () => {
  it("keeps Los Angeles in June while UTC has already crossed into July", () => {
    const instant = new Date("2026-07-01T01:30:00.000Z");
    expect(propertyDateKey(instant, "America/Los_Angeles")).toBe("2026-06-30");
    expect(propertyMonthKey(instant, "America/Los_Angeles")).toBe("2026-06-01");
    expect(propertyMonthKey(instant, "UTC")).toBe("2026-07-01");
  });

  it("handles a timezone ahead of UTC at the opposite boundary", () => {
    const instant = new Date("2026-06-30T15:30:00.000Z");
    expect(propertyDateKey(instant, "Pacific/Auckland")).toBe("2026-07-01");
  });

  it("fails closed on an invalid timezone and subtracts date-only days safely", () => {
    expect(propertyDateKey(new Date(), "Not/A_Timezone")).toBeNull();
    expect(dateKeyDaysBefore("2026-03-01", 1)).toBe("2026-02-28");
    expect(dateKeyDaysBefore("bad", 1)).toBeNull();
  });
});
