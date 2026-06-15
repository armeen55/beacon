/**
 * Recommendation Execution Layer v1 Phase A (2026-05-13) —
 * SuggestedCopyAct render tests. Server-side renderToStaticMarkup so
 * no JSDOM / clipboard mocking is required for pure render checks.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { SuggestedCopyAct } from "@/app/(shell)/recommendations/[id]/suggested-copy-act";
import type {
  ActionRowType,
  RecommendationActionRow,
} from "@/domains/recommendations/recommendation-action-rows";

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
        "Architect-designed custom homes in Atherton\n\nRitz Builders coordinates architecture, engineering, and permitting.",
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

function render(row: RecommendationActionRow, index = 4): string {
  return renderToStaticMarkup(<SuggestedCopyAct row={row} index={index} />);
}

// ─────────────────────────────────────────────────────────────────────
// Always-present elements
// ─────────────────────────────────────────────────────────────────────

describe("SuggestedCopyAct — universal contract", () => {
  it("renders a section with data-recommendation-detail-act='act-suggested-copy'", () => {
    const html = render(makeRow());
    expect(html).toContain('data-recommendation-detail-act="act-suggested-copy"');
  });

  it("renders the supplied act index in the header label and as a data attr", () => {
    const html = render(makeRow(), 4);
    expect(html).toContain("Act 4");
    expect(html).toContain('data-recommendation-detail-act-index="4"');
  });

  it("always renders the 'Suggested copy' heading", () => {
    const html = render(makeRow());
    expect(html).toContain("Suggested copy");
  });

  it("always renders the 'Review before publishing' disclaimer", () => {
    const html = render(makeRow());
    expect(html).toContain("Review before publishing");
  });

  it("always renders the 'Why this copy' line", () => {
    const html = render(makeRow());
    expect(html).toContain("Why this copy");
  });

  it("always renders an accessible Copy button", () => {
    const html = render(makeRow());
    expect(html).toMatch(/aria-label="Copy [^"]+ to clipboard"/);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Per-tile rendering
// ─────────────────────────────────────────────────────────────────────

describe("SuggestedCopyAct — FAQ tile", () => {
  it("renders question + answer with target label", () => {
    const html = render(
      makeRow({
        actionType: "add_faq",
        title: "Who builds modern custom homes in Atherton?",
        targetLabel: "Atherton page",
        detail: {
          proposedText: "Who builds modern custom homes in Atherton?",
          faqAnswerText:
            "Ritz Builders builds modern custom homes in Atherton with an architect-led approach.",
        },
      }),
    );
    expect(html).toContain("FAQ question");
    expect(html).toContain("FAQ answer");
    expect(html).toContain("Who builds modern custom homes in Atherton?");
    expect(html).toContain("Ritz Builders builds modern custom homes");
    expect(html).toContain("Atherton page");
    expect(html).toContain('data-suggested-copy-tile="faq"');
  });
});

describe("SuggestedCopyAct — H2 tile", () => {
  it("renders heading and paragraph separately", () => {
    const html = render(makeRow({ actionType: "edit_h2" }));
    expect(html).toContain("Heading");
    expect(html).toContain("Paragraph");
    expect(html).toContain("Architect-designed custom homes in Atherton");
    expect(html).toContain("Ritz Builders coordinates");
    expect(html).toContain('data-suggested-copy-tile="h2"');
  });
});

describe("SuggestedCopyAct — H1 tile", () => {
  it("renders a single H1 heading line", () => {
    const html = render(
      makeRow({
        actionType: "edit_h1",
        detail: { proposedText: "Custom Home Builders in Atherton" },
      }),
    );
    expect(html).toContain("H1 heading");
    expect(html).toContain("Custom Home Builders in Atherton");
    expect(html).toContain('data-suggested-copy-tile="h1"');
  });
});

describe("SuggestedCopyAct — title tile", () => {
  it("renders title with character count", () => {
    const html = render(
      makeRow({
        actionType: "edit_title",
        detail: {
          proposedText: "Custom Home Builders in Atherton | Ritz Builders",
        },
      }),
    );
    expect(html).toContain("Title tag");
    expect(html).toContain("/ 60");
    expect(html).toContain("Custom Home Builders in Atherton | Ritz Builders");
  });
});

describe("SuggestedCopyAct — meta tile", () => {
  it("renders meta with character count", () => {
    const html = render(
      makeRow({
        actionType: "edit_meta",
        detail: {
          proposedText:
            "Ritz Builders builds modern custom homes in Atherton with architect-led coordination.",
        },
      }),
    );
    expect(html).toContain("Meta description");
    expect(html).toContain("/ 155");
  });
});

describe("SuggestedCopyAct — internal link tile", () => {
  it("renders anchor + linked-to URL", () => {
    const html = render(
      makeRow({
        actionType: "add_internal_links",
        targetUrl: "https://example.com/whole-home-remodel",
        detail: { proposedText: "whole home remodel approach" },
      }),
    );
    expect(html).toContain("Anchor text");
    expect(html).toContain("whole home remodel approach");
    expect(html).toContain("Links to");
    expect(html).toContain("https://example.com/whole-home-remodel");
    expect(html).toContain('data-suggested-copy-tile="internal_link"');
  });
});

describe("SuggestedCopyAct — table tile", () => {
  it("renders markdown table rows in a monospace field", () => {
    const md = "| Scope | Range |\n| --- | --- |\n| Kitchen | varies |";
    const html = render(
      makeRow({
        actionType: "add_comparison_table",
        detail: { proposedText: md },
      }),
    );
    expect(html).toContain("Table rows");
    expect(html).toContain("| Scope |");
    expect(html).toContain('data-suggested-copy-tile="table"');
  });
});

describe("SuggestedCopyAct — section tile", () => {
  it.each([["add_section"], ["add_schema"], ["technical_fix"]])(
    "renders a section tile for action type %s",
    (actionType) => {
      const html = render(
        makeRow({
          actionType: actionType as ActionRowType,
          detail: {
            proposedText:
              "Project overview\n\nWe handle survey, design, permitting, and construction.",
          },
        }),
      );
      expect(html).toContain("Suggested text");
      expect(html).toContain('data-suggested-copy-tile="section"');
    },
  );
});

describe("SuggestedCopyAct — plain tile", () => {
  it("renders a plain tile for improve_copy", () => {
    const html = render(
      makeRow({
        actionType: "improve_copy",
        detail: {
          proposedText:
            "Our team coordinates architecture, engineering, and permitting from concept through completion.",
        },
      }),
    );
    expect(html).toContain("Suggested text");
    expect(html).toContain("coordinates");
    expect(html).toContain('data-suggested-copy-tile="plain"');
  });
});

// ─────────────────────────────────────────────────────────────────────
// Before → after comparison
// ─────────────────────────────────────────────────────────────────────

describe("SuggestedCopyAct — before → after", () => {
  it("renders Now + Change to when edit_title has a differing currentText", () => {
    const html = render(
      makeRow({
        actionType: "edit_title",
        detail: {
          currentText: "Old Atherton Builder Title",
          proposedText: "Custom Home Builders in Atherton | Ritz Builders",
        },
      }),
    );
    expect(html).toContain(">Now<");
    expect(html).toContain("Old Atherton Builder Title");
    expect(html).toContain(">Change to<");
    expect(html).toContain("Custom Home Builders in Atherton | Ritz Builders");
    expect(html).toContain('data-suggested-copy-before="true"');
  });

  it("renders Now + Change to for edit_h1 with a differing currentText", () => {
    const html = render(
      makeRow({
        actionType: "edit_h1",
        detail: {
          currentText: "Builder",
          proposedText: "Custom Home Builders in Atherton",
        },
      }),
    );
    expect(html).toContain(">Now<");
    expect(html).toContain("Builder");
    expect(html).toContain(">Change to<");
    expect(html).toContain("Custom Home Builders in Atherton");
  });

  it("renders no Now label when currentText is absent", () => {
    const html = render(
      makeRow({
        actionType: "edit_title",
        detail: {
          currentText: null,
          proposedText: "Custom Home Builders in Atherton | Ritz Builders",
        },
      }),
    );
    expect(html).not.toContain(">Now<");
    expect(html).not.toContain('data-suggested-copy-before="true"');
    expect(html).toContain("Custom Home Builders in Atherton | Ritz Builders");
  });

  it("renders no Now label for an additive type (add_faq) even with currentText", () => {
    const html = render(
      makeRow({
        actionType: "add_faq",
        title: "Who builds modern custom homes in Atherton?",
        detail: {
          currentText: "irrelevant current text",
          proposedText: "Who builds modern custom homes in Atherton?",
          faqAnswerText:
            "Ritz Builders builds modern custom homes in Atherton with an architect-led approach.",
        },
      }),
    );
    expect(html).not.toContain(">Now<");
    expect(html).not.toContain("irrelevant current text");
  });
});

// ─────────────────────────────────────────────────────────────────────
// Suppression
// ─────────────────────────────────────────────────────────────────────

describe("SuggestedCopyAct — suppression returns nothing", () => {
  it.each([["create_page"], ["review_decision"], ["regenerate_edit"]])(
    "renders empty for unsupported action type %s",
    (actionType) => {
      const html = render(
        makeRow({
          actionType: actionType as ActionRowType,
          detail: { proposedText: "anything" },
        }),
      );
      expect(html).toBe("");
    },
  );

  it("renders empty when proposedText is missing for a supported type", () => {
    const html = render(
      makeRow({
        actionType: "edit_h2",
        detail: { proposedText: "" },
      }),
    );
    expect(html).toBe("");
  });
});

// ─────────────────────────────────────────────────────────────────────
// Display-safety fallback
// ─────────────────────────────────────────────────────────────────────

describe("SuggestedCopyAct — display-safety fallback", () => {
  it("renders the calm fallback when proposedText contains a UUID", () => {
    const html = render(
      makeRow({
        actionType: "edit_h2",
        detail: {
          proposedText:
            "H2: Test\n\nDrawn from 7ee3216b-327c-4de9-8d5d-2f4c95a6d773.",
        },
      }),
    );
    expect(html).toContain(
      "Beacon has a draft for this recommendation, but it needs review before showing here.",
    );
    expect(html).toContain('data-suggested-copy-fallback="true"');
    // The actual UUID must not appear in the rendered output.
    expect(html).not.toContain("7ee3216b-327c-4de9-8d5d-2f4c95a6d773");
  });

  it("renders the calm fallback when proposedText contains aiSearchSignal", () => {
    const html = render(
      makeRow({
        actionType: "edit_h2",
        detail: {
          proposedText:
            "H2: Test\n\nSourced from aiSearchSignal data on this prompt.",
        },
      }),
    );
    expect(html).toContain(
      "Beacon has a draft for this recommendation, but it needs review before showing here.",
    );
    expect(html).not.toContain("aiSearchSignal");
  });

  it("renders the calm fallback when proposedText contains actualSearchQueries", () => {
    const html = render(
      makeRow({
        actionType: "edit_meta",
        detail: { proposedText: "Aligned with actualSearchQueries patterns." },
      }),
    );
    expect(html).toContain("Beacon has a draft for this recommendation");
    expect(html).not.toContain("actualSearchQueries");
  });

  it("renders the calm fallback when proposedText contains topSearchQueries", () => {
    const html = render(
      makeRow({
        actionType: "edit_title",
        detail: { proposedText: "Tuned for topSearchQueries patterns." },
      }),
    );
    expect(html).toContain("Beacon has a draft for this recommendation");
    expect(html).not.toContain("topSearchQueries");
  });

  it("renders the calm fallback when a FAQ answer leaks a snake_case identifier", () => {
    const html = render(
      makeRow({
        actionType: "add_faq",
        title: "How long does a custom home take?",
        detail: {
          proposedText: "leaked rec_id text",
          faqAnswerText: "leaked rec_id text in the answer.",
        },
      }),
    );
    expect(html).toContain("Beacon has a draft for this recommendation");
    expect(html).not.toContain("rec_id");
  });
});
