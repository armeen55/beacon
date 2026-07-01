import { describe, it, expect } from "vitest";
import {
  AnswerBlockDraftSchema,
  CreatePageBriefSchema,
  ProofPlanSchema,
  ExperimentPlanSchema,
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
  it("covers exactly the Sprint 2 draft kinds", () => {
    const kinds = Object.keys(SCHEMA_BY_KIND).sort();
    const expected: StructuredDraftKind[] = [
      "aeo_prompt_brief",
      "answer_block",
      "atomic_edit",
      "commerce_asset",
      "create_page_brief",
      "cro_fix",
      "experiment_plan",
      "internal_link",
      "tool_asset",
    ];
    expect(kinds).toEqual(expected.sort());
  });
});

describe("draftStringValues", () => {
  it("flattens nested strings and ignores numbers", () => {
    const vals = draftStringValues({ a: "one", b: [{ c: "two" }, "three"], n: 14, deep: { d: "four" } });
    expect(vals.sort()).toEqual(["four", "one", "three", "two"]);
  });
});
