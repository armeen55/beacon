import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Isolate the drafter from the budget store: control the gate deterministically
// and assert spend is recorded per call. (vi.hoisted so the mock factory can see them.)
const { checkBudgetMock, recordSpendMock } = vi.hoisted(() => ({
  checkBudgetMock: vi.fn(),
  recordSpendMock: vi.fn(),
}));
vi.mock("@/domains/recommendations/adjudicator-budget", () => ({
  checkBudget: checkBudgetMock,
  recordSpend: recordSpendMock,
}));

// BEACON_500 item 30: control the winner-memory lookup deterministically so the
// prompt-injection pin can assert both the "winners exist" and "no winners"
// (byte-identical prompt) paths without touching the real json-store.
// BEACON_500 item 74: same posture for the pattern-aware builder - defaults to "no
// confident cell yet" so every pre-existing test (which never passes pageFamily) is
// unaffected, and this item's own tests override the resolved value per-case.
type PatternHintFixture = {
  pattern: "definition_first" | "stat_first" | "table" | "qa_pair" | "step_list" | "prose_other";
  pageFamily: string;
  wins: number;
  losses: number;
  pending: number;
  decided: number;
  winRate: number;
  confident: boolean;
  winningPage: string | null;
};
const { buildWinnerFewShotsMock, buildWinnerFewShotsWithPatternMock } = vi.hoisted(() => ({
  buildWinnerFewShotsMock: vi.fn(async (): Promise<string> => ""),
  buildWinnerFewShotsWithPatternMock: vi.fn(async (): Promise<{ fragment: string; patternHint: PatternHintFixture | null }> => ({ fragment: "", patternHint: null })),
}));
vi.mock("./winner-memory", () => ({
  buildWinnerFewShots: buildWinnerFewShotsMock,
  buildWinnerFewShotsWithPattern: buildWinnerFewShotsWithPatternMock,
}));

import {
  callStructuredLLM,
  draftAnswerBlockStructured,
  draftAtomicEditStructured,
  draftAeoPromptBrief,
  intentDirective,
  serializeStructuredDraft,
  deserializeStructuredDraft,
  type CompleteFn,
} from "./structured-drafter";
import { draftFactsCoveredBySources } from "@/domains/drafts/source-authority";

const GROUNDED = "persian wedding traditions sofreh aghd aghd jashn reception ceremony canopy";

const validAnswer = {
  answer:
    "Persian weddings center on the sofreh aghd, a ceremonial spread of symbolic items the couple sits before while honored guests hold a canopy above them, followed by the aghd vows and a celebratory jashn reception with family and friends. The spread gathers a mirror, twin candelabras, flatbread, fresh herbs, and sweets, each chosen to wish the couple light, health, and a sweet life together. Elders witness the reading of the marriage contract, the newlyweds share a taste of honey, and the music, dancing, and feasting of the reception then carry the celebration late into the night for every guest.",
  citationHook: "the sofreh aghd is the heart of a Persian wedding",
  evidenceRefs: [{ source: "competitor_teardown", detail: "the cited page leads with a sofreh aghd explainer" }],
  confidence: "high",
  risks: ["keep claims neutral"],
  operatorSteps: ["Add this answer block directly under the H1"],
  proofPlan: { metrics: ["Profound citations", "position"], windowsDays: [7, 14, 28], controls: "comparable unchanged pages" },
};

/** A completion fn that replays a fixed queue of responses (last one repeats). */
function fakeComplete(responses: Array<{ text: string } | { error: string }>): CompleteFn {
  let i = 0;
  return async () => responses[Math.min(i++, responses.length - 1)]!;
}

const ORIGINAL_PROVIDER = process.env.BEACON_LLM_PROVIDER;

beforeEach(() => {
  process.env.BEACON_LLM_PROVIDER = "openai"; // opt into the enabled path (vitest pins "deterministic")
  checkBudgetMock.mockResolvedValue({ allowed: true, remaining: 10 });
  recordSpendMock.mockResolvedValue(undefined);
  buildWinnerFewShotsMock.mockReset();
  buildWinnerFewShotsMock.mockResolvedValue(""); // default: no winners → prompts unchanged
  buildWinnerFewShotsWithPatternMock.mockReset();
  buildWinnerFewShotsWithPatternMock.mockResolvedValue({ fragment: "", patternHint: null }); // default: no confident cell
});
afterEach(() => {
  process.env.BEACON_LLM_PROVIDER = ORIGINAL_PROVIDER;
  vi.clearAllMocks();
  vi.useRealTimers(); // no-op unless a test opted into fake timers (P2 deadline tests)
});

describe("callStructuredLLM — gate + budget", () => {
  it("returns 'off' when BEACON_LLM_PROVIDER is not openai", async () => {
    process.env.BEACON_LLM_PROVIDER = "deterministic";
    const r = await callStructuredLLM({ kind: "answer_block", system: "s", user: "u", grounded: GROUNDED, complete: fakeComplete([{ text: JSON.stringify(validAnswer) }]) });
    expect(r.status).toBe("off");
  });

  it("returns 'blocked_budget' and never calls the LLM when the cap is hit", async () => {
    checkBudgetMock.mockResolvedValue({ allowed: false, reason: "cap reached" });
    const complete = vi.fn(fakeComplete([{ text: JSON.stringify(validAnswer) }]));
    const r = await callStructuredLLM({ kind: "answer_block", system: "s", user: "u", grounded: GROUNDED, complete });
    expect(r.status).toBe("blocked_budget");
    expect(complete).not.toHaveBeenCalled();
  });
});

describe("callStructuredLLM — validate / retry / fail-closed", () => {
  it("drafts on a valid first response (no retry) and records spend once", async () => {
    const r = await callStructuredLLM({ kind: "answer_block", system: "s", user: "u", grounded: GROUNDED, complete: fakeComplete([{ text: JSON.stringify(validAnswer) }]) });
    expect(r.status).toBe("drafted");
    if (r.status === "drafted") {
      expect(r.retried).toBe(false);
      expect(r.value.answer).toContain("sofreh aghd");
      expect(r.value.evidenceRefs.length).toBeGreaterThan(0);
    }
    expect(recordSpendMock).toHaveBeenCalledTimes(1);
  });

  it("RETRIES ONCE on invalid JSON, then drafts (records spend twice)", async () => {
    const r = await callStructuredLLM({ kind: "answer_block", system: "s", user: "u", grounded: GROUNDED, complete: fakeComplete([{ text: "not json at all" }, { text: JSON.stringify(validAnswer) }]) });
    expect(r.status).toBe("drafted");
    if (r.status === "drafted") expect(r.retried).toBe(true);
    expect(recordSpendMock).toHaveBeenCalledTimes(2);
  });

  it("FAILS CLOSED on invalid JSON twice", async () => {
    const r = await callStructuredLLM({ kind: "answer_block", system: "s", user: "u", grounded: GROUNDED, complete: fakeComplete([{ text: "nope" }, { text: "still nope" }]) });
    expect(r.status).toBe("validation_failed");
    if (r.status === "validation_failed") {
      expect(r.retried).toBe(true);
      expect(r.errors.some((e) => e.includes("non_json"))).toBe(true);
    }
  });

  it("REJECTS a draft with no evidenceRefs (fails closed after retry)", async () => {
    const noEvidence = JSON.stringify({ ...validAnswer, evidenceRefs: [] });
    const r = await callStructuredLLM({ kind: "answer_block", system: "s", user: "u", grounded: GROUNDED, complete: fakeComplete([{ text: noEvidence }]) });
    expect(r.status).toBe("validation_failed");
    if (r.status === "validation_failed") expect(r.errors.some((e) => e.toLowerCase().includes("evidenceref"))).toBe(true);
  });

  it("REJECTS an invented multi-digit number not present in the grounding (firewall)", async () => {
    const invented = JSON.stringify({ ...validAnswer, answer: validAnswer.answer + " The tradition dates to exactly 1847 in every region." });
    const r = await callStructuredLLM({ kind: "answer_block", system: "s", user: "u", grounded: GROUNDED, complete: fakeComplete([{ text: invented }]) });
    expect(r.status).toBe("validation_failed");
    if (r.status === "validation_failed") expect(r.errors.some((e) => e.includes("firewall:invented_numbers"))).toBe(true);
  });

  // ── FIX 1 (pilot re-run): the numeric firewall scans PROSE, never citation metadata ──
  const withCitationDate = (retrievedAt: string, extraAnswer = ""): string =>
    JSON.stringify({
      ...validAnswer,
      answer: validAnswer.answer + extraAnswer,
      sources: [
        {
          url: "https://en.wikipedia.org/wiki/Persian_wedding",
          title: "Persian wedding",
          domain: "wikipedia.org",
          retrievedAt,
          claim: "a Persian wedding centers on the sofreh aghd ceremonial spread",
          authority: "unverified",
        },
      ],
    });

  it("the exact re-run case: a source retrievedAt of 2026-07-11 no longer fails a grounded-prose draft", async () => {
    const r = await callStructuredLLM({ kind: "answer_block", system: "s", user: "u", grounded: GROUNDED, complete: fakeComplete([{ text: withCitationDate("2026-07-11") }]) });
    expect(r.status).toBe("drafted");
  });

  it("still REJECTS a fabricated prose year even when the citation date is clean", async () => {
    const r = await callStructuredLLM({ kind: "answer_block", system: "s", user: "u", grounded: GROUNDED, complete: fakeComplete([{ text: withCitationDate("2026", " The oldest ceremony on record dates to 1723.") }]) });
    expect(r.status).toBe("validation_failed");
    if (r.status === "validation_failed") expect(r.errors.some((e) => e.includes("firewall:invented_numbers:1723"))).toBe(true);
  });

  it("no laundering: a prose number matching ONLY the citation date still fails (metadata is never added to the ledger)", async () => {
    // "2026-07-11" in the ANSWER: 2026 is the grounded year, but 07 and 11 appear
    // nowhere in the grounding and only as this citation's own date -> still caught.
    const r = await callStructuredLLM({ kind: "answer_block", system: "s", user: "u", grounded: GROUNDED, complete: fakeComplete([{ text: withCitationDate("2026-07-11", " The custom was codified on 2026-07-11 nationwide.") }]) });
    expect(r.status).toBe("validation_failed");
    if (r.status === "validation_failed") expect(r.errors.some((e) => e.includes("firewall:invented_numbers"))).toBe(true);
  });

  // ── Drafter batch 2 (2026-07-11): the generation-time firewall scans PROSE
  //    only - proofPlan/operatorSteps/risks (product-authored methodology) are
  //    excluded the same way citation metadata already was (FIX 1 above). Both
  //    live pilot loop 6 attempt-1s died on the model's own proofPlan.metrics
  //    text "target 100%" - this is the exact killer, reproduced. ──────────
  it("pilot loop 6 killer: proofPlan.metrics 'target 100%' no longer fails generation-time (grounded prose)", async () => {
    const withTargetInProofPlan = JSON.stringify({
      ...validAnswer,
      proofPlan: { ...validAnswer.proofPlan, metrics: [...validAnswer.proofPlan.metrics, "measure clicks for 28 days, target 100%"] },
    });
    const r = await callStructuredLLM({ kind: "answer_block", system: "s", user: "u", grounded: GROUNDED, complete: fakeComplete([{ text: withTargetInProofPlan }]) });
    expect(r.status).toBe("drafted");
    if (r.status === "drafted") expect(r.retried).toBe(false); // attempt 1 - no longer dies on its own methodology text
  });

  it("a fabricated number IN PROSE still fails at generation time even with an unrelated proofPlan target", async () => {
    const invented = JSON.stringify({
      ...validAnswer,
      answer: validAnswer.answer + " Attendance figures show exactly 4821 guests on average.",
      proofPlan: { ...validAnswer.proofPlan, metrics: [...validAnswer.proofPlan.metrics, "measure clicks for 28 days, target 100%"] },
    });
    const r = await callStructuredLLM({ kind: "answer_block", system: "s", user: "u", grounded: GROUNDED, complete: fakeComplete([{ text: invented }]) });
    expect(r.status).toBe("validation_failed");
    if (r.status === "validation_failed") expect(r.errors.some((e) => e.includes("firewall:invented_numbers:4821"))).toBe(true);
  });

  it("no laundering: a fabricated prose number is not excused by the SAME number also appearing in the excluded proofPlan text", async () => {
    const invented = JSON.stringify({
      ...validAnswer,
      answer: validAnswer.answer + " Attendance figures show exactly 4821 guests on average.",
      proofPlan: { ...validAnswer.proofPlan, metrics: [...validAnswer.proofPlan.metrics, "target 4821 in the same window"] },
    });
    const r = await callStructuredLLM({ kind: "answer_block", system: "s", user: "u", grounded: GROUNDED, complete: fakeComplete([{ text: invented }]) });
    expect(r.status).toBe("validation_failed");
    if (r.status === "validation_failed") expect(r.errors.some((e) => e.includes("firewall:invented_numbers:4821"))).toBe(true);
  });

  it("an invented number confined to operatorSteps/risks alone (grounded prose) still drafts - not a customer-facing claim", async () => {
    const withNumbersInMethodology = JSON.stringify({
      ...validAnswer,
      risks: ["watch for drift past 4821 impressions"],
      operatorSteps: ["Add this answer block directly under the H1, near the 4821 badge"],
    });
    const r = await callStructuredLLM({ kind: "answer_block", system: "s", user: "u", grounded: GROUNDED, complete: fakeComplete([{ text: withNumbersInMethodology }]) });
    expect(r.status).toBe("drafted");
  });

  it("SANITIZES em-dashes (style, not trust) instead of rejecting the draft", async () => {
    const withDash = JSON.stringify({ ...validAnswer, answer: validAnswer.answer.replace("them, followed", "them—followed") });
    const r = await callStructuredLLM({ kind: "answer_block", system: "s", user: "u", grounded: GROUNDED, complete: fakeComplete([{ text: withDash }]) });
    expect(r.status).toBe("drafted");
    if (r.status === "drafted") expect(r.value.answer).not.toContain("—");
  });

  it("retries past a transient LLM error and then drafts", async () => {
    const r = await callStructuredLLM({ kind: "answer_block", system: "s", user: "u", grounded: GROUNDED, complete: fakeComplete([{ error: "openai_500" }, { text: JSON.stringify(validAnswer) }]) });
    expect(r.status).toBe("drafted");
    if (r.status === "drafted") expect(r.retried).toBe(true);
  });
});

