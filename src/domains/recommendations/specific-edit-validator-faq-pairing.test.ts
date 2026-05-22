/**
 * W3 Step 3.8 (2026-05-03) — FAQ Q+A pairing validator tests.
 *
 * Pin the operator-locked FAQ contract:
 *
 *   1. Question rows carry `faq_question[new]:<hash>` with question-
 *      only text. Bundled Q+A in one row → reject.
 *   2. Answer rows carry `faq_answer[new]:<hash>` with answer-only
 *      text (40-120 words preferred, ≥ 30 words minimum). Bare
 *      questions in answer rows → reject.
 *   3. Bundle-level: every faq_question[new]:X must have a matching
 *      faq_answer[new]:X (and vice versa).
 *   4. Public-copy gates from §3.7 + §3.7s still run on the answer
 *      row body (brand-claim grounding, no em dashes, Ritz Builders
 *      first mention).
 */

import { describe, expect, it } from "vitest";
import { validateSpecificEdit, validateSpecificEditBundle } from "./specific-edit-validator";
import type { SpecificEdit, SpecificEditBundle } from "./specific-edit-provider";
import type { SpecificEditEvidencePacket } from "./specific-edit-evidence";
import type { BrandAssertion } from "./brand-assertions";

// ── Fixture builders ───────────────────────────────────────────────────

function makePacket(
  overrides: Partial<SpecificEditEvidencePacket> = {},
): SpecificEditEvidencePacket {
  const base: SpecificEditEvidencePacket = {
    schemaVersion: "specific-edit/v1",
    generatedAt: "2026-05-03T00:00:00Z",
    tenantId: "tenant-ritz-founder",
    recId: "rec-test",
    clusterId: null,
    clusterLabel: "Whole Home Renovation Builders",
    clusterKind: "topic",
    affectedPrompts: [
      {
        promptId: "11111111-2222-3333-4444-555555555555",
        promptText: "best whole home remodel builders bay area",
        category: "absent",
        observationCount: 6,
        brandPrimaryShare: 0,
        topPrimaryCompetitor: null,
        descriptorsNearBrand: [],
        actualSearchQueries: [],
        citedSourcePages: [],
        descriptorWindows: [],
      },
    ],
    ownedPageCandidates: [],
    targetPageElements: [],
    competitorAngles: [],
    priorOutcomes: [],
    allowedTargetUrls: ["https://example.com/services/whole-home-remodel"],
    allowedActionTypes: ["add_faq", "rewrite_faq", "add_h2_section"],
    aiSearchSignal: {
      topSearchQueries: [],
      topDescriptors: [],
      topCompetitorCoMentions: [],
      caps: {
        maxSearchQueries: 10,
        maxDescriptors: 12,
        maxCompetitorCoMentions: 8,
      },
    },
    competitorPageBlueprints: [],
    crossTenantPatterns: [],
    brandAssertions: [
      {
        id: "ritz_process",
        phrase: "architect-led design-build",
        category: "process",
      },
    ],
    evidenceHash: "deadbeef00000000",
  };
  return { ...base, ...overrides };
}

function makeFaqQuestionEdit(args: {
  hash: string;
  proposedText: string;
  displayLabel?: string;
}): SpecificEdit {
  return {
    actionType: "add_faq",
    targetUrl: "https://example.com/services/whole-home-remodel",
    targetElement: {
      elementKey: `faq_question[new]:${args.hash}`,
      displayLabel:
        args.displayLabel ?? "Architect-led design-build inquiry",
      currentText: null,
      proposedText: args.proposedText,
    },
    why: "operator-facing reasoning lives here",
    expectedImpact: "anchors a real customer-voice question on the page",
    measurementPlan: "re-poll affected prompts at T+7 / T+14",
    risks: [],
    difficulty: "low",
    confidence: "medium",
    source: "openai",
    providerName: "openai",
    model: "gpt-5-mini",
    costUsd: 0.005,
    evidence: [
      { type: "prompt", promptId: "11111111-2222-3333-4444-555555555555" },
    ],
  };
}

function makeFaqAnswerEdit(args: {
  hash: string;
  proposedText: string;
  displayLabel?: string;
}): SpecificEdit {
  return {
    actionType: "add_faq",
    targetUrl: "https://example.com/services/whole-home-remodel",
    targetElement: {
      elementKey: `faq_answer[new]:${args.hash}`,
      displayLabel:
        args.displayLabel ?? "Architect-led design-build answer",
      currentText: null,
      proposedText: args.proposedText,
    },
    why: "operator-facing reasoning lives here",
    expectedImpact: "anchors a customer-voice answer",
    measurementPlan: "re-poll affected prompts at T+7 / T+14",
    risks: [],
    difficulty: "low",
    confidence: "medium",
    source: "openai",
    providerName: "openai",
    model: "gpt-5-mini",
    costUsd: 0.005,
    evidence: [
      { type: "prompt", promptId: "11111111-2222-3333-4444-555555555555" },
    ],
  };
}

