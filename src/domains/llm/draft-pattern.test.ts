import { describe, expect, it } from "vitest";
import {
  classifyDraftPattern,
  aggregateWinsByPattern,
  bestConfidentPattern,
  patternInsightSentence,
  MIN_DECIDED_FOR_CONFIDENCE,
  PATTERN_LABEL,
  type PatternOutcomeRow,
} from "./draft-pattern";

describe("classifyDraftPattern - pure structural fixtures", () => {
  it("empty text -> prose_other", () => {
    expect(classifyDraftPattern("")).toBe("prose_other");
    expect(classifyDraftPattern("   ")).toBe("prose_other");
  });

  it("a dictionary-style opener -> definition_first", () => {
    expect(classifyDraftPattern("A gift is a voluntarily transferred item given without expecting payment.")).toBe(
      "definition_first",
    );
    expect(classifyDraftPattern("Chaharshanbe Suri is an ancient Persian fire-jumping festival.")).toBe("definition_first");
  });

  it("a number-leading opener -> stat_first", () => {
    expect(classifyDraftPattern("12 provinces host the annual festival every March.")).toBe("stat_first");
    expect(classifyDraftPattern("Over 3 million people attend the festival each year across Iran.")).toBe("stat_first");
  });

  it("a markdown table -> table", () => {
    const table = "| Name | Year |\n| --- | --- |\n| Cyrus | 550 BC |\n| Darius | 522 BC |";
    expect(classifyDraftPattern(table)).toBe("table");
  });

  it("two or more pipe rows without a separator -> table", () => {
    const table = "| Cyrus | 550 BC |\n| Darius | 522 BC |";
    expect(classifyDraftPattern(table)).toBe("table");
  });

  it("a multi-line bulleted or numbered list -> step_list", () => {
    const steps = "How to make sofreh aghd:\n1. Lay the cloth\n2. Add the mirror\n3. Add the herbs";
    expect(classifyDraftPattern(steps)).toBe("step_list");
    const bullets = "What you need:\n- Rosewater\n- Saffron\n- Sugar cones";
    expect(classifyDraftPattern(bullets)).toBe("step_list");
  });

  it("a single stray dash line does NOT count as a step list", () => {
    expect(classifyDraftPattern("This is fine - not a list at all.")).not.toBe("step_list");
  });

  it("a question-form heading followed by content -> qa_pair", () => {
    const qa = "When is Chaharshanbe Suri?\nIt falls on the last Tuesday night of the year.";
    expect(classifyDraftPattern(qa)).toBe("qa_pair");
    const qa2 = "What Is Nowruz\nThe Persian new year, celebrated at the spring equinox.";
    expect(classifyDraftPattern(qa2)).toBe("qa_pair");
  });

  it("a short single-line question -> qa_pair", () => {
    expect(classifyDraftPattern("Is Nowruz a public holiday in Iran?")).toBe("qa_pair");
  });

  it("plain prose with no structural signal -> prose_other", () => {
    expect(classifyDraftPattern("Families gather around the haft-sin table and share stories long into the night.")).toBe(
      "prose_other",
    );
  });

  it("strips HTML tags before classifying", () => {
    expect(classifyDraftPattern("<p>12 dishes are traditionally served at the table.</p>")).toBe("stat_first");
  });

  it("table beats step_list beats qa_pair beats stat_first beats definition_first (priority order)", () => {
    // A table row is also a "line", but pipe-table detection must win over a list count of 1.
    const tableWithBullet = "| Name | Year |\n| --- | --- |\n- a bullet that could be confused for a list\n| Cyrus | 550 BC |";
    expect(classifyDraftPattern(tableWithBullet)).toBe("table");
  });

  it("every pattern id has a human-safe label with no lab jargon", () => {
    for (const id of Object.keys(PATTERN_LABEL) as (keyof typeof PATTERN_LABEL)[]) {
      expect(PATTERN_LABEL[id]).not.toMatch(/experiment|control|baseline|treatment/i);
    }
  });

  it("never throws on garbage input", () => {
    expect(() => classifyDraftPattern(null as unknown as string)).not.toThrow();
    expect(() => classifyDraftPattern(undefined as unknown as string)).not.toThrow();
  });
});

