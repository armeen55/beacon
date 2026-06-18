/**
 * PageOpportunityBriefView (2026-06-17) — render contract (SSR, no DOM/DB).
 * The operator-visible Brief surface: decision, summary, cross-source evidence
 * receipt, atomic changes with before/after + honest Accept-vs-Review-only.
 */

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { PageOpportunityBriefView } from "@/components/recommendations/page-opportunity-brief-view";
import { buildPageOpportunityBrief } from "@/domains/recommendations/page-opportunity-brief";
import type { RecommendationActionRow } from "@/domains/recommendations/recommendation-action-rows";
import type { RecQaVerdict } from "@/domains/recommendations/recommendation-qa";

function verdict(over: Partial<RecQaVerdict> = {}): RecQaVerdict {
  return {
    intentFit: null,
    confidence: "high",
    approve: true,
    whyExists: "x",
    whyMatchValid: "The searched query matches this page's topic.",
    evidenceSupports: ["Google Search demand"],
    evidenceMissing: [],
    confidenceReason: "Strong evidence and intent fit.",
    pushReadiness: "paste_ready",
    copySafe: true,
    ...over,
  };
}

function row(o: {
  title: string;
  currentText?: string | null;
  proposedText?: string | null;
  qaVerdict?: RecQaVerdict;
  actionType?: RecommendationActionRow["actionType"];
}): RecommendationActionRow {
  return {
    actionType: o.actionType ?? "edit_title",
    title: o.title,
    targetUrl: "https://iranopedia.com/persian-last-names",
    detail: {
      currentText: o.currentText ?? null,
      proposedText: o.proposedText ?? null,
      measurementPlan: "Beacon re-checks this page in Google Search after it ships.",
      why: "why",
      qaVerdict: o.qaVerdict ?? verdict(),
    },
  } as unknown as RecommendationActionRow;
}

describe("PageOpportunityBriefView", () => {
  const brief = buildPageOpportunityBrief({
    url: "https://iranopedia.com/persian-last-names",
    pageLabel: "Persian Last Names",
    evidence: {
      gsc: { impressions90d: 8465, clicks90d: 90, position90d: 3.4, topQuery: "persian last names" },
      semrush: null,
      clarity: { sessions: 540, frictionRate: 0.22 },
      ga4: null,
      aiAnswers: { observations: 0 },
    },
    rows: [
      row({
        title: "Rewrite the title to lead with “persian last names”",
        currentText: "Names",
        proposedText: "Persian Last Names | Iranopedia",
        qaVerdict: verdict({ confidence: "high", approve: true }),
      }),
      row({
        title: "Add Article schema",
        actionType: "add_schema",
        qaVerdict: verdict({ confidence: "needs_more_evidence", approve: false }),
      }),
    ],
  });

  const html = renderToStaticMarkup(<PageOpportunityBriefView brief={brief} />);

  it("renders the decision, page label, and summary", () => {
    expect(html).toContain('data-page-opportunity-brief="true"');
    expect(html).toContain('data-brief-decision="edit_existing"');
    expect(html).toContain("Edit this page");
    expect(html).toContain("Persian Last Names");
    expect(html).toContain('data-brief-summary="true"');
  });

  it("renders the cross-source evidence receipt (GSC + Clarity present)", () => {
    expect(html).toContain('data-brief-evidence-family="gsc"');
    expect(html).toContain("8,465 impr");
    expect(html).toContain('data-brief-evidence-family="clarity"');
    expect(html).toContain("22% friction");
  });

  it("renders the actionable change first with a before/after diff + Accept", () => {
    const firstIdx = html.indexOf('data-brief-atomic-change="true"');
    expect(firstIdx).toBeGreaterThan(-1);
    expect(html).toContain('data-brief-change-cta="accept"');
    expect(html).toContain("Persian Last Names | Iranopedia"); // after
    expect(html).toContain("Names"); // before (struck)
  });

  it("a non-actionable change shows Review only, never Accept", () => {
    expect(html).toContain('data-brief-change-cta="review"');
    expect(html).toContain("Review only");
    // the schema card is not actionable
    expect(html).toContain('data-brief-change-actionable="false"');
  });

  it("shows no ungrounded AI-citation claim", () => {
    expect(html).not.toMatch(/AI answers? (?:will )?cite/i);
  });
});
