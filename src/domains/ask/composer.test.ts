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

  // W9 slice 1 (2026-07-09): count/rank/list question shapes bypass the LLM entirely,
  // not just as a budget/failure fallback - locked operator decision.
  it("PIN: a page_ranking dossier never calls the LLM, even with real data and budget available", async () => {
    const ranking: AskDossier = {
      questionClass: "page_ranking",
      pagePath: null,
      hasData: true,
      facts: [
        { value: "Your pages by Google clicks over the last 90 days, most first:", source: "gsc", href: "/results" },
        { value: "/cheetah: 412 clicks from 9,800 impressions (90 days).", source: "gsc", href: "/page/cheetah" },
      ],
    };
    const complete = vi.fn(fakeComplete([{ text: JSON.stringify(VALID_ANSWER) }]));
    const a = await composeAskAnswer("which page gets the most traffic", ranking, { complete });
    expect(a.source).toBe("fallback");
    expect(complete).not.toHaveBeenCalled();
  });

  it("PIN: a site_trend dossier never calls the LLM, even with real data and budget available", async () => {
    const trend: AskDossier = {
      questionClass: "site_trend",
      pagePath: null,
      hasData: true,
      facts: [{ value: "Sitewide clicks over the last 7 reported days: 342.", source: "gsc", href: "/" }],
    };
    const complete = vi.fn(fakeComplete([{ text: JSON.stringify(VALID_ANSWER) }]));
    const a = await composeAskAnswer("how are things going", trend, { complete });
    expect(a.source).toBe("fallback");
    expect(complete).not.toHaveBeenCalled();
  });

  it("PIN: a 'how many' question never calls the LLM regardless of question class", async () => {
    const complete = vi.fn(fakeComplete([{ text: JSON.stringify(VALID_ANSWER) }]));
    const a = await composeAskAnswer("how many changes did we ship this week", DOSSIER, { complete });
    expect(a.source).toBe("fallback");
    expect(complete).not.toHaveBeenCalled();
  });

  it("PIN: a 'list' question never calls the LLM regardless of question class", async () => {
    const complete = vi.fn(fakeComplete([{ text: JSON.stringify(VALID_ANSWER) }]));
    const a = await composeAskAnswer("list my top keywords", DOSSIER, { complete });
    expect(a.source).toBe("fallback");
    expect(complete).not.toHaveBeenCalled();
  });

  it("a plain page_specific narrative question still uses the LLM as before (deterministic bypass is scoped, not a blanket kill switch)", async () => {
    const a = await composeAskAnswer("why did clicks drop on cheetah", DOSSIER, {
      complete: fakeComplete([{ text: JSON.stringify(VALID_ANSWER) }]),
    });
    expect(a.source).toBe("llm");
  });

  // W9 slice 1: freshness + provenance render into the deterministic answer when a fact
  // carries them (set by the fact-provider registry's wired site_trend intent).
  it("PIN: the deterministic answer states freshness and provenance when a fact carries them", async () => {
    const trendWithFreshness: AskDossier = {
      questionClass: "site_trend",
      pagePath: null,
      hasData: true,
      facts: [
        {
          value: "Sitewide clicks over the last 7 reported days: 342.",
          source: "gsc",
          href: "/",
          freshnessIso: "2026-07-08",
          providerId: "gsc-daily-totals",
          prodLive: true,
        },
      ],
    };
    const a = await composeAskAnswer("how are things going", trendWithFreshness);
    expect(a.source).toBe("fallback");
    expect(a.answer).toContain("Data through 2026-07-08");
    expect(a.answer).toContain("Search demand");
    expect(a.answer).not.toMatch(/[–—]/);
  });

  it("the deterministic answer adds no freshness clause when no fact carries it", async () => {
    const a = fallbackAnswer("why did clicks drop on cheetah", DOSSIER);
    expect(a.answer).not.toContain("Data through");
  });

  // P2 fix (2026-07-10 review) - dossier.bestEffortOnly (threaded from the planner's
  // AskPlan.bestEffortOnly) makes router.ts's claim true: the answer really does say
  // plainly it only had overall traffic to go on, instead of the field being computed
  // and never consumed.
  it("PIN: dossier.bestEffortOnly adds the honest best-effort line to a deterministic answer", async () => {
    const bestEffort: AskDossier = {
      questionClass: "site_trend",
      pagePath: null,
      hasData: true,
      bestEffortOnly: true,
      facts: [{ value: "Sitewide clicks over the last 7 reported days: 342.", source: "gsc", href: "/" }],
    };
    const a = fallbackAnswer("how are things going", bestEffort);
    expect(a.answer).toContain("I did not spot a more specific question, so I looked at your overall traffic.");
    expect(a.answer).not.toMatch(/[–—]/);
  });

  it("adds no best-effort line when dossier.bestEffortOnly is unset (Slice-1 dossiers stay byte-identical)", async () => {
    const a = fallbackAnswer("how are things going", DOSSIER);
    expect(a.answer).not.toContain("I did not spot a more specific question");
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

// W9 slice 2 (2026-07-10) - the planner's whole-plan determinism verdict and multi-specialist answers.
describe("ask/composer - W9 slice 2 planner integration", () => {
  const MULTI: AskDossier = {
    questionClass: "page_ranking",
    pagePath: null,
    hasData: true,
    deterministic: true,
    selectedClasses: ["page_ranking", "keyword_next"],
    plannedProviderIds: ["page-ranking", "keyword-library"],
    facts: [
      { value: "Your pages by Google clicks over the last 90 days, most first:", source: "gsc", href: "/results", providerId: "page-ranking" },
      { value: "/cheetah: 412 clicks from 9,800 impressions (90 days).", source: "gsc", href: "/page/cheetah", providerId: "page-ranking" },
      { value: '"lion facts": about 500 searches a month, no page of ours owns this yet.', source: "dataforseo", href: "/research/keywords", providerId: "keyword-library" },
    ],
  };

  it("dossier.deterministic:true forces the fallback even for a class the shape check would send to the LLM", async () => {
    const detMeasurement: AskDossier = {
      questionClass: "measurement",
      pagePath: null,
      hasData: true,
      deterministic: true,
      facts: [{ value: "We shipped 3 changes this week.", source: "proof", href: "/changes" }],
    };
    const complete = vi.fn(fakeComplete([{ text: JSON.stringify(VALID_ANSWER) }]));
    const a = await composeAskAnswer("what did we ship this week", detMeasurement, { complete });
    expect(a.source).toBe("fallback");
    expect(complete).not.toHaveBeenCalled();
  });

  // P1 fix (2026-07-10 review) - a multi-specialist deterministic answer groups facts by
  // source in prose, but provenance (who was read, who came back empty) renders EXACTLY
  // ONCE, from the structured providersUsed/providersUnavailable fields only. The old
  // provenance-footer sentences must never reappear in answer.answer - the UI
  // (ask-chat-client.tsx) is the single place that renders them, as Specialists chips.
  it("a multi-specialist deterministic answer groups facts by source; provenance lives ONLY in the structured fields, never duplicated in prose", async () => {
    const complete = vi.fn(fakeComplete([{ text: JSON.stringify(VALID_ANSWER) }]));
    const a = await composeAskAnswer("list my top pages and top keywords", MULTI, { complete });
    expect(complete).not.toHaveBeenCalled();
    expect(a.source).toBe("fallback");
    expect(a.answer).toContain("From my Search demand read:");
    expect(a.answer).toContain("From my Live Google results read:");
    expect(a.answer).not.toContain("I pulled this together from my");
    expect(a.providersUsed?.map((p) => p.label)).toEqual(["Search demand", "Live Google results"]);
    expect(a.providersUnavailable).toEqual([]);
    expect(a.answer).not.toMatch(/[–—]/);
  });

  it("a multi-specialist answer owns the gap when a selected provider returned nothing, via the structured field ONLY (not duplicated in prose)", async () => {
    const withGap: AskDossier = {
      ...MULTI,
      facts: MULTI.facts.filter((f) => f.providerId === "page-ranking"),
    };
    const a = await composeAskAnswer("list my top pages and top keywords", withGap);
    expect(a.providersUnavailable?.map((p) => p.label)).toEqual(["Live Google results"]);
    expect(a.answer).not.toContain("I checked my Live Google results read too but found nothing there yet.");
    expect(a.answer).not.toMatch(/[–—]/);
  });

  it("dossier.deterministic:false with real data still reaches the LLM once and speaks as the Strategist", async () => {
    const synth: AskDossier = { ...MULTI, deterministic: false };
    const cited = synth.facts[0]!;
    const complete = vi.fn(
      fakeComplete([
        { text: JSON.stringify({ speaker: "gsc", answer: "Putting those together, your top page has an open keyword nearby.", citedFacts: [{ fact: cited.value, href: cited.href }] }) },
      ]),
    );
    const a = await composeAskAnswer("which page wins and what keyword is open", synth, { complete });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(a.source).toBe("llm");
    expect(a.speaker).toBe("llm");
    expect(a.providersUsed?.map((p) => p.label)).toEqual(["Search demand", "Live Google results"]);
  });
});