function makeBundle(
  edits: SpecificEdit[],
  packet: SpecificEditEvidencePacket,
): SpecificEditBundle {
  return {
    schemaVersion: "specific-edit-bundle/v1",
    generatedAt: "2026-05-03T00:00:00Z",
    tenantId: packet.tenantId,
    recId: packet.recId,
    evidenceHash: packet.evidenceHash,
    providerName: "openai",
    recommendations: edits,
    totalCostUsd: edits.reduce((s, e) => s + (e.costUsd ?? 0), 0),
  };
}

const VALID_QUESTION =
  "Which builders should I hire in Palo Alto for an architect-designed custom home?";

const VALID_ANSWER =
  "Ritz Builders emphasizes an architect-led design-build approach for custom homes in Palo Alto, coordinating architecture, engineering, permitting, and construction from the earliest stages. Our team handles complex Palo Alto sites including deep foundations, basement scopes, and strict city review, so the design intent stays buildable from feasibility through completion.";

// ── 1. Per-edit shape gates ─────────────────────────────────────────

describe("W3 §3.8 — per-edit FAQ shape", () => {
  it("rejects bundled Q+A in a faq_question row (operator-caught failure)", () => {
    const bundled =
      `${VALID_QUESTION}\n${VALID_ANSWER}`;
    const edit = makeFaqQuestionEdit({
      hash: "abc12345",
      proposedText: bundled,
    });
    const result = validateSpecificEdit(edit, makePacket());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.field).toBe("targetElement.proposedText");
      expect(result.reason).toMatch(/contains an answer body/);
    }
  });

  it("rejects 'Q: … \\n A: …' bundled format on a faq_question row", () => {
    const edit = makeFaqQuestionEdit({
      hash: "abc12345",
      proposedText:
        `Q: ${VALID_QUESTION}\n\nA: ${VALID_ANSWER}`,
    });
    const result = validateSpecificEdit(edit, makePacket());
    expect(result.ok).toBe(false);
  });

  it("ALLOWS a clean question-only faq_question row", () => {
    const edit = makeFaqQuestionEdit({
      hash: "abc12345",
      proposedText: VALID_QUESTION,
    });
    const result = validateSpecificEdit(edit, makePacket());
    expect(result.ok).toBe(true);
  });

  it("rejects a faq_answer row that is just a bare question", () => {
    const edit = makeFaqAnswerEdit({
      hash: "abc12345",
      proposedText: VALID_QUESTION,
    });
    const result = validateSpecificEdit(edit, makePacket());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/contains question text instead of an answer/);
    }
  });

  it("rejects a faq_answer row under 30 words (operator floor)", () => {
    const edit = makeFaqAnswerEdit({
      hash: "abc12345",
      proposedText:
        "Ritz Builders coordinates architecture, engineering, permitting, and construction. Our team handles complex Palo Alto sites and basement scopes.",
    });
    const result = validateSpecificEdit(edit, makePacket());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/too short/);
    }
  });

  it("ALLOWS a 40-120 word faq_answer body that follows the contract", () => {
    const edit = makeFaqAnswerEdit({
      hash: "abc12345",
      proposedText: VALID_ANSWER,
    });
    const result = validateSpecificEdit(edit, makePacket());
    expect(result.ok).toBe(true);
  });
});

// ── 2. Bundle-level pairing ─────────────────────────────────────────

