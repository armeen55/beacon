import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  summarizeBackupVerification,
  buildBackupReceiptLine,
  agoLabel,
  runBackupVerification,
  STALE_AFTER_MS,
  type MirrorObservation,
} from "./backup-verify";

const NOW = new Date("2026-07-03T12:00:00Z");
const nowMs = NOW.getTime();
const hoursAgo = (h: number) => new Date(nowMs - h * 3_600_000).toISOString();

describe("agoLabel", () => {
  it("renders a relative label, or 'never' for null/unparseable", () => {
    expect(agoLabel(null, nowMs)).toBe("never");
    expect(agoLabel("nonsense", nowMs)).toBe("never");
    expect(agoLabel(hoursAgo(0), nowMs)).toBe("just now");
    expect(agoLabel(hoursAgo(2), nowMs)).toBe("2h ago");
    expect(agoLabel(hoursAgo(48), nowMs)).toBe("2 days ago");
  });
});

describe("summarizeBackupVerification - counts + stale flag", () => {
  const expected = ["store-a", "store-b", "store-c"];

  it("all mirrored + fresh -> full count, no missing, no stale", () => {
    const observed: MirrorObservation[] = expected.map((storeName) => ({ storeName, newestUpdatedAt: hoursAgo(2) }));
    const r = summarizeBackupVerification({ expected, observed, unreadable: false, now: NOW });
    expect(r.mirrored).toBe(3);
    expect(r.expected).toBe(3);
    expect(r.missing).toEqual([]);
    expect(r.stale).toEqual([]);
    expect(r.receiptLine).toBe("Backup check: 3 of 3 stores mirrored, newest 2h ago.");
  });

  it("a MISSING store is counted and named (not mirrored at all)", () => {
    const observed: MirrorObservation[] = [
      { storeName: "store-a", newestUpdatedAt: hoursAgo(2) },
      { storeName: "store-b", newestUpdatedAt: hoursAgo(3) },
      // store-c absent from the mirror
    ];
    const r = summarizeBackupVerification({ expected, observed, unreadable: false, now: NOW });
    expect(r.mirrored).toBe(2);
    expect(r.missing).toEqual(["store-c"]);
    expect(r.receiptLine).toContain("2 of 3 stores mirrored");
    expect(r.receiptLine).toContain("1 store is not backed up yet");
  });

  it("a STALE store (newest older than STALE_AFTER_MS) is flagged", () => {
    const staleTs = new Date(nowMs - STALE_AFTER_MS - 60_000).toISOString();
    const observed: MirrorObservation[] = [
      { storeName: "store-a", newestUpdatedAt: hoursAgo(2) },
      { storeName: "store-b", newestUpdatedAt: staleTs },
      { storeName: "store-c", newestUpdatedAt: hoursAgo(1) },
    ];
    const r = summarizeBackupVerification({ expected, observed, unreadable: false, now: NOW });
    expect(r.mirrored).toBe(3); // all present
    expect(r.stale).toEqual(["store-b"]);
    expect(r.receiptLine).toContain("1 look stale");
  });

  it("ignores observed stores that are NOT in the expected set (only grades expected)", () => {
    const observed: MirrorObservation[] = [
      ...expected.map((storeName) => ({ storeName, newestUpdatedAt: hoursAgo(1) })),
      { storeName: "some-other-blob", newestUpdatedAt: hoursAgo(1) },
    ];
    const r = summarizeBackupVerification({ expected, observed, unreadable: false, now: NOW });
    expect(r.mirrored).toBe(3);
    expect(r.expected).toBe(3);
  });

  it("unreadable -> an honest 'could not read' receipt (never a false 0 of N)", () => {
    const r = summarizeBackupVerification({ expected, observed: [], unreadable: true, now: NOW });
    expect(r.unreadable).toBe(true);
    expect(r.mirrored).toBe(0);
    expect(r.receiptLine).toContain("could not read the backup mirror");
  });

  it("the receipt line never carries a banned dash", () => {
    const observed: MirrorObservation[] = [{ storeName: "store-a", newestUpdatedAt: hoursAgo(2) }];
    const r = summarizeBackupVerification({ expected, observed, unreadable: false, now: NOW });
    expect(r.receiptLine).not.toMatch(/[‒–—―]/);
  });
});

describe("buildBackupReceiptLine", () => {
  it("healthy line", () => {
    expect(
      buildBackupReceiptLine({ expected: 14, mirrored: 14, missing: [], stale: [], newestUpdatedAt: hoursAgo(2), nowMs }),
    ).toBe("Backup check: 14 of 14 stores mirrored, newest 2h ago.");
  });
  it("owns missing + stale plainly", () => {
    const line = buildBackupReceiptLine({
      expected: 14, mirrored: 12, missing: ["x", "y"], stale: ["z"], newestUpdatedAt: hoursAgo(72), nowMs,
    });
    expect(line).toContain("12 of 14 stores mirrored");
    expect(line).toContain("2 stores are not backed up yet");
    expect(line).toContain("1 look stale");
  });
});

describe("runBackupVerification - I/O wrapper, read-only, fail-soft", () => {
  it("reads observations, summarizes, and persists exactly one receipt", async () => {
    const persisted: unknown[] = [];
    const r = await runBackupVerification({
      expected: () => ["store-a", "store-b"],
      readObservations: async () => ({
        observed: [
          { storeName: "store-a", newestUpdatedAt: hoursAgo(1) },
          { storeName: "store-b", newestUpdatedAt: hoursAgo(1) },
        ],
        unreadable: false,
      }),
      now: () => NOW,
      persistReceipt: async (res) => {
        persisted.push(res);
      },
    });
    expect(r.mirrored).toBe(2);
    expect(persisted).toHaveLength(1);
  });

  it("a read failure is fail-soft: reports unreadable, never throws", async () => {
    const r = await runBackupVerification({
      expected: () => ["store-a"],
      readObservations: async () => {
        throw new Error("supabase down");
      },
      now: () => NOW,
      persistReceipt: async () => {},
    });
    expect(r.unreadable).toBe(true);
    expect(r.receiptLine).toContain("could not read the backup mirror");
  });

  it("a persist failure never throws (the receipt is best-effort)", async () => {
    await expect(
      runBackupVerification({
        expected: () => ["store-a"],
        readObservations: async () => ({ observed: [{ storeName: "store-a", newestUpdatedAt: hoursAgo(1) }], unreadable: false }),
        now: () => NOW,
        persistReceipt: async () => {
          throw new Error("persist boom");
        },
      }),
    ).resolves.toBeDefined();
  });
});
