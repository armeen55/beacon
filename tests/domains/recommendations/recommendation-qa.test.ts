/**
 * Expert-rec-engine GQA-1 (2026-06-16) — generation-time recommendation QA.
 *
 * Pins the operator's acceptance examples (Iranopedia-shaped fixtures ONLY in
 * tests — never in product logic):
 *   • a city page evaluated with its TRUE cluster is NOT falsely rejected;
 *   • an Asiatic-cheetah page optimized for an unrelated query (near-zero
 *     overlap) IS rejected — generically, via the severe-mismatch threshold;
 *   • a high-volume but WRONG-INTENT query (transactional on an informational
 *     page) cannot be high-confidence;
 *   • unsafe proposed copy ("Change the page title to…") can never be high;
 *   • high confidence REQUIRES a core evidence family;
 *   • the verdict carries why-exists / evidence-supports / evidence-missing /
 *     confidence-reason / push-readiness for the card.
 */

import { describe, it, expect } from "vitest";

import { buildRecommendationQaVerdict } from "@/domains/recommendations/recommendation-qa";
import type { ActionRowType, RecommendationActionRow } from "@/domains/recommendations/recommendation-action-rows";
import type { EvidenceLine } from "@/domains/recommendation-intelligence/evidence-summary";

const gscLine = (q: string): EvidenceLine => ({
  key: "headline_query",
  value: `“${q}”`,
  label: "shown · rank #6",
});

function row(o: {
  actionType?: ActionRowType;
  targetLabel?: string;
  targetUrl?: string | null;
  gsc?: EvidenceLine[];
  competitor?: { name: string; primaryPct: number } | null;
  proposedText?: string | null;
  motiveLabel?: string | null;
  observationCount?: number;
}): RecommendationActionRow {
  return {
    actionType: o.actionType ?? "edit_title",
    targetLabel: o.targetLabel ?? "Persian Koobideh Kabob Recipe",
    targetUrl: o.targetUrl ?? "https://iranopedia.com/persian-food/koobideh-kabob-recipe",
    detail: {
      gscEvidenceLines: o.gsc ?? [],
      semrushEvidenceLines: [],
      clarityEvidenceLines: [],
      aeoEvidenceLines: [],
      topCompetitor: o.competitor ?? null,
      proposedText: o.proposedText ?? null,
      motiveLabel: o.motiveLabel ?? null,
      observationCount: o.observationCount ?? 0,
    },
  } as unknown as RecommendationActionRow;
}

describe("buildRecommendationQaVerdict — the deterministic list authority", () => {
  it("on-topic, GSC-backed, clean → high/medium + approved + evidence listed", () => {
    const v = buildRecommendationQaVerdict({
      row: row({ gsc: [gscLine("koobideh kabob recipe")] }),
      affectedPromptTexts: [],
    });
    expect(["high", "medium"]).toContain(v.confidence);
    expect(v.approve).toBe(true);
    expect(v.evidenceSupports).toContain("Google Search demand");
    expect(v.pushReadiness).toBe("paste_ready");
    expect(v.copySafe).toBe(true);
  });

  it("Asiatic-cheetah page optimized for an unrelated query → REJECTED (generic)", () => {
    const v = buildRecommendationQaVerdict({
      row: row({
        targetLabel: "Asiatic Cheetah",
        targetUrl: "https://iranopedia.com/wildlife/asiatic-cheetah",
        gsc: [gscLine("current time in tehran now")],
      }),
      affectedPromptTexts: [],
    });
    expect(v.confidence).toBe("rejected");
    expect(v.approve).toBe(false);
  });

  it("city page evaluated with its TRUE cluster is NOT falsely rejected", () => {
    const v = buildRecommendationQaVerdict({
      row: row({
        targetLabel: "Tehran",
        targetUrl: "https://iranopedia.com/cities/tehran",
        gsc: [gscLine("tehran travel guide")],
      }),
      affectedPromptTexts: ["things to do in tehran", "tehran attractions"],
    });
    expect(v.confidence).not.toBe("rejected");
  });

  it("high-volume WRONG-INTENT query (transactional on informational page) cannot be high", () => {
    const v = buildRecommendationQaVerdict({
      row: row({ gsc: [gscLine("koobideh kabob price")] }),
      affectedPromptTexts: [],
    });
    // intent-class conflict (transactional vs informational) → confident mismatch
    expect(v.confidence).toBe("rejected");
    expect(v.approve).toBe(false);
  });

  it("unsafe proposed copy ('Change the page title to…') can never be high + flags copySafe", () => {
    const v = buildRecommendationQaVerdict({
      row: row({
        gsc: [gscLine("koobideh kabob recipe")],
        proposedText: "Change the page title to Koobideh Kabob Recipe",
      }),
      affectedPromptTexts: [],
    });
    expect(v.copySafe).toBe(false);
    expect(v.confidence).not.toBe("high");
    expect(v.approve).toBe(false);
    expect(v.confidenceReason).toContain("needs review");
  });

  it("no core evidence → needs_more_evidence + not approved", () => {
    const v = buildRecommendationQaVerdict({
      row: row({ gsc: [] }),
      affectedPromptTexts: [],
    });
    expect(v.confidence).toBe("needs_more_evidence");
    expect(v.approve).toBe(false);
  });

  it("whyExists uses the resolver motive when present", () => {
    const v = buildRecommendationQaVerdict({
      row: row({
        gsc: [gscLine("koobideh kabob recipe")],
        motiveLabel: "A competitor is currently winning this answer.",
      }),
      affectedPromptTexts: [],
    });
    expect(v.whyExists).toBe("A competitor is currently winning this answer.");
  });

  it("PREFERS the generation-time fit over the row-evidence proxy (GQA-4)", () => {
    // The row's own evidence would score a strong fit, but the richer
    // generation-time fit (full page snapshot) says reject — it must win.
    const v = buildRecommendationQaVerdict({
      row: row({ gsc: [gscLine("koobideh kabob recipe")] }),
      affectedPromptTexts: [],
      preferredTopicFit: {
        pageTopic: "Asiatic Cheetah",
        queryIntent: "koobideh kabob recipe (informational)",
        intentClass: "informational",
        topicMatchScore: 4, // near-zero overlap from the real page snapshot
        intentMatchScore: 60,
        matchExplanation: "Weak fit from the full page snapshot.",
        mismatchRisks: ["The page snapshot doesn't cover this topic."],
        shouldUseQueryForOptimization: false,
      },
    });
    // The generation-time fit's confident mismatch (topic 4 < 20) → rejected,
    // even though the row's GSC evidence alone looked on-topic.
    expect(v.confidence).toBe("rejected");
    expect(v.intentFit?.topicMatchScore).toBe(4);
  });

  it("surfaces evidence gaps honestly", () => {
    const v = buildRecommendationQaVerdict({
      row: row({ competitor: { name: "Rival", primaryPct: 0.4 }, observationCount: 5 }),
      affectedPromptTexts: ["best persian food blog"],
    });
    expect(v.evidenceMissing.some((m) => m.includes("Search demand"))).toBe(true);
  });
});
