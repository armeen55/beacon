/**
 * Recommendation Execution Layer v1 Phase A (2026-05-13) —
 * adapter unit tests. Covers buildCopyTile for every supported
 * ActionRowType + every suppression path.
 */

import { describe, expect, it } from "vitest";

import {
  ACTION_ROW_TYPE_LABEL,
  type ActionRowType,
  type RecommendationActionRow,
} from "@/domains/recommendations/recommendation-action-rows";
import {
  buildCopyTile,
  countChars,
  META_DESCRIPTION_MAX_CHARS,
  splitHeadingAndParagraph,
  SUGGESTED_COPY_ACTION_ROW_TYPES,
  supportsSuggestedCopy,
  TITLE_TAG_MAX_CHARS,
} from "@/domains/recommendations/suggested-copy-adapters";

// ─────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────

function makeRow(
  overrides: Omit<Partial<RecommendationActionRow>, "detail"> & {
    detail?: Partial<RecommendationActionRow["detail"]>;
  } = {},
): RecommendationActionRow {
  const { detail: detailOverrides, ...rest } = overrides;
  return {
    id: "rec-fixture__edit-1",
    rank: 1,
    title: "Add a section about modern home builders in Atherton",
    targetLabel: "Modern Home Builder Atherton page",
    targetUrl: "https://example.com/services/modern-home-builder-atherton",
    actionType: "edit_h2",
    priority: "high",
    status: "new",
    evidenceSummary: "AI cites competitors on 4 of 7 prompts; brand absent.",
    sourceRecommendationId: "rec-fixture",
    sourceEditId: "edit-1",
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
      proposedText:
        "Architect-designed custom homes in Atherton\n\nRitz Builders emphasizes an architect-led design-build approach.",
      why: "Modern-home-builder framing is missing on the current page.",
      measurementPlan: "Watch citation rate for 14 days.",
      evidenceRefs: [],
      fullReasoning: null,
      confidenceReason: null,
      motiveLabel: null,
      pageBrief: null,
      suggestedEdits: [],
      risks: [],
      cannibalization: null,
      topCompetitor: null,
      affectedPromptCount: 3,
      observationCount: 7,
      evidenceDepth: 5,
      derivedConfidence: "strong_evidence",
      faqAnswerText: null,
      debug: {
        recommendationId: "rec-fixture",
        editId: "edit-1",
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
// supportsSuggestedCopy
// ─────────────────────────────────────────────────────────────────────

describe("supportsSuggestedCopy", () => {
  it("returns true for the 11 supported action-row types", () => {
    const supported: ActionRowType[] = [
      "edit_h1",
      "edit_h2",
      "edit_title",
      "edit_meta",
      "add_schema",
      "add_faq",
      "add_section",
      "improve_copy",
      "add_internal_links",
      "add_comparison_table",
      "technical_fix",
    ];
    for (const t of supported) {
      expect(supportsSuggestedCopy(t), `expected ${t} to be supported`).toBe(
        true,
      );
    }
  });

  it("returns false for unsupported / lifecycle / meta action-row types", () => {
    const unsupported: ActionRowType[] = [
      "create_page",
      "review_decision",
      "regenerate_edit",
    ];
    for (const t of unsupported) {
      expect(
        supportsSuggestedCopy(t),
        `expected ${t} NOT to be supported`,
      ).toBe(false);
    }
  });

  it("the SUGGESTED_COPY_ACTION_ROW_TYPES export matches supportsSuggestedCopy", () => {
    // Every ActionRowType key in ACTION_ROW_TYPE_LABEL is either in the
    // list or not — keep these in sync.
    for (const key of Object.keys(ACTION_ROW_TYPE_LABEL) as ActionRowType[]) {
      const expected = supportsSuggestedCopy(key);
      const actual = SUGGESTED_COPY_ACTION_ROW_TYPES.includes(key);
      expect(actual).toBe(expected);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// splitHeadingAndParagraph
// ─────────────────────────────────────────────────────────────────────

describe("splitHeadingAndParagraph", () => {
  it("strips an explicit 'H2:' marker on the first line", () => {
    const r = splitHeadingAndParagraph(
      "H2: My heading\n\nThe body paragraph goes here.",
      "fallback heading",
    );
    expect(r.heading).toBe("My heading");
    expect(r.paragraph).toBe("The body paragraph goes here.");
  });

  it("splits on a double-newline when the first line looks like a heading", () => {
    const r = splitHeadingAndParagraph(
      "Architect-designed custom homes in Atherton\n\nRitz Builders emphasizes…",
      "fallback heading",
    );
    expect(r.heading).toBe("Architect-designed custom homes in Atherton");
    expect(r.paragraph).toBe("Ritz Builders emphasizes…");
  });

  it("falls back to provided heading + full text when no split is clear", () => {
    const r = splitHeadingAndParagraph(
      "This is a single body paragraph with no heading line.",
      "Fallback",
    );
    expect(r.heading).toBe("Fallback");
    expect(r.paragraph).toBe(
      "This is a single body paragraph with no heading line.",
    );
  });

  it("falls back when the first 'line' is too long to be a heading", () => {
    const longFirst =
      "This first line is far too long to be a heading because it just keeps going and going and going past the operator-locked 120 character cap. Ok end.";
    const r = splitHeadingAndParagraph(longFirst, "Fallback");
    expect(r.heading).toBe("Fallback");
    expect(r.paragraph).toContain("first line");
  });
});

// ─────────────────────────────────────────────────────────────────────
// buildCopyTile — per ActionRowType
// ─────────────────────────────────────────────────────────────────────

describe("buildCopyTile — FAQ", () => {
  it("renders a faq tile with question + answer when faqAnswerText is present", () => {
    const row = makeRow({
      actionType: "add_faq",
      title: "Who builds modern custom homes in Atherton?",
      detail: {
        proposedText: "Who builds modern custom homes in Atherton?",
        faqAnswerText:
          "Ritz Builders builds modern custom homes in Atherton with an architect-led approach.",
      },
    });
    const tile = buildCopyTile(row);
    expect(tile).not.toBeNull();
    expect(tile?.kind).toBe("faq");
    if (tile?.kind === "faq") {
      expect(tile.question).toContain("Atherton");
      expect(tile.answer).toContain("Ritz Builders");
    }
  });

  it("falls back to proposedText as the answer when faqAnswerText is missing", () => {
    const row = makeRow({
      actionType: "add_faq",
      title: "Who builds modern custom homes in Atherton?",
      detail: {
        proposedText:
          "Ritz Builders builds modern custom homes in Atherton with an architect-led approach.",
        faqAnswerText: null,
      },
    });
    const tile = buildCopyTile(row);
    expect(tile?.kind).toBe("faq");
    if (tile?.kind === "faq") {
      expect(tile.question).toContain("Atherton");
      expect(tile.answer).toContain("Ritz Builders");
    }
  });
});

describe("buildCopyTile — H2", () => {
  it("splits proposed text into heading + paragraph", () => {
    const row = makeRow({
      actionType: "edit_h2",
      detail: {
        proposedText:
          "Custom homes in Palo Alto\n\nOur team coordinates architecture, engineering, and permitting.",
      },
    });
    const tile = buildCopyTile(row);
    expect(tile?.kind).toBe("h2");
    if (tile?.kind === "h2") {
      expect(tile.heading).toBe("Custom homes in Palo Alto");
      expect(tile.paragraph).toContain("coordinates");
    }
  });
});

describe("buildCopyTile — H1", () => {
  it("renders an h1 tile with a single heading line", () => {
    const row = makeRow({
      actionType: "edit_h1",
      detail: { proposedText: "Custom Home Builders in Atherton" },
    });
    const tile = buildCopyTile(row);
    expect(tile?.kind).toBe("h1");
    if (tile?.kind === "h1") {
      expect(tile.heading).toBe("Custom Home Builders in Atherton");
    }
  });
});

describe("buildCopyTile — title / meta", () => {
  it("renders a title tile for edit_title with title populated and meta null", () => {
    const row = makeRow({
      actionType: "edit_title",
      detail: {
        proposedText:
          "Custom Home Builders in Atherton | Ritz Builders",
      },
    });
    const tile = buildCopyTile(row);
    expect(tile?.kind).toBe("title_meta");
    if (tile?.kind === "title_meta") {
      expect(tile.title).toContain("Ritz Builders");
      expect(tile.meta).toBeNull();
    }
  });

  it("renders a meta tile for edit_meta with title empty and meta populated", () => {
    const row = makeRow({
      actionType: "edit_meta",
      detail: {
        proposedText:
          "Ritz Builders builds modern custom homes in Atherton with architect-led design-build coordination.",
      },
    });
    const tile = buildCopyTile(row);
    expect(tile?.kind).toBe("title_meta");
    if (tile?.kind === "title_meta") {
      expect(tile.title).toBe("");
      expect(tile.meta).toContain("Ritz Builders");
    }
  });
});

describe("buildCopyTile — internal link", () => {
  it("renders an internal_link tile with anchor + targetUrl", () => {
    const row = makeRow({
      actionType: "add_internal_links",
      targetUrl: "https://example.com/whole-home-remodel",
      detail: { proposedText: "whole home remodel approach" },
    });
    const tile = buildCopyTile(row);
    expect(tile?.kind).toBe("internal_link");
    if (tile?.kind === "internal_link") {
      expect(tile.anchor).toBe("whole home remodel approach");
      expect(tile.targetUrl).toBe("https://example.com/whole-home-remodel");
    }
  });
});

describe("buildCopyTile — comparison table", () => {
  it("renders a table tile with markdown rows", () => {
    const markdown =
      "| Scope | Range |\n| --- | --- |\n| Kitchen remodel | varies by site |";
    const row = makeRow({
      actionType: "add_comparison_table",
      detail: { proposedText: markdown },
    });
    const tile = buildCopyTile(row);
    expect(tile?.kind).toBe("table");
    if (tile?.kind === "table") {
      expect(tile.markdown).toContain("| Scope |");
    }
  });
});

describe("buildCopyTile — section / schema / technical_fix", () => {
  it.each([
    ["add_section"],
    ["add_schema"],
    ["technical_fix"],
  ])("renders a section tile for %s", (actionType) => {
    const row = makeRow({
      actionType: actionType as ActionRowType,
      detail: {
        proposedText:
          "Project scope overview\n\nWe handle site survey, design, permitting, and construction in one team.",
      },
    });
    const tile = buildCopyTile(row);
    expect(tile?.kind).toBe("section");
    if (tile?.kind === "section") {
      expect(tile.body).toContain("site survey");
    }
  });
});

describe("buildCopyTile — improve_copy plain", () => {
  it("renders a plain tile for improve_copy", () => {
    const row = makeRow({
      actionType: "improve_copy",
      detail: {
        proposedText:
          "Our team coordinates architecture, engineering, and permitting from concept through completion.",
      },
    });
    const tile = buildCopyTile(row);
    expect(tile?.kind).toBe("plain");
    if (tile?.kind === "plain") {
      expect(tile.text).toContain("coordinates");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// buildCopyTile — suppression
// ─────────────────────────────────────────────────────────────────────

describe("buildCopyTile — suppression", () => {
  it.each([["create_page"], ["review_decision"], ["regenerate_edit"]])(
    "returns null for unsupported action type %s",
    (actionType) => {
      const row = makeRow({
        actionType: actionType as ActionRowType,
        detail: { proposedText: "anything" },
      });
      expect(buildCopyTile(row)).toBeNull();
    },
  );

  it("returns null for a supported type with empty proposedText", () => {
    const row = makeRow({
      actionType: "edit_h2",
      detail: { proposedText: "" },
    });
    expect(buildCopyTile(row)).toBeNull();
  });

  it("returns null for a supported type with whitespace-only proposedText", () => {
    const row = makeRow({
      actionType: "edit_h1",
      detail: { proposedText: "    \n   " },
    });
    expect(buildCopyTile(row)).toBeNull();
  });

  it("returns null for add_faq when both title and faqAnswerText/proposedText are empty", () => {
    const row = makeRow({
      actionType: "add_faq",
      title: "",
      detail: { proposedText: "", faqAnswerText: null },
    });
    expect(buildCopyTile(row)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────
// buildCopyTile — display guard integration
// ─────────────────────────────────────────────────────────────────────

describe("buildCopyTile — display guard fallback", () => {
  it("returns a fallback tile when proposedText contains a UUID", () => {
    const row = makeRow({
      actionType: "edit_h2",
      detail: {
        proposedText:
          "H2: Test\n\nDrawn from 7ee3216b-327c-4de9-8d5d-2f4c95a6d773 evidence.",
      },
    });
    const tile = buildCopyTile(row);
    expect(tile?.kind).toBe("fallback");
    if (tile?.kind === "fallback") {
      expect(tile.reason).toBe("uuid");
    }
  });

  it("returns a fallback tile when proposedText contains aiSearchSignal", () => {
    const row = makeRow({
      actionType: "edit_h2",
      detail: {
        proposedText:
          "H2: Test\n\nSourced from aiSearchSignal data on this prompt.",
      },
    });
    const tile = buildCopyTile(row);
    expect(tile?.kind).toBe("fallback");
    if (tile?.kind === "fallback") {
      expect(tile.reason).toBe("internal_token");
    }
  });

  it("returns a fallback tile when proposedText contains actualSearchQueries", () => {
    const row = makeRow({
      actionType: "edit_meta",
      detail: { proposedText: "Aligned with actualSearchQueries patterns." },
    });
    const tile = buildCopyTile(row);
    expect(tile?.kind).toBe("fallback");
  });

  it("returns a fallback tile when proposedText contains topSearchQueries", () => {
    const row = makeRow({
      actionType: "edit_title",
      detail: { proposedText: "Tuned for topSearchQueries patterns." },
    });
    const tile = buildCopyTile(row);
    expect(tile?.kind).toBe("fallback");
  });

  it("returns a fallback tile when the FAQ answer contains a snake_case identifier", () => {
    const row = makeRow({
      actionType: "add_faq",
      title: "How long does a custom home take?",
      detail: {
        proposedText: "Answer with rec_id leak inside.",
        faqAnswerText: "Answer with rec_id leak inside.",
      },
    });
    const tile = buildCopyTile(row);
    expect(tile?.kind).toBe("fallback");
  });
});

// ─────────────────────────────────────────────────────────────────────
// buildCopyTile — before/after (current → proposed)
// ─────────────────────────────────────────────────────────────────────

describe("buildCopyTile — before/after carry-through", () => {
  it("edit_title carries the current title as beforeTitle (beforeMeta null)", () => {
    const row = makeRow({
      actionType: "edit_title",
      detail: {
        currentText: "Old Atherton Builder Title",
        proposedText: "Custom Home Builders in Atherton | Ritz Builders",
      },
    });
    const tile = buildCopyTile(row);
    expect(tile?.kind).toBe("title_meta");
    if (tile?.kind === "title_meta") {
      expect(tile.beforeTitle).toBe("Old Atherton Builder Title");
      expect(tile.beforeMeta).toBeNull();
    }
  });

  it("edit_meta carries the current meta as beforeMeta (beforeTitle null)", () => {
    const row = makeRow({
      actionType: "edit_meta",
      detail: {
        currentText: "The old, vague meta description.",
        proposedText:
          "Ritz Builders builds modern custom homes in Atherton with architect-led design-build coordination.",
      },
    });
    const tile = buildCopyTile(row);
    expect(tile?.kind).toBe("title_meta");
    if (tile?.kind === "title_meta") {
      expect(tile.beforeMeta).toBe("The old, vague meta description.");
      expect(tile.beforeTitle).toBeNull();
    }
  });

  it("edit_h1 carries the current heading as before", () => {
    const row = makeRow({
      actionType: "edit_h1",
      detail: {
        currentText: "Builder",
        proposedText: "Custom Home Builders in Atherton",
      },
    });
    const tile = buildCopyTile(row);
    expect(tile?.kind).toBe("h1");
    if (tile?.kind === "h1") {
      expect(tile.before).toBe("Builder");
    }
  });

  it("edit_h2 carries the current heading as before (paragraph is net-new)", () => {
    const row = makeRow({
      actionType: "edit_h2",
      detail: {
        currentText: "Our Work",
        proposedText:
          "Custom homes in Palo Alto\n\nOur team coordinates architecture, engineering, and permitting.",
      },
    });
    const tile = buildCopyTile(row);
    expect(tile?.kind).toBe("h2");
    if (tile?.kind === "h2") {
      expect(tile.before).toBe("Our Work");
      expect(tile.heading).toBe("Custom homes in Palo Alto");
    }
  });

  it("falls back to null before when currentText is empty / whitespace", () => {
    const row = makeRow({
      actionType: "edit_title",
      detail: {
        currentText: "   ",
        proposedText: "Custom Home Builders in Atherton | Ritz Builders",
      },
    });
    const tile = buildCopyTile(row);
    expect(tile?.kind).toBe("title_meta");
    if (tile?.kind === "title_meta") {
      expect(tile.beforeTitle).toBeNull();
    }
  });

  it("an additive type (add_faq) carries no before fields", () => {
    const row = makeRow({
      actionType: "add_faq",
      title: "Who builds modern custom homes in Atherton?",
      detail: {
        currentText: "some current text that must not surface",
        proposedText: "Who builds modern custom homes in Atherton?",
        faqAnswerText:
          "Ritz Builders builds modern custom homes in Atherton with an architect-led approach.",
      },
    });
    const tile = buildCopyTile(row);
    expect(tile?.kind).toBe("faq");
    // FAQ tile shape has no before-style key at all.
    expect(tile).not.toHaveProperty("before");
    expect(tile).not.toHaveProperty("beforeTitle");
    expect(tile).not.toHaveProperty("beforeMeta");
  });

  it("a before value that fails the display guard is dropped to null, tile still renders (not fallback)", () => {
    const row = makeRow({
      actionType: "edit_title",
      detail: {
        // currentText leaks an internal token → guard fails → before dropped.
        currentText: "Old title with rec_id leak",
        proposedText: "Custom Home Builders in Atherton | Ritz Builders",
      },
    });
    const tile = buildCopyTile(row);
    expect(tile?.kind).toBe("title_meta");
    if (tile?.kind === "title_meta") {
      expect(tile.beforeTitle).toBeNull();
      expect(tile.title).toContain("Ritz Builders");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// Char-count helpers
// ─────────────────────────────────────────────────────────────────────

describe("countChars", () => {
  it("returns the string length", () => {
    expect(countChars("hello")).toBe(5);
    expect(countChars("")).toBe(0);
    expect(countChars(null)).toBe(0);
    expect(countChars(undefined)).toBe(0);
  });
});

describe("constants", () => {
  it("operator-locked title/meta max chars", () => {
    expect(TITLE_TAG_MAX_CHARS).toBe(60);
    expect(META_DESCRIPTION_MAX_CHARS).toBe(155);
  });
});