describe("draftAnswerBlockStructured (concrete wrapper)", () => {
  it("builds the prompt + grounding and returns a validated draft", async () => {
    const r = await draftAnswerBlockStructured(
      { query: "persian wedding traditions", pageLabel: "Persian Wedding", brief: "sofreh aghd ceremony aghd jashn reception canopy", outline: ["Sofreh aghd", "The reception"], faqs: ["What is the sofreh aghd?"] },
      { complete: fakeComplete([{ text: JSON.stringify(validAnswer) }]) },
    );
    expect(r.status).toBe("drafted");
  });
});

describe("intent-aware drafting (C) — the answer type follows the searcher's intent", () => {
  it("intentDirective steers a WHEN query to a date, not a definition", () => {
    expect(intentDirective("when")).toMatch(/date|timeline/i);
    expect(intentDirective("when")).toMatch(/never a definition/i);
    expect(intentDirective("cost")).toMatch(/price|number/i);
    expect(intentDirective("what")).toMatch(/what this .* is/i);
    expect(intentDirective(undefined)).toBe("");
    expect(intentDirective("nonsense")).toBe("");
  });

  it("injects the intent directive into the answer-block prompt when intent is set", async () => {
    let capturedUser = "";
    const capture: CompleteFn = async ({ user }) => { capturedUser = user; return { text: JSON.stringify(validAnswer) }; };
    const r = await draftAnswerBlockStructured(
      { query: "chaharshanbe suri 2026", pageLabel: "Chaharshanbe Suri", brief: null, outline: [], faqs: [], intent: "when" },
      { complete: capture },
    );
    expect(r.status).toBe("drafted");
    expect(capturedUser).toContain("What the searcher wants:");
    expect(capturedUser).toMatch(/date or timeline/i);
  });

  it("omits the directive when no intent is given (back-compat)", async () => {
    let capturedUser = "";
    const capture: CompleteFn = async ({ user }) => { capturedUser = user; return { text: JSON.stringify(validAnswer) }; };
    await draftAnswerBlockStructured(
      { query: "persian wedding traditions", pageLabel: "Persian Wedding", brief: "sofreh aghd", outline: [], faqs: [] },
      { complete: capture },
    );
    expect(capturedUser).not.toContain("What the searcher wants:");
  });
});

describe("BEACON_500 item 30 - winner few-shot injection (additive, fail-soft)", () => {
  it("answer_block: system prompt is BYTE-IDENTICAL to the no-tenantId path when no winners exist", async () => {
    let systemNoTenant = "";
    let systemWithTenant = "";
    await draftAnswerBlockStructured(
      { query: "chaharshanbe suri", pageLabel: "Chaharshanbe Suri", brief: null, outline: [], faqs: [] },
      { complete: async ({ system }) => { systemNoTenant = system; return { text: JSON.stringify(validAnswer) }; } },
    );
    await draftAnswerBlockStructured(
      { query: "chaharshanbe suri", pageLabel: "Chaharshanbe Suri", brief: null, outline: [], faqs: [], tenantId: "tenant-a" },
      { complete: async ({ system }) => { systemWithTenant = system; return { text: JSON.stringify(validAnswer) }; } },
    );
    expect(buildWinnerFewShotsMock).toHaveBeenCalledWith("tenant-a", "answer");
    expect(systemWithTenant).toBe(systemNoTenant); // buildWinnerFewShots resolved '' → no change
  });

  it("answer_block: the fragment IS present in the system prompt when winners exist", async () => {
    buildWinnerFewShotsMock.mockResolvedValue("\nHouse patterns that measurably lifted CTR: example text here.");
    let capturedSystem = "";
    await draftAnswerBlockStructured(
      { query: "chaharshanbe suri", pageLabel: "Chaharshanbe Suri", brief: null, outline: [], faqs: [], tenantId: "tenant-a" },
      { complete: async ({ system }) => { capturedSystem = system; return { text: JSON.stringify(validAnswer) }; } },
    );
    expect(capturedSystem).toContain("House patterns that measurably lifted CTR");
  });

  it("answer_block: never calls buildWinnerFewShots when no tenantId is given (no lookup, no I/O)", async () => {
    await draftAnswerBlockStructured(
      { query: "chaharshanbe suri", pageLabel: "Chaharshanbe Suri", brief: null, outline: [], faqs: [] },
      { complete: fakeComplete([{ text: JSON.stringify(validAnswer) }]) },
    );
    expect(buildWinnerFewShotsMock).not.toHaveBeenCalled();
  });

  it("atomic_edit (title field): system prompt is byte-identical with no winners, present when winners exist", async () => {
    const validEdit = {
      field: "title",
      before: "Old Title",
      after: "New Sharper Title",
      rationale: "matches intent",
      evidenceRefs: [{ source: "gsc", detail: "low CTR at position 4" }],
      confidence: "high",
      risks: [],
      operatorSteps: ["Update the title tag"],
      proofPlan: { metrics: ["CTR"], windowsDays: [7, 14, 28], controls: "comparable pages" },
    };
    let systemNoTenant = "";
    let systemWithTenant = "";
    await draftAtomicEditStructured(
      { query: "iranian singers", pageLabel: "Singers", field: "title", currentValue: "Old Title", outline: [] },
      { complete: async ({ system }) => { systemNoTenant = system; return { text: JSON.stringify(validEdit) }; } },
    );
    await draftAtomicEditStructured(
      { query: "iranian singers", pageLabel: "Singers", field: "title", currentValue: "Old Title", outline: [], tenantId: "tenant-a" },
      { complete: async ({ system }) => { systemWithTenant = system; return { text: JSON.stringify(validEdit) }; } },
    );
    expect(buildWinnerFewShotsMock).toHaveBeenCalledWith("tenant-a", "title");
    expect(systemWithTenant).toBe(systemNoTenant);

    buildWinnerFewShotsMock.mockResolvedValue("\nHouse patterns that measurably lifted CTR: title example.");
    let capturedSystem = "";
    await draftAtomicEditStructured(
      { query: "iranian singers", pageLabel: "Singers", field: "title", currentValue: "Old Title", outline: [], tenantId: "tenant-a" },
      { complete: async ({ system }) => { capturedSystem = system; return { text: JSON.stringify(validEdit) }; } },
    );
    expect(capturedSystem).toContain("House patterns that measurably lifted CTR");
  });

  it("atomic_edit (meta field) looks up the 'meta' lever, not 'title'", async () => {
    const validEdit = {
      field: "meta",
      before: "Old meta",
      after: "New sharper meta description that matches intent and stays within length.",
      rationale: "matches intent",
      evidenceRefs: [{ source: "gsc", detail: "low CTR" }],
      confidence: "high",
      risks: [],
      operatorSteps: ["Update the meta tag"],
      proofPlan: { metrics: ["CTR"], windowsDays: [7, 14, 28], controls: "comparable pages" },
    };
    await draftAtomicEditStructured(
      { query: "iranian singers", pageLabel: "Singers", field: "meta", currentValue: "Old meta", outline: [], tenantId: "tenant-a" },
      { complete: fakeComplete([{ text: JSON.stringify(validEdit) }]) },
    );
    expect(buildWinnerFewShotsMock).toHaveBeenCalledWith("tenant-a", "meta");
  });

  it("the injected fragment itself never contains an em or en dash (hyphens only)", async () => {
    // The fragment text is winner-memory's own output (guard-tested there). Here we pin that
    // structured-drafter APPENDS it verbatim without introducing a dash of its own - check the
    // appended suffix, not the whole system string (a pre-existing hand-written prompt line
    // unrelated to this item already contains one, and item 30 must not touch that prompt copy).
    const fragment = "\nHouse patterns: example - with a hyphen, not a dash.";
    buildWinnerFewShotsMock.mockResolvedValue(fragment);
    let capturedSystem = "";
    await draftAnswerBlockStructured(
      { query: "chaharshanbe suri", pageLabel: "Chaharshanbe Suri", brief: null, outline: [], faqs: [], tenantId: "tenant-a" },
      { complete: async ({ system }) => { capturedSystem = system; return { text: JSON.stringify(validAnswer) }; } },
    );
    expect(capturedSystem.endsWith(fragment)).toBe(true);
    expect(fragment).not.toMatch(/[–—]/);
  });
});

