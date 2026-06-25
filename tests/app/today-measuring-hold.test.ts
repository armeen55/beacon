import { describe, it, expect } from "vitest";

import {
  buildMeasuringHold,
  isHeldForMeasurement,
  normalizeHoldPath,
} from "@/app/(shell)/today-measuring-hold";

const now = Date.parse("2026-06-25T00:00:00Z");
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

describe("buildMeasuringHold", () => {
  it("holds a page with an open 'measuring' record inside the window", () => {
    const held = buildMeasuringHold(
      [{ path: "/iran-flag", shippedAt: iso(now - 3 * DAY), verdict: "measuring" }],
      now,
    );
    expect(held.has("/iran-flag")).toBe(true);
  });

  it("does NOT hold a page whose change already has a verdict (not measuring)", () => {
    const held = buildMeasuringHold(
      [{ path: "/iran-flag", shippedAt: iso(now - 3 * DAY), verdict: "helped" }],
      now,
    );
    expect(held.size).toBe(0);
  });

  it("releases the hold once the window (28d) elapses even if still 'measuring'", () => {
    const held = buildMeasuringHold(
      [{ path: "/iran-flag", shippedAt: iso(now - 40 * DAY), verdict: "measuring" }],
      now,
    );
    expect(held.size).toBe(0);
  });

  it("normalizes trailing slashes so ledger path and Move URL match", () => {
    const held = buildMeasuringHold(
      [{ path: "/iran-flag/", shippedAt: iso(now - 1 * DAY), verdict: "measuring" }],
      now,
    );
    expect(isHeldForMeasurement("https://iranopedia.com/iran-flag", held)).toBe(true);
  });

  it("a page NOT under measurement is not held", () => {
    const held = buildMeasuringHold(
      [{ path: "/iran-flag", shippedAt: iso(now - 1 * DAY), verdict: "measuring" }],
      now,
    );
    expect(isHeldForMeasurement("https://iranopedia.com/persian-boy-names", held)).toBe(false);
  });

  it("ignores rows with an unparseable ship date (fail-open to action)", () => {
    const held = buildMeasuringHold(
      [{ path: "/iran-flag", shippedAt: "garbage", verdict: "measuring" }],
      now,
    );
    expect(held.size).toBe(0);
  });

  it("normalizeHoldPath collapses root + trailing slashes", () => {
    expect(normalizeHoldPath("/a/")).toBe("/a");
    expect(normalizeHoldPath("")).toBe("/");
  });
});
