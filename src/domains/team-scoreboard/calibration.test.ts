import { describe, it, expect } from "vitest";
import {
  bandOf,
  buildCalibrationBands,
  buildCalibrationLine,
  buildObjectionTrackRecord,
  buildObjectionTrackRecordLine,
  type ConvictionObservation,
  type ObjectionObservation,
} from "./calibration";

/** Beacon copy contract: no em/en dashes (or the wider dash family), no lab jargon. */
function expectCleanCopy(sentence: string): void {
  expect(sentence).not.toMatch(/[‒–—―]/);
  expect(sentence).not.toMatch(/\b(experiment|control|baseline|treatment|reservation|SERP)\b/i);
}

describe("bandOf", () => {
  it("buckets a raw conviction into the right band, edges included at the lower bound", () => {
    expect(bandOf(60)).toBe("60-70");
    expect(bandOf(69.9)).toBe("60-70");
    expect(bandOf(70)).toBe("70-80");
    expect(bandOf(80)).toBe("80-90");
    expect(bandOf(90)).toBe("90+");
    expect(bandOf(100)).toBe("90+");
  });

  it("returns null below 60 (not a confident claim) or out of range", () => {
    expect(bandOf(59.9)).toBeNull();
    expect(bandOf(0)).toBeNull();
    expect(bandOf(-5)).toBeNull();
    expect(bandOf(101)).toBeNull();
    expect(bandOf(Number.NaN)).toBeNull();
  });
});

describe("buildCalibrationBands", () => {
  it("always returns all 4 bands, even when empty", () => {
    const bands = buildCalibrationBands([]);
    expect(bands.map((b) => b.band)).toEqual(["60-70", "70-80", "80-90", "90+"]);
    for (const b of bands) {
      expect(b.n).toBe(0);
      expect(b.won).toBe(0);
      expect(b.winRatePct).toBeNull();
    }
  });

  it("perfect calibration: a specialist arguing at 80 percent wins about 80 percent of the time", () => {
    const observations: ConvictionObservation[] = [
      ...Array.from({ length: 8 }, () => ({ specialist: "gsc", conviction: 80, outcome: 1 as const })),
      ...Array.from({ length: 2 }, () => ({ specialist: "gsc", conviction: 80, outcome: 0 as const })),
    ];
    const bands = buildCalibrationBands(observations);
    const band = bands.find((b) => b.band === "80-90")!;
    expect(band.n).toBe(10);
    expect(band.won).toBe(8);
    expect(band.winRatePct).toBe(80);
  });

  it("overconfident: a specialist arguing at 90+ wins only half the time", () => {
    const observations: ConvictionObservation[] = [
      ...Array.from({ length: 5 }, () => ({ specialist: "llm", conviction: 95, outcome: 1 as const })),
      ...Array.from({ length: 5 }, () => ({ specialist: "llm", conviction: 95, outcome: 0 as const })),
    ];
    const bands = buildCalibrationBands(observations);
    const band = bands.find((b) => b.band === "90+")!;
    expect(band.n).toBe(10);
    expect(band.won).toBe(5);
    expect(band.winRatePct).toBe(50); // stated 95, realized 50 - a real overconfidence gap
  });

  it("excludes votes below 60 conviction from every band (not a confident claim)", () => {
    const observations: ConvictionObservation[] = [
      { specialist: "gsc", conviction: 55, outcome: 1 },
      { specialist: "gsc", conviction: 40, outcome: 0 },
    ];
    const bands = buildCalibrationBands(observations);
    expect(bands.every((b) => b.n === 0)).toBe(true);
  });

  it("splits observations across multiple bands correctly", () => {
    const observations: ConvictionObservation[] = [
      { specialist: "gsc", conviction: 65, outcome: 1 },
      { specialist: "gsc", conviction: 75, outcome: 1 },
      { specialist: "gsc", conviction: 75, outcome: 0 },
      { specialist: "gsc", conviction: 99, outcome: 1 },
    ];
    const bands = buildCalibrationBands(observations);
    expect(bands.find((b) => b.band === "60-70")!.n).toBe(1);
    expect(bands.find((b) => b.band === "70-80")!.n).toBe(2);
    expect(bands.find((b) => b.band === "70-80")!.won).toBe(1);
    expect(bands.find((b) => b.band === "90+")!.n).toBe(1);
  });
});

