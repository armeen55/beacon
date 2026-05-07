/**
 * Architecture invariant — Trust Sprint T6.5 (2026-05-06).
 *
 * Pins that the T4.4 derived-confidence pipeline is reachable from
 * scripts that read `.data/tenants/<slug>/recommended-edits.json`
 * directly. Pre-T6.5 the brain-health + rec-outcome-analysis scripts
 * read only the persisted `confidence` column, which T4.4 intentionally
 * leaves at its legacy value (typically all "medium"), and falsely
 * reported the queue as 100% medium.
 *
 * What this test pins:
 *  1. `deriveConfidence` is exported from `derived-confidence.ts`.
 *  2. `computeEvidenceDepth` is exported from `recommendation-action-rows.ts`.
 *  3. Both T6.1 (`build-brain-health-report.ts`) and T6.3
 *     (`analyze-recommendation-outcomes.ts`) import + call them.
 *  4. Both scripts surface BOTH persisted AND derived distributions
 *     in their output (so a future drift away from one or the other
 *     fails the build).
 *
 * Behavioral test of `deriveConfidence` itself lives in
 * `src/domains/recommendations/derived-confidence.test.ts` — this
 * invariant only pins the cross-file wiring.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");

const BRAIN_HEALTH = readFileSync(
  join(REPO_ROOT, "scripts/build-brain-health-report.ts"),
  "utf-8",
);
const REC_OUTCOME = readFileSync(
  join(REPO_ROOT, "scripts/analyze-recommendation-outcomes.ts"),
  "utf-8",
);
const DERIVED_HELPER = readFileSync(
  join(REPO_ROOT, "src/domains/recommendations/derived-confidence.ts"),
  "utf-8",
);
const ROW_BUILDER = readFileSync(
  join(REPO_ROOT, "src/domains/recommendations/recommendation-action-rows.ts"),
  "utf-8",
);

describe("T6.5 — derived confidence pipeline reachable from scripts", () => {
  it("deriveConfidence is exported from derived-confidence.ts", () => {
    expect(/export function deriveConfidence\(/.test(DERIVED_HELPER)).toBe(true);
  });

  it("computeEvidenceDepth is exported from recommendation-action-rows.ts", () => {
    expect(/export function computeEvidenceDepth\(/.test(ROW_BUILDER)).toBe(true);
  });

  it("brain-health-report imports deriveConfidence", () => {
    expect(
      /from\s+"\.\.\/src\/domains\/recommendations\/derived-confidence"/.test(BRAIN_HEALTH),
      "scripts/build-brain-health-report.ts must import from derived-confidence — pre-T6.5 it read only persisted confidence and falsely reported all-medium.",
    ).toBe(true);
    expect(/deriveConfidence\(/.test(BRAIN_HEALTH)).toBe(true);
  });

  it("rec-outcome-analysis imports deriveConfidence", () => {
    expect(
      /from\s+"\.\.\/src\/domains\/recommendations\/derived-confidence"/.test(REC_OUTCOME),
      "scripts/analyze-recommendation-outcomes.ts must import from derived-confidence — pre-T6.5 it read only persisted confidence and falsely reported all-medium.",
    ).toBe(true);
    expect(/deriveConfidence\(/.test(REC_OUTCOME)).toBe(true);
  });

  it("brain-health-report surfaces BOTH persisted and derived distributions", () => {
    expect(/derived confidence \(T4\.4\) distribution/.test(BRAIN_HEALTH)).toBe(true);
    expect(/persisted confidence column \(legacy\)/.test(BRAIN_HEALTH)).toBe(true);
  });

  it("rec-outcome-analysis surfaces BOTH persisted and derived distributions", () => {
    expect(/Persisted \(legacy column/.test(REC_OUTCOME)).toBe(true);
    expect(/Derived \(T4\.4 customer-facing label/.test(REC_OUTCOME)).toBe(true);
  });

  it("scripts call deriveConfidence with isFaqAnswer flag (T4.4 thin-FAQ rule)", () => {
    expect(/isFaqAnswer/.test(BRAIN_HEALTH)).toBe(true);
    expect(/isFaqAnswer/.test(REC_OUTCOME)).toBe(true);
  });

  it("brain-health-report does NOT mutate persisted confidence", () => {
    // Negative invariant: the script must NOT write back to recommended-edits.
    expect(/persistRecommendedEditsLocal/.test(BRAIN_HEALTH)).toBe(false);
    expect(/syncRecommendedEdits/.test(BRAIN_HEALTH)).toBe(false);
    expect(/writeStore\(["']recommended-edits["']/.test(BRAIN_HEALTH)).toBe(false);
  });

  it("rec-outcome-analysis does NOT mutate persisted confidence", () => {
    expect(/persistRecommendedEditsLocal/.test(REC_OUTCOME)).toBe(false);
    expect(/syncRecommendedEdits/.test(REC_OUTCOME)).toBe(false);
    expect(/writeStore\(["']recommended-edits["']/.test(REC_OUTCOME)).toBe(false);
  });
});
