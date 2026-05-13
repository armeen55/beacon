/**
 * Recommendation Execution Layer v1 Phase A (2026-05-13) — act-order
 * invariant. Pins the visible act numbering on /recommendations/[id]:
 *
 *   Act 1 — Recommendation
 *   Act 2 — Why this matters
 *   Act 3 — Evidence
 *   Act 4 — Suggested copy   (only when copy is rendered)
 *   Act 4 / 5 — How Beacon will measure it   (5 when copy renders, 4 otherwise)
 *   Act 5 / 6 — What to do next               (6 when copy renders, 5 otherwise)
 *
 * The visible numbering MUST be sequential. There is no scenario where
 * the rendered output skips an act number.
 */

import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {} }),
}));

import { RecommendationDetailClient } from "@/app/(shell)/recommendations/[id]/recommendation-detail-client";
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
    title: "Add an FAQ section about modern home builders",
    targetLabel: "Atherton page",
    targetUrl: "https://example.com/services/modern-home-builder-atherton",
    actionType: "add_faq",
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
      proposedText: "Who builds modern custom homes in Atherton?",
      faqAnswerText:
        "Ritz Builders builds modern custom homes in Atherton with an architect-led approach.",
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

function renderDetail(row: RecommendationActionRow): string {
  return renderToStaticMarkup(
    <RecommendationDetailClient
      row={row}
      changelogId={null}
      promptTextById={{}}
    />,
  );
}

/** Extract the ordered list of `data-recommendation-detail-act` values
 *  from the rendered markup. */
function extractActOrder(html: string): string[] {
  const out: string[] = [];
  const re = /data-recommendation-detail-act="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    out.push(m[1]);
  }
  return out;
}

/** Extract `data-recommendation-detail-act-index` values in document order. */
function extractActIndices(html: string): number[] {
  const out: number[] = [];
  const re = /data-recommendation-detail-act-index="(\d+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    out.push(Number(m[1]));
  }
  return out;
}

describe("/recommendations/[id] — act order with Suggested Copy rendered", () => {
  const row = makeRow();
  const html = renderDetail(row);

  it("renders six acts in the required order", () => {
    expect(extractActOrder(html)).toEqual([
      "act-recommendation",
      "act-why",
      "act-evidence",
      "act-suggested-copy",
      "act-measurement",
      "act-next",
    ]);
  });

  it("numbers acts sequentially 1, 2, 3, 4, 5, 6", () => {
    expect(extractActIndices(html)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("includes a literal 'Act 4' label adjacent to the Suggested copy heading", () => {
    expect(html).toContain("Suggested copy");
    expect(html).toMatch(/Act 4[\s\S]{0,400}Suggested copy/);
  });
});

describe("/recommendations/[id] — act order when Suggested Copy is suppressed", () => {
  // create_page is not in the supported-copy list, so SuggestedCopyAct
  // returns null. The remaining five acts must keep sequential numbers
  // 1, 2, 3, 4, 5 — NOT 1, 2, 3, 5, 6.
  const row = makeRow({
    actionType: "create_page" as ActionRowType,
    detail: { proposedText: "irrelevant" },
  });
  const html = renderDetail(row);

  it("renders five acts in the expected order without the Suggested copy slot", () => {
    expect(extractActOrder(html)).toEqual([
      "act-recommendation",
      "act-why",
      "act-evidence",
      "act-measurement",
      "act-next",
    ]);
  });

  it("numbers acts sequentially 1, 2, 3, 4, 5 (no skipped numbers)", () => {
    expect(extractActIndices(html)).toEqual([1, 2, 3, 4, 5]);
  });

  it("the visible 'Act 6' label is absent when only five acts render", () => {
    expect(html).not.toMatch(/Act 6/);
  });
});

describe("/recommendations/[id] — act order when display guard suppresses the copy", () => {
  // A supported action type whose proposedText fails the display guard
  // still renders Act 4 — but with the fallback message instead of the
  // copy. Numbering stays 1..6.
  const row = makeRow({
    actionType: "edit_h2",
    detail: {
      proposedText:
        "H2: Test\n\nDrawn from 7ee3216b-327c-4de9-8d5d-2f4c95a6d773.",
    },
  });
  const html = renderDetail(row);

  it("still renders Act 4 (fallback) and numbers 1..6 sequentially", () => {
    expect(extractActOrder(html)).toEqual([
      "act-recommendation",
      "act-why",
      "act-evidence",
      "act-suggested-copy",
      "act-measurement",
      "act-next",
    ]);
    expect(extractActIndices(html)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("the fallback message is visible and the UUID is not", () => {
    expect(html).toContain(
      "Beacon has a draft for this recommendation, but it needs review before showing here.",
    );
    expect(html).not.toContain("7ee3216b-327c-4de9-8d5d-2f4c95a6d773");
  });
});
