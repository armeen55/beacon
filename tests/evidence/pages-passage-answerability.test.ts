import { describe, it, expect } from "vitest";
import {
  splitIntoPassages,
  checkPassageRules,
  scorePassageForQuestion,
  scoreQuestionAgainstPassages,
  computePageAnswerabilityCoverage,
  COVERAGE_SCORE_THRESHOLD,
} from "@/domains/pages/passage-answerability";

describe("splitIntoPassages", () => {
  it("passes through an array of paragraphs, trimming and dropping blanks", () => {
    const out = splitIntoPassages(["  First paragraph.  ", "", "Second   paragraph.", "   "]);
    expect(out).toEqual(["First paragraph.", "Second paragraph."]);
  });

  it("splits raw text on blank lines when there are multiple paragraphs", () => {
    const out = splitIntoPassages("Para one.\n\nPara two.\n\nPara three.");
    expect(out).toEqual(["Para one.", "Para two.", "Para three."]);
  });

  it("falls back to single newlines when there is no blank-line separation", () => {
    const out = splitIntoPassages("Line one.\nLine two.\nLine three.");
    expect(out).toEqual(["Line one.", "Line two.", "Line three."]);
  });

  it("returns an empty array for empty/whitespace-only input", () => {
    expect(splitIntoPassages("")).toEqual([]);
    expect(splitIntoPassages("   \n  ")).toEqual([]);
    expect(splitIntoPassages([])).toEqual([]);
  });
});

describe("checkPassageRules", () => {
  const GOOD_PASSAGE =
    "The Persian New Year, Nowruz, began in 2026 on March 20 and is celebrated by over 300 million people across Iran, " +
    "Afghanistan, and Central Asia. Families set a Haft-Seen table with seven symbolic items and visit relatives during " +
    "the following thirteen days of celebration.";

  it("passes all four rules for a well-formed, on-topic, dated passage", () => {
    const checks = checkPassageRules(GOOD_PASSAGE, "When does Nowruz begin?");
    expect(checks.every((c) => c.passed)).toBe(true);
  });

  it("fails not_self_contained when the passage is far too short", () => {
    const checks = checkPassageRules("Nowruz is the Persian new year.", "What is Nowruz?");
    const rule = checks.find((c) => c.code === "not_self_contained")!;
    expect(rule.passed).toBe(false);
    expect(rule.fix).toContain("30 to 70 words");
  });

  it("fails not_self_contained when the passage runs far too long", () => {
    const longPassage = Array.from({ length: 90 }, (_, i) => `word${i}`).join(" ") + ".";
    const checks = checkPassageRules(longPassage, "test");
    const rule = checks.find((c) => c.code === "not_self_contained")!;
    expect(rule.passed).toBe(false);
    expect(rule.fix).toMatch(/Trim/);
  });

  it("fails pronoun_opener when the first sentence opens with 'It'", () => {
    const passage =
      "It is celebrated every year in March by millions of people across Iran and neighboring countries with food, " +
      "music, and family gatherings that last almost two weeks in total.";
    const checks = checkPassageRules(passage, "What is Nowruz?");
    const rule = checks.find((c) => c.code === "pronoun_opener")!;
    expect(rule.passed).toBe(false);
    expect(rule.fix).toContain("Name the subject");
  });

  it("passes pronoun_opener when the first sentence names the subject", () => {
    const passage =
      "Nowruz is celebrated every year in March by millions of people across Iran and neighboring countries with food, " +
      "music, and family gatherings that last almost two weeks in total.";
    const checks = checkPassageRules(passage, "What is Nowruz?");
    expect(checks.find((c) => c.code === "pronoun_opener")!.passed).toBe(true);
  });

  it("fails no_number_or_date when there is no digit or year anywhere", () => {
    const passage =
      "Nowruz is the Persian new year celebrated across Iran and neighboring countries with music, food, and family " +
      "gatherings that mark the arrival of spring every year for everyone who observes the holiday.";
    const checks = checkPassageRules(passage, "What is Nowruz?");
    expect(checks.find((c) => c.code === "no_number_or_date")!.passed).toBe(false);
  });

  it("fails off_question when the passage shares no content tokens with the question", () => {
    const passage =
      "The sofreh aghd spread includes a mirror, candelabras, sugar cones, and sweets arranged for the couple during " +
      "the ceremony, which dates back centuries in Persian wedding tradition across the region in 1500.";
    const checks = checkPassageRules(passage, "How many provinces does Iran have?");
    expect(checks.find((c) => c.code === "off_question")!.passed).toBe(false);
  });

  it("does not penalize off_question when the question has no scoreable tokens", () => {
    const checks = checkPassageRules(GOOD_PASSAGE, "how");
    expect(checks.find((c) => c.code === "off_question")!.passed).toBe(true);
  });
});

