/**
 * Tests for <RecommendationEvidencePanel> — Trust Sprint Mini-Phase
 * T4.3 (2026-05-06).
 *
 * SSR via renderToStaticMarkup. Confirms the panel categorizes the
 * row's evidence into customer-safe buckets, surfaces missing
 * evidence honestly, and never leaks raw enum names / UUIDs / table
 * names into the customer-facing copy.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RecommendationEvidencePanel } from "./recommendation-evidence-panel";
import type { SpecificEditEvidenceRef } from "@/domains/recommendations/specific-edit-provider";

const KNOWN_PROMPT_ID = "11111111-2222-3333-4444-555555555555";
const PROMPT_TEXT_BY_ID: Record<string, string> = {
  [KNOWN_PROMPT_ID]: "best whole home remodel builders bay area",
};

describe("<RecommendationEvidencePanel> — categorization", () => {
  it("renders 'Prompts affected' bucket with count + observation count when both > 0", () => {
    const html = renderToStaticMarkup(
      <RecommendationEvidencePanel
        evidenceRefs={[{ type: "prompt", promptId: KNOWN_PROMPT_ID }]}
        affectedPromptCount={3}
        observationCount={12}
        evidenceDepth={2}
        topCompetitor={null}
        promptTextById={PROMPT_TEXT_BY_ID}
      />,
    );
    expect(html).toContain("Prompts affected:");
    expect(html).toContain("3");
    expect(html).toContain("12 AI answers");
  });

  it("renders prompt snippet (not the UUID) when promptTextById has a match", () => {
    const html = renderToStaticMarkup(
      <RecommendationEvidencePanel
        evidenceRefs={[{ type: "prompt", promptId: KNOWN_PROMPT_ID }]}
        affectedPromptCount={1}
        observationCount={6}
        evidenceDepth={1}
        topCompetitor={null}
        promptTextById={PROMPT_TEXT_BY_ID}
      />,
    );
    expect(html).toContain("best whole home remodel builders bay area");
    // No raw UUID in customer copy
    expect(html).not.toContain(KNOWN_PROMPT_ID);
  });

  it("renders 'Owned page matched' bucket when at least one owned_page ref present", () => {
    const html = renderToStaticMarkup(
      <RecommendationEvidencePanel
        evidenceRefs={[
          { type: "prompt", promptId: KNOWN_PROMPT_ID },
          { type: "owned_page", url: "https://ritzbuilders.com/locations/atherton" },
        ]}
        affectedPromptCount={1}
        observationCount={6}
        evidenceDepth={2}
        topCompetitor={null}
        promptTextById={PROMPT_TEXT_BY_ID}
      />,
    );
    expect(html).toContain("Owned page matched:");
    expect(html).toContain("ritzbuilders.com/locations/atherton");
  });

  it("renders 'Competitor context' bucket from topCompetitor prop with primary pct", () => {
    const html = renderToStaticMarkup(
      <RecommendationEvidencePanel
        evidenceRefs={[{ type: "prompt", promptId: KNOWN_PROMPT_ID }]}
        affectedPromptCount={2}
        observationCount={10}
        evidenceDepth={3}
        topCompetitor={{ name: "De Mattei Construction", primaryPct: 60 }}
        promptTextById={PROMPT_TEXT_BY_ID}
      />,
    );
    expect(html).toContain("Competitor context:");
    expect(html).toContain("De Mattei Construction");
    expect(html).toContain("primary in 60%");
  });

  it("renders 'AI search queries seen' bucket when search_query refs are present", () => {
    const html = renderToStaticMarkup(
      <RecommendationEvidencePanel
        evidenceRefs={[
          { type: "prompt", promptId: KNOWN_PROMPT_ID },
          {
            type: "search_query",
            query: "luxury custom home builders bay area",
            count: 5,
          } as unknown as SpecificEditEvidenceRef,
        ]}
        affectedPromptCount={1}
        observationCount={6}
        evidenceDepth={2}
        topCompetitor={null}
        promptTextById={PROMPT_TEXT_BY_ID}
      />,
    );
    expect(html).toContain("AI search queries seen:");
    expect(html).toContain("luxury custom home builders bay area");
    expect(html).toContain("5×");
  });

  it("renders 'Page elements referenced' when element refs are present", () => {
    const html = renderToStaticMarkup(
      <RecommendationEvidencePanel
        evidenceRefs={[
          { type: "prompt", promptId: KNOWN_PROMPT_ID },
          {
            type: "element",
            url: "https://ritzbuilders.com/services/whole-home",
            elementKey: "h2[0]:abc",
          },
        ]}
        affectedPromptCount={1}
        observationCount={6}
        evidenceDepth={2}
        topCompetitor={null}
        promptTextById={PROMPT_TEXT_BY_ID}
      />,
    );
    expect(html).toContain("Page elements referenced:");
  });
});

describe("<RecommendationEvidencePanel> — missing evidence", () => {
  it("lists missing categories on the operator-honest 'Evidence missing' line", () => {
    const html = renderToStaticMarkup(
      <RecommendationEvidencePanel
        evidenceRefs={[{ type: "prompt", promptId: KNOWN_PROMPT_ID }]}
        affectedPromptCount={1}
        observationCount={6}
        evidenceDepth={1}
        topCompetitor={null}
        promptTextById={PROMPT_TEXT_BY_ID}
      />,
    );
    expect(html).toContain("Evidence missing:");
    expect(html).toContain("Owned page matched");
    expect(html).toContain("AI search queries seen");
    expect(html).toContain("Competitor context");
    expect(html).toContain("Brand assertions");
  });

  it("does NOT list a category as missing when present", () => {
    const html = renderToStaticMarkup(
      <RecommendationEvidencePanel
        evidenceRefs={[
          { type: "prompt", promptId: KNOWN_PROMPT_ID },
          { type: "owned_page", url: "https://ritzbuilders.com/x" },
        ]}
        affectedPromptCount={1}
        observationCount={6}
        evidenceDepth={2}
        topCompetitor={null}
        promptTextById={PROMPT_TEXT_BY_ID}
      />,
    );
    // Should NOT list "Owned page matched" as missing.
    const missingLineMatch = /Evidence missing:\s*([^.]*)\./.exec(html);
    expect(missingLineMatch).not.toBeNull();
    expect(missingLineMatch![1]).not.toContain("Owned page matched");
  });
});

describe("<RecommendationEvidencePanel> — empty packet", () => {
  it("falls back to 'Evidence packet not available' when row has zero refs and no counts", () => {
    const html = renderToStaticMarkup(
      <RecommendationEvidencePanel
        evidenceRefs={[]}
        affectedPromptCount={0}
        observationCount={0}
        evidenceDepth={0}
        topCompetitor={null}
        promptTextById={{}}
      />,
    );
    expect(html).toContain("Evidence packet not available for this older recommendation");
    expect(html).toContain('data-rec-evidence-empty="true"');
  });
});

describe("<RecommendationEvidencePanel> — customer-safe copy invariants", () => {
  it("never renders raw enum names or table names in customer copy", () => {
    const html = renderToStaticMarkup(
      <RecommendationEvidencePanel
        evidenceRefs={[
          { type: "prompt", promptId: KNOWN_PROMPT_ID },
          { type: "owned_page", url: "https://ritzbuilders.com/x" },
          { type: "competitor", competitorName: "Some Competitor" },
          { type: "element", url: "https://ritzbuilders.com/x", elementKey: "h2[0]:abc" },
        ]}
        affectedPromptCount={2}
        observationCount={10}
        evidenceDepth={4}
        topCompetitor={{ name: "Some Competitor", primaryPct: 40 }}
        promptTextById={PROMPT_TEXT_BY_ID}
      />,
    );
    // Forbidden tokens
    expect(html).not.toMatch(/\bevidence\.type\b/);
    expect(html).not.toMatch(/\bsearch_query\b/);
    expect(html).not.toMatch(/\bowned_page\b/);
    expect(html).not.toMatch(/\bbrand_assertion\b/);
    expect(html).not.toMatch(/\bprior_outcome\b/);
    expect(html).not.toMatch(/SELECT\s+\*\s+FROM/i);
    expect(html).not.toContain("daily_metric_snapshots");
    expect(html).not.toContain("prompt_answer_observations");
    expect(html).not.toContain("recommended_edits");
  });

  it("never renders a raw UUID in customer copy", () => {
    const html = renderToStaticMarkup(
      <RecommendationEvidencePanel
        evidenceRefs={[
          { type: "prompt", promptId: KNOWN_PROMPT_ID },
          { type: "prompt", promptId: "22222222-3333-4444-5555-666666666666" },
        ]}
        affectedPromptCount={2}
        observationCount={10}
        evidenceDepth={2}
        topCompetitor={null}
        promptTextById={{
          [KNOWN_PROMPT_ID]: "best teen braces",
          // Note: the second prompt has no text in the lookup; the
          // panel must NOT fall back to printing the raw UUID.
        }}
      />,
    );
    expect(html).not.toMatch(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i,
    );
  });

  it("competitor names are allowed in operator/evidence copy (the topCompetitor field is by design)", () => {
    const html = renderToStaticMarkup(
      <RecommendationEvidencePanel
        evidenceRefs={[]}
        affectedPromptCount={1}
        observationCount={5}
        evidenceDepth={1}
        topCompetitor={{ name: "De Mattei Construction", primaryPct: 50 }}
        promptTextById={{}}
      />,
    );
    // Competitor name appears in the operator-facing evidence panel —
    // distinct from the public "proposedText" surface that has its own
    // competitorPublicCopy validator.
    expect(html).toContain("De Mattei Construction");
  });
});

describe("<RecommendationEvidencePanel> — evidence depth surface", () => {
  it("renders the evidence depth score with explainer", () => {
    const html = renderToStaticMarkup(
      <RecommendationEvidencePanel
        evidenceRefs={[{ type: "prompt", promptId: KNOWN_PROMPT_ID }]}
        affectedPromptCount={1}
        observationCount={6}
        evidenceDepth={3}
        topCompetitor={null}
        promptTextById={PROMPT_TEXT_BY_ID}
      />,
    );
    expect(html).toContain("Evidence depth score:");
    expect(html).toContain("3");
    expect(html).toContain("/ 6");
    expect(html).toContain("drives rank tiebreakers");
  });
});
