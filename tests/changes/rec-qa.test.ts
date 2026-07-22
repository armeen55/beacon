/** Recommendation QA + expert review + list enforcement + adversarial quality corpus (Core 100K Phase 6 merge). */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import { buildRecommendationQaVerdict } from "@/domains/recommendations/recommendation-qa";
import { type ActionRowType, type RecommendationActionRow } from "@/domains/recommendations/recommendation-action-rows";
import { type EvidenceLine } from "@/domains/recommendation-intelligence/evidence-summary";
import { reviewExpertQuality, type ExpertVerdict, type ExpertReviewInput } from "@/domains/recommendations/expert-verdict";
import { dedupeDoubledWords, stripInstructionArtifactPrefix } from "@/domains/recommendations/copy-artifact-guard";
import { cleanDisplayLabel } from "@/domains/recommendations/recommendation-title-humanizer";
import { reviewRecommendation, passesDailyGate, isPausedForSourceContradiction, type RecommendationInput } from "@/domains/recommendations/recommendation-quality";

// ===== from tests/domains/recommendations/recommendation-qa.test.ts =====
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

// ===== from tests/domains/recommendations/expert-review-quality.test.ts =====
/**
 * N48 expert-review pass (2026-07-03): the final deterministic read over a rec
 * that already cleared the confidence gate. It checks the rec reads like an
 * expert wrote it (a concrete number, a real next step, no generic filler, no
 * self-contradiction) and HOLDS it honestly on failure. Lower-only: it can
 * never raise confidence or rescue a reject, and a clean rec passes through
 * byte-identically so nothing new surfaces on a good recommendation.
 */



const cleanHigh: ExpertVerdict = {
  enforcedConfidence: "high",
  enforcedApprove: true,
  gateNotes: ["Strong evidence and intent fit (topic 82/100, intent 78/100)."],
};

function input(overrides: Partial<ExpertReviewInput> = {}): ExpertReviewInput {
  return {
    whyExists:
      "People saw your page 9,137 times for this query and you rank #3.",
    proposedText: "Best Persian Koobideh Kabob Recipe (Step by Step)",
    measurementPlan: "Track the click-through on this query for 14 days.",
    confidenceReason: "Strong evidence and intent fit (topic 82/100, intent 78/100).",
    hasQuotedEvidence: true,
    actionIsConcrete: true,
    ...overrides,
  };
}

