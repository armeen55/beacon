/**
 * Architecture invariant — Trust Sprint T7.5 (2026-05-07).
 *
 * Pins the recommendation learning score v0 contract:
 *
 *   - Sample-size floors: <5 = "insufficient_sample"; <15 = "directional";
 *     ≥15 = "credible".
 *   - Score uses the CAUSAL chain (T7.1's source_rec_id), NOT URL-level
 *     coincidence.
 *   - Score does NOT mutate rec rows.
 *   - Brain MUST NOT change ranking based on `insufficient_sample` rows.
 *
 * Behavioral test of the rendered output is the script's own JSON
 * snapshot in `.data/_reports/`. This invariant pins the source-text
 * shape so a regression (e.g., someone lowering the floor, or
 * re-using URL coincidence as causal) fails the build.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");
const ANALYZER_PATH = join(REPO_ROOT, "scripts/analyze-recommendation-outcomes.ts");
const SRC = readFileSync(ANALYZER_PATH, "utf-8");

describe("T7.5 — recommendation learning score v0 (causal-aware)", () => {
  it("declares buildLearningScoreV0 function", () => {
    expect(/function buildLearningScoreV0\(/.test(SRC)).toBe(true);
  });

  it("LEARNING_SCORE_DIRECTIONAL_FLOOR pinned at 5", () => {
    expect(/const LEARNING_SCORE_DIRECTIONAL_FLOOR\s*=\s*5/.test(SRC)).toBe(true);
  });

  it("LEARNING_SCORE_CREDIBLE_FLOOR pinned at 15", () => {
    expect(/const LEARNING_SCORE_CREDIBLE_FLOOR\s*=\s*15/.test(SRC)).toBe(true);
  });

  it("confidence_label union has exactly the 3 expected values", () => {
    expect(SRC).toContain('"insufficient_sample"');
    expect(SRC).toContain('"directional"');
    expect(SRC).toContain('"credible"');
  });

  it("learning score builds from changelog rows (causal), not target_url", () => {
    const fn = SRC.match(/function buildLearningScoreV0\([\s\S]*?\n\}/)?.[0] ?? "";
    expect(fn).toContain("source_rec_id");
    expect(fn).toContain("change_id");
    // Must NOT use target_url for the causal counting — that's URL-level coincidence (T7.1 Section 6.A).
    expect(/r\.target_url/.test(fn)).toBe(false);
  });

  it("learning score note explicitly states ranking must NOT change on insufficient_sample", () => {
    expect(SRC).toContain("MUST NOT change ranking");
  });

  it("learning score note explicitly states URL-level coincidence is NOT causal", () => {
    expect(SRC).toContain("URL-level coincidence is NOT counted as causal");
  });

  it("score does NOT mutate persisted rows (no persist/sync/writeStore)", () => {
    expect(/persistRecommendedEditsLocal/.test(SRC)).toBe(false);
    expect(/syncRecommendedEdits/.test(SRC)).toBe(false);
    expect(/syncUrlChangeOutcomes/.test(SRC)).toBe(false);
    expect(/writeStore\(["']recommended-edits["']/.test(SRC)).toBe(false);
  });

  it("main() includes learning_score_v0 in the report object", () => {
    const main = SRC.match(/async function main\([\s\S]*?\n\}/)?.[0] ?? "";
    expect(/learning_score_v0:\s*buildLearningScoreV0\(/.test(main)).toBe(true);
  });

  it("renders Section 7 in the markdown output", () => {
    expect(SRC).toContain("## 7. Recommendation learning score v0 (CAUSAL, per action_type)");
  });

  it("learning score row includes all required fields", () => {
    const required = [
      "action_type",
      "shipped_causal_count",
      "causal_outcome_count",
      "causal_helping",
      "causal_weak_signal",
      "causal_nothing_yet",
      "needs_review_rate",
      "avg_evidence_depth",
      "sample_size",
      "confidence_label",
    ];
    for (const field of required) {
      expect(SRC).toContain(field);
    }
  });
});
