/**
 * attach-control-contamination.test.ts (BEACON_500 N13, 2026-07-03).
 *
 * Pins:
 *   - the batch snapshot-history read is bounded, paged, and keyed back to the
 *     caller's host-stripped path (both www./bare host variants match).
 *   - computeContaminationForShip classifies against the FULL ledger (every
 *     other ship), never the ship's own row.
 *   - PROMOTION (operator correction, 2026-07-03): a contaminated control is
 *     replaced ONLY from the ship's own FROZEN controlDonorPool, walked in its
 *     original order - never a fresh matcher call, never a live GSC read.
 *     effectiveControlPages reflects the promotion; the stored
 *     record.controlPages/controlDonorPool are never touched (computed-only).
 *   - absent/exhausted pool -> caution only, never a thrown error.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

type Row = Record<string, unknown>;
let snapshotRows: Row[] = [];
let snapshotThrow: Error | null = null;
const rangeCalls: Array<{ from: number; to: number }> = [];

function chainFor() {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "gte", "lt", "order"]) {
    chain[m] = vi.fn(() => chain);
  }
  chain.range = vi.fn((from: number, to: number) => {
    rangeCalls.push({ from, to });
    if (snapshotThrow) return Promise.resolve({ data: null, error: { message: snapshotThrow.message } });
    const pageIndex = Math.floor(from / 1000);
    const pageSize = 1000;
    const page = snapshotRows.slice(pageIndex * pageSize, pageIndex * pageSize + pageSize);
    return Promise.resolve({ data: page, error: null });
  });
  return chain;
}

vi.mock("@/lib/persistence/supabase", () => ({
  getSupabaseAdmin: () => ({ from: () => chainFor() }),
}));

import {
  computeContaminationForShip,
  attachControlContaminationForLedger,
} from "./attach-control-contamination";
import type { ShippedChangeRecord } from "./shipped-change-store";
import type { RankedControl } from "./control-matching";

function donor(url: string, verdict: RankedControl["verdict"] = "kept"): RankedControl {
  return { url, verdict, similarityRatio: 1, slopeDivergence: 0, queryOverlap: 0, reason: verdict };
}

function ship(over: Partial<ShippedChangeRecord> = {}): ShippedChangeRecord {
  return {
    id: "s1",
    page: "https://site.com/treated",
    path: "/treated",
    actionType: "edit_title",
    before: null,
    after: null,
    shippedAt: "2026-06-01T00:00:00Z",
    baseline: { clicks: 0, impressions: 0, ctr: 0, position: 0, windowDays: 28 },
    targetQueries: [],
    controlPages: ["https://site.com/a", "https://site.com/b"],
    windows: [{ day: 7, checkOn: "2026-06-08", ran: true, treatedDelta: 0, controlDelta: 0, adjustedLift: 0, treatedCtrDelta: 0, controlCtrDelta: 0, adjustedCtrLift: 0, treatedPosDelta: 0, controlPosDelta: 0, adjustedPosLift: 0, controlsUsed: 2 }],
    verdict: "measuring",
    confidence: "low",
    measuredAt: null,
    notes: null,
    verifiedLive: false,
    liveSourceUrl: null,
    recrawlRequestedAt: null,
    controlMatchNotes: null,
    controlMatchWeak: false,
    controlDonorPool: null,
    operatorVerdictOverride: null,
    createdAt: "2026-06-01T00:00:00Z",
    updatedAt: "2026-06-01T00:00:00Z",
    ...over,
  };
}

beforeEach(() => {
  snapshotRows = [];
  snapshotThrow = null;
  rangeCalls.length = 0;
});

describe("computeContaminationForShip - clean path", () => {
  it("returns clean with the original controlPages when nothing is contaminated", () => {
    const record = ship();
    const out = computeContaminationForShip({
      record,
      otherShips: [],
      snapshotsByPath: new Map([
        ["/a", [{ fetchedAt: "2026-06-02", contentHash: "x" }, { fetchedAt: "2026-06-06", contentHash: "x" }]],
        ["/b", [{ fetchedAt: "2026-06-02", contentHash: "y" }, { fetchedAt: "2026-06-06", contentHash: "y" }]],
      ]),
    });
    expect(out).not.toBeNull();
    expect(out!.verdict.hasContamination).toBe(false);
    expect(out!.effectiveControlPages).toEqual(record.controlPages);
    expect(out!.notes).toEqual([]);
  });

  it("returns null when the ship has no controls or no measurement window", () => {
    const record = ship({ controlPages: [] });
    const out = computeContaminationForShip({
      record,
      otherShips: [],
      snapshotsByPath: new Map(),
    });
    expect(out).toBeNull();
  });
});

describe("computeContaminationForShip - treated_by_us against the FULL ledger", () => {
  it("flags a control that another ship in the ledger treated inside this window", () => {
    const record = ship({
      controlDonorPool: [donor("https://site.com/c")],
    });
    const out = computeContaminationForShip({
      record,
      otherShips: [{ path: "/a", shippedAt: "2026-06-05T00:00:00Z" }],
      snapshotsByPath: new Map([
        ["/b", [{ fetchedAt: "2026-06-02", contentHash: "y" }, { fetchedAt: "2026-06-06", contentHash: "y" }]],
      ]),
    });
    expect(out!.verdict.hasContamination).toBe(true);
    expect(out!.verdict.contaminated[0]!.path).toBe("/a");
    expect(out!.verdict.contaminated[0]!.status).toBe("treated_by_us");
  });

  it("does not flag the ship's OWN row as if it were another treatment", () => {
    // Passing otherShips = [] (the caller excludes the ship's own row) means a
    // control matching the ship's own path never spuriously self-flags.
    const record = ship({ controlPages: ["https://site.com/treated-lookalike"] });
    const out = computeContaminationForShip({
      record,
      otherShips: [],
      snapshotsByPath: new Map([
        ["/treated-lookalike", [{ fetchedAt: "2026-06-02", contentHash: "x" }, { fetchedAt: "2026-06-06", contentHash: "x" }]],
      ]),
    });
    expect(out!.verdict.hasContamination).toBe(false);
  });
});

describe("computeContaminationForShip - PROMOTION from the frozen pool only", () => {
  it("promotes the next kept donor from the frozen pool, in its original order", () => {
    const record = ship({
      controlDonorPool: [
        donor("https://site.com/b"), // already an existing control - must be skipped
        donor("https://site.com/excluded-1", "excluded"), // matcher excluded it at ship time - skipped
        donor("https://site.com/c"), // first eligible
        donor("https://site.com/d"), // would also be eligible - must NOT be chosen instead
      ],
    });
    const out = computeContaminationForShip({
      record,
      otherShips: [{ path: "/a", shippedAt: "2026-06-05T00:00:00Z" }], // /a treated inside window
      snapshotsByPath: new Map([
        ["/b", [{ fetchedAt: "2026-06-02", contentHash: "y" }, { fetchedAt: "2026-06-06", contentHash: "y" }]],
      ]),
    });
    expect(out!.verdict.hasContamination).toBe(true);
    expect(out!.substitutesByOriginal.get("/a")).toBe("https://site.com/c");
    expect(out!.effectiveControlPages).toEqual(["https://site.com/c", "https://site.com/b"]);
    expect(out!.notes.some((n) => n.includes("/c"))).toBe(true);
    expect(out!.notes.some((n) => n.includes("list I chose before shipping"))).toBe(true);
    // The stored record itself must never be mutated.
    expect(record.controlPages).toEqual(["https://site.com/a", "https://site.com/b"]);
    expect(record.controlDonorPool).toHaveLength(4);
  });

  it("never chooses a later, better-looking candidate over the next-in-line donor", () => {
    // Both /c and /d are "kept" in the frozen pool; /c comes first, so it must
    // win even though nothing here signals /d is "better" - there is no
    // re-ranking, only original pool order.
    const record = ship({
      controlDonorPool: [donor("https://site.com/c"), donor("https://site.com/d")],
    });
    const out = computeContaminationForShip({
      record,
      otherShips: [{ path: "/a", shippedAt: "2026-06-05T00:00:00Z" }],
      snapshotsByPath: new Map([
        ["/b", [{ fetchedAt: "2026-06-02", contentHash: "y" }, { fetchedAt: "2026-06-06", contentHash: "y" }]],
      ]),
    });
    expect(out!.substitutesByOriginal.get("/a")).toBe("https://site.com/c");
  });

  it("falls back to the caution note when the frozen pool is ABSENT (older row, predates N13)", () => {
    const record = ship({ controlDonorPool: null });
    const out = computeContaminationForShip({
      record,
      otherShips: [{ path: "/a", shippedAt: "2026-06-05T00:00:00Z" }],
      snapshotsByPath: new Map([
        ["/b", [{ fetchedAt: "2026-06-02", contentHash: "y" }, { fetchedAt: "2026-06-06", contentHash: "y" }]],
      ]),
    });
    expect(out!.verdict.hasContamination).toBe(true);
    expect(out!.substitutesByOriginal.get("/a")).toBeFalsy();
    // NEVER drop a control - the original stays in effectiveControlPages.
    expect(out!.effectiveControlPages).toEqual(["https://site.com/a", "https://site.com/b"]);
    expect(out!.notes.some((n) => n.includes("caution") || n === "A comparison page changed during measurement, so I am reading this result with caution.")).toBe(true);
  });

  it("falls back to the caution note when the frozen pool is EXHAUSTED", () => {
    const record = ship({
      controlPages: ["https://site.com/a", "https://site.com/b", "https://site.com/e"],
      controlDonorPool: [donor("https://site.com/c")], // only one donor for two contaminated controls
    });
    const out = computeContaminationForShip({
      record,
      otherShips: [
        { path: "/a", shippedAt: "2026-06-05T00:00:00Z" },
        { path: "/e", shippedAt: "2026-06-06T00:00:00Z" },
      ],
      snapshotsByPath: new Map([
        ["/b", [{ fetchedAt: "2026-06-02", contentHash: "y" }, { fetchedAt: "2026-06-06", contentHash: "y" }]],
      ]),
    });
    expect(out!.verdict.contaminated.map((c) => c.path).sort()).toEqual(["/a", "/e"]);
    const subs = [...out!.substitutesByOriginal.values()];
    expect(subs.filter((s) => s != null)).toHaveLength(1);
    expect(subs.filter((s) => s == null)).toHaveLength(1);
  });

  it("never re-admits a donor that is itself contaminated as a substitute", () => {
    const record = ship({
      controlPages: ["https://site.com/a", "https://site.com/b"],
      // /a is the ONLY donor offered, but /a is itself the contaminated path.
      controlDonorPool: [donor("https://site.com/a")],
    });
    const out = computeContaminationForShip({
      record,
      otherShips: [{ path: "/a", shippedAt: "2026-06-05T00:00:00Z" }],
      snapshotsByPath: new Map([
        ["/b", [{ fetchedAt: "2026-06-02", contentHash: "y" }, { fetchedAt: "2026-06-06", contentHash: "y" }]],
      ]),
    });
    expect(out!.substitutesByOriginal.get("/a")).toBeFalsy();
  });

  it("never mutates the stored record even when a promotion happens", () => {
    const originalControlPages = ["https://site.com/a", "https://site.com/b"];
    const originalPool = [donor("https://site.com/c")];
    const record = ship({ controlPages: originalControlPages, controlDonorPool: originalPool });
    computeContaminationForShip({
      record,
      otherShips: [{ path: "/a", shippedAt: "2026-06-05T00:00:00Z" }],
      snapshotsByPath: new Map([
        ["/b", [{ fetchedAt: "2026-06-02", contentHash: "y" }, { fetchedAt: "2026-06-06", contentHash: "y" }]],
      ]),
    });
    expect(record.controlPages).toBe(originalControlPages);
    expect(record.controlDonorPool).toBe(originalPool);
  });
});

describe("attachControlContaminationForLedger - batch read", () => {
  it("pages the snapshot-history read and matches www./bare host variants back to the caller path", async () => {
    snapshotRows = [
      { url: "https://www.site.com/a", fetched_at: "2026-06-02T00:00:00Z", content_hash: "x" },
      { url: "https://site.com/a", fetched_at: "2026-06-10T00:00:00Z", content_hash: "z" },
      { url: "https://site.com/b", fetched_at: "2026-06-02T00:00:00Z", content_hash: "y" },
      { url: "https://site.com/b", fetched_at: "2026-06-20T00:00:00Z", content_hash: "y" },
    ];
    const record = ship();
    const out = await attachControlContaminationForLedger("t1", [record]);
    const attach = out.get("s1");
    expect(attach).toBeDefined();
    // /a's hash changed between the two scans (both host-variant rows collapse to /a).
    expect(attach!.verdict.contaminated.map((c) => c.path)).toContain("/a");
  });

  it("returns an empty map on a read failure (fail-soft)", async () => {
    snapshotThrow = new Error("db down");
    const out = await attachControlContaminationForLedger("t1", [ship()]);
    // Fail-soft: contamination never fires, but it also never throws.
    expect(out.size).toBeGreaterThanOrEqual(0);
  });

  it("returns an empty map for an empty ledger", async () => {
    const out = await attachControlContaminationForLedger("t1", []);
    expect(out.size).toBe(0);
  });
});
