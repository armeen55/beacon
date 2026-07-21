/**
 * CONSTITUTION §8 — Compound-action attribution.
 *
 * Consolidated from causal-analyzer-source-rec-id + learning-score-v0-causal.
 * No individual credit for compound outcomes: the analyzer's causal chain
 * joins on changelog.source_rec_id (the specific rec that shipped), NEVER
 * URL-level coincidence, and the learning score refuses to move ranking on
 * insufficient samples. Read-only: the analyzer never mutates persisted rows.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const SRC = readFileSync(
  join(resolve(__dirname, "../.."), "scripts/analyze-recommendation-outcomes.ts"),
  "utf-8",
);

describe("causal chain joins on source_rec_id, never URL coincidence", () => {
  it("declares analyzeCausalRecChain with the sample-size floor at 5", () => {
    expect(/function analyzeCausalRecChain\(/.test(SRC)).toBe(true);
    expect(/const CAUSAL_SAMPLE_SIZE_FLOOR\s*=\s*5/.test(SRC)).toBe(true);
    expect(/import\s*\{\s*getChangelogEntries\s*\}/.test(SRC)).toBe(true);
  });
  it("causal join uses source_rec_id + change_id, not target_url", () => {
    const fn = SRC.match(/function analyzeCausalRecChain\([\s\S]*?\n\}/)?.[0];
    expect(fn).toBeTruthy();
    expect(fn!).toContain("source_rec_id");
    expect(fn!).toContain("change_id");
    expect(/c\.target_url/.test(fn!)).toBe(false);
  });
  it("relabels Section 6.A as URL-LEVEL CONTEXT (not causal) and 6.B as CAUSAL", () => {
    expect(/URL-LEVEL CONTEXT, NOT CAUSAL/.test(SRC)).toBe(true);
    expect(/CAUSAL via source_rec_id/.test(SRC)).toBe(true);
    expect(
      /Legacy CSV\/PDF imports \+ scanner-detection rows lack `source_rec_id`/.test(SRC),
    ).toBe(true);
  });
  it("emits a sample-size warning below the floor and wires the report", () => {
    expect(/INSUFFICIENT SAMPLE/.test(SRC)).toBe(true);
    const main = SRC.match(/async function main\([\s\S]*?\n\}/)?.[0] ?? "";
    expect(/causal_rec_chain:\s*analyzeCausalRecChain\(/.test(main)).toBe(true);
  });
});

describe("learning score v0 is causal-aware and read-only", () => {
  it("floors: directional=5, credible=15; the 3-value confidence union", () => {
    expect(/const LEARNING_SCORE_DIRECTIONAL_FLOOR\s*=\s*5/.test(SRC)).toBe(true);
    expect(/const LEARNING_SCORE_CREDIBLE_FLOOR\s*=\s*15/.test(SRC)).toBe(true);
    expect(SRC).toContain('"insufficient_sample"');
    expect(SRC).toContain('"directional"');
    expect(SRC).toContain('"credible"');
  });
  it("builds from changelog causal rows, not target_url coincidence", () => {
    const fn = SRC.match(/function buildLearningScoreV0\([\s\S]*?\n\}/)?.[0] ?? "";
    expect(fn).toContain("source_rec_id");
    expect(fn).toContain("change_id");
    expect(/r\.target_url/.test(fn)).toBe(false);
    expect(SRC).toContain("MUST NOT change ranking");
    expect(SRC).toContain("URL-level coincidence is NOT counted as causal");
  });
  it("never mutates persisted rows (read-only analyzer)", () => {
    for (const bad of [
      /persistRecommendedEditsLocal/,
      /syncRecommendedEdits/,
      /syncUrlChangeOutcomes/,
      /writeStore\(["']recommended-edits["']/,
    ])
      expect(bad.test(SRC)).toBe(false);
  });
});
