/**
 * Language-gap surface + wiring pins (2026-07-02, master plan item 24).
 *
 * Source-level pins (the trend-radar/seasonal sibling pattern): the Demand
 * band shows ONE language-gap row below the seasonal row, stays silent when
 * nothing is found, the quiet line accounts for it, the nightly cron persists
 * the pass as its own isolated PHASE step, and the daily plan builder reads
 * the hint feed additively beside the spike/seasonal hints. Also the no-dash
 * hard rule over the touched surfaces' new copy.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const WAR_ROOM = readFileSync(resolve(__dirname, "../../app/(shell)/war-room-sections.tsx"), "utf8");
const CRON = readFileSync(resolve(__dirname, "../../lib/connectors/cron-sync.ts"), "utf8");
const PREVIEW = readFileSync(resolve(__dirname, "../experiments/build-today-preview.ts"), "utf8");
const STORE_CLASSIFICATION = readFileSync(resolve(__dirname, "../../lib/persistence/store-classification.ts"), "utf8");
const JSON_STORE = readFileSync(resolve(__dirname, "../../lib/persistence/json-store.ts"), "utf8");

describe("Demand band language-gap row (war-room-sections)", () => {
  it("reads last night's language-gap pass at $0 and shows exactly one row", () => {
    expect(WAR_ROOM).toContain('from "@/domains/language-gap/language-gap-store"');
    expect(WAR_ROOM).toContain("loadTopLanguageGapRow");
    expect(WAR_ROOM).toContain("gaps[0] ?? null");
  });

  it("places the language-gap row below the seasonal row in the Demand band", () => {
    const seasonalIdx = WAR_ROOM.indexOf("seasonalRow ?");
    const languageIdx = WAR_ROOM.indexOf("languageGapRow ?");
    expect(seasonalIdx).toBeGreaterThan(-1);
    expect(languageIdx).toBeGreaterThan(seasonalIdx);
  });

  it("stays silent when research never ran, nothing is spiking, seasonal, or a language gap", () => {
    // Master plan item 56 additively extended this guard with a fading-page check
    // (composes beside the language-gap gate, does not remove it).
    expect(WAR_ROOM).toContain("!seasonalRow && !languageGapRow && !fadingRow) return null");
  });

  it("the quiet line only claims a clean day when the language-gap row is also quiet", () => {
    expect(WAR_ROOM).toContain("!languageGapRow");
    expect(WAR_ROOM).toContain("no language gap was found");
  });

  it("does not disturb the spike/seasonal rows' own silence/copy guards", () => {
    expect(WAR_ROOM).toContain("Worth a same-week answer.");
    expect(WAR_ROOM).toContain("matchSpikeToMove");
    expect(WAR_ROOM).toContain("loadTopSeasonalRow");
  });

  it("contains no em or en dashes anywhere", () => {
    expect(WAR_ROOM).not.toMatch(/[–—]/);
  });
});

describe("nightly persistence (cron-sync)", () => {
  it("runs the language-gap pass as ONE isolated step and persists via the store", () => {
    expect(CRON).toContain("runLanguageGapPass");
    expect(CRON).toContain("writeLanguageGapSummary");
    expect(CRON).toContain("language gap pass failed");
  });

  it("leaves the seasonal PHASE 1d step in place (do not disturb)", () => {
    expect(CRON).toContain("PHASE 1d");
    expect(CRON).toContain("runMonthlyArchiveRollup");
    expect(CRON).toContain("writeSeasonalSummary");
  });

  it("leaves PHASE 1c (trend radar) in place, untouched", () => {
    expect(CRON).toContain("PHASE 1c");
    expect(CRON).toContain("writeQuerySpikeSummary");
  });
});

describe("daily plan hint feed (build-today-preview)", () => {
  it("wires the language-gap hint feed additively beside the spike/seasonal hints", () => {
    expect(PREVIEW).toContain("loadLanguageGaps(tenantId, now).catch(() => [])");
    expect(PREVIEW).toContain("buildLanguageGapHintNotes(languageGaps");
    expect(PREVIEW).toContain('"Language gap"');
    // Composes beside, does not replace, the item 14/21 wiring.
    expect(PREVIEW).toContain("buildSpikeHintNotes(querySpikes");
    expect(PREVIEW).toContain("buildSeasonalHintNotes(seasonalQueries");
  });

  it("contains no em or en dashes anywhere in the language-gap wiring block", () => {
    const wireStart = PREVIEW.indexOf("buildLanguageGapHintNotes(languageGaps");
    const wireEnd = PREVIEW.indexOf("confidencePct: 75,", wireStart) + 40;
    expect(PREVIEW.slice(wireStart, wireEnd)).not.toMatch(/[–—]/);
  });
});

describe("store registration (json-store persistence layer)", () => {
  it("registers language-gap-matrix as a GLOBAL store", () => {
    expect(STORE_CLASSIFICATION).toContain('"language-gap-matrix"');
  });

  it("mirrors language-gap-matrix to Supabase (survives Vercel's read-only filesystem)", () => {
    expect(JSON_STORE).toContain('"language-gap-matrix"');
  });
});
