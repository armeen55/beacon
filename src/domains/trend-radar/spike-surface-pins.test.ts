/**
 * Trend-radar surface + wiring pins (2026-07-02, master plan item 14).
 *
 * Source-level pins (the sibling pattern for server sections): the Demand band
 * shows up to 2 spike rows with the same-week copy and the worklist deep link,
 * stays silent when nothing spikes, the quiet line accounts for spikes, the
 * nightly cron persists the pass, and the daily plan builder reads the hint
 * feed. Also the no-dash hard rule over the touched surfaces' new copy.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const WAR_ROOM = readFileSync(resolve(__dirname, "../../app/(shell)/war-room-sections.tsx"), "utf8");
const CRON = readFileSync(resolve(__dirname, "../../lib/connectors/cron-sync.ts"), "utf8");
const PREVIEW = readFileSync(resolve(__dirname, "../experiments/build-today-preview.ts"), "utf8");

describe("Demand band spike rows (war-room-sections)", () => {
  it("reads last night's spikes at $0 and caps the band at 2 rows", () => {
    expect(WAR_ROOM).toContain('from "@/domains/trend-radar/spike-store"');
    expect(WAR_ROOM).toContain(".slice(0, 2)");
  });

  it("deep-links a spike to its matching worklist change when one exists", () => {
    expect(WAR_ROOM).toContain("matchSpikeToMove");
    expect(WAR_ROOM).toContain("/changes?search=${encodeURIComponent(searchTerm)}");
    expect(WAR_ROOM).toContain("See the matching change");
  });

  it("speaks the same-week copy and names the best matching page", () => {
    expect(WAR_ROOM).toContain("Worth a same-week answer.");
    expect(WAR_ROOM).toContain("Your best matching page:");
  });

  it("stays silent when research never ran AND nothing is spiking", () => {
    // Master plan item 21 additively extended this guard with a seasonal check,
    // item 24 with a language-gap check, item 56 with a fading-page check, and
    // R17a (v1 267) with a striking-portfolio check (each composes beside the
    // prior gate, none removes an earlier one).
    expect(WAR_ROOM).toContain("res.keywordsConsidered === 0 && spikeRows.length === 0 && !seasonalRow && !languageGapRow && !fadingRow && !strikingPortfolio) return null");
  });

  it("the quiet line only claims a clean day when spikes are also quiet", () => {
    expect(WAR_ROOM).toContain("spikes.length === 0");
  });

  it("contains no em or en dashes anywhere", () => {
    expect(WAR_ROOM).not.toMatch(/[–—]/);
  });
});

describe("nightly persistence (cron-sync)", () => {
  it("runs the radar as ONE isolated step and persists via the spike store", () => {
    expect(CRON).toContain("loadQuerySpikeRows");
    expect(CRON).toContain("computeQuerySpikes");
    expect(CRON).toContain("writeQuerySpikeSummary");
    expect(CRON).toContain("trend radar failed");
  });

  it("leaves the item-10 invariants step in place (do not disturb)", () => {
    expect(CRON).toContain("checkPipelineInvariants");
    expect(CRON).toContain("writePipelineHealth");
  });
});

describe("daily plan hint feed (build-today-preview)", () => {
  it("wires the spike hint feed additively at the engineGaps call site", () => {
    expect(PREVIEW).toContain("loadQuerySpikes(tenantId, now).catch(() => [])");
    expect(PREVIEW).toContain("buildSpikeHintNotes(querySpikes");
    expect(PREVIEW).toContain('"Search demand spike"');
  });

  it("only hints when the page verifiably lacks an answer (proposeAnswerGap test)", () => {
    const wire = PREVIEW.slice(PREVIEW.indexOf("buildSpikeHintNotes(querySpikes"));
    expect(wire.slice(0, 400)).toContain("proposeAnswerGap");
  });
});
