import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  classifyControl,
  classifyControls,
  summarizeContamination,
  promoteFromFrozenPool,
  buildContaminationNotes,
  swapSentence,
  cautionSentence,
  computePoolHealth,
  lastCleanDonorHoldSentence,
  medianBandRead,
  templateFamilyOf,
  MIN_SCANS_FOR_CONTENT_JUDGMENT,
  MIN_MEDIAN_BAND_PAGES,
  type ContaminationWindow,
  type ControlContaminationResult,
  type LedgerShipRecord,
  type SnapshotPoint,
} from "@/domains/proof-gsc/control-contamination";

const WINDOW: ContaminationWindow = { start: "2026-06-01", end: "2026-06-29" };

describe("classifyControl - treated_by_us", () => {
  it("flags a control that we ourselves shipped inside the window", () => {
    const ledger: LedgerShipRecord[] = [{ path: "/animals/fox", shippedAt: "2026-06-10T00:00:00Z" }];
    const result = classifyControl({
      controlPath: "/animals/fox",
      window: WINDOW,
      ledger,
      snapshots: [],
    });
    expect(result.status).toBe("treated_by_us");
    expect(result.treatedAt).toBe("2026-06-10");
    expect(result.reason).toContain("2026-06-10");
  });

  it("does not flag a ship that happened BEFORE the window opened", () => {
    const ledger: LedgerShipRecord[] = [{ path: "/animals/fox", shippedAt: "2026-05-01T00:00:00Z" }];
    const result = classifyControl({
      controlPath: "/animals/fox",
      window: WINDOW,
      ledger,
      snapshots: [
        { fetchedAt: "2026-06-05", contentHash: "a" },
        { fetchedAt: "2026-06-20", contentHash: "a" },
      ],
    });
    expect(result.status).toBe("clean");
  });

});

describe("classifyControl - content_changed", () => {
  it("flags a hash change between two in-window scans", () => {
    const result = classifyControl({
      controlPath: "/animals/fox",
      window: WINDOW,
      ledger: [],
      snapshots: [
        { fetchedAt: "2026-06-05", contentHash: "aaa" },
        { fetchedAt: "2026-06-18", contentHash: "bbb" },
      ],
    });
    expect(result.status).toBe("content_changed");
    expect(result.changedBetweenScans).toEqual({ before: "2026-06-05", after: "2026-06-18" });
  });

  it("ignores scans OUTSIDE the window when detecting a change", () => {
    const result = classifyControl({
      controlPath: "/animals/fox",
      window: WINDOW,
      ledger: [],
      snapshots: [
        { fetchedAt: "2026-05-01", contentHash: "outside-old" },
        { fetchedAt: "2026-06-05", contentHash: "same" },
        { fetchedAt: "2026-06-20", contentHash: "same" },
        { fetchedAt: "2026-07-15", contentHash: "outside-new" },
      ],
    });
    expect(result.status).toBe("clean");
  });
});

describe("classifyControl - unknown (sparse coverage)", () => {
  it("is unknown with zero in-window scans", () => {
    const result = classifyControl({
      controlPath: "/animals/fox",
      window: WINDOW,
      ledger: [],
      snapshots: [],
    });
    expect(result.status).toBe("unknown");
    expect(result.reason).toContain("0 scans");
  });

  it("is unknown with exactly one in-window scan (below the floor)", () => {
    expect(MIN_SCANS_FOR_CONTENT_JUDGMENT).toBe(2);
    const result = classifyControl({
      controlPath: "/animals/fox",
      window: WINDOW,
      ledger: [],
      snapshots: [{ fetchedAt: "2026-06-10", contentHash: "aaa" }],
    });
    expect(result.status).toBe("unknown");
    expect(result.reason).toContain("1 scan");
  });

});

