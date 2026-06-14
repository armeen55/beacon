/**
 * W3 Step 3.15 (2026-05-04) — FAQ Q+A grouping + title polish tests.
 *
 * Operator-locked rules (post-§3.13 persist + browser audit):
 *   1. A matched FAQ Q+A pair (faq_question[new]:<hash> +
 *      faq_answer[new]:<hash>) renders as ONE row in the ranked
 *      action table — never two duplicate "question" + "answer" rows.
 *   2. The grouped row's title uses the ACTUAL question text from
 *      `targetElement.proposedText`, not the displayLabel — so
 *      "FAQ question: What to look for in a luxury home builder
 *      (new)" never leaks into the table column.
 *   3. The grouped row's drawer carries the answer's full text on a
 *      new `faqAnswerText` field so question + answer render
 *      side-by-side.
 *   4. Orphan FAQ rows (question without paired answer or vice-
 *      versa) are SUPPRESSED from the main table.
 *   5. H2 row titles drop the dangling "an" article: `Add "..." H2`
 *      passes; `Add an "..." H2` does not.
 *   6. Trailing noise parentheticals — `(new)`, `(new H2)`,
 *      `(question)`, `(answer)` — are stripped from displayLabels
 *      before they reach the title; legitimate parentheticals like
 *      `(no footprint increase)` are preserved.
 *   7. Duplicate hashes within a single rec are not re-emitted (the
 *      validator rejects them upstream; this is defensive).
 */

import { describe, expect, it } from "vitest";
import {
  buildRecommendationActionRows,
  composeFaqPairRowTitle,
  composeEditRowTitle,
  partitionEditsForFaqPairing,
  extractElementKeyHashSuffix,
} from "./recommendation-action-rows";
import { cleanDisplayLabel } from "./recommendation-title-humanizer";
import type { LiveRecQueueItem } from "./load-queue";
import type { RecommendedEditRow } from "./recommended-edits-persistence";

// ── Fixture builders ───────────────────────────────────────────────────

function makeRec(
  overrides: Partial<LiveRecQueueItem> = {},
): LiveRecQueueItem {
  const base: LiveRecQueueItem = {
    stableKey: "create_cluster_page:topic:Test Cluster",
    type: "create_cluster_page",
    title: "Test cluster",
    description: "test",
    affectedPromptIds: ["p1"],
    clusterLabel: "Test Cluster",
    clusterKind: "topic",
    severity: "medium",
    effort: "medium",
    evidence: {
      promptCount: 4,
      observationCount: 12,
      categoryBreakdown: { outranked: 4 },
      dominantCompetitors: [],
      descriptorsNearBrand: [],
      maxSignalStrength: 0.6,
      primaryCompetitors: [],
      brandPrimaryPromptCount: 0,
      fragmentedPromptCount: 0,
    },
    rank: 1,
    score: 100,
    tier: "now",
    reasoning: "test reasoning",
    resolution: {
      tier: "deterministic_only",
      action: "create_new_page",
      motive: "capture_absent_cluster",
      targetUrl: "https://example.com/luxury-home-builder",
      reasoning: "test",
      confidence: "medium",
      evidenceRefs: [],
      pageBrief: null,
      suggestedEdits: [],
      cannibalization: null,
      risks: [],
      needsHumanReview: false,
      confidenceReason: "test",
    },
    engineConfidence: { confidence: "medium", reasons: ["edit_medium_or_lower_confidence"] },
    ...overrides,
  };
  return base;
}

function makeEdit(
  overrides: Partial<RecommendedEditRow> = {},
): RecommendedEditRow {
  const base: RecommendedEditRow = {
    id: "edit-1",
    tenant_id: "tenant-test",
    rec_id: "create_cluster_page:topic:Test Cluster",
    action_type: "add_h2_section",
    target_url: "https://example.com/luxury-home-builder",
    target_element_key: "h2[new]:abc12345",
    display_label: "How to choose a luxury home builder",
    current_text: null,
    proposed_text: "How to choose a luxury home builder\n\nWe coordinate ...",
    why: "Mirrors fanout query",
    evidence: [{ type: "prompt", promptId: "p1" }],
    expected_impact: null,
    difficulty: "low",
    confidence: "medium",
    measurement_plan: null,
    risks: [],
    source: "openai",
    provider_name: "openai",
    evidence_hash: "evhash",
    model: "gpt-5-mini",
    cost_usd: 0.005,
    created_at: "2026-05-04T00:00:00Z",
    updated_at: "2026-05-04T00:00:00Z",
    implementation_status: "recommended",
  };
  return { ...base, ...overrides };
}

