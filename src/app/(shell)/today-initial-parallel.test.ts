import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(__dirname, "page.tsx"), "utf8");

describe("Today post-snapshot context latency boundary", () => {
  const start = source.indexOf("const [\n    connectedSourceCount,");
  const end = source.indexOf('perfStage("today-parallel-context"', start);
  const parallelBlock = source.slice(start, end);

  // Phase 4D (2026-07-21): the drawer/band context reads (calibration, strategy mix,
  // last-seen) died with their surfaces; the eight survivors each feed the one command,
  // the scoreboard, or the proof strip.
  const CONTEXT_READS = [
    "countConnectedDataSources(",
    "readPipelineHealth(",
    "loadProofLedgerCached(",
    "loadLifecycleCounts(",
    "loadDailyTotalsForTenant(",
    "loadGscDecaySignalsForTenant(",
    "loadDeadmanVerdict(",
    "loadErrorSpikeLine(",
  ];

  it("loads every independent command-context read in one Promise.all", () => {
    expect(start).toBeGreaterThan(-1);
    expect(parallelBlock).toContain("] = await Promise.all([");
    for (const call of CONTEXT_READS) {
      expect(parallelBlock.match(new RegExp(call.replace("(", "\\("), "g"))).toHaveLength(1);
    }
  });

  it("does not re-read any parallel context dependency later in renderCockpit", () => {
    const rest = source.slice(end, source.indexOf("return (", end));
    for (const call of CONTEXT_READS) {
      expect(rest).not.toContain(call);
    }
  });

  it("keeps every existing deadline/fallback wrapper in the parallel batch", () => {
    expect(parallelBlock.match(/valueWithDeadline\(/g)?.length).toBeGreaterThanOrEqual(8);
    expect(parallelBlock).toContain("TODAY_HERO_DEADLINE_MS");
    expect(parallelBlock).toContain("DEADMAN_DEADLINE_MS");
  });
});
