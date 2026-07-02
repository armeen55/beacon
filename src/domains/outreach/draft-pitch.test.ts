import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const { checkBudgetMock, recordSpendMock } = vi.hoisted(() => ({
  checkBudgetMock: vi.fn(),
  recordSpendMock: vi.fn(),
}));
vi.mock("@/domains/recommendations/adjudicator-budget", () => ({
  checkBudget: checkBudgetMock,
  recordSpend: recordSpendMock,
}));

import { draftOutreachPitch, draftOutreachFollowup } from "./draft-pitch";
import type { CompleteFn } from "@/domains/llm/structured-drafter";
import type { OutreachLead } from "./types";

const LEAD: OutreachLead = {
  id: "outreach-abc123",
  targetDomain: "example.com",
  targetUrl: "https://example.com/persian-culture",
  leadSource: "profound_citation",
  evidence: "AI cited this page for \"Persian poetry\" in your space.",
};

const validPitch = {
  subject: "A citation to consider for your Persian poetry page",
  body:
    "Hello, I noticed AI assistants cite your page on Persian poetry. We publish a deeply researched page on the same topic that " +
    "could be a useful additional reference for your readers. Would you be open to taking a look and considering a link? Thanks for your time.",
  evidenceRefs: [{ source: "profound", detail: "AI cited example.com/persian-culture for Persian poetry" }],
  confidence: "medium",
  risks: ["may not respond"],
};

function fakeComplete(responses: Array<{ text: string } | { error: string }>): CompleteFn {
  let i = 0;
  return async () => responses[Math.min(i++, responses.length - 1)]!;
}

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

describe("draftOutreachPitch", () => {
  it("drafts a schema-valid pitch grounded in the lead's evidence", async () => {
    const r = await draftOutreachPitch(
      { lead: LEAD, ownName: "Iranopedia", ownDomain: "iranopedia.com", ownContext: "a Persian culture encyclopedia" },
      { complete: fakeComplete([{ text: JSON.stringify(validPitch) }]) },
    );
    expect(r.status).toBe("drafted");
    if (r.status === "drafted") {
      expect(r.value.subject.length).toBeLessThanOrEqual(80);
      expect(r.value.body.length).toBeLessThanOrEqual(900);
      expect(r.value.evidenceRefs.length).toBeGreaterThan(0);
    }
  });

  it("fails closed (never returns loose text) when the LLM is off", async () => {
    process.env.BEACON_LLM_PROVIDER = "deterministic";
    const r = await draftOutreachPitch(
      { lead: LEAD, ownName: "Iranopedia", ownDomain: "iranopedia.com", ownContext: "a Persian culture encyclopedia" },
      { complete: fakeComplete([{ text: JSON.stringify(validPitch) }]) },
    );
    expect(r.status).toBe("off");
  });

  it("fails closed when the budget is blocked (never calls the LLM)", async () => {
    checkBudgetMock.mockResolvedValue({ allowed: false, reason: "cap reached" });
    const complete = vi.fn(fakeComplete([{ text: JSON.stringify(validPitch) }]));
    const r = await draftOutreachPitch(
      { lead: LEAD, ownName: "Iranopedia", ownDomain: "iranopedia.com", ownContext: "a Persian culture encyclopedia" },
      { complete },
    );
    expect(r.status).toBe("blocked_budget");
    expect(complete).not.toHaveBeenCalled();
  });

  it("rejects a pitch with an invented number not in the grounding", async () => {
    const bad = { ...validPitch, body: validPitch.body + " We have 48213 monthly readers." };
    const r = await draftOutreachPitch(
      { lead: LEAD, ownName: "Iranopedia", ownDomain: "iranopedia.com", ownContext: "a Persian culture encyclopedia" },
      { complete: fakeComplete([{ text: JSON.stringify(bad) }, { text: JSON.stringify(bad) }]) },
    );
    expect(r.status).toBe("validation_failed");
  });

  it("rejects a pitch containing an em dash (dash guard)", async () => {
    const withDash = { ...validPitch, body: "We think this is worth a look — take a moment to review it." };
    const r = await draftOutreachPitch(
      { lead: LEAD, ownName: "Iranopedia", ownDomain: "iranopedia.com", ownContext: "a Persian culture encyclopedia" },
      { complete: fakeComplete([{ text: JSON.stringify(withDash) }]) },
    );
    // the drafter normalizes em/en dashes to hyphens before validating, so this
    // should NOT fail closed - it should succeed with dashes stripped.
    expect(r.status).toBe("drafted");
    if (r.status === "drafted") expect(r.value.body).not.toMatch(/[–—]/);
  });
});

describe("draftOutreachFollowup", () => {
  it("drafts a shorter follow-up referencing the original pitch", async () => {
    const r = await draftOutreachFollowup(
      {
        lead: LEAD,
        ownName: "Iranopedia",
        ownDomain: "iranopedia.com",
        ownContext: "a Persian culture encyclopedia",
        originalSubject: "A citation to consider",
        daysSinceSent: 9,
      },
      { complete: fakeComplete([{ text: JSON.stringify(validPitch) }]) },
    );
    expect(r.status).toBe("drafted");
  });
});