describe("W3 §3.8 — bundle-level FAQ pairing", () => {
  it("ACCEPTS a paired Q+A bundle (one question + one answer with shared hash)", () => {
    const packet = makePacket();
    const bundle = makeBundle(
      [
        makeFaqQuestionEdit({
          hash: "shared12",
          proposedText: VALID_QUESTION,
        }),
        makeFaqAnswerEdit({
          hash: "shared12",
          proposedText: VALID_ANSWER,
        }),
      ],
      packet,
    );
    const result = validateSpecificEditBundle(bundle, packet);
    expect(result.ok).toBe(true);
    expect(result.acceptedCount).toBe(2);
    expect(result.bundleErrors).toEqual([]);
  });

  it("REJECTS an orphan question (no matching answer hash)", () => {
    const packet = makePacket();
    const bundle = makeBundle(
      [
        makeFaqQuestionEdit({
          hash: "orphan01",
          proposedText: VALID_QUESTION,
        }),
      ],
      packet,
    );
    const result = validateSpecificEditBundle(bundle, packet);
    expect(result.ok).toBe(false);
    expect(result.bundleErrors.length).toBeGreaterThanOrEqual(1);
    expect(result.bundleErrors[0].reason).toMatch(
      /unpaired FAQ question[\s\S]*?orphan01/,
    );
    // The per-edit row should also be marked failed.
    expect(result.perEdit[0].result.ok).toBe(false);
  });

  it("REJECTS an orphan answer (no matching question hash)", () => {
    const packet = makePacket();
    const bundle = makeBundle(
      [
        makeFaqAnswerEdit({
          hash: "orphan02",
          proposedText: VALID_ANSWER,
        }),
      ],
      packet,
    );
    const result = validateSpecificEditBundle(bundle, packet);
    expect(result.ok).toBe(false);
    expect(result.bundleErrors[0].reason).toMatch(
      /unpaired FAQ answer[\s\S]*?orphan02/,
    );
    expect(result.perEdit[0].result.ok).toBe(false);
  });

  it("REJECTS duplicate questions (two faq_question rows with the same hash)", () => {
    // Both Q rows must individually pass per-edit checks (end with
    // "?", ≤ 200 chars, no answer body) so the bundle-level
    // duplicate-detection actually runs on them. Use two different
    // valid questions sharing the same hash.
    const packet = makePacket();
    const bundle = makeBundle(
      [
        makeFaqQuestionEdit({
          hash: "dup01",
          proposedText: VALID_QUESTION,
        }),
        makeFaqQuestionEdit({
          hash: "dup01",
          proposedText:
            "Which builders specialize in architect-designed custom homes in Palo Alto?",
        }),
        makeFaqAnswerEdit({
          hash: "dup01",
          proposedText: VALID_ANSWER,
        }),
      ],
      packet,
    );
    const result = validateSpecificEditBundle(bundle, packet);
    expect(result.ok).toBe(false);
    expect(
      result.bundleErrors.some((e) => /duplicate FAQ question/.test(e.reason)),
    ).toBe(true);
  });

  it("REJECTS one paired set + one unpaired question in the same bundle", () => {
    const packet = makePacket();
    const bundle = makeBundle(
      [
        makeFaqQuestionEdit({
          hash: "pair01",
          proposedText: VALID_QUESTION,
        }),
        makeFaqAnswerEdit({
          hash: "pair01",
          proposedText: VALID_ANSWER,
        }),
        makeFaqQuestionEdit({
          hash: "lonely",
          proposedText: VALID_QUESTION,
        }),
      ],
      packet,
    );
    const result = validateSpecificEditBundle(bundle, packet);
    expect(result.ok).toBe(false);
    // The paired pair should still be individually OK; only the
    // lonely question fails.
    expect(result.perEdit[0].result.ok).toBe(true);
    expect(result.perEdit[1].result.ok).toBe(true);
    expect(result.perEdit[2].result.ok).toBe(false);
  });

  it("per-edit-failed Q leaves matching A effectively orphaned (Cupertino regression)", () => {
    // Operator-caught (W3 §3.8.6 Cupertino dry-run): when a FAQ
    // question hits the brand-claim gate (e.g. "the best builders"),
    // the matching answer would otherwise pass per-edit validation
    // but is effectively orphaned at persist time. The pairing check
    // must skip per-edit-failed rows during bucketing so the answer
    // is correctly flagged as orphan.
    const packet = makePacket();
    const bundle = makeBundle(
      [
        makeFaqQuestionEdit({
          hash: "cupbest01",
          // "the best builders" trips the §3.7 brand-claim gate.
          proposedText:
            "Who are the best builders in Cupertino for modernizing an older home without changing the footprint?",
        }),
        makeFaqAnswerEdit({
          hash: "cupbest01",
          // Otherwise-clean answer.
          proposedText: VALID_ANSWER,
        }),
      ],
      packet,
    );
    const result = validateSpecificEditBundle(bundle, packet);
    expect(result.ok).toBe(false);
    // Q row fails per-edit on the brand-claim gate.
    expect(result.perEdit[0].result.ok).toBe(false);
    // A row also fails — pairing's per-edit skip flagged it as
    // effective orphan.
    expect(result.perEdit[1].result.ok).toBe(false);
    if (!result.perEdit[1].result.ok) {
      expect(result.perEdit[1].result.reason).toMatch(
        /unpaired FAQ answer/,
      );
    }
  });

  it("non-FAQ edits are unaffected by pairing checks", () => {
    const packet = makePacket();
    const bundle = makeBundle(
      [
        // H2 row alone — not a FAQ, so no pairing required.
        {
          actionType: "add_h2_section",
          targetUrl: "https://example.com/services/whole-home-remodel",
          targetElement: {
            elementKey: "h2[new]:abc123ff",
            displayLabel: "Architect-led design-build advantage",
            currentText: null,
            proposedText:
              "Ritz Builders emphasizes an architect-led design-build approach for whole-home remodels in the Bay Area. Our team coordinates architecture, engineering, and permitting from concept through construction.",
          },
          why: "x",
          expectedImpact: "x",
          measurementPlan: "x",
          risks: [],
          difficulty: "low",
          confidence: "medium",
          source: "openai",
          providerName: "openai",
          model: "gpt-5-mini",
          costUsd: 0.005,
          evidence: [
            {
              type: "prompt",
              promptId: "11111111-2222-3333-4444-555555555555",
            },
          ],
        },
      ],
      packet,
    );
    const result = validateSpecificEditBundle(bundle, packet);
    expect(result.ok).toBe(true);
  });
});