describe("BEACON_500 item 74 - pattern-aware few-shot injection (additive, fail-soft)", () => {
  it("answer_block: never calls the pattern-aware builder when no pageFamily is given (back-compat)", async () => {
    await draftAnswerBlockStructured(
      { query: "chaharshanbe suri", pageLabel: "Chaharshanbe Suri", brief: null, outline: [], faqs: [], tenantId: "tenant-a" },
      { complete: fakeComplete([{ text: JSON.stringify(validAnswer) }]) },
    );
    expect(buildWinnerFewShotsWithPatternMock).not.toHaveBeenCalled();
    expect(buildWinnerFewShotsMock).toHaveBeenCalledWith("tenant-a", "answer");
  });

  it("answer_block: system prompt is BYTE-IDENTICAL to the no-pattern-hint path when the aggregate has no confident cell", async () => {
    buildWinnerFewShotsWithPatternMock.mockResolvedValue({ fragment: "", patternHint: null });
    let systemNoFamily = "";
    let systemWithFamily = "";
    await draftAnswerBlockStructured(
      { query: "chaharshanbe suri", pageLabel: "Chaharshanbe Suri", brief: null, outline: [], faqs: [], tenantId: "tenant-a" },
      { complete: async ({ system }) => { systemNoFamily = system; return { text: JSON.stringify(validAnswer) }; } },
    );
    await draftAnswerBlockStructured(
      { query: "chaharshanbe suri", pageLabel: "Chaharshanbe Suri", brief: null, outline: [], faqs: [], tenantId: "tenant-a", pageFamily: "holidays" },
      { complete: async ({ system }) => { systemWithFamily = system; return { text: JSON.stringify(validAnswer) }; } },
    );
    expect(buildWinnerFewShotsWithPatternMock).toHaveBeenCalledWith("tenant-a", "answer", "holidays");
    expect(systemWithFamily).toBe(systemNoFamily);
  });

  it("answer_block: result carries NO fewShot field when the aggregate has no confident cell", async () => {
    buildWinnerFewShotsWithPatternMock.mockResolvedValue({ fragment: "", patternHint: null });
    const r = await draftAnswerBlockStructured(
      { query: "chaharshanbe suri", pageLabel: "Chaharshanbe Suri", brief: null, outline: [], faqs: [], tenantId: "tenant-a", pageFamily: "holidays" },
      { complete: fakeComplete([{ text: JSON.stringify(validAnswer) }]) },
    );
    expect(r.status).toBe("drafted");
    if (r.status === "drafted") expect(r.fewShot).toBeUndefined();
  });

  it("answer_block: appends the pattern hint fragment AND sets fewShot when the aggregate has a confident cell", async () => {
    buildWinnerFewShotsWithPatternMock.mockResolvedValue({
      fragment: "\nWinning style for holidays pages here: stat-first blocks won 100 percent of the time (3 of 3 decided).",
      patternHint: { pattern: "stat_first", pageFamily: "holidays", wins: 3, losses: 0, pending: 0, decided: 3, winRate: 1, confident: true, winningPage: "https://iranopedia.com/nowruz" },
    });
    let capturedSystem = "";
    const r = await draftAnswerBlockStructured(
      { query: "chaharshanbe suri", pageLabel: "Chaharshanbe Suri", brief: null, outline: [], faqs: [], tenantId: "tenant-a", pageFamily: "holidays" },
      { complete: async ({ system }) => { capturedSystem = system; return { text: JSON.stringify(validAnswer) }; } },
    );
    expect(capturedSystem).toContain("Winning style for holidays pages here");
    expect(r.status).toBe("drafted");
    if (r.status === "drafted") {
      expect(r.fewShot?.pattern).toBe("stat_first");
      expect(r.fewShot?.winningPage).toBe("https://iranopedia.com/nowruz");
      expect(r.fewShot?.sentence).toContain("stat-first");
      expect(r.fewShot?.sentence).toContain("nowruz");
      expect(r.fewShot?.sentence).not.toMatch(/[–—]/);
    }
  });

  it("atomic_edit: system prompt is byte-identical with no confident cell, present when one exists", async () => {
    const validEdit = {
      field: "title", before: "Old Title", after: "New Sharper Title", rationale: "matches intent",
      evidenceRefs: [{ source: "gsc", detail: "low CTR at position 4" }], confidence: "high", risks: [],
      operatorSteps: ["Update the title tag"], proofPlan: { metrics: ["CTR"], windowsDays: [7, 14, 28], controls: "comparable pages" },
    };
    let systemNoFamily = "";
    let systemWithFamily = "";
    await draftAtomicEditStructured(
      { query: "iranian singers", pageLabel: "Singers", field: "title", currentValue: "Old Title", outline: [], tenantId: "tenant-a" },
      { complete: async ({ system }) => { systemNoFamily = system; return { text: JSON.stringify(validEdit) }; } },
    );
    await draftAtomicEditStructured(
      { query: "iranian singers", pageLabel: "Singers", field: "title", currentValue: "Old Title", outline: [], tenantId: "tenant-a", pageFamily: "singers" },
      { complete: async ({ system }) => { systemWithFamily = system; return { text: JSON.stringify(validEdit) }; } },
    );
    expect(systemWithFamily).toBe(systemNoFamily);
    expect(buildWinnerFewShotsWithPatternMock).toHaveBeenCalledWith("tenant-a", "title", "singers");
  });

  it("atomic_edit: prepends the exact controlled provenance sentence to the model's own rationale when confident", async () => {
    buildWinnerFewShotsWithPatternMock.mockResolvedValue({
      fragment: "\nWinning style for singers pages here: stat-first blocks won 100 percent of the time (3 of 3 decided).",
      patternHint: { pattern: "stat_first", pageFamily: "singers", wins: 3, losses: 0, pending: 0, decided: 3, winRate: 1, confident: true, winningPage: "https://iranopedia.com/singers" },
    });
    const validEdit = {
      field: "title", before: "Old Title", after: "New Sharper Title", rationale: "matches the searcher's intent",
      evidenceRefs: [{ source: "gsc", detail: "low CTR at position 4" }], confidence: "high", risks: [],
      operatorSteps: ["Update the title tag"], proofPlan: { metrics: ["CTR"], windowsDays: [7, 14, 28], controls: "comparable pages" },
    };
    const r = await draftAtomicEditStructured(
      { query: "iranian singers", pageLabel: "Singers", field: "title", currentValue: "Old Title", outline: [], tenantId: "tenant-a", pageFamily: "singers" },
      { complete: fakeComplete([{ text: JSON.stringify(validEdit) }]) },
    );
    expect(r.status).toBe("drafted");
    if (r.status === "drafted") {
      expect(r.value.rationale.startsWith("I wrote this the way your last winners were written:")).toBe(true);
      expect(r.value.rationale).toContain("stat-first");
      expect(r.value.rationale).toContain("like the block that won on https://iranopedia.com/singers");
      expect(r.value.rationale).toContain("matches the searcher's intent"); // the model's own sentence survives
      expect(r.value.rationale.length).toBeLessThanOrEqual(400); // schema cap re-applied
      expect(r.fewShot?.pattern).toBe("stat_first");
    }
  });

  it("atomic_edit: rationale is UNCHANGED (no prepended sentence) when the aggregate has no confident cell", async () => {
    const validEdit = {
      field: "title", before: "Old Title", after: "New Sharper Title", rationale: "matches the searcher's intent",
      evidenceRefs: [{ source: "gsc", detail: "low CTR at position 4" }], confidence: "high", risks: [],
      operatorSteps: ["Update the title tag"], proofPlan: { metrics: ["CTR"], windowsDays: [7, 14, 28], controls: "comparable pages" },
    };
    const r = await draftAtomicEditStructured(
      { query: "iranian singers", pageLabel: "Singers", field: "title", currentValue: "Old Title", outline: [], tenantId: "tenant-a", pageFamily: "singers" },
      { complete: fakeComplete([{ text: JSON.stringify(validEdit) }]) },
    );
    expect(r.status).toBe("drafted");
    if (r.status === "drafted") expect(r.value.rationale).toBe("matches the searcher's intent");
  });

  it("no fewShotProvenance is ever threaded onto a non-drafted result (blocked/validation_failed)", async () => {
    buildWinnerFewShotsWithPatternMock.mockResolvedValue({
      fragment: "\nWinning style: stat-first blocks won 100 percent of the time (3 of 3 decided).",
      patternHint: { pattern: "stat_first", pageFamily: "singers", wins: 3, losses: 0, pending: 0, decided: 3, winRate: 1, confident: true, winningPage: null },
    });
    const r = await draftAnswerBlockStructured(
      { query: "chaharshanbe suri", pageLabel: "Chaharshanbe Suri", brief: null, outline: [], faqs: [], tenantId: "tenant-a", pageFamily: "singers" },
      { complete: fakeComplete([{ text: "not json" }]) },
    );
    expect(r.status).toBe("validation_failed");
    expect((r as { fewShot?: unknown }).fewShot).toBeUndefined();
  });
});