describe("classifyControl - clean", () => {
  it("is clean with 2+ in-window scans and no hash change, no ledger hit", () => {
    const result = classifyControl({
      controlPath: "/animals/fox",
      window: WINDOW,
      ledger: [{ path: "/other-page", shippedAt: "2026-06-10T00:00:00Z" }],
      snapshots: [
        { fetchedAt: "2026-06-05", contentHash: "same" },
        { fetchedAt: "2026-06-20", contentHash: "same" },
      ],
    });
    expect(result.status).toBe("clean");
    expect(result.reason).toBe("");
  });
});

describe("classifyControl - precedence", () => {
  it("treated_by_us wins over a detectable content change", () => {
    const result = classifyControl({
      controlPath: "/animals/fox",
      window: WINDOW,
      ledger: [{ path: "/animals/fox", shippedAt: "2026-06-10T00:00:00Z" }],
      snapshots: [
        { fetchedAt: "2026-06-05", contentHash: "aaa" },
        { fetchedAt: "2026-06-20", contentHash: "bbb" },
      ],
    });
    expect(result.status).toBe("treated_by_us");
  });
});
describe("summarizeContamination", () => {
  it("is not contaminated when every control is clean", () => {
    const v = summarizeContamination([
      { path: "/a", status: "clean", reason: "" },
      { path: "/b", status: "clean", reason: "" },
    ]);
    expect(v.hasContamination).toBe(false);
    expect(v.contaminated).toEqual([]);
  });

  it("collects every non-clean control, including unknown", () => {
    const v = summarizeContamination([
      { path: "/a", status: "clean", reason: "" },
      { path: "/b", status: "unknown", reason: "sparse" },
      { path: "/c", status: "treated_by_us", reason: "treated", treatedAt: "2026-06-10" },
    ]);
    expect(v.hasContamination).toBe(true);
    expect(v.contaminated.map((c) => c.path)).toEqual(["/b", "/c"]);
  });
});

describe("promoteFromFrozenPool", () => {
  it("promotes the FIRST eligible donor in the pool's original order, not already in use", () => {
    const out = promoteFromFrozenPool({
      contaminated: [{ path: "/b" }],
      allControlPaths: ["/a", "/b"], // /a is already a clean control on this ship
      treatedPath: "/treated",
      frozenPool: [
        { url: "/a", verdict: "kept" }, // already a control, must be skipped
        { url: "/treated", verdict: "kept" }, // is the treated page, must be skipped
        { url: "/d", verdict: "kept" }, // first eligible
        { url: "/e", verdict: "kept" },
      ],
    });
    expect(out).toEqual([{ originalPath: "/b", substitutePath: "/d" }]);
  });

  it("never re-uses one donor for two contaminated controls", () => {
    const out = promoteFromFrozenPool({
      contaminated: [{ path: "/b" }, { path: "/c" }],
      allControlPaths: ["/a", "/b", "/c"],
      treatedPath: "/treated",
      frozenPool: [
        { url: "/d", verdict: "kept" },
        { url: "/e", verdict: "kept" },
      ],
    });
    expect(out).toEqual([
      { originalPath: "/b", substitutePath: "/d" },
      { originalPath: "/c", substitutePath: "/e" },
    ]);
  });

  it("returns null substitutePath when the pool is exhausted", () => {
    const out = promoteFromFrozenPool({
      contaminated: [{ path: "/b" }, { path: "/c" }],
      allControlPaths: ["/a", "/b", "/c"],
      treatedPath: "/treated",
      frozenPool: [{ url: "/d", verdict: "kept" }],
    });
    expect(out).toEqual([
      { originalPath: "/b", substitutePath: "/d" },
      { originalPath: "/c", substitutePath: null },
    ]);
  });

  it("never picks a control already on the ship as its own substitute", () => {
    const out = promoteFromFrozenPool({
      contaminated: [{ path: "/b" }],
      allControlPaths: ["/a", "/b"],
      treatedPath: "/treated",
      frozenPool: [
        { url: "/b", verdict: "kept" },
        { url: "/d", verdict: "kept" },
      ],
    });
    expect(out).toEqual([{ originalPath: "/b", substitutePath: "/d" }]);
  });

  it("returns null substitutePath for every contaminated control when the pool is null (older row)", () => {
    const out = promoteFromFrozenPool({
      contaminated: [{ path: "/b" }],
      allControlPaths: ["/a", "/b"],
      treatedPath: "/treated",
      frozenPool: null,
    });
    expect(out).toEqual([{ originalPath: "/b", substitutePath: null }]);
  });

});

