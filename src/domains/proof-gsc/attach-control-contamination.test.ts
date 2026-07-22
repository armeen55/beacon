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

// N16: the median-band fallback lazily imports the permutation-null builder
// (a heavy page-surgeon chain in production, now part of reliability-extras).
// Mocked here to a controllable distribution so the batch tests stay hermetic
// and deterministic.
let nullDistPages: Array<{ page: string; delta: number; pseudoLift: number }> = [];
vi.mock("./reliability-extras", async () => {
  const actual = await vi.importActual<typeof import("./reliability-extras")>("./reliability-extras");
  return {
    ...actual,
    buildPermutationNull: vi.fn(async () => ({ pages: nullDistPages, shipDate: "2026-06-01", windowDays: 7 })),
  };
});

import {
  computeContaminationForShip,
  attachControlContaminationForLedger,
  computeLastCleanDonorHolds,
  serializeContaminationAttachment,
  deserializeContaminationAttachment,
  isContaminationFrozen,
} from "./attach-control-contamination";
import type { ShippedChangeRecord } from "./shipped-change-store";
import type { RankedControl } from "./control-matching";

function donor(url: string, verdict: RankedControl["verdict"] = "kept"): RankedControl {
  return { url, verdict, similarityRatio: 1, slopeDivergence: 0, queryOverlap: 0, reason: verdict };
}

/** A CLOSED (frozen) ship: its terminal 28-day window has run, so
 *  isContaminationFrozen(...) === true and its verdict is snapshot-cacheable. */
function frozenShip(over: Partial<ShippedChangeRecord> = {}): ShippedChangeRecord {
  return ship({
    verdict: "won",
    windows: [
      { day: 28, checkOn: "2026-06-29", ran: true, treatedDelta: 0, controlDelta: 0, adjustedLift: 0, treatedCtrDelta: 0, controlCtrDelta: 0, adjustedCtrLift: 0, treatedPosDelta: 0, controlPosDelta: 0, adjustedPosLift: 0, controlsUsed: 2 },
    ],
    ...over,
  });
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
    operatorVerdictOverride: null, calibrationVersion: null,
    createdAt: "2026-06-01T00:00:00Z",
    updatedAt: "2026-06-01T00:00:00Z",
    ...over,
  };
}