// ── Operator-locked rule 1+2: FAQ Q+A pair → one row, real text ────────

describe("FAQ Q+A grouping — one row per pair", () => {
  it("matched faq_question + faq_answer pair → exactly ONE row", () => {
    const question = makeEdit({
      id: "q1",
      action_type: "add_faq",
      target_element_key: "faq_question[new]:lux01",
      display_label: "FAQ question: What to look for (new)",
      proposed_text: "What should I look for in a luxury home builder in the Bay Area?",
    });
    const answer = makeEdit({
      id: "a1",
      action_type: "add_faq",
      target_element_key: "faq_answer[new]:lux01",
      display_label: "FAQ answer: What to look for (new)",
      proposed_text:
        "Ritz Builders offers architect-led design-build services. Review portfolios, permitting experience, and budget management.",
    });
    const rows = buildRecommendationActionRows({
      queue: [{ rec: makeRec(), response: null, edits: [question, answer] }],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].actionType).toBe("add_faq");
    expect(rows[0].id).toMatch(/faq-pair::lux01$/);
  });

  it("the grouped row's title uses the actual question text (proposedText), not the displayLabel", () => {
    const question = makeEdit({
      id: "q1",
      action_type: "add_faq",
      target_element_key: "faq_question[new]:lux01",
      display_label: "FAQ question: What to look for in a luxury home builder (new)",
      proposed_text: "What should I look for in a luxury home builder in the Bay Area?",
    });
    const answer = makeEdit({
      id: "a1",
      action_type: "add_faq",
      target_element_key: "faq_answer[new]:lux01",
      display_label: "FAQ answer: What to look for (new)",
      proposed_text: "Answer body that is at least thirty words long for the validator's structural-quality gate so it passes.",
    });
    const rows = buildRecommendationActionRows({
      queue: [{ rec: makeRec(), response: null, edits: [question, answer] }],
    });
    expect(rows[0].title).toContain(
      "What should I look for in a luxury home builder in the Bay Area?",
    );
    // Operator-locked: the displayLabel's noise should NEVER reach
    // the title.
    expect(rows[0].title).not.toMatch(/\(new\)/);
    expect(rows[0].title).not.toMatch(/\(question\)/);
    expect(rows[0].title).not.toMatch(/\(answer\)/);
    expect(rows[0].title).not.toMatch(/FAQ question:/i);
    expect(rows[0].title).not.toMatch(/FAQ answer:/i);
  });

  it("title ends with 'to the {target} page' (operator scope)", () => {
    const question = makeEdit({
      id: "q1",
      action_type: "add_faq",
      target_element_key: "faq_question[new]:lux01",
      proposed_text: "What should I look for?",
      target_url: "https://example.com/luxury-home-builder-bay-area",
    });
    const answer = makeEdit({
      id: "a1",
      action_type: "add_faq",
      target_element_key: "faq_answer[new]:lux01",
      proposed_text: "Answer.",
      target_url: "https://example.com/luxury-home-builder-bay-area",
    });
    const rows = buildRecommendationActionRows({
      queue: [{ rec: makeRec(), response: null, edits: [question, answer] }],
    });
    expect(rows[0].title).toMatch(/to the .+ page$/);
  });

  it("the grouped row's drawer carries both question + answer text (faqAnswerText)", () => {
    const question = makeEdit({
      id: "q1",
      action_type: "add_faq",
      target_element_key: "faq_question[new]:lux01",
      proposed_text: "What should I look for in a luxury home builder?",
    });
    const answer = makeEdit({
      id: "a1",
      action_type: "add_faq",
      target_element_key: "faq_answer[new]:lux01",
      proposed_text: "Ritz Builders coordinates architecture, engineering, and permitting.",
    });
    const rows = buildRecommendationActionRows({
      queue: [{ rec: makeRec(), response: null, edits: [question, answer] }],
    });
    expect(rows[0].detail.proposedText).toBe(
      "What should I look for in a luxury home builder?",
    );
    expect(rows[0].detail.faqAnswerText).toBe(
      "Ritz Builders coordinates architecture, engineering, and permitting.",
    );
  });

  it("non-FAQ row's drawer has faqAnswerText=null (clean default)", () => {
    const h2 = makeEdit({
      id: "h2-1",
      action_type: "add_h2_section",
      target_element_key: "h2[new]:abc",
      display_label: "How to choose",
      proposed_text: "How to choose\n\nbody",
    });
    const rows = buildRecommendationActionRows({
      queue: [{ rec: makeRec(), response: null, edits: [h2] }],
    });
    expect(rows[0].detail.faqAnswerText).toBeNull();
  });
});

