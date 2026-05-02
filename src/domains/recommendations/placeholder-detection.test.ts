/**
 * W3 Step 3.1 (2026-05-01) — placeholder-detection unit tests.
 *
 * Two layers under test:
 *   - PHRASE: detectPlaceholder + looksLikePlaceholder
 *   - STRUCTURAL (FAQ): evaluateFaqAnswer + parseFaqProposedText
 *
 * No I/O, no fixtures from disk, no DB. Pure-function tests.
 */

import { describe, expect, it } from "vitest";
import {
  detectPlaceholder,
  evaluateFaqAnswer,
  looksLikePlaceholder,
  parseFaqProposedText,
  PLACEHOLDER_PATTERNS,
  tokenizeContentWords,
  MIN_FAQ_ANSWER_WORDS,
  MIN_SPECIFIC_CONTENT_WORDS,
} from "./placeholder-detection";

describe("PLACEHOLDER_PATTERNS — coverage", () => {
  it("registers the 8 operator-locked placeholder patterns", () => {
    const ids = PLACEHOLDER_PATTERNS.map((p) => p.id).sort();
    expect(ids).toEqual([
      "draft_answer",
      "insert_bracket",
      "operator_parenthetical",
      "operator_rewrite",
      "placeholder_word",
      "rewrite_below",
      "tbd",
      "todo_marker",
    ]);
  });
});

describe("looksLikePlaceholder — phrase detection", () => {
  it("rejects `Draft answer` (case-insensitive)", () => {
    expect(looksLikePlaceholder("Draft answer (operator: rewrite).")).toBe(true);
    expect(looksLikePlaceholder("draft answer text here")).toBe(true);
    expect(looksLikePlaceholder("DRAFT ANSWER: ...")).toBe(true);
  });

  it("rejects `TBD` as a standalone token", () => {
    expect(looksLikePlaceholder("Pricing: TBD")).toBe(true);
    expect(looksLikePlaceholder("(TBD)")).toBe(true);
    expect(looksLikePlaceholder("TBD.")).toBe(true);
  });

  it("does NOT reject TBD as a substring of another word", () => {
    expect(looksLikePlaceholder("TBDC technologies")).toBe(false);
    expect(looksLikePlaceholder("contributedTBD")).toBe(false);
  });

  it("rejects `operator: rewrite` with various spacing", () => {
    expect(looksLikePlaceholder("(operator: rewrite)")).toBe(true);
    expect(looksLikePlaceholder("operator:rewrite")).toBe(true);
    expect(looksLikePlaceholder("Operator : Rewrite")).toBe(true);
  });

  it("rejects any (operator: ...) parenthetical", () => {
    expect(looksLikePlaceholder("...something (operator: fill in)")).toBe(true);
    expect(looksLikePlaceholder("(operator: add details here)")).toBe(true);
    expect(looksLikePlaceholder("(Operator: do the thing)")).toBe(true);
  });

  it("rejects `rewrite below` instruction", () => {
    expect(looksLikePlaceholder("Stub. Rewrite below.")).toBe(true);
    expect(looksLikePlaceholder("rewrite below this line")).toBe(true);
  });

  it("rejects `[insert ...]` template brackets", () => {
    expect(looksLikePlaceholder("Pricing is [insert price] per square foot."))
      .toBe(true);
    expect(looksLikePlaceholder("[insert text here]")).toBe(true);
    expect(looksLikePlaceholder("[INSERT cost]")).toBe(true);
  });

  it("does NOT reject the verb 'insert' in normal copy", () => {
    expect(looksLikePlaceholder("insert the screws clockwise")).toBe(false);
    expect(looksLikePlaceholder("we insert anchors when framing")).toBe(false);
  });

  it("rejects literal `placeholder` word", () => {
    expect(looksLikePlaceholder("This is a placeholder.")).toBe(true);
    expect(looksLikePlaceholder("Placeholder content here.")).toBe(true);
  });

  it("rejects literal `TODO:` template marker", () => {
    expect(looksLikePlaceholder("TODO: write the answer")).toBe(true);
    expect(looksLikePlaceholder("todo: think about this later")).toBe(true);
  });

  it("does NOT reject 'TODO' alone (no colon)", () => {
    expect(looksLikePlaceholder("TODO is a 4-letter word")).toBe(false);
  });

  it("returns false for empty / null / undefined", () => {
    expect(looksLikePlaceholder("")).toBe(false);
    expect(looksLikePlaceholder(null)).toBe(false);
    expect(looksLikePlaceholder(undefined)).toBe(false);
  });

  it("returns false for legitimate product copy that contains placeholder-adjacent words", () => {
    // "Draft" alone, no "Draft answer".
    expect(looksLikePlaceholder("We deliver every project on draft schedule"))
      .toBe(false);
    // "Operator" alone, not in (operator: ...) form.
    expect(looksLikePlaceholder("Our crane operator handles all the heavy lifting"))
      .toBe(false);
  });
});

describe("detectPlaceholder — diagnostic detail", () => {
  it("returns { matched: true, patternId } for matched text", () => {
    const result = detectPlaceholder("Draft answer (operator: rewrite).");
    expect(result.matched).toBe(true);
    if (result.matched) {
      // First-match-wins; "draft_answer" comes before "operator_rewrite"
      // in the pattern array.
      expect(result.patternId).toBe("draft_answer");
      expect(result.description).toContain("Draft answer");
    }
  });

  it("returns { matched: false } for clean text", () => {
    expect(detectPlaceholder("Real product copy.")).toEqual({ matched: false });
  });
});

