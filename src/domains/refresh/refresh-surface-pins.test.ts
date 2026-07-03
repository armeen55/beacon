/**
 * Refresh surface + wiring pins (BEACON_500 item 56).
 *
 * Source-level pins (the seasonal-surface-pins sibling pattern): the Demand band shows ONE
 * fading-page row below the language-gap row, stays silent when nothing is fading, the quiet
 * line accounts for it, the nightly cron persists the refresh queue as ONE isolated PHASE 1i
 * step without disturbing PHASE 1c/1d/1e/1h, the daily plan builder reads the queue additively
 * as a BOUNDED candidate source (max 2/night), the refresh lever flows through the plan record
 * + verify-live like every other lever, and the store is registered + mirrored. Also the
 * no-dash hard rule over the touched surfaces.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const WAR_ROOM = readFileSync(resolve(__dirname, "../../app/(shell)/war-room-sections.tsx"), "utf8");
const CRON = readFileSync(resolve(__dirname, "../../lib/connectors/cron-sync.ts"), "utf8");
const PREVIEW = readFileSync(resolve(__dirname, "../experiments/build-today-preview.ts"), "utf8");
const CANDIDATES = readFileSync(resolve(__dirname, "../experiments/build-daily-candidates.ts"), "utf8");
const PLAN_TYPES = readFileSync(resolve(__dirname, "../experiments/daily-plan-types.ts"), "utf8");
const EXEC_STATE = readFileSync(resolve(__dirname, "../experiments/execution-state.ts"), "utf8");
const VERIFY = readFileSync(resolve(__dirname, "../experiments/live-verification.ts"), "utf8");
const CLASSIFICATION = readFileSync(resolve(__dirname, "../../lib/persistence/store-classification.ts"), "utf8");
const JSON_STORE = readFileSync(resolve(__dirname, "../../lib/persistence/json-store.ts"), "utf8");
const REFRESH_DOMAIN = ["decay-queue.ts", "refresh-brief.ts", "refresh-brief-loader.ts", "refresh-candidates.ts", "refresh-store.ts", "load-quarterly-decay.ts"]
  .map((f) => readFileSync(resolve(__dirname, f), "utf8"))
  .join("\n");

describe("Demand band fading row (war-room-sections)", () => {
  it("reads last night's refresh queue at $0 and shows exactly one row", () => {
    expect(WAR_ROOM).toContain('from "@/domains/refresh/refresh-store"');
    expect(WAR_ROOM).toContain("loadTopFadingRow");
    expect(WAR_ROOM).toContain("queue[0] ?? null");
  });

  it("groups the fading row with the demand-movement rows, ahead of the language-gap block (UX4 order)", () => {
    // UX4 (2026-07-02) grouped the time-sensitive movement rows (spikes, seasonal, fading)
    // into one list and moved the language-gap block after them.
    const seasonalIdx = WAR_ROOM.indexOf("seasonalRow ?");
    const fadeIdx = WAR_ROOM.indexOf("fadingRow ?");
    const langIdx = WAR_ROOM.indexOf("languageGapRow ?");
    expect(seasonalIdx).toBeGreaterThan(-1);
    expect(fadeIdx).toBeGreaterThan(seasonalIdx);
    expect(langIdx).toBeGreaterThan(fadeIdx);
  });

  it("stays silent when research never ran and nothing is spiking, seasonal, language-gapped, OR fading", () => {
    expect(WAR_ROOM).toContain(
      "res.keywordsConsidered === 0 && spikeRows.length === 0 && !seasonalRow && !languageGapRow && !fadingRow) return null",
    );
  });

  it("the quiet line only claims a clean day when the fading row is also quiet", () => {
    expect(WAR_ROOM).toContain("!fadingRow");
    expect(WAR_ROOM).toContain("nothing is fading");
  });

  it("deep-links to tonight's picks (the daily plan carries the actual refresh)", () => {
    expect(WAR_ROOM).toContain('href="#daily-experiments"');
  });

  it("does not disturb the sibling rows (spikes, seasonal, language gap)", () => {
    expect(WAR_ROOM).toContain("matchSpikeToMove");
    expect(WAR_ROOM).toContain("loadTopSeasonalRow");
    expect(WAR_ROOM).toContain("loadTopLanguageGapRow");
  });
});

describe("nightly persistence (cron-sync PHASE 1i)", () => {
  it("runs the quarterly rank + brief build + queue write as ONE isolated step", () => {
    expect(CRON).toContain("PHASE 1i");
    expect(CRON).toContain("loadQuarterlyDecayForTenant");
    expect(CRON).toContain("rankRefreshCandidates");
    expect(CRON).toContain("loadRefreshBriefsForTenant");
    expect(CRON).toContain("writeRefreshQueueSummary");
    expect(CRON).toContain("refresh queue pass failed");
  });

  it("leaves the sibling PHASE 1c/1d/1e steps in place, untouched", () => {
    expect(CRON).toContain("PHASE 1c");
    expect(CRON).toContain("PHASE 1d");
    expect(CRON).toContain("PHASE 1e");
    expect(CRON).toContain("writeQuerySpikeSummary");
    expect(CRON).toContain("writeSeasonalSummary");
    expect(CRON).toContain("writeLanguageGapSummary");
  });

  it("PHASE 1i comes after PHASE 1h in source order", () => {
    expect(CRON.indexOf("PHASE 1h")).toBeLessThan(CRON.indexOf("PHASE 1i"));
  });
});

describe("daily plan candidate source (build-daily-candidates + build-today-preview)", () => {
  it("wires the refresh queue additively into buildDailyCandidates", () => {
    expect(PREVIEW).toContain('from "@/domains/refresh/refresh-store"');
    expect(PREVIEW).toContain("loadRefreshQueue(tenantId, now).catch(() => [])");
    expect(PREVIEW).toContain("refreshQueue, peakCalendar });");
  });

  it("build-daily-candidates consumes the queue through the bounded pure source", () => {
    expect(CANDIDATES).toContain('from "@/domains/refresh/refresh-candidates"');
    expect(CANDIDATES).toContain("findRefreshCandidates");
    expect(CANDIDATES).toContain("refreshQueue?: RefreshBrief[]");
    // Additive: no queue input means byte-identical batches.
    expect(CANDIDATES).toContain("input.refreshQueue ?? []");
  });

  it("the refresh action family derives from refresh_content (the item-56 naming)", () => {
    expect(CANDIDATES).toContain('actionFamilyOf("refresh_content")');
  });

  it("the bound is 2 per night, decayed-winners-first", () => {
    const src = readFileSync(resolve(__dirname, "refresh-candidates.ts"), "utf8");
    expect(src).toContain("export const MAX_REFRESH_CANDIDATES_PER_NIGHT = 2");
  });
});

describe("refresh lever plumbing (accept / apply / verify-live)", () => {
  it("the plan record types carry the refresh lever + its evidence detail", () => {
    expect(PLAN_TYPES).toContain('"refresh"');
    expect(PLAN_TYPES).toContain('kind: "refresh_section"');
    expect(PLAN_TYPES).toContain("briefSentences: string[]");
  });

  it("the refresh lever ships as the registry's add_h2_section proof action type", () => {
    expect(EXEC_STATE).toContain('refresh: "add_h2_section"');
  });

  it("verify-live checks the new section heading among the page's visible h2/h3", () => {
    expect(VERIFY).toContain("verifyRefreshSection");
    expect(VERIFY).toContain('exp.lever === "refresh"');
    expect(VERIFY).toContain('scope.find("h2, h3")');
  });
});

describe("store registration", () => {
  it("refresh-queue is a registered GLOBAL store", () => {
    expect(CLASSIFICATION).toContain('"refresh-queue"');
  });

  it("refresh-queue is Supabase-mirrored (survives Vercel's read-only filesystem)", () => {
    expect(JSON_STORE).toContain('"refresh-queue"');
  });
});

describe("no em or en dashes anywhere (hard rule)", () => {
  it("the refresh domain contains no em or en dashes", () => {
    expect(REFRESH_DOMAIN).not.toMatch(/[–—]/);
  });

  it("the item-56 wiring block in build-daily-candidates contains no em or en dashes", () => {
    const start = CANDIDATES.indexOf("Item 56 - REFRESH PRODUCTION LINE");
    expect(start).toBeGreaterThan(-1);
    const end = CANDIDATES.indexOf("return out;", start);
    expect(CANDIDATES.slice(start, end)).not.toMatch(/[–—]/);
  });

  it("the fading row block in war-room-sections contains no em or en dashes", () => {
    const start = WAR_ROOM.indexOf("item 56 - the single worst FADING page");
    expect(start).toBeGreaterThan(-1);
    const end = WAR_ROOM.indexOf("res.opportunities.slice", start);
    expect(WAR_ROOM.slice(start, end)).not.toMatch(/[–—]/);
  });

  it("the PHASE 1i cron block contains no em or en dashes", () => {
    const start = CRON.indexOf("PHASE 1i");
    expect(start).toBeGreaterThan(-1);
    const end = CRON.indexOf("PHASE 2a", start);
    expect(CRON.slice(start, end)).not.toMatch(/[–—]/);
  });
});
