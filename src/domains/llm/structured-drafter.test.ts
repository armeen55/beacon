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
const { buildWinnerFewShotsMock } = vi.hoisted(() => ({
  buildWinnerFewShotsMock: vi.fn(async () => ""),
}));
vi.mock("./winner-memory", () => ({
  buildWinnerFewShots: buildWinnerFewShotsMock,
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

const GROUNDED = "persian wedding traditions sofreh aghd aghd jashn reception ceremony canopy";

const validAnswer = {
  answer:
    "Persian weddings center on the sofreh aghd, a ceremonial spread of symbolic items the couple sits before while honored guests hold a canopy above them, followed by the aghd vows and a celebratory jashn reception with family and friends.",
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
});
afterEach(() => {
  process.env.BEACON_LLM_PROVIDER = ORIGINAL_PROVIDER;
  vi.clearAllMocks();
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
