import { describe, expect, it } from "vitest";

import {
  RESULTS_STALE_DATA_DAYS,
  RESULTS_STALE_SYNC_DAYS,
  resultsFreshnessNote,
} from "./page";
import type { ConnectionHealth } from "@/domains/insight/connection-health";

const NOW = new Date("2026-07-20T18:00:00.000Z");
// Days-behind is floored, so a same-clock date N days back reads as N.
function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * 86_400_000).toISOString().slice(0, 10);
}
type Gsc = Pick<ConnectionHealth, "severity" | "daysStale">;

describe("resultsFreshnessNote", () => {
  it("shows no banner when the finalized DATA is fresh, even if the sync stamp looks stale", () => {
    // The operator's real bug: sync stamp 18 days, finalized data 3 days. The
    // banner must read the DATA watermark, so it stays silent.
    const gsc: Gsc = { severity: "stale", daysStale: 18 };
    expect(resultsFreshnessNote(gsc, daysAgo(3), NOW)).toBeNull();
  });

  it("reports the DATA age when data lags but the connector is syncing fine", () => {
    // Connector sync is recent (2 days), but the finalized data is 9 days behind:
    // the normal Google reporting lag message, phrased first person.
    const gsc: Gsc = { severity: "stale", daysStale: 2 };
    const note = resultsFreshnessNote(gsc, daysAgo(9), NOW);
    expect(note).toContain("data is 9 days old");
    expect(note).toContain("I am refreshing");
  });

  it("names the connection as the cause only when the sync is genuinely broken AND data is behind", () => {
    const gsc: Gsc = { severity: "stale", daysStale: 12 };
    const note = resultsFreshnessNote(gsc, daysAgo(12), NOW);
    expect(note).toBe("I have not been able to sync Search Console for 12 days. Check the connection.");
  });

  it("stays silent at exactly the data threshold and warns one day past it", () => {
    const gsc: Gsc = { severity: "stale", daysStale: 1 };
    expect(resultsFreshnessNote(gsc, daysAgo(RESULTS_STALE_DATA_DAYS), NOW)).toBeNull();
    expect(resultsFreshnessNote(gsc, daysAgo(RESULTS_STALE_DATA_DAYS + 1), NOW)).toContain("days old");
  });

  it("surfaces the honest disconnected and needs-setup states", () => {
    expect(resultsFreshnessNote({ severity: "disconnected", daysStale: null }, null, NOW)).toContain("isn't connected");
    expect(resultsFreshnessNote({ severity: "needs_setup", daysStale: null }, null, NOW)).toContain("hasn't synced yet");
  });

  it("shows nothing for a healthy connector or a missing gsc row", () => {
    expect(resultsFreshnessNote({ severity: "healthy", daysStale: 1 }, daysAgo(2), NOW)).toBeNull();
    expect(resultsFreshnessNote(null, daysAgo(30), NOW)).toBeNull();
  });

  it("keeps the two thresholds aligned at 5 days", () => {
    expect(RESULTS_STALE_DATA_DAYS).toBe(5);
    expect(RESULTS_STALE_SYNC_DAYS).toBe(5);
  });
});