describe("scorePassageForQuestion", () => {
  it("scores 100 with no failures when every rule passes", () => {
    const passage =
      "Nowruz began in 2026 on March 20 and is celebrated by over 300 million people across Iran, Afghanistan, and " +
      "Central Asia with a Haft-Seen table and thirteen days of family visits.";
    const r = scorePassageForQuestion(passage, "When does Nowruz begin?");
    expect(r.score).toBe(100);
    expect(r.failures).toEqual([]);
  });

  it("loses exactly 25 points per failed rule", () => {
    const shortNoNumber = "It is a holiday people celebrate.";
    const r = scorePassageForQuestion(shortNoNumber, "What is Nowruz?");
    // fails: not_self_contained, pronoun_opener, no_number_or_date, off_question (no shared tokens) = 0
    expect(r.score).toBe(0);
    expect(r.failures.length).toBe(4);
  });
});

describe("scoreQuestionAgainstPassages", () => {
  it("returns score 0 and an honest message when there are no passages", () => {
    const r = scoreQuestionAgainstPassages([], "What is Nowruz?");
    expect(r.score).toBe(0);
    expect(r.bestPassage).toBeNull();
    expect(r.failures[0]).toMatch(/no content passages/);
  });

  it("picks the highest-scoring passage among several", () => {
    const weak = "It is a thing.";
    const strong =
      "Nowruz began in 2026 on March 20 and is celebrated by over 300 million people across Iran, Afghanistan, and " +
      "Central Asia with a Haft-Seen table and thirteen days of family visits.";
    const r = scoreQuestionAgainstPassages([weak, strong], "When does Nowruz begin?");
    expect(r.bestPassage).toBe(strong);
    expect(r.score).toBe(100);
  });
});

describe("computePageAnswerabilityCoverage", () => {
  const passages = [
    "Nowruz began in 2026 on March 20 and is celebrated by over 300 million people across Iran, Afghanistan, and " +
      "Central Asia with a Haft-Seen table and thirteen days of family visits.",
    "The sofreh aghd spread includes a mirror, candelabras, sugar cones, and sweets arranged for a Persian wedding " +
      "couple in 1500, a tradition that continues at ceremonies across Iran today for many families.",
    "It varies from place to place and nobody agrees on it.",
  ];

  it("computes 100% coverage when every question has a passing passage", () => {
    const out = computePageAnswerabilityCoverage(
      "https://example.com/nowruz",
      passages,
      ["When does Nowruz begin?", "What is in the sofreh aghd spread?"],
    );
    expect(out.coveragePercent).toBe(100);
    expect(out.uncoveredQuestions).toEqual([]);
    expect(out.bestPassage).toBeTruthy();
  });

  it("reports partial coverage and lists the uncovered question with reasons", () => {
    const out = computePageAnswerabilityCoverage(
      "https://example.com/nowruz",
      passages,
      ["When does Nowruz begin?", "What is the tallest mountain in Switzerland?"],
    );
    expect(out.coveragePercent).toBe(50);
    expect(out.uncoveredQuestions.length).toBe(1);
    expect(out.uncoveredQuestions[0]!.question).toBe("What is the tallest mountain in Switzerland?");
    expect(out.uncoveredQuestions[0]!.failures.length).toBeGreaterThan(0);
  });

  it("returns 0% coverage with no fabricated passing when the page has no passages", () => {
    const out = computePageAnswerabilityCoverage("https://example.com/empty", [], ["What is Nowruz?"]);
    expect(out.coveragePercent).toBe(0);
    expect(out.bestPassage).toBeNull();
    expect(out.uncoveredQuestions.length).toBe(1);
  });

  it("still surfaces a best passage when there are no target questions yet", () => {
    const out = computePageAnswerabilityCoverage("https://example.com/nowruz", passages, []);
    expect(out.coveragePercent).toBe(0);
    expect(out.bestPassage).toBeTruthy();
    expect(out.perQuestion).toEqual([]);
  });

  it("uses the shared coverage threshold constant consistently", () => {
    expect(COVERAGE_SCORE_THRESHOLD).toBeGreaterThan(0);
    expect(COVERAGE_SCORE_THRESHOLD).toBeLessThanOrEqual(100);
  });
});