describe("serialize / deserialize (persistence projection + re-validation)", () => {
  it("round-trips a validated draft", () => {
    const content = serializeStructuredDraft("answer_block", validAnswer);
    const back = deserializeStructuredDraft(content);
    expect(back).not.toBeNull();
    expect(back!.kind).toBe("answer_block");
    expect((back!.value as { answer: string }).answer).toContain("sofreh aghd");
  });
  it("RE-VALIDATES on read: a tampered row with no evidenceRefs is rejected (→ null)", () => {
    const tampered = serializeStructuredDraft("answer_block", { ...validAnswer, evidenceRefs: [] });
    expect(deserializeStructuredDraft(tampered)).toBeNull();
  });
  it("rejects garbage, wrong version, and unknown kind", () => {
    expect(deserializeStructuredDraft("{not json")).toBeNull();
    expect(deserializeStructuredDraft(JSON.stringify({ v: 2, kind: "answer_block", value: validAnswer }))).toBeNull();
    expect(deserializeStructuredDraft(JSON.stringify({ v: 1, kind: "bogus", value: {} }))).toBeNull();
  });
});

describe("draftAeoPromptBrief — Profound Question Intelligence brief", () => {
  const validBrief = {
    direct_answer_40_80_words:
      "Taarof is a Persian system of ritual politeness where people offer, refuse, and re-offer hospitality or favors as a sign of respect and humility, so a first offer is often declined out of courtesy and should be repeated sincerely before it is accepted by the other person.",
    fanout_sections: [
      { question: "How do you politely refuse taarof?", answer_goal: "Explain the expected decline-then-accept exchange." },
      { question: "When is taarof used?", answer_goal: "List common settings where taarof appears." },
    ],
    facts_to_verify: ["Regional variations in taarof etiquette"],
    entities_to_include: ["Persian hospitality", "Iran"],
    sources_to_reference: ["cultural etiquette references"],
    competitor_pages_to_beat: ["mei.edu/taarof", "tappersia.com/taarof"],
    schema_recommendation: "FAQPage",
    internal_links: ["link to a Persian-etiquette overview page"],
    evidenceRefs: [{ source: "profound", detail: "AI cites mei.edu and tappersia for this prompt; you are absent" }],
    confidence: "medium",
    risks: ["keep claims neutral and verifiable"],
    operatorSteps: ["Add the direct answer near the top of the page", "Add an FAQ block for the fan-out questions"],
  };

  it("drafts a schema-valid AEO brief from a PromptOpportunity-shaped input", async () => {
    const res = await draftAeoPromptBrief(
      {
        prompt: "What is taarof in Persian culture and how does it actually work?",
        fanoutQueries: ["how to refuse taarof politely", "taarof etiquette examples"],
        competitorPages: ["mei.edu/taarof", "tappersia.com/taarof"],
        ownCitedUrls: [],
        recommendedMove: "answer_block",
        tags: ["society-daily-life"],
      },
      { complete: fakeComplete([{ text: JSON.stringify(validBrief) }]) },
    );
    expect(res.status).toBe("drafted");
    if (res.status === "drafted") {
      expect(res.kind).toBe("aeo_prompt_brief");
      expect(res.value.fanout_sections.length).toBeGreaterThanOrEqual(1);
      expect(res.value.schema_recommendation).toBe("FAQPage");
      expect(res.value.competitor_pages_to_beat).toContain("mei.edu/taarof");
    }
  });

  it("fails closed when the model returns invalid JSON twice", async () => {
    const res = await draftAeoPromptBrief(
      { prompt: "q", fanoutQueries: [], competitorPages: [], ownCitedUrls: [], recommendedMove: "answer_block" },
      { complete: fakeComplete([{ text: "not json" }]) },
    );
    expect(res.status).toBe("validation_failed");
  });
});

// ── W5 P0-1: generation-time source verification ─────────────────────────────
describe("W5 P0-1 - generation-time source verification", () => {
  const withSource = (claim: string): string =>
    JSON.stringify({
      ...validAnswer,
      sources: [
        {
          url: "https://www.britannica.com/topic/persian-wedding",
          title: "Persian wedding",
          domain: "britannica.com",
          retrievedAt: "2026",
          claim,
          authority: "unverified",
        },
      ],
    });

  it("marks a source verified when the fetched page carries the claim's tokens", async () => {
    const sourceFetch = vi.fn(async () => ({
      ok: true,
      text: "A Persian wedding centers on the sofreh aghd ceremonial spread laid before the couple with a mirror and fresh herbs.",
    }));
    const r = await callStructuredLLM({
      kind: "answer_block",
      system: "s",
      user: "u",
      grounded: GROUNDED,
      complete: fakeComplete([{ text: withSource("a Persian wedding centers on the sofreh aghd ceremonial spread") }]),
      sourceFetch,
      now: new Date("2026-07-09T12:00:00.000Z"),
    });
    expect(r.status).toBe("drafted");
    if (r.status === "drafted") {
      const s = (r.value as { sources: Array<{ verified?: boolean; verifiedAt?: string; authority: string }> }).sources[0]!;
      expect(s.verified).toBe(true);
      expect(s.verifiedAt).toBe("2026-07-09T12:00:00.000Z");
      expect(s.authority).toBe("authoritative");
    }
    expect(sourceFetch).toHaveBeenCalledTimes(1);
  });

  it("downgrades to weak + verified:false when the URL is unreachable (hallucinated / 404)", async () => {
    const sourceFetch = vi.fn(async () => ({ ok: false, text: "" }));
    const r = await callStructuredLLM({
      kind: "answer_block",
      system: "s",
      user: "u",
      grounded: GROUNDED,
      complete: fakeComplete([{ text: withSource("a Persian wedding centers on the sofreh aghd ceremonial spread") }]),
      sourceFetch,
    });
    expect(r.status).toBe("drafted");
    if (r.status === "drafted") {
      const s = (r.value as { sources: Array<{ verified?: boolean; authority: string }> }).sources[0]!;
      expect(s.verified).toBe(false);
      expect(s.authority).toBe("weak");
    }
  });

  it("downgrades to weak + verified:false when the fetched page does NOT carry the claim (content mismatch)", async () => {
    const sourceFetch = vi.fn(async () => ({
      ok: true,
      text: "This page is about unrelated kitchen appliance reviews and shipping policies only.",
    }));
    const r = await callStructuredLLM({
      kind: "answer_block",
      system: "s",
      user: "u",
      grounded: GROUNDED,
      complete: fakeComplete([{ text: withSource("a Persian wedding centers on the sofreh aghd ceremonial spread") }]),
      sourceFetch,
    });
    expect(r.status).toBe("drafted");
    if (r.status === "drafted") {
      const s = (r.value as { sources: Array<{ verified?: boolean; authority: string }> }).sources[0]!;
      expect(s.verified).toBe(false);
      expect(s.authority).toBe("weak");
    }
  });

  it("never fetches when a draft carries no sources (no network on the common path)", async () => {
    const sourceFetch = vi.fn(async () => ({ ok: true, text: "unused" }));
    const r = await callStructuredLLM({
      kind: "answer_block",
      system: "s",
      user: "u",
      grounded: GROUNDED,
      complete: fakeComplete([{ text: JSON.stringify(validAnswer) }]),
      sourceFetch,
    });
    expect(r.status).toBe("drafted");
    expect(sourceFetch).not.toHaveBeenCalled();
  });

  it("is hermetic under vitest: no sourceFetch injected means no network and verified stays false", async () => {
    // No sourceFetch injected -> resolveSourceFetch returns null under vitest,
    // so the step is skipped and the schema default (verified=false) stands.
    const r = await callStructuredLLM({
      kind: "answer_block",
      system: "s",
      user: "u",
      grounded: GROUNDED,
      complete: fakeComplete([{ text: withSource("a Persian wedding centers on the sofreh aghd ceremonial spread") }]),
    });
    expect(r.status).toBe("drafted");
    if (r.status === "drafted") {
      const s = (r.value as { sources: Array<{ verified?: boolean }> }).sources[0]!;
      expect(s.verified).toBe(false);
    }
  });

  // ── W5 stop-ship F2: span-level support + final-host authority ──────────────
  it("persists the supporting excerpt + content hash on a verified source", async () => {
    const sourceFetch = vi.fn(async () => ({
      ok: true,
      text: "A Persian wedding centers on the sofreh aghd ceremonial spread laid before the couple with a mirror and fresh herbs.",
    }));
    const r = await callStructuredLLM({
      kind: "answer_block",
      system: "s",
      user: "u",
      grounded: GROUNDED,
      complete: fakeComplete([{ text: withSource("a Persian wedding centers on the sofreh aghd ceremonial spread") }]),
      sourceFetch,
      now: new Date("2026-07-09T12:00:00.000Z"),
    });
    expect(r.status).toBe("drafted");
    if (r.status === "drafted") {
      const s = (r.value as {
        sources: Array<{ verified?: boolean; supportingExcerpt?: string; contentHash?: string }>;
      }).sources[0]!;
      expect(s.verified).toBe(true);
      expect(s.supportingExcerpt).toContain("sofreh aghd");
      expect(s.contentHash).toMatch(/^[0-9a-f]{16}$/);
    }
  });

  it("resets an LLM-supplied verified:true BEFORE fetching (an unreachable source stays unverified)", async () => {
    // The model lies: it claims the source is already verified. The fetch fails.
    // (No verifiedAt on the proposal - a stray out-of-grounding date would trip
    // the numeric firewall; the security-relevant reset is the boolean itself.)
    const lyingDraft = JSON.stringify({
      ...validAnswer,
      sources: [
        {
          url: "https://www.britannica.com/topic/persian-wedding",
          title: "Persian wedding",
          domain: "britannica.com",
          retrievedAt: "2026",
          claim: "a Persian wedding centers on the sofreh aghd ceremonial spread",
          authority: "authoritative",
          verified: true,
        },
      ],
    });
    const sourceFetch = vi.fn(async () => ({ ok: false, text: "" }));
    const r = await callStructuredLLM({
      kind: "answer_block",
      system: "s",
      user: "u",
      grounded: GROUNDED,
      complete: fakeComplete([{ text: lyingDraft }]),
      sourceFetch,
    });
    expect(r.status).toBe("drafted");
    if (r.status === "drafted") {
      const s = (r.value as {
        sources: Array<{ verified?: boolean; verifiedAt?: string; authority: string }>;
      }).sources[0]!;
      expect(s.verified).toBe(false); // the model's true was wiped before the fetch
      expect(s.verifiedAt).toBeUndefined();
      expect(s.authority).toBe("weak");
    }
  });

  it("recomputes authority from the FINAL host: a redirect to an untrusted host is weak + unverified even if the text matches", async () => {
    const sourceFetch = vi.fn(async () => ({
      ok: true,
      finalUrl: "https://random-blog.example/reposted",
      text: "A Persian wedding centers on the sofreh aghd ceremonial spread laid before the couple.",
    }));
    const r = await callStructuredLLM({
      kind: "answer_block",
      system: "s",
      user: "u",
      grounded: GROUNDED,
      complete: fakeComplete([{ text: withSource("a Persian wedding centers on the sofreh aghd ceremonial spread") }]),
      sourceFetch,
    });
    expect(r.status).toBe("drafted");
    if (r.status === "drafted") {
      const s = (r.value as { sources: Array<{ verified?: boolean; authority: string }> }).sources[0]!;
      expect(s.verified).toBe(false);
      expect(s.authority).toBe("weak");
    }
  });

  it("recomputes authority from the FINAL host: a redirect to an authoritative host verifies + rewrites url/domain", async () => {
    // The model proposed a weak blog URL; the fetch redirected to britannica.
    const proposed = JSON.stringify({
      ...validAnswer,
      sources: [
        {
          url: "https://random-blog.example/x",
          title: "x",
          domain: "random-blog.example",
          retrievedAt: "2026",
          claim: "a Persian wedding centers on the sofreh aghd ceremonial spread",
          authority: "unverified",
        },
      ],
    });
    const sourceFetch = vi.fn(async () => ({
      ok: true,
      finalUrl: "https://www.britannica.com/topic/persian-wedding",
      text: "A Persian wedding centers on the sofreh aghd ceremonial spread laid before the couple.",
    }));
    const r = await callStructuredLLM({
      kind: "answer_block",
      system: "s",
      user: "u",
      grounded: GROUNDED,
      complete: fakeComplete([{ text: proposed }]),
      sourceFetch,
      now: new Date("2026-07-09T12:00:00.000Z"),
    });
    expect(r.status).toBe("drafted");
    if (r.status === "drafted") {
      const s = (r.value as {
        sources: Array<{ verified?: boolean; authority: string; finalUrl?: string; domain: string; url: string }>;
      }).sources[0]!;
      expect(s.verified).toBe(true);
      expect(s.authority).toBe("authoritative");
      expect(s.finalUrl).toBe("https://www.britannica.com/topic/persian-wedding");
      expect(s.domain).toBe("britannica.com");
      expect(s.url).toBe("https://www.britannica.com/topic/persian-wedding");
    }
  });
});

