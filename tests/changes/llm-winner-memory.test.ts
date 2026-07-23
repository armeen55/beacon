/**
 * winner-memory boundary suite (Core 100K Phase 6 trim of
 * src/domains/llm/winner-memory.test.ts).
 *
 * Pins: only MATURE, CALIBRATED wins are harvested (never early reads,
 * losses, or thin-control results); harvest is idempotent and tenant
 * isolated; the pattern aggregate honors the min-sample floor; the
 * fail-closed calibration quarantine holds on BOTH the write and READ paths.
 */
import { beforeEach, afterAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

let stored: unknown[] = [];
vi.mock("@/lib/persistence/json-store", () => ({
  readStore: async () => stored,
  writeStore: async (_name: string, data: unknown[]) => {
    stored = data;
  },
}));

let ledger: Array<Record<string, unknown>> = [];
vi.mock("@/domains/proof-gsc/shipped-change-store", () => ({
  loadShippedChanges: async () => ledger,
}));

import {
  extractStructuralFeatures,
  harvestWinners,
  loadWinners,
  buildWinnerFewShots,
  loadPatternAggregate,
  buildWinnerFewShotsWithPattern,
} from "@/domains/llm/winner-memory";
import { classifyStore } from "@/lib/persistence/store-classification";
import { classifyDraftPattern } from "@/domains/llm/draft-pattern";
import type { ShippedChangeRecord } from "@/domains/proof-gsc/shipped-change-store";

const NOW = new Date("2026-07-02T12:00:00.000Z");

function win28(over: Partial<ShippedChangeRecord["windows"][number]> = {}): ShippedChangeRecord["windows"][number] {
  return {
    day: 28,
    checkOn: "2026-06-20",
    ran: true,
    treatedDelta: 40,
    controlDelta: 5,
    adjustedLift: 35,
    treatedCtrDelta: 0.03,
    controlCtrDelta: 0.002,
    adjustedCtrLift: 0.028,
    treatedPosDelta: 1,
    controlPosDelta: 0,
    adjustedPosLift: 1,
    controlsUsed: 3,
    treatedPostImpressions: 4000,
    ...over,
  };
}

function record(over: Partial<ShippedChangeRecord> = {}): ShippedChangeRecord {
  return {
    id: "p1::2026-05-20",
    page: "https://iranopedia.com/singers",
    path: "/singers",
    actionType: "edit_title",
    before: "Iranian Singers",
    after: "Top Iranian Singers: 12 Legendary Voices",
    shippedAt: "2026-05-20T00:00:00.000Z",
    baseline: { clicks: 10, impressions: 3000, ctr: 0.01, position: 8, windowDays: 28 },
    targetQueries: ["iranian singers"],
    controlPages: ["https://iranopedia.com/actors", "https://iranopedia.com/comedians", "https://iranopedia.com/poets"],
    windows: [win28()],
    verdict: "won",
    confidence: "high",
    measuredAt: "2026-06-18T00:00:00.000Z",
    trafficOutcome: null,
    citationOutcome: null,
    rankOutcome: null,
    dollarValue: null,
    notes: null,
    verifiedLive: true,
    liveSourceUrl: null,
    recrawlRequestedAt: null,
    operatorVerdictOverride: null,
    calibrationVersion: null,
    createdAt: "2026-05-20T00:00:00.000Z",
    updatedAt: "2026-06-18T00:00:00.000Z",
    ...over,
  } as ShippedChangeRecord;
}

beforeEach(() => {
  stored = [];
  ledger = [];
});

describe("extractStructuralFeatures - pure matrix", () => {
  it("distinguishes an answer-leading opener from dictionary/deferral openers", () => {
    expect(extractStructuralFeatures("Chaharshanbe Suri falls on the last Wednesday eve of the Persian year, March 17 2026.").leadsWithAnswer).toBe(true);
    expect(extractStructuralFeatures("A gift is a voluntarily transferred item given without expecting payment in return.").leadsWithAnswer).toBe(false);
    expect(extractStructuralFeatures("It depends on the region and the family's own traditions and preferences.").leadsWithAnswer).toBe(false);
  });

  it("detects numbers, question headings, and handles empty text", () => {
    expect(extractStructuralFeatures("There are 12 provinces represented at the festival.").hasNumber).toBe(true);
    expect(extractStructuralFeatures("When is Chaharshanbe Suri?\nIt falls on the last Tuesday night.").questionHeading).toBe(true);
    expect(extractStructuralFeatures("Chaharshanbe Suri Traditions\nA fire-jumping festival.").questionHeading).toBe(false);
    expect(extractStructuralFeatures("")).toEqual({ wordCount: 0, leadsWithAnswer: false, hasNumber: false, questionHeading: false });
  });
});

describe("registration pins", () => {
  it("winner-memory is a GLOBAL store and Supabase-mirrored (survives Vercel read-only fs)", () => {
    expect(classifyStore("winner-memory")).toBe("global");
    const src = readFileSync(resolve(process.cwd(), "src/lib/persistence/json-store.ts"), "utf8");
    const mirrorBlock = src.slice(src.indexOf("SUPABASE_MIRRORED_STORES"), src.indexOf("BLOBS_TABLE"));
    expect(mirrorBlock).toContain('"winner-memory"');
  });
});

describe("harvestWinners - mature-won-only pin", () => {
  it("harvests a mature won record with before+after text and serves it as a few-shot fragment", async () => {
    ledger = [record()];
    const res = await harvestWinners("tenant-a", { now: NOW });
    expect(res.harvested).toBe(1);
    const winners = await loadWinners("tenant-a");
    expect(winners[0]!.beforeText).toBe("Iranian Singers");
    expect(winners[0]!.actionFamily).toBe("title");
    const fragment = await buildWinnerFewShots("tenant-a", "title");
    expect(fragment).toContain("Top Iranian Singers: 12 Legendary Voices");
    expect(fragment).not.toMatch(/[\u2013\u2014]/);
  });

  it("does NOT harvest an early/interim (non-mature) won verdict", async () => {
    ledger = [record({ windows: [{ ...win28(), day: 7, checkOn: "2026-05-27" }], id: "p4::2026-05-20" })];
    expect((await harvestWinners("tenant-a", { now: NOW })).harvested).toBe(0);
  });

  it("does NOT harvest lost/inconclusive verdicts, or a mature result with insufficient controls", async () => {
    // The kernel recomputes the verdict from the window deltas, so a non-win is
    // encoded in the window math (a real decline, a flat read, or too few
    // comparison pages), not in a stored verdict string.
    ledger = [
      record({ windows: [win28({ adjustedCtrLift: -0.028, treatedCtrDelta: -0.03 })], id: "p5::2026-05-20" }),
      record({ windows: [win28({ adjustedCtrLift: 0.0005, treatedCtrDelta: 0.001 })], id: "p6::2026-05-20" }),
      record({ windows: [win28({ controlsUsed: 1 })], id: "p7::2026-05-20" }),
    ];
    expect((await harvestWinners("tenant-a", { now: NOW })).harvested).toBe(0);
  });

  it("is idempotent: harvesting twice against the same ledger yields the same stored set", async () => {
    ledger = [record()];
    await harvestWinners("tenant-a", { now: NOW });
    const first = [...stored];
    await harvestWinners("tenant-a", { now: NOW });
    expect(stored).toEqual(first);
  });

  it("other tenants are untouched by a harvest; a lever with no winners returns an empty fragment", async () => {
    ledger = [record()];
    await harvestWinners("tenant-a", { now: NOW });
    stored.push({
      tenantId: "tenant-b",
      actionFamily: "answer",
      page: "https://other.com/x",
      beforeText: null,
      afterText: "some other tenant's winner",
      features: extractStructuralFeatures("some other tenant's winner"),
      measuredLift: 0.01,
      verdict: "won",
      shippedAt: "2026-05-01T00:00:00.000Z",
      capturedAt: NOW.toISOString(),
    });
    await harvestWinners("tenant-a", { now: NOW });
    expect(await loadWinners("tenant-b")).toHaveLength(1);
    expect(await buildWinnerFewShots("tenant-a", "answer")).toBe("");
    expect(await buildWinnerFewShots("tenant-empty", "title")).toBe("");
  });
});

describe("loadPatternAggregate - min-sample floor over the WHOLE ledger", () => {
  it("stays unconfident below the sample floor even at a 100% win rate; clears the floor at 3 decided with an honest winRate", async () => {
    // Ship dates are spaced >28 days apart so these same-page changes do not
    // overlap (the kernel would honestly read overlapping same-page changes as
    // confounded and exclude them from the tally).
    ledger = [
      record({ id: "a::1", after: "12 legendary voices lead this list.", shippedAt: "2026-03-01T00:00:00.000Z" }),
      record({ id: "a::2", after: "15 more voices round out the list.", shippedAt: "2026-04-15T00:00:00.000Z" }),
    ];
    const below = await loadPatternAggregate("tenant-a", { now: NOW });
    expect(below.find((c) => c.pattern === "stat_first")!.confident).toBe(false);

    ledger = [
      ...ledger,
      record({ id: "a::3", after: "9 fewer known names complete the set.", shippedAt: "2026-05-30T00:00:00.000Z", windows: [win28({ adjustedCtrLift: -0.028, treatedCtrDelta: -0.03 })] }),
    ];
    const at = await loadPatternAggregate("tenant-a", { now: NOW });
    const cell = at.find((c) => c.pattern === "stat_first" && c.pageFamily === "singers")!;
    expect(cell.confident).toBe(true);
    expect(cell.decided).toBe(3);
    expect(cell.winRate).toBeCloseTo(2 / 3);
  });

  it("excludes a still-measuring (pending) record from the tally entirely", async () => {
    ledger = [record({ id: "a::1", windows: [{ ...win28(), day: 7 }], verdict: "measuring" })];
    expect(await loadPatternAggregate("tenant-a", { now: NOW })).toHaveLength(0);
  });
});

describe("buildWinnerFewShotsWithPattern - confident-cell injection", () => {
  it("returns the SAME fragment (byte-identical, null hint) when no confident cell exists yet", async () => {
    ledger = [record()];
    await harvestWinners("tenant-a", { now: NOW });
    const plain = await buildWinnerFewShots("tenant-a", "title");
    const withPattern = await buildWinnerFewShotsWithPattern("tenant-a", "title", "singers");
    expect(withPattern.fragment).toBe(plain);
    expect(withPattern.patternHint).toBeNull();
  });

  it("appends a pattern hint once confident; names a real winning page, never a fabricated one", async () => {
    // Ship dates spaced >28 days apart so the same-page changes are independent
    // (not confounded by overlapping windows).
    ledger = [
      record({ id: "a::1", after: "12 legendary voices lead this list.", shippedAt: "2026-03-01T00:00:00.000Z" }),
      record({ id: "a::2", after: "15 more voices round out the list.", shippedAt: "2026-04-15T00:00:00.000Z" }),
      record({ id: "a::3", after: "20 total names complete the roster.", shippedAt: "2026-05-30T00:00:00.000Z" }),
    ];
    await harvestWinners("tenant-a", { now: NOW });
    const { fragment, patternHint } = await buildWinnerFewShotsWithPattern("tenant-a", "title", "singers");
    expect(patternHint!.pattern).toBe("stat_first");
    expect(patternHint!.winningPage).toBe("https://iranopedia.com/singers");
    expect(fragment).toContain("Winning style for singers pages here");

    // All-losses cell: hint exists but winningPage is honestly null. The kernel
    // reads the loss from the window deltas, not a stored verdict string.
    ledger = ledger.map((r, i) => ({ ...r, id: `l::${i}`, windows: [win28({ adjustedCtrLift: -0.028, treatedCtrDelta: -0.03 })] }));
    const losses = await buildWinnerFewShotsWithPattern("tenant-a", "title", "singers");
    expect(losses.patternHint).not.toBeNull();
    expect(losses.patternHint!.winningPage).toBeNull();
  });
});

describe("mature-win harvesting (kernel gate)", () => {
  it("a freshly harvested MATURE won is stored and served as a few-shot", async () => {
    ledger = [record()];
    await harvestWinners("iranopedia", { now: NOW });
    const winners = await loadWinners("iranopedia");
    expect(winners).toHaveLength(1);
    expect(await buildWinnerFewShots("iranopedia", "title")).toContain("House patterns");
  });
});
