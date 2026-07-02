import { describe, it, expect } from "vitest";
import { computeEngineGaps, engineGapHeadline, promptGapSentence, type EngineCheckRow } from "./engine-gaps";
import { hasBannedDash } from "@/lib/copy/strip-dashes";

const row = (
  promptId: string,
  engine: EngineCheckRow["engine"],
  citedYou: boolean,
  ownedUrls: string[] = [],
): EngineCheckRow => ({ promptId, promptText: `question ${promptId}`, engine, citedYou, ownedUrls });

describe("computeEngineGaps - the per-engine matrix", () => {
  it("builds the matrix, per-engine totals, and honest enginesChecked", () => {
    const report = computeEngineGaps([
      row("p1", "perplexity", true, ["https://iranopedia.com/persian-rugs"]),
      row("p1", "chatgpt", false),
      row("p2", "perplexity", true),
      row("p2", "chatgpt", true),
    ]);
    expect(report.promptsChecked).toBe(2);
    expect(report.enginesChecked).toEqual(["chatgpt", "perplexity"]);
    expect(report.perEngine).toEqual([
      { engine: "chatgpt", promptsChecked: 2, citedYou: 1 },
      { engine: "perplexity", promptsChecked: 2, citedYou: 2 },
    ]);
    const p1 = report.matrix.find((m) => m.promptId === "p1")!;
    expect(p1.byEngine).toEqual({ chatgpt: false, perplexity: true });
    expect(p1.citedEngines).toEqual(["perplexity"]);
    expect(p1.missingEngines).toEqual(["chatgpt"]);
    expect(p1.ownedUrl).toBe("https://iranopedia.com/persian-rugs");
  });

  it("a gap needs at least one citing AND one checked-but-missing engine", () => {
    const report = computeEngineGaps([
      row("cited-everywhere", "chatgpt", true),
      row("cited-everywhere", "gemini", true),
      row("cited-nowhere", "chatgpt", false),
      row("cited-nowhere", "gemini", false),
      row("real-gap", "chatgpt", true, ["https://iranopedia.com/x"]),
      row("real-gap", "gemini", false),
    ]);
    expect(report.gaps.map((g) => g.promptId)).toEqual(["real-gap"]);
  });

  it("an UNCHECKED engine is never counted as missing (no data is not no citations)", () => {
    const report = computeEngineGaps([
      row("p1", "perplexity", true),
      row("p1", "gemini", false),
      // chatgpt + claude never ran for p1
    ]);
    const gap = report.gaps[0]!;
    expect(gap.missingEngines).toEqual(["gemini"]);
    expect(gap.missingEngines).not.toContain("chatgpt");
    expect(gap.missingEngines).not.toContain("claude");
    expect(report.enginesChecked).toEqual(["perplexity", "gemini"]);
  });

  it("widest gaps come first (most missing engines)", () => {
    const report = computeEngineGaps([
      row("narrow", "chatgpt", true),
      row("narrow", "gemini", false),
      row("wide", "perplexity", true),
      row("wide", "chatgpt", false),
      row("wide", "gemini", false),
      row("wide", "claude", false),
    ]);
    expect(report.gaps.map((g) => g.promptId)).toEqual(["wide", "narrow"]);
  });

  it("later rows for the same prompt+engine win (re-poll overwrite)", () => {
    const report = computeEngineGaps([row("p1", "chatgpt", false), row("p1", "chatgpt", true), row("p1", "gemini", false)]);
    expect(report.matrix[0]!.byEngine.chatgpt).toBe(true);
    expect(report.perEngine.find((p) => p.engine === "chatgpt")).toEqual({ engine: "chatgpt", promptsChecked: 1, citedYou: 1 });
  });
});

describe("engineGapHeadline - the Today line", () => {
  const report = computeEngineGaps([
    ...Array.from({ length: 25 }, (_, i) => row(`p${i}`, "chatgpt", i < 4)),
    ...Array.from({ length: 25 }, (_, i) => row(`p${i}`, "gemini", i < 1, i < 1 ? ["https://iranopedia.com/a"] : [])),
  ]);

  it("says who recommends you for how many questions, plus tonight's aim", () => {
    const line = engineGapHeadline(report, 2)!;
    expect(line).toBe(
      "ChatGPT recommends you for 4 of 25 questions I checked, Gemini for 1 of 25. Tonight's plan includes 2 changes aimed at the gap.",
    );
  });

  it("singular change reads correctly and zero planned still owns the gap", () => {
    expect(engineGapHeadline(report, 1)).toContain("includes 1 change aimed");
    expect(engineGapHeadline(report, 0)).toContain("I am lining up changes aimed at the gap.");
  });

  it("stays silent with fewer than 2 engines checked or no gaps", () => {
    const oneEngine = computeEngineGaps([row("p1", "chatgpt", true)]);
    expect(engineGapHeadline(oneEngine, 1)).toBeNull();
    const noGaps = computeEngineGaps([row("p1", "chatgpt", true), row("p1", "gemini", true)]);
    expect(engineGapHeadline(noGaps, 1)).toBeNull();
  });

  it("never emits an em or en dash", () => {
    expect(hasBannedDash(engineGapHeadline(report, 2) ?? "")).toBe(false);
    expect(hasBannedDash(engineGapHeadline(report, 0) ?? "")).toBe(false);
  });
});

describe("promptGapSentence - the card sentence", () => {
  it("names the citing and missing engines in plain language", () => {
    const s = promptGapSentence({
      promptText: "best persian rugs",
      citedEngines: ["perplexity"],
      missingEngines: ["chatgpt", "gemini"],
    });
    expect(s).toBe(
      'Perplexity already points people at this page when they ask "best persian rugs". ChatGPT and Gemini do not yet, so this change also aims at that gap.',
    );
    expect(hasBannedDash(s)).toBe(false);
  });

  it("handles plural citing and singular missing grammar", () => {
    const s = promptGapSentence({
      promptText: "iranian food near me",
      citedEngines: ["chatgpt", "perplexity"],
      missingEngines: ["claude"],
    });
    expect(s).toContain("ChatGPT and Perplexity already point people at this page");
    expect(s).toContain("Claude does not yet");
  });
});