// ── FIX 2 (pilot re-run): roundup full-text coverage wired into verification ──
describe("G6 - verifyStampedSources threads full page text into coverage", () => {
  // A roundup answer (>=80 words, no numbers) of one-entity sentences a single
  // list page carries, but whose model-written META-claim will NOT span-match.
  const ROUNDUP_ANSWER =
    "The Northgate Museum holds a permanent collection of regional artifacts. " +
    "The Riverside Gallery opened downtown near the central plaza. " +
    "The Old Mill served the valley farmers for generations. " +
    "The Harbor Lighthouse guided passing ships into the bay. " +
    "The Grand Theatre staged classical operas each winter season. " +
    "The Central Library preserved rare manuscripts from the surrounding region. " +
    "The Stone Bridge crossed the river beside the old market square. " +
    "The Clock Tower marked the hours for the town below. " +
    "The Garden Pavilion hosted concerts through the warm summer evenings.";
  const LIST_PAGE_TEXT =
    "The Northgate Museum holds a permanent collection of regional artifacts and paintings. " +
    "The Riverside Gallery opened downtown near the central plaza many years ago. " +
    "The Old Mill served the valley farmers for generations before it closed. " +
    "The Harbor Lighthouse guided passing ships into the bay each night. " +
    "The Grand Theatre staged classical operas each winter season for decades. " +
    "The Central Library preserved rare manuscripts from the surrounding region carefully. " +
    "The Stone Bridge crossed the river beside the old market square downtown. " +
    "The Clock Tower marked the hours for the town below faithfully. " +
    "The Garden Pavilion hosted concerts through the warm summer evenings.";

  const roundupDraft = (metaClaim: string): string =>
    JSON.stringify({
      ...validAnswer,
      answer: ROUNDUP_ANSWER,
      sources: [
        {
          url: "https://en.wikipedia.org/wiki/List_of_old_city_landmarks",
          title: "List of old city landmarks",
          domain: "wikipedia.org",
          retrievedAt: "2026-07-11",
          claim: metaClaim,
          authority: "unverified",
        },
      ],
    });

  it("verifies an allowlisted list page via FULL TEXT even when its meta-claim does not span-match, and covers the whole roundup", async () => {
    const sourceFetch = vi.fn(async () => ({ ok: true, text: LIST_PAGE_TEXT }));
    const r = await callStructuredLLM({
      kind: "answer_block",
      system: "s",
      user: "u",
      grounded: GROUNDED,
      complete: fakeComplete([{ text: roundupDraft("A curated overview summarizing the cultural institutions of the old city.") }]),
      sourceFetch,
      authoritativeSourceDomains: ["wikipedia.org"],
      now: new Date("2026-07-10T12:00:00.000Z"),
    });
    expect(r.status).toBe("drafted");
    if (r.status === "drafted") {
      const s = (r.value as { sources: Array<{ verified?: boolean; authority: string; fetchedText?: string; supportingExcerpt?: string }> }).sources[0]!;
      // The meta-claim did not span-match, but the page's full text entails the draft.
      expect(s.verified).toBe(true);
      expect(s.authority).toBe("authoritative");
      // The full fetched text is threaded (transient) so per-claim coverage works.
      expect(s.fetchedText).toBe(LIST_PAGE_TEXT);
      expect(s.supportingExcerpt).toBeTruthy();
      // The threaded full text lets ONE page cover every roundup sentence.
      const cov = draftFactsCoveredBySources(ROUNDUP_ANSWER, (r.value as { sources: Array<{ verified?: boolean }> }).sources, ["wikipedia.org"]);
      expect(cov.covered).toBe(true);
    }
    expect(sourceFetch).toHaveBeenCalledTimes(1); // one fetch, respects the cap
  });

  it("does NOT verify when the fetched page entails nothing (content-mismatch stays weak)", async () => {
    const sourceFetch = vi.fn(async () => ({ ok: true, text: "This page is about unrelated kitchen appliance reviews and shipping policies only." }));
    const r = await callStructuredLLM({
      kind: "answer_block",
      system: "s",
      user: "u",
      grounded: GROUNDED,
      complete: fakeComplete([{ text: roundupDraft("A curated overview of the old city landmarks.") }]),
      sourceFetch,
      authoritativeSourceDomains: ["wikipedia.org"],
    });
    expect(r.status).toBe("drafted");
    if (r.status === "drafted") {
      const s = (r.value as { sources: Array<{ verified?: boolean; authority: string; fetchedText?: string }> }).sources[0]!;
      expect(s.verified).toBe(false);
      expect(s.authority).toBe("weak");
      expect(s.fetchedText).toBeUndefined();
    }
  });
});

// ── trust-230 P2: whole-draft verify deadline + bounded concurrency ──────────
describe("P2 - whole-draft source-verification deadline + bounded concurrency", () => {
  const CLAIM = "a Persian wedding centers on the sofreh aghd ceremonial spread";
  const MATCHING_TEXT =
    "A Persian wedding centers on the sofreh aghd ceremonial spread laid before the couple with a mirror and fresh herbs.";

  const withSources = (entries: Array<{ url: string; claim?: string }>): string =>
    JSON.stringify({
      ...validAnswer,
      sources: entries.map((e, idx) => ({
        url: e.url,
        title: `source ${idx}`,
        domain: new URL(e.url).hostname,
        retrievedAt: "2026",
        claim: e.claim ?? CLAIM,
        authority: "unverified",
      })),
    });

  /** Repeatedly yields to the microtask queue until `predicate()` is true, or
   *  throws after `maxTicks` (a real bug, never real time - no setTimeout). */
  async function waitUntil(predicate: () => boolean, maxTicks = 10_000): Promise<void> {
    for (let i = 0; i < maxTicks; i += 1) {
      if (predicate()) return;
      await Promise.resolve();
    }
    throw new Error("waitUntil: condition never became true");
  }

  it("stops verifying once the whole-draft deadline is spent, leaving the un-started source weak/unverified (fake clock)", async () => {
    vi.useFakeTimers();
    const draft = withSources([
      { url: "https://www.britannica.com/slow-a" },
      { url: "https://www.britannica.com/slow-b" },
    ]);
    const sourceFetch = vi.fn(async (url: string) => {
      if (url.includes("slow-a")) {
        // Synchronously blow the WHOLE 20s draft-verify budget while "fetching"
        // - no real waiting, just advancing the fake clock (vitest fake timers
        // also fake Date.now()).
        vi.advanceTimersByTime(21_000);
      }
      return { ok: true, text: MATCHING_TEXT };
    });
    const r = await callStructuredLLM({
      kind: "answer_block",
      system: "s",
      user: "u",
      grounded: GROUNDED,
      complete: fakeComplete([{ text: draft }]),
      sourceFetch,
    });
    expect(r.status).toBe("drafted");
    if (r.status === "drafted") {
      const sources = (r.value as { sources: Array<{ verified?: boolean; authority: string }> }).sources;
      expect(sources[0]!.verified).toBe(true); // started before the budget was spent
      expect(sources[1]!.verified).toBe(false); // never got a turn - FAIL CLOSED
      expect(sources[1]!.authority).toBe("weak");
    }
    // the second source was never even handed to the fetcher.
    expect(sourceFetch).toHaveBeenCalledTimes(1);
  });

  it("never lets a source verify:true once the deadline has passed, across a 3-source draft", async () => {
    vi.useFakeTimers();
    const draft = withSources([
      { url: "https://www.britannica.com/slow-1" },
      { url: "https://www.britannica.com/slow-2" },
      { url: "https://www.britannica.com/slow-3" },
    ]);
    const sourceFetch = vi.fn(async (url: string) => {
      vi.advanceTimersByTime(11_000); // two of these together exceed the 20s budget
      return { ok: true, text: MATCHING_TEXT };
    });
    const r = await callStructuredLLM({
      kind: "answer_block",
      system: "s",
      user: "u",
      grounded: GROUNDED,
      complete: fakeComplete([{ text: draft }]),
      sourceFetch,
    });
    expect(r.status).toBe("drafted");
    if (r.status === "drafted") {
      const sources = (r.value as { sources: Array<{ verified?: boolean; authority: string }> }).sources;
      const verifiedCount = sources.filter((s) => s.verified === true).length;
      // exactly the sources that started before the budget ran out verified;
      // NONE of them are verified past the point the deadline was spent.
      expect(verifiedCount).toBeLessThan(3);
      for (const s of sources) {
        if (s.verified !== true) expect(s.authority).toBe("weak");
      }
    }
  });

  it("never runs more than 2 source fetches concurrently, even with 3 eligible sources", async () => {
    const draft = withSources([
      { url: "https://www.britannica.com/c1" },
      { url: "https://www.britannica.com/c2" },
      { url: "https://www.britannica.com/c3" },
    ]);
    let active = 0;
    let maxActive = 0;
    const releasers: Array<() => void> = [];
    const sourceFetch = vi.fn(() => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      return new Promise<{ ok: boolean; text: string }>((resolve) => {
        releasers.push(() => {
          active -= 1;
          resolve({ ok: true, text: MATCHING_TEXT });
        });
      });
    });
    const resultPromise = callStructuredLLM({
      kind: "answer_block",
      system: "s",
      user: "u",
      grounded: GROUNDED,
      complete: fakeComplete([{ text: draft }]),
      sourceFetch,
    });

    await waitUntil(() => sourceFetch.mock.calls.length >= 2);
    expect(active).toBeLessThanOrEqual(2);
    expect(sourceFetch).toHaveBeenCalledTimes(2); // the 3rd has not started - pool is full

    releasers[0]!(); // free a slot - the 3rd source should now be able to start
    await waitUntil(() => sourceFetch.mock.calls.length >= 3);
    expect(active).toBeLessThanOrEqual(2);

    releasers[1]!();
    releasers[2]!();
    const r = await resultPromise;

    expect(r.status).toBe("drafted");
    expect(sourceFetch).toHaveBeenCalledTimes(3);
    expect(maxActive).toBeLessThanOrEqual(2); // the invariant, checked across the WHOLE run
  });

  it("preserves the per-URL cache dedupe: two sources citing the identical URL fetch it only once", async () => {
    const draft = withSources([
      { url: "https://www.britannica.com/shared", claim: CLAIM },
      { url: "https://www.britannica.com/shared", claim: CLAIM },
    ]);
    const sourceFetch = vi.fn(async () => ({ ok: true, text: MATCHING_TEXT }));
    const r = await callStructuredLLM({
      kind: "answer_block",
      system: "s",
      user: "u",
      grounded: GROUNDED,
      complete: fakeComplete([{ text: draft }]),
      sourceFetch,
    });
    expect(r.status).toBe("drafted");
    if (r.status === "drafted") {
      const sources = (r.value as { sources: Array<{ verified?: boolean }> }).sources;
      expect(sources[0]!.verified).toBe(true);
      expect(sources[1]!.verified).toBe(true);
    }
    expect(sourceFetch).toHaveBeenCalledTimes(1); // deduped even though 2 pool workers raced on it
  });
});

