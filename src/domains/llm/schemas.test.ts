import { describe, it, expect } from "vitest";
import {
  AnswerBlockDraftSchema,
  AtomicEditDraftSchema,
  CreatePageBriefSchema,
  ProofPlanSchema,
  ExperimentPlanSchema,
  StrategyReviewSchema,
  SectionDraftSchema,
  SourceRefSchema,
  SCHEMA_BY_KIND,
  draftProseStringValues,
  type StructuredDraftKind,
} from "./schemas";

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

  // W5 (2026-07-09, J-69/J-71)
  it("defaults sources to [] when omitted (pre-W5 persisted drafts stay valid)", () => {
    const r = AnswerBlockDraftSchema.safeParse(validAnswer);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.sources).toEqual([]);
  });

  it("accepts a valid sources array", () => {
    const withSources = {
      ...validAnswer,
      sources: [
        {
          url: "https://www.britannica.com/topic/Nowruz",
          title: "Nowruz",
          domain: "britannica.com",
          retrievedAt: "2026-07-01",
          claim: "Nowruz marks the Persian new year",
          authority: "unverified",
        },
      ],
    };
    expect(AnswerBlockDraftSchema.safeParse(withSources).success).toBe(true);
  });

  it("accepts an answer up to the widened 1200-char max (150 words needs ~1050)", () => {
    const longAnswer = "Persian weddings are steeped in tradition. ".repeat(24).trim().slice(0, 1190);
    const r = AnswerBlockDraftSchema.safeParse({ ...validAnswer, answer: longAnswer });
    expect(r.success).toBe(true);
  });

  it("rejects an answer over the widened 1200-char max", () => {
    const r = AnswerBlockDraftSchema.safeParse({ ...validAnswer, answer: "x".repeat(1201) });
    expect(r.success).toBe(false);
  });
});

describe("SourceRefSchema (W5, J-69)", () => {
  const validSource = {
    url: "https://www.britannica.com/topic/Nowruz",
    title: "Nowruz",
    domain: "britannica.com",
    retrievedAt: "2026-07-01",
    claim: "Nowruz marks the Persian new year",
    authority: "authoritative",
  };

  it("accepts a valid source", () => {
    expect(SourceRefSchema.safeParse(validSource).success).toBe(true);
  });

  it("rejects an unknown authority value", () => {
    expect(SourceRefSchema.safeParse({ ...validSource, authority: "verified" }).success).toBe(false);
  });

  it("rejects a source with no claim (a bare URL is not a source)", () => {
    const { claim: _c, ...rest } = validSource;
    expect(SourceRefSchema.safeParse(rest).success).toBe(false);
  });

  it("accepts every declared authority level", () => {
    for (const authority of ["authoritative", "weak", "unverified"]) {
      expect(SourceRefSchema.safeParse({ ...validSource, authority }).success).toBe(true);
    }
  });

  // W5 P0-1 (2026-07-09): verified/verifiedAt
  it("defaults verified to false when omitted (pre-P0-1 drafts stay honest)", () => {
    const r = SourceRefSchema.safeParse(validSource);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.verified).toBe(false);
  });

  it("accepts an explicit verified:true with a verifiedAt timestamp", () => {
    const r = SourceRefSchema.safeParse({ ...validSource, verified: true, verifiedAt: "2026-07-09T12:00:00.000Z" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.verified).toBe(true);
      expect(r.data.verifiedAt).toBe("2026-07-09T12:00:00.000Z");
    }
  });

  // W5 stop-ship F2 (2026-07-09): additive span-support fields
  it("accepts the additive supportingExcerpt / finalUrl / contentHash fields, all optional", () => {
    const bare = SourceRefSchema.safeParse(validSource);
    expect(bare.success).toBe(true);
    if (bare.success) {
      expect(bare.data.supportingExcerpt).toBeUndefined();
      expect(bare.data.finalUrl).toBeUndefined();
      expect(bare.data.contentHash).toBeUndefined();
    }
    const r = SourceRefSchema.safeParse({
      ...validSource,
      verified: true,
      supportingExcerpt: "Nowruz marks the Persian new year, celebrated on the spring equinox.",
      finalUrl: "https://www.britannica.com/topic/Nowruz",
      contentHash: "0123456789abcdef",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.supportingExcerpt).toContain("Nowruz");
      expect(r.data.finalUrl).toBe("https://www.britannica.com/topic/Nowruz");
      expect(r.data.contentHash).toBe("0123456789abcdef");
    }
  });
});

