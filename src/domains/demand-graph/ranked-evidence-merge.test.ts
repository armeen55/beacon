import { describe, expect, it } from "vitest";

import type { RankedUnifiedEntry } from "@/domains/allocator/unified-list";
import type { MoveCandidate } from "./build-graph";
import { mergeRankedEvidenceIntoGraphMove } from "./ranked-evidence-merge";

const move: MoveCandidate = {
  demandKey: "gap:tea",
  label: "persian tea culture",
  gap: "answer_block",
  score: 77,
  components: { demand: 10, winnability: 0.7, dollarValue: 0, visibilityGap: 1, friction: 0 },
  confidence: "high",
  signals: ["GSC"],
  ownedUrl: "https://iranopedia.com/tea/",
  competitorUrls: ["https://old.example/tea"],
  fanoutSeeds: ["how is tea served"],
  rationale: "Original graph decision",
};

const ranked = {
  id: "ranked-tea",
  query: "persian tea culture",
  page: "https://iranopedia.com/tea",
  graphBacked: true,
  competitorUrls: ["https://live-winner.example/persian-tea"],
  fanoutSeeds: ["what glass is used"],
  aeoEvidence: { source: "native", prompt: "tea" },
} as unknown as RankedUnifiedEntry;

describe("mergeRankedEvidenceIntoGraphMove", () => {
  it("puts fresh winners first while preserving the graph decision and score", () => {
    const result = mergeRankedEvidenceIntoGraphMove(move, [ranked]);
    expect(result.competitorUrls).toEqual([
      "https://live-winner.example/persian-tea",
      "https://old.example/tea",
    ]);
    expect(result.fanoutSeeds).toEqual(["how is tea served", "what glass is used"]);
    expect(result.aeoEvidence).toBe(ranked.aeoEvidence);
    expect(result.demandKey).toBe(move.demandKey);
    expect(result.gap).toBe(move.gap);
    expect(result.score).toBe(move.score);
    expect(result.rationale).toBe(move.rationale);
  });

  it("returns the original move when no graph-backed entry matches", () => {
    expect(mergeRankedEvidenceIntoGraphMove(move, [{ ...ranked, graphBacked: false }])).toBe(move);
  });
});
