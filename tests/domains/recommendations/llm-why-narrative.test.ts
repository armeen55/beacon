/**
 * Act 2 "Why this matters" — LLM progressive-enhancement unit tests
 * (Slice B, 2026-06-16).
 *
 * Pins the SAFE, fail-closed, white-label contract of
 * `composeLlmWhyThisMatters` + `buildWhyInput` + `sanitizeLlmWhyOutput`:
 *
 *   • flag off (default)      → null, and NO fetch call, NO budget touch.
 *   • budget blocked          → null, NO fetch call, NO spend.
 *   • happy path (grounded)   → { sentences, model, costUsd } + recordSpend.
 *   • vendor name in output   → null.
 *   • invented number ("47%") → null.
 *   • timeout / throw         → null.
 *   • buildWhyInput assembly  → matches the detail-client contract.
 *
 * `checkBudget` / `recordSpend` are mocked at the import boundary so no
 * real budget store is touched. `fetchImpl` is ALWAYS injected — no real
 * OpenAI call is ever issued from this suite.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";

const mockState = vi.hoisted(() => ({
  budgetResult: { allowed: true as const, remaining: 5 } as
    | { allowed: true; remaining: number }
    | { allowed: false; reason: string },
  checkBudgetSpy: undefined as undefined | Mock<() => void>,
  recordSpendSpy: undefined as undefined | Mock<(cost: number) => void>,
}));

vi.mock("@/domains/recommendations/adjudicator-budget", () => {
  mockState.checkBudgetSpy = vi.fn(() => {});
  mockState.recordSpendSpy = vi.fn((_cost: number) => {});
  return {
    checkBudget: vi.fn(async () => {
      mockState.checkBudgetSpy!();
      return mockState.budgetResult;
    }),
    recordSpend: vi.fn(async (cost: number) => {
      mockState.recordSpendSpy!(cost);
    }),
  };
});

import {
  composeLlmWhyThisMatters,
  sanitizeLlmWhyOutput,
  serializeWhyInput,
} from "@/domains/recommendations/llm-why-narrative";
import {
  buildWhyInput,
  type WhyThisMattersInput,
} from "@/domains/recommendations/why-this-matters-narrative";
import type { RecommendationActionRow } from "@/domains/recommendations/recommendation-action-rows";
import type { EvidenceLine } from "@/domains/recommendation-intelligence/evidence-summary";

// ─────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────

const GSC_LINE: EvidenceLine = {
  key: "headline_query",
  value: "“persian rug cleaning cost”",
  label: "1,800 times shown · you rank #6 (striking distance)",
  detail:
    "You already rank #6 for “persian rug cleaning cost” — shown 1,800 times in the last 90 days, just short of page one. Reaching the top 3 could win about 120 more visits over 90 days.",
};

function makeInput(
  overrides: Partial<WhyThisMattersInput> = {},
): WhyThisMattersInput {
  return {
    actionType: "add_faq",
    targetLabel: "Persian Rugs page",
    why: null,
    affectedPromptTexts: ["best persian rug cleaner"],
    competitor: { name: "Rug Co", primaryPct: 0.42 },
    gscEvidenceLines: [GSC_LINE],
    semrushEvidenceLines: [],
    clarityEvidenceLines: [],
    aeoEvidenceLines: [],
    promptCount: 3,
    observationCount: 12,
    derivedConfidence: "strong_evidence",
    ...overrides,
  };
}

/** A fake fetchImpl that returns one OpenAI chat-completion response with
 *  the given message content + token usage. */
function fakeFetch(content: string, usage = { prompt_tokens: 400, completion_tokens: 60 }) {
  return vi.fn(async () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content } }],
        usage,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ),
  ) as unknown as typeof fetch;
}

// Save + restore env across tests so the flag never leaks.
const ORIGINAL_FLAG = process.env.BEACON_LLM_WHY;
const ORIGINAL_KEY = process.env.OPENAI_API_KEY;

