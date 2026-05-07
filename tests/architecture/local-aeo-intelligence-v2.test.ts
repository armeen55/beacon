/**
 * Architecture invariant — Trust Sprint T7.4 (2026-05-07).
 *
 * Pins the local AEO intelligence v2 builders against scope drift:
 *
 *   - 7 new derivation files added on top of the v1 set (T6.2):
 *       city-strength-index.json
 *       service-strength-index.json
 *       competitor-weekly-trajectory.json (renamed/expanded from v1)
 *       citation-domain-authority.json
 *       page-citation-trajectory.json
 *       prompt-opportunity-index.json
 *       local-aeo-opportunity-map.json
 *
 *   - Each builder is a pure function (no I/O).
 *   - Each output record carries window/sample/trend/sample-flag fields.
 *   - SAMPLE_SIZE_FULL_THRESHOLD pinned at 80 (matches T6.1 brain-health).
 *   - Idempotency: SAME inputs produce SAME outputs (verified by the
 *     build script at run-time; pinned by source-text invariant).
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");
const BUILDER_PATH = join(REPO_ROOT, "scripts/build-local-aeo-intelligence.ts");
const SRC = readFileSync(BUILDER_PATH, "utf-8");

const V2_FILES = [
  "city-strength-index.json",
  "service-strength-index.json",
  "competitor-weekly-trajectory.json",
  "citation-domain-authority.json",
  "page-citation-trajectory.json",
  "prompt-opportunity-index.json",
  "local-aeo-opportunity-map.json",
];

describe("T7.4 — local AEO intelligence v2", () => {
  for (const file of V2_FILES) {
    it(`emits ${file}`, () => {
      expect(SRC.includes(`name: "${file}"`)).toBe(true);
    });
  }

  it("declares all 7 v2 builder functions", () => {
    expect(/function buildCityStrengthIndex\(/.test(SRC)).toBe(true);
    expect(/function buildServiceStrengthIndex\(/.test(SRC)).toBe(true);
    expect(/function buildCompetitorWeeklyV2\(/.test(SRC)).toBe(true);
    expect(/function buildCitationDomainAuthority\(/.test(SRC)).toBe(true);
    expect(/function buildPageCitationTrajectory\(/.test(SRC)).toBe(true);
    expect(/function buildPromptOpportunityIndex\(/.test(SRC)).toBe(true);
    expect(/function buildLocalAeoOpportunityMap\(/.test(SRC)).toBe(true);
  });

  it("SAMPLE_SIZE_FULL_THRESHOLD pinned at 80", () => {
    expect(/const SAMPLE_SIZE_FULL_THRESHOLD\s*=\s*80/.test(SRC)).toBe(true);
  });

  it("each v2 row shape includes a sample_full flag", () => {
    // Pin that the partial/full sample concept is propagated through
    // the v2 output contract.
    expect(SRC).toContain("sample_full: boolean");
  });

  it("each v2 row shape includes a trend_vs_prior_window field", () => {
    expect(SRC).toContain("trend_vs_prior_window");
  });

  it("competitor-weekly-v2 has rising/falling flags", () => {
    expect(SRC).toContain("rising: boolean");
    expect(SRC).toContain("falling: boolean");
  });

  it("prompt-opportunity status is one of the 5 expected values", () => {
    expect(SRC).toContain('"winning"');
    expect(SRC).toContain('"competitive"');
    expect(SRC).toContain('"absent"');
    expect(SRC).toContain('"outranked"');
    expect(SRC).toContain('"early"');
  });

  it("does NOT call paid APIs / OpenAI / scans / mutate stores", () => {
    expect(SRC).not.toContain("openai");
    expect(SRC).not.toContain("OpenAI");
    expect(SRC).not.toContain("perplexity");
    expect(SRC).not.toContain("syncRecommendedEdits");
    expect(SRC).not.toContain("syncUrlChangeOutcomes");
    expect(SRC).not.toContain("writeStore(");
    expect(SRC).not.toContain("persistRecommendedEditsLocal");
  });

  it("v2 records do NOT include raw UUIDs in primary identifier slots", () => {
    // city-strength uses `city: string` (display name), not city_id.
    // service-strength uses `service: string`. competitor uses
    // competitor_name. Prompt-opportunity uses `prompt_text_snippet`
    // for the operator-readable label (prompt_id is included for
    // debug traceability but the snippet is the customer-readable
    // identifier).
    expect(SRC).toContain("city: string");
    expect(SRC).toContain("service: string");
    expect(SRC).toContain("competitor_name: string");
    expect(SRC).toContain("prompt_text_snippet: string");
  });
});
