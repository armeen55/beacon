/**
 * load-team-scoreboard (2026-07-02, master plan item 38).
 *
 * Pins the surface contract for the Today standup footer: silence below 5 settled-and-joined
 * picks, a real best-forecaster line once the bar is cleared, and fail-soft on a store error.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

let snapshot: Record<string, unknown> | null = null;
vi.mock("./team-scoreboard-store", () => ({
  loadTeamScoreboard: async () => snapshot,
}));

import {
  loadTeamScoreboardView,
  loadSpecialistRecordLine,
  loadSpecialistCalibrationLine,
  loadObjectionTrackRecord,
  MIN_SETTLED_FOR_STANDUP_FOOTER,
} from "./load-team-scoreboard";
import type { TeamScoreboardSnapshot } from "./team-scoreboard-store";
import type { BandTally } from "./calibration";

function fullBands(over: Partial<Record<BandTally["band"], Partial<BandTally>>> = {}): BandTally[] {
  const base: Record<BandTally["band"], BandTally> = {
    "60-70": { band: "60-70", n: 0, won: 0, winRatePct: null },
    "70-80": { band: "70-80", n: 0, won: 0, winRatePct: null },
    "80-90": { band: "80-90", n: 0, won: 0, winRatePct: null },
    "90+": { band: "90+", n: 0, won: 0, winRatePct: null },
  };
  for (const [band, patch] of Object.entries(over)) {
    base[band as BandTally["band"]] = { ...base[band as BandTally["band"]], ...patch };
  }
  return Object.values(base);
}

function tally(over: Partial<{ won: number; flat: number; lost: number; n: number; brier: number | null }> = {}) {
  return { won: 5, flat: 1, lost: 0, n: 6, brier: 0.08, calibrationNote: null, ...over };
}

function snap(over: Partial<TeamScoreboardSnapshot> = {}): TeamScoreboardSnapshot {
  return {
    tenant_id: "iranopedia",
    computed_at: "2026-07-02T00:00:00.000Z",
    total_settled: 6,
    settled_joined: 6,
    specialists: [{ specialist: "gsc", overall: tally(), by_family: { title: tally() } }],
    ...over,
  };
}

beforeEach(() => {
  snapshot = null;
});

describe("loadTeamScoreboardView", () => {
  it("returns null when the scoreboard has never run", async () => {
    expect(await loadTeamScoreboardView("iranopedia")).toBeNull();
  });

  it("is silent (no footer line) below the 5 settled-and-joined minimum, per the surface contract", async () => {
    snapshot = snap({ settled_joined: 4 });
    const view = await loadTeamScoreboardView("iranopedia");
    expect(view).not.toBeNull();
    expect(view!.footerLine).toBeNull();
  });

  it("names the real best forecaster once 5+ settled-and-joined picks exist", async () => {
    snapshot = snap({ settled_joined: MIN_SETTLED_FOR_STANDUP_FOOTER });
    const view = await loadTeamScoreboardView("iranopedia");
    expect(view!.footerLine).toBe(
      "The Search demand teammate has called 5 of 6 winners right this quarter - the sharpest eye on the team right now.",
    );
    expect(view!.footerLine).not.toMatch(/[‒–—―]/);
  });

  it("stays silent when settled_joined clears 5 but no specialist individually clears the footer's own sample bar", async () => {
    snapshot = snap({
      settled_joined: MIN_SETTLED_FOR_STANDUP_FOOTER,
      specialists: [
        { specialist: "gsc", overall: tally({ n: 2, won: 2 }), by_family: {} },
        { specialist: "clarity", overall: tally({ n: 3, won: 1 }), by_family: {} },
      ],
    });
    const view = await loadTeamScoreboardView("iranopedia");
    expect(view!.footerLine).toBeNull();
  });

  it("fail-soft: a throwing store read yields null, never throws", async () => {
    const mod = await import("./team-scoreboard-store");
    const spy = vi.spyOn(mod, "loadTeamScoreboard").mockRejectedValueOnce(new Error("down"));
    expect(await loadTeamScoreboardView("iranopedia")).toBeNull();
    spy.mockRestore();
  });
});

describe("loadSpecialistRecordLine", () => {
  it("returns the specialist's plain won-of-n record", async () => {
    snapshot = snap();
    expect(await loadSpecialistRecordLine("iranopedia", "gsc")).toBe("5 of 6");
  });

  it("returns null for a specialist with no row in the scoreboard", async () => {
    snapshot = snap();
    expect(await loadSpecialistRecordLine("iranopedia", "ga4")).toBeNull();
  });

  it("returns null when the scoreboard has never run", async () => {
    expect(await loadSpecialistRecordLine("iranopedia", "gsc")).toBeNull();
  });
});

describe("loadTeamScoreboardView - calibration line (item 43)", () => {
  it("names the best-observed specialist's calibration once it clears the 5-observation bar", async () => {
    snapshot = snap({
      settled_joined: 6,
      specialists: [
        {
          specialist: "gsc",
          overall: tally(),
          by_family: {},
          calibration_bands: fullBands({ "80-90": { n: 6, won: 5, winRatePct: 83 } }),
        },
      ],
    });
    const view = await loadTeamScoreboardView("iranopedia");
    expect(view!.calibrationLine).toBe("Search demand argues at 80 percent conviction and is right 83 percent of the time.");
    expect(view!.calibrationLine).not.toMatch(/[‒–—―]/);
  });

  it("is null when no specialist has calibration_bands yet (a pre-item-43 snapshot)", async () => {
    snapshot = snap(); // default fixture has no calibration_bands key at all
    const view = await loadTeamScoreboardView("iranopedia");
    expect(view!.calibrationLine).toBeNull();
  });

  it("is null when every band is too thin (small-n honesty carried through the view)", async () => {
    snapshot = snap({
      specialists: [
        { specialist: "gsc", overall: tally(), by_family: {}, calibration_bands: fullBands({ "80-90": { n: 2, won: 2, winRatePct: 100 } }) },
      ],
    });
    const view = await loadTeamScoreboardView("iranopedia");
    expect(view!.calibrationLine).toBeNull();
  });

  it("picks the specialist with the most total banded observations", async () => {
    snapshot = snap({
      specialists: [
        { specialist: "gsc", overall: tally(), by_family: {}, calibration_bands: fullBands({ "70-80": { n: 5, won: 4, winRatePct: 80 } }) },
        { specialist: "clarity", overall: tally(), by_family: {}, calibration_bands: fullBands({ "80-90": { n: 12, won: 9, winRatePct: 75 } }) },
      ],
    });
    const view = await loadTeamScoreboardView("iranopedia");
    expect(view!.calibrationLine).toContain("Visitor behavior");
  });
});

describe("loadTeamScoreboardView - objection track record (item 43)", () => {
  it("names the top objector once it clears the 5-objection bar", async () => {
    snapshot = snap({ objections: [{ objectorLabel: "Visitor behavior", objected: 5, right: 2, wrong: 3 }] });
    const view = await loadTeamScoreboardView("iranopedia");
    expect(view!.objectionLine).toBe("Visitor behavior objected five times this quarter and was right twice.");
    expect(view!.objectionLine).not.toMatch(/[‒–—―]/);
  });

  it("is null when nothing has ever shipped over an objection (a pre-item-43 snapshot, or a real zero)", async () => {
    snapshot = snap(); // no objections key
    const view = await loadTeamScoreboardView("iranopedia");
    expect(view!.objectionLine).toBeNull();
  });

  it("is null below the 5-objection minimum", async () => {
    snapshot = snap({ objections: [{ objectorLabel: "Visitor behavior", objected: 3, right: 1, wrong: 2 }] });
    const view = await loadTeamScoreboardView("iranopedia");
    expect(view!.objectionLine).toBeNull();
  });
});

describe("loadSpecialistCalibrationLine", () => {
  it("returns one specialist's own calibration line", async () => {
    snapshot = snap({
      specialists: [
        { specialist: "gsc", overall: tally(), by_family: {}, calibration_bands: fullBands({ "80-90": { n: 6, won: 5, winRatePct: 83 } }) },
      ],
    });
    expect(await loadSpecialistCalibrationLine("iranopedia", "gsc")).toBe(
      "Search demand argues at 80 percent conviction and is right 83 percent of the time.",
    );
  });

  it("returns null for a specialist with no calibration_bands", async () => {
    snapshot = snap();
    expect(await loadSpecialistCalibrationLine("iranopedia", "gsc")).toBeNull();
  });

  it("returns null when the scoreboard has never run", async () => {
    expect(await loadSpecialistCalibrationLine("iranopedia", "gsc")).toBeNull();
  });
});

describe("loadObjectionTrackRecord", () => {
  it("returns the full tenant-wide objection tallies", async () => {
    snapshot = snap({
      objections: [
        { objectorLabel: "Visitor behavior", objected: 4, right: 2, wrong: 2 },
        { objectorLabel: "Search demand", objected: 6, right: 1, wrong: 5 },
      ],
    });
    const record = await loadObjectionTrackRecord("iranopedia");
    expect(record).toHaveLength(2);
  });

  it("returns an empty array when the scoreboard has never run", async () => {
    expect(await loadObjectionTrackRecord("iranopedia")).toEqual([]);
  });

  it("fail-soft: a throwing store read yields an empty array, never throws", async () => {
    const mod = await import("./team-scoreboard-store");
    const spy = vi.spyOn(mod, "loadTeamScoreboard").mockRejectedValueOnce(new Error("down"));
    expect(await loadObjectionTrackRecord("iranopedia")).toEqual([]);
    spy.mockRestore();
  });
});