beforeEach(() => {
  mockState.budgetResult = { allowed: true, remaining: 5 };
  mockState.checkBudgetSpy?.mockClear();
  mockState.recordSpendSpy?.mockClear();
  process.env.OPENAI_API_KEY = "sk-test-key";
});

afterEach(() => {
  if (ORIGINAL_FLAG === undefined) delete process.env.BEACON_LLM_WHY;
  else process.env.BEACON_LLM_WHY = ORIGINAL_FLAG;
  if (ORIGINAL_KEY === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = ORIGINAL_KEY;
});

// ─────────────────────────────────────────────────────────────────────
// composeLlmWhyThisMatters
// ─────────────────────────────────────────────────────────────────────

describe("composeLlmWhyThisMatters — gates", () => {
  it("flag OFF → null, and NEVER calls fetch or budget", async () => {
    delete process.env.BEACON_LLM_WHY;
    const fetchImpl = fakeFetch("ignored");
    const result = await composeLlmWhyThisMatters(makeInput(), { fetchImpl });
    expect(result).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(mockState.checkBudgetSpy).not.toHaveBeenCalled();
    expect(mockState.recordSpendSpy).not.toHaveBeenCalled();
  });

  it("budget blocked → null, NO fetch call, NO spend recorded", async () => {
    process.env.BEACON_LLM_WHY = "1";
    mockState.budgetResult = { allowed: false, reason: "cap reached" };
    const fetchImpl = fakeFetch("ignored");
    const result = await composeLlmWhyThisMatters(makeInput(), { fetchImpl });
    expect(result).toBeNull();
    expect(mockState.checkBudgetSpy).toHaveBeenCalledTimes(1);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(mockState.recordSpendSpy).not.toHaveBeenCalled();
  });

  it("missing OPENAI_API_KEY → null, NO fetch call", async () => {
    process.env.BEACON_LLM_WHY = "1";
    delete process.env.OPENAI_API_KEY;
    const fetchImpl = fakeFetch("ignored");
    const result = await composeLlmWhyThisMatters(makeInput(), { fetchImpl });
    expect(result).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("composeLlmWhyThisMatters — happy path", () => {
  it("grounded output → sentences + model + cost, records spend", async () => {
    process.env.BEACON_LLM_WHY = "1";
    // A grounded paragraph: only numbers that appear in the serialized
    // input (1,800, #6, 120, 42%). No vendor names; says "AI assistants".
    const grounded =
      "You already rank #6 for this search and were shown 1,800 times in 90 days. " +
      "Adding a clear FAQ here gives AI assistants a quotable answer to cite. " +
      "Rug Co already appears in 42% of those answers, so closing this gap matters.";
    const fetchImpl = fakeFetch(grounded);
    const result = await composeLlmWhyThisMatters(makeInput(), { fetchImpl });
    expect(result).not.toBeNull();
    expect(result!.sentences.length).toBeGreaterThan(0);
    expect(result!.sentences.length).toBeLessThanOrEqual(3);
    expect(result!.model).toBe("gpt-5-mini");
    expect(result!.costUsd).toBeGreaterThan(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(mockState.recordSpendSpy).toHaveBeenCalledTimes(1);
    // White-label: no vendor name leaked through.
    const joined = result!.sentences.join(" ");
    expect(joined).toContain("AI assistants");
    expect(joined.toLowerCase()).not.toContain("chatgpt");
  });

  it("accepts a tiny JSON {\"sentences\":[...]} envelope", async () => {
    process.env.BEACON_LLM_WHY = "1";
    const json = JSON.stringify({
      sentences: [
        "You already rank #6 for this and were shown 1,800 times in 90 days.",
        "A clear FAQ gives AI assistants a quotable answer.",
      ],
    });
    const fetchImpl = fakeFetch(json);
    const result = await composeLlmWhyThisMatters(makeInput(), { fetchImpl });
    expect(result).not.toBeNull();
    expect(result!.sentences.length).toBe(2);
  });
});

describe("composeLlmWhyThisMatters — sanitize rejections", () => {
  it("vendor name in output → null (spend still recorded — call happened)", async () => {
    process.env.BEACON_LLM_WHY = "1";
    const withVendor =
      "ChatGPT answers this query citing Rug Co in 42% of answers, not you.";
    const fetchImpl = fakeFetch(withVendor);
    const result = await composeLlmWhyThisMatters(makeInput(), { fetchImpl });
    expect(result).toBeNull();
    // The call DID happen, so spend is real (mirror the gateway rule).
    expect(mockState.recordSpendSpy).toHaveBeenCalledTimes(1);
  });

  it("invented number (47% not in input) → null", async () => {
    process.env.BEACON_LLM_WHY = "1";
    const invented =
      "This page loses 47% of its clicks to rivals, so a fix is urgent.";
    const fetchImpl = fakeFetch(invented);
    const result = await composeLlmWhyThisMatters(makeInput(), { fetchImpl });
    expect(result).toBeNull();
  });

  it("grounded numbers that DO appear in the input are allowed", async () => {
    process.env.BEACON_LLM_WHY = "1";
    // 1,800 and 42% are both in the serialized input; should pass.
    const grounded =
      "Shown 1,800 times, this page is one rivals win 42% of the time.";
    const fetchImpl = fakeFetch(grounded);
    const result = await composeLlmWhyThisMatters(makeInput(), { fetchImpl });
    expect(result).not.toBeNull();
  });
});

describe("composeLlmWhyThisMatters — failure modes", () => {
  it("fetch throws (timeout/abort) → null", async () => {
    process.env.BEACON_LLM_WHY = "1";
    const fetchImpl = vi.fn(async () => {
      throw new Error("The operation was aborted");
    }) as unknown as typeof fetch;
    const result = await composeLlmWhyThisMatters(makeInput(), { fetchImpl });
    expect(result).toBeNull();
    expect(mockState.recordSpendSpy).not.toHaveBeenCalled();
  });

  it("non-200 response → null, NO spend", async () => {
    process.env.BEACON_LLM_WHY = "1";
    const fetchImpl = vi.fn(async () =>
      new Response("rate limited", { status: 429 }),
    ) as unknown as typeof fetch;
    const result = await composeLlmWhyThisMatters(makeInput(), { fetchImpl });
    expect(result).toBeNull();
    expect(mockState.recordSpendSpy).not.toHaveBeenCalled();
  });

  it("empty model content → null", async () => {
    process.env.BEACON_LLM_WHY = "1";
    const fetchImpl = fakeFetch("");
    const result = await composeLlmWhyThisMatters(makeInput(), { fetchImpl });
    expect(result).toBeNull();
  });

  it("model refusal → null", async () => {
    process.env.BEACON_LLM_WHY = "1";
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { refusal: "I can't help with that." } }],
          usage: { prompt_tokens: 100, completion_tokens: 0 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    ) as unknown as typeof fetch;
    const result = await composeLlmWhyThisMatters(makeInput(), { fetchImpl });
    expect(result).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────
// sanitizeLlmWhyOutput (unit)
// ─────────────────────────────────────────────────────────────────────

describe("sanitizeLlmWhyOutput", () => {
  const ledger = JSON.stringify({ a: "1,800", b: "42%", c: "#6", d: "120" });

  it("caps at 3 sentences", () => {
    const out = sanitizeLlmWhyOutput(
      "One sentence. Two sentence. Three sentence. Four sentence.",
      ledger,
    );
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.sentences.length).toBe(3);
  });

  it("rejects each known vendor name", () => {
    for (const v of [
      "ChatGPT",
      "Perplexity",
      "Gemini",
      "Claude",
      "Profound",
      "Copilot",
      "Google AI Overviews",
    ]) {
      const out = sanitizeLlmWhyOutput(`${v} cites a rival here.`, ledger);
      expect(out.ok, `${v} must be rejected`).toBe(false);
    }
  });

  it("rejects an invented number not in the ledger", () => {
    const out = sanitizeLlmWhyOutput("This loses 47% of clicks.", ledger);
    expect(out.ok).toBe(false);
  });

  it("allows numbers present in the ledger", () => {
    const out = sanitizeLlmWhyOutput("Shown 1,800 times; rivals win 42%.", ledger);
    expect(out.ok).toBe(true);
  });

  it("rejects empty / whitespace output", () => {
    expect(sanitizeLlmWhyOutput("   ", ledger).ok).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────
// buildWhyInput — shared assembly contract
// ─────────────────────────────────────────────────────────────────────

function makeRow(
  overrides: Partial<RecommendationActionRow> = {},
): RecommendationActionRow {
  return {
    id: "rec-1__edit-1",
    rank: 1,
    title: "Add FAQ",
    targetLabel: "Persian Rugs page",
    targetUrl: "https://example.com/rugs",
    actionType: "add_faq",
    priority: "high",
    status: "new",
    evidenceSummary: "AI cites a rival on 3 of 7 prompts; you're absent.",
    sourceRecommendationId: "rec-1",
    sourceEditId: "edit-1",
    editSource: "openai",
    derivedConfidence: "strong_evidence",
    hasExactEdit: true,
    responseStatus: null,
    acceptedAgeDays: 0,
    deferUntil: null,
    eligibleEditCount: 1,
    detail: {
      currentText: null,
      proposedText: "Q: …",
      why: "Framing is missing.",
      measurementPlan: "Track 14 days.",
      evidenceRefs: [
        { type: "prompt", promptId: "p-1" },
        { type: "prompt", promptId: "p-2" },
        { type: "prompt", promptId: "p-3" },
        { type: "prompt", promptId: "p-4" }, // 4th — capped out
      ] as unknown as RecommendationActionRow["detail"]["evidenceRefs"],
      fullReasoning: null,
      confidenceReason: null,
      motiveLabel: null,
      pageBrief: null,
      suggestedEdits: [],
      risks: [],
      cannibalization: null,
      topCompetitor: { name: "Rug Co", primaryPct: 0.42 },
      affectedPromptCount: 3,
      observationCount: 7,
      gscEvidenceLines: [GSC_LINE],
      semrushEvidenceLines: [],
      clarityEvidenceLines: [],
      aeoEvidenceLines: [],
      evidenceDepth: 5,
      derivedConfidence: "strong_evidence",
      faqAnswerText: null,
      debug: {} as RecommendationActionRow["detail"]["debug"],
    } as unknown as RecommendationActionRow["detail"],
    ...overrides,
  } as RecommendationActionRow;
}

const PROMPTS: Record<string, string> = {
  "p-1": "best persian rug cleaner",
  "p-2": "persian rug cleaning cost",
  "p-3": "rug cleaning near me",
  "p-4": "fourth-should-not-appear",
};

describe("buildWhyInput", () => {
  it("mirrors the detail-client assembly (guarded why, capped prompts, competitor, lines)", () => {
    const input = buildWhyInput(makeRow(), PROMPTS, ["Rug Co"]);
    expect(input.actionType).toBe("add_faq");
    expect(input.targetLabel).toBe("Persian Rugs page");
    // why = evidenceSummary (guarded) since it's display-safe.
    expect(input.why).toContain("AI cites a rival");
    // up to 3 prompt texts; the 4th is dropped.
    expect(input.affectedPromptTexts).toHaveLength(3);
    expect(input.affectedPromptTexts).toContain("best persian rug cleaner");
    expect(input.affectedPromptTexts).not.toContain("fourth-should-not-appear");
    expect(input.competitor).toEqual({ name: "Rug Co", primaryPct: 0.42 });
    expect(input.gscEvidenceLines).toHaveLength(1);
    expect(input.promptCount).toBe(3);
    expect(input.observationCount).toBe(7);
    expect(input.derivedConfidence).toBe("strong_evidence");
  });

  it("serializeWhyInput puts the integer competitor percent into the ledger", () => {
    const input = buildWhyInput(makeRow(), PROMPTS, ["Rug Co"]);
    const { serialized } = serializeWhyInput(input);
    expect(serialized).toContain("42%");
    expect(serialized).toContain("1,800");
  });
});