describe("reviewExpertQuality N48 final expert read", () => {
  it("passes a clean, specific, actionable rec UNCHANGED (byte-identical)", () => {
    const out = reviewExpertQuality(cleanHigh, input());
    expect(out).toBe(cleanHigh);
  });

  it("holds a rec with no concrete number when it has no quoted evidence", () => {
    const out = reviewExpertQuality(cleanHigh, {
      ...input(),
      whyExists: "This page has demand worth acting on.",
      proposedText: null,
      measurementPlan: null,
      confidenceReason: "This page has demand worth acting on.",
      hasQuotedEvidence: false,
      actionIsConcrete: false,
    });
    expect(out.enforcedConfidence).toBe("needs_more_evidence");
    expect(out.enforcedApprove).toBe(false);
    expect(out.gateNotes[out.gateNotes.length - 1]).toContain(
      "concrete number",
    );
    expect(out.gateNotes[out.gateNotes.length - 1]).toContain(
      "read like an expert wrote it",
    );
  });

  it("a quoted evidence line satisfies the number check even with bare prose", () => {
    const out = reviewExpertQuality(cleanHigh, {
      ...input(),
      whyExists: "This page has a gap worth acting on.",
      proposedText: null,
      hasQuotedEvidence: true,
      actionIsConcrete: true,
    });
    expect(out).toBe(cleanHigh);
  });

  it("holds a rec that reads like generic filler", () => {
    const out = reviewExpertQuality(cleanHigh, {
      ...input(),
      whyExists:
        "Optimize your content and leverage synergies for 9,137 impressions.",
    });
    expect(out.enforcedConfidence).toBe("needs_more_evidence");
    expect(out.gateNotes[out.gateNotes.length - 1]).toContain(
      "generic filler",
    );
  });

  it("holds a rec that contradicts itself on how the page is doing", () => {
    const out = reviewExpertQuality(cleanHigh, {
      ...input(),
      whyExists:
        "This page ranks well at #2 for 9,137 searches but does not rank for it.",
    });
    expect(out.enforcedConfidence).toBe("needs_more_evidence");
    expect(out.gateNotes[out.gateNotes.length - 1]).toContain(
      "contradicts itself",
    );
  });

  it("never reviews a rec the gate already held (leaves it verbatim)", () => {
    const held: ExpertVerdict = {
      enforcedConfidence: "needs_more_evidence",
      enforcedApprove: false,
      gateNotes: ["No core evidence family is present."],
    };
    const out = reviewExpertQuality(held, {
      ...input(),
      whyExists: "leverage synergies",
      hasQuotedEvidence: false,
      actionIsConcrete: false,
    });
    expect(out).toBe(held);
  });

  it("never reviews a rejected rec", () => {
    const rejected: ExpertVerdict = {
      enforcedConfidence: "rejected",
      enforcedApprove: false,
      gateNotes: ["A deterministic safety gate rejected this recommendation."],
    };
    const out = reviewExpertQuality(rejected, input());
    expect(out).toBe(rejected);
  });

  it("holds a good rec that misses BOTH a number and a next step, listing both", () => {
    const out = reviewExpertQuality(cleanHigh, {
      whyExists: "This page has a gap.",
      proposedText: null,
      measurementPlan: null,
      confidenceReason: "This page has a gap.",
      hasQuotedEvidence: false,
      actionIsConcrete: false,
    });
    expect(out.enforcedConfidence).toBe("needs_more_evidence");
    const last = out.gateNotes[out.gateNotes.length - 1]!;
    expect(last).toContain("concrete number");
    expect(last).toContain("what to actually do next");
  });

  it("the hold note contains no em or en dash (Beacon voice)", () => {
    const out = reviewExpertQuality(cleanHigh, {
      ...input(),
      whyExists: "leverage synergies",
    });
    const last = out.gateNotes[out.gateNotes.length - 1]!;
    expect(/[‒–—―]/.test(last)).toBe(false);
  });
});

// ===== from tests/domains/recommendations/rec-list-enforcement.test.ts =====
/**
 * Rec-list ENFORCEMENT layer (2026-06-16) — the operator's exact production
 * cases, pinned. The live `/recommendations` list exposed enforcement bugs:
 * a QA-rejected rec rendered "Suggested" + a one-tap "Accept" + "High", and
 * copy artifacts ("Add Add …", "Change the page title to …") reached the card.
 *
 * "A smart explanation on a bad recommendation is worse than none." So the LIST
 * must look expert BEFORE the operator clicks in: the deterministic QA verdict
 * (the final authority) decides the visible confidence, status pill, primary
 * CTA, and pushability — it can only LOWER/flag, never raise/revive a reject.
 *
 * These tests use Iranopedia-SHAPED fixtures (cities / Asiatic cheetah /
 * Pahlavi / Abbasid) ONLY as test data — there is zero tenant/keyword/brand
 * hardcoding in the product logic under test; the judgments come from the
 * generic evidence + intent-fit gate.
 */



const gscLine_f2 = (q: string): EvidenceLine => ({
  key: "headline_query",
  value: `“${q}”`,
  label: "shown · rank #6",
});

function row_f2(o: {
  actionType?: ActionRowType;
  targetLabel?: string;
  targetUrl?: string | null;
  gsc?: EvidenceLine[];
  proposedText?: string | null;
}): RecommendationActionRow {
  return {
    actionType: o.actionType ?? "edit_title",
    targetLabel: o.targetLabel ?? "Abbasid Caliphate",
    targetUrl: o.targetUrl ?? "https://iranopedia.com/history/abbasid-caliphate",
    detail: {
      gscEvidenceLines: o.gsc ?? [],
      semrushEvidenceLines: [],
      clarityEvidenceLines: [],
      aeoEvidenceLines: [],
      topCompetitor: null,
      proposedText: o.proposedText ?? null,
      motiveLabel: null,
      observationCount: 0,
    },
  } as unknown as RecommendationActionRow;
}

