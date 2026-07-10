import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * ask-actions.test (Codex P2, 2026-07-09). Pins the fail-CLOSED guard: when the
 * server cannot resolve which tenant is asking, askQuestionAction returns an
 * honest "I cannot tell which site" answer WITHOUT routing, gathering, composing,
 * or persisting anything - it never proceeds into a tenant-scoped read that could
 * resolve (and cite) the wrong tenant's data. The happy path still runs when a
 * tenant resolves.
 */

vi.mock("@/lib/tenant-context", () => ({
  currentTenantId: vi.fn(async () => ""),
}));
vi.mock("@/domains/ask/router", () => ({
  routeQuestion: vi.fn(() => ({ questionClass: "measurement", pagePath: null, speaker: "proof" })),
}));
vi.mock("@/domains/ask/fact-assembly", () => ({
  assembleAskDossier: vi.fn(async () => ({ questionClass: "measurement", pagePath: null, facts: [], hasData: false })),
  buildAskDossier: vi.fn(() => ({ questionClass: "measurement", pagePath: null, facts: [], hasData: false })),
}));
vi.mock("@/domains/ask/providers/registry", () => ({
  gatherFacts: vi.fn(async () => []),
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
import { routeQuestion } from "@/domains/ask/router";
import { composeAskAnswer } from "@/domains/ask/composer";
import { appendAskHistory } from "@/domains/ask/history-store";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("askQuestionAction - fail closed on an unresolved tenant (Codex P2)", () => {
  it("returns the cannot-tell-which-site answer and never routes, composes, or persists", async () => {
    vi.mocked(currentTenantId).mockResolvedValueOnce("");
    const result = await askQuestionAction("how did my last batch do?");
    expect(result.ok).toBe(true);
    expect(result.answer.source).toBe("fallback");
    expect(result.answer.speaker).toBe("llm");
    expect(result.answer.answer.toLowerCase()).toContain("cannot tell which site");
    expect(result.answer.citedFacts).toEqual([]);
    // Nothing tenant-scoped ran.
    expect(routeQuestion).not.toHaveBeenCalled();
    expect(composeAskAnswer).not.toHaveBeenCalled();
    expect(appendAskHistory).not.toHaveBeenCalled();
  });

  it("proceeds normally when a tenant resolves", async () => {
    vi.mocked(currentTenantId).mockResolvedValueOnce("tenant-a");
    const result = await askQuestionAction("how did my last batch do?");
    expect(result.ok).toBe(true);
    expect(routeQuestion).toHaveBeenCalledTimes(1);
    expect(composeAskAnswer).toHaveBeenCalledTimes(1);
    expect(result.answer.answer).toBe("real composed answer");
  });
});
