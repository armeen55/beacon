import { describe, expect, it } from "vitest";

import type { NativeObservationInput } from "@/domains/ai-visibility/native-intel";
import type { NativePromptTeardownTarget } from "./competitor-page-audit";
import type { CommonalityBrief } from "./teardown-commonality";
import { buildNativeAeoEvidence, fanoutQuestionsForNativePrompt } from "./native-aeo-evidence";

function observation(over: Partial<NativeObservationInput> = {}): NativeObservationInput {
  return {
    promptId: "p1",
    promptText: "What happens at a Persian wedding?",
    engine: "chatgpt",
    topic: "weddings",
    observedAt: "2026-07-14T00:00:00Z",
    answerText: "What is a sofreh aghd? How long does the ceremony last?",
    citationDomains: ["winner.com"],
    citationUrls: ["https://winner.com/persian-wedding"],
    trackedBrandMentioned: false,
    trackedBrandCited: false,
    ...over,
  };
}

const target: NativePromptTeardownTarget = {
  promptId: "p1",
  promptText: "What happens at a Persian wedding?",
  urls: ["https://winner.com/persian-wedding", "https://second.com/wedding"],
};

const brief: CommonalityBrief = {
  sourceCount: 3,
  sharedHeadings: [{ label: "Sofreh Aghd", winners: 3 }, { label: "Ceremony order", winners: 2 }],
  answerShape: "steps",
  answerShapeVotes: { definition_first: 0, table: 0, faq: 0, steps: 2, narrative: 1 },
  wordBand: { low: 1200, high: 1800, median: 1500 },
  schemaTypes: ["Article", "FAQPage"],
  openingPattern: "direct_definition",
  hasFaqConsensus: true,
  hasToolConsensus: false,
  whatTheyAllHaveThatWeDont: ["Add ceremony order"],
  consensusSpec: null,
};

describe("native AEO evidence convergence", () => {
  it("keeps exact prompt fanouts and topic-matched external fanouts together", () => {
    const questions = fanoutQuestionsForNativePrompt(
      [observation(), observation({ promptId: "other", answerText: "Should not appear?" })],
      "p1",
      ["What should guests wear?"],
    );
    expect(questions).toEqual(expect.arrayContaining([
      "What is a sofreh aghd?",
      "How long does the ceremony last?",
      "What should guests wear?",
    ]));
    expect(questions).not.toContain("Should not appear?");
  });

  it("builds a complete native receipt from cited winner pages and their teardown consensus", () => {
    const rows = [
      observation({
        citationUrls: ["https://winner.com/persian-wedding", "https://iranopedia.com/wedding"],
        trackedBrandCited: true,
      }),
      observation({
        engine: "gemini",
        citationUrls: ["https://winner.com/persian-wedding", "https://second.com/wedding"],
      }),
    ];
    const evidence = buildNativeAeoEvidence({
      target,
      observations: rows,
      brief,
      fanoutQuestions: ["What is a sofreh aghd?", "What should guests wear?"],
      ownedRoot: "iranopedia.com",
    });

    expect(evidence.source).toBe("native");
    expect(evidence.topCitedPages).toEqual([
      { url: "https://winner.com/persian-wedding", hostname: "winner.com", isOwned: false, answers: 2 },
      { url: "https://second.com/wedding", hostname: "second.com", isOwned: false, answers: 1 },
    ]);
    expect(evidence.topCitedDomains[0]).toEqual({ hostname: "winner.com", answers: 2 });
    expect(evidence.ownCitationCount).toBe(1);
    expect(evidence.competitorCitationCount).toBe(2);
    expect(evidence.winnerConsensus).toMatchObject({
      sourceCount: 3,
      sharedHeadings: ["Sofreh Aghd", "Ceremony order"],
      answerShape: "steps",
      schemaTypes: ["Article", "FAQPage"],
    });
  });
});
