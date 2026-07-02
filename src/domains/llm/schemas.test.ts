import { describe, it, expect } from "vitest";
import {
  AnswerBlockDraftSchema,
  CreatePageBriefSchema,
  ProofPlanSchema,
  ExperimentPlanSchema,
  StrategyReviewSchema,
  SectionDraftSchema,
  SCHEMA_BY_KIND,
  draftStringValues,
  type StructuredDraftKind,
} from "./schemas";

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

describe("AnswerBlockDraftSchema", () => {
  it("accepts a valid grounded draft", () => {
    expect(AnswerBlockDraftSchema.safeParse(validAnswer).success).toBe(true);
  });
  it("REJECTS a draft with no evidenceRefs (the trust floor)", () => {
    const r = AnswerBlockDraftSchema.safeParse({ ...validAnswer, evidenceRefs: [] });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.some((i) => i.path.join(".") === "evidenceRefs")).toBe(true);
  });
  it("rejects an answer that is too short", () => {
    expect(AnswerBlockDraftSchema.safeParse({ ...validAnswer, answer: "too short" }).success).toBe(false);
  });
  it("rejects an unknown evidence source", () => {
    expect(
      AnswerBlockDraftSchema.safeParse({ ...validAnswer, evidenceRefs: [{ source: "made_up", detail: "x" }] }).success,
    ).toBe(false);
  });
  it("defaults risks to [] and citationHook to null when omitted", () => {
    const { risks: _r, citationHook: _c, ...rest } = validAnswer;
    const r = AnswerBlockDraftSchema.safeParse(rest);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.risks).toEqual([]);
      expect(r.data.citationHook).toBeNull();
    }
  });
});

describe("ProofPlanSchema", () => {
  it("defaults windowsDays to 7/14/28", () => {
    const r = ProofPlanSchema.safeParse({ metrics: ["clicks"], controls: "comparable pages" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.windowsDays).toEqual([7, 14, 28]);
  });
  it("requires at least one metric", () => {
    expect(ProofPlanSchema.safeParse({ metrics: [], controls: "x" }).success).toBe(false);
  });
});

describe("CreatePageBriefSchema", () => {
  it("requires an outline of at least 3 sections", () => {
    const base = {
      proposedTitle: "Persian Wedding Traditions Explained",
      metaDescription: "A clear, factual guide to the ceremony, the sofreh aghd, and the celebration that follows.",
      openingAnswer: validAnswer.answer,
      outline: ["Intro", "Sofreh aghd"],
      proofPlan: validAnswer.proofPlan,
      evidenceRefs: validAnswer.evidenceRefs,
      confidence: "medium",
      operatorSteps: ["Draft the page"],
    };
    expect(CreatePageBriefSchema.safeParse(base).success).toBe(false);
    expect(CreatePageBriefSchema.safeParse({ ...base, outline: ["Intro", "Sofreh aghd", "Reception"] }).success).toBe(true);
  });
});

describe("SectionDraftSchema", () => {
  const validSection = {
    heading: "The sofreh aghd ceremony",
    body: "The sofreh aghd is a ceremonial spread laid out before the couple, carrying symbolic items such as bread, herbs, and a mirror. Family members hold a canopy over the couple during the vows while honored guests witness the exchange.",
    sources: [{ kind: "competitor_observation", detail: "the cited page leads with a sofreh aghd explainer" }],
    containsNumber: false,
  };

  it("accepts a valid grounded section", () => {
    expect(SectionDraftSchema.safeParse(validSection).success).toBe(true);
  });

  it("REJECTS a section with zero sources (every section must carry >= 1 source)", () => {
    const r = SectionDraftSchema.safeParse({ ...validSection, sources: [] });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.some((i) => i.path.join(".") === "sources")).toBe(true);
  });

  it("rejects a body over 1200 chars", () => {
    const r = SectionDraftSchema.safeParse({ ...validSection, body: "x".repeat(1201) });
    expect(r.success).toBe(false);
  });

  it("rejects an unknown source kind", () => {
    expect(
      SectionDraftSchema.safeParse({ ...validSection, sources: [{ kind: "made_up", detail: "x" }] }).success,
    ).toBe(false);
  });

  it("requires containsNumber to be a boolean (not omittable)", () => {
    const { containsNumber: _c, ...rest } = validSection;
    expect(SectionDraftSchema.safeParse(rest).success).toBe(false);
  });

  it("accepts every declared source kind", () => {
    for (const kind of ["own_data", "competitor_observation", "fanout_question", "keyword"]) {
      expect(SectionDraftSchema.safeParse({ ...validSection, sources: [{ kind, detail: "x" }] }).success).toBe(true);
    }
  });
});