// ── Operator-locked rule 4: orphan FAQ → suppressed from main table ───

describe("FAQ Q+A grouping — orphan suppression", () => {
  it("unpaired faq_question alone → no main-table row", () => {
    const question = makeEdit({
      id: "q1",
      action_type: "add_faq",
      target_element_key: "faq_question[new]:lux01",
      proposed_text: "What should I look for?",
    });
    const rows = buildRecommendationActionRows({
      queue: [{ rec: makeRec(), response: null, edits: [question] }],
    });
    // The rec itself surfaces as a meta-action row (regenerate_edit
    // OR review_decision OR create_page) only if its meta-trigger
    // logic decides so. For a `create_cluster_page` rec with
    // `targetUrl != NEEDS_NEW_PAGE`, the existing meta-path skips
    // (no `metaKind`); the rec is suppressed entirely. Orphan FAQs
    // never render as active main rows.
    for (const r of rows) {
      expect(r.actionType).not.toBe("add_faq");
    }
  });

  it("unpaired faq_answer alone → no main-table row", () => {
    const answer = makeEdit({
      id: "a1",
      action_type: "add_faq",
      target_element_key: "faq_answer[new]:lux01",
      proposed_text: "Answer body that's at least thirty words long for the structural quality gate to be satisfied in a downstream pass.",
    });
    const rows = buildRecommendationActionRows({
      queue: [{ rec: makeRec(), response: null, edits: [answer] }],
    });
    for (const r of rows) {
      expect(r.actionType).not.toBe("add_faq");
    }
  });

  it("two pairs sharing different hashes → exactly two grouped rows (no duplication)", () => {
    const edits = [
      makeEdit({
        id: "q1",
        action_type: "add_faq",
        target_element_key: "faq_question[new]:hashA",
        proposed_text: "Question A?",
      }),
      makeEdit({
        id: "a1",
        action_type: "add_faq",
        target_element_key: "faq_answer[new]:hashA",
        proposed_text: "Answer A.",
      }),
      makeEdit({
        id: "q2",
        action_type: "add_faq",
        target_element_key: "faq_question[new]:hashB",
        proposed_text: "Question B?",
      }),
      makeEdit({
        id: "a2",
        action_type: "add_faq",
        target_element_key: "faq_answer[new]:hashB",
        proposed_text: "Answer B.",
      }),
    ];
    const rows = buildRecommendationActionRows({
      queue: [{ rec: makeRec(), response: null, edits }],
    });
    const faqRows = rows.filter((r) => r.actionType === "add_faq");
    expect(faqRows).toHaveLength(2);
    const hashes = faqRows.map((r) => r.id.split("::").pop());
    expect(hashes.sort()).toEqual(["hashA", "hashB"]);
  });

  it("FAQ pair + H2 in same rec → 2 rows total (1 grouped FAQ + 1 H2)", () => {
    const edits = [
      makeEdit({
        id: "q1",
        action_type: "add_faq",
        target_element_key: "faq_question[new]:hashA",
        proposed_text: "Question A?",
      }),
      makeEdit({
        id: "a1",
        action_type: "add_faq",
        target_element_key: "faq_answer[new]:hashA",
        proposed_text: "Answer A body.",
      }),
      makeEdit({
        id: "h1",
        action_type: "add_h2_section",
        target_element_key: "h2[new]:xyz",
        display_label: "How to choose",
        proposed_text: "How to choose\n\nbody",
      }),
    ];
    const rows = buildRecommendationActionRows({
      queue: [{ rec: makeRec(), response: null, edits }],
    });
    expect(rows).toHaveLength(2);
    const types = new Set(rows.map((r) => r.actionType));
    expect(types).toEqual(new Set(["add_faq", "edit_h2"]));
  });
});

// ── Operator-locked rule 5: H2 title drops the dangling "an" ───────────

