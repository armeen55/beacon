import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// In-memory json-store mock (the outbox's only persistence; cooldown reads it).
let rows: Record<string, unknown>[] = [];
vi.mock("@/lib/persistence/json-store", () => ({
  readStore: async () => rows,
  writeStore: async (_name: string, data: unknown[]) => {
    rows = data as Record<string, unknown>[];
  },
}));

import {
  cooldownDecision,
  checkUrlCooldown,
  DEFAULT_URL_COOLDOWN_HOURS,
} from "./push-cooldown";
import { recordOutbox, outboxKeyFor } from "./publish-outbox";

beforeEach(() => {
  rows = [];
});

describe("cooldownDecision - pure per-URL window", () => {
  const nowMs = new Date("2026-07-03T18:00:00Z").getTime();

  it("BYTE-IDENTICAL: no prior push -> not blocked (pin)", () => {
    expect(cooldownDecision({ url: "https://x.com/p", lastPushMs: null, nowMs })).toEqual({
      blocked: false,
    });
  });

  it("BYTE-IDENTICAL: a prior push OUTSIDE the window -> not blocked (pin)", () => {
    const eightHoursAgo = nowMs - 8 * 3_600_000;
    expect(
      cooldownDecision({ url: "https://x.com/p", lastPushMs: eightHoursAgo, nowMs }),
    ).toEqual({ blocked: false });
  });

  it("blocks a same-URL push INSIDE the window with an honest hours-remaining line", () => {
    const twoHoursAgo = nowMs - 2 * 3_600_000;
    const d = cooldownDecision({ url: "https://x.com/p", lastPushMs: twoHoursAgo, nowMs });
    expect(d.blocked).toBe(true);
    if (d.blocked) {
      // 6h window, 2h elapsed -> ~4h remaining.
      expect(d.hoursUntilAllowed).toBe(4);
      expect(d.reason).toContain("https://x.com/p");
      expect(d.reason).toContain("4 hours");
      expect(d.reason).not.toMatch(/[—–]/); // no dashes
    }
  });

  it("rounds remaining time UP and never below 1 hour", () => {
    const almostDone = nowMs - (DEFAULT_URL_COOLDOWN_HOURS * 3_600_000 - 60_000); // 1 min left
    const d = cooldownDecision({ url: "https://x.com/p", lastPushMs: almostDone, nowMs });
    expect(d.blocked).toBe(true);
    if (d.blocked) expect(d.hoursUntilAllowed).toBe(1);
  });

  it("a zero/negative window disables the cooldown entirely (byte-identical)", () => {
    const oneHourAgo = nowMs - 3_600_000;
    expect(
      cooldownDecision({ url: "https://x.com/p", lastPushMs: oneHourAgo, nowMs, windowHours: 0 }),
    ).toEqual({ blocked: false });
  });

  it("a prior push in the FUTURE (clock skew) does not block", () => {
    const future = nowMs + 3_600_000;
    expect(cooldownDecision({ url: "https://x.com/p", lastPushMs: future, nowMs })).toEqual({
      blocked: false,
    });
  });
});

describe("checkUrlCooldown - reads the outbox rows (no new store)", () => {
  const day = new Date("2026-07-03T18:00:00Z");

  async function seedPush(url: string, recordedAt: Date, hash = "h") {
    const key = outboxKeyFor({ tenantId: "t1", targetUrl: url, changeHash: hash, now: recordedAt });
    await recordOutbox({
      tenantId: "t1",
      key: key.key,
      targetUrl: url,
      changeHash: hash,
      shipDate: key.shipDate,
      state: "pushed",
      receipt: "done",
      now: recordedAt,
    });
  }

  it("blocks a push to a URL pushed 1 hour ago", async () => {
    await seedPush("https://x.com/p", new Date("2026-07-03T17:00:00Z"));
    const d = await checkUrlCooldown({ tenantId: "t1", targetUrl: "https://x.com/p", now: day });
    expect(d.blocked).toBe(true);
  });

  it("does NOT block a DIFFERENT URL (byte-identical for an unrelated page)", async () => {
    await seedPush("https://x.com/p", new Date("2026-07-03T17:00:00Z"));
    const d = await checkUrlCooldown({ tenantId: "t1", targetUrl: "https://x.com/other", now: day });
    expect(d).toEqual({ blocked: false });
  });

  it("normalizes a trailing slash + case so /p and /p/ are the same page", async () => {
    await seedPush("https://x.com/p", new Date("2026-07-03T17:30:00Z"));
    const d = await checkUrlCooldown({ tenantId: "t1", targetUrl: "https://X.com/p/", now: day });
    expect(d.blocked).toBe(true);
  });

  it("a FAILED prior push does not start a cooldown (only successful pushes count)", async () => {
    const key = outboxKeyFor({ tenantId: "t1", targetUrl: "https://x.com/p", changeHash: "h", now: day });
    await recordOutbox({
      tenantId: "t1", key: key.key, targetUrl: "https://x.com/p", changeHash: "h",
      shipDate: key.shipDate, state: "push_failed", receipt: "failed", now: new Date("2026-07-03T17:00:00Z"),
    });
    const d = await checkUrlCooldown({ tenantId: "t1", targetUrl: "https://x.com/p", now: day });
    expect(d).toEqual({ blocked: false });
  });

  it("uses the MOST-RECENT push when a URL was pushed twice (different hashes)", async () => {
    await seedPush("https://x.com/p", new Date("2026-07-03T09:00:00Z"), "old");
    await seedPush("https://x.com/p", new Date("2026-07-03T17:30:00Z"), "new");
    const d = await checkUrlCooldown({ tenantId: "t1", targetUrl: "https://x.com/p", now: day });
    expect(d.blocked).toBe(true); // 30 min ago -> inside window
  });

  it("another tenant's push to the same URL never blocks mine (tenant-scoped)", async () => {
    await seedPush("https://x.com/p", new Date("2026-07-03T17:00:00Z"));
    const d = await checkUrlCooldown({ tenantId: "t2", targetUrl: "https://x.com/p", now: day });
    expect(d).toEqual({ blocked: false });
  });
});
