import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * ask-actions.test (Codex P2, 2026-07-09; W9 slice 2 rewire 2026-07-10). Pins the
 * fail-CLOSED guard: when the server cannot resolve which tenant is asking,
 * askQuestionAction returns an honest "I cannot tell which site" answer WITHOUT planning,
 * gathering, composing, or persisting anything - it never proceeds into a tenant-scoped
 * read that could resolve (and cite) the wrong tenant's data. The happy path still runs
 * through the multi-provider planner (planAsk -> gatherPlan -> composeAskAnswer) when a
 * tenant resolves.
 */

vi.mock("@/lib/tenant-context", () => ({
  currentTenantId: vi.fn(async () => ""),
}));
vi.mock("@/domains/ask/planner", () => ({
  planAsk: vi.fn(() => ({
    routed: { questionClass: "measurement", pagePath: null, speaker: "proof" },
    selections: [{ provider: { id: "proof-ledger" }, matchedClass: "measurement", reason: "primary" }],
    selectedClasses: ["measurement"],
    deterministic: false,
    bestEffortOnly: false,
  })),
}));
vi.mock("@/domains/ask/fact-assembly", () => ({
  buildAskDossier: vi.fn(() => ({ questionClass: "measurement", pagePath: null, facts: [], hasData: false })),
}));
vi.mock("@/domains/ask/providers/registry", () => ({
  gatherPlan: vi.fn(async () => []),
}));
vi.mock("@/domains/ask/composer", () => ({
  composeAskAnswer: vi.fn(async () => ({ speaker: "proof", answer: "real composed answer", citedFacts: [], source: "fallback" })),
}));
vi.mock("@/domains/ask/history-store", () => ({
  appendAskHistory: vi.fn(async () => true),
  loadAskHistory: vi.fn(async () => []),
}));

import { askQuestionAction } from "./ask-actions";
import { currentTenantId } from "@/lib/tenant-context";
import { planAsk } from "@/domains/ask/planner";
import { gatherPlan } from "@/domains/ask/providers/registry";
import { composeAskAnswer } from "@/domains/ask/composer";
import { appendAskHistory } from "@/domains/ask/history-store";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("askQuestionAction - fail closed on an unresolved tenant (Codex P2)", () => {
  it("returns the cannot-tell-which-site answer and never plans, composes, or persists", async () => {
    vi.mocked(currentTenantId).mockResolvedValueOnce("");
    const result = await askQuestionAction("how did my last batch do?");
    expect(result.ok).toBe(true);
    expect(result.answer.source).toBe("fallback");
    expect(result.answer.speaker).toBe("llm");
    expect(result.answer.answer.toLowerCase()).toContain("cannot tell which site");
    expect(result.answer.citedFacts).toEqual([]);
    // Nothing tenant-scoped ran.
    expect(planAsk).not.toHaveBeenCalled();
    expect(gatherPlan).not.toHaveBeenCalled();
    expect(composeAskAnswer).not.toHaveBeenCalled();
    expect(appendAskHistory).not.toHaveBeenCalled();
  });

  it("proceeds through the planner path when a tenant resolves", async () => {
    vi.mocked(currentTenantId).mockResolvedValueOnce("tenant-a");
    const result = await askQuestionAction("how did my last batch do?");
    expect(result.ok).toBe(true);
    expect(planAsk).toHaveBeenCalledTimes(1);
    expect(gatherPlan).toHaveBeenCalledTimes(1);
    expect(composeAskAnswer).toHaveBeenCalledTimes(1);
    expect(result.answer.answer).toBe("real composed answer");
  });
});
