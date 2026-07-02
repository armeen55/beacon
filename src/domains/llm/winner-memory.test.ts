/**
 * winner-memory (BEACON_500 item 30).
 *
 * Round-trip on an in-memory json-store (same discipline as spike-store.test.ts) +
 * the registration pins that make the store real: GLOBAL classification (harvest
 * runs from a measure-pass tail with no ambient request context, rows carry
 * tenant_id) and the Supabase mirror entry (Vercel durability).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
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
  loadWinnersForLever,
  buildWinnerFewShots,
} from "./winner-memory";
import { classifyStore } from "@/lib/persistence/store-classification";
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
  it("empty text -> all-false / zero", () => {
    expect(extractStructuralFeatures("")).toEqual({
      wordCount: 0,
      leadsWithAnswer: false,
      hasNumber: false,
      questionHeading: false,
    });
  });

  it("counts words correctly", () => {
    expect(extractStructuralFeatures("one two three four five").wordCount).toBe(5);
  });

  it("a direct concrete claim leads with an answer", () => {
    const f = extractStructuralFeatures("Chaharshanbe Suri falls on the last Wednesday eve of the Persian year, March 17 2026.");
    expect(f.leadsWithAnswer).toBe(true);
  });

  it("a dictionary-style opener does NOT lead with an answer", () => {
    const f = extractStructuralFeatures("A gift is a voluntarily transferred item given without expecting payment in return.");
    expect(f.leadsWithAnswer).toBe(false);
  });

  it("a deferral opener does NOT lead with an answer", () => {
    const f = extractStructuralFeatures("It depends on the region and the family's own traditions and preferences.");
    expect(f.leadsWithAnswer).toBe(false);
  });

  it("detects a number anywhere in the text", () => {
    expect(extractStructuralFeatures("There are 12 provinces represented at the festival.").hasNumber).toBe(true);
    expect(extractStructuralFeatures("There are provinces represented at the festival.").hasNumber).toBe(false);
  });

  it("detects a question-form heading (ends with ? or starts with a wh-word)", () => {
    expect(extractStructuralFeatures("When is Chaharshanbe Suri?\nIt falls on the last Tuesday night.").questionHeading).toBe(true);
    expect(extractStructuralFeatures("What Is Chaharshanbe Suri\nA fire-jumping festival.").questionHeading).toBe(true);
    expect(extractStructuralFeatures("Chaharshanbe Suri Traditions\nA fire-jumping festival.").questionHeading).toBe(false);
  });
});

describe("registration pins", () => {
  it("winner-memory is a GLOBAL store (measure-pass fan-out; rows carry tenant_id)", () => {
    expect(classifyStore("winner-memory")).toBe("global");
  });

  it("winner-memory is Supabase-mirrored (survives Vercel read-only fs)", () => {
    const src = readFileSync(resolve(__dirname, "../../lib/persistence/json-store.ts"), "utf8");
    const mirrorBlock = src.slice(src.indexOf("SUPABASE_MIRRORED_STORES"), src.indexOf("BLOBS_TABLE"));
    expect(mirrorBlock).toContain('"winner-memory"');
  });
});

describe("harvestWinners - mature-won-only pin", () => {
  it("harvests a mature won record with before+after text", async () => {
    ledger = [record()];
    const res = await harvestWinners("tenant-a", { now: NOW });
    expect(res.harvested).toBe(1);
    const winners = await loadWinners("tenant-a");
    expect(winners).toHaveLength(1);
    expect(winners[0]!.beforeText).toBe("Iranian Singers");
    expect(winners[0]!.afterText).toBe("Top Iranian Singers: 12 Legendary Voices");
    expect(winners[0]!.actionFamily).toBe("title");
    expect(winners[0]!.measuredLift).toBeCloseTo(0.028);
  });

  it("retains after-only text honestly when before is missing (no fabrication)", async () => {
    ledger = [record({ before: null, id: "p2::2026-05-21" })];
    await harvestWinners("tenant-a", { now: NOW });
    const winners = await loadWinners("tenant-a");
    expect(winners[0]!.beforeText).toBeNull();
    expect(winners[0]!.afterText).toBe("Top Iranian Singers: 12 Legendary Voices");
  });

  it("skips a record with no after text at all (nothing to learn from)", async () => {
    ledger = [record({ after: null, id: "p3::2026-05-22" })];
    const res = await harvestWinners("tenant-a", { now: NOW });
    expect(res.harvested).toBe(0);
  });

  it("does NOT harvest an early/interim (non-mature) won verdict", async () => {
    ledger = [record({ windows: [{ ...win28(), day: 7, checkOn: "2026-05-27" }], id: "p4::2026-05-20" })];
    const res = await harvestWinners("tenant-a", { now: NOW });
    expect(res.harvested).toBe(0);
  });

  it("does NOT harvest a lost or inconclusive verdict even with mature windows", async () => {
    ledger = [
      record({ verdict: "lost", id: "p5::2026-05-20" }),
      record({ verdict: "inconclusive", id: "p6::2026-05-20" }),
    ];
    const res = await harvestWinners("tenant-a", { now: NOW });
    expect(res.harvested).toBe(0);
  });

  it("does NOT harvest a mature result with insufficient controls (not truly mature)", async () => {
    ledger = [record({ controlPages: [], id: "p7::2026-05-20" })];
    const res = await harvestWinners("tenant-a", { now: NOW });
    expect(res.harvested).toBe(0);
  });

  it("is idempotent: harvesting twice against the same ledger yields the same stored set", async () => {
    ledger = [record()];
    await harvestWinners("tenant-a", { now: NOW });
    const first = [...stored];
    await harvestWinners("tenant-a", { now: NOW });
    expect(stored).toEqual(first);
  });

  it("caps at 10 per (tenant, actionFamily), newest ship first", async () => {
    ledger = Array.from({ length: 14 }, (_, i) =>
      record({
        id: `many::${i}`,
        shippedAt: `2026-05-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`,
        after: `Winner number ${i}`,
      }),
    );
    await harvestWinners("tenant-a", { now: NOW });
    const winners = await loadWinnersForLever("tenant-a", "title");
    expect(winners).toHaveLength(10);
    // newest ship first
    expect(winners[0]!.shippedAt.slice(8, 10)).toBe("14");
    expect(winners[9]!.shippedAt.slice(8, 10)).toBe("05");
  });

  it("other tenants are untouched by a harvest", async () => {
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
  });
});

describe("buildWinnerFewShots - fragment shape + empty case", () => {
  it("returns '' when no winners exist for the tenant", async () => {
    expect(await buildWinnerFewShots("tenant-empty", "title")).toBe("");
  });

  it("returns '' when winners exist for a DIFFERENT lever only", async () => {
    ledger = [record()]; // title family
    await harvestWinners("tenant-a", { now: NOW });
    expect(await buildWinnerFewShots("tenant-a", "answer")).toBe("");
  });

  it("returns a non-empty fragment with before/after + features + lift when winners exist", async () => {
    ledger = [record()];
    await harvestWinners("tenant-a", { now: NOW });
    const fragment = await buildWinnerFewShots("tenant-a", "title");
    expect(fragment).not.toBe("");
    expect(fragment).toContain("Iranian Singers");
    expect(fragment).toContain("Top Iranian Singers: 12 Legendary Voices");
    expect(fragment).toContain("words");
    expect(fragment).toMatch(/CTR lift/);
  });

  it("honestly labels an after-only example as having no retained prior text", async () => {
    ledger = [record({ before: null })];
    await harvestWinners("tenant-a", { now: NOW });
    const fragment = await buildWinnerFewShots("tenant-a", "title");
    expect(fragment).toContain("no prior text retained");
  });

  it("caps injected examples at 2 even when more winners are retained", async () => {
    ledger = [
      record({ id: "a::1", shippedAt: "2026-05-01T00:00:00.000Z", after: "Winner A" }),
      record({ id: "a::2", shippedAt: "2026-05-02T00:00:00.000Z", after: "Winner B" }),
      record({ id: "a::3", shippedAt: "2026-05-03T00:00:00.000Z", after: "Winner C" }),
    ];
    await harvestWinners("tenant-a", { now: NOW });
    const fragment = await buildWinnerFewShots("tenant-a", "title");
    const bulletCount = (fragment.match(/^- /gm) ?? []).length;
    expect(bulletCount).toBe(2);
    // newest two: C and B, not A
    expect(fragment).toContain("Winner C");
    expect(fragment).toContain("Winner B");
    expect(fragment).not.toContain("Winner A");
  });

  it("never contains an em or en dash", async () => {
    ledger = [record()];
    await harvestWinners("tenant-a", { now: NOW });
    const fragment = await buildWinnerFewShots("tenant-a", "title");
    expect(fragment).not.toMatch(/[–—]/);
  });
});
