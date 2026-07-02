import { describe, it, expect } from "vitest";
import {
  voiceProbability,
  dissentProbability,
  brierScore,
  aggregateVotes,
  buildSpecialistScoreboard,
  bestForecaster,
  recordLine,
  buildBestForecasterLine,
  type ScoredVote,
} from "./brier";

/** Beacon copy contract: no em/en dashes (or the wider dash family), no lab jargon. */
function expectCleanCopy(sentence: string): void {
  expect(sentence).not.toMatch(/[‒–—―]/);
  expect(sentence).not.toMatch(/\b(experiment|control|baseline|treatment|reservation|SERP)\b/i);
}

describe("voiceProbability", () => {
  it("reads a supporting voice's conviction directly as a probability", () => {
    expect(voiceProbability("supporting", 100)).toBe(1);
    expect(voiceProbability("supporting", 0)).toBe(0);
    expect(voiceProbability("supporting", 75)).toBe(0.75);
  });

  it("inverts a dissenting voice's conviction (1 - scaled)", () => {
    expect(voiceProbability("dissenting", 100)).toBe(0);
    expect(voiceProbability("dissenting", 0)).toBe(1);
    expect(voiceProbability("dissenting", 80)).toBeCloseTo(0.2);
  });

  it("clamps out-of-range conviction so a bad input never breaks the probability bounds", () => {
    expect(voiceProbability("supporting", 150)).toBe(1);
    expect(voiceProbability("supporting", -20)).toBe(0);
    expect(voiceProbability("supporting", Number.NaN)).toBe(0);
  });

  it("dissentProbability maps veto to a stronger bet against than downgrade", () => {
    const veto = dissentProbability("veto");
    const downgrade = dissentProbability("downgrade");
    expect(veto).toBeLessThan(downgrade);
    expect(veto).toBeCloseTo(0.2);
    expect(downgrade).toBeCloseTo(0.4);
  });
});

describe("brierScore", () => {
  it("scores a perfect forecaster at 0", () => {
    expect(brierScore(1, 1)).toBe(0);
    expect(brierScore(0, 0)).toBe(0);
  });

  it("scores a perfectly wrong forecaster at 1", () => {
    expect(brierScore(1, 0)).toBe(1);
    expect(brierScore(0, 1)).toBe(1);
  });

  it("scores a coin flip at 0.25 regardless of outcome", () => {
    expect(brierScore(0.5, 1)).toBeCloseTo(0.25);
    expect(brierScore(0.5, 0)).toBeCloseTo(0.25);
  });

  it("clamps an out-of-range probability rather than producing a nonsensical score", () => {
    expect(brierScore(1.5, 1)).toBe(0); // clamped to 1, matches outcome 1
    expect(brierScore(-0.5, 0)).toBe(0); // clamped to 0, matches outcome 0
  });
});

