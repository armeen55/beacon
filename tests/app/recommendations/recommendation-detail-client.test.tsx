/**
 * Bundle 2B — RecommendationDetailClient render tests.
 *
 * Pin the 5-act narrative contract + the customer-vocabulary contract.
 * Server actions are NOT exercised here; the brief is read-only this
 * pass.
 */

import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// Bundle 2C (2026-05-11) — the brief page's Act 5 now embeds
// RecommendationDetailActions, a client component that calls
// `useRouter()` from `next/navigation`. Stub the hook so this server-
// rendered test doesn't hit the "invariant expected app router to be
// mounted" assertion.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {} }),
}));

import { RecommendationDetailClient } from "@/app/(shell)/recommendations/[id]/recommendation-detail-client";
import { RecommendationDetailNotFound } from "@/app/(shell)/recommendations/[id]/recommendation-detail-not-found";
import type { RecommendationActionRow } from "@/domains/recommendations/recommendation-action-rows";

function makeRow(
  overrides: Partial<RecommendationActionRow> = {},
): RecommendationActionRow {
  return {
    id: "rec-fixture-1__edit-1",
    rank: 1,
    title: "Add an FAQ section about modern home builders in Atherton",
    targetLabel: "Modern Home Builder Atherton page",
    targetUrl: "https://ritzbuilders.com/services/modern-home-builder-atherton",
    actionType: "add_faq",
    priority: "high",
    status: "new",
    evidenceSummary: "AI cites Greenberg on 4 of 7 prompts; Ritz absent.",
    sourceRecommendationId: "rec-fixture-1",
    sourceEditId: "edit-1",
    editSource: "openai",
    derivedConfidence: "strong_evidence",
    hasExactEdit: true,
    responseStatus: null,
    acceptedAgeDays: 0,
    deferUntil: null,
    eligibleEditCount: 1,
    detail: {
      currentText: null,
      proposedText: "Q: What is a modern home builder…",
      why: "Modern-home-builder framing is missing on the current page.",
      measurementPlan:
        "Track citation rate on Atherton modern-home prompts for 14 days.",
      evidenceRefs: [
        { type: "prompt", promptId: "p-1" },
        { type: "prompt", promptId: "p-2" },
        { type: "prompt", promptId: "p-3" },
        // 4th — should be ignored (cap is 3)
        { type: "prompt", promptId: "p-4" },
      ] as unknown as RecommendationActionRow["detail"]["evidenceRefs"],
      fullReasoning: null,
      confidenceReason: null,
      motiveLabel: null,
      pageBrief: null,
      suggestedEdits: [],
      risks: [],
      cannibalization: null,
      topCompetitor: { name: "Greenberg Construction", primaryPct: 0.57 },
      affectedPromptCount: 3,
      observationCount: 7,
      evidenceDepth: 5,
      derivedConfidence: "strong_evidence",
      faqAnswerText: null,
      debug: {
        recommendationId: "rec-fixture-1",
        editId: "edit-1",
        pairedAnswerEditId: null,
        resolverTier: null,
        resolutionAction: null,
        motive: null,
        engineConfidence: { confidence: "high", reasons: [] },
        evidenceHash: "deadbeef",
        editLifecycleStatus: "recommended",
        prioritizerTier: "now",
        prioritizerScore: 12,
      },
    },
    ...overrides,
  } as RecommendationActionRow;
}

const promptTextById: Record<string, string> = {
  "p-1": "best modern home builder atherton",
  "p-2": "modern home builder bay area",
  "p-3": "luxury home renovation atherton",
  "p-4": "fourth-prompt-text-should-not-render",
};

function render(
  row: RecommendationActionRow,
  changelogId: string | null = null,
): string {
  return renderToStaticMarkup(
    <RecommendationDetailClient
      row={row}
      changelogId={changelogId}
      promptTextById={promptTextById}
    />,
  );
}