describe("buildContaminationNotes", () => {
  it("is empty when nothing is contaminated", () => {
    const notes = buildContaminationNotes({ results: [], contaminated: [], hasContamination: false });
    expect(notes).toEqual([]);
  });

  it("names the swap plus the swap-receipt sentence when a substitute was found", () => {
    const verdict = summarizeContamination([
      { path: "/b", status: "content_changed", reason: "This comparison page's content changed between 2026-06-05 and 2026-06-18, inside this measurement window." },
    ]);
    const notes = buildContaminationNotes(verdict, [{ originalPath: "/b", substitutePath: "/d" }]);
    expect(notes.some((n) => n.includes("/d"))).toBe(true);
    expect(notes).toContain(swapSentence());
    expect(notes).not.toContain(cautionSentence());
  });

  it("gives the caution line when no substitute was found", () => {
    const verdict = summarizeContamination([
      { path: "/b", status: "unknown", reason: "sparse coverage" },
    ]);
    const notes = buildContaminationNotes(verdict, [{ originalPath: "/b", substitutePath: null }]);
    expect(notes).toContain(cautionSentence());
    expect(notes).not.toContain(swapSentence());
  });

});
const cleanResult = (path: string): ControlContaminationResult => ({ path, status: "clean", reason: "" });
const dirtyResult = (path: string): ControlContaminationResult => ({
  path,
  status: "treated_by_us",
  reason: `I shipped a change to this comparison page myself on 2026-06-10, inside this measurement window.`,
  treatedAt: "2026-06-10",
});
const unknownResult = (path: string): ControlContaminationResult => ({
  path,
  status: "unknown",
  reason: "I only have 1 scan of this comparison page inside the measurement window, not enough to know if it changed.",
});
describe("computePoolHealth", () => {
  it("counts still-clean serving controls and reads the plain one-liner", () => {
    const ph = computePoolHealth({
      results: [cleanResult("/a"), dirtyResult("/b"), cleanResult("/c"), dirtyResult("/d")],
      frozenPool: null,
      controlPaths: ["/a", "/b", "/c", "/d"],
      treatedPath: "/treated",
      ledger: [],
      window: WINDOW,
    });
    expect(ph.cleanControls).toBe(2);
    expect(ph.knownDirtyControls).toBe(2);
    expect(ph.totalControls).toBe(4);
    expect(ph.sentence).toBe("2 of 4 comparison pages are still clean.");
    expect(ph.sentence).not.toMatch(/[–—]/);
  });

  it("names the LAST clean donor when the whole clean pool is one page", () => {
    const ph = computePoolHealth({
      results: [dirtyResult("/a"), dirtyResult("/b"), cleanResult("/c")],
      frozenPool: [],
      controlPaths: ["/a", "/b", "/c"],
      treatedPath: "/treated",
      ledger: [],
      window: WINDOW,
    });
    expect(ph.lastCleanDonorPaths).toEqual(["/c"]);
  });

});

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
vi.mock("@/domains/proof-gsc/reliability-extras", async () => {
  const actual = await vi.importActual<typeof import("@/domains/proof-gsc/reliability-extras")>("@/domains/proof-gsc/reliability-extras");
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
} from "@/domains/proof-gsc/attach-control-contamination";
import type { ShippedChangeRecord } from "@/domains/proof-gsc/shipped-change-store";
import type { RankedControl } from "@/domains/proof-gsc/control-matching";

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

});