describe("H2 row title — no dangling article", () => {
  it("'Add \"...\" H2' not 'Add an \"...\" H2'", () => {
    const h2 = makeEdit({
      id: "h2",
      action_type: "add_h2_section",
      target_element_key: "h2[new]:abc",
      display_label: "How to choose a luxury custom home builder",
      proposed_text: "heading\n\nbody",
    });
    const title = composeEditRowTitle({
      edit: h2,
      targetLabel: "Luxury Home Builder Bay Area page",
      topicTag: null,
    });
    expect(title).toMatch(/^Add\s/);
    expect(title).not.toMatch(/^Add an\s/);
  });

  it("strips trailing (new) noise from H2 title", () => {
    const h2 = makeEdit({
      id: "h2",
      action_type: "add_h2_section",
      target_element_key: "h2[new]:abc",
      display_label: "H2: How to choose a luxury custom home builder (new)",
      proposed_text: "heading\n\nbody",
    });
    const title = composeEditRowTitle({
      edit: h2,
      targetLabel: "Luxury Home Builder Bay Area page",
      topicTag: null,
    });
    expect(title).toContain("How to choose a luxury custom home builder");
    expect(title).not.toMatch(/\(new\)/);
    expect(title).not.toMatch(/^H2:/);
  });

  it("strips leading 'H2:' from displayLabel before quoting", () => {
    const h2 = makeEdit({
      id: "h2",
      action_type: "add_h2_section",
      target_element_key: "h2[new]:abc",
      display_label: "H2: Working with a luxury custom home builder",
      proposed_text: "heading\n\nbody",
    });
    const title = composeEditRowTitle({
      edit: h2,
      targetLabel: "Luxury Home Builder Bay Area page",
      topicTag: null,
    });
    // Cleaned label survives; "H2:" prefix is dropped before quoting.
    expect(title).toMatch(/Working with a luxury custom home builder/);
    expect(title).not.toMatch(/H2:\s*Working/);
  });
});

// ── Operator-locked rule 6: cleanDisplayLabel strips noise parens ─────

describe("cleanDisplayLabel — trailing noise parentheticals", () => {
  it("strips trailing (new)", () => {
    expect(
      cleanDisplayLabel("How to choose a luxury custom home builder (new)"),
    ).toBe("How to choose a luxury custom home builder");
  });

  it("strips trailing (new H2) (case-insensitive)", () => {
    expect(cleanDisplayLabel("Working with a luxury builder (NEW H2)")).toBe(
      "Working with a luxury builder",
    );
    expect(cleanDisplayLabel("Working with a luxury builder (new H2)")).toBe(
      "Working with a luxury builder",
    );
  });

  it("strips trailing (question) and (answer)", () => {
    expect(
      cleanDisplayLabel("FAQ: modernize without expansion (question)"),
    ).toBe("modernize without expansion");
    expect(
      cleanDisplayLabel("FAQ: modernize without expansion (answer)"),
    ).toBe("modernize without expansion");
  });

  it("PRESERVES legitimate trailing parentheticals", () => {
    // "(no footprint increase)" is content the operator wants — it's
    // not a noise tag, so the cleaner leaves it alone.
    expect(
      cleanDisplayLabel("Modernize older Cupertino homes (no footprint increase)"),
    ).toBe("Modernize older Cupertino homes (no footprint increase)");
    expect(
      cleanDisplayLabel("Best builder (Atherton design-build comparisons)"),
    ).toBe("Best builder (Atherton design-build comparisons)");
  });

  it("strips chained noise — (new) followed by another known token", () => {
    expect(cleanDisplayLabel("Working H2 (new) (question)")).toBe(
      "Working H2",
    );
  });

  it("strips bare parenthesized type tags — (H2)/(FAQ)/(section) (wave-12 buyer's-eye)", () => {
    // Caught on the customer queue: "Design-build for modern Bay Area homes
    // (H2)" etc. The type already shows in its own column + the top-pick
    // appends it, so the parenthesized tag is redundant noise. (A BARE
    // trailing token stays — see the "Working H2" test above; the display
    // layer never guesses whether a bare token is content or artifact.)
    expect(
      cleanDisplayLabel("Design-build for modern Bay Area homes (H2)"),
    ).toBe("Design-build for modern Bay Area homes");
    expect(cleanDisplayLabel("Why hire an architect-led firm (FAQ)")).toBe(
      "Why hire an architect-led firm",
    );
    expect(cleanDisplayLabel("Underground basements (section)")).toBe(
      "Underground basements",
    );
    // ...but a genuine parenthetical is still preserved.
    expect(cleanDisplayLabel("Custom homes (no footprint increase)")).toBe(
      "Custom homes (no footprint increase)",
    );
  });
});

// ── Operator-locked rule 7: defensive partitioner ─────────────────────

