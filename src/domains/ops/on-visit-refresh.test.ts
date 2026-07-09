/**
 * on-visit-refresh (operator spec 2026-07-09, I-59) - the pure decision that
 * governs the on-visit background refresh: freshness is guaranteed at visit
 * time, never dependent on a cron. Table of the four cases the spec calls out
 * plus the throttle boundary and the nothing-connected guard.
 */
import { describe, expect, it } from "vitest";

import {
  shouldAutoRefresh,
  STALE_AFTER_HOURS,
  THROTTLE_HOURS,
} from "./on-visit-refresh";

const NOW = Date.parse("2026-07-09T12:00:00.000Z");
const H = 3_600_000;
const iso = (msFromNow: number) => new Date(NOW + msFromNow).toISOString();

describe("shouldAutoRefresh", () => {
  it("stale + not throttled -> true", () => {
    const staleSync = iso(-(STALE_AFTER_HOURS + 1) * H);
    expect(shouldAutoRefresh(staleSync, null, NOW, 3)).toBe(true);
  });

  it("fresh -> false", () => {
    const freshSync = iso(-1 * H); // 1h ago, well within the staleness limit
    expect(shouldAutoRefresh(freshSync, null, NOW, 3)).toBe(false);
  });

  it("stale + recently attempted -> false (throttled)", () => {
    const staleSync = iso(-(STALE_AFTER_HOURS + 5) * H);
    const recentAttempt = iso(-(THROTTLE_HOURS - 1) * H); // inside the throttle window
    expect(shouldAutoRefresh(staleSync, recentAttempt, NOW, 3)).toBe(false);
  });

  it("stale + throttle window elapsed -> true", () => {
    const staleSync = iso(-(STALE_AFTER_HOURS + 5) * H);
    const oldAttempt = iso(-(THROTTLE_HOURS + 1) * H); // past the throttle window
    expect(shouldAutoRefresh(staleSync, oldAttempt, NOW, 3)).toBe(true);
  });

  it("never synced (null freshest) + connected sources exist -> true", () => {
    expect(shouldAutoRefresh(null, null, NOW, 2)).toBe(true);
  });

  it("never synced + nothing connected -> false (nothing to refresh)", () => {
    expect(shouldAutoRefresh(null, null, NOW, 0)).toBe(false);
  });

  it("fresh but nothing connected -> false", () => {
    expect(shouldAutoRefresh(iso(-1 * H), null, NOW, 0)).toBe(false);
  });

  it("an unparseable freshest stamp is treated like never synced (refresh if connected)", () => {
    expect(shouldAutoRefresh("not-a-date", null, NOW, 1)).toBe(true);
    expect(shouldAutoRefresh("not-a-date", null, NOW, 0)).toBe(false);
  });

  it("throttle wins even when never synced", () => {
    const recentAttempt = iso(-(THROTTLE_HOURS - 1) * H);
    expect(shouldAutoRefresh(null, recentAttempt, NOW, 3)).toBe(false);
  });
});
