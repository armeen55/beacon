import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Isolate from the budget store exactly like structured-drafter.test.ts.
const { checkBudgetMock, recordSpendMock } = vi.hoisted(() => ({
  checkBudgetMock: vi.fn(),
  recordSpendMock: vi.fn(),
}));
vi.mock("@/domains/recommendations/adjudicator-budget", () => ({
  checkBudget: checkBudgetMock,
  recordSpend: recordSpendMock,
}));

import { composeAskAnswer, fallbackAnswer } from "./composer";
import type { CompleteFn } from "@/domains/llm/structured-drafter";
import type { AskDossier } from "./types";

function fakeComplete(responses: Array<{ text: string } | { error: string }>): CompleteFn {
  let i = 0;
  return async () => responses[Math.min(i++, responses.length - 1)]!;
}

const DOSSIER: AskDossier = {
  questionClass: "page_specific",
  pagePath: "/cheetah",
  hasData: true,
  facts: [
    { value: "Cheetah (/cheetah) had 412 clicks and 9,800 impressions over the last 90 days.", source: "gsc", href: "/page/cheetah" },
    { value: "Cheetah had a sustained clicks drop of about 22% starting 2026-06-02.", source: "gsc", href: "/page/cheetah" },
  ],
};

const VALID_ANSWER = {
  speaker: "gsc",
  answer: "Clicks on the cheetah page dropped about 22% starting June 2, after running around 412 clicks over the last 90 days. That lines up with a real, sustained shift, not normal noise.",
  citedFacts: [
    { fact: "Cheetah (/cheetah) had 412 clicks and 9,800 impressions over the last 90 days.", href: "/page/cheetah" },
    { fact: "Cheetah had a sustained clicks drop of about 22% starting 2026-06-02.", href: "/page/cheetah" },
  ],
};

const ORIGINAL_PROVIDER = process.env.BEACON_LLM_PROVIDER;

beforeEach(() => {
  process.env.BEACON_LLM_PROVIDER = "openai";
  checkBudgetMock.mockResolvedValue({ allowed: true, remaining: 10 });
  recordSpendMock.mockResolvedValue(undefined);
});
afterEach(() => {
  process.env.BEACON_LLM_PROVIDER = ORIGINAL_PROVIDER;
  vi.clearAllMocks();
});

describe("ask/composer - fallbackAnswer", () => {
  it("returns an honest no-data answer when the dossier is empty", () => {
    const empty: AskDossier = { questionClass: "site_trend", pagePath: null, hasData: false, facts: [] };
    const a = fallbackAnswer("how are we doing", empty);
    expect(a.source).toBe("fallback");
    expect(a.citedFacts).toEqual([]);
    expect(a.answer.toLowerCase()).toContain("do not have enough");
  });

  it("builds a template answer from the top facts, citing every one", () => {
    const a = fallbackAnswer("why did clicks drop on cheetah", DOSSIER);
    expect(a.source).toBe("fallback");
    expect(a.speaker).toBe("gsc");
    expect(a.citedFacts).toHaveLength(2);
    expect(a.answer).toContain("412 clicks");
    expect(a.answer).toContain("22%");
  });

  it("never emits an em or en dash", () => {
    const a = fallbackAnswer("why did clicks drop on cheetah", DOSSIER);
    expect(a.answer).not.toMatch(/[–—]/);
  });
});

describe("ask/composer - composeAskAnswer (LLM path)", () => {
  it("uses the fallback when the dossier has no facts (never calls the LLM)", async () => {
    const complete = vi.fn(fakeComplete([{ text: JSON.stringify(VALID_ANSWER) }]));
    const empty: AskDossier = { questionClass: "site_trend", pagePath: null, hasData: false, facts: [] };
    const a = await composeAskAnswer("how are we doing", empty, { complete });
    expect(a.source).toBe("fallback");
    expect(complete).not.toHaveBeenCalled();
  });

  it("returns the LLM answer when it validates against the ask_answer schema", async () => {
    const a = await composeAskAnswer("why did clicks drop on cheetah", DOSSIER, {
      complete: fakeComplete([{ text: JSON.stringify(VALID_ANSWER) }]),
    });
    expect(a.source).toBe("llm");
    expect(a.speaker).toBe("gsc");
    expect(a.citedFacts.length).toBeGreaterThan(0);
  });

  it("falls back to the deterministic template when the LLM is off", async () => {
    process.env.BEACON_LLM_PROVIDER = "deterministic";
    const complete = vi.fn(fakeComplete([{ text: JSON.stringify(VALID_ANSWER) }]));
    const a = await composeAskAnswer("why did clicks drop on cheetah", DOSSIER, { complete });
    expect(a.source).toBe("fallback");
    expect(complete).not.toHaveBeenCalled();
  });

  it("falls back to the deterministic template when the budget is blocked", async () => {
    checkBudgetMock.mockResolvedValue({ allowed: false, reason: "cap reached" });
    const complete = vi.fn(fakeComplete([{ text: JSON.stringify(VALID_ANSWER) }]));
    const a = await composeAskAnswer("why did clicks drop on cheetah", DOSSIER, { complete });
    expect(a.source).toBe("fallback");
    expect(complete).not.toHaveBeenCalled();
  });

  // Numeric-fidelity firewall pin: any number in the LLM's answer that is NOT present in
  // the grounded facts must be rejected, which routes composeAskAnswer to the fallback.
  it("PIN: rejects an LLM answer that invents a number not present in the facts", async () => {
    const invented = {
      ...VALID_ANSWER,
      answer: "Clicks on the cheetah page dropped 87% because of a manual Google penalty issued on June 2.",
    };
    const a = await composeAskAnswer("why did clicks drop on cheetah", DOSSIER, {
      complete: fakeComplete([{ text: JSON.stringify(invented) }, { text: JSON.stringify(invented) }]),
    });
    expect(a.source).toBe("fallback");
  });

  it("PIN: an em dash in the LLM answer is normalized to a hyphen, never shipped raw", async () => {
    // structured-drafter's sanitizeDashesDeep runs BEFORE validation on every LLM draft
    // (dashes are a style fix, not a trust failure) - so the composer must never surface
    // a raw em/en dash to the operator even when the model emits one.
    const dashed = { ...VALID_ANSWER, answer: "Clicks dropped on the cheetah page, about 22 percent, starting June 2 - after 412 clicks over 90 days." };
    const a = await composeAskAnswer("why did clicks drop on cheetah", DOSSIER, {
      complete: fakeComplete([{ text: JSON.stringify(dashed) }]),
    });
    expect(a.answer).not.toMatch(/[–—]/);
  });

  it("drops a citedFacts entry whose href was not actually provided in the dossier", async () => {
    const fabricatedHref = {
      ...VALID_ANSWER,
      citedFacts: [{ fact: "Cheetah (/cheetah) had 412 clicks and 9,800 impressions over the last 90 days.", href: "/some/made-up/link" }],
    };
    const a = await composeAskAnswer("why did clicks drop on cheetah", DOSSIER, {
      complete: fakeComplete([{ text: JSON.stringify(fabricatedHref) }]),
    });
    // All cited hrefs were fabricated -> the whole answer falls back, never surfacing a dead link.
    expect(a.source).toBe("fallback");
  });
});
