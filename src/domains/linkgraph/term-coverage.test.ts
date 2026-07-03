import { describe, expect, it } from "vitest";

import {
  gradeCoverage,
  subtopicCovered,
  type CoveragePageExtract,
  type ExpectedSubtopic,
} from "./term-coverage";

const emptyPage: CoveragePageExtract = { headings: [], faqQuestions: [], bodyText: null };

describe("subtopicCovered", () => {
  it("covered when a heading owns the subtopic", () => {
    const page: CoveragePageExtract = { headings: ["Iran visa fees explained"], faqQuestions: [], bodyText: null };
    expect(subtopicCovered("visa fees", page)).toBe(true);
  });

  it("covered when the body mentions all the subtopic's tokens", () => {
    const page: CoveragePageExtract = {
      headings: [],
      faqQuestions: [],
      bodyText: "The processing time for the application is about two weeks.",
    };
    expect(subtopicCovered("processing time", page)).toBe(true);
  });

  it("NOT covered when the subtopic is absent", () => {
    const page: CoveragePageExtract = { headings: ["About us"], faqQuestions: [], bodyText: "Contact page." };
    expect(subtopicCovered("required documents", page)).toBe(false);
  });

  it("an all-generic subtopic can never be scored", () => {
    expect(subtopicCovered("best guide", { headings: ["best guide"], faqQuestions: [], bodyText: null })).toBe(false);
  });
});

describe("gradeCoverage", () => {
  const rubric: ExpectedSubtopic[] = [
    { label: "visa fees", source: "consensus", weight: 100 },
    { label: "processing time", source: "consensus", weight: 90 },
    { label: "required documents", source: "question", weight: 300 },
  ];

  it("scores coverage as covered/total and names the missing labels", () => {
    const page: CoveragePageExtract = {
      headings: ["Iran visa fees"],
      faqQuestions: [],
      bodyText: "Details about the visa fee amounts.",
    };
    const grade = gradeCoverage(rubric, page);
    expect(grade.expectedCount).toBe(3);
    expect(grade.coveredCount).toBe(1); // only visa fees
    expect(grade.coverage).toBeCloseTo(1 / 3, 5);
    // Missing named, demand-ranked (required documents weight 300 first).
    expect(grade.missingTopLabels[0]).toBe("required documents");
    expect(grade.missingTopLabels).toContain("processing time");
    expect(grade.missingTopLabels).not.toContain("visa fees");
  });

  it("caps named gaps at 3 but keeps all in missingAll", () => {
    const bigRubric: ExpectedSubtopic[] = [
      { label: "alpha topic", source: "question", weight: 50 },
      { label: "bravo topic", source: "question", weight: 40 },
      { label: "charlie topic", source: "question", weight: 30 },
      { label: "delta topic", source: "question", weight: 20 },
      { label: "echo topic", source: "question", weight: 10 },
    ];
    const grade = gradeCoverage(bigRubric, emptyPage);
    expect(grade.missingTopLabels).toHaveLength(3);
    expect(grade.missingAll).toHaveLength(5);
    // Highest weight first.
    expect(grade.missingTopLabels[0]).toBe("alpha topic");
  });

  it("EMPTY RUBRIC: no scorable subtopics yields coverage=null (never 0)", () => {
    expect(gradeCoverage([], emptyPage)).toEqual({
      coverage: null,
      expectedCount: 0,
      coveredCount: 0,
      missingTopLabels: [],
      missingAll: [],
    });
    // An all-generic rubric is also unscoreable -> null.
    const generic: ExpectedSubtopic[] = [{ label: "best guide", source: "consensus", weight: 1 }];
    expect(gradeCoverage(generic, emptyPage).coverage).toBeNull();
  });

  it("dedupes near-duplicate subtopics by distinguishing-token signature, keeping the higher weight", () => {
    const dupRubric: ExpectedSubtopic[] = [
      { label: "visa fees", source: "consensus", weight: 50 },
      { label: "the visa fee", source: "question", weight: 200 }, // same tokens (fee singularized)
      { label: "processing time", source: "consensus", weight: 90 },
    ];
    const grade = gradeCoverage(dupRubric, emptyPage);
    // 2 distinct subtopics after dedupe.
    expect(grade.expectedCount).toBe(2);
    // The collapsed "visa fee(s)" keeps the higher weight (200) -> named first.
    expect(grade.missingTopLabels[0]).toBe("the visa fee");
  });

  it("full coverage yields coverage=1 and no missing labels", () => {
    const page: CoveragePageExtract = {
      headings: ["Iran visa fees", "Processing time", "Required documents"],
      faqQuestions: [],
      bodyText: null,
    };
    const grade = gradeCoverage(rubric, page);
    expect(grade.coverage).toBe(1);
    expect(grade.missingTopLabels).toEqual([]);
  });

  it("is deterministic", () => {
    const a = JSON.stringify(gradeCoverage(rubric, emptyPage));
    const b = JSON.stringify(gradeCoverage(rubric, emptyPage));
    expect(a).toBe(b);
  });
});