describe("ExperimentPlanSchema", () => {
  it("rejects an invalid expectedDirection", () => {
    expect(
      ExperimentPlanSchema.safeParse({
        hypothesis: "Tighter title lifts CTR",
        primaryMetric: "gsc_ctr",
        expectedDirection: "sideways",
        controlDescription: "comparable pages",
        evidenceRefs: validAnswer.evidenceRefs,
        confidence: "medium",
        operatorSteps: ["Rewrite the title"],
      }).success,
    ).toBe(false);
  });
});

describe("SCHEMA_BY_KIND registry", () => {
  it("covers exactly the registered draft kinds", () => {
    const kinds = Object.keys(SCHEMA_BY_KIND).sort();
    const expected: StructuredDraftKind[] = [
      "aeo_prompt_brief",
      "answer_block",
      "ask_answer", // BEACON 500 item 59: the /ask chat's per-teammate grounded answer
      "atomic_edit",
      "batch_adjudication", // BEACON 500 item 12: the nightly final review's per-pick verdicts
      "commerce_asset",
      "create_page_brief",
      "cro_fix",
      "experiment_plan",
      "internal_link",
      "outreach_pitch", // BEACON 500 item 57: the get-cited/link-reclaim outreach pipeline's pitch draft
      "section_draft", // BEACON 500 item 55: one drafted section of the outline-to-draft pipeline
      "strategy_review", // BEACON 500 item 51: the weekly strategy review's lever mix + memo
      "team_verdict", // FINAL PREMIUM PLAN item 25: the strategist's grounded verdict per nightly pick
      "tool_asset",
    ];
    expect(kinds).toEqual(expected.sort());
  });
});

describe("StrategyReviewSchema (BEACON 500 item 51)", () => {
  const valid = {
    leverMix: [{ family: "answer", weight: 1.4, reason: "won 3 of 4 this week" }],
    focusFamilies: [{ family: "iran-flags", reason: "9x its detection floor" }],
    memo: "I am leaning into answer blocks this week because they won 3 of 4. I am easing off pure title changes, which went 0 of 3.",
    confidence: "medium",
  };

  it("accepts a valid proposal", () => {
    expect(StrategyReviewSchema.safeParse(valid).success).toBe(true);
  });

  it("requires at least one leverMix entry", () => {
    expect(StrategyReviewSchema.safeParse({ ...valid, leverMix: [] }).success).toBe(false);
  });

  it("defaults focusFamilies to [] when omitted", () => {
    const { focusFamilies: _omit, ...rest } = valid;
    const r = StrategyReviewSchema.safeParse(rest);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.focusFamilies).toEqual([]);
  });

  it("caps focusFamilies at 3", () => {
    const tooMany = { ...valid, focusFamilies: [0, 1, 2, 3].map((i) => ({ family: `f${i}`, reason: "x" })) };
    expect(StrategyReviewSchema.safeParse(tooMany).success).toBe(false);
  });

  it("rejects a memo longer than 900 chars", () => {
    expect(StrategyReviewSchema.safeParse({ ...valid, memo: "x".repeat(901) }).success).toBe(false);
  });

  it("rejects a lever reason longer than 140 chars", () => {
    const bad = { ...valid, leverMix: [{ family: "answer", weight: 1.2, reason: "x".repeat(141) }] };
    expect(StrategyReviewSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an invalid confidence value", () => {
    expect(StrategyReviewSchema.safeParse({ ...valid, confidence: "certain" }).success).toBe(false);
  });

  it("rejects a weight above the schema's own sanity ceiling (10)", () => {
    const bad = { ...valid, leverMix: [{ family: "answer", weight: 11, reason: "x" }] };
    expect(StrategyReviewSchema.safeParse(bad).success).toBe(false);
  });
});

describe("draftStringValues", () => {
  it("flattens nested strings and ignores numbers", () => {
    const vals = draftStringValues({ a: "one", b: [{ c: "two" }, "three"], n: 14, deep: { d: "four" } });
    expect(vals.sort()).toEqual(["four", "one", "three", "two"]);
  });
});
