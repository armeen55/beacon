/**
 * Recommendation Execution Layer v1 — 2026-05-13 P0 follow-up.
 * Unit tests for the four-step resolver ladder.
 */

import { describe, expect, it } from "vitest";

import type { RecommendationActionRow } from "@/domains/recommendations/recommendation-action-rows";
import { resolveRecommendationDetail } from "@/domains/recommendations/resolve-recommendation-detail";

// ─────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────

function makeRow(
  overrides: Omit<Partial<RecommendationActionRow>, "detail"> & {
    detail?: Partial<RecommendationActionRow["detail"]>;
  } = {},
): RecommendationActionRow {
  const { detail: detailOverrides, ...rest } = overrides;
  const stableKey =
    (rest.sourceRecommendationId as string | undefined) ??
    "create_cluster_page:geo:Palo Alto";
  const editId =
    (rest.sourceEditId as string | undefined) ??
    "create_cluster_page:geo:Palo Alto__add_h2_section__h2[new]:abc123";
  return {
    id: `${stableKey}::${editId}`,
    rank: 1,
    title: "Add H2 section",
    targetLabel: "Palo Alto page",
    targetUrl: "https://example.com/services/palo-alto",
    actionType: "edit_h2",
    priority: "high",
    status: "new",
    evidenceSummary: "summary",
    sourceRecommendationId: stableKey,
    sourceEditId: editId,
    editSource: "openai",
    engineConfidence: "high",
    derivedConfidence: "strong_evidence",
    hasExactEdit: true,
    responseStatus: null,
    acceptedAgeDays: 0,
    deferUntil: null,
    eligibleEditCount: 1,
    detail: {
      currentText: null,
      proposedText: "H2 body",
      why: "why",
      measurementPlan: "plan",
      evidenceRefs: [],
      fullReasoning: null,
      confidenceReason: null,
      motiveLabel: null,
      pageBrief: null,
      suggestedEdits: [],
      risks: [],
      cannibalization: null,
      topCompetitor: null,
      affectedPromptCount: 1,
      observationCount: 1,
      evidenceDepth: 1,
      derivedConfidence: "strong_evidence",
      faqAnswerText: null,
      debug: {
        recommendationId: stableKey,
        editId,
        pairedAnswerEditId: null,
        resolverTier: null,
        resolutionAction: null,
        motive: null,
        engineConfidence: { confidence: "high", reasons: [] },
        evidenceHash: null,
        editLifecycleStatus: null,
        prioritizerTier: null,
        prioritizerScore: null,
      },
      ...detailOverrides,
    },
    ...rest,
  } as RecommendationActionRow;
}

// ─────────────────────────────────────────────────────────────────────
// Step 1 — exact match
// ─────────────────────────────────────────────────────────────────────

describe("resolveRecommendationDetail — step 1 (exact)", () => {
  it("returns exact when row.id matches the decoded id", () => {
    const rows = [makeRow()];
    const result = resolveRecommendationDetail(rows, rows[0].id);
    expect(result.kind).toBe("exact");
    if (result.kind === "exact") {
      expect(result.row.id).toBe(rows[0].id);
    }
  });

  it("returns exact even when the matched row is dismissed", () => {
    // The exact path NEVER filters by status — the operator may want
    // to revisit a dismissed/shipped row at its direct URL.
    const rows = [
      makeRow({ status: "dismissed", responseStatus: "dismissed" }),
    ];
    const result = resolveRecommendationDetail(rows, rows[0].id);
    expect(result.kind).toBe("exact");
  });
});

// ─────────────────────────────────────────────────────────────────────
// Step 2 — by edit id
// ─────────────────────────────────────────────────────────────────────

describe("resolveRecommendationDetail — step 2 (by edit id)", () => {
  it("redirects to a row with the same sourceEditId when row.id differs (paired FAQ shape drift)", () => {
    // Simulate: a card historically generated id `${stableKey}::${edit.id}`,
    // but the row builder later emitted the same edit under the paired
    // FAQ shape `${stableKey}::faq-pair::${hash}`. The sourceEditId is
    // stable across both shapes; the resolver re-anchors on it.
    const editId =
      "rec-7__add_faq__faq_question[new]:abc";
    const currentRow = makeRow({
      id: "rec-7::faq-pair::abc",
      sourceRecommendationId: "rec-7",
      sourceEditId: editId,
    });
    const decoded = `rec-7::${editId}`; // the OLD URL shape
    const result = resolveRecommendationDetail([currentRow], decoded);
    expect(result.kind).toBe("redirect");
    if (result.kind === "redirect") {
      expect(result.via).toBe("edit_id");
      expect(result.row.id).toBe(currentRow.id);
    }
  });

  it("does NOT redirect to a dismissed row at step 2", () => {
    const editId = "rec-7__add_h2_section__h2[new]:abc";
    const dismissedRow = makeRow({
      id: "rec-7::other-shape",
      sourceEditId: editId,
      status: "dismissed",
      responseStatus: "dismissed",
    });
    const decoded = `rec-7::${editId}`;
    const result = resolveRecommendationDetail([dismissedRow], decoded);
    // No actionable row → falls through to miss (no other rows here).
    expect(result.kind).toBe("miss");
  });
});

// ─────────────────────────────────────────────────────────────────────
// Step 3 — by rec stable key
// ─────────────────────────────────────────────────────────────────────

