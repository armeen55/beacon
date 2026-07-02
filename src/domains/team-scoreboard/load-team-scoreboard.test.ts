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

import { loadTeamScoreboardView, loadSpecialistRecordLine, MIN_SETTLED_FOR_STANDUP_FOOTER } from "./load-team-scoreboard";
import type { TeamScoreboardSnapshot } from "./team-scoreboard-store";

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
