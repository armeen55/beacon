/**
 * Section 7 C7b (2026-05-16) — Off-Site action-type registry tests.
 *
 * Covers:
 *   • Each of the 7 off-site/manual action types is present in
 *     `ACTION_TYPES` exactly once.
 *   • Each off-site registry entry carries the locked shared shape:
 *     `signalType: "off_page_seo"`, `generatorActive: false`,
 *     `requiresCurrentText: false`, `requiresProposedText: false`,
 *     `elementTypeDomain: []`, `changelogAssetType: "directory_profile"`,
 *     non-empty `operatorLabel`.
 *   • `listActiveActionTypes()` (exported) returns no off-site types.
 *     This proves the same logic that `defaultAllowedActionTypes()`
 *     uses inside `specific-edit-evidence.ts` (both filter on
 *     `ACTION_TYPE_REGISTRY[t].generatorActive`); a parallel source-
 *     text invariant in `tests/architecture/off-site-action-types-
 *     not-llm-allowed.test.ts` pins the filter shape there.
 *   • `actionRowTypeForEdit(<each off-site type>)` (exported) returns
 *     `"review_decision"` — the existing row type that suppresses
 *     Suggested Copy Act 4 automatically and avoids adding a new
 *     `ActionRowType` value.
 *   • `supportsSuggestedCopy("review_decision")` (exported) returns
 *     `false`, so any future off-site row would never render an
 *     Act 4 tile.
 *   • `buildCopyTile(row)` (exported) returns `null` for a fixture
 *     row whose `actionType` is `"review_decision"` — end-to-end
 *     proof Act 4 stays suppressed when an off-site row exists.
 *   • `SUPPORTED_ACTION_TYPES` from the match engine (exported) does
 *     not include any of the 7 off-site types.
 *
 * No private helper was exported for this test. Each assertion uses
 * an already-exported public API.
 */

import { describe, it, expect } from "vitest";

import {
  ACTION_TYPES,
  ACTION_TYPE_REGISTRY,
  listActiveActionTypes,
  type ActionType,
} from "@/domains/recommendations/action-types";
import {
  actionRowTypeForEdit,
  type RecommendationActionRow,
} from "@/domains/recommendations/recommendation-action-rows";
import {
  supportsSuggestedCopy,
  buildCopyTile,
} from "@/domains/recommendations/suggested-copy-adapters";
import { SUPPORTED_ACTION_TYPES } from "@/domains/recommendations/match-engine/types";

const OFF_SITE_ACTION_TYPES: ReadonlyArray<ActionType> = [
  "claim_gbp",
  "optimize_gbp_profile",
  "request_gbp_reviews",
  "claim_or_optimize_houzz",
  "claim_or_optimize_yelp",
  "submit_to_industry_directory",
  "pursue_local_pr",
];

describe("Section 7 C7b — off-site action types in ACTION_TYPES", () => {
  for (const t of OFF_SITE_ACTION_TYPES) {
    it(`includes "${t}" exactly once in ACTION_TYPES`, () => {
      const hits = ACTION_TYPES.filter((x) => x === t);
      expect(hits).toHaveLength(1);
    });
  }
});

describe("Section 7 C7b — off-site registry entry shape", () => {
  for (const t of OFF_SITE_ACTION_TYPES) {
    const spec = ACTION_TYPE_REGISTRY[t];

    it(`${t}: signalType === "off_page_seo"`, () => {
      expect(spec.signalType).toBe("off_page_seo");
    });

    it(`${t}: generatorActive === false (locked: LLM never produces these)`, () => {
      expect(spec.generatorActive).toBe(false);
    });

    it(`${t}: requiresCurrentText === false`, () => {
      expect(spec.requiresCurrentText).toBe(false);
    });

    it(`${t}: requiresProposedText === false (no publishable text)`, () => {
      expect(spec.requiresProposedText).toBe(false);
    });

    it(`${t}: elementTypeDomain is empty (no on-page element target)`, () => {
      expect(spec.elementTypeDomain).toEqual([]);
    });

    it(`${t}: changelogAssetType === "directory_profile"`, () => {
      expect(spec.changelogAssetType).toBe("directory_profile");
    });

    it(`${t}: operatorLabel is a non-empty string`, () => {
      expect(typeof spec.operatorLabel).toBe("string");
      expect(spec.operatorLabel.length).toBeGreaterThan(0);
    });
  }
});