describe("tokenizeContentWords", () => {
  it("strips stopwords and short tokens", () => {
    const tokens = tokenizeContentWords("The custom home builders in Atherton are great");
    expect(tokens).toEqual(["custom", "home", "builders", "atherton", "great"]);
  });

  it("lowercases everything", () => {
    expect(tokenizeContentWords("ATHERTON Custom HOMES")).toEqual([
      "atherton",
      "custom",
      "homes",
    ]);
  });

  it("handles punctuation gracefully", () => {
    // 'on' is a stopword; gets dropped during tokenization.
    expect(tokenizeContentWords("design-build, full-service, on-time"))
      .toEqual(["design", "build", "full", "service", "time"]);
  });

  it("returns empty array for empty / null inputs", () => {
    expect(tokenizeContentWords("")).toEqual([]);
    expect(tokenizeContentWords(null as unknown as string)).toEqual([]);
  });
});

describe("evaluateFaqAnswer — placeholder phrase short-circuits", () => {
  it("rejects a placeholder body before any structural check runs", () => {
    const verdict = evaluateFaqAnswer({
      question: "Who are the best builders in Atherton?",
      answer: "Draft answer (operator: rewrite). Anchor on: atherton, luxury.",
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.reason).toBe("placeholder_phrase");
    }
  });
});

describe("evaluateFaqAnswer — too_short", () => {
  it(`rejects answers under ${MIN_FAQ_ANSWER_WORDS} words`, () => {
    const verdict = evaluateFaqAnswer({
      question: "What services do you offer?",
      answer: "We offer custom home building and major renovation services.",
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.reason).toBe("too_short");
    }
  });

  it("accepts answers at the threshold (25 words)", () => {
    // 25 specific content words that don't overlap with the question.
    const verdict = evaluateFaqAnswer({
      question: "Pricing question?",
      answer:
        "Our typical mid-range custom home build runs between three hundred and four hundred fifty dollars per square foot, varying with finishes, sitework requirements, and permitting timelines for the project.",
    });
    expect(verdict.ok).toBe(true);
  });
});

describe("evaluateFaqAnswer — repeats_question", () => {
  it("rejects answers whose distinct content words are mostly from the question", () => {
    const verdict = evaluateFaqAnswer({
      question: "best custom home builders in Atherton",
      // Answer reuses every question token plus only generic filler.
      answer:
        "Learn about the best custom home builders in Atherton and how to choose the right one to handle your custom home build in Atherton properly.",
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      // Either repeats_question (overlap branch) or no_specific_content
      // (filler-only branch) — both honest. Pin the union.
      expect(["repeats_question", "no_specific_content"]).toContain(
        verdict.reason,
      );
    }
  });
});

describe("evaluateFaqAnswer — no_specific_content", () => {
  it("rejects answers whose only non-question words are generic filler", () => {
    const verdict = evaluateFaqAnswer({
      question: "Pricing for kitchen remodels?",
      // Long enough (>25 words), low question overlap, but every non-
      // question content word is from the GENERIC_FILLER_WORDS set.
      answer:
        "Learn more about good options. Find the right way to make decisions. Get more information here. Check out the right details. We help you understand what to do next.",
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.reason).toBe("no_specific_content");
    }
  });

  it(`accepts answers with ≥${MIN_SPECIFIC_CONTENT_WORDS} specific words`, () => {
    // Cluster + descriptors + service detail = real content.
    const verdict = evaluateFaqAnswer({
      question: "How long does a kitchen remodel take?",
      answer:
        "A typical full-gut kitchen remodel in Atherton takes twelve to sixteen weeks once permits clear: roughly three weeks for demolition and rough framing, four for cabinet and millwork installation, and five for finishes plus appliance commissioning.",
    });
    expect(verdict.ok).toBe(true);
  });
});

describe("evaluateFaqAnswer — defensive defaults", () => {
  it("treats null/undefined answer as too_short", () => {
    expect(evaluateFaqAnswer({ question: "Q?", answer: null }).ok).toBe(false);
    expect(evaluateFaqAnswer({ question: "Q?", answer: undefined }).ok).toBe(
      false,
    );
  });

  it("treats null/undefined question as 'no question context' (lenient)", () => {
    // Without a question to compare against, the structural test
    // skips the overlap rule but still runs word-count + filler.
    const verdict = evaluateFaqAnswer({
      question: null,
      answer:
        "We focus on full-service design-build delivery for high-end residential clients across Silicon Valley, with deep experience in heritage properties, modern hillside builds, and major-renovation permitting.",
    });
    expect(verdict.ok).toBe(true);
  });
});

describe("parseFaqProposedText", () => {
  it("parses standard `Q: ...\\n\\nA: ...` shape", () => {
    const parsed = parseFaqProposedText(
      "Q: What services do you offer?\n\nA: We deliver full-service custom builds and renovations.",
    );
    expect(parsed).toEqual({
      question: "What services do you offer?",
      answer: "We deliver full-service custom builds and renovations.",
    });
  });

  it("tolerates whitespace around colons", () => {
    const parsed = parseFaqProposedText("Q : Question?\n  A : Answer.");
    expect(parsed).toEqual({ question: "Question?", answer: "Answer." });
  });

  it("returns null for non-FAQ shapes", () => {
    expect(parseFaqProposedText("Just a sentence.")).toBeNull();
    expect(parseFaqProposedText("")).toBeNull();
    expect(parseFaqProposedText(null)).toBeNull();
    expect(parseFaqProposedText(undefined)).toBeNull();
  });

  it("captures multi-line answers", () => {
    const parsed = parseFaqProposedText(
      "Q: Multi-paragraph?\n\nA: Para one.\n\nPara two.",
    );
    expect(parsed?.answer).toContain("Para one");
    expect(parsed?.answer).toContain("Para two");
  });
});
