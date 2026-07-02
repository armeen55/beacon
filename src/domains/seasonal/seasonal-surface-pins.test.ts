/**
 * Seasonal surface + wiring pins (2026-07-02, master plan item 21).
 *
 * Source-level pins (the trend-radar sibling pattern): the Demand band shows
 * ONE seasonal row below the spike rows, stays silent when nothing is due,
 * the quiet line accounts for it, the nightly cron persists the permanent
 * archive rollup as ONE isolated PHASE 1d step without disturbing PHASE 1c,
 * and the daily plan builder reads the prep-now hint feed additively beside
 * the spike hints. Also the no-dash hard rule over the touched surfaces.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const WAR_ROOM = readFileSync(resolve(__dirname, "../../app/(shell)/war-room-sections.tsx"), "utf8");
const CRON = readFileSync(resolve(__dirname, "../../lib/connectors/cron-sync.ts"), "utf8");
const PREVIEW = readFileSync(resolve(__dirname, "../experiments/build-today-preview.ts"), "utf8");

describe("Demand band seasonal row (war-room-sections)", () => {
  it("reads last night's seasonal pass at $0 and shows exactly one row", () => {
    expect(WAR_ROOM).toContain('from "@/domains/seasonal/seasonal-store"');
    expect(WAR_ROOM).toContain("loadTopSeasonalRow");
    expect(WAR_ROOM).toContain("seasonal[0] ?? null");
  });

  it("places the seasonal row below the spike rows in the Demand band", () => {
    const spikeIdx = WAR_ROOM.indexOf("spikeRows.map(({ spike, searchTerm })");
    const seasonalIdx = WAR_ROOM.indexOf("seasonalRow ?");
    expect(spikeIdx).toBeGreaterThan(-1);
    expect(seasonalIdx).toBeGreaterThan(spikeIdx);
  });

  it("stays silent when research never ran, nothing is spiking, AND nothing is seasonal", () => {
    expect(WAR_ROOM).toContain("res.keywordsConsidered === 0 && spikeRows.length === 0 && !seasonalRow) return null");
  });

  it("the quiet line only claims a clean day when the seasonal row is also quiet", () => {
    expect(WAR_ROOM).toContain("!seasonalRow");
    expect(WAR_ROOM).toContain("nothing seasonal is due");
  });

  it("does not disturb the spike rows' own silence/copy guards", () => {
    expect(WAR_ROOM).toContain("Worth a same-week answer.");
    expect(WAR_ROOM).toContain("matchSpikeToMove");
  });

  it("contains no em or en dashes anywhere", () => {
    expect(WAR_ROOM).not.toMatch(/[–—]/);
  });
});

describe("nightly persistence (cron-sync PHASE 1d)", () => {
  it("runs the archive rollup + seasonality detector as ONE isolated step", () => {
    expect(CRON).toContain("PHASE 1d");
    expect(CRON).toContain("runMonthlyArchiveRollup");
    expect(CRON).toContain("detectSeasonalQueries");
    expect(CRON).toContain("writeSeasonalSummary");
    expect(CRON).toContain("seasonal archive failed");
  });

  it("leaves PHASE 1c (trend radar) in place, untouched", () => {
    expect(CRON).toContain("PHASE 1c");
    expect(CRON).toContain("loadQuerySpikeRows");
    expect(CRON).toContain("computeQuerySpikes");
    expect(CRON).toContain("writeQuerySpikeSummary");
  });

  it("leaves the item-10 invariants step in place (do not disturb)", () => {
    expect(CRON).toContain("checkPipelineInvariants");
    expect(CRON).toContain("writePipelineHealth");
  });

  it("PHASE 1d comes after PHASE 1c in source order", () => {
    expect(CRON.indexOf("PHASE 1c")).toBeLessThan(CRON.indexOf("PHASE 1d"));
  });
});

describe("daily plan hint feed (build-today-preview)", () => {
  it("wires the seasonal hint feed additively beside the spike hint feed", () => {
    expect(PREVIEW).toContain("loadSeasonalQueries(tenantId, now).catch(() => [])");
    expect(PREVIEW).toContain("buildSeasonalHintNotes(seasonalQueries");
    expect(PREVIEW).toContain('"Seasonal window ahead"');
    // Composes beside, does not replace, the item 14 spike wiring.
    expect(PREVIEW).toContain("buildSpikeHintNotes(querySpikes");
    expect(PREVIEW).toContain('"Search demand spike"');
  });

  it("contains no em or en dashes anywhere in the seasonal wiring block", () => {
    const wireStart = PREVIEW.indexOf("buildSeasonalHintNotes(seasonalQueries");
    const wireEnd = PREVIEW.indexOf("confidencePct: 75,", wireStart) + 40;
    expect(PREVIEW.slice(wireStart, wireEnd)).not.toMatch(/[–—]/);
  });
});