describe("Section 7 C7b — off-site types excluded from LLM-active set", () => {
  it("listActiveActionTypes() returns none of the 7 off-site types", () => {
    const active = new Set(listActiveActionTypes());
    for (const t of OFF_SITE_ACTION_TYPES) {
      expect(active.has(t)).toBe(false);
    }
  });

  it("ACTION_TYPES filtered by generatorActive=true contains none of the 7 off-site types", () => {
    // Parallel proof against the same filter shape that
    // specific-edit-evidence.ts:defaultAllowedActionTypes uses.
    const active = ACTION_TYPES.filter(
      (t) => ACTION_TYPE_REGISTRY[t].generatorActive,
    );
    for (const t of OFF_SITE_ACTION_TYPES) {
      expect(active).not.toContain(t);
    }
  });
});

describe("Section 7 C7b — actionRowTypeForEdit maps off-site → review_decision", () => {
  for (const t of OFF_SITE_ACTION_TYPES) {
    it(`actionRowTypeForEdit("${t}") === "review_decision"`, () => {
      expect(actionRowTypeForEdit(t)).toBe("review_decision");
    });
  }
});

describe("Section 7 C7b — Suggested Copy stays suppressed for off-site rows", () => {
  it("supportsSuggestedCopy('review_decision') is false", () => {
    expect(supportsSuggestedCopy("review_decision")).toBe(false);
  });

  for (const t of OFF_SITE_ACTION_TYPES) {
    it(`supportsSuggestedCopy(actionRowTypeForEdit("${t}")) is false`, () => {
      expect(supportsSuggestedCopy(actionRowTypeForEdit(t))).toBe(false);
    });
  }

  it("buildCopyTile returns null for a fixture row whose actionType is review_decision", () => {
    // Minimal RecommendationActionRow with `actionType: "review_decision"`.
    // buildCopyTile's first decision (suggested-copy-adapters.ts:150)
    // is `if (!supportsSuggestedCopy(row.actionType)) return null;` so
    // the rest of the row fields are not read. A `Partial` cast keeps
    // the fixture minimal without re-deriving the full row shape.
    const row = {
      id: "fixture-off-site-row",
      rank: 1,
      title: "Fixture",
      targetLabel: "Off-site",
      targetUrl: null,
      actionType: "review_decision",
      priority: "low",
      status: "new",
      evidenceSummary: "",
      sourceRecommendationId: "fixture-rec",
      sourceEditId: null,
      editSource: null,
      engineConfidence: null,
      derivedConfidence: "needs_review",
      hasExactEdit: false,
      responseStatus: null,
      acceptedAgeDays: 0,
      deferUntil: null,
      eligibleEditCount: 0,
      detail: {
        currentText: null,
        proposedText: null,
        why: null,
        measurementPlan: null,
        evidenceRefs: [],
        fullReasoning: null,
        confidenceReason: null,
        motiveLabel: null,
        pageBrief: null,
        suggestedEdits: [],
        risks: [],
        cannibalization: null,
        topCompetitor: null,
        affectedPromptCount: 0,
        observationCount: 0,
        evidenceDepth: 0,
        derivedConfidence: "needs_review",
        faqAnswerText: null,
        debug: {
          recommendationId: "fixture-rec",
          editId: null,
          pairedAnswerEditId: null,
          resolverTier: null,
          resolutionAction: null,
          motive: null,
          engineConfidence: { confidence: "low", reasons: [] },
          evidenceHash: null,
          editLifecycleStatus: null,
        },
      },
    } as unknown as RecommendationActionRow;
    expect(buildCopyTile(row)).toBeNull();
  });
});

describe("Section 7 C7b — off-site types are NOT in match-engine SUPPORTED_ACTION_TYPES", () => {
  for (const t of OFF_SITE_ACTION_TYPES) {
    it(`SUPPORTED_ACTION_TYPES does not include "${t}" (match engine treats off-site as unsupported)`, () => {
      expect(SUPPORTED_ACTION_TYPES as readonly string[]).not.toContain(t);
    });
  }
});
