/**
 * Behavioral tests — UX.6.1 Fix 2 (2026-05-07).
 *
 * Pure-helper tests for `isPreCronPending`. The PollHealthCalmBanner
 * component itself is verified by the architecture invariant tests
 * (no client interactivity, customer-safe copy, role=status).
 *
 * The gate's truth table:
 *
 *   - empty platforms          → false (caller decides)
 *   - any platform != pending  → false (warning path)
 *   - all pending, time < 08:00 UTC → true (calm path)
 *   - all pending, time ≥ 08:00 UTC → false (warning path — late)
 *   - invalid date string      → false (warning path)
 */

import { describe, expect, it } from "vitest";
import { isPreCronPending } from "./poll-health-calm-banner";

const DATE = "2026-05-08";

describe("isPreCronPending — truth table", () => {
  it("returns false on empty platforms array", () => {
    expect(
      isPreCronPending({
        platforms: [],
        date: DATE,
        now: new Date("2026-05-08T03:00:00.000Z"),
      }),
    ).toBe(false);
  });

  it("returns false when any platform is non-pending (e.g. 'ok')", () => {
    expect(
      isPreCronPending({
        platforms: [{ status: "pending" }, { status: "ok" }],
        date: DATE,
        now: new Date("2026-05-08T03:00:00.000Z"),
      }),
    ).toBe(false);
  });

  it("returns false when any platform is non-pending (e.g. 'failed')", () => {
    expect(
      isPreCronPending({
        platforms: [{ status: "pending" }, { status: "failed" }],
        date: DATE,
        now: new Date("2026-05-08T03:00:00.000Z"),
      }),
    ).toBe(false);
  });

  it("returns true when all pending AND now < 08:00 UTC of the date", () => {
    expect(
      isPreCronPending({
        platforms: [{ status: "pending" }, { status: "pending" }],
        date: DATE,
        now: new Date("2026-05-08T01:30:00.000Z"),
      }),
    ).toBe(true);
    expect(
      isPreCronPending({
        platforms: [{ status: "pending" }, { status: "pending" }],
        date: DATE,
        now: new Date("2026-05-08T07:59:59.999Z"),
      }),
    ).toBe(true);
  });

  it("returns false at exactly 08:00 UTC (cutoff is exclusive)", () => {
    expect(
      isPreCronPending({
        platforms: [{ status: "pending" }, { status: "pending" }],
        date: DATE,
        now: new Date("2026-05-08T08:00:00.000Z"),
      }),
    ).toBe(false);
  });

  it("returns false post-cutoff — pending past 08:00 UTC means LATE", () => {
    expect(
      isPreCronPending({
        platforms: [{ status: "pending" }, { status: "pending" }],
        date: DATE,
        now: new Date("2026-05-08T12:00:00.000Z"),
      }),
    ).toBe(false);
    expect(
      isPreCronPending({
        platforms: [{ status: "pending" }, { status: "pending" }],
        date: DATE,
        now: new Date("2026-05-08T23:59:00.000Z"),
      }),
    ).toBe(false);
  });

  it("returns false on malformed date string", () => {
    expect(
      isPreCronPending({
        platforms: [{ status: "pending" }, { status: "pending" }],
        date: "not-a-date",
        now: new Date("2026-05-08T03:00:00.000Z"),
      }),
    ).toBe(false);
  });

  it("uses Date.now() when `now` arg is omitted", () => {
    // Smoke — must not throw, and returns a boolean.
    const result = isPreCronPending({
      platforms: [{ status: "pending" }, { status: "pending" }],
      date: DATE,
    });
    expect(typeof result).toBe("boolean");
  });

  it("single-platform pending pre-cutoff is calm (single-platform tenants)", () => {
    expect(
      isPreCronPending({
        platforms: [{ status: "pending" }],
        date: DATE,
        now: new Date("2026-05-08T05:00:00.000Z"),
      }),
    ).toBe(true);
  });
});
