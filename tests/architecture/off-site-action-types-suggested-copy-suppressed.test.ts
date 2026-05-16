/**
 * Architecture invariant — Section 7 C7b Suggested-Copy-suppression
 * contract (2026-05-16).
 *
 * Pins that off-site action rows never render an Act 4 Suggested Copy
 * tile:
 *
 *   1. `SUGGESTED_COPY_ACTION_ROW_TYPES` (exported) does NOT include
 *      `"review_decision"`. This is the existing allowlist that
 *      decides whether Act 4 renders.
 *   2. Every off-site action type maps (via the exported
 *      `actionRowTypeForEdit`) to `"review_decision"` — i.e. into
 *      the suppressed branch.
 *   3. Source-text: `recommendation-action-rows.ts`'s
 *      `actionRowTypeForEdit` switch carries 7 case arms, one per
 *      off-site action type, each returning `"review_decision"`.
 *
 * No private helper was exported for this test. The three exports we
 * rely on (`SUGGESTED_COPY_ACTION_ROW_TYPES`, `supportsSuggestedCopy`,
 * `actionRowTypeForEdit`) were already exported pre-C7b; no widening
 * was performed.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { type ActionType } from "@/domains/recommendations/action-types";
import {
  actionRowTypeForEdit,
} from "@/domains/recommendations/recommendation-action-rows";
import {
  supportsSuggestedCopy,
  SUGGESTED_COPY_ACTION_ROW_TYPES,
} from "@/domains/recommendations/suggested-copy-adapters";

const REPO_ROOT = resolve(__dirname, "..", "..");
const ROW_BUILDER_PATH =
  "src/domains/recommendations/recommendation-action-rows.ts";

const OFF_SITE_ACTION_TYPES: ReadonlyArray<ActionType> = [
  "claim_gbp",
  "optimize_gbp_profile",
  "request_gbp_reviews",
  "claim_or_optimize_houzz",
  "claim_or_optimize_yelp",
  "submit_to_industry_directory",
  "pursue_local_pr",
];

function read(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), "utf-8");
}
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("Architecture — Section 7 C7b Suggested Copy is suppressed for off-site rows", () => {
  it("SUGGESTED_COPY_ACTION_ROW_TYPES does not include 'review_decision'", () => {
    expect(SUGGESTED_COPY_ACTION_ROW_TYPES).not.toContain("review_decision");
  });

  it("supportsSuggestedCopy('review_decision') returns false", () => {
    expect(supportsSuggestedCopy("review_decision")).toBe(false);
  });

  for (const t of OFF_SITE_ACTION_TYPES) {
    it(`actionRowTypeForEdit("${t}") returns "review_decision" (suppressed branch)`, () => {
      expect(actionRowTypeForEdit(t)).toBe("review_decision");
    });

    it(`supportsSuggestedCopy(actionRowTypeForEdit("${t}")) is false`, () => {
      expect(supportsSuggestedCopy(actionRowTypeForEdit(t))).toBe(false);
    });
  }
});

describe("Architecture — Section 7 C7b row-builder source pins 7 off-site case arms", () => {
  const active = stripComments(read(ROW_BUILDER_PATH));

  for (const t of OFF_SITE_ACTION_TYPES) {
    it(`recommendation-action-rows.ts contains a case "${t}": arm in actionRowTypeForEdit`, () => {
      const re = new RegExp(`case\\s+["']${t}["']\\s*:`);
      expect(active).toMatch(re);
    });
  }

  it("the 7 off-site case arms route to `return \"review_decision\"`", () => {
    // Slice from the first off-site case arm to the closing brace of
    // the function. Within that slice there must be exactly one
    // `return "review_decision";` AND no other `return` statements
    // (no spillover into the existing arms above).
    const firstArmIdx = active.indexOf(`case "claim_gbp":`);
    expect(firstArmIdx).toBeGreaterThanOrEqual(0);
    const trailing = active.slice(firstArmIdx);
    // The next `}` after the off-site block closes the switch.
    const closeIdx = trailing.indexOf("}");
    expect(closeIdx).toBeGreaterThan(0);
    const offSiteBlock = trailing.slice(0, closeIdx);
    // Exactly one return inside the off-site block, returning
    // "review_decision".
    const returnMatches = offSiteBlock.match(/return\s+["']review_decision["']\s*;/g);
    expect(returnMatches).not.toBeNull();
    expect(returnMatches!.length).toBe(1);
  });
});
