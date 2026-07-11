import { describe, it, expect } from "vitest";
import { deriveDefectSignal } from "./defect-signal";
import type { PipelineViolation } from "./pipeline-invariants";
import type { DeadmanVerdict } from "./deadman";

/**
 * defect-signal (P2-a, 2026-07-10 visual audit) - pins that deriveDefectSignal's redFires
 * byte-matches OpsPipelineSection's own red condition (pipelineFires OR deadmanFires OR
 * spikeFires), and that its sentences feed buildTodayCommand's pipelineAlarms so the Today
 * command can never miss a signal the banner is already showing red for.
 */

function violation(overrides: Partial<PipelineViolation> = {}): PipelineViolation {
  return {
    stage: "gsc_sync",
    expected: "rows > 0",
    actual: "0 rows",
    sentence: "Search Console wrote 0 rows last night.",
    ...overrides,
  };
}

function deadman(overrides: Partial<DeadmanVerdict> = {}): DeadmanVerdict {
  return {
    overall: "healthy",
    jobs: [],
    siteDown: false,
    siteSentence: null,
    alarm: false,
    sentences: [],
    ...overrides,
  };
}

describe("deriveDefectSignal - redFires matches the ops banner exactly", () => {
  it("is quiet when nothing fires", () => {
    const out = deriveDefectSignal({ violations: [], deadman: null, errorSpikeLine: null });
    expect(out.redFires).toBe(false);
    expect(out.sentences).toEqual([]);
  });

  it("fires on a pipeline violation alone", () => {
    const out = deriveDefectSignal({ violations: [violation()], deadman: null, errorSpikeLine: null });
    expect(out.redFires).toBe(true);
    expect(out.sentences).toEqual(["Search Console wrote 0 rows last night."]);
  });

  it("never counts a warn (staleness) or info violation as a defect", () => {
    const out = deriveDefectSignal({
      violations: [violation({ severity: "warn" }), violation({ severity: "info" })],
      deadman: null,
      errorSpikeLine: null,
    });
    expect(out.redFires).toBe(false);
    expect(out.alarmViolations).toEqual([]);
    expect(out.warnViolations.length).toBe(1);
  });

  // P2-a's exact fix: previously only pipeline violations reached the command; a stalled
  // overnight job (deadman) or a run of failures (error spike) could paint the banner red
  // while the command stayed silent about it.
  it("fires on a deadman alarm alone, with no pipeline violation", () => {
    const out = deriveDefectSignal({
      violations: [],
      deadman: deadman({ alarm: true, sentences: ["My overnight sync for Search Console did not run last night."] }),
      errorSpikeLine: null,
    });
    expect(out.redFires).toBe(true);
    expect(out.sentences).toEqual(["My overnight sync for Search Console did not run last night."]);
  });

  it("fires on an error spike alone, with no pipeline violation or deadman alarm", () => {
    const out = deriveDefectSignal({
      violations: [],
      deadman: null,
      errorSpikeLine: "Something failed 14 times since yesterday. Details are on the Diagnostics page.",
    });
    expect(out.redFires).toBe(true);
    expect(out.sentences).toEqual(["Something failed 14 times since yesterday. Details are on the Diagnostics page."]);
  });

  it("a deadman verdict with alarm=false (or no sentences) never counts as a defect, even if present", () => {
    const out = deriveDefectSignal({
      violations: [],
      deadman: deadman({ alarm: false, sentences: [] }),
      errorSpikeLine: null,
    });
    expect(out.redFires).toBe(false);
  });

  it("combines all three signals in priority order: pipeline, then deadman, then error spike", () => {
    const out = deriveDefectSignal({
      violations: [violation()],
      deadman: deadman({ alarm: true, sentences: ["The nightly GA4 sync is stalled."] }),
      errorSpikeLine: "Something failed 20 times since yesterday. Details are on the Diagnostics page.",
    });
    expect(out.redFires).toBe(true);
    expect(out.sentences).toEqual([
      "Search Console wrote 0 rows last night.",
      "The nightly GA4 sync is stalled.",
      "Something failed 20 times since yesterday. Details are on the Diagnostics page.",
    ]);
  });
});