describe("aggregateVotes", () => {
  it("a perfect forecaster (always right, high conviction) gets brier 0 and every win counted won", () => {
    const votes: ScoredVote[] = [
      { specialist: "gsc", actionFamily: "title", probability: 1, outcome: 1 },
      { specialist: "gsc", actionFamily: "title", probability: 1, outcome: 1 },
      { specialist: "gsc", actionFamily: "title", probability: 0, outcome: 0 },
    ];
    const tally = aggregateVotes(votes);
    expect(tally.brier).toBeCloseTo(0);
    expect(tally.won).toBe(2);
    expect(tally.lost).toBe(0);
    expect(tally.flat).toBe(1);
    expect(tally.n).toBe(3);
  });

  it("a contrarian (always confidently wrong) gets brier close to 1 and every call scored lost/flat correctly", () => {
    // Backs (probability >= 0.5) picks that then lose -> "lost". Bets against (probability < 0.5)
    // picks that then win -> also a miss for the dissenter, counted as "won" per the ledger's own
    // verdict (the pick still won), not the dissenter's call.
    const votes: ScoredVote[] = [
      { specialist: "clarity", actionFamily: "meta", probability: 0.95, outcome: 0 }, // backed a loser
      { specialist: "clarity", actionFamily: "meta", probability: 0.05, outcome: 1 }, // dissented on a winner
    ];
    const tally = aggregateVotes(votes);
    expect(tally.brier).toBeCloseTo((0.95 ** 2 + 0.95 ** 2) / 2, 5);
    expect(tally.lost).toBe(1); // backed a pick that lost
    expect(tally.won).toBe(1); // the pick it dissented on still won
    expect(tally.flat).toBe(0);
  });

  it("a correct dissenter (bets against, and the pick loses) is scored flat, not lost or won", () => {
    const votes: ScoredVote[] = [{ specialist: "ga4", actionFamily: "meta", probability: 0.2, outcome: 0 }];
    const tally = aggregateVotes(votes);
    expect(tally.flat).toBe(1);
    expect(tally.won).toBe(0);
    expect(tally.lost).toBe(0);
    expect(tally.brier).toBeCloseTo(0.04);
  });

  it("empty votes never divide by zero: brier null, all counts 0, no calibration note", () => {
    const tally = aggregateVotes([]);
    expect(tally.n).toBe(0);
    expect(tally.brier).toBeNull();
    expect(tally.won).toBe(0);
    expect(tally.flat).toBe(0);
    expect(tally.lost).toBe(0);
    expect(tally.calibrationNote).toBeNull();
  });

  it("small-n honesty: a thin sample (below 5) carries a caveat note even though the score is real", () => {
    const oneVote = aggregateVotes([{ specialist: "gsc", actionFamily: "title", probability: 0.9, outcome: 1 }]);
    expect(oneVote.n).toBe(1);
    expect(oneVote.brier).not.toBeNull();
    expect(oneVote.calibrationNote).toMatch(/only 1 settled pick/i);
    expectCleanCopy(oneVote.calibrationNote!);

    const fourVotes = aggregateVotes(
      Array.from({ length: 4 }, () => ({ specialist: "gsc", actionFamily: "title", probability: 0.9, outcome: 1 as const })),
    );
    expect(fourVotes.calibrationNote).toMatch(/only 4 settled picks/i);

    const fiveVotes = aggregateVotes(
      Array.from({ length: 5 }, () => ({ specialist: "gsc", actionFamily: "title", probability: 0.9, outcome: 1 as const })),
    );
    expect(fiveVotes.calibrationNote).toBeNull(); // no longer "too early" once the bar is cleared
  });
});

describe("buildSpecialistScoreboard", () => {
  const votes: ScoredVote[] = [
    { specialist: "gsc", actionFamily: "title", probability: 0.9, outcome: 1 },
    { specialist: "gsc", actionFamily: "title", probability: 0.8, outcome: 0 },
    { specialist: "gsc", actionFamily: "meta", probability: 0.7, outcome: 1 },
    { specialist: "clarity", actionFamily: "title", probability: 0.6, outcome: 1 },
  ];

  it("groups by specialist, and within each specialist by actionFamily", () => {
    const rows = buildSpecialistScoreboard(votes);
    const gsc = rows.find((r) => r.specialist === "gsc")!;
    expect(gsc.overall.n).toBe(3);
    expect(Object.keys(gsc.byFamily).sort()).toEqual(["meta", "title"]);
    expect(gsc.byFamily.title!.n).toBe(2);
    expect(gsc.byFamily.meta!.n).toBe(1);

    const clarity = rows.find((r) => r.specialist === "clarity")!;
    expect(clarity.overall.n).toBe(1);
  });

  it("abstain exclusion: a specialist with zero votes never appears in the scoreboard at all", () => {
    const rows = buildSpecialistScoreboard(votes);
    expect(rows.find((r) => r.specialist === "profound")).toBeUndefined();
    expect(rows.find((r) => r.specialist === "ga4")).toBeUndefined();
  });

  it("deterministic alphabetical ordering of specialists and families", () => {
    const rows = buildSpecialistScoreboard(votes);
    expect(rows.map((r) => r.specialist)).toEqual(["clarity", "gsc"]);
    const gsc = rows.find((r) => r.specialist === "gsc")!;
    expect(Object.keys(gsc.byFamily)).toEqual(["meta", "title"]);
  });
});

