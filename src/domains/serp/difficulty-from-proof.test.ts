import { describe, it, expect } from "vitest";
import {
  estimateDifficultyFromProof,
  startBandForPosition,
  MIN_BAND_OUTCOMES,
  type ProofOutcome,
} from "./difficulty-from-proof";

describe("startBandForPosition", () => {
  it("maps positions to the same bands the rest of Beacon speaks in", () => {
    expect(startBandForPosition(1)).toBe("top3");
    expect(startBandForPosition(3)).toBe("top3");
    expect(startBandForPosition(4)).toBe("striking");
    expect(startBandForPosition(10)).toBe("striking");
    expect(startBandForPosition(11)).toBe("deep");
    expect(startBandForPosition(45)).toBe("deep");
  });

  it("treats 0 / null / non-finite as unranked", () => {
    expect(startBandForPosition(0)).toBe("unranked");
    expect(startBandForPosition(null)).toBe("unranked");
    expect(startBandForPosition(undefined)).toBe("unranked");
    expect(startBandForPosition(Number.NaN)).toBe("unranked");
  });
});

describe("estimateDifficultyFromProof (v1 366) - $0 difficulty from our own history", () => {
  it("empty-safe: no outcomes -> null difficulty + honest not-enough-history line, never fabricates", () => {
    const d = estimateDifficultyFromProof(8, []);
    expect(d.difficulty).toBeNull();
    expect(d.band).toBeNull();
    expect(d.sampleSize).toBe(0);
    expect(d.startBand).toBe("striking");
    expect(d.sentence).toMatch(/do not have enough of our own results/i);
    // Beacon voice: no lab words, no em/en dashes.
    expect(d.sentence).not.toMatch(/[‒–—―]/);
  });

  it("below the sample floor stays honest (null), never a number off a sliver", () => {
    const outcomes: ProofOutcome[] = [
      { startPosition: 5, verdict: "won" },
      { startPosition: 6, verdict: "lost" },
    ]; // 2 settled, floor is 3
    const d = estimateDifficultyFromProof(7, outcomes);
    expect(MIN_BAND_OUTCOMES).toBe(3);
    expect(d.sampleSize).toBe(2);
    expect(d.difficulty).toBeNull();
  });

  it("only counts settled outcomes IN the same start band", () => {
    const outcomes: ProofOutcome[] = [
      // striking band (this page starts at #7)
      { startPosition: 5, verdict: "won" },
      { startPosition: 6, verdict: "won" },
      { startPosition: 8, verdict: "lost" },
      // other bands are ignored
      { startPosition: 2, verdict: "lost" },
      { startPosition: 30, verdict: "lost" },
      // non-settled are ignored
      { startPosition: 9, verdict: "measuring" },
      { startPosition: 9, verdict: "inconclusive" },
    ];
    const d = estimateDifficultyFromProof(7, outcomes);
    expect(d.startBand).toBe("striking");
    expect(d.sampleSize).toBe(3); // only the 3 settled striking rows
    expect(d.wins).toBe(2);
  });

  it("high win-rate band -> low difficulty, winnable, concrete track-record sentence", () => {
    const outcomes: ProofOutcome[] = Array.from({ length: 10 }, (_, i) => ({
      startPosition: 6,
      verdict: i < 8 ? "won" : "lost", // 8 of 10 won
    }));
    const d = estimateDifficultyFromProof(6, outcomes);
    expect(d.wins).toBe(8);
    expect(d.sampleSize).toBe(10);
    // difficulty = (1 - 0.8) * 100 = 20
    expect(d.difficulty).toBe(20);
    expect(d.band).toBe("winnable");
    expect(d.sentence).toMatch(/8 of 10 won \(80%\)/);
    expect(d.sentence).toMatch(/realistic win/i);
  });

  it("low win-rate band -> high difficulty, hard", () => {
    const outcomes: ProofOutcome[] = [
      { startPosition: 20, verdict: "won" },
      { startPosition: 25, verdict: "lost" },
      { startPosition: 30, verdict: "lost" },
      { startPosition: 40, verdict: "lost" },
      { startPosition: 15, verdict: "lost" },
      { startPosition: 18, verdict: "lost" },
    ]; // 1 of 6 won
    const d = estimateDifficultyFromProof(22, outcomes);
    expect(d.startBand).toBe("deep");
    expect(d.wins).toBe(1);
    expect(d.sampleSize).toBe(6);
    // difficulty = round((1 - 1/6) * 100) = 83
    expect(d.difficulty).toBe(83);
    expect(d.band).toBe("hard");
    expect(d.sentence).toMatch(/genuinely hard/i);
  });

  it("mid win-rate -> moderate band", () => {
    const outcomes: ProofOutcome[] = [
      { startPosition: 2, verdict: "won" },
      { startPosition: 2, verdict: "won" },
      { startPosition: 3, verdict: "lost" },
      { startPosition: 1, verdict: "lost" },
    ]; // 2 of 4 = 50%
    const d = estimateDifficultyFromProof(1, outcomes);
    expect(d.startBand).toBe("top3");
    expect(d.difficulty).toBe(50);
    expect(d.band).toBe("moderate");
  });

  it("every sentence is dash-free (Beacon voice guard)", () => {
    const cases = [
      estimateDifficultyFromProof(null, []),
      estimateDifficultyFromProof(6, Array.from({ length: 5 }, () => ({ startPosition: 6, verdict: "won" }))),
      estimateDifficultyFromProof(30, Array.from({ length: 5 }, () => ({ startPosition: 30, verdict: "lost" }))),
    ];
    for (const c of cases) expect(c.sentence).not.toMatch(/[‒–—―]/);
  });
});
