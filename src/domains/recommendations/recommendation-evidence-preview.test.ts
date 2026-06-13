/**
 * W3 Step 3.5d (2026-05-02) — evidence-preview + recommended-move
 * pure-helper tests.
 *
 * Operator scope: each rec card surfaces ONE clean sentence for
 * evidence (no "site inventory shows…", no "cluster label strongly",
 * no "[6/6 label tokens match…]") and ONE clean sentence for the
 * recommended move (no internal motive jargon).
 *
 * Generic competitor names ("General Contractors", "Architects",
 * Houzz, Yelp, etc.) MUST be filtered out of evidence sentences via
 * `entity-pollution-filter.shouldExcludeFromCompetitorRanking`.
 */

import { describe, expect, it } from "vitest";
import {
  composeEvidencePreview,
  composeRecommendedMove,
} from "./recommendation-evidence-preview";

// ── composeEvidencePreview — single-sentence facts ────────────────────────

describe("composeEvidencePreview — share ≥ 30% with target", () => {
  it("'You're close: owned page cited 39%, needs more topical coverage.'", () => {
    expect(
      composeEvidencePreview({
        affectedPromptCount: 5,
        observationCount: 50,
        brandPrimaryShare: 0.39,
        primaryCompetitors: [],
        hasResolvedTarget: true,
      }),
    ).toBe(
      "You're close: owned page cited 39%, needs more topical coverage.",
    );
  });
});

describe("composeEvidencePreview — share 5–29% with target", () => {
  it("with a winning competitor: 'Owned page cited 12%; X winning across N prompts.'", () => {
    expect(
      composeEvidencePreview({
        affectedPromptCount: 4,
        observationCount: 40,
        brandPrimaryShare: 0.12,
        primaryCompetitors: [
          { name: "Greenberg", promptsWherePrimary: 3, totalAffectedPrompts: 4 },
        ],
        hasResolvedTarget: true,
      }),
    ).toBe(
      "Owned page cited 12%; Greenberg winning across 4 prompts.",
    );
  });

  it("without a winning competitor: 'Owned page cited 12% — exists but is not winning.'", () => {
    expect(
      composeEvidencePreview({
        affectedPromptCount: 4,
        observationCount: 40,
        brandPrimaryShare: 0.12,
        primaryCompetitors: [],
        hasResolvedTarget: true,
      }),
    ).toBe("Owned page cited 12% — exists but is not winning.");
  });
});

describe("composeEvidencePreview — share = 0 (no owned page cited)", () => {
  it("'No owned page cited across N observations; X winning.'", () => {
    expect(
      composeEvidencePreview({
        affectedPromptCount: 6,
        observationCount: 60,
        brandPrimaryShare: 0,
        primaryCompetitors: [
          { name: "De Mattei", promptsWherePrimary: 4, totalAffectedPrompts: 6 },
        ],
      }),
    ).toBe(
      "No owned page cited across 60 observations; De Mattei winning.",
    );
  });

  it("'No owned page cited across N observations.' (no real competitor)", () => {
    expect(
      composeEvidencePreview({
        affectedPromptCount: 6,
        observationCount: 60,
        brandPrimaryShare: 0,
        primaryCompetitors: [],
      }),
    ).toBe("No owned page cited across 60 observations.");
  });

  it("singular grammar: 'No owned page cited across 1 observation.'", () => {
    expect(
      composeEvidencePreview({
        affectedPromptCount: 1,
        observationCount: 1,
        brandPrimaryShare: 0,
        primaryCompetitors: [],
      }),
    ).toBe("No owned page cited across 1 observation.");
  });
});

describe("composeEvidencePreview — generic-competitor leak filter", () => {
  it("'General Contractors' is dropped from competitor evaluation", () => {
    const sentence = composeEvidencePreview({
      affectedPromptCount: 4,
      observationCount: 40,
      brandPrimaryShare: 0,
      primaryCompetitors: [
        // Generic noun — operator browser audit flagged this leaking
        // through with "General Contractors winning · 100%".
        { name: "General Contractors", promptsWherePrimary: 4, totalAffectedPrompts: 4 },
      ],
    });
    expect(sentence).not.toMatch(/General Contractors/);
    // Falls back to non-competitor copy.
    expect(sentence).toBe("No owned page cited across 40 observations.");
  });

  it("'Architects' is dropped from competitor evaluation", () => {
    const sentence = composeEvidencePreview({
      affectedPromptCount: 4,
      observationCount: 40,
      brandPrimaryShare: 0.1,
      primaryCompetitors: [
        { name: "Architects", promptsWherePrimary: 4, totalAffectedPrompts: 4 },
      ],
      hasResolvedTarget: true,
    });
    expect(sentence).not.toMatch(/Architects/);
    expect(sentence).toBe("Owned page cited 10% — exists but is not winning.");
  });

  it("real competitors still surface (filter is a denylist, not a blanket suppress)", () => {
    const sentence = composeEvidencePreview({
      affectedPromptCount: 4,
      observationCount: 40,
      brandPrimaryShare: 0,
      primaryCompetitors: [
        { name: "De Mattei Construction", promptsWherePrimary: 3, totalAffectedPrompts: 4 },
      ],
    });
    expect(sentence).toMatch(/De Mattei Construction winning/);
  });
});