describe("aggregateWinsByPattern - min sample floor discipline", () => {
  const row = (over: Partial<PatternOutcomeRow>): PatternOutcomeRow => ({
    pattern: "stat_first",
    pageFamily: "iran-animals",
    verdict: "won",
    ...over,
  });

  it("stays unconfident below MIN_DECIDED_FOR_CONFIDENCE decided samples", () => {
    const rows = [row({}), row({})]; // 2 decided, floor is 3
    const cells = aggregateWinsByPattern(rows);
    expect(cells).toHaveLength(1);
    expect(cells[0]!.confident).toBe(false);
    expect(cells[0]!.decided).toBe(2);
  });

  it("becomes confident exactly at the floor", () => {
    const rows = [row({}), row({}), row({ verdict: "lost" })];
    const cells = aggregateWinsByPattern(rows);
    expect(cells[0]!.decided).toBe(MIN_DECIDED_FOR_CONFIDENCE);
    expect(cells[0]!.confident).toBe(true);
    expect(cells[0]!.wins).toBe(2);
    expect(cells[0]!.losses).toBe(1);
    expect(cells[0]!.winRate).toBeCloseTo(2 / 3);
  });

  it("excludes pending (measuring) rows from the decided count entirely", () => {
    const rows = [row({}), row({}), row({ verdict: "measuring" }), row({ verdict: "measuring" })];
    const cells = aggregateWinsByPattern(rows);
    expect(cells[0]!.decided).toBe(2);
    expect(cells[0]!.pending).toBe(2);
    expect(cells[0]!.confident).toBe(false);
  });

  it("inconclusive/insufficient_data count as decided-but-neutral (flat), not wins or losses", () => {
    const rows = [row({ verdict: "inconclusive" }), row({ verdict: "insufficient_data" }), row({ verdict: "won" })];
    const cells = aggregateWinsByPattern(rows);
    expect(cells[0]!.decided).toBe(3);
    expect(cells[0]!.wins).toBe(1);
    expect(cells[0]!.losses).toBe(0);
  });

  it("a citation gain upgrades a GSC-inconclusive row to a win", () => {
    const rows = [
      row({ verdict: "inconclusive", citationVerdict: "gained" }),
      row({ verdict: "inconclusive", citationVerdict: "gained" }),
      row({ verdict: "inconclusive", citationVerdict: "gained" }),
    ];
    const cells = aggregateWinsByPattern(rows);
    expect(cells[0]!.wins).toBe(3);
    expect(cells[0]!.winRate).toBe(1);
  });

  it("a citation loss downgrades a GSC-inconclusive row to a loss", () => {
    const rows = [
      row({ verdict: "inconclusive", citationVerdict: "lost" }),
      row({ verdict: "inconclusive", citationVerdict: "lost" }),
      row({ verdict: "inconclusive", citationVerdict: "lost" }),
    ];
    const cells = aggregateWinsByPattern(rows);
    expect(cells[0]!.losses).toBe(3);
  });

  it("keeps separate cells per (pattern, pageFamily)", () => {
    const rows = [
      row({ pattern: "stat_first", pageFamily: "iran-animals" }),
      row({ pattern: "table", pageFamily: "iran-animals" }),
      row({ pattern: "stat_first", pageFamily: "iran-flags" }),
    ];
    const cells = aggregateWinsByPattern(rows);
    expect(cells).toHaveLength(3);
  });

  it("empty input -> empty output, never throws", () => {
    expect(aggregateWinsByPattern([])).toEqual([]);
  });
});

describe("bestConfidentPattern - never surfaces below the floor", () => {
  it("returns null when no cell for the page family is confident", () => {
    const cells = aggregateWinsByPattern([
      { pattern: "stat_first", pageFamily: "iran-animals", verdict: "won" },
      { pattern: "stat_first", pageFamily: "iran-animals", verdict: "won" },
    ]);
    expect(bestConfidentPattern(cells, "iran-animals")).toBeNull();
  });

  it("returns null for a page family with zero rows at all", () => {
    const cells = aggregateWinsByPattern([
      { pattern: "stat_first", pageFamily: "iran-animals", verdict: "won" },
      { pattern: "stat_first", pageFamily: "iran-animals", verdict: "won" },
      { pattern: "stat_first", pageFamily: "iran-animals", verdict: "won" },
    ]);
    expect(bestConfidentPattern(cells, "iran-flags")).toBeNull();
  });

  it("picks the highest win-rate confident cell for the family", () => {
    const rows: PatternOutcomeRow[] = [
      ...Array.from({ length: 3 }, () => ({ pattern: "stat_first" as const, pageFamily: "iran-animals", verdict: "won" as const })),
      ...Array.from({ length: 3 }, (_, i): PatternOutcomeRow => ({
        pattern: "definition_first",
        pageFamily: "iran-animals",
        verdict: i === 0 ? "won" : "lost",
      })),
    ];
    const cells = aggregateWinsByPattern(rows);
    const best = bestConfidentPattern(cells, "iran-animals");
    expect(best?.pattern).toBe("stat_first");
    expect(best?.winRate).toBe(1);
  });

  it("patternInsightSentence names the pattern, the page family, and the raw counts (no jargon)", () => {
    const rows: PatternOutcomeRow[] = Array.from({ length: 4 }, (_, i): PatternOutcomeRow => ({
      pattern: "stat_first",
      pageFamily: "iran-animals",
      verdict: i < 3 ? "won" : "lost",
    }));
    const cells = aggregateWinsByPattern(rows);
    const best = bestConfidentPattern(cells, "iran-animals")!;
    const sentence = patternInsightSentence(best);
    expect(sentence).toContain("stat-first");
    expect(sentence).toContain("iran-animals");
    expect(sentence).toContain("3 of 4");
    expect(sentence).not.toMatch(/experiment|control|baseline|treatment/i);
    expect(sentence).not.toMatch(/[–—]/);
  });
});