// ── W5 P2: answer-block word-count retry ─────────────────────────────────────
describe("W5 P2 - answer-block word-count retry (never caches a too-thin answer)", () => {
  const THIN =
    "Persian hospitality traditionally revolves around continuously offering guests freshly brewed tea throughout their entire visit, alongside assorted confectioneries, fragrant pastries, and seasonal fruit arranged beautifully across decorative serving platters. Conversation, storytelling, and unhurried companionship characterize these gatherings, reflecting deeply rooted cultural expectations surrounding generosity, warmth, respect, and reciprocal kindness shown between welcoming hosts and their appreciative visitors.";

  it("retries once with a length instruction when the first answer is under 80 words, then ships the full answer", async () => {
    const systems: string[] = [];
    let i = 0;
    const complete: CompleteFn = async ({ system }) => {
      systems.push(system);
      return { text: [JSON.stringify({ ...validAnswer, answer: THIN }), JSON.stringify(validAnswer)][i++]! };
    };
    const r = await callStructuredLLM({
      kind: "answer_block",
      system: "s",
      user: "u",
      grounded: GROUNDED,
      complete,
      recentOutputs: [],
    });
    expect(r.status).toBe("drafted");
    if (r.status === "drafted") {
      expect(r.retried).toBe(true);
      expect((r.value as { answer: string }).answer).toBe(validAnswer.answer);
    }
    expect(systems[1]).toContain("80 to 150 words");
  });

  it("pilot loop 4: the too-thin retry ALSO forbids introducing a new superlative while lengthening", async () => {
    const systems: string[] = [];
    let i = 0;
    const complete: CompleteFn = async ({ system }) => {
      systems.push(system);
      return { text: [JSON.stringify({ ...validAnswer, answer: THIN }), JSON.stringify(validAnswer)][i++]! };
    };
    await callStructuredLLM({ kind: "answer_block", system: "s", user: "u", grounded: GROUNDED, complete, recentOutputs: [] });
    expect(systems[1]).toMatch(/do NOT introduce a new superlative/i);
  });

  it("ships the thin answer as-is when the retry is still short (never fails closed; the gate holds it)", async () => {
    const r = await callStructuredLLM({
      kind: "answer_block",
      system: "s",
      user: "u",
      grounded: GROUNDED,
      complete: fakeComplete([{ text: JSON.stringify({ ...validAnswer, answer: THIN }) }]),
      recentOutputs: [],
    });
    expect(r.status).toBe("drafted");
    if (r.status === "drafted") {
      expect(r.retried).toBe(true);
      expect((r.value as { answer: string }).answer).toBe(THIN);
    }
  });
});

// ── G5 (2026-07-10): honest unfetchable-source state (403/robots block) ──────
describe("G5 - fetchBlocked (403/robots) vs dns/timeout distinction", () => {
  const withBritannica = (claim: string): string =>
    JSON.stringify({
      ...validAnswer,
      sources: [
        {
          url: "https://www.britannica.com/topic/persian-wedding",
          title: "Persian wedding",
          domain: "britannica.com",
          retrievedAt: "2026",
          claim,
          authority: "unverified",
        },
      ],
    });
  const withBlog = (claim: string): string =>
    JSON.stringify({
      ...validAnswer,
      sources: [
        { url: "https://some-blog.example/x", title: "Blog", domain: "some-blog.example", retrievedAt: "2026", claim, authority: "unverified" },
      ],
    });

  it("a 403 block on an authority-strong domain -> authoritative + verified:false + fetchBlocked:true", async () => {
    const sourceFetch = vi.fn(async () => ({ ok: false, text: "", blocked: true }));
    const r = await callStructuredLLM({
      kind: "answer_block",
      system: "s",
      user: "u",
      grounded: GROUNDED,
      complete: fakeComplete([{ text: withBritannica("a Persian wedding centers on the sofreh aghd ceremonial spread") }]),
      sourceFetch,
    });
    expect(r.status).toBe("drafted");
    if (r.status === "drafted") {
      const s = (r.value as { sources: Array<{ verified?: boolean; authority: string; fetchBlocked?: boolean }> }).sources[0]!;
      expect(s.authority).toBe("authoritative");
      expect(s.verified).toBe(false);
      expect(s.fetchBlocked).toBe(true);
    }
  });

  it("a dns/timeout/broken fetch (NOT blocked) stays weak with NO fetchBlocked", async () => {
    const sourceFetch = vi.fn(async () => ({ ok: false, text: "" })); // no `blocked` flag
    const r = await callStructuredLLM({
      kind: "answer_block",
      system: "s",
      user: "u",
      grounded: GROUNDED,
      complete: fakeComplete([{ text: withBritannica("a Persian wedding centers on the sofreh aghd ceremonial spread") }]),
      sourceFetch,
    });
    expect(r.status).toBe("drafted");
    if (r.status === "drafted") {
      const s = (r.value as { sources: Array<{ verified?: boolean; authority: string; fetchBlocked?: boolean }> }).sources[0]!;
      expect(s.authority).toBe("weak");
      expect(s.verified).toBe(false);
      expect(s.fetchBlocked).toBeUndefined();
    }
  });

  it("a 403 block on a NON-authoritative domain stays weak (a block is not a trust grant)", async () => {
    const sourceFetch = vi.fn(async () => ({ ok: false, text: "", blocked: true }));
    const r = await callStructuredLLM({
      kind: "answer_block",
      system: "s",
      user: "u",
      grounded: GROUNDED,
      complete: fakeComplete([{ text: withBlog("a Persian wedding centers on the sofreh aghd ceremonial spread") }]),
      sourceFetch,
    });
    expect(r.status).toBe("drafted");
    if (r.status === "drafted") {
      const s = (r.value as { sources: Array<{ authority: string; fetchBlocked?: boolean }> }).sources[0]!;
      expect(s.authority).toBe("weak");
      expect(s.fetchBlocked).toBeUndefined();
    }
  });
});