describe("buildCalibrationLine", () => {
  it("renders the exact master-plan-style sentence for a well-observed band", () => {
    const observations: ConvictionObservation[] = [
      ...Array.from({ length: 74 }, () => ({ specialist: "gsc", conviction: 80, outcome: 1 as const })),
      ...Array.from({ length: 26 }, () => ({ specialist: "gsc", conviction: 80, outcome: 0 as const })),
    ];
    const bands = buildCalibrationBands(observations);
    const line = buildCalibrationLine("Search demand", bands);
    expect(line).toBe("Search demand argues at 80 percent conviction and is right 74 percent of the time.");
    expectCleanCopy(line!);
  });

  it("small-n honesty: stays silent when no band clears the 5-observation minimum", () => {
    const bands = buildCalibrationBands([
      { specialist: "gsc", conviction: 80, outcome: 1 },
      { specialist: "gsc", conviction: 80, outcome: 1 },
    ]);
    expect(buildCalibrationLine("Search demand", bands)).toBeNull();
  });

  it("picks the band with the most observations among those clearing the bar", () => {
    const observations: ConvictionObservation[] = [
      ...Array.from({ length: 5 }, () => ({ specialist: "gsc", conviction: 65, outcome: 1 as const })),
      ...Array.from({ length: 12 }, () => ({ specialist: "gsc", conviction: 85, outcome: 1 as const })),
    ];
    const bands = buildCalibrationBands(observations);
    const line = buildCalibrationLine("Search demand", bands);
    expect(line).toContain("80 percent conviction");
  });

  it("never emits a dash character anywhere in generated copy (dash guard)", () => {
    const bands = buildCalibrationBands(
      Array.from({ length: 30 }, (_, i) => ({
        specialist: "gsc",
        conviction: 92,
        outcome: (i % 4 === 0 ? 0 : 1) as 0 | 1,
      })),
    );
    const line = buildCalibrationLine("Search demand", bands);
    expect(line).not.toBeNull();
    expectCleanCopy(line!);
  });
});

describe("buildObjectionTrackRecord", () => {
  it("right/wrong matrix: right when the pick lost or landed flat, wrong when it won anyway", () => {
    const observations: ObjectionObservation[] = [
      { objectorLabel: "Visitor behavior", severity: "downgrade", outcome: 0 }, // right (pick lost)
      { objectorLabel: "Visitor behavior", severity: "downgrade", outcome: 0 }, // right
      { objectorLabel: "Visitor behavior", severity: "veto", outcome: 1 }, // wrong (pick won anyway)
      { objectorLabel: "Visitor behavior", severity: "downgrade", outcome: 0 }, // right
    ];
    const tallies = buildObjectionTrackRecord(observations);
    const vb = tallies.find((t) => t.objectorLabel === "Visitor behavior")!;
    expect(vb.objected).toBe(4);
    expect(vb.right).toBe(3);
    expect(vb.wrong).toBe(1);
  });

  it("aggregates multiple objectors independently, alphabetical order", () => {
    const observations: ObjectionObservation[] = [
      { objectorLabel: "Search demand", severity: "downgrade", outcome: 1 },
      { objectorLabel: "AI citations", severity: "veto", outcome: 0 },
    ];
    const tallies = buildObjectionTrackRecord(observations);
    expect(tallies.map((t) => t.objectorLabel)).toEqual(["AI citations", "Search demand"]);
    expect(tallies.find((t) => t.objectorLabel === "AI citations")!.right).toBe(1);
    expect(tallies.find((t) => t.objectorLabel === "Search demand")!.wrong).toBe(1);
  });

  it("empty observations yield an empty list, never a fabricated row", () => {
    expect(buildObjectionTrackRecord([])).toEqual([]);
  });
});

describe("buildObjectionTrackRecordLine", () => {
  it("renders the exact master-plan-style sentence once the objector clears 5 objections", () => {
    const observations: ObjectionObservation[] = [
      { objectorLabel: "Visitor behavior", severity: "downgrade", outcome: 0 },
      { objectorLabel: "Visitor behavior", severity: "downgrade", outcome: 0 },
      { objectorLabel: "Visitor behavior", severity: "veto", outcome: 1 },
      { objectorLabel: "Visitor behavior", severity: "veto", outcome: 1 },
      { objectorLabel: "Visitor behavior", severity: "downgrade", outcome: 1 },
    ];
    const tallies = buildObjectionTrackRecord(observations);
    const line = buildObjectionTrackRecordLine(tallies);
    expect(line).toBe("Visitor behavior objected five times this quarter and was right twice.");
    expectCleanCopy(line!);
  });

  it("small-n honesty: silent below 5 objections even with a perfect record", () => {
    const observations: ObjectionObservation[] = [
      { objectorLabel: "Visitor behavior", severity: "veto", outcome: 0 },
      { objectorLabel: "Visitor behavior", severity: "veto", outcome: 0 },
    ];
    const tallies = buildObjectionTrackRecord(observations);
    expect(buildObjectionTrackRecordLine(tallies)).toBeNull();
  });

  it("handles a zero-right record honestly (never divides oddly or says 'right 0 times')", () => {
    const observations: ObjectionObservation[] = Array.from({ length: 5 }, () => ({
      objectorLabel: "Search demand",
      severity: "downgrade" as const,
      outcome: 1 as const,
    }));
    const tallies = buildObjectionTrackRecord(observations);
    const line = buildObjectionTrackRecordLine(tallies);
    expect(line).toBe("Search demand objected five times this quarter and was not right yet.");
    expectCleanCopy(line!);
  });

  it("picks the objector with the most objections among those clearing the bar", () => {
    const observations: ObjectionObservation[] = [
      ...Array.from({ length: 5 }, () => ({ objectorLabel: "Search demand", severity: "downgrade" as const, outcome: 0 as const })),
      ...Array.from({ length: 9 }, () => ({ objectorLabel: "Visitor behavior", severity: "veto" as const, outcome: 1 as const })),
    ];
    const tallies = buildObjectionTrackRecord(observations);
    const line = buildObjectionTrackRecordLine(tallies);
    expect(line).toContain("Visitor behavior objected nine times");
  });

  it("empty tallies yield a null line", () => {
    expect(buildObjectionTrackRecordLine([])).toBeNull();
  });
});
