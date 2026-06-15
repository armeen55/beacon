/**
 * #310 (2026-06-14) — indexing-safety caveat render test.
 *
 * Beacon surfaces paste-ready technical directives (robots.txt edits,
 * meta noindex removal, canonical tags, redirects) to non-technical
 * owners in the recommendations drawer's "Exact recommended change"
 * section. Pasted wrong, any of these can DEINDEX a live site from
 * Google. The drawer must show a plain-English warning before the
 * owner acts on a crawl/index-affecting directive — and must NOT
 * clutter benign directives (FAQ / schema / copy) with it.
 *
 * SSR via renderToStaticMarkup against the real exported <RowDrawer>.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { RowDrawer } from "./recommendations-client";
import { RecommendationV2Card } from "@/components/recommendations/v2/recommendation-v2-card";
import {
  INDEXING_DIRECTIVE_CAVEAT,
  type ActionType,
} from "@/domains/recommendations/action-types";
import type {
  RecommendationActionRow,
  ActionRowType,
} from "@/domains/recommendations/recommendation-action-rows";
import type { RecommendationActionResponse } from "./actions";

// ── Fixture ────────────────────────────────────────────────────────────────

function makeRow(args: {
  editActionType: ActionType;
  actionType: ActionRowType;
  proposedText: string;
  title: string;
}): RecommendationActionRow {
  return {
    id: "rec-1::edit-1",
    rank: 1,
    title: args.title,
    targetLabel: "Homepage",
    targetUrl: "https://example.com/",
    actionType: args.actionType,
    priority: "high",
    status: "new",
    evidenceSummary: "5 AI answers; your site isn't cited yet.",
    sourceRecommendationId: "rec-1",
    sourceEditId: "edit-1",
    editSource: "deterministic",
    engineConfidence: "high",
    derivedConfidence: "strong_evidence",
    hasExactEdit: true,
    responseStatus: null,
    acceptedAgeDays: 0,
    deferUntil: null,
    eligibleEditCount: 1,
    detail: {
      currentText: null,
      proposedText: args.proposedText,
      why: "Beacon found this while scanning your site.",
      measurementPlan: "Beacon re-checks the page after the change.",
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
      observationCount: 5,
      gscEvidenceLines: [],
      semrushEvidenceLines: [],
      clarityEvidenceLines: [],
      aeoEvidenceLines: [],
      evidenceDepth: 1,
      derivedConfidence: "strong_evidence",
      faqAnswerText: null,
      editActionType: args.editActionType,
      debug: {
        recommendationId: "rec-1",
        editId: "edit-1",
        pairedAnswerEditId: null,
        resolverTier: null,
        resolutionAction: null,
        motive: null,
        engineConfidence: { confidence: "high", reasons: [] },
        evidenceHash: null,
        editLifecycleStatus: "recommended",
        prioritizerTier: null,
        prioritizerScore: null,
      },
    },
  };
}

function renderDrawer(row: RecommendationActionRow): string {
  return renderToStaticMarkup(
    <RowDrawer
      row={row}
      promptTextById={{}}
      showFeedback={false}
      feedback={null}
      pending={false}
      handle={(
        _action: () => Promise<RecommendationActionResponse>,
        _successMsg: string,
      ) => {
        // No-op: the drawer never invokes `handle` during SSR.
      }}
    />,
  );
}

// v2 surface (?v2=1) — the card carries an inline Accept CTA, so the
// caveat must render here too before the owner can act on a crawl/index
// directive. Same exported-helper + renderToStaticMarkup convention.
function renderV2Card(row: RecommendationActionRow): string {
  return renderToStaticMarkup(
    <RecommendationV2Card row={row} onAccept={() => {}} />,
  );
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("#310 — indexing-safety caveat in the directive drawer", () => {
  it("renders the caveat for a meta-robots noindex directive", () => {
    const html = renderDrawer(
      makeRow({
        editActionType: "fix_noindex",
        actionType: "review_decision",
        title: "Remove the noindex tag from the Homepage",
        proposedText:
          'Remove "noindex" from the robots meta tag on https://example.com/.',
      }),
    );
    expect(html).toContain(INDEXING_DIRECTIVE_CAVEAT);
    expect(html).toContain("data-rec-indexing-caveat");
  });

  it("renders the caveat for a robots.txt directive", () => {
    const html = renderDrawer(
      makeRow({
        editActionType: "fix_robots",
        actionType: "review_decision",
        title: "Unblock Google from crawling this site",
        proposedText:
          'robots.txt currently blocks Googlebot. Remove the Disallow rules.',
      }),
    );
    expect(html).toContain(INDEXING_DIRECTIVE_CAVEAT);
  });

  it("renders the caveat for a canonical-tag directive", () => {
    const html = renderDrawer(
      makeRow({
        editActionType: "fix_canonical",
        actionType: "review_decision",
        title: "Point this page's canonical tag at itself",
        proposedText:
          'Set the canonical link to <link rel="canonical" href="https://example.com/">.',
      }),
    );
    expect(html).toContain(INDEXING_DIRECTIVE_CAVEAT);
  });

  it("renders the caveat for a status-code / redirect directive", () => {
    const html = renderDrawer(
      makeRow({
        editActionType: "fix_status_code",
        actionType: "review_decision",
        title: "Fix the 404 error on this page",
        proposedText:
          "https://example.com/ returns HTTP 404. Restore the page (or 301-redirect it).",
      }),
    );
    expect(html).toContain(INDEXING_DIRECTIVE_CAVEAT);
  });

  it("does NOT render the caveat for a benign add_faq directive", () => {
    const html = renderDrawer(
      makeRow({
        editActionType: "add_faq",
        actionType: "add_faq",
        title: "Add an FAQ to the Homepage",
        proposedText: "What areas do you serve? We serve the whole region.",
      }),
    );
    // Directive is still shown…
    expect(html).toContain("What areas do you serve?");
    // …but no deindex warning on a harmless content edit.
    expect(html).not.toContain(INDEXING_DIRECTIVE_CAVEAT);
    expect(html).not.toContain("data-rec-indexing-caveat");
  });

  it("does NOT render the caveat for a benign add_schema directive", () => {
    const html = renderDrawer(
      makeRow({
        editActionType: "add_schema",
        actionType: "add_schema",
        title: "Add schema to the Homepage",
        proposedText:
          '<script type="application/ld+json">{"@type":"Article"}</script>',
      }),
    );
    expect(html).not.toContain(INDEXING_DIRECTIVE_CAVEAT);
  });
});

describe("#310 — indexing-safety caveat on the v2 card surface (?v2=1)", () => {
  it("renders the caveat for a meta-robots noindex directive", () => {
    const html = renderV2Card(
      makeRow({
        editActionType: "fix_noindex",
        // Indexability fixes collapse to the review_decision row type;
        // the raw editActionType drives the caveat, not the row type.
        actionType: "review_decision",
        title: "Remove the noindex tag from the Homepage",
        proposedText:
          'Remove "noindex" from the robots meta tag on https://example.com/.',
      }),
    );
    expect(html).toContain(INDEXING_DIRECTIVE_CAVEAT);
    expect(html).toContain("data-recommendation-v2-indexing-caveat");
  });

  it("renders the caveat for a robots.txt directive", () => {
    const html = renderV2Card(
      makeRow({
        editActionType: "fix_robots",
        actionType: "review_decision",
        title: "Unblock Google from crawling this site",
        proposedText:
          "robots.txt currently blocks Googlebot. Remove the Disallow rules.",
      }),
    );
    expect(html).toContain(INDEXING_DIRECTIVE_CAVEAT);
  });

  it("renders the caveat for a canonical-tag directive", () => {
    const html = renderV2Card(
      makeRow({
        editActionType: "fix_canonical",
        actionType: "review_decision",
        title: "Point this page's canonical tag at itself",
        proposedText:
          'Set the canonical link to <link rel="canonical" href="https://example.com/">.',
      }),
    );
    expect(html).toContain(INDEXING_DIRECTIVE_CAVEAT);
  });

  it("renders the caveat for a status-code / redirect directive", () => {
    const html = renderV2Card(
      makeRow({
        editActionType: "fix_status_code",
        actionType: "review_decision",
        title: "Fix the 404 error on this page",
        proposedText:
          "https://example.com/ returns HTTP 404. Restore the page (or 301-redirect it).",
      }),
    );
    expect(html).toContain(INDEXING_DIRECTIVE_CAVEAT);
  });

  it("does NOT render the caveat for a benign add_faq card", () => {
    const html = renderV2Card(
      makeRow({
        editActionType: "add_faq",
        actionType: "add_faq",
        title: "Add an FAQ to the Homepage",
        proposedText: "What areas do you serve? We serve the whole region.",
      }),
    );
    expect(html).not.toContain(INDEXING_DIRECTIVE_CAVEAT);
    expect(html).not.toContain("data-recommendation-v2-indexing-caveat");
  });
});
