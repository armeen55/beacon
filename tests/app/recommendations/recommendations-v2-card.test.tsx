/**
 * Bundle 2A — RecommendationV2Card render tests.
 *
 * Pure render assertions over crafted `RecommendationActionRow` fixtures.
 * Pin the customer-vocabulary contract: no raw IDs, hashes, resolver
 * tiers, evidence_tier labels, or score numbers in the rendered output.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { RecommendationV2Card, deriveEvidenceChips } from "@/components/recommendations/v2/recommendation-v2-card";
import type { RecommendationActionRow } from "@/domains/recommendations/recommendation-action-rows";

function makeRow(overrides: Partial<RecommendationActionRow> = {}): RecommendationActionRow {
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
      measurementPlan: "Track citation rate on Atherton modern-home prompts for 14 days.",
      evidenceRefs: [],
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

describe("Bundle 2A — RecommendationV2Card", () => {
  it("renders the v2 card data attributes", () => {
    const html = renderToStaticMarkup(<RecommendationV2Card row={makeRow()} />);
    expect(html).toContain('data-recommendation-v2-card="true"');
    expect(html).toContain('data-recommendation-v2-status="new"');
  });

  it("renders the operator-friendly status pill ('Suggested' for status=new)", () => {
    const html = renderToStaticMarkup(<RecommendationV2Card row={makeRow()} />);
    expect(html).toContain('data-recommendation-v2-status-pill="true"');
    expect(html).toContain("Suggested");
  });

  it("renders 'High' confidence for derivedConfidence=strong_evidence", () => {
    const html = renderToStaticMarkup(<RecommendationV2Card row={makeRow()} />);
    expect(html).toContain('data-recommendation-v2-confidence="strong_evidence"');
    expect(html).toContain(">High</span>");
  });

  it("renders the headline title", () => {
    const html = renderToStaticMarkup(<RecommendationV2Card row={makeRow()} />);
    expect(html).toContain("Add an FAQ section about modern home builders in Atherton");
  });

  it("renders the target URL when present", () => {
    const html = renderToStaticMarkup(<RecommendationV2Card row={makeRow()} />);
    expect(html).toContain('data-recommendation-v2-target-url="true"');
    expect(html).toContain("ritzbuilders.com/services/modern-home-builder-atherton");
  });

  it("renders the target label fallback when targetUrl is the new-page sentinel", () => {
    const html = renderToStaticMarkup(
      <RecommendationV2Card
        row={makeRow({
          targetUrl: "needs_new_page",
          targetLabel: "New page",
        })}
      />,
    );
    expect(html).toContain('data-recommendation-v2-target-label="true"');
    expect(html).toContain("New page");
  });

  it("renders the evidence-summary one-liner", () => {
    const html = renderToStaticMarkup(<RecommendationV2Card row={makeRow()} />);
    expect(html).toContain('data-recommendation-v2-why="true"');
    expect(html).toContain("AI cites Greenberg on 4 of 7 prompts; Ritz absent.");
  });

  it("renders evidence chips with the deterministic chip set", () => {
    const html = renderToStaticMarkup(<RecommendationV2Card row={makeRow()} />);
    expect(html).toContain('data-recommendation-v2-chip="type"');
    expect(html).toContain(">FAQ<");
    expect(html).toContain('data-recommendation-v2-chip="prompts"');
    expect(html).toContain(">3 prompts affected<");
    expect(html).toContain('data-recommendation-v2-chip="competitor"');
    expect(html).toContain(">Beat Greenberg Constru…<");
  });

  it("renders the primary 'Review →' CTA pointing at the v2 brief page (Bundle 2B)", () => {
    const html = renderToStaticMarkup(<RecommendationV2Card row={makeRow()} />);
    expect(html).toContain('data-recommendation-v2-cta="primary"');
    // Bundle 2B (2026-05-10): the CTA now targets the new detail page
    // /recommendations/<encoded-row-id>. The row's id contains `:` and
    // `[` / `]` characters that must be encoded.
    expect(html).toContain(
      "/recommendations/rec-fixture-1__edit-1",
    );
    // Negative pin: the old legacy-anchor CTA must NOT come back without
    // a matching code change.
    expect(html).not.toContain("/recommendations?legacy=1#rec-");
    expect(html).toContain("Review →");
  });

  it("encodes URL-unsafe characters in the row id (Bundle 2B route-id contract)", () => {
    const html = renderToStaticMarkup(
      <RecommendationV2Card
        row={makeRow({
          id: "create_cluster_page:geo:Los Altos__add_faq__faq_question[new]:abc",
        })}
      />,
    );
    // Encoded form: `:` → %3A, ` ` → %20, `[` → %5B, `]` → %5D.
    expect(html).toContain(
      "/recommendations/create_cluster_page%3Ageo%3ALos%20Altos__add_faq__faq_question%5Bnew%5D%3Aabc",
    );
    // Negative: raw unsafe characters must NOT appear inside the href
    // path segment.
    const hrefMatch = html.match(/href="\/recommendations\/[^"]+"/);
    expect(hrefMatch).not.toBeNull();
    if (hrefMatch) {
      expect(hrefMatch[0]).not.toMatch(/:[^/]/); // no raw `:` after the prefix
      expect(hrefMatch[0]).not.toMatch(/\[/);
      expect(hrefMatch[0]).not.toMatch(/\]/);
    }
  });

  it("never renders raw schema field names, IDs, hashes, or score numbers", () => {
    const html = renderToStaticMarkup(<RecommendationV2Card row={makeRow()} />);
    // No raw debug fields.
    expect(html).not.toContain("evidence_hash");
    expect(html).not.toContain("deadbeef");
    expect(html).not.toContain("resolver_tier");
    expect(html).not.toContain("rec_id");
    expect(html).not.toContain("edit_id");
    expect(html).not.toContain("engineConfidence");
    expect(html).not.toContain("prioritizer_score");
    // No raw priority/score numbers.
    expect(html).not.toMatch(/score[":>\s]+\d+/i);
  });
});

describe("Bundle 2A — deriveEvidenceChips fallbacks", () => {
  it("falls back to 'AI-drafted edit' chip when no competitor and shallow evidence", () => {
    const chips = deriveEvidenceChips(
      makeRow({
        detail: {
          ...makeRow().detail,
          topCompetitor: null,
          evidenceDepth: 1,
          affectedPromptCount: 0,
        },
        editSource: "openai",
      }),
    );
    expect(chips.map((c) => c.key)).toEqual(["type", "drafted"]);
  });

  it("falls back to 'Page-level pattern' chip when no competitor but evidenceDepth >= 4", () => {
    const chips = deriveEvidenceChips(
      makeRow({
        detail: {
          ...makeRow().detail,
          topCompetitor: null,
          evidenceDepth: 4,
          affectedPromptCount: 0,
        },
      }),
    );
    expect(chips.map((c) => c.key)).toEqual(["type", "depth"]);
  });

  it("emits exactly one chip when no signals are available", () => {
    const chips = deriveEvidenceChips(
      makeRow({
        detail: {
          ...makeRow().detail,
          topCompetitor: null,
          evidenceDepth: 0,
          affectedPromptCount: 0,
        },
        editSource: "deterministic",
      }),
    );
    expect(chips.map((c) => c.key)).toEqual(["type"]);
  });

  it("caps the chip count at 3 even when every signal is present", () => {
    const chips = deriveEvidenceChips(makeRow());
    expect(chips.length).toBeLessThanOrEqual(3);
  });
});

// ── One-tap slice (2026-06-12) — inline Accept on the card ───────────
describe("RecommendationV2Card — one-tap Accept", () => {
  it("renders the Accept button when onAccept is wired, and Review stays available", () => {
    const html = renderToStaticMarkup(
      <RecommendationV2Card row={makeRow()} onAccept={() => {}} acceptState="idle" />,
    );
    expect(html).toContain('data-recommendation-v2-cta="accept"');
    expect(html).toContain(">Accept<");
    expect(html).toContain('data-recommendation-v2-cta="review"');
  });

  it("shows the accepted state and disables the button", () => {
    const html = renderToStaticMarkup(
      <RecommendationV2Card row={makeRow()} onAccept={() => {}} acceptState="accepted" />,
    );
    expect(html).toContain("Accepted ✓");
    expect(html).toContain("disabled");
  });

  it("stays presentation-only without onAccept (no Accept button)", () => {
    const html = renderToStaticMarkup(<RecommendationV2Card row={makeRow()} />);
    expect(html).not.toContain('data-recommendation-v2-cta="accept"');
    expect(html).toContain('data-recommendation-v2-cta="primary"');
  });
});
