/**
 * Page Opportunity Brief (2026-06-17) — per-page synthesis.
 *
 * Verifies the brief composes atomic rec rows + a cross-source evidence receipt
 * into: an edit-vs-create decision, atomic changes (actionable first), honest
 * pushability/confidence/before-after inherited from the QA verdict, and a
 * plain-English summary. Iranopedia-shaped fixtures ONLY in the test; no
 * hardcoding in the module.
 */

import { describe, it, expect } from "vitest";

import {
  buildPageOpportunityBrief,
  type BriefEvidenceReceipt,
} from "@/domains/recommendations/page-opportunity-brief";
import type { RecommendationActionRow } from "@/domains/recommendations/recommendation-action-rows";
import type { RecQaVerdict } from "@/domains/recommendations/recommendation-qa";

function verdict(over: Partial<RecQaVerdict> = {}): RecQaVerdict {
  return {
    intentFit: null,
    confidence: "high",
    approve: true,
    whyExists: "The page has demand worth capturing.",
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
  actionType?: RecommendationActionRow["actionType"];
  title?: string;
  currentText?: string | null;
  proposedText?: string | null;
  measurementPlan?: string | null;
  qaVerdict?: RecQaVerdict;
}): RecommendationActionRow {
  return {
    actionType: o.actionType ?? "edit_title",
    title: o.title ?? "Rewrite the title",
    targetUrl: "https://iranopedia.com/persian-last-names",
    detail: {
      currentText: o.currentText ?? null,
      proposedText: o.proposedText ?? null,
      measurementPlan: o.measurementPlan ?? null,
      why: "why",
      qaVerdict: o.qaVerdict ?? verdict(),
    },
  } as unknown as RecommendationActionRow;
}

const RECEIPT: BriefEvidenceReceipt = {
  gsc: { impressions90d: 8465, clicks90d: 90, position90d: 3.4, topQuery: "persian last names" },
  clarity: { sessions: 540, frictionRate: 0.22 },
  ga4: null,
  aiAnswers: { observations: 0 },
};

describe("buildPageOpportunityBrief", () => {
  it("edit_existing: leads with the actionable change, sorts actionable first", () => {
    const brief = buildPageOpportunityBrief({
      url: "https://iranopedia.com/persian-last-names",
      pageLabel: "Persian Last Names",
      evidence: RECEIPT,
      rows: [
        // a capped, non-actionable schema rec…
        row({
          actionType: "add_schema",
          title: "Add Article schema",
          qaVerdict: verdict({ confidence: "needs_more_evidence", approve: false, pushReadiness: "paste_ready" }),
        }),
        // …and a confident, actionable title rec
        row({
          actionType: "edit_title",
          title: "Rewrite the title to lead with “persian last names”",
          currentText: "Names",
          proposedText: "Persian Last Names | Iranopedia",
          measurementPlan: "Beacon re-checks this page in Google Search after it ships.",
          qaVerdict: verdict({ confidence: "high", approve: true }),
        }),
      ],
    });
    expect(brief.decision).toBe("edit_existing");
    expect(brief.actionableCount).toBe(1);
    // actionable change sorts first
    expect(brief.atomicChanges[0]!.actionable).toBe(true);
    expect(brief.atomicChanges[0]!.kind).toBe("edit_title");
    expect(brief.atomicChanges[0]!.before).toBe("Names");
    expect(brief.atomicChanges[0]!.after).toBe("Persian Last Names | Iranopedia");
    expect(brief.atomicChanges[0]!.pushability).toBe("Paste-ready");
    // the capped one is present but last + not actionable + carries its risk
    expect(brief.atomicChanges[1]!.actionable).toBe(false);
    expect(brief.atomicChanges[1]!.risk).toBeTruthy();
    expect(brief.summary).toContain("Rewrite the title");
    expect(brief.evidence.gsc?.impressions90d).toBe(8465);
  });

  it("create_new: only a create-page rec → create decision", () => {
    const brief = buildPageOpportunityBrief({
      url: "needs_new_page",
      pageLabel: "Persian Holidays",
      rows: [row({ actionType: "create_page", title: "Create a Persian Holidays page", qaVerdict: verdict() })],
    });
    expect(brief.decision).toBe("create_new");
    expect(brief.summary).toMatch(/create a new page/i);
  });

  it("leave_as_is: page has signal but nothing clears the bar", () => {
    const brief = buildPageOpportunityBrief({
      url: "https://iranopedia.com/cities",
      pageLabel: "Cities",
      evidence: RECEIPT,
      rows: [
        row({ qaVerdict: verdict({ confidence: "rejected", approve: false }) }),
        row({ actionType: "edit_meta", qaVerdict: verdict({ confidence: "needs_more_evidence", approve: false }) }),
      ],
    });
    expect(brief.decision).toBe("leave_as_is");
    expect(brief.actionableCount).toBe(0);
    expect(brief.summary).toMatch(/hold|nothing confidently/i);
  });

  it("honest pushability flows from the QA verdict (review_only → Not publishable)", () => {
    const brief = buildPageOpportunityBrief({
      url: "https://iranopedia.com/x",
      pageLabel: "X",
      rows: [
        row({
          actionType: "technical_fix",
          qaVerdict: verdict({ pushReadiness: "review_only" }),
        }),
      ],
    });
    expect(brief.atomicChanges[0]!.pushability).toBe("Not publishable");
  });

  it("never emits an AI-citation claim it wasn't given (hypothesis is grounded)", () => {
    const brief = buildPageOpportunityBrief({
      url: "https://iranopedia.com/x",
      pageLabel: "X",
      evidence: RECEIPT,
      rows: [row({ qaVerdict: verdict({ whyMatchValid: "GSC shows demand for this query." }) })],
    });
    expect(brief.atomicChanges[0]!.hypothesis).toBe("GSC shows demand for this query.");
    expect(brief.atomicChanges[0]!.hypothesis).not.toMatch(/AI answers? (?:will )?cite/i);
  });
});