describe("Bundle 2B — RecommendationDetailClient", () => {
  it("renders the v2 brief layout marker", () => {
    const html = render(makeRow());
    expect(html).toContain('data-recommendations-detail-layout="v2-brief"');
  });

  it("renders the back link and the page header", () => {
    const html = render(makeRow());
    expect(html).toContain('data-recommendations-detail-back="true"');
    expect(html).toContain("← Recommendations");
    expect(html).toContain('data-recommendation-detail-header="true"');
    expect(html).toContain('data-recommendation-detail-title="true"');
    expect(html).toContain(
      "Add an FAQ section about modern home builders in Atherton",
    );
  });

  it("renders all 5 acts with stable data attributes", () => {
    const html = render(makeRow());
    expect(html).toContain('data-recommendation-detail-act="act-recommendation"');
    expect(html).toContain('data-recommendation-detail-act="act-why"');
    expect(html).toContain('data-recommendation-detail-act="act-evidence"');
    expect(html).toContain('data-recommendation-detail-act="act-measurement"');
    expect(html).toContain('data-recommendation-detail-act="act-next"');
    // Ordered: 1 → 5
    for (let i = 1; i <= 5; i++) {
      expect(html).toContain(`data-recommendation-detail-act-index="${i}"`);
    }
  });

  it("renders the operator-friendly status pill ('Suggested' for status=new)", () => {
    const html = render(makeRow());
    expect(html).toContain('data-recommendation-detail-status-pill="true"');
    expect(html).toContain("Suggested");
  });

  it("renders 'High confidence' for derivedConfidence=strong_evidence", () => {
    const html = render(makeRow());
    expect(html).toContain(
      'data-recommendation-detail-confidence="strong_evidence"',
    );
    expect(html).toContain("High confidence");
  });

  it("renders evidence tiles for prompts / AI answers / competitor", () => {
    const html = render(makeRow());
    expect(html).toContain(
      'data-recommendation-detail-evidence-tile="prompts"',
    );
    expect(html).toContain(
      'data-recommendation-detail-evidence-tile="ai-answers"',
    );
    expect(html).toContain(
      'data-recommendation-detail-evidence-tile="competitor"',
    );
    expect(html).toContain(
      'data-recommendation-detail-evidence-tile="depth"',
    );
  });

  it("renders up to 3 affected prompt-text snippets (caps at 3)", () => {
    const html = render(makeRow());
    expect(html).toContain('data-recommendation-detail-prompt-snippets="true"');
    expect(html).toContain("best modern home builder atherton");
    expect(html).toContain("modern home builder bay area");
    expect(html).toContain("luxury home renovation atherton");
    // 4th prompt text must NOT appear.
    expect(html).not.toContain("fourth-prompt-text-should-not-render");
  });

  it("renders the measurement plan when one exists", () => {
    const html = render(makeRow());
    expect(html).toContain('data-recommendation-detail-measurement="true"');
    expect(html).toContain(
      "Track citation rate on Atherton modern-home prompts for 14 days.",
    );
  });

  it("renders the legacy-review CTA + back-to-list, but NOT the open-change CTA when changelogId is null", () => {
    const html = render(makeRow(), null);
    expect(html).toContain('data-recommendation-detail-cta="legacy-review"');
    expect(html).toContain("Open legacy review →");
    expect(html).toContain('data-recommendation-detail-cta="back-to-list"');
    expect(html).not.toContain('data-recommendation-detail-cta="open-change"');
  });

  it("renders the open-change CTA when a changelogId is supplied", () => {
    const html = render(makeRow(), "change-abc-123");
    expect(html).toContain('data-recommendation-detail-cta="open-change"');
    expect(html).toContain("/changes/change-abc-123");
  });

  it("legacy CTA uses encodeURIComponent on the source recommendation id", () => {
    const html = render(
      makeRow({
        sourceRecommendationId:
          "create_cluster_page:geo:Los Altos__add_faq__faq_question[new]:abc",
      }),
    );
    // The legacy anchor has its own encoding contract (#rec-<id>); pin
    // that we encode (so unsafe characters don't break the URL hash).
    expect(html).toContain(
      "#rec-create_cluster_page%3Ageo%3ALos%20Altos__add_faq__faq_question%5Bnew%5D%3Aabc",
    );
  });

  it("renders the empty-evidence calm message when no signals are present", () => {
    const html = render(
      makeRow({
        detail: {
          ...makeRow().detail,
          affectedPromptCount: 0,
          observationCount: 0,
          topCompetitor: null,
          evidenceDepth: 0,
          evidenceRefs: [] as RecommendationActionRow["detail"]["evidenceRefs"],
        },
      }),
    );
    expect(html).toContain('data-recommendation-detail-evidence-empty="true"');
    expect(html).toContain("No specific grounding signals are available");
  });

  it("renders the calm 'needs more evidence' message in Act 2 when confidence is needs_review", () => {
    const html = render(
      makeRow({
        derivedConfidence: "needs_review",
      }),
    );
    expect(html).toContain('data-recommendation-detail-confidence="needs_review"');
    expect(html).toContain("Needs more evidence");
    expect(html).toContain(
      "Beacon needs more evidence before this should be shipped",
    );
  });

  it("Act 4 mentions 'Beacon is watching impact' for accepted/measuring/shipped", () => {
    for (const status of ["accepted", "measuring", "shipped"] as const) {
      const html = render(makeRow({ status }));
      expect(
        html,
        `'Beacon is watching impact' must render for status=${status}`,
      ).toContain("Beacon is watching impact");
    }
  });

  it("Act 4 does NOT add 'watching impact' for new / needs_review", () => {
    for (const status of ["new", "needs_review"] as const) {
      const html = render(makeRow({ status }));
      expect(
        html,
        `'watching impact' must NOT render for status=${status}`,
      ).not.toContain("Beacon is watching impact");
    }
  });

  it("never renders raw schema fields, IDs, or hashes", () => {
    const html = render(makeRow(), "change-abc");
    expect(html).not.toContain("deadbeef");
    expect(html).not.toContain("evidence_hash");
    expect(html).not.toContain("resolver_tier");
    expect(html).not.toContain("rec_id");
    expect(html).not.toContain("stableKey");
    expect(html).not.toContain("Z-score");
  });
});

