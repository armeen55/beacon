import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { splitFewShotLine, FEW_SHOT_PREFIX } from "./daily-experiments-section";

const SRC = readFileSync(resolve(__dirname, "daily-experiments-section.tsx"), "utf8");

/**
 * BEACON_500 item 74 - the draft-provenance line on the daily card. This component owns
 * ONE pure function: splitting an llmRationale that may carry the structured drafter's
 * exact controlled few-shot sentence (prepended in src/domains/llm/structured-drafter.ts)
 * away from the model's own one-line rationale, so WrittenByBeacon can render them as two
 * visually distinct lines instead of one run-on sentence.
 */
describe("splitFewShotLine - BEACON_500 item 74", () => {
  it("returns no fewShotLine for a plain rationale with no prefix", () => {
    const r = splitFewShotLine("matches the searcher's intent");
    expect(r.fewShotLine).toBeNull();
    expect(r.rest).toBe("matches the searcher's intent");
  });

  it("returns no fewShotLine for undefined (no rationale at all)", () => {
    const r = splitFewShotLine(undefined);
    expect(r.fewShotLine).toBeNull();
    expect(r.rest).toBeUndefined();
  });

  it("splits the few-shot sentence from the model's own trailing rationale", () => {
    const combined = `${FEW_SHOT_PREFIX} stat-first, like the block that won on https://iranopedia.com/singers. matches the searcher's intent`;
    const r = splitFewShotLine(combined);
    expect(r.fewShotLine).toBe(`${FEW_SHOT_PREFIX} stat-first, like the block that won on https://iranopedia.com/singers.`);
    expect(r.rest).toBe("matches the searcher's intent");
  });

  it("handles the few-shot sentence with nothing trailing (still splits cleanly)", () => {
    const combined = `${FEW_SHOT_PREFIX} stat-first, the structure that has won most often on singers pages here.`;
    const r = splitFewShotLine(combined);
    expect(r.fewShotLine).toBe(combined);
    expect(r.rest).toBeUndefined();
  });

  it("the few-shot line never contains an em or en dash", () => {
    const combined = `${FEW_SHOT_PREFIX} stat-first, like the block that won on https://iranopedia.com/singers. matches intent`;
    const r = splitFewShotLine(combined);
    expect(r.fewShotLine).not.toMatch(/[–—]/);
  });

  it("never throws on an empty string", () => {
    expect(() => splitFewShotLine("")).not.toThrow();
    expect(splitFewShotLine("").fewShotLine).toBeNull();
  });
});

describe("DailyExperimentsSection - no-scheduler honesty (Beacon has no cron)", () => {
  it("never claims scheduled/overnight timing", () => {
    expect(SRC).not.toMatch(/tonight|last night|overnight|nightly/i);
  });
});
