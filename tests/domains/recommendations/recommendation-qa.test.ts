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

  it("TRUST FIX A: page-level GSC demand (no per-query line) STILL counts as core evidence", () => {
    // The bug: a page with real Google demand (impressions) but no qualifying
    // low-CTR/striking-distance headline query had EMPTY gscEvidenceLines, so
    // hasCoreEvidence was false → falsely "No core evidence family present" →
    // capped to needs_more_evidence. The evidence receipt fixes this.
    const v = buildRecommendationQaVerdict({
      row: row({ gsc: [] }), // no per-query display lines
      affectedPromptTexts: ["koobideh kabob recipe"],
      evidence: {
        gscDemand: true, // but the page HAS Google Search demand
        ga4Traffic: false,
        clarity: false,
        aeo: false,
        competitor: false,
      },
    });
    expect(v.confidence).not.toBe("needs_more_evidence");
    expect(v.evidenceSupports).toContain("Google Search demand");
    expect(v.confidenceReason).not.toMatch(/no core evidence/i);
  });

  it("TRUST FIX A: GA4 traffic alone counts as core evidence", () => {
    const v = buildRecommendationQaVerdict({
      // A query is present so page-topic intent-fit CAN be scored — otherwise
      // the audit-3 #10 unscored-fit gate (correctly) holds this for review
      // regardless of evidence. This test's intent is the EVIDENCE-FAMILY
      // recognition: GA4 traffic must count as core (not "no core evidence").
      row: row({ gsc: [] }),
      affectedPromptTexts: ["koobideh kabob recipe"],
      evidence: {
        gscDemand: false,
        ga4Traffic: true,
        clarity: false,
        aeo: false,
        competitor: false,
      },
    });
    expect(v.confidenceReason).not.toMatch(/no core evidence/i);
    expect(v.evidenceSupports).toContain("Website traffic");
  });

  it("audit-3 #10: core evidence but NO query (intent-fit unscored) → needs review, not pushable", () => {
    const v = buildRecommendationQaVerdict({
      row: row({ gsc: [] }),
      affectedPromptTexts: [], // no query anywhere → intent-fit cannot be scored
      evidence: {
        gscDemand: false,
        ga4Traffic: true, // real core evidence …
        clarity: false,
        aeo: false,
        competitor: false,
      },
    });
    // … but with no query to verify the page/query match, it must NOT be
    // auto-approved/pushable (pre-fix this fail-opened to medium + approve).
    expect(v.confidence).toBe("needs_more_evidence");
    expect(v.approve).toBe(false);
  });

  it("TRUST FIX A: an empty receipt with no lines still → needs_more_evidence", () => {
    const v = buildRecommendationQaVerdict({
      row: row({ gsc: [] }),
      affectedPromptTexts: [],
      evidence: {
        gscDemand: false,
        ga4Traffic: false,
        clarity: false,
        aeo: false,
        competitor: false,
      },
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

  // N48 expert-review pass (2026-07-03): a GSC-backed, on-topic rec whose
  // proposed copy reads like generic marketing filler is HELD for review with
  // an honest reason, instead of being shown as a confident move.
  it("N48: holds a rec whose proposed copy is generic filler", () => {
    const v = buildRecommendationQaVerdict({
      row: row({
        gsc: [gscLine("koobideh kabob recipe")],
        proposedText: "Optimize your content and leverage best practices today",
      }),
      affectedPromptTexts: [],
    });
    expect(v.confidence).toBe("needs_more_evidence");
    expect(v.approve).toBe(false);
    expect(v.confidenceReason).toContain("held this one back for review");
    expect(v.confidenceReason).toContain("generic filler");
    // No lab jargon, no banned dashes in the honest hold reason.
    expect(/[‒–—―]/.test(v.confidenceReason)).toBe(false);
  });

  // N48: a clean, specific, GSC-backed edit passes the review untouched. The
  // review adds nothing to a good rec.
  it("N48: passes a clean specific rec (approved, no hold note)", () => {
    const v = buildRecommendationQaVerdict({
      row: row({
        gsc: [gscLine("koobideh kabob recipe")],
        proposedText: "Persian Koobideh Kabob Recipe: 6 Steps, 45 Minutes",
      }),
      affectedPromptTexts: [],
    });
    expect(["high", "medium"]).toContain(v.confidence);
    expect(v.approve).toBe(true);
    expect(v.confidenceReason).not.toContain("held this one back");
  });
});
