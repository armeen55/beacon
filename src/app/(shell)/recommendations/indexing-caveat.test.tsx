/**
 * #310 (2026-06-14) — indexing-safety caveat render test.
 *
 * Beacon surfaces paste-ready technical directives (robots.txt edits,
 * meta noindex removal, canonical tags, redirects) to non-technical
 * owners on the recommendations v2 card's inline Accept surface.
 * Pasted wrong, any of these can DEINDEX a live site from Google. The
 * card must show a plain-English warning before the owner acts on a
 * crawl/index-affecting directive — and must NOT clutter benign
 * directives (FAQ / schema / copy) with it.
 *
 * Surface collapse (2026-06-15): the legacy drawer (`RowDrawer`) was
 * deleted with the legacy recommendations table; the v2 card is now the
 * only Accept surface, so the drawer-render block was removed.
 *
 * SSR via renderToStaticMarkup against the real exported
 * <RecommendationV2Card>.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { RecommendationV2Card } from "@/components/recommendations/v2/recommendation-v2-card";
import {
  INDEXING_DIRECTIVE_CAVEAT,
  type ActionType,
} from "@/domains/recommendations/action-types";
import type {
  RecommendationActionRow,
  ActionRowType,
} from "@/domains/recommendations/recommendation-action-rows";

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

// v2 surface — the card carries an inline Accept CTA, so the
// caveat must render here too before the owner can act on a crawl/index
// directive. Same exported-helper + renderToStaticMarkup convention.
function renderV2Card(row: RecommendationActionRow): string {
  return renderToStaticMarkup(
    <RecommendationV2Card row={row} onAccept={() => {}} />,
  );
}

// Held-for-review posture: an armed site would pass onAcceptAndPublish (one-click
// live publish). An indexing directive must SUPPRESS even that.
function renderV2CardArmed(row: RecommendationActionRow): string {
  return renderToStaticMarkup(
    <RecommendationV2Card row={row} onAccept={() => {}} onAcceptAndPublish={() => {}} />,
  );
}

function indexingRow(editActionType: ActionType): RecommendationActionRow {
  return makeRow({
    editActionType,
    actionType: "review_decision",
    title: "Remove the noindex tag from the Homepage",
    proposedText: 'Remove "noindex" from the robots meta tag on https://example.com/.',
  });
}

// ── Tests ────────────────────────────────────────────────────────────────

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

describe("held-for-review posture — an indexing directive is NEVER a one-tap change", () => {
  const INDEXING: ActionType[] = ["fix_noindex", "fix_robots", "fix_canonical", "fix_status_code"];

  for (const t of INDEXING) {
    it(`${t}: suppresses the one-tap Accept CTA even when onAccept is wired`, () => {
      const html = renderV2Card(indexingRow(t));
      // The one-tap Accept button must NOT render for an indexing directive.
      expect(html).not.toContain('data-recommendation-v2-cta="accept"');
      // The review link IS present, so the owner is routed to the confirm surface.
      expect(html).toContain('data-recommendation-v2-cta="review"');
      expect(html).toContain("Review");
    });

    it(`${t}: suppresses one-click Accept & publish even when the site is armed`, () => {
      const html = renderV2CardArmed(indexingRow(t));
      // Neither the armed publish button nor the staged accept button may render.
      expect(html).not.toContain('data-recommendation-v2-cta="accept-and-publish"');
      expect(html).not.toContain('data-recommendation-v2-cta="accept"');
      // The hold notice still renders.
      expect(html).toContain(INDEXING_DIRECTIVE_CAVEAT);
    });
  }

  it("CONTROL: a benign directive with onAccept DOES render the one-tap Accept CTA", () => {
    const html = renderV2Card(
      makeRow({
        editActionType: "add_faq",
        actionType: "add_faq",
        title: "Add an FAQ to the Homepage",
        proposedText: "What areas do you serve? We serve the whole region.",
      }),
    );
    expect(html).toContain('data-recommendation-v2-cta="accept"');
  });

  it("CONTROL: a benign directive on an armed site DOES render Accept & publish", () => {
    const html = renderV2CardArmed(
      makeRow({
        editActionType: "add_faq",
        actionType: "add_faq",
        title: "Add an FAQ to the Homepage",
        proposedText: "What areas do you serve? We serve the whole region.",
      }),
    );
    expect(html).toContain('data-recommendation-v2-cta="accept-and-publish"');
  });
});
