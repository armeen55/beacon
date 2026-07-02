/**
 * run-investigation (2026-07-02, master plan item 53) - trigger severity matrix
 * (high family collapse fires, medium never does, high-magnitude sitewide
 * changepoint fires on the biggest family, per-night cap of 2) and the runner's
 * idempotency (a (family, week) already investigated is skipped, never re-run).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── bounded family-rows loader ───────────────────────────────────────
const loadFamilyDailyRowsMock = vi.fn();
vi.mock("./load-family-rows", () => ({
  loadFamilyDailyRows: (...args: unknown[]) => loadFamilyDailyRowsMock(...args),
}));

// ── evidence collectors (all mocked to empty: the ranker matrix is tested
//    in rank-causes.test.ts; here we only care about orchestration) ────
const collectIndexabilityMock = vi.fn();
const collectSerpMock = vi.fn();
const collectRecentChangesMock = vi.fn();
const collectWeatherMock = vi.fn();
vi.mock("./collect-evidence", () => ({
  collectIndexabilityEvidence: (...args: unknown[]) => collectIndexabilityMock(...args),
  collectSerpEvidence: (...args: unknown[]) => collectSerpMock(...args),
  collectRecentChangeEvidence: (...args: unknown[]) => collectRecentChangesMock(...args),
  collectWeatherEvidence: (...args: unknown[]) => collectWeatherMock(...args),
}));

// ── store (idempotency gate + writes) ────────────────────────────────
const hasRecentInvestigationMock = vi.fn();
const writeInvestigationMock = vi.fn();
vi.mock("./investigation-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./investigation-store")>();
  return {
    ...actual,
    hasRecentInvestigation: (...args: unknown[]) => hasRecentInvestigationMock(...args),
    writeInvestigation: (...args: unknown[]) => writeInvestigationMock(...args),
  };
});

// ── algorithm weather (the sitewide-changepoint source) ──────────────
const readAlgorithmWeatherSummaryMock = vi.fn();
vi.mock("@/domains/proof-gsc/algorithm-weather-store", () => ({
  readAlgorithmWeatherSummary: (...args: unknown[]) => readAlgorithmWeatherSummaryMock(...args),
}));

import {
  selectTriggers,
  runInvestigationForTenant,
  MAX_INVESTIGATIONS_PER_NIGHT,
  CHANGEPOINT_HIGH_MAGNITUDE,
} from "./run-investigation";
import type { FamilyCollapse } from "./family-collapse";

beforeEach(() => {
  loadFamilyDailyRowsMock.mockReset().mockResolvedValue([]);
  collectIndexabilityMock.mockReset().mockResolvedValue([]);
  collectSerpMock.mockReset().mockResolvedValue([]);
  collectRecentChangesMock.mockReset().mockResolvedValue([]);
  collectWeatherMock.mockReset().mockResolvedValue([]);
  hasRecentInvestigationMock.mockReset().mockResolvedValue(false);
  writeInvestigationMock.mockReset().mockResolvedValue(undefined);
  readAlgorithmWeatherSummaryMock.mockReset().mockResolvedValue(null);
});

function collapse(over: Partial<FamilyCollapse> = {}): FamilyCollapse {
  return {
    family: "cheetah",
    pages: ["https://example.com/cheetah/facts"],
    thisWeekClicks: 40,
    typicalWeekClicks: 140,
    dropPct: -0.7,
    severity: "high",
    collapseDate: "2026-06-20",
    ...over,
  };
}

describe("selectTriggers - severity threshold", () => {
  it("a high-severity collapse (>= 60 percent drop) fires a trigger", () => {
    const out = selectTriggers({ collapses: [collapse()], sitewideChangepoints: [], biggestFamily: null });
    expect(out).toHaveLength(1);
    expect(out[0]!.source).toBe("family_collapse");
  });

  it("a medium-severity collapse never fires", () => {
    const out = selectTriggers({
      collapses: [collapse({ severity: "medium", dropPct: -0.45 })],
      sitewideChangepoints: [],
      biggestFamily: null,
    });
    expect(out).toEqual([]);
  });

  it("caps at MAX_INVESTIGATIONS_PER_NIGHT even with more high collapses", () => {
    const collapses = [
      collapse({ family: "a", dropPct: -0.9 }),
      collapse({ family: "b", dropPct: -0.8 }),
      collapse({ family: "c", dropPct: -0.7 }),
    ];
    const out = selectTriggers({ collapses, sitewideChangepoints: [], biggestFamily: null });
    expect(out).toHaveLength(MAX_INVESTIGATIONS_PER_NIGHT);
  });

  it("ranks the biggest drop first when capping", () => {
    const collapses = [
      collapse({ family: "small", dropPct: -0.65 }),
      collapse({ family: "big", dropPct: -0.95 }),
      collapse({ family: "mid", dropPct: -0.8 }),
    ];
    const out = selectTriggers({ collapses, sitewideChangepoints: [], biggestFamily: null });
    expect(out.map((t) => (t.source === "family_collapse" ? t.collapse.family : ""))).toEqual(["big", "mid"]);
  });
});

describe("selectTriggers - sitewide changepoint", () => {
  const bigFamily = collapse({ family: "persian-names", severity: "medium", dropPct: -0.4 });

  it("a high-magnitude DOWN changepoint fires on the biggest family", () => {
    const out = selectTriggers({
      collapses: [],
      sitewideChangepoints: [{ date: "2026-06-04", direction: "down", magnitude: 0.8 }],
      biggestFamily: bigFamily,
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.source).toBe("sitewide_changepoint");
  });

  it("an UP changepoint never fires (growth is not a collapse)", () => {
    const out = selectTriggers({
      collapses: [],
      sitewideChangepoints: [{ date: "2026-06-04", direction: "up", magnitude: 2.0 }],
      biggestFamily: bigFamily,
    });
    expect(out).toEqual([]);
  });

  it("a below-threshold magnitude never fires", () => {
    const out = selectTriggers({
      collapses: [],
      sitewideChangepoints: [{ date: "2026-06-04", direction: "down", magnitude: CHANGEPOINT_HIGH_MAGNITUDE - 0.01 }],
      biggestFamily: bigFamily,
    });
    expect(out).toEqual([]);
  });

  it("skips the changepoint trigger when its target family is already covered by its own collapse", () => {
    const covered = collapse({ family: "persian-names", severity: "high", dropPct: -0.7 });
    const out = selectTriggers({
      collapses: [covered],
      sitewideChangepoints: [{ date: "2026-06-04", direction: "down", magnitude: 0.8 }],
      biggestFamily: covered,
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.source).toBe("family_collapse");
  });
});

describe("runInvestigationForTenant - idempotency + orchestration", () => {
  function highCollapseRows() {
    // 4 weeks of daily rows for one page: 20 clicks/day baseline then a
    // last week at ~3/day, a real >= 60 percent family drop.
    const rows: Array<{ date: string; page: string; clicks: number }> = [];
    const start = Date.parse("2026-05-25T00:00:00Z");
    for (let i = 0; i < 28; i++) {
      const date = new Date(start + i * 86_400_000).toISOString().slice(0, 10);
      rows.push({ date, page: "https://example.com/cheetah/facts", clicks: i < 21 ? 20 : 3 });
    }
    return rows;
  }

  it("investigates a fresh high collapse and persists a diagnosis", async () => {
    loadFamilyDailyRowsMock.mockResolvedValue(highCollapseRows());
    const result = await runInvestigationForTenant("tenant-a", new Date("2026-06-22T02:00:00.000Z"));
    expect(result.triggered).toBe(1);
    expect(result.investigated).toBe(1);
    expect(writeInvestigationMock).toHaveBeenCalledTimes(1);
    const written = writeInvestigationMock.mock.calls[0]![0] as { family: string; diagnosis: { headline: string } };
    expect(written.family).toBe("cheetah");
    expect(written.diagnosis.headline).toContain("cheetah");
  });

  it("skips a (family, week) already investigated - never re-runs", async () => {
    loadFamilyDailyRowsMock.mockResolvedValue(highCollapseRows());
    hasRecentInvestigationMock.mockResolvedValue(true);
    const result = await runInvestigationForTenant("tenant-a", new Date("2026-06-22T02:00:00.000Z"));
    expect(result.triggered).toBe(1);
    expect(result.skippedIdempotent).toBe(1);
    expect(result.investigated).toBe(0);
    expect(writeInvestigationMock).not.toHaveBeenCalled();
    expect(collectIndexabilityMock).not.toHaveBeenCalled(); // no evidence spend on a skip
  });

  it("returns zeros for a tenant with no data at all", async () => {
    const result = await runInvestigationForTenant("tenant-a");
    expect(result).toEqual({ triggered: 0, investigated: 0, skippedIdempotent: 0, errors: 0 });
  });

  it("a collector failure on one investigation counts an error but never throws", async () => {
    loadFamilyDailyRowsMock.mockResolvedValue(highCollapseRows());
    collectIndexabilityMock.mockRejectedValue(new Error("network down"));
    const result = await runInvestigationForTenant("tenant-a", new Date("2026-06-22T02:00:00.000Z"));
    expect(result.errors).toBe(1);
    expect(result.investigated).toBe(0);
  });

  it("empty tenant id short-circuits without any reads", async () => {
    const result = await runInvestigationForTenant("");
    expect(result.triggered).toBe(0);
    expect(loadFamilyDailyRowsMock).not.toHaveBeenCalled();
  });

  it("a sitewide changepoint with NO family collapse still investigates the biggest family", async () => {
    // Flat rows: no family collapse fires, but the biggest family exists.
    const rows: Array<{ date: string; page: string; clicks: number }> = [];
    const start = Date.parse("2026-05-25T00:00:00Z");
    for (let i = 0; i < 28; i++) {
      const date = new Date(start + i * 86_400_000).toISOString().slice(0, 10);
      rows.push({ date, page: "https://example.com/persian-names/boys", clicks: 50 });
      rows.push({ date, page: "https://example.com/cheetah/facts", clicks: 5 });
    }
    loadFamilyDailyRowsMock.mockResolvedValue(rows);
    readAlgorithmWeatherSummaryMock.mockResolvedValue({
      tenant_id: "tenant-a",
      computed_at: "2026-06-21T00:00:00.000Z",
      anchor_date: "2026-06-20",
      clicksChangepoints: [{ date: "2026-06-04", direction: "down", magnitude: 0.8 }],
      impressionsChangepoints: [],
    });
    const result = await runInvestigationForTenant("tenant-a", new Date("2026-06-22T02:00:00.000Z"));
    expect(result.triggered).toBe(1);
    expect(result.investigated).toBe(1);
    const written = writeInvestigationMock.mock.calls[0]![0] as { family: string; collapse_date: string };
    expect(written.family).toBe("persian-names");
    expect(written.collapse_date).toBe("2026-06-04"); // dated to the changepoint alarm
  });
});