describe("operator production cases — the gate rejects off-topic recs", () => {
  it("Asiatic Cheetah optimized for an unrelated query → rejected, never approvable", () => {
    const v = buildRecommendationQaVerdict({
      row: row_f2({
        targetLabel: "Asiatic Cheetah",
        targetUrl: "https://iranopedia.com/wildlife/asiatic-cheetah",
        gsc: [gscLine_f2("current time in tehran now")],
      }),
      affectedPromptTexts: [],
    });
    expect(v.confidence).toBe("rejected");
    expect(v.approve).toBe(false);
  });

  it("Pahlavi reject → the gate withholds approval", () => {
    // A confident topic mismatch (a transactional/unrelated query on the
    // dynasty page) is rejected by the gate → downstream surfaces must never
    // present it as approvable.
    const v = buildRecommendationQaVerdict({
      row: row_f2({
        targetLabel: "Pahlavi dynasty",
        targetUrl: "https://iranopedia.com/history/pahlavi-dynasty",
        gsc: [gscLine_f2("buy persian rugs online")],
      }),
      affectedPromptTexts: [],
    });
    expect(v.approve).toBe(false);
    expect(["rejected", "needs_more_evidence", "low"]).toContain(v.confidence);
  });

  it("a valid on-topic rec (Abbasid history) is STILL approved with real confidence", () => {
    const v = buildRecommendationQaVerdict({
      row: row_f2({
        targetLabel: "Abbasid Caliphate",
        targetUrl: "https://iranopedia.com/history/abbasid-caliphate",
        gsc: [gscLine_f2("abbasid caliphate history")],
      }),
      affectedPromptTexts: ["abbasid caliphate timeline", "who were the abbasids"],
    });
    expect(["high", "medium"]).toContain(v.confidence);
    expect(v.approve).toBe(true);
  });
});

// NOTE (2026-07-21, CORE 100K): the `deriveRecQaDisplay` display-mapping and
// list/detail parity describe blocks were removed together with the function
// itself — it lost its last production caller when the /recommendations list +
// detail surfaces collapsed into /changes. The deterministic authority,
// `buildRecommendationQaVerdict`, is live (publish gate) and stays pinned above.

describe("copy artifacts can never reach the customer card", () => {
  it("schema title cannot render 'Add Add' (doubled leading verb collapsed)", () => {
    expect(dedupeDoubledWords("Add Add Article schema to this page")).toBe(
      "Add Article schema to this page",
    );
    expect(dedupeDoubledWords("Add Add Article schema")).not.toMatch(/Add Add/);
  });

  it("a title can never render 'Change the page title to …' as the copy", () => {
    const cleaned = cleanDisplayLabel(
      'Change the page title to "Abbasid Caliphate: History & Timeline"',
    );
    expect(cleaned).toBe("Abbasid Caliphate: History & Timeline");
    expect(cleaned).not.toMatch(/change the page title/i);
  });

  it("strips a leading meta-description directive prefix", () => {
    const out = stripInstructionArtifactPrefix(
      'Add the short page description: "A complete guide to the Abbasid Caliphate."',
    );
    expect(out.stripped).toBe(true);
    expect(out.text).not.toMatch(/add the short page description/i);
  });

  it("drops a directive that leaves only a sentence fragment (no clean value)", () => {
    // "Update the meta description to improve click-through" → after stripping
    // the prefix the remainder is a lowercase fragment, not a real value → "".
    expect(cleanDisplayLabel("Update the meta description to improve click-through")).toBe("");
  });
});

// ===== from src/domains/recommendations/recommendation-quality.test.ts =====
function rec(over: Partial<RecommendationInput> & { lever: RecommendationInput["lever"] }): RecommendationInput {
  return {
    pagePath: "/p",
    pageLabel: "Persian Boy Names",
    targetQuery: "persian boy names",
    proposedText: "Persian boy names are traditional given names from Iran, chosen for meaning and heritage.",
    pageOwnsQuery: true,
    ...over,
  };
}
const codes = (r: ReturnType<typeof reviewRecommendation>) => r.checks.map((c) => c.code);