describe("bestForecaster", () => {
  it("picks the lowest-brier specialist among those clearing the minimum sample", () => {
    const rows = buildSpecialistScoreboard([
      ...Array.from({ length: 5 }, () => ({ specialist: "gsc", actionFamily: "title", probability: 0.9, outcome: 1 as const })),
      ...Array.from({ length: 5 }, () => ({ specialist: "clarity", actionFamily: "title", probability: 0.6, outcome: 1 as const })),
    ]);
    const best = bestForecaster(rows, 5);
    expect(best?.specialist).toBe("gsc");
  });

  it("excludes a specialist below the minimum sample, even with a perfect record", () => {
    const rows = buildSpecialistScoreboard([
      { specialist: "gsc", actionFamily: "title", probability: 1, outcome: 1 }, // perfect but n=1
      ...Array.from({ length: 5 }, () => ({ specialist: "clarity", actionFamily: "title", probability: 0.7, outcome: 1 as const })),
    ]);
    const best = bestForecaster(rows, 5);
    expect(best?.specialist).toBe("clarity");
  });

  it("returns null when nobody clears the minimum sample (abstainer-heavy or too-thin scoreboard)", () => {
    const rows = buildSpecialistScoreboard([{ specialist: "gsc", actionFamily: "title", probability: 0.9, outcome: 1 }]);
    expect(bestForecaster(rows, 5)).toBeNull();
    expect(bestForecaster([], 5)).toBeNull();
  });
});

describe("recordLine", () => {
  it("renders a plain won-of-n line", () => {
    const tally = aggregateVotes([
      { specialist: "gsc", actionFamily: "title", probability: 0.9, outcome: 1 },
      { specialist: "gsc", actionFamily: "title", probability: 0.9, outcome: 0 },
    ]);
    expect(recordLine(tally)).toBe("1 of 2");
  });

  it("is null when there are no settled votes (never fabricate a record for an abstainer)", () => {
    expect(recordLine(aggregateVotes([]))).toBeNull();
  });
});

describe("buildBestForecasterLine", () => {
  const label = (s: string) => (s === "gsc" ? "Search demand" : s);

  it("names the best forecaster with its real numbers, in the exact operator voice", () => {
    const rows = buildSpecialistScoreboard([
      ...Array.from({ length: 5 }, () => ({ specialist: "gsc", actionFamily: "title", probability: 0.9, outcome: 1 as const })),
      { specialist: "gsc", actionFamily: "title", probability: 0.9, outcome: 0 },
    ]);
    const line = buildBestForecasterLine(rows, 5, label);
    expect(line).toBe(
      "The Search demand teammate has called 5 of 6 winners right this quarter - the sharpest eye on the team right now.",
    );
    expectCleanCopy(line!);
  });

  it("is silent (null) when no specialist clears the minimum sample", () => {
    const rows = buildSpecialistScoreboard([{ specialist: "gsc", actionFamily: "title", probability: 0.9, outcome: 1 }]);
    expect(buildBestForecasterLine(rows, 5, label)).toBeNull();
  });

  it("never emits a dash character anywhere in generated copy (dash guard)", () => {
    const rows = buildSpecialistScoreboard(
      Array.from({ length: 20 }, (_, i) => ({
        specialist: i % 2 === 0 ? "gsc" : "clarity",
        actionFamily: "title",
        probability: 0.85,
        outcome: (i % 3 === 0 ? 0 : 1) as 0 | 1,
      })),
    );
    const line = buildBestForecasterLine(rows, 5, label);
    expect(line).not.toBeNull();
    expectCleanCopy(line!);
    for (const row of rows) {
      if (row.overall.calibrationNote) expectCleanCopy(row.overall.calibrationNote);
      for (const family of Object.values(row.byFamily)) {
        if (family.calibrationNote) expectCleanCopy(family.calibrationNote);
      }
    }
  });
});
