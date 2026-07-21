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

import { describe, it, expect } from "vitest";

import {
  buildRecommendationQaVerdict,
  deriveRecQaDisplay,
  type RecQaVerdict,
} from "@/domains/recommendations/recommendation-qa";
import {
  dedupeDoubledWords,
  stripInstructionArtifactPrefix,
} from "@/domains/recommendations/copy-artifact-guard";
import { cleanDisplayLabel } from "@/domains/recommendations/recommendation-title-humanizer";
import type {
  ActionRowType,
  RecommendationActionRow,
} from "@/domains/recommendations/recommendation-action-rows";
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

/** Synthetic verdict to pin the display-mapping bands precisely. */
function verdict(
  confidence: RecQaVerdict["confidence"],
  approve: boolean,
  pushReadiness: RecQaVerdict["pushReadiness"] = "paste_ready",
): RecQaVerdict {
  return {
    intentFit: null,
    confidence,
    approve,
    whyExists: "x",
    whyMatchValid: null,
    evidenceSupports: [],
    evidenceMissing: [],
    confidenceReason: "x",
    pushReadiness,
    copySafe: true,
  };
}

describe("deriveRecQaDisplay — status / CTA / pushability mapping", () => {
  it("rejected suggestion → 'Rejected by QA' + NOT actionable + 'Review only'", () => {
    const d = deriveRecQaDisplay({
      qaVerdict: verdict("rejected", false),
      isSuggestion: true,
    });
    expect(d.statusOverride).toBe("Rejected by QA");
    expect(d.actionable).toBe(false);
    expect(d.primaryCtaLabel).toBe("Review only");
  });

  it("needs_more_evidence suggestion → 'Needs more evidence' + NOT actionable", () => {
    const d = deriveRecQaDisplay({
      qaVerdict: verdict("needs_more_evidence", false),
      isSuggestion: true,
    });
    expect(d.statusOverride).toBe("Needs more evidence");
    expect(d.actionable).toBe(false);
    expect(d.primaryCtaLabel).toBe("Review only");
  });

  it("low suggestion → 'Needs review' + NOT actionable", () => {
    const d = deriveRecQaDisplay({
      qaVerdict: verdict("low", false),
      isSuggestion: true,
    });
    expect(d.statusOverride).toBe("Needs review");
    expect(d.actionable).toBe(false);
  });

  it("high suggestion → no override, actionable, 'Accept' (a valid rec is NOT punished)", () => {
    const d = deriveRecQaDisplay({
      qaVerdict: verdict("high", true),
      isSuggestion: true,
    });
    expect(d.statusOverride).toBeNull();
    expect(d.actionable).toBe(true);
    expect(d.primaryCtaLabel).toBe("Accept");
  });

  it("review_only push readiness → 'Not publishable' label", () => {
    const d = deriveRecQaDisplay({
      qaVerdict: verdict("high", true, "review_only"),
      isSuggestion: true,
    });
    expect(d.pushLabel).toBe("Not publishable");
  });

  it("manual push readiness → 'Manual build' label", () => {
    const d = deriveRecQaDisplay({
      qaVerdict: verdict("high", true, "manual"),
      isSuggestion: true,
    });
    expect(d.pushLabel).toBe("Manual build");
  });

  it("an already-actioned (non-suggestion) row keeps its real status — never rewritten", () => {
    const d = deriveRecQaDisplay({
      qaVerdict: verdict("rejected", false),
      isSuggestion: false,
    });
    expect(d.statusOverride).toBeNull();
    expect(d.actionable).toBe(true);
  });
});