describe("AtomicEditDraftSchema sources (W5, J-69)", () => {
  const validEdit = {
    field: "title",
    before: "Persian New Year Traditions",
    after: "Persian New Year: 3000 Years of Nowruz Traditions in Iran",
    rationale: "Adds the specific timespan readers search for.",
    proofPlan: { metrics: ["clicks"], controls: "comparable unchanged pages" },
    evidenceRefs: [{ source: "gsc", detail: "impressions for this exact search" }],
    confidence: "medium",
    operatorSteps: ["Update the title field"],
  };

  it("defaults sources to [] when omitted", () => {
    const r = AtomicEditDraftSchema.safeParse(validEdit);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.sources).toEqual([]);
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

describe("draftProseStringValues", () => {
  it("flattens nested strings and ignores numbers", () => {
    const vals = draftProseStringValues({ a: "one", b: [{ c: "two" }, "three"], n: 14, deep: { d: "four" } });
    expect(vals.sort()).toEqual(["four", "one", "three", "two"]);
  });

  it("SKIPS the sources citation array so its metadata never reaches the firewall", () => {
    const vals = draftProseStringValues({
      answer: "prose the operator pastes",
      sources: [
        { url: "https://en.wikipedia.org/wiki/x", retrievedAt: "2026-07-11", claim: "a source claim", domain: "wikipedia.org" },
      ],
      evidenceRefs: [{ source: "gsc", detail: "kept: real grounding provenance" }],
    });
    expect(vals).toContain("prose the operator pastes");
    expect(vals).toContain("kept: real grounding provenance");
    expect(vals).not.toContain("2026-07-11");
    expect(vals).not.toContain("a source claim");
    expect(vals.join(" ")).not.toContain("wikipedia.org");
  });

  // Drafter batch 2 (2026-07-11): the generation-time firewall (structured-drafter.ts's
  // ONE runContentFirewalls call, fed by this same helper) must not scan the product's
  // own methodology/procedural fields - only what an operator would actually paste.
  it("SKIPS proofPlan/operatorSteps/risks (product-authored methodology, never operator-pasted prose)", () => {
    const vals = draftProseStringValues({
      answer: "prose the operator pastes",
      risks: ["internal caution note mentioning 42 percent"],
      operatorSteps: ["Update the price field to reflect 42"],
      proofPlan: {
        metrics: ["measure clicks for 28 days, target 100%"],
        windowsDays: [7, 14, 28],
        controls: "comparable unchanged pages",
      },
      evidenceRefs: [{ source: "gsc", detail: "kept: real grounding provenance" }],
    });
    expect(vals).toContain("prose the operator pastes");
    expect(vals).toContain("kept: real grounding provenance"); // unchanged: real grounding, still scanned
    expect(vals.join(" ")).not.toContain("42");
    expect(vals.join(" ")).not.toContain("target 100%");
    expect(vals.join(" ")).not.toContain("Update the price field");
  });

  // The exact pilot loop 6 killer: proofPlan.metrics carrying "target 100%" must
  // never reach the invented-numbers scan while the draft's real prose is intact.
  it("the exact loop-6 killer: proofPlan.metrics 'target 100%' never enters the scanned text", () => {
    const vals = draftProseStringValues({
      answer: "Persian weddings center on the sofreh aghd ceremony.",
      proofPlan: { metrics: ["Profound citations", "target 100%"], windowsDays: [7, 14, 28], controls: "comparable unchanged pages" },
    });
    expect(vals.join(" ")).not.toContain("100");
    expect(vals.join(" ")).not.toContain("target");
  });
});