describe("Move 4 - adversarial regression corpus (the real failures)", () => {
  it("Doodool Tala → Persian jewelry internal link is REJECTED (destination irrelevant)", () => {
    const r = reviewRecommendation(rec({
      lever: "internal_link", pagePath: "/doodool-tala", pageLabel: "Doodool Tala", targetQuery: "doodool tala",
      proposedText: "see Persian jewelry", destinationPath: "/persian-jewelry", destinationLabel: "Persian Jewelry", anchorText: "Persian jewelry",
    }));
    expect(r.decision).toBe("rejected");
    expect(codes(r)).toContain("destination_irrelevant");
    expect(passesDailyGate(r)).toBe(false);
  });

  it("Chaharshanbe year-intent query with a yearless answer is caught (year_intent_incomplete)", () => {
    const r = reviewRecommendation(rec({
      lever: "answer_block", pagePath: "/chaharshanbe-suri", pageLabel: "Chaharshanbe Suri", targetQuery: "chaharshanbe suri 2026",
      proposedText: "Chaharshanbe Suri is the Persian Festival of Fire held before Nowruz.",
    }));
    expect(codes(r)).toContain("year_intent_incomplete");
    expect(["rejected", "needs_revision"]).toContain(r.decision);
  });

  it("a self-link is REJECTED", () => {
    const r = reviewRecommendation(rec({
      lever: "internal_link", pagePath: "/cities", pageLabel: "Cities of Iran", targetQuery: "cities of iran",
      destinationPath: "/cities", destinationLabel: "Cities of Iran", anchorText: "cities of iran",
    }));
    expect(codes(r)).toContain("self_link");
    expect(r.decision).toBe("rejected");
  });

  it("anchor that doesn't describe the destination is REJECTED", () => {
    const r = reviewRecommendation(rec({
      lever: "internal_link", pagePath: "/tehran", pageLabel: "Tehran", targetQuery: "tehran",
      destinationPath: "/shiraz", destinationLabel: "Shiraz", anchorText: "tehran",
    }));
    expect(codes(r)).toContain("anchor_destination_mismatch");
    expect(r.decision).toBe("rejected");
  });

  it("a sibling-owned query is REJECTED (sibling ownership conflict)", () => {
    const r = reviewRecommendation(rec({
      lever: "meta", pageLabel: "Persian Boy Names", targetQuery: "persian girl names",
      pageOwnsQuery: false, siblingOwnerLabel: "Persian Girl Names", proposedText: "Persian girl names and their meanings.",
    }));
    expect(codes(r)).toContain("sibling_ownership_conflict");
    expect(r.decision).toBe("rejected");
  });

  it("a proof-blocked lever cannot pass", () => {
    const r = reviewRecommendation(rec({ lever: "meta", proofBlockedLevers: ["meta"], proposedText: "A fresh, factual meta for Persian boy names." }));
    expect(codes(r)).toContain("proof_blocked_lever");
    expect(r.decision).toBe("rejected");
  });

  it("a protected control cannot pass", () => {
    const r = reviewRecommendation(rec({ lever: "meta", isProtectedControl: true, proposedText: "A fresh, factual meta for Persian boy names." }));
    expect(codes(r)).toContain("protected_control");
    expect(r.decision).toBe("rejected");
  });

  it("an active-measurement conflict cannot pass", () => {
    const r = reviewRecommendation(rec({ lever: "meta", pageMeasuringSameLever: true, proposedText: "A fresh, factual meta for Persian boy names." }));
    expect(codes(r)).toContain("active_measurement_conflict");
    expect(r.decision).toBe("rejected");
  });

  it("Clean strategy with too few controls is REJECTED; other strategies caution", () => {
    const clean = reviewRecommendation(rec({ lever: "meta", strategy: "clean", controlsAvailable: 1, proposedText: "A fresh, factual meta for Persian boy names." }));
    expect(codes(clean)).toContain("measurement_insufficient");
    expect(clean.decision).toBe("rejected");
    const growth = reviewRecommendation(rec({ lever: "meta", strategy: "growth", controlsAvailable: 1, proposedText: "A fresh, factual meta for Persian boy names." }));
    expect(growth.cautions.map((c) => c.code)).toContain("measurement_insufficient");
    expect(passesDailyGate(growth)).toBe(true);
  });

  it("a verification-unsupported change is REJECTED", () => {
    const r = reviewRecommendation(rec({ lever: "meta", verifiable: false, proposedText: "A fresh, factual meta for Persian boy names." }));
    expect(codes(r)).toContain("verification_unsupported");
    expect(r.decision).toBe("rejected");
  });

  it("a generic 'Complete Guide' title is gated, not high-confidence Ready", () => {
    const r = reviewRecommendation(rec({ lever: "title", proposedText: "The Complete Guide to Everything You Need to Know" }));
    expect(passesDailyGate(r)).toBe(false);
  });

  it("a definitive contested origin is an APPROVED-WITH-CAUTION, not a rejection", () => {
    const r = reviewRecommendation(rec({
      lever: "answer_block", pagePath: "/chaharshanbe-suri", pageLabel: "Chaharshanbe Suri", targetQuery: "chaharshanbe suri",
      proposedText: "Chaharshanbe Suri is a Persian festival of fire rooted in Zoroastrian tradition.",
    }));
    expect(r.cautions.map((c) => c.code)).toContain("definitive_origin_claim");
    expect(r.decision).toBe("approved_with_caution");
    expect(passesDailyGate(r)).toBe(true);
  });

  it("no-meaningful-change (proposed == current) → needs revision", () => {
    const r = reviewRecommendation(rec({ lever: "meta", currentText: "Persian boy names and their meanings.", proposedText: "Persian boy names and their meanings." }));
    expect(codes(r)).toContain("no_meaningful_change");
    expect(r.decision).toBe("needs_revision");
  });
});