beforeEach(() => {
  snapshotRows = [];
  snapshotThrow = null;
  rangeCalls.length = 0;
  nullDistPages = [];
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

// ---------------------------------------------------------------------------
// N16 (R5, 2026-07-03) - pool health line, median-band fallback, planner holds
// ---------------------------------------------------------------------------

describe("computeContaminationForShip - N16 pool health", () => {
  const cleanSnapshots = new Map([
    ["/a", [{ fetchedAt: "2026-06-02", contentHash: "x" }, { fetchedAt: "2026-06-06", contentHash: "x" }]],
    ["/b", [{ fetchedAt: "2026-06-02", contentHash: "y" }, { fetchedAt: "2026-06-06", contentHash: "y" }]],
  ]);

  it("carries the plain pool-health line for an OPEN measurement, spares included", () => {
    const record = ship({ verdict: "measuring", controlDonorPool: [donor("https://site.com/c")] });
    const out = computeContaminationForShip({ record, otherShips: [], snapshotsByPath: cleanSnapshots });
    expect(out!.poolHealth.cleanControls).toBe(2);
    expect(out!.poolHealth.spareDonors).toBe(1);
    expect(out!.poolHealthLine).toBe(
      "2 of 2 comparison pages are still clean. 1 spare comparison page is ready from the list I chose before shipping.",
    );
    expect(out!.poolHealthLine).not.toMatch(/[–—]/);
  });

  it("hides the line once the measurement settles (verdict not measuring)", () => {
    const record = ship({ verdict: "won" });
    const out = computeContaminationForShip({ record, otherShips: [], snapshotsByPath: cleanSnapshots });
    expect(out!.poolHealthLine).toBeNull();
    expect(out!.poolHealth.totalControls).toBe(2); // health numbers still computed
  });

  it("counts a contaminated serving control against the line when no substitute existed", () => {
    const record = ship({ verdict: "measuring", controlDonorPool: null });
    const out = computeContaminationForShip({
      record,
      otherShips: [{ path: "/a", shippedAt: "2026-06-05T00:00:00Z" }],
      snapshotsByPath: cleanSnapshots,
    });
    expect(out!.poolHealthLine).toBe("1 of 2 comparison pages are still clean.");
    expect(out!.poolHealth.lastCleanDonorPaths).toEqual(["/b"]);
  });
});

describe("computeLastCleanDonorHolds - the planner avoidance input", () => {
  it("holds the single remaining clean comparison page of an open measurement", async () => {
    const treatedShip = ship({ verdict: "measuring", controlDonorPool: null });
    const contaminator = ship({
      id: "s2",
      page: "https://site.com/a",
      path: "/a",
      shippedAt: "2026-06-05T00:00:00Z",
      controlPages: [], // no attachment of its own; exists to contaminate s1's /a
    });
    const attachments = await attachControlContaminationForLedger("t1", [treatedShip, contaminator]);
    const holds = computeLastCleanDonorHolds([treatedShip, contaminator], attachments);
    expect(holds.get("/b")).toBe(
      "I am holding this page because it is the last clean comparison page for a change I am still measuring on /treated.",
    );
    expect(holds.size).toBe(1);
  });

  it("holds nothing for a settled measurement or a healthy pool", async () => {
    const settled = ship({ verdict: "won" });
    const attachments = await attachControlContaminationForLedger("t1", [settled]);
    expect(computeLastCleanDonorHolds([settled], attachments).size).toBe(0);

    const healthy = ship({ verdict: "measuring", controlDonorPool: [donor("https://site.com/c")] });
    const attachments2 = await attachControlContaminationForLedger("t1", [healthy]);
    expect(computeLastCleanDonorHolds([healthy], attachments2).size).toBe(0);
  });
});

describe("attachControlContaminationForLedger - N16 median-band fallback", () => {
  it("attaches the weaker median-band read when the pool is exhausted, as the LAST note", async () => {
    // /a contaminated (treated by s2), NO donor pool -> exhausted -> median band.
    const treatedShip = ship({
      verdict: "measuring",
      controlDonorPool: null,
      windows: [{ day: 7, checkOn: "2026-06-08", ran: true, treatedDelta: 6, controlDelta: 0, adjustedLift: 6, treatedCtrDelta: 0, controlCtrDelta: 0, adjustedCtrLift: 0, treatedPosDelta: 0, controlPosDelta: 0, adjustedPosLift: 0, controlsUsed: 2 }],
    });
    const contaminator = ship({ id: "s2", page: "https://site.com/a", path: "/a", shippedAt: "2026-06-05T00:00:00Z", controlPages: [] });
    // Same template family as /treated (first segment "treated").
    nullDistPages = [
      { page: "https://site.com/treated/x", delta: 1, pseudoLift: 0 },
      { page: "https://site.com/treated/y", delta: 2, pseudoLift: 0 },
      { page: "https://site.com/treated/z", delta: 9, pseudoLift: 0 },
      { page: "https://site.com/other/q", delta: 100, pseudoLift: 0 }, // different family - ignored
    ];
    const out = await attachControlContaminationForLedger("t1", [treatedShip, contaminator]);
    const attach = out.get("s1")!;
    expect(attach.medianBand).not.toBeNull();
    expect(attach.medianBand!.medianDelta).toBe(2);
    expect(attach.medianBand!.pagesUsed).toBe(3);
    expect(attach.notes.at(-1)).toContain("That is a weaker comparison");
    expect(attach.notes.at(-1)).toContain("this page gained 6 clicks while the typical one of 3 gained 2 clicks");
  });

  it("stays on the plain caution when too few same-family pages exist (honest silence)", async () => {
    const treatedShip = ship({ verdict: "measuring", controlDonorPool: null });
    const contaminator = ship({ id: "s2", page: "https://site.com/a", path: "/a", shippedAt: "2026-06-05T00:00:00Z", controlPages: [] });
    nullDistPages = [{ page: "https://site.com/treated/x", delta: 1, pseudoLift: 0 }];
    const out = await attachControlContaminationForLedger("t1", [treatedShip, contaminator]);
    const attach = out.get("s1")!;
    expect(attach.medianBand).toBeNull();
    expect(attach.notes.at(-1)).toBe("A comparison page changed during measurement, so I am reading this result with caution.");
  });

  it("never fires the median band when every contaminated control found a substitute (pool NOT exhausted)", async () => {
    // Both /a (treated by s2) and /b (unverified scans) classify contaminated in
    // this fixture (no snapshot rows), so give the bench TWO donors - every
    // contaminated control promotes, nothing is exhausted, no median band.
    const treatedShip = ship({
      verdict: "measuring",
      controlDonorPool: [donor("https://site.com/c"), donor("https://site.com/d")],
    });
    const contaminator = ship({ id: "s2", page: "https://site.com/a", path: "/a", shippedAt: "2026-06-05T00:00:00Z", controlPages: [] });
    nullDistPages = [
      { page: "https://site.com/treated/x", delta: 1, pseudoLift: 0 },
      { page: "https://site.com/treated/y", delta: 2, pseudoLift: 0 },
      { page: "https://site.com/treated/z", delta: 9, pseudoLift: 0 },
    ];
    const out = await attachControlContaminationForLedger("t1", [treatedShip, contaminator]);
    expect(out.get("s1")!.medianBand).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Snapshot precompute (2026-07-21) - the /results SWR snapshot caches CLOSED
// (frozen 28-day) rows' contamination verdicts so a GET never re-runs their
// median-band permutation-null read. Three pins: the closed/open discriminator,
// the JSON round-trip of the serialized field, and that a GET serves frozen
// rows from cache while NEVER caching (or trusting a cache for) an open row.
// ---------------------------------------------------------------------------

describe("isContaminationFrozen - the closed/open discriminator", () => {
  it("is FROZEN only once the terminal 28-day window has run", () => {
    expect(isContaminationFrozen(frozenShip())).toBe(true); // 28d ran -> immutable
    expect(isContaminationFrozen(ship())).toBe(false); // default 7d only -> still open
    expect(isContaminationFrozen({ windows: [{ day: 14, ran: true }] } as unknown as ShippedChangeRecord)).toBe(false); // 14d -> can still grow to 28
    expect(isContaminationFrozen({ windows: [] } as unknown as ShippedChangeRecord)).toBe(false); // nothing closed
    expect(isContaminationFrozen({ windows: undefined } as unknown as ShippedChangeRecord)).toBe(false); // absent field tolerated
  });
});

describe("serialize/deserialize contamination attachment - snapshot round-trip", () => {
  it("round-trips every field (Map <-> entries) and survives JSON", async () => {
    // A frozen row with one promotable donor and a second contaminated control
    // with none, so verdict, substitutesByOriginal, notes and poolHealth are all
    // populated (a maximally non-trivial attachment to round-trip).
    const record = frozenShip({ controlDonorPool: [donor("https://site.com/c")] });
    const contaminator = ship({ id: "s2", page: "https://site.com/a", path: "/a", shippedAt: "2026-06-05T00:00:00Z", controlPages: [] });
    const att = (await attachControlContaminationForLedger("t1", [record, contaminator])).get("s1")!;
    expect(att.verdict.hasContamination).toBe(true); // guard: we're round-tripping a real verdict

    const serialized = serializeContaminationAttachment(att);
    // Bounded + JSON-safe: no Map survives into the stored shape, and a
    // JSON.parse(JSON.stringify(...)) is a no-op (nothing lost/mutated).
    expect(Array.isArray(serialized.substitutesByOriginal)).toBe(true);
    expect(JSON.parse(JSON.stringify(serialized))).toEqual(serialized);

    const round = deserializeContaminationAttachment(serialized);
    expect(round.substitutesByOriginal instanceof Map).toBe(true);
    expect([...round.substitutesByOriginal.entries()]).toEqual([...att.substitutesByOriginal.entries()]);
    expect(round.verdict).toEqual(att.verdict);
    expect(round.effectiveControlPages).toEqual(att.effectiveControlPages);
    expect(round.notes).toEqual(att.notes);
    expect(round.poolHealth).toEqual(att.poolHealth);
    expect(round.poolHealthLine).toBe(att.poolHealthLine);
    expect(round.medianBand).toEqual(att.medianBand);
  });
});

describe("attachControlContaminationForLedger - serves FROZEN rows from the snapshot cache", () => {
  it("serves a frozen row straight from cache: no page_snapshots read, exact object returned", async () => {
    const record = frozenShip();
    const cached = computeContaminationForShip({ record, otherShips: [], snapshotsByPath: new Map() })!;
    rangeCalls.length = 0;
    const out = await attachControlContaminationForLedger("t1", [record], new Map([["s1", cached]]));
    expect(out.get("s1")).toBe(cached); // the cached object itself, not a recompute
    expect(rangeCalls.length).toBe(0); // never touched page_snapshots
  });

  it("NEVER serves an OPEN row from cache even if present in the map (defensive re-check recomputes live)", async () => {
    const openRec = ship(); // 7-day only -> not frozen
    const stale = computeContaminationForShip({ record: openRec, otherShips: [], snapshotsByPath: new Map() })!;
    rangeCalls.length = 0;
    const out = await attachControlContaminationForLedger("t1", [openRec], new Map([["s1", stale]]));
    expect(out.get("s1")).not.toBe(stale); // recomputed, not served from the (untrusted) cache
    expect(rangeCalls.length).toBeGreaterThan(0); // it did read page_snapshots live
  });

  it("mixes a cache-served frozen row with a live-computed open row in one pass", async () => {
    const frozen = frozenShip({ id: "s1", page: "https://site.com/treated", path: "/treated" });
    const open = ship({ id: "s2", page: "https://site.com/open", path: "/open", controlPages: ["https://site.com/x"] });
    const cachedFrozen = computeContaminationForShip({
      record: frozen,
      otherShips: [{ path: "/open", shippedAt: open.shippedAt }],
      snapshotsByPath: new Map(),
    })!;
    const out = await attachControlContaminationForLedger("t1", [frozen, open], new Map([["s1", cachedFrozen]]));
    expect(out.get("s1")).toBe(cachedFrozen); // frozen served from cache
    expect(out.get("s2")).toBeDefined(); // open still computed live
    expect(rangeCalls.length).toBeGreaterThan(0); // the live open row drove a read
  });

  it("no cache passed -> byte-identical to the pre-cache behavior (old snapshots keep working)", async () => {
    snapshotRows = [
      { url: "https://site.com/a", fetched_at: "2026-06-02T00:00:00Z", content_hash: "x" },
      { url: "https://site.com/a", fetched_at: "2026-06-10T00:00:00Z", content_hash: "z" },
    ];
    const withoutArg = await attachControlContaminationForLedger("t1", [frozenShip()]);
    const withEmpty = await attachControlContaminationForLedger("t1", [frozenShip()], new Map());
    expect(withoutArg.get("s1")!.verdict.contaminated.map((c) => c.path)).toContain("/a");
    expect(withEmpty.get("s1")!.verdict.contaminated.map((c) => c.path)).toContain("/a");
  });
});