describe("partitionEditsForFaqPairing — defensive grouping", () => {
  it("orphan FAQ rows land in orphanFaqEdits, never in faqPairs", () => {
    const q = makeEdit({
      id: "q1",
      action_type: "add_faq",
      target_element_key: "faq_question[new]:hashOnlyQ",
      proposed_text: "?",
    });
    const a = makeEdit({
      id: "a1",
      action_type: "add_faq",
      target_element_key: "faq_answer[new]:hashOnlyA",
      proposed_text: "answer body that has at least thirty words to satisfy the gate downstream.",
    });
    const out = partitionEditsForFaqPairing([q, a]);
    expect(out.faqPairs).toHaveLength(0);
    expect(out.orphanFaqEdits).toHaveLength(2);
    expect(out.nonFaqEdits).toHaveLength(0);
  });

  it("non-FAQ edits flow through nonFaqEdits unchanged", () => {
    const h2 = makeEdit({
      id: "h2",
      action_type: "add_h2_section",
      target_element_key: "h2[new]:xyz",
      display_label: "How to choose",
      proposed_text: "x",
    });
    const out = partitionEditsForFaqPairing([h2]);
    expect(out.nonFaqEdits).toHaveLength(1);
    expect(out.nonFaqEdits[0].id).toBe("h2");
    expect(out.faqPairs).toHaveLength(0);
    expect(out.orphanFaqEdits).toHaveLength(0);
  });

  it("duplicate FAQ question keys for the same hash are NOT pair-emitted twice (defensive against validator gap)", () => {
    const q1 = makeEdit({
      id: "q1",
      action_type: "add_faq",
      target_element_key: "faq_question[new]:dupHash",
      proposed_text: "Q1?",
    });
    const q2 = makeEdit({
      id: "q2",
      action_type: "add_faq",
      target_element_key: "faq_question[new]:dupHash",
      proposed_text: "Q2?",
    });
    const a = makeEdit({
      id: "a1",
      action_type: "add_faq",
      target_element_key: "faq_answer[new]:dupHash",
      proposed_text: "answer with at least thirty words to be safe in case the structural quality gate downstream looks here.",
    });
    const out = partitionEditsForFaqPairing([q1, q2, a]);
    expect(out.faqPairs).toHaveLength(1);
    // Second question lands in nonFaqEdits (defensive bucket; the
    // validator already rejects duplicates upstream).
    expect(out.nonFaqEdits).toHaveLength(1);
    expect(out.nonFaqEdits[0].id).toBe("q2");
  });

  it("returns empty arrays when given an empty edit list", () => {
    const out = partitionEditsForFaqPairing([]);
    expect(out.faqPairs).toEqual([]);
    expect(out.nonFaqEdits).toEqual([]);
    expect(out.orphanFaqEdits).toEqual([]);
  });
});

// ── extractElementKeyHashSuffix ───────────────────────────────────────

describe("extractElementKeyHashSuffix", () => {
  it("extracts hash from additive faq_question/faq_answer keys", () => {
    expect(
      extractElementKeyHashSuffix("faq_question[new]:abc12345"),
    ).toBe("abc12345");
    expect(extractElementKeyHashSuffix("faq_answer[new]:lux01")).toBe(
      "lux01",
    );
  });

  it("returns null for malformed / null input", () => {
    expect(extractElementKeyHashSuffix(null)).toBeNull();
    expect(extractElementKeyHashSuffix(undefined)).toBeNull();
    expect(extractElementKeyHashSuffix("")).toBeNull();
    expect(extractElementKeyHashSuffix("h2[new]")).toBeNull();
  });
});

// ── composeFaqPairRowTitle ─────────────────────────────────────────────

describe("composeFaqPairRowTitle", () => {
  it("uses the question text verbatim, curly-quoted", () => {
    const t = composeFaqPairRowTitle({
      questionText: "What should I look for in a luxury home builder?",
      targetLabel: "Luxury page",
    });
    expect(t).toBe(
      'Add FAQ: “What should I look for in a luxury home builder?” to the Luxury page',
    );
  });

  it("falls back when the question text is empty / null", () => {
    expect(
      composeFaqPairRowTitle({ questionText: null, targetLabel: "Luxury page" }),
    ).toBe("Add FAQ to the Luxury page");
    expect(
      composeFaqPairRowTitle({ questionText: "  ", targetLabel: "Luxury page" }),
    ).toBe("Add FAQ to the Luxury page");
  });

  it("truncates very long question text", () => {
    const long = "a".repeat(150);
    const t = composeFaqPairRowTitle({
      questionText: long,
      targetLabel: "Page",
    });
    // Curly-quoted truncated prefix; ellipsis added.
    expect(t).toMatch(/^Add FAQ: “a+/);
    expect(t).toMatch(/…” to the Page$/);
  });
});