// ── G4 (2026-07-10): grounded superlatives + rephrase retry ──────────────────
describe("G4 - superlative grounding, rephrase retry, fail-closed", () => {
  const SUPERLATIVE_ANSWER = "Googoosh is the most famous Iranian pop singer. " + validAnswer.answer;
  const GROUNDED_ANSWER = validAnswer.answer; // no superlative

  const withSource = (answer: string, claim: string): string =>
    JSON.stringify({
      ...validAnswer,
      answer,
      sources: [
        { url: "https://www.britannica.com/biography/googoosh", title: "Googoosh", domain: "britannica.com", retrievedAt: "2026", claim, authority: "unverified" },
      ],
    });

  it("a superlative ASSERTED by a verified source drafts on the FIRST attempt (superlative-intent topic stays answerable)", async () => {
    const sourceFetch = vi.fn(async () => ({
      ok: true,
      text: "Googoosh is widely regarded as the most famous Iranian pop singer of her generation.",
    }));
    const r = await callStructuredLLM({
      kind: "answer_block",
      system: "s",
      user: "u",
      grounded: GROUNDED + " googoosh most famous iranian pop singer",
      complete: fakeComplete([{ text: withSource(SUPERLATIVE_ANSWER, "Googoosh is the most famous Iranian pop singer") }]),
      sourceFetch,
    });
    expect(r.status).toBe("drafted");
    if (r.status === "drafted") expect(r.retried).toBe(false);
  });

  it("an UNGROUNDED superlative triggers ONE rephrase retry; the rephrased (non-superlative) answer drafts", async () => {
    // The source verifies a NON-superlative fact, so it cannot ground "most famous".
    const sourceFetch = vi.fn(async () => ({
      ok: true,
      text: "Persian weddings center on the sofreh aghd ceremonial spread laid before the couple.",
    }));
    const r = await callStructuredLLM({
      kind: "answer_block",
      system: "s",
      user: "u",
      grounded: GROUNDED,
      complete: fakeComplete([
        { text: withSource(SUPERLATIVE_ANSWER, "Persian weddings center on the sofreh aghd ceremonial spread") },
        { text: withSource(GROUNDED_ANSWER, "Persian weddings center on the sofreh aghd ceremonial spread") },
      ]),
      sourceFetch,
    });
    expect(r.status).toBe("drafted");
    if (r.status === "drafted") {
      expect(r.retried).toBe(true);
      expect((r.value as { answer: string }).answer).toBe(GROUNDED_ANSWER);
    }
  });

  it("an ungrounded superlative on BOTH attempts fails closed (never ships an unprovable superlative)", async () => {
    const sourceFetch = vi.fn(async () => ({
      ok: true,
      text: "Persian weddings center on the sofreh aghd ceremonial spread laid before the couple.",
    }));
    const r = await callStructuredLLM({
      kind: "answer_block",
      system: "s",
      user: "u",
      grounded: GROUNDED,
      complete: fakeComplete([{ text: withSource(SUPERLATIVE_ANSWER, "Persian weddings center on the sofreh aghd ceremonial spread") }]),
      sourceFetch,
    });
    expect(r.status).toBe("validation_failed");
    if (r.status === "validation_failed") {
      expect(r.errors.some((e) => e.startsWith("superlative_ungrounded"))).toBe(true);
    }
  });

  it("a marketing superlative on a NON-answer kind is still a hard firewall reject (unchanged)", async () => {
    const atomic = {
      field: "title",
      before: "Persian Wedding Traditions",
      after: "The best Persian wedding guide",
      rationale: "clearer",
      evidenceRefs: [{ source: "gsc", detail: "the page earns impressions" }],
      confidence: "high",
      risks: [],
      operatorSteps: ["Update the title"],
      proofPlan: { metrics: ["ctr"], windowsDays: [7, 14, 28], controls: "unchanged siblings" },
    };
    const r = await callStructuredLLM({
      kind: "atomic_edit",
      system: "s",
      user: "u",
      grounded: "persian wedding traditions",
      complete: fakeComplete([{ text: JSON.stringify(atomic) }]),
    });
    expect(r.status).toBe("validation_failed");
    if (r.status === "validation_failed") expect(r.errors.some((e) => e === "firewall:superlative")).toBe(true);
  });
});

describe("pilot loop 4 - entity-reference source guidance (the roundup gap)", () => {
  it("appends the entity-own-reference-page instruction for an entity-rich roundup (3+ named entities)", async () => {
    let capturedSystem = "";
    await draftAnswerBlockStructured(
      {
        query: "famous iranian singers",
        pageLabel: "Famous Iranian Singers",
        brief: null,
        outline: ["Googoosh", "Vigen", "Mohammad-Reza Shajarian", "Shahram Nazeri"],
        faqs: [],
      },
      { complete: async ({ system }) => { capturedSystem = system; return { text: JSON.stringify(validAnswer) }; } },
    );
    expect(capturedSystem).toContain("ENTITY'S OWN");
    expect(capturedSystem).toContain("never a bare list or index page");
  });

  it("omits the entity-reference instruction for a single-fact topic (0-2 named entities)", async () => {
    let capturedSystem = "";
    await draftAnswerBlockStructured(
      {
        query: "national animal of Iran",
        pageLabel: "Iran Animals",
        brief: "The Asiatic Cheetah is Iran's national animal",
        outline: [],
        faqs: [],
      },
      { complete: async ({ system }) => { capturedSystem = system; return { text: JSON.stringify(validAnswer) }; } },
    );
    expect(capturedSystem).not.toContain("ENTITY'S OWN");
    expect(capturedSystem).not.toContain("never a bare list or index page");
  });
});

describe("pilot loop 5 - one-fact-per-sentence guidance (the compound-sentence coverage gap)", () => {
  it("appends the one-fact-per-sentence instruction for an entity-rich roundup (3+ named entities)", async () => {
    let capturedSystem = "";
    await draftAnswerBlockStructured(
      {
        query: "famous iranian singers",
        pageLabel: "Famous Iranian Singers",
        brief: null,
        outline: ["Googoosh", "Vigen", "Mohammad-Reza Shajarian", "Shahram Nazeri"],
        faqs: [],
      },
      { complete: async ({ system }) => { capturedSystem = system; return { text: JSON.stringify(validAnswer) }; } },
    );
    expect(capturedSystem).toMatch(/own short sentence/i);
    expect(capturedSystem).toMatch(/never bundle two different facts/i);
    expect(capturedSystem).toMatch(/add MORE single-fact sentences/i);
  });

  it("omits the one-fact-per-sentence instruction for a single-fact topic (0-2 named entities)", async () => {
    let capturedSystem = "";
    await draftAnswerBlockStructured(
      {
        query: "national animal of Iran",
        pageLabel: "Iran Animals",
        brief: "The Asiatic Cheetah is Iran's national animal",
        outline: [],
        faqs: [],
      },
      { complete: async ({ system }) => { capturedSystem = system; return { text: JSON.stringify(validAnswer) }; } },
    );
    expect(capturedSystem).not.toMatch(/own short sentence/i);
    expect(capturedSystem).not.toMatch(/never bundle two different facts/i);
  });
});

describe("pilot loop 4 - 'sources you may cite' evidence hint (cheap, deterministic, no new fetches)", () => {
  it("renders no hint line when no reference candidates are given (back-compat)", async () => {
    let capturedUser = "";
    await draftAnswerBlockStructured(
      { query: "persian wedding traditions", pageLabel: "Persian Wedding", brief: null, outline: [], faqs: [] },
      { complete: async ({ user }) => { capturedUser = user; return { text: JSON.stringify(validAnswer) }; } },
    );
    expect(capturedUser).not.toContain("Sources you may cite");
  });

  it("renders the hint with the candidate URL once a genuine entity-page candidate is given", async () => {
    let capturedUser = "";
    await draftAnswerBlockStructured(
      {
        query: "famous iranian singers",
        pageLabel: "Famous Iranian Singers",
        brief: null,
        outline: [],
        faqs: [],
        referenceCandidates: ["https://en.wikipedia.org/wiki/Googoosh"],
      },
      { complete: async ({ user }) => { capturedUser = user; return { text: JSON.stringify(validAnswer) }; } },
    );
    expect(capturedUser).toContain("Sources you may cite");
    expect(capturedUser).toContain("https://en.wikipedia.org/wiki/Googoosh");
  });

  it("filters a bare list/index URL out of the hint (the exact proven gap: List_of_Iranian_singers)", async () => {
    let capturedUser = "";
    await draftAnswerBlockStructured(
      {
        query: "famous iranian singers",
        pageLabel: "Famous Iranian Singers",
        brief: null,
        outline: [],
        faqs: [],
        referenceCandidates: ["https://en.wikipedia.org/wiki/List_of_Iranian_singers"],
      },
      { complete: async ({ user }) => { capturedUser = user; return { text: JSON.stringify(validAnswer) }; } },
    );
    expect(capturedUser).not.toContain("Sources you may cite");
    expect(capturedUser).not.toContain("List_of_Iranian_singers");
  });

  it("dedupes and caps the reference candidates at 5", async () => {
    let capturedUser = "";
    const many = Array.from({ length: 8 }, (_, i) => `https://example.com/artist-${i}`);
    await draftAnswerBlockStructured(
      {
        query: "famous iranian singers",
        pageLabel: "Famous Iranian Singers",
        brief: null,
        outline: [],
        faqs: [],
        referenceCandidates: [...many, many[0]!], // a repeat of the first URL
      },
      { complete: async ({ user }) => { capturedUser = user; return { text: JSON.stringify(validAnswer) }; } },
    );
    const line = capturedUser.split("\n").find((l) => l.startsWith("Sources you may cite"))!;
    expect(many.filter((u) => line.includes(u)).length).toBe(5);
  });

  it("omits the allowlist-preference line when no tenant allowlist is supplied", async () => {
    let capturedUser = "";
    await draftAnswerBlockStructured(
      { query: "persian wedding traditions", pageLabel: "Persian Wedding", brief: null, outline: [], faqs: [] },
      { complete: async ({ user }) => { capturedUser = user; return { text: JSON.stringify(validAnswer) }; } },
    );
    expect(capturedUser).not.toContain("allowlisted authoritative domains");
  });

  it("two-tenant: tenant A's allowlisted domains never leak into tenant B's prompt", async () => {
    let capturedUserA = "";
    let capturedUserB = "";
    await draftAnswerBlockStructured(
      { query: "famous iranian singers", pageLabel: "Singers", brief: null, outline: [], faqs: [] },
      {
        complete: async ({ user }) => { capturedUserA = user; return { text: JSON.stringify(validAnswer) }; },
        authoritativeSourceDomains: ["wikipedia.org", "britannica.com"],
      },
    );
    await draftAnswerBlockStructured(
      { query: "ritz builders team", pageLabel: "Builders", brief: null, outline: [], faqs: [] },
      {
        complete: async ({ user }) => { capturedUserB = user; return { text: JSON.stringify(validAnswer) }; },
        authoritativeSourceDomains: ["ritzbuilders.com"],
      },
    );
    expect(capturedUserA).toContain("wikipedia.org, britannica.com");
    expect(capturedUserB).toContain("ritzbuilders.com");
    expect(capturedUserA).not.toContain("ritzbuilders.com");
    expect(capturedUserB).not.toContain("wikipedia.org");
  });
});

describe("pilot loop 4 - superlative rephrase retry never introduces a NEW superlative", () => {
  const withSource = (answer: string): string =>
    JSON.stringify({
      ...validAnswer,
      answer,
      sources: [
        {
          url: "https://www.britannica.com/biography/googoosh",
          title: "Googoosh",
          domain: "britannica.com",
          retrievedAt: "2026",
          claim: "Persian weddings center on the sofreh aghd ceremonial spread",
          authority: "unverified",
        },
      ],
    });

  it("the retry system prompt explicitly forbids swapping in a NEW superlative", async () => {
    const sourceFetch = vi.fn(async () => ({
      ok: true,
      text: "Persian weddings center on the sofreh aghd ceremonial spread laid before the couple.",
    }));
    const systems: string[] = [];
    const complete: CompleteFn = async ({ system }) => {
      systems.push(system);
      return { text: withSource("Googoosh is the most famous Iranian pop singer. " + validAnswer.answer) };
    };
    await callStructuredLLM({ kind: "answer_block", system: "s", user: "u", grounded: GROUNDED, complete, sourceFetch });
    expect(systems).toHaveLength(2);
    expect(systems[1]).toContain("Do NOT swap it for a");
    expect(systems[1]).toMatch(/no new superlative/i);
    expect(systems[1]).toMatch(/concrete grounded fact is always the better answer/i);
  });

  it("swapping to a DIFFERENT ungrounded superlative on retry still fails closed (no loophole)", async () => {
    const sourceFetch = vi.fn(async () => ({
      ok: true,
      text: "Persian weddings center on the sofreh aghd ceremonial spread laid before the couple.",
    }));
    const r = await callStructuredLLM({
      kind: "answer_block",
      system: "s",
      user: "u",
      grounded: GROUNDED,
      complete: fakeComplete([
        { text: withSource("Googoosh is the most famous Iranian pop singer. " + validAnswer.answer) },
        { text: withSource("Googoosh is the leading Iranian pop singer. " + validAnswer.answer) },
      ]),
      sourceFetch,
    });
    expect(r.status).toBe("validation_failed");
    if (r.status === "validation_failed") {
      expect(r.errors.some((e) => e.startsWith("superlative_ungrounded"))).toBe(true);
    }
  });
});

