/**
 * Slice 4.5.E.α₀ (2026-05-21) — LLM-drafting gateway unit tests.
 *
 * The gateway treats `openaiProvider`, `checkBudget`, `recordSpend`,
 * and `validateSpecificEdit` as black-box dependencies. Every test
 * here mocks all four at the import boundary via `vi.hoisted()` +
 * `vi.mock()` so NO real LLM call is ever issued from the test
 * suite.
 *
 * Pinned coverage (16 cases):
 *   • Budget blocked → blocked_budget · no provider call · no
 *     spend recorded.
 *   • Provider returns valid bundle + validator passes → drafted
 *     with first edit's proposed_text + cost + bundle_size.
 *   • Provider throws → validation_failed [llm_call_threw] ·
 *     cost_usd: 0 · no spend recorded.
 *   • Empty bundle → abstained empty_bundle · spend recorded.
 *   • Validator fails → validation_failed with validator errors ·
 *     spend recorded.
 *   • proposed_text null → abstained empty_proposed_text · spend
 *     recorded.
 *   • proposed_text empty-string → abstained empty_proposed_text.
 *   • spend recorded after successful provider response for ALL
 *     downstream outcomes (drafted / abstained / validation_failed).
 *   • spend NOT recorded on blocked_budget.
 *   • spend NOT recorded on provider throw.
 *   • Multiple edits → first edit only is used.
 *   • Provider receives the input packet unchanged.
 *   • Every result has a `status` discriminator.
 *   • cost_usd reflects bundle.totalCostUsd.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";

import type { SpecificEditEvidencePacket } from "@/domains/recommendations/specific-edit-evidence";
import type {
  SpecificEdit,
  SpecificEditBundle,
} from "@/domains/recommendations/specific-edit-provider";
import type { ValidationResult } from "@/domains/recommendations/specific-edit-validator";

// ---------------------------------------------------------------------------
// Hoisted mock state — vi.hoisted lets vi.mock factories close over
// mutable handles; Mock<TFunc> parameterization keeps signatures pinned.
// ---------------------------------------------------------------------------

const mockState = vi.hoisted(() => ({
  // checkBudget result default = allowed
  budgetResult: { allowed: true as const, remaining: 5 } as
    | { allowed: true; remaining: number }
    | { allowed: false; reason: string },
  // openaiProvider.generate result default
  providerBundle: undefined as undefined | SpecificEditBundle,
  providerThrows: false,
  providerThrowMessage: "boom",
  // validateSpecificEdit result default = ok
  validatorResult: { ok: true as const } as ValidationResult,
  // Spies
  providerSpy: undefined as
    | undefined
    | Mock<(packet: SpecificEditEvidencePacket) => Promise<SpecificEditBundle>>,
  checkBudgetSpy: undefined as undefined | Mock<() => void>,
  recordSpendSpy: undefined as undefined | Mock<(cost: number) => void>,
  validateSpy: undefined as
    | undefined
    | Mock<
        (
          edit: SpecificEdit,
          packet: SpecificEditEvidencePacket,
        ) => ValidationResult
      >,
}));
mockState.providerSpy = vi.fn();
mockState.checkBudgetSpy = vi.fn();
mockState.recordSpendSpy = vi.fn();
mockState.validateSpy = vi.fn();

vi.mock("@/domains/recommendations/adjudicator-budget", () => ({
  checkBudget: async () => {
    mockState.checkBudgetSpy!();
    return mockState.budgetResult;
  },
  recordSpend: async (costUsd: number) => {
    mockState.recordSpendSpy!(costUsd);
  },
}));

vi.mock("@/domains/recommendations/providers/openai", () => ({
  openaiProvider: {
    name: "openai" as const,
    generate: async (packet: SpecificEditEvidencePacket) => {
      mockState.providerSpy!(packet);
      if (mockState.providerThrows) {
        throw new Error(mockState.providerThrowMessage);
      }
      // Caller sets providerBundle for every non-throwing case.
      return mockState.providerBundle!;
    },
  },
}));

vi.mock("@/domains/recommendations/specific-edit-validator", () => ({
  validateSpecificEdit: (
    edit: SpecificEdit,
    packet: SpecificEditEvidencePacket,
  ) => {
    mockState.validateSpy!(edit, packet);
    return mockState.validatorResult;
  },
}));

import { draftProposedTextForCandidate } from "@/domains/recommendation-intelligence/llm-draft-gateway";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NOW = new Date("2026-05-21T00:00:00.000Z");

function makePacket(): SpecificEditEvidencePacket {
  // Gateway treats packet as opaque (passes to mocked deps); cast
  // a minimal stub through `unknown` to avoid building the full
  // 23-field packet shape per test.
  return { tenantId: "tenant-x", recId: "rec-x" } as unknown as SpecificEditEvidencePacket;
}

function makeEdit(overrides: Partial<SpecificEdit> = {}): SpecificEdit {
  return {
    actionType: "rewrite_h2",
    targetUrl: "https://example.com/a",
    targetElement: {
      elementKey: "h2-1",
      displayLabel: "H2 #1",
      currentText: "Old text",
      proposedText: "New text",
    },
    why: "evidence-grounded",
    evidence: [],
    expectedImpact: null,
    difficulty: "low",
    confidence: "medium",
    measurementPlan: null,
    risks: [],
    source: "openai",
    providerName: "openai",
    model: "gpt-5-mini",
    costUsd: 0.05,
    ...overrides,
  };
}

function makeBundle(
  edits: SpecificEdit[],
  totalCostUsd: number = 0.05,
): SpecificEditBundle {
  return {
    schemaVersion: "specific-edit-bundle/v1",
    generatedAt: NOW.toISOString(),
    tenantId: "tenant-x",
    recId: "rec-x",
    evidenceHash: "abc",
    providerName: "openai",
    recommendations: edits,
    totalCostUsd,
  };
}

beforeEach(() => {
  mockState.budgetResult = { allowed: true, remaining: 5 };
  mockState.providerBundle = makeBundle([makeEdit()]);
  mockState.providerThrows = false;
  mockState.providerThrowMessage = "boom";
  mockState.validatorResult = { ok: true };
  mockState.providerSpy!.mockClear();
  mockState.checkBudgetSpy!.mockClear();
  mockState.recordSpendSpy!.mockClear();
  mockState.validateSpy!.mockClear();
});

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

describe("draftProposedTextForCandidate — budget gate", () => {
  it("budget blocked → blocked_budget; provider NOT called; spend NOT recorded", async () => {
    mockState.budgetResult = {
      allowed: false,
      reason: "Monthly cap reached",
    };
    const result = await draftProposedTextForCandidate({ packet: makePacket() });
    expect(result.status).toBe("blocked_budget");
    if (result.status === "blocked_budget") {
      expect(result.reason).toBe("Monthly cap reached");
    }
    expect(mockState.providerSpy!).not.toHaveBeenCalled();
    expect(mockState.recordSpendSpy!).not.toHaveBeenCalled();
  });
});

describe("draftProposedTextForCandidate — provider throws", () => {
  it("provider throws → validation_failed [llm_call_threw] · cost 0 · spend NOT recorded", async () => {
    mockState.providerThrows = true;
    mockState.providerThrowMessage = "openai 5xx";
    const result = await draftProposedTextForCandidate({ packet: makePacket() });
    expect(result.status).toBe("validation_failed");
    if (result.status === "validation_failed") {
      expect(result.validation_errors).toEqual(["llm_call_threw"]);
      expect(result.cost_usd).toBe(0);
    }
    expect(mockState.providerSpy!).toHaveBeenCalledTimes(1);
    expect(mockState.recordSpendSpy!).not.toHaveBeenCalled();
  });
});

describe("draftProposedTextForCandidate — happy paths + abstention", () => {
  it("valid bundle + validator passes → drafted with first edit's proposed_text + cost + bundle_size", async () => {
    mockState.providerBundle = makeBundle(
      [makeEdit({ targetElement: {
        elementKey: "h2-1",
        displayLabel: "H2 #1",
        currentText: "Old",
        proposedText: "Fresh draft",
      }})],
      0.04,
    );
    const result = await draftProposedTextForCandidate({ packet: makePacket() });
    expect(result.status).toBe("drafted");
    if (result.status === "drafted") {
      expect(result.proposed_text).toBe("Fresh draft");
      expect(result.cost_usd).toBe(0.04);
      expect(result.bundle_size).toBe(1);
    }
    expect(mockState.recordSpendSpy!).toHaveBeenCalledTimes(1);
    expect(mockState.recordSpendSpy!.mock.calls[0]![0]).toBe(0.04);
  });

  it("drafted result surfaces the LLM's grounded reasoning (why/confidence/impact/measurement/risks/evidenceCount/model)", async () => {
    mockState.providerBundle = makeBundle(
      [
        makeEdit({
          targetElement: {
            elementKey: "h2-1",
            displayLabel: "H2 #1",
            currentText: "Old",
            proposedText: "Fresh draft",
          },
          why: "Your page ranks #11 for 'persian male names' (2,400 monthly Google impressions, 0.4% CTR) — the title buries the query. Leading with it should recover clicks competitors are taking.",
          confidence: "high",
          difficulty: "low",
          expectedImpact: "Recover ~80 clicks/mo if CTR returns to the 3% page-average",
          measurementPlan: "Watch GSC clicks for this URL over the next 2–4 weeks",
          risks: ["Title may be slightly long on mobile SERPs"],
          evidence: [
            { type: "owned_page", url: "https://example.com/a" },
            { type: "prompt", promptId: "p-1" },
          ],
          model: "gpt-4o-mini-2024-07-18",
        }),
      ],
      0.04,
    );
    const result = await draftProposedTextForCandidate({ packet: makePacket() });
    expect(result.status).toBe("drafted");
    if (result.status === "drafted") {
      expect(result.reasoning.why).toContain("persian male names");
      expect(result.reasoning.confidence).toBe("high");
      expect(result.reasoning.difficulty).toBe("low");
      expect(result.reasoning.expectedImpact).toContain("Recover ~80 clicks");
      expect(result.reasoning.measurementPlan).toContain("GSC clicks");
      expect(result.reasoning.risks).toEqual([
        "Title may be slightly long on mobile SERPs",
      ]);
      expect(result.reasoning.evidenceCount).toBe(2);
      expect(result.reasoning.model).toBe("gpt-4o-mini-2024-07-18");
    }
  });

  it("empty bundle → abstained empty_bundle; spend RECORDED (LLM call happened)", async () => {
    mockState.providerBundle = makeBundle([], 0.02);
    const result = await draftProposedTextForCandidate({ packet: makePacket() });
    expect(result.status).toBe("abstained");
    if (result.status === "abstained") {
      expect(result.abstention_reason).toBe("empty_bundle");
      expect(result.cost_usd).toBe(0.02);
    }
    expect(mockState.recordSpendSpy!).toHaveBeenCalledTimes(1);
    expect(mockState.recordSpendSpy!.mock.calls[0]![0]).toBe(0.02);
  });

  it("validator fails → validation_failed with validator field+reason; spend RECORDED", async () => {
    mockState.providerBundle = makeBundle([makeEdit()], 0.05);
    mockState.validatorResult = {
      ok: false,
      field: "evidence[0].promptId",
      reason: "evidence ref does not exist in packet",
    };
    const result = await draftProposedTextForCandidate({ packet: makePacket() });
    expect(result.status).toBe("validation_failed");
    if (result.status === "validation_failed") {
      expect(result.validation_errors).toEqual([
        "evidence[0].promptId: evidence ref does not exist in packet",
      ]);
      expect(result.cost_usd).toBe(0.05);
    }
    expect(mockState.recordSpendSpy!).toHaveBeenCalledTimes(1);
  });

  it("proposed_text null → abstained empty_proposed_text; spend RECORDED", async () => {
    mockState.providerBundle = makeBundle(
      [
        makeEdit({
          targetElement: {
            elementKey: "h2-1",
            displayLabel: "H2 #1",
            currentText: null,
            proposedText: null,
          },
        }),
      ],
      0.03,
    );
    const result = await draftProposedTextForCandidate({ packet: makePacket() });
    expect(result.status).toBe("abstained");
    if (result.status === "abstained") {
      expect(result.abstention_reason).toBe("empty_proposed_text");
      expect(result.cost_usd).toBe(0.03);
    }
    expect(mockState.recordSpendSpy!).toHaveBeenCalledTimes(1);
  });

  it("proposed_text empty string → abstained empty_proposed_text", async () => {
    mockState.providerBundle = makeBundle([
      makeEdit({
        targetElement: {
          elementKey: "h2-1",
          displayLabel: "H2 #1",
          currentText: "old",
          proposedText: "",
        },
      }),
    ]);
    const result = await draftProposedTextForCandidate({ packet: makePacket() });
    expect(result.status).toBe("abstained");
    if (result.status === "abstained") {
      expect(result.abstention_reason).toBe("empty_proposed_text");
    }
  });

  it("targetElement is null (page-level action) → abstained empty_proposed_text", async () => {
    mockState.providerBundle = makeBundle([
      makeEdit({ targetElement: null }),
    ]);
    const result = await draftProposedTextForCandidate({ packet: makePacket() });
    expect(result.status).toBe("abstained");
    if (result.status === "abstained") {
      expect(result.abstention_reason).toBe("empty_proposed_text");
    }
  });
});

describe("draftProposedTextForCandidate — spend recording semantics", () => {
  it("spend ALWAYS recorded on successful provider response (drafted)", async () => {
    mockState.providerBundle = makeBundle([makeEdit()], 0.05);
    await draftProposedTextForCandidate({ packet: makePacket() });
    expect(mockState.recordSpendSpy!).toHaveBeenCalledTimes(1);
  });

  it("spend ALWAYS recorded on successful provider response (abstained empty_bundle)", async () => {
    mockState.providerBundle = makeBundle([], 0.01);
    await draftProposedTextForCandidate({ packet: makePacket() });
    expect(mockState.recordSpendSpy!).toHaveBeenCalledTimes(1);
  });

  it("spend ALWAYS recorded on successful provider response (validation_failed)", async () => {
    mockState.providerBundle = makeBundle([makeEdit()], 0.05);
    mockState.validatorResult = {
      ok: false,
      field: "x",
      reason: "y",
    };
    await draftProposedTextForCandidate({ packet: makePacket() });
    expect(mockState.recordSpendSpy!).toHaveBeenCalledTimes(1);
  });

  it("spend NEVER recorded on blocked_budget", async () => {
    mockState.budgetResult = { allowed: false, reason: "cap" };
    await draftProposedTextForCandidate({ packet: makePacket() });
    expect(mockState.recordSpendSpy!).not.toHaveBeenCalled();
  });

  it("spend NEVER recorded on provider throw", async () => {
    mockState.providerThrows = true;
    await draftProposedTextForCandidate({ packet: makePacket() });
    expect(mockState.recordSpendSpy!).not.toHaveBeenCalled();
  });
});

describe("draftProposedTextForCandidate — provider invariants", () => {
  it("multiple edits → first edit only is validated + used", async () => {
    const first = makeEdit({
      targetElement: {
        elementKey: "h2-1",
        displayLabel: "H2 #1",
        currentText: null,
        proposedText: "FIRST",
      },
    });
    const second = makeEdit({
      targetElement: {
        elementKey: "h2-2",
        displayLabel: "H2 #2",
        currentText: null,
        proposedText: "SECOND",
      },
    });
    mockState.providerBundle = makeBundle([first, second], 0.08);
    const result = await draftProposedTextForCandidate({ packet: makePacket() });
    expect(result.status).toBe("drafted");
    if (result.status === "drafted") {
      expect(result.proposed_text).toBe("FIRST");
      expect(result.bundle_size).toBe(2);
    }
    // Validator called exactly once with the first edit.
    expect(mockState.validateSpy!).toHaveBeenCalledTimes(1);
    expect(mockState.validateSpy!.mock.calls[0]![0]).toBe(first);
  });

  it("provider receives the input packet unchanged (no internal mutation)", async () => {
    const packet = makePacket();
    await draftProposedTextForCandidate({ packet });
    expect(mockState.providerSpy!).toHaveBeenCalledTimes(1);
    expect(mockState.providerSpy!.mock.calls[0]![0]).toBe(packet);
  });

  it("every result carries a status discriminator (no null/undefined returns)", async () => {
    // Walk each known result-producing branch and verify presence
    // of `status` as a string.
    const cases: Array<() => void> = [
      () => {
        mockState.budgetResult = { allowed: false, reason: "x" };
      },
      () => {
        mockState.providerThrows = true;
      },
      () => {
        mockState.providerBundle = makeBundle([]);
      },
      () => {
        mockState.providerBundle = makeBundle([makeEdit()]);
        mockState.validatorResult = { ok: false, field: "f", reason: "r" };
      },
      () => {
        mockState.providerBundle = makeBundle([
          makeEdit({
            targetElement: {
              elementKey: "k",
              displayLabel: "l",
              currentText: null,
              proposedText: null,
            },
          }),
        ]);
      },
      () => {
        mockState.providerBundle = makeBundle([makeEdit()]);
      },
    ];
    for (const setup of cases) {
      // reset to defaults, then apply this case's setup
      mockState.budgetResult = { allowed: true, remaining: 5 };
      mockState.providerBundle = makeBundle([makeEdit()]);
      mockState.providerThrows = false;
      mockState.validatorResult = { ok: true };
      setup();
      const result = await draftProposedTextForCandidate({ packet: makePacket() });
      expect(typeof result.status).toBe("string");
      expect(result.status.length).toBeGreaterThan(0);
    }
  });

  it("cost_usd reflects bundle.totalCostUsd on every recorded-spend path", async () => {
    mockState.providerBundle = makeBundle([makeEdit()], 0.077);
    const result = await draftProposedTextForCandidate({ packet: makePacket() });
    expect(result.status).toBe("drafted");
    if (result.status === "drafted") {
      expect(result.cost_usd).toBe(0.077);
    }
    expect(mockState.recordSpendSpy!.mock.calls[0]![0]).toBe(0.077);
  });
});