describe("resolveRecommendationDetail — step 3 (by rec stable key)", () => {
  it("redirects to the highest-ranked actionable row when the URL's edit id is gone but other rows exist for the same rec", () => {
    const rows = [
      makeRow({
        id: "rec-9::rec-9__add_faq__faq_question[new]:newhash",
        sourceRecommendationId: "rec-9",
        sourceEditId: "rec-9__add_faq__faq_question[new]:newhash",
        rank: 2,
      }),
      makeRow({
        id: "rec-9::rec-9__edit_title__title-1",
        sourceRecommendationId: "rec-9",
        sourceEditId: "rec-9__edit_title__title-1",
        rank: 1, // higher priority
      }),
    ];
    const decoded =
      "rec-9::rec-9__add_h2_section__h2[new]:disappeared-hash";
    const result = resolveRecommendationDetail(rows, decoded);
    expect(result.kind).toBe("redirect");
    if (result.kind === "redirect") {
      expect(result.via).toBe("rec_stable_key");
      // Should redirect to the lower-rank (higher priority) row.
      expect(result.row.rank).toBe(1);
    }
  });

  it("does NOT redirect when every same-rec row is dismissed / shipped", () => {
    const rows = [
      makeRow({
        id: "rec-12::rec-12__add_faq__faq_question[new]:x",
        sourceRecommendationId: "rec-12",
        sourceEditId: "rec-12__add_faq__faq_question[new]:x",
        status: "dismissed",
        responseStatus: "dismissed",
      }),
      makeRow({
        id: "rec-12::rec-12__edit_h2__h2[new]:y",
        sourceRecommendationId: "rec-12",
        sourceEditId: "rec-12__edit_h2__h2[new]:y",
        status: "shipped",
      }),
    ];
    const decoded = "rec-12::rec-12__add_h2_section__h2[new]:gone";
    const result = resolveRecommendationDetail(rows, decoded);
    expect(result.kind).toBe("miss");
  });

  it("never redirects to the same id (no redirect loops)", () => {
    const rows = [
      makeRow({
        id: "rec-13::rec-13__add_h2_section__h2[new]:z",
        sourceRecommendationId: "rec-13",
        sourceEditId: "rec-13__add_h2_section__h2[new]:z",
      }),
    ];
    // Decoded id matches an existing row — but we pass a DIFFERENT
    // decoded value. The resolver should NOT redirect to the same
    // row because step 1 (exact) already would've fired if it matched.
    const decoded = "rec-13::rec-13__add_h2_section__h2[new]:different";
    const result = resolveRecommendationDetail(rows, decoded);
    expect(result.kind).toBe("redirect");
    if (result.kind === "redirect") {
      expect(result.row.id).not.toBe(decoded);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// Step 4 — miss with hint
// ─────────────────────────────────────────────────────────────────────

describe("resolveRecommendationDetail — step 4 (miss with hint)", () => {
  it("returns a miss with parsed stableKey + editId + actionType for the Palo Alto H2 URL", () => {
    const decoded =
      "create_cluster_page:geo:Palo Alto::create_cluster_page:geo:Palo Alto__add_h2_section__h2[new]:paloalto1a2b3c4d";
    const result = resolveRecommendationDetail([], decoded);
    expect(result.kind).toBe("miss");
    if (result.kind === "miss") {
      expect(result.hint.stableKey).toBe(
        "create_cluster_page:geo:Palo Alto",
      );
      expect(result.hint.editId).toBe(
        "create_cluster_page:geo:Palo Alto__add_h2_section__h2[new]:paloalto1a2b3c4d",
      );
      expect(result.hint.actionType).toBe("add_h2_section");
    }
  });

  it("returns a miss with null hints when the URL has no `::` separator", () => {
    const result = resolveRecommendationDetail([], "weird-id-no-separator");
    expect(result.kind).toBe("miss");
    if (result.kind === "miss") {
      expect(result.hint.stableKey).toBeNull();
      expect(result.hint.editId).toBeNull();
      expect(result.hint.actionType).toBeNull();
    }
  });

  it("handles paired-FAQ id shape `${stableKey}::faq-pair::${hash}` without crashing", () => {
    const decoded = "rec-50::faq-pair::deadbeef";
    const result = resolveRecommendationDetail([], decoded);
    expect(result.kind).toBe("miss");
    if (result.kind === "miss") {
      expect(result.hint.stableKey).toBe("rec-50");
      // The tail is `faq-pair::deadbeef`, which does NOT match the
      // edit-id `__`-segment shape, so actionType is null.
      expect(result.hint.editId).toBe("faq-pair::deadbeef");
      expect(result.hint.actionType).toBeNull();
    }
  });

  it("handles meta-action id shape `${stableKey}::${metaKind}` without crashing", () => {
    const decoded = "rec-77::review_decision";
    const result = resolveRecommendationDetail([], decoded);
    expect(result.kind).toBe("miss");
    if (result.kind === "miss") {
      expect(result.hint.stableKey).toBe("rec-77");
      expect(result.hint.editId).toBe("review_decision");
      expect(result.hint.actionType).toBeNull();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// Cross-check: every visible card href round-trips through the resolver
// ─────────────────────────────────────────────────────────────────────

describe("resolveRecommendationDetail — list/detail consistency", () => {
  it("every row id in a snapshot resolves exactly to itself", () => {
    const rows = [
      makeRow({ sourceRecommendationId: "rec-1" }),
      makeRow({
        id: "rec-2::rec-2__add_faq__faq_question[new]:abc",
        sourceRecommendationId: "rec-2",
        sourceEditId: "rec-2__add_faq__faq_question[new]:abc",
      }),
      makeRow({
        id: "rec-3::faq-pair::deadbeef",
        sourceRecommendationId: "rec-3",
        sourceEditId: "rec-3__add_faq__faq_question[new]:deadbeef",
      }),
    ];
    for (const row of rows) {
      const result = resolveRecommendationDetail(rows, row.id);
      expect(
        result.kind,
        `row ${row.id} must resolve exactly`,
      ).toBe("exact");
      if (result.kind === "exact") {
        expect(result.row.id).toBe(row.id);
      }
    }
  });
});
