/**
 * Freshness/cache hardening (2026-05-13) — pure-function tests for
 * `computeFreshness` plus a static-analysis pin on the cache tag
 * helper and the post-syncSnaps invalidation location in run-poll.ts.
 *
 * Why static analysis on the invalidation site: the test fixture for
 * `runNativePoll` is heavy (mocks adapters, repos, reconcilers). A
 * source-level pin on the structural placement is cheaper and harder
 * to break by accident than spinning up a fake poll run end-to-end.
 */

import { describe, expect, it } from "vitest";

import {
  computeFreshness,
  buildTodayReadModelCacheTag,
} from "./visibility-read-model";

const NOW = new Date("2026-05-13T15:00:00Z"); // 2026-05-13 15:00 UTC

describe("computeFreshness — status rules", () => {
  it("returns 'empty' when no snapshots exist", () => {
    const f = computeFreshness({
      latestSnapshotDate: null,
      latestPollCompletedAt: null,
      inFlightPollStartedAt: null,
      now: NOW,
    });
    expect(f.status).toBe("empty");
    expect(f.latestSnapshotDate).toBeNull();
    expect(f.label).toBe("No data yet");
  });

  it("returns 'fresh' when latest snapshot is today (UTC)", () => {
    const f = computeFreshness({
      latestSnapshotDate: "2026-05-13",
      latestPollCompletedAt: "2026-05-13T12:24:00Z",
      inFlightPollStartedAt: null,
      now: NOW,
    });
    expect(f.status).toBe("fresh");
    expect(f.latestSnapshotDate).toBe("2026-05-13");
    // Poll completed ~2.5h ago, NOW is 15:00, completion 12:24.
    expect(f.ageHours).not.toBeNull();
    expect(f.ageHours!).toBeGreaterThan(2);
    expect(f.ageHours!).toBeLessThan(4);
    expect(f.label).toMatch(/Updated .*h ago|Updated today/);
  });

  it("returns 'fresh' when latest snapshot is yesterday (still inside the daily-cron lag window)", () => {
    const f = computeFreshness({
      latestSnapshotDate: "2026-05-12",
      latestPollCompletedAt: "2026-05-12T12:00:00Z",
      inFlightPollStartedAt: null,
      now: NOW,
    });
    expect(f.status).toBe("fresh");
    expect(f.label).toBe("Updated yesterday");
  });

  it("returns 'stale' when latest snapshot is 2+ days old", () => {
    const f = computeFreshness({
      latestSnapshotDate: "2026-05-10",
      latestPollCompletedAt: "2026-05-10T12:00:00Z",
      inFlightPollStartedAt: null,
      now: NOW,
    });
    expect(f.status).toBe("stale");
    expect(f.label).toMatch(/Updated \d+ days ago/);
    expect(f.label).toContain("3 days ago");
  });

  it("returns 'rebuilding' when an in-flight poll started in the last 60 min", () => {
    const f = computeFreshness({
      latestSnapshotDate: "2026-05-13",
      latestPollCompletedAt: "2026-05-13T12:24:00Z",
      inFlightPollStartedAt: "2026-05-13T14:50:00Z", // 10 min ago
      now: NOW,
    });
    expect(f.status).toBe("rebuilding");
    expect(f.label).toBe("Refreshing…");
  });

  it("'rebuilding' takes priority over 'fresh'", () => {
    // Latest snapshot is from today, AND a poll started 5 min ago.
    // Rebuilding wins.
    const f = computeFreshness({
      latestSnapshotDate: "2026-05-13",
      latestPollCompletedAt: "2026-05-12T12:00:00Z",
      inFlightPollStartedAt: "2026-05-13T14:55:00Z",
      now: NOW,
    });
    expect(f.status).toBe("rebuilding");
  });

  it("'rebuilding' takes priority over 'stale'", () => {
    const f = computeFreshness({
      latestSnapshotDate: "2026-05-10",
      latestPollCompletedAt: "2026-05-10T12:00:00Z",
      inFlightPollStartedAt: "2026-05-13T14:50:00Z",
      now: NOW,
    });
    expect(f.status).toBe("rebuilding");
  });

  it("does NOT treat an OLD in-flight started_at as rebuilding (cron likely stalled)", () => {
    // Started 3 hours ago, still no completed_at → that's a stalled
    // run, not a healthy refresh in progress. Don't lie that we're
    // refreshing.
    const f = computeFreshness({
      latestSnapshotDate: "2026-05-12",
      latestPollCompletedAt: "2026-05-12T12:00:00Z",
      inFlightPollStartedAt: "2026-05-13T12:00:00Z", // 3h ago
      now: NOW,
    });
    expect(f.status).toBe("fresh"); // snapshot is yesterday → fresh
    expect(f.label).toBe("Updated yesterday");
  });

  it("age computed from poll completion when present, else from snapshot date", () => {
    const withTs = computeFreshness({
      latestSnapshotDate: "2026-05-13",
      latestPollCompletedAt: "2026-05-13T14:00:00Z", // 1h ago
      inFlightPollStartedAt: null,
      now: NOW,
    });
    expect(withTs.ageHours).toBeCloseTo(1, 0);

    const noTs = computeFreshness({
      latestSnapshotDate: "2026-05-13",
      latestPollCompletedAt: null,
      inFlightPollStartedAt: null,
      now: NOW,
    });
    // Without a timestamp we fall back to end-of-day, so ageHours is
    // small/negative-clamped on the same day.
    expect(noTs.ageHours).not.toBeNull();
    expect(noTs.ageHours!).toBeGreaterThanOrEqual(0);
  });

  it("'Updated just now' renders when age < 1h", () => {
    const f = computeFreshness({
      latestSnapshotDate: "2026-05-13",
      latestPollCompletedAt: "2026-05-13T14:55:00Z", // 5 min ago
      inFlightPollStartedAt: null,
      now: NOW,
    });
    expect(f.label).toBe("Updated just now");
  });
});

describe("buildTodayReadModelCacheTag — tenant scoping", () => {
  it("returns a tenant-scoped tag string", () => {
    expect(buildTodayReadModelCacheTag("tenant-ritz-founder")).toBe(
      "today-readmodel:tenant-ritz-founder",
    );
  });

  it("never returns the same tag for two different tenants", () => {
    const a = buildTodayReadModelCacheTag("tenant-a");
    const b = buildTodayReadModelCacheTag("tenant-b");
    expect(a).not.toBe(b);
  });
});

// PIVOT (2026-06-15): the `run-poll.ts — post-syncSnaps invalidation` source
// scan block lived here, pinning the native-poll cache invalidation. The
// in-house native AEO polling engine (run-poll.ts) was deleted — Profound is
// now the sole AEO source — so the block is gone with it. The freshness
// pure-function + cache-tag pins above are unaffected.
//
// PIVOT (2026-07-20): the `backfill-snapshot-extensions.ts — post-write
// invalidation` source-scan block that lived here pinned a one-time backfill
// script (scripts/backfill-snapshot-extensions.ts), which has since been
// deleted. Removed along with it.
