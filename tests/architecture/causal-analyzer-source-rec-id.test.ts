/**
 * Architecture invariant — Trust Sprint T7.1 (2026-05-07).
 *
 * Pins the rec → changelog → outcome causal chain in
 * `scripts/analyze-recommendation-outcomes.ts` against scope drift:
 *
 *   - Section 6.A keeps the legacy URL-level join, but RELABELED as
 *     "URL-LEVEL CONTEXT, NOT CAUSAL".
 *   - Section 6.B uses `changelog.source_rec_id` as the primary causal
 *     join key. Excludes legacy CSV/PDF/scanner rows (no rec to link).
 *   - Reports a sample-size warning when the causal-with-outcome count
 *     is below CAUSAL_SAMPLE_SIZE_FLOOR (5).
 *
 * Behavioral test of the analyzer's runtime output is the script's
 * own JSON snapshot in `.data/_reports/`. This invariant pins the
 * source-text shape so a future regression (e.g., someone deleting
 * the causal section, or relabeling the URL section as causal) fails
 * the build.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");
const ANALYZER_PATH = join(REPO_ROOT, "scripts/analyze-recommendation-outcomes.ts");
const SRC = readFileSync(ANALYZER_PATH, "utf-8");

describe("T7.1 — analyzer uses source_rec_id as primary causal join", () => {
  it("imports getChangelogEntries (causal join requires changelog rows)", () => {
    expect(/import\s*\{\s*getChangelogEntries\s*\}/.test(SRC)).toBe(true);
  });

  it("declares analyzeCausalRecChain function", () => {
    expect(/function analyzeCausalRecChain\(/.test(SRC)).toBe(true);
  });

  it("CAUSAL_SAMPLE_SIZE_FLOOR is set to 5", () => {
    expect(/const CAUSAL_SAMPLE_SIZE_FLOOR\s*=\s*5/.test(SRC)).toBe(true);
  });

  it("causal join uses source_rec_id, not target_url", () => {
    const causalFn = SRC.match(
      /function analyzeCausalRecChain\([\s\S]*?\n\}/,
    )?.[0];
    expect(causalFn).toBeTruthy();
    if (causalFn) {
      expect(causalFn).toContain("source_rec_id");
      expect(causalFn).toContain("change_id");
      // Must NOT use target_url for the causal path — that's Section 6.A.
      expect(/c\.target_url/.test(causalFn)).toBe(false);
    }
  });

  it("Section 6.A is relabeled URL-LEVEL CONTEXT, NOT CAUSAL", () => {
    expect(/URL-LEVEL CONTEXT, NOT CAUSAL/.test(SRC)).toBe(true);
  });

  it("Section 6.B is labeled CAUSAL via source_rec_id", () => {
    expect(/CAUSAL via source_rec_id/.test(SRC)).toBe(true);
  });

  it("emits a sample-size warning when N < 5", () => {
    expect(/INSUFFICIENT SAMPLE/.test(SRC)).toBe(true);
  });

  it("explicitly notes that legacy CSV/PDF + scanner rows are excluded from causal", () => {
    expect(
      /Legacy CSV\/PDF imports \+ scanner-detection rows lack `source_rec_id`/.test(
        SRC,
      ),
    ).toBe(true);
  });

  it("main() includes causal_rec_chain in the report object", () => {
    const main = SRC.match(/async function main\([\s\S]*?\n\}/)?.[0] ?? "";
    expect(/causal_rec_chain:\s*analyzeCausalRecChain\(/.test(main)).toBe(true);
  });

  it("does NOT mutate persisted rows (read-only invariant preserved)", () => {
    expect(/persistRecommendedEditsLocal/.test(SRC)).toBe(false);
    expect(/syncRecommendedEdits/.test(SRC)).toBe(false);
    expect(/syncUrlChangeOutcomes/.test(SRC)).toBe(false);
    expect(/writeStore\(["']recommended-edits["']/.test(SRC)).toBe(false);
  });
});
