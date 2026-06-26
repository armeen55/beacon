/**
 * Expert-rec-engine PHASE I (2026-06-16) — deriveRowTopicFit adapter.
 * Pins that a live row's intent-fit is derived from the evidence it carries:
 * primary query precedence (GSC → prompt), supporting-query context,
 * and null when there's no quotable query.
 */

import { describe, it, expect } from "vitest";

import { deriveRowTopicFit } from "@/domains/recommendations/topic-fit-from-evidence";
import type { RecommendationActionRow } from "@/domains/recommendations/recommendation-action-rows";
import type { EvidenceLine } from "@/domains/recommendation-intelligence/evidence-summary";

function row(overrides: {
  targetLabel?: string;
  targetUrl?: string | null;
  gsc?: EvidenceLine[];
}): RecommendationActionRow {
  return {
    targetLabel: overrides.targetLabel ?? "Persian Rug Cleaning page",
    targetUrl: overrides.targetUrl ?? "https://example.com/persian-rug-cleaning",
    detail: {
      gscEvidenceLines: overrides.gsc ?? [],
    },
    // The adapter only reads the fields above; the rest of the row shape is
    // irrelevant to this pure derivation.
  } as unknown as RecommendationActionRow;
}

const gscLine = (q: string): EvidenceLine => ({
  key: "headline_query",
  value: `“${q}”`,
  label: "shown · rank #6",
});

describe("deriveRowTopicFit", () => {
  it("uses the GSC headline query as the primary target", () => {
    const fit = deriveRowTopicFit(
      row({ gsc: [gscLine("persian rug cleaning cost"), gscLine("persian rug repair")] }),
      [],
    );
    expect(fit).not.toBeNull();
    expect(fit!.queryIntent).toContain("persian rug cleaning cost");
  });

  it("falls back to a tracked prompt when there is no GSC query", () => {
    const promptOnly = deriveRowTopicFit(row({}), ["how to wash a persian rug"]);
    expect(promptOnly!.queryIntent).toContain("how to wash a persian rug");
  });

  it("returns null when the row carries no quotable query", () => {
    expect(deriveRowTopicFit(row({}), [])).toBeNull();
  });

  it("passes brand/locale terms through to intent classification", () => {
    // A brand-dominant query with the tenant brand term → navigational.
    const fit = deriveRowTopicFit(row({ gsc: [gscLine("iranopedia")] }), [], {
      brandTerms: ["Iranopedia"],
    });
    expect(fit!.intentClass).toBe("navigational");
  });

  it("scores a strong fit for an on-topic query and surfaces a mismatch otherwise", () => {
    const onTopic = deriveRowTopicFit(
      row({ targetUrl: "https://x.com/persian-rug-cleaning", gsc: [gscLine("persian rug cleaning")] }),
      ["persian rug cleaning tips"],
    );
    expect(onTopic!.topicMatchScore).toBeGreaterThan(0);

    const offTopic = deriveRowTopicFit(
      row({ targetLabel: "Asiatic Cheetah page", targetUrl: "https://x.com/wildlife/cheetah", gsc: [gscLine("current time in tehran")] }),
      [],
    );
    expect(offTopic!.shouldUseQueryForOptimization).toBe(false);
  });
});
