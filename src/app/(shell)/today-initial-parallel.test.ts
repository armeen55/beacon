import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(__dirname, "page.tsx"), "utf8");

describe("Today post-snapshot context latency boundary", () => {
  const start = source.indexOf("const [\n    connectedSourceCount,");
  const end = source.indexOf('perfStage("today-parallel-context"', start);
  const parallelBlock = source.slice(start, end);

  it("loads every independent command-context read in one Promise.all", () => {
    expect(start).toBeGreaterThan(-1);
    expect(parallelBlock).toContain("] = await Promise.all([");
    for (const call of [
      "countConnectedDataSources(",
      "readPipelineHealth(",
      "loadProofLedgerCached(",
      "loadLifecycleCounts(",
      "loadCalibrationRecords(",
      "loadLatestStrategyMix(",
      "loadDailyTotalsForTenant(",
      "loadGscDecaySignalsForTenant(",
      "loadDeadmanVerdict(",
      "loadErrorSpikeLine(",
      "readTodayLastSeen(",
    ]) {
      expect(parallelBlock.match(new RegExp(call.replace("(", "\\("), "g"))).toHaveLength(1);
    }
  });

  it("does not re-read any parallel context dependency later in renderCockpit", () => {
    const rest = source.slice(end, source.indexOf("return (", end));
    for (const call of [
      "countConnectedDataSources(",
      "readPipelineHealth(",
      "loadProofLedgerCached(",
      "loadLifecycleCounts(",
      "loadCalibrationRecords(",
      "loadLatestStrategyMix(",
      "loadDailyTotalsForTenant(",
      "loadGscDecaySignalsForTenant(",
      "loadDeadmanVerdict(",
      "loadErrorSpikeLine(",
      "readTodayLastSeen(",
    ]) {
      expect(rest).not.toContain(call);
    }
  });

  it("keeps every existing deadline/fallback wrapper in the parallel batch", () => {
    expect(parallelBlock.match(/valueWithDeadline\(/g)?.length).toBeGreaterThanOrEqual(9);
    expect(parallelBlock).toContain("TODAY_HERO_DEADLINE_MS");
    expect(parallelBlock).toContain("DEADMAN_DEADLINE_MS");
  });
});