describe("pilot loop 5 - merged too-thin + superlative retry instruction (one retry slot, two problems)", () => {
  // >=450 chars (clears the schema's own min-length floor) but well under 80
  // words (fails the word-count floor) AND carries an ungrounded superlative -
  // both problems must fire on the SAME attempt.
  const SHORT_SUPERLATIVE =
    "Googoosh is widely regarded as the most extraordinarily celebrated and internationally acclaimed Iranian pop vocalist of her entire generation, continuously captivating audiences across decades with her distinctively recognizable voice, enduringly popular recorded repertoire, and unmistakably influential contributions to contemporary Persian popular music culture throughout the broader worldwide Iranian diaspora community across multiple continents.";
  const withSource = (answer: string): string =>
    JSON.stringify({
      ...validAnswer,
      answer,
      sources: [
        {
          url: "https://www.britannica.com/biography/googoosh",
          title: "Googoosh",
          domain: "britannica.com",
          retrievedAt: "2026",
          claim: "Persian weddings center on the sofreh aghd ceremonial spread",
          authority: "unverified",
        },
      ],
    });
  const nonSuperlativeSourceFetch = () =>
    vi.fn(async () => ({
      ok: true,
      text: "Persian weddings center on the sofreh aghd ceremonial spread laid before the couple.",
    }));

  it("attempt 1 failing BOTH too-thin and ungrounded-superlative produces ONE combined retry naming both problems", async () => {
    const sourceFetch = nonSuperlativeSourceFetch();
    const systems: string[] = [];
    const complete: CompleteFn = async ({ system }) => {
      systems.push(system);
      return { text: withSource(SHORT_SUPERLATIVE) };
    };
    await callStructuredLLM({ kind: "answer_block", system: "s", user: "u", grounded: GROUNDED, complete, sourceFetch });
    expect(systems).toHaveLength(2);
    expect(systems[1]).toMatch(/TWO problems/i);
    expect(systems[1]).toMatch(/too short/i);
    expect(systems[1]).toContain("80 to 150 words");
    expect(systems[1]).toMatch(/superlative/i);
    expect(systems[1]).toMatch(/single-fact sentences/i);
    expect(systems[1]).toMatch(/introduce NO new superlative/i);
  });

  it("attempt 2 fixing both problems ships the combined-retry answer", async () => {
    const sourceFetch = nonSuperlativeSourceFetch();
    const r = await callStructuredLLM({
      kind: "answer_block",
      system: "s",
      user: "u",
      grounded: GROUNDED,
      complete: fakeComplete([{ text: withSource(SHORT_SUPERLATIVE) }, { text: withSource(validAnswer.answer) }]),
      sourceFetch,
    });
    expect(r.status).toBe("drafted");
    if (r.status === "drafted") {
      expect(r.retried).toBe(true);
      expect((r.value as { answer: string }).answer).toBe(validAnswer.answer);
    }
  });

  it("attempt 2 still failing (both problems persist) -> validation_failed with both errors listed", async () => {
    const sourceFetch = nonSuperlativeSourceFetch();
    const r = await callStructuredLLM({
      kind: "answer_block",
      system: "s",
      user: "u",
      grounded: GROUNDED,
      complete: fakeComplete([{ text: withSource(SHORT_SUPERLATIVE) }]), // repeats: still thin + still ungrounded
      sourceFetch,
    });
    expect(r.status).toBe("validation_failed");
    if (r.status === "validation_failed") {
      expect(r.errors.some((e) => e === "too_thin_answer")).toBe(true);
      expect(r.errors.some((e) => e.startsWith("superlative_ungrounded"))).toBe(true);
    }
  });

  it("single-error retry (too-thin only, no superlative) stays byte-identical to the pre-existing instruction", async () => {
    const THIN =
      "Persian hospitality traditionally revolves around continuously offering guests freshly brewed tea throughout their entire visit, alongside assorted confectioneries, fragrant pastries, and seasonal fruit arranged beautifully across decorative serving platters. Conversation, storytelling, and unhurried companionship characterize these gatherings, reflecting deeply rooted cultural expectations surrounding generosity, warmth, respect, and reciprocal kindness shown between welcoming hosts and their appreciative visitors.";
    const systems: string[] = [];
    const complete: CompleteFn = async ({ system }) => {
      systems.push(system);
      return { text: JSON.stringify({ ...validAnswer, answer: THIN }) };
    };
    await callStructuredLLM({ kind: "answer_block", system: "s", user: "u", grounded: GROUNDED, complete, recentOutputs: [] });
    expect(systems[1]).not.toMatch(/TWO problems/i);
    expect(systems[1]).toBe(
      // Pilot loop 6 (2026-07-11): closes with the no-new-numbers reminder,
      // shared by every rephrase-class retry instruction.
      `s\n\nYour previous answer was too short. Write a complete answer of 80 to 150 words, grounded ONLY in the evidence provided. Add the missing length with MORE grounded facts (names, dates, honors, works) - do NOT introduce a new superlative or ranking claim while lengthening it. Do not introduce any number, percentage, or statistic that is not present in the evidence; if unsure, write the sentence without a number.`,
    );
  });

  it("single-error retry (superlative only, not thin) stays byte-identical to the pre-existing instruction", async () => {
    const sourceFetch = nonSuperlativeSourceFetch();
    const systems: string[] = [];
    const complete: CompleteFn = async ({ system }) => {
      systems.push(system);
      return { text: withSource("Googoosh is the most famous Iranian pop singer. " + validAnswer.answer) };
    };
    await callStructuredLLM({ kind: "answer_block", system: "s", user: "u", grounded: GROUNDED, complete, sourceFetch });
    // Matches the pre-existing G4 pin exactly (structured-drafter.test.ts "pilot loop 4 -
    // superlative rephrase retry never introduces a NEW superlative" describe block) - this
    // asserts the plain single-error branch is unaffected by the new combined branch.
    expect(systems[1]).not.toMatch(/TWO problems/i);
    expect(systems[1]).not.toMatch(/too short/i);
    expect(systems[1]).toContain("Do NOT swap it for a");
    expect(systems[1]).toMatch(/no new superlative/i);
    expect(systems[1]).toMatch(/concrete grounded fact is always the better answer/i);
  });
});

describe("pilot loop 6 - no-new-numbers reminder on every rephrase-class retry", () => {
  const NO_NEW_NUMBERS_TEXT =
    "Do not introduce any number, percentage, or statistic that is not present in the evidence; if unsure, write the sentence without a number.";
  const nonSuperlativeSourceFetch = () =>
    vi.fn(async () => ({
      ok: true,
      text: "Persian weddings center on the sofreh aghd ceremonial spread laid before the couple.",
    }));
  const withSource = (answer: string): string =>
    JSON.stringify({
      ...validAnswer,
      answer,
      sources: [
        {
          url: "https://www.britannica.com/biography/googoosh",
          title: "Googoosh",
          domain: "britannica.com",
          retrievedAt: "2026",
          claim: "Persian weddings center on the sofreh aghd ceremonial spread",
          authority: "unverified",
        },
      ],
    });

  it("the too-thin-only retry closes with the no-new-numbers reminder", async () => {
    const THIN =
      "Persian hospitality traditionally revolves around continuously offering guests freshly brewed tea throughout their entire visit, alongside assorted confectioneries, fragrant pastries, and seasonal fruit arranged beautifully across decorative serving platters. Conversation, storytelling, and unhurried companionship characterize these gatherings, reflecting deeply rooted cultural expectations surrounding generosity, warmth, respect, and reciprocal kindness shown between welcoming hosts and their appreciative visitors.";
    const systems: string[] = [];
    const complete: CompleteFn = async ({ system }) => {
      systems.push(system);
      return { text: JSON.stringify({ ...validAnswer, answer: THIN }) };
    };
    await callStructuredLLM({ kind: "answer_block", system: "s", user: "u", grounded: GROUNDED, complete, recentOutputs: [] });
    expect(systems[1]).toContain(NO_NEW_NUMBERS_TEXT);
  });

  it("the superlative-only retry closes with the no-new-numbers reminder", async () => {
    const sourceFetch = nonSuperlativeSourceFetch();
    const systems: string[] = [];
    const complete: CompleteFn = async ({ system }) => {
      systems.push(system);
      return { text: withSource("Googoosh is the most famous Iranian pop singer. " + validAnswer.answer) };
    };
    await callStructuredLLM({ kind: "answer_block", system: "s", user: "u", grounded: GROUNDED, complete, sourceFetch });
    expect(systems[1]).toContain(NO_NEW_NUMBERS_TEXT);
  });

  it("the combined too-thin + superlative retry closes with the no-new-numbers reminder", async () => {
    const SHORT_SUPERLATIVE =
      "Googoosh is widely regarded as the most extraordinarily celebrated and internationally acclaimed Iranian pop vocalist of her entire generation, continuously captivating audiences across decades with her distinctively recognizable voice, enduringly popular recorded repertoire, and unmistakably influential contributions to contemporary Persian popular music culture throughout the broader worldwide Iranian diaspora community across multiple continents.";
    const sourceFetch = nonSuperlativeSourceFetch();
    const systems: string[] = [];
    const complete: CompleteFn = async ({ system }) => {
      systems.push(system);
      return { text: withSource(SHORT_SUPERLATIVE) };
    };
    await callStructuredLLM({ kind: "answer_block", system: "s", user: "u", grounded: GROUNDED, complete, sourceFetch });
    expect(systems[1]).toMatch(/TWO problems/i);
    expect(systems[1]).toContain(NO_NEW_NUMBERS_TEXT);
  });
});
