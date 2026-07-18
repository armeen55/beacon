/**
 * Expert-rec-engine PHASE F (2026-06-16) — LLM expert strategist pass.
 *
 * Pins the directive's NON-NEGOTIABLE safety invariants:
 *   • the DETERMINISTIC gate decides confidence/approve; the LLM CANNOT
 *     override a reject (intent-fit mismatch or upstream safety reject),
 *   • the LLM cannot be shown as high/medium confidence when core evidence
 *     is missing,
 *   • the firewall rejects vendor names, invented numbers, and AI-citation
 *     claims made without answer-engine evidence,
 *   • JSON parse failure / missing fields fail CLOSED (→ null),
 *   • flag OFF / budget blocked / missing key → null, no network call.
 *
 * checkBudget/recordSpend are mocked at the import boundary; fetchImpl is
 * ALWAYS injected (the module refuses a real network call under Vitest).
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";

const mockState = vi.hoisted(() => ({
  budgetResult: { allowed: true, remaining: 5 } as
    | { allowed: true; remaining: number }
    | { allowed: false; reason: string },
  checkBudgetSpy: undefined as undefined | Mock<() => void>,
}));

vi.mock("@/domains/recommendations/adjudicator-budget", () => {
  mockState.checkBudgetSpy = vi.fn(() => {});
  return {
    checkBudget: vi.fn(async () => {
      mockState.checkBudgetSpy!();
      return mockState.budgetResult;
    }),
    recordSpend: vi.fn(async (_cost: number) => {}),
  };
});

import {
  composeExpertStrategy,
  enforceExpertConfidence,
  sanitizeStrategistReasoning,
  parseStrategistJson,
  type StrategistReasoning,
} from "@/domains/recommendations/llm-expert-strategist";
import type { WhyThisMattersInput } from "@/domains/recommendations/why-this-matters-narrative";
import { scorePageTopicFit, type PageTopicFit } from "@/domains/recommendations/page-topic-fit";
import type { EvidenceLine } from "@/domains/recommendation-intelligence/evidence-summary";

const GSC_LINE: EvidenceLine = {
  key: "headline_query",
  value: "“persian rug cleaning cost”",
  label: "1,800 times shown · you rank #6",
  detail:
    "You rank #6 for “persian rug cleaning cost”, shown 1,800 times in 90 days — a sharper title could win more visits.",
};

function makeWhy(overrides: Partial<WhyThisMattersInput> = {}): WhyThisMattersInput {
  return {
    actionType: "edit_title",
    targetLabel: "Persian Rug Cleaning page",
    why: null,
    affectedPromptTexts: ["persian rug cleaning cost"],
    competitor: { name: "Rug Co", primaryPct: 0.42 },
    gscEvidenceLines: [GSC_LINE],
    clarityEvidenceLines: [],
    aeoEvidenceLines: [],
    promptCount: 3,
    observationCount: 12,
    derivedConfidence: "strong_evidence",
    ...overrides,
  };
}

// Cleanly informational query + page (no mixed markers) so the gate yields a
// true "high": topic coverage 100, intent class informational == informational.
const strongFit: PageTopicFit = scorePageTopicFit({
  page: {
    title: "Persian Rug Cleaning Guide",
    h1: "Persian Rug Cleaning Guide",
    urlPath: "/persian-rug-cleaning-guide",
  },
  query: "persian rug cleaning guide",
});

const VALID_REASONING: StrategistReasoning = {
  opportunitySummary:
    "This page already ranks near the top for a high-demand query but the title doesn't match how people search.",
  whyThisNow:
    "The page is in striking distance, so a sharper title is the fastest lever to capture demand that already exists.",
  bestAction: "Rewrite the title to lead with the exact phrase searchers use.",
  alternativesConsidered: ["Rewriting the body copy", "Building a new dedicated page"],
  whyNotAlternatives: [
    "The page already ranks, so new content is slower and riskier than a title tweak.",
    "A new page would split authority from a page that is already close.",
  ],
  expectedOutcome: "More clicks from searches the page already appears for.",
  riskLevel: "low",
  risks: ["A title change can briefly shift ranking while it is re-crawled."],
};

function jsonResponse(obj: unknown, usage = { prompt_tokens: 500, completion_tokens: 120 }) {
  return vi.fn(async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(obj) } }], usage }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  ) as unknown as typeof fetch;
}

function toJsonKeys(r: StrategistReasoning) {
  return {
    opportunity_summary: r.opportunitySummary,
    why_this_now: r.whyThisNow,
    best_action: r.bestAction,
    alternatives_considered: r.alternativesConsidered,
    why_not_alternatives: r.whyNotAlternatives,
    expected_outcome: r.expectedOutcome,
    risk_level: r.riskLevel,
    risks: r.risks,
  };
}

const ORIGINAL_FLAG = process.env.BEACON_LLM_STRATEGIST;
const ORIGINAL_CRITIC = process.env.BEACON_LLM_CRITIC;
const ORIGINAL_KEY = process.env.OPENAI_API_KEY;

beforeEach(() => {
  mockState.budgetResult = { allowed: true, remaining: 5 };
  mockState.checkBudgetSpy?.mockClear();
  process.env.OPENAI_API_KEY = "sk-test-key";
  // Strategist is ON BY DEFAULT (no flag). Critic is on-by-default in prod,
  // but disabled here by default so the strategist-verdict assertions aren't
  // perturbed by a second LLM pass; the critic-default test opts back in.
  delete process.env.BEACON_LLM_STRATEGIST;
  process.env.BEACON_LLM_CRITIC = "0";
});
afterEach(() => {
  if (ORIGINAL_FLAG === undefined) delete process.env.BEACON_LLM_STRATEGIST;
  else process.env.BEACON_LLM_STRATEGIST = ORIGINAL_FLAG;
  if (ORIGINAL_CRITIC === undefined) delete process.env.BEACON_LLM_CRITIC;
  else process.env.BEACON_LLM_CRITIC = ORIGINAL_CRITIC;
  if (ORIGINAL_KEY === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = ORIGINAL_KEY;
});

// ── DETERMINISTIC GATE (pure) ─────────────────────────────────────────
describe("enforceExpertConfidence — the LLM cannot override the gate", () => {
  it("upstream safety reject → rejected, not approved", () => {
    const v = enforceExpertConfidence({
      deterministicReject: true,
      shouldUseQueryForOptimization: true,
      hasCoreEvidence: true,
      topicMatchScore: 90,
      intentMatchScore: 90,
    });
    expect(v.enforcedConfidence).toBe("rejected");
    expect(v.enforcedApprove).toBe(false);
  });
  it("intent-fit mismatch → rejected even with strong evidence", () => {
    const v = enforceExpertConfidence({
      deterministicReject: false,
      shouldUseQueryForOptimization: false,
      hasCoreEvidence: true,
      topicMatchScore: 80,
      intentMatchScore: 20,
    });
    expect(v.enforcedConfidence).toBe("rejected");
    expect(v.enforcedApprove).toBe(false);
  });
  it("no core evidence → capped at needs_more_evidence", () => {
    const v = enforceExpertConfidence({
      deterministicReject: false,
      shouldUseQueryForOptimization: true,
      hasCoreEvidence: false,
      topicMatchScore: 90,
      intentMatchScore: 90,
    });
    expect(v.enforcedConfidence).toBe("needs_more_evidence");
    expect(v.enforcedApprove).toBe(false);
  });
  it("audit-3 #10: evidence present, fit NOT scored → needs_more_evidence + NOT approved", () => {
    // Pre-fix this fail-opened to medium + approve:true, making an unverified
    // rec auto-actionable AND live-pushable. With no scored intent-fit, Beacon
    // can't confirm the query belongs on the page, so it must surface for review
    // but never be one-tap published.
    const v = enforceExpertConfidence({
      deterministicReject: false,
      shouldUseQueryForOptimization: null,
      hasCoreEvidence: true,
      topicMatchScore: null,
      intentMatchScore: null,
    });
    expect(v.enforcedConfidence).toBe("needs_more_evidence");
    expect(v.enforcedApprove).toBe(false);
  });
  it("strong evidence + strong fit → high; moderate → medium; weak → low", () => {
    expect(
      enforceExpertConfidence({ deterministicReject: false, shouldUseQueryForOptimization: true, hasCoreEvidence: true, topicMatchScore: 80, intentMatchScore: 90 }).enforcedConfidence,
    ).toBe("high");
    expect(
      enforceExpertConfidence({ deterministicReject: false, shouldUseQueryForOptimization: true, hasCoreEvidence: true, topicMatchScore: 50, intentMatchScore: 60 }).enforcedConfidence,
    ).toBe("medium");
    expect(
      enforceExpertConfidence({ deterministicReject: false, shouldUseQueryForOptimization: true, hasCoreEvidence: true, topicMatchScore: 30, intentMatchScore: 30 }).enforcedConfidence,
    ).toBe("low");
  });
});

// ── FIREWALL (pure) ───────────────────────────────────────────────────
describe("sanitizeStrategistReasoning — honesty + white-label + AI-claims", () => {
  const ledger = JSON.stringify({ a: "1,800 times in 90 days", pct: "42%" });
  it("clean reasoning with no numbers passes", () => {
    expect(sanitizeStrategistReasoning(VALID_REASONING, ledger, { hasAeoEvidence: false }).ok).toBe(true);
  });
  it("rejects a vendor name in any field", () => {
    const r = { ...VALID_REASONING, expectedOutcome: "ChatGPT will start citing you." };
    expect(sanitizeStrategistReasoning(r, ledger, { hasAeoEvidence: true }).ok).toBe(false);
  });
  it("rejects an invented number not in the ledger", () => {
    const r = { ...VALID_REASONING, opportunitySummary: "You could win 9999 visits." };
    const res = sanitizeStrategistReasoning(r, ledger, { hasAeoEvidence: false });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain("invented_number");
  });
  it("rejects an AI-citation claim when there is NO answer-engine evidence", () => {
    const r = { ...VALID_REASONING, whyThisNow: "AI assistants currently cite a rival, not you." };
    const res = sanitizeStrategistReasoning(r, ledger, { hasAeoEvidence: false });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("ai_claim_without_ai_evidence");
  });
  it("rejects the same unsupported claim when its AI and citation terms are more than 48 characters apart", () => {
    const r = {
      ...VALID_REASONING,
      whyThisNow:
        "AI assistants evaluating the topic across detailed pages and several competing sources currently cite a rival, not you.",
    };
    const res = sanitizeStrategistReasoning(r, ledger, { hasAeoEvidence: false });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("ai_claim_without_ai_evidence");
  });
  it("still allows non-behavioural readability language without AEO evidence", () => {
    const r = {
      ...VALID_REASONING,
      whyThisNow: "Clear headings help AI assistants understand the page structure.",
    };
    expect(sanitizeStrategistReasoning(r, ledger, { hasAeoEvidence: false }).ok).toBe(true);
  });
  it("allows the same AI-citation claim when answer-engine evidence IS present", () => {
    const r = { ...VALID_REASONING, whyThisNow: "AI assistants currently cite a rival, not you." };
    expect(sanitizeStrategistReasoning(r, ledger, { hasAeoEvidence: true }).ok).toBe(true);
  });
  it("rejects a leaked internal field name (live ground-truth caught this)", () => {
    // gpt-5-mini echoed "shouldUseQueryForOptimization is true" into prose.
    const r = { ...VALID_REASONING, whyNotAlternatives: ["Not chosen because shouldUseQueryForOptimization is true."] };
    const res = sanitizeStrategistReasoning(r, ledger, { hasAeoEvidence: true });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("internal_identifier_leak");
  });
});

// ── JSON PARSE (pure, fail-closed) ────────────────────────────────────
describe("parseStrategistJson — fail-closed", () => {
  it("parses a valid object", () => {
    expect(parseStrategistJson(JSON.stringify(toJsonKeys(VALID_REASONING)))?.bestAction).toBeTruthy();
  });
  it("parses inside a ```json fence and prose", () => {
    const wrapped = "Here you go:\n```json\n" + JSON.stringify(toJsonKeys(VALID_REASONING)) + "\n```";
    expect(parseStrategistJson(wrapped)?.opportunitySummary).toBeTruthy();
  });
  it("malformed JSON → null", () => {
    expect(parseStrategistJson("{ not valid json ")).toBeNull();
  });
  it("missing a required field → null", () => {
    const partial = { ...toJsonKeys(VALID_REASONING), best_action: "" };
    expect(parseStrategistJson(JSON.stringify(partial))).toBeNull();
  });
});

// ── composeExpertStrategy (mocked fetch) ──────────────────────────────
describe("composeExpertStrategy — gates + end-to-end", () => {
  it("ON BY DEFAULT (no flag set) → runs", async () => {
    delete process.env.BEACON_LLM_STRATEGIST;
    const fetchImpl = jsonResponse(toJsonKeys(VALID_REASONING));
    const result = await composeExpertStrategy({ why: makeWhy(), topicFit: strongFit }, { fetchImpl });
    expect(result).not.toBeNull();
    expect(fetchImpl).toHaveBeenCalled();
  });

  it("kill-switch BEACON_LLM_STRATEGIST=0 → null, NEVER calls fetch or budget", async () => {
    process.env.BEACON_LLM_STRATEGIST = "0";
    const fetchImpl = jsonResponse(toJsonKeys(VALID_REASONING));
    const result = await composeExpertStrategy({ why: makeWhy(), topicFit: strongFit }, { fetchImpl });
    expect(result).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(mockState.checkBudgetSpy).not.toHaveBeenCalled();
  });

  it("budget blocked → null, no fetch", async () => {
    delete process.env.BEACON_LLM_STRATEGIST;
    mockState.budgetResult = { allowed: false, reason: "cap" };
    const fetchImpl = jsonResponse(toJsonKeys(VALID_REASONING));
    const result = await composeExpertStrategy({ why: makeWhy(), topicFit: strongFit }, { fetchImpl });
    expect(result).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("happy path → strategist reasoning + DETERMINISTIC verdict", async () => {
    delete process.env.BEACON_LLM_STRATEGIST;
    const fetchImpl = jsonResponse(toJsonKeys(VALID_REASONING));
    const result = await composeExpertStrategy({ why: makeWhy(), topicFit: strongFit }, { fetchImpl });
    expect(result).not.toBeNull();
    expect(result!.strategist.bestAction).toContain("title");
    // Strong evidence + strong fit → high, approved.
    expect(result!.enforcedConfidence).toBe("high");
    expect(result!.enforcedApprove).toBe(true);
  });

  it("LLM cannot override an intent-fit REJECT (the core invariant)", async () => {
    process.env.BEACON_LLM_STRATEGIST = "1";
    // A mismatched page: the query has ~0 topical overlap → shouldUse=false.
    const mismatchFit = scorePageTopicFit({
      page: { title: "Asiatic Cheetah Conservation", h1: "Saving the Cheetah", urlPath: "/wildlife/cheetah" },
      query: "persian rug cleaning cost",
    });
    expect(mismatchFit.shouldUseQueryForOptimization).toBe(false);
    // The LLM still returns glowing reasoning — it must NOT win.
    const fetchImpl = jsonResponse(toJsonKeys(VALID_REASONING));
    const result = await composeExpertStrategy(
      { why: makeWhy(), topicFit: mismatchFit },
      { fetchImpl },
    );
    expect(result).not.toBeNull();
    expect(result!.enforcedConfidence).toBe("rejected");
    expect(result!.enforcedApprove).toBe(false);
    expect(result!.gateNotes.join(" ")).toMatch(/intent-fit|wrong target/i);
  });

  it("invented number in the response → null (fail-closed firewall)", async () => {
    process.env.BEACON_LLM_STRATEGIST = "1";
    const bad = { ...toJsonKeys(VALID_REASONING), expected_outcome: "Win 9999 visits next week." };
    const fetchImpl = jsonResponse(bad);
    const result = await composeExpertStrategy({ why: makeWhy(), topicFit: strongFit }, { fetchImpl });
    expect(result).toBeNull();
  });

  it("malformed JSON response → null (fail-closed)", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: "not json at all" } }], usage: {} }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ) as unknown as typeof fetch;
    const result = await composeExpertStrategy({ why: makeWhy(), topicFit: strongFit }, { fetchImpl });
    expect(result).toBeNull();
  });

  it("critic runs BY DEFAULT (no flag) and clamps lower-only", async () => {
    delete process.env.BEACON_LLM_STRATEGIST;
    delete process.env.BEACON_LLM_CRITIC; // default → critic ON
    // 1st call → strategist JSON; 2nd call → critic JSON (lower to 'low').
    const criticJson = {
      critic_verdict: "lower_confidence",
      confidence_ceiling: "low",
      unsupported_claims: [],
      evidence_gaps: ["No on-page behaviour data."],
      query_page_mismatch_risks: [],
      copy_risks: [],
      publishing_risks: [],
      factual_risks: [],
      what_would_make_this_high_confidence: ["Connect Clarity."],
      human_review_note: "Confirm this is the strongest target page.",
    };
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      const content = call === 1 ? JSON.stringify(toJsonKeys(VALID_REASONING)) : JSON.stringify(criticJson);
      return new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 100, completion_tokens: 50 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;
    const result = await composeExpertStrategy({ why: makeWhy(), topicFit: strongFit }, { fetchImpl });
    expect(result).not.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(2); // strategist + critic
    expect(result!.criticReview?.criticVerdict).toBe("lower_confidence");
    // strongFit would be 'high' deterministically; the critic clamps it to 'low'.
    expect(result!.enforcedConfidence).toBe("low");
  });
});

// ── GQA-3: adversarial critic — LOWER-ONLY clamp (the safety invariant) ──
import {
  applyCriticToVerdict,
  parseCriticJson,
} from "@/domains/recommendations/llm-expert-strategist";
import type { ExpertVerdict, CriticReview } from "@/domains/recommendations/expert-verdict";

const detMedium: ExpertVerdict = {
  enforcedConfidence: "medium",
  enforcedApprove: true,
  gateNotes: ["Moderate evidence and intent fit."],
};
const detHigh: ExpertVerdict = {
  enforcedConfidence: "high",
  enforcedApprove: true,
  gateNotes: ["Strong evidence and intent fit."],
};
const detRejected: ExpertVerdict = {
  enforcedConfidence: "rejected",
  enforcedApprove: false,
  gateNotes: ["Intent mismatch."],
};
const critic = (over: Partial<CriticReview> = {}): CriticReview => ({
  criticVerdict: "approve",
  confidenceCeiling: "medium",
  unsupportedClaims: [],
  evidenceGaps: [],
  queryPageMismatchRisks: [],
  copyRisks: [],
  publishingRisks: [],
  factualRisks: [],
  whatWouldMakeThisHighConfidence: [],
  humanReviewNote: "Looks grounded.",
  ...over,
});

describe("applyCriticToVerdict — the critic can never override the deterministic gate", () => {
  it("a critic ceiling ABOVE deterministic CANNOT raise confidence", () => {
    const out = applyCriticToVerdict(detMedium, critic({ criticVerdict: "approve", confidenceCeiling: "high" }));
    expect(out.enforcedConfidence).toBe("medium"); // clamped, never raised
  });
  it("a critic can LOWER confidence via a lower ceiling", () => {
    const out = applyCriticToVerdict(detHigh, critic({ criticVerdict: "lower_confidence", confidenceCeiling: "low" }));
    expect(out.enforcedConfidence).toBe("low");
    expect(out.enforcedApprove).toBe(false);
  });
  it("a critic 'reject' rejects + un-approves", () => {
    const out = applyCriticToVerdict(detHigh, critic({ criticVerdict: "reject", confidenceCeiling: "rejected" }));
    expect(out.enforcedConfidence).toBe("rejected");
    expect(out.enforcedApprove).toBe(false);
  });
  it("a deterministic REJECT cannot be rescued by the critic", () => {
    const out = applyCriticToVerdict(detRejected, critic({ criticVerdict: "approve", confidenceCeiling: "high" }));
    expect(out.enforcedConfidence).toBe("rejected");
    expect(out.enforcedApprove).toBe(false);
  });
  it("a critic 'approve' at the same ceiling leaves confidence unchanged", () => {
    const out = applyCriticToVerdict(detMedium, critic({ criticVerdict: "approve", confidenceCeiling: "medium" }));
    expect(out.enforcedConfidence).toBe("medium");
    expect(out.enforcedApprove).toBe(true);
  });
});

describe("parseCriticJson — rich schema, fail-closed, output-sanitized", () => {
  it("parses the full critic object", () => {
    const r = parseCriticJson(
      JSON.stringify({
        critic_verdict: "lower_confidence",
        confidence_ceiling: "low",
        unsupported_claims: ["the page already ranks claim isn't backed by a number"],
        evidence_gaps: ["no on-page behaviour data"],
        query_page_mismatch_risks: [],
        copy_risks: [],
        publishing_risks: [],
        factual_risks: [],
        what_would_make_this_high_confidence: ["connect Microsoft Clarity"],
        human_review_note: "Solid but thin; confirm the page is the right target.",
      }),
    );
    expect(r?.criticVerdict).toBe("lower_confidence");
    expect(r?.confidenceCeiling).toBe("low");
    expect(r?.unsupportedClaims.length).toBe(1);
    expect(r?.whatWouldMakeThisHighConfidence[0]).toContain("Clarity");
  });
  it("filters a leaked internal identifier / invented number out of displayed bullets", () => {
    const r = parseCriticJson(
      JSON.stringify({
        critic_verdict: "approve",
        confidence_ceiling: "medium",
        unsupported_claims: [
          "shouldUseQueryForOptimization is false here", // internal identifier → dropped
          "claims 9999 visits with no basis", // invented number (not in ledger) → dropped
          "the comparison is fair", // clean → kept
        ],
        human_review_note: "ok",
      }),
      JSON.stringify({ a: "1,800 in 90 days" }), // ledger (no 9999)
    );
    expect(r?.unsupportedClaims).toEqual(["the comparison is fair"]);
  });
  it("malformed JSON → null (fail-closed)", () => {
    expect(parseCriticJson("not json")).toBeNull();
  });
  it("an unknown verdict defaults to 'approve' (the clamp still can't raise)", () => {
    const r = parseCriticJson(JSON.stringify({ critic_verdict: "explode", confidence_ceiling: "medium", human_review_note: "x" }));
    expect(r?.criticVerdict).toBe("approve");
  });
});