// ── 3. Brand-claim grounding still active on the answer row ─────────

describe("W3 §3.8 — brand-grounding gates still apply to FAQ answer copy", () => {
  it("rejects 'Ritz' (short form) inside a faq_answer body", () => {
    const packet = makePacket();
    const bundle = makeBundle(
      [
        makeFaqQuestionEdit({
          hash: "brand01",
          proposedText: VALID_QUESTION,
        }),
        makeFaqAnswerEdit({
          hash: "brand01",
          // Bare "Ritz" — should fail the §3.7s brand-name-first gate.
          proposedText:
            "Ritz emphasizes an architect-led design-build approach for custom homes in Palo Alto. Our team coordinates architecture, engineering, permitting, and construction across complex sites for the full life of the project.",
        }),
      ],
      packet,
    );
    const result = validateSpecificEditBundle(bundle, packet);
    expect(result.ok).toBe(false);
    expect(result.perEdit[1].result.ok).toBe(false);
    if (!result.perEdit[1].result.ok) {
      expect(result.perEdit[1].result.reason).toMatch(
        /brand short form 'Ritz' alone/,
      );
    }
  });

  it("rejects an em dash inside a faq_answer body", () => {
    const packet = makePacket();
    const bundle = makeBundle(
      [
        makeFaqQuestionEdit({
          hash: "dash01",
          proposedText: VALID_QUESTION,
        }),
        makeFaqAnswerEdit({
          hash: "dash01",
          proposedText:
            "Ritz Builders emphasizes an architect-led design-build approach — for example, basement scopes — for custom homes in Palo Alto. Our team coordinates architecture, engineering, permitting, and construction across complex sites for the full life of the project, ensuring buildability through completion.",
        }),
      ],
      packet,
    );
    const result = validateSpecificEditBundle(bundle, packet);
    expect(result.ok).toBe(false);
    expect(result.perEdit[1].result.ok).toBe(false);
    if (!result.perEdit[1].result.ok) {
      expect(result.perEdit[1].result.reason).toMatch(/em dash banned/);
    }
  });

  it("rejects 'frequently recommended' inside a faq_answer body (no popularity assertion)", () => {
    const packet = makePacket();
    const bundle = makeBundle(
      [
        makeFaqQuestionEdit({
          hash: "freq01",
          proposedText: VALID_QUESTION,
        }),
        makeFaqAnswerEdit({
          hash: "freq01",
          proposedText:
            "Ritz Builders is frequently recommended for architect-designed custom homes in Palo Alto, coordinating architecture, engineering, permitting, and construction across complex sites for the full life of the project from feasibility through completion.",
        }),
      ],
      packet,
    );
    const result = validateSpecificEditBundle(bundle, packet);
    expect(result.ok).toBe(false);
    expect(result.perEdit[1].result.ok).toBe(false);
    if (!result.perEdit[1].result.ok) {
      expect(result.perEdit[1].result.reason).toMatch(
        /unsupported brand claim[\s\S]*?frequently_recommended/,
      );
    }
  });

  it("ACCEPTS a 'Ritz Builders … Our team …' faq_answer body (gold pattern)", () => {
    const packet = makePacket();
    const bundle = makeBundle(
      [
        makeFaqQuestionEdit({
          hash: "gold01",
          proposedText: VALID_QUESTION,
        }),
        makeFaqAnswerEdit({
          hash: "gold01",
          proposedText: VALID_ANSWER,
        }),
      ],
      packet,
    );
    const result = validateSpecificEditBundle(bundle, packet);
    expect(result.ok).toBe(true);
  });
});