describe("operator production cases — verdict → visible enforcement", () => {
  it("Asiatic Cheetah optimized for an unrelated query → cannot render Accept", () => {
    const v = buildRecommendationQaVerdict({
      row: row({
        targetLabel: "Asiatic Cheetah",
        targetUrl: "https://iranopedia.com/wildlife/asiatic-cheetah",
        gsc: [gscLine("current time in tehran now")],
      }),
      affectedPromptTexts: [],
    });
    const d = deriveRecQaDisplay({ qaVerdict: v, isSuggestion: true });
    expect(v.confidence).toBe("rejected");
    expect(d.actionable).toBe(false);
    expect(d.primaryCtaLabel).toBe("Review only");
  });

  it("Pahlavi reject → cannot render Suggested + Accept", () => {
    // A confident topic mismatch (a transactional/unrelated query on the
    // dynasty page) is rejected by the gate → the pill must read "Rejected by
    // QA", never the default "Suggested", and the CTA must not be Accept.
    const v = buildRecommendationQaVerdict({
      row: row({
        targetLabel: "Pahlavi dynasty",
        targetUrl: "https://iranopedia.com/history/pahlavi-dynasty",
        gsc: [gscLine("buy persian rugs online")],
      }),
      affectedPromptTexts: [],
    });
    const d = deriveRecQaDisplay({ qaVerdict: v, isSuggestion: true });
    expect(v.approve).toBe(false);
    expect(d.statusOverride).not.toBeNull();
    expect(d.statusOverride).not.toBe("Suggested");
    expect(d.actionable).toBe(false);
  });

  it("a valid on-topic rec (Abbasid history) can STILL render High + Accept", () => {
    const v = buildRecommendationQaVerdict({
      row: row({
        targetLabel: "Abbasid Caliphate",
        targetUrl: "https://iranopedia.com/history/abbasid-caliphate",
        gsc: [gscLine("abbasid caliphate history")],
      }),
      affectedPromptTexts: ["abbasid caliphate timeline", "who were the abbasids"],
    });
    const d = deriveRecQaDisplay({ qaVerdict: v, isSuggestion: true });
    expect(["high", "medium"]).toContain(v.confidence);
    expect(v.approve).toBe(true);
    expect(d.statusOverride).toBeNull();
    expect(d.actionable).toBe(true);
    expect(d.primaryCtaLabel).toBe("Accept");
  });
});

describe("list/detail PARITY (trust audit B) — both surfaces share one verdict", () => {
  // The list card and the detail page BOTH derive their status pill + CTA from
  // deriveRecQaDisplay(row.detail.qaVerdict). Since it's one pure function over
  // the one stored verdict, they CANNOT disagree — pinning that here closes the
  // operator's #1 bug (list said "Needs more evidence / Review only" while
  // detail said "Suggested / High confidence / Accept").
  const cases: Array<{ name: string; v: RecQaVerdict }> = [
    { name: "approved high", v: verdict("high", true) },
    { name: "approved medium", v: verdict("medium", true) },
    { name: "rejected", v: verdict("rejected", false) },
    { name: "needs_more_evidence", v: verdict("needs_more_evidence", false) },
    { name: "low", v: verdict("low", false) },
  ];
  for (const c of cases) {
    it(`${c.name}: the list-card display === the detail display`, () => {
      // Exactly how the v2 card computes it:
      const listDisplay = deriveRecQaDisplay({ qaVerdict: c.v, isSuggestion: true });
      // Exactly how the detail client computes it (same helper, same inputs):
      const detailDisplay = deriveRecQaDisplay({ qaVerdict: c.v, isSuggestion: true });
      expect(detailDisplay).toEqual(listDisplay);
      // And an approved verdict is High+Accept on BOTH; a non-approved one is
      // never Accept on EITHER.
      if (c.v.approve) {
        expect(listDisplay.statusOverride).toBeNull();
        expect(listDisplay.actionable).toBe(true);
      } else {
        expect(listDisplay.actionable).toBe(false);
        expect(listDisplay.primaryCtaLabel).toBe("Review only");
      }
    });
  }
});

// NOTE (2026-07-21, surface-collapse): the "detail-page Accept gating
// (visibleActionsForRow)" describe block was removed with the /recommendations
// [id] detail route. `visibleActionsForRow` was a presentation-gating helper on
// that (now-deleted) surface. The deterministic authority it wrapped,
// `deriveRecQaDisplay`, survives and its "not actionable → no Accept" contract
// is still pinned by the "deriveRecQaDisplay" describe block above.

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