describe("approvals - valid recommendations pass", () => {
  it("a valid, factual meta is APPROVED", () => {
    const r = reviewRecommendation(rec({ lever: "meta", proposedText: "Persian boy names: traditional Iranian given names with their meanings and origins." }));
    expect(r.decision === "approved" || r.decision === "approved_with_caution").toBe(true);
    expect(passesDailyGate(r)).toBe(true);
  });
  it("a valid sibling cross-link (boy names → girl names) is allowed", () => {
    const r = reviewRecommendation(rec({
      lever: "internal_link", pagePath: "/persian-boy-names", pageLabel: "Persian Boy Names", targetQuery: "persian names",
      destinationPath: "/persian-girl-names", destinationLabel: "Persian Girl Names", anchorText: "Persian girl names", sourceSentence: "See also Persian girl names for the feminine equivalents.",
    }));
    expect(r.checks.map((c) => c.code)).not.toContain("destination_irrelevant");
    expect(r.checks.map((c) => c.code)).not.toContain("self_link");
  });
  it("directional-only measurement is a caution but still passes", () => {
    const r = reviewRecommendation(rec({ lever: "new_page", pageLabel: "Persian Wedding Traditions", targetQuery: "persian wedding traditions", directionalOnly: true, proposedText: "A new page covering Persian wedding traditions." }));
    expect(r.cautions.map((c) => c.code)).toContain("directional_measurement");
    expect(passesDailyGate(r)).toBe(true);
  });
});

describe("determinism + tenant-agnostic", () => {
  it("same input → same decision (repeatable)", () => {
    const input = rec({ lever: "meta", proposedText: "Persian boy names: traditional Iranian given names and meanings." });
    expect(reviewRecommendation(input)).toEqual(reviewRecommendation(input));
  });
  it("operatorReason never contains a raw reason code", () => {
    const r = reviewRecommendation(rec({ lever: "internal_link", pageLabel: "Doodool Tala", targetQuery: "doodool tala", destinationLabel: "Persian Jewelry", anchorText: "Persian jewelry", destinationPath: "/persian-jewelry", pagePath: "/doodool-tala" }));
    expect(r.operatorReason).not.toMatch(/_/);
  });
});