describe("Bundle 2B — RecommendationDetailNotFound", () => {
  it("renders the customer-safe not-found state with a back-to-list CTA", () => {
    const html = renderToStaticMarkup(<RecommendationDetailNotFound />);
    expect(html).toContain('data-recommendations-detail-not-found="true"');
    // 2026-05-13 P0 follow-up — copy updated from "no longer active"
    // (which read as a scary dead end) to "was replaced or already
    // handled" with a subline pointing to the current set. The
    // four-step resolver in resolveRecommendationDetail covers the
    // stale-URL case automatically; the not-found state now only
    // renders when no fallback exists, and the copy reflects that.
    expect(html).toContain(
      "This recommendation was replaced or already handled.",
    );
    expect(html).toContain(
      "The latest set of recommendations is on the main page.",
    );
    expect(html).toContain('data-recommendations-detail-back-cta="true"');
    expect(html).toContain("Back to recommendations →");
  });

  it("renders an action-type hint when one can be parsed from the URL", () => {
    const html = renderToStaticMarkup(
      <RecommendationDetailNotFound
        hint={{
          stableKey: "create_cluster_page:geo:Palo Alto",
          editId:
            "create_cluster_page:geo:Palo Alto__add_h2_section__h2[new]:abc",
          actionType: "add_h2_section",
        }}
      />,
    );
    expect(html).toContain(
      'data-recommendations-detail-not-found-hint="true"',
    );
    // The hint surfaces the action type's operator label in lowercase.
    expect(html.toLowerCase()).toContain("add h2 section");
    expect(html).toContain("Open the recommendations list");
  });

  it("omits the action-type hint when the URL is unparseable", () => {
    const html = renderToStaticMarkup(
      <RecommendationDetailNotFound
        hint={{ stableKey: null, editId: null, actionType: null }}
      />,
    );
    expect(html).not.toContain(
      'data-recommendations-detail-not-found-hint="true"',
    );
  });

  it("never leaks operator vocabulary in the not-found state", () => {
    const html = renderToStaticMarkup(<RecommendationDetailNotFound />);
    expect(html).not.toContain("Z-score");
    expect(html).not.toContain("evidence_hash");
    expect(html).not.toContain("resolver_tier");
    expect(html).not.toContain("scheduled poll");
    expect(html).not.toContain("decision queue");
  });
});