describe("composeEvidencePreview — generic competitor-dominant case", () => {
  it("with sharePct present: 'Your page cited X%; Y winning across N prompts.'", () => {
    expect(
      composeEvidencePreview({
        affectedPromptCount: 6,
        observationCount: 60,
        brandPrimaryShare: 0.06,
        primaryCompetitors: [
          { name: "Greenberg", promptsWherePrimary: 4, totalAffectedPrompts: 6 },
        ],
        hasResolvedTarget: false,
      }),
    ).toBe(
      "Your page cited 6%; Greenberg winning across 6 prompts.",
    );
  });
});

describe("composeEvidencePreview — null share is treated as zero share", () => {
  it("null share + no competitor → 'No owned page cited across N observations.'", () => {
    // Operator scope: missing share data is the same operator state
    // as zero share — no signal that Ritz was cited. We surface the
    // observation count so the operator can gauge how thin the
    // sample is.
    expect(
      composeEvidencePreview({
        affectedPromptCount: 3,
        observationCount: 12,
        brandPrimaryShare: null,
        primaryCompetitors: [],
      }),
    ).toBe("No owned page cited across 12 observations.");
  });
});

// ── composeRecommendedMove — action-aware single sentence ─────────────────

describe("composeRecommendedMove — action-aware single sentence", () => {
  it("create_new_page with topic", () => {
    expect(
      composeRecommendedMove({
        action: "create_new_page",
        topic: "older-home rebuild",
        pageName: null,
      }),
    ).toBe("Spin up a dedicated older-home rebuild page so AI has a clear place to cite.");
  });

  it("create_new_page without topic", () => {
    expect(
      composeRecommendedMove({
        action: "create_new_page",
        topic: null,
        pageName: null,
      }),
    ).toBe("Spin up a dedicated page so AI has a clear place to cite.");
  });

  it("expand_existing_page with topic + pageName", () => {
    expect(
      composeRecommendedMove({
        action: "expand_existing_page",
        topic: "kitchen remodel",
        pageName: "Whole Home Remodel",
      }),
    ).toBe("Add a kitchen remodel section to the Whole Home Remodel page so AI can cite it directly.");
  });

  it("strengthen_existing_page with topic + pageName", () => {
    expect(
      composeRecommendedMove({
        action: "strengthen_existing_page",
        topic: "structural remodel",
        pageName: "Whole Home Remodel",
      }),
    ).toBe("Tighten the Whole Home Remodel copy + descriptors around structural remodel so AI ranks your page first.");
  });

  it("merge_or_dedupe with pageName", () => {
    expect(
      composeRecommendedMove({
        action: "merge_or_dedupe",
        topic: null,
        pageName: "Whole Home Remodel",
      }),
    ).toBe("Merge overlapping owned pages into the Whole Home Remodel so AI doesn't split citations.");
  });

  it("split_or_separate_page with topic + pageName", () => {
    expect(
      composeRecommendedMove({
        action: "split_or_separate_page",
        topic: "kitchen remodel",
        pageName: "Remodel",
      }),
    ).toBe("Pull kitchen remodel content out of the Remodel into its own page so AI can cite the right one.");
  });

  it("watch action — single sentence about defending", () => {
    expect(
      composeRecommendedMove({
        action: "watch",
        topic: null,
        pageName: null,
      }),
    ).toBe("Keep an eye on this cluster — you're currently winning.");
  });

  it("needs_review action — operator-decision sentence", () => {
    expect(
      composeRecommendedMove({
        action: "needs_review",
        topic: null,
        pageName: null,
      }),
    ).toBe("Pick a direction before Beacon proposes specific edits.");
  });

  it("each composed sentence contains no internal motive jargon", () => {
    // Operator browser audit (third pass) flagged "Capture absent
    // cluster" / "Counter competitor" leakage. The composed move must
    // never contain those raw motive enum names.
    const candidates = [
      composeRecommendedMove({
        action: "create_new_page",
        topic: "kitchen remodel",
        pageName: null,
      }),
      composeRecommendedMove({
        action: "expand_existing_page",
        topic: "older-home rebuild",
        pageName: "Custom Home Builder",
      }),
      composeRecommendedMove({
        action: "strengthen_existing_page",
        topic: "permitting",
        pageName: "Custom Home Builder",
      }),
    ];
    for (const sentence of candidates) {
      expect(sentence).not.toMatch(/capture absent cluster/i);
      expect(sentence).not.toMatch(/counter competitor/i);
      expect(sentence).not.toMatch(/improve_close_prompt/i);
    }
  });
});