describe("N9 - pause when sources contradict (Quality Constitution law 1)", () => {
  it("a GSC-vs-GA4 traffic contradiction PAUSES the rec, ahead of every other gate", () => {
    // This candidate would otherwise be a clean APPROVE (valid meta, on-topic) - proving the
    // pause supersedes ordinary quality judgment rather than merely adding another caution.
    const r = reviewRecommendation(rec({
      lever: "meta",
      proposedText: "Persian boy names: traditional Iranian given names with their meanings and origins.",
      sourceEvidence: {
        gscTraffic: { clicks: 1200, impressions: 40000, windowDays: 90 },
        ga4Traffic: { sessions: 3, windowDays: 90 },
      },
    }));
    expect(r.decision).toBe("paused_source_contradiction");
    expect(isPausedForSourceContradiction(r)).toBe(true);
    expect(passesDailyGate(r)).toBe(false);
    expect(r.sourceContradictions).toHaveLength(1);
    expect(r.sourceContradictions[0].kind).toBe("traffic_mismatch");
  });

  it("the pause line is the honest, numbers-first sentence the operator sees", () => {
    const r = reviewRecommendation(rec({
      lever: "meta",
      pageLabel: "Persian Boy Names",
      sourceEvidence: {
        gscTraffic: { clicks: 1200, impressions: 40000, windowDays: 90 },
        ga4Traffic: { sessions: 3, windowDays: 90 },
      },
    }));
    expect(r.operatorReason).toContain("Search Console and Analytics disagree");
    expect(r.operatorReason).toContain("1,200");
    expect(r.operatorReason).toContain("3");
    expect(r.operatorReason).toContain("I am not recommending changes to it until I trust the data");
    expect(r.operatorReason).toContain("I will check again during background upkeep");
  });

  it("a rank-visibility contradiction (GSC top-5 vs SERP snapshot absent from top 10) also pauses", () => {
    const r = reviewRecommendation(rec({
      lever: "meta",
      targetQuery: "nowruz 2026",
      sourceEvidence: {
        gscQueryPosition: { query: "nowruz 2026", position: 3, impressions: 500 },
        serpSnapshot: { query: "nowruz 2026", capturedAt: "2026-07-01", ownDomainInTop10: false },
      },
    }));
    expect(r.decision).toBe("paused_source_contradiction");
  });

  it("a gone-page-but-clicked contradiction also pauses", () => {
    const r = reviewRecommendation(rec({
      lever: "meta",
      sourceEvidence: {
        pageStatus: { httpStatus: 404, fetchedAt: new Date().toISOString() },
        gscRecentClicks: { clicks: 50, recencyDays: 90 },
      },
    }));
    expect(r.decision).toBe("paused_source_contradiction");
  });

  it("NEVER fires on missing/absent data - no sourceEvidence at all behaves exactly as before N9", () => {
    const r = reviewRecommendation(rec({ lever: "meta" }));
    expect(r.decision).not.toBe("paused_source_contradiction");
    expect(r.sourceContradictions).toEqual([]);
  });

  it("NEVER fires when sourceEvidence is supplied but every field inside it is absent", () => {
    const r = reviewRecommendation(rec({ lever: "meta", sourceEvidence: {} }));
    expect(r.decision).not.toBe("paused_source_contradiction");
    expect(r.sourceContradictions).toEqual([]);
  });

  it("NEVER fires when only ONE side of a rule is present (e.g. GSC clicks with no GA4 read at all)", () => {
    const r = reviewRecommendation(rec({
      lever: "meta",
      sourceEvidence: { gscTraffic: { clicks: 5000, impressions: 90000, windowDays: 90 } },
    }));
    expect(r.decision).not.toBe("paused_source_contradiction");
  });

  it("stays a normal decision when sources are present but AGREE (no false pause on real evidence)", () => {
    const r = reviewRecommendation(rec({
      lever: "meta",
      proposedText: "Persian boy names: traditional Iranian given names with their meanings and origins.",
      sourceEvidence: {
        gscTraffic: { clicks: 500, impressions: 10000, windowDays: 90 },
        ga4Traffic: { sessions: 420, windowDays: 90 },
      },
    }));
    expect(r.decision === "approved" || r.decision === "approved_with_caution").toBe(true);
    expect(r.sourceContradictions).toEqual([]);
  });

  it("UNPAUSES automatically once the contradiction clears - it is computed, never persisted", () => {
    const paused = reviewRecommendation(rec({
      lever: "meta",
      sourceEvidence: {
        gscTraffic: { clicks: 1200, impressions: 40000, windowDays: 90 },
        ga4Traffic: { sessions: 3, windowDays: 90 },
      },
    }));
    expect(paused.decision).toBe("paused_source_contradiction");

    // Same page, next nightly read: GA4 now agrees with GSC. Nothing was written anywhere -
    // this is just calling the pure function again with fresh evidence.
    const resolved = reviewRecommendation(rec({
      lever: "meta",
      proposedText: "Persian boy names: traditional Iranian given names with their meanings and origins.",
      sourceEvidence: {
        gscTraffic: { clicks: 1200, impressions: 40000, windowDays: 90 },
        ga4Traffic: { sessions: 1100, windowDays: 90 },
      },
    }));
    expect(resolved.decision).not.toBe("paused_source_contradiction");
    expect(passesDailyGate(resolved)).toBe(true);
  });
});
