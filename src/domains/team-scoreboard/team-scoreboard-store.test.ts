/**
 * team-scoreboard-store (2026-07-02, master plan item 38).
 *
 * Round-trip on an in-memory json-store (same discipline as algorithm-weather-store.test.ts) + the
 * registration pins that make the store real: GLOBAL classification (measure-pass tail, rows carry
 * tenant_id) and the Supabase mirror entry (Vercel durability).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

let stored: unknown[] = [];
vi.mock("@/lib/persistence/json-store", () => ({
  readStore: async () => stored,
  writeStore: async (_name: string, data: unknown[]) => {
    stored = data;
  },
}));

import { writeTeamScoreboard, loadTeamScoreboard, type TeamScoreboardSnapshot } from "./team-scoreboard-store";
import { classifyStore } from "@/lib/persistence/store-classification";

const NOW = "2026-07-02T12:00:00.000Z";

function snapshot(over: Partial<TeamScoreboardSnapshot> = {}): TeamScoreboardSnapshot {
  return {
    tenant_id: "tenant-a",
    computed_at: NOW,
    total_settled: 6,
    settled_joined: 6,
    specialists: [
      {
        specialist: "gsc",
        overall: { won: 5, flat: 1, lost: 0, n: 6, brier: 0.1, calibrationNote: null },
        by_family: { title: { won: 5, flat: 1, lost: 0, n: 6, brier: 0.1, calibrationNote: null } },
      },
    ],
    ...over,
  };
}

beforeEach(() => {
  stored = [];
});

describe("registration pins", () => {
  it("team-scoreboard is a GLOBAL store (measure-pass tail fan-out; rows carry tenant_id)", () => {
    expect(classifyStore("team-scoreboard")).toBe("global");
  });

  it("team-scoreboard is Supabase-mirrored (survives Vercel read-only fs)", () => {
    const src = readFileSync(resolve(__dirname, "../../lib/persistence/json-store.ts"), "utf8");
    const mirrorBlock = src.slice(src.indexOf("SUPABASE_MIRRORED_STORES"), src.indexOf("BLOBS_TABLE"));
    expect(mirrorBlock).toContain('"team-scoreboard"');
  });
});

describe("round-trip", () => {
  it("writes the latest recompute and reads it back for the same tenant", async () => {
    await writeTeamScoreboard(snapshot());
    const back = await loadTeamScoreboard("tenant-a");
    expect(back?.total_settled).toBe(6);
    expect(back?.specialists).toHaveLength(1);
    expect(back?.specialists[0]!.specialist).toBe("gsc");
  });

  it("latest write wins per tenant; other tenants are untouched", async () => {
    await writeTeamScoreboard(snapshot({ tenant_id: "tenant-b", specialists: [] }));
    await writeTeamScoreboard(snapshot({ computed_at: "2026-07-01T00:00:00.000Z", total_settled: 3 }));
    await writeTeamScoreboard(snapshot({ computed_at: "2026-07-02T00:00:00.000Z", total_settled: 9 }));
    expect(stored).toHaveLength(2); // tenant-a's second write REPLACED the first, not appended
    const back = await loadTeamScoreboard("tenant-a");
    expect(back?.total_settled).toBe(9);
    const other = await loadTeamScoreboard("tenant-b");
    expect(other?.specialists).toEqual([]);
  });

  it("an empty specialists array round-trips (recomputed, nothing settled yet is a real state)", async () => {
    await writeTeamScoreboard(snapshot({ specialists: [], total_settled: 0, settled_joined: 0 }));
    const back = await loadTeamScoreboard("tenant-a");
    expect(back).not.toBeNull();
    expect(back?.specialists).toEqual([]);
  });

  it("unknown tenant reads as absent", async () => {
    await writeTeamScoreboard(snapshot());
    expect(await loadTeamScoreboard("tenant-z")).toBeNull();
  });

  it("recompute is idempotent: writing the identical snapshot twice yields the same read", async () => {
    await writeTeamScoreboard(snapshot());
    await writeTeamScoreboard(snapshot());
    const back = await loadTeamScoreboard("tenant-a");
    expect(back).toEqual(snapshot());
  });
});

describe("item 43 - accountability fields are additive", () => {
  it("a snapshot written WITHOUT calibration_bands/objections (an old row) still parses cleanly", async () => {
    // Simulates a row persisted before item 43 shipped: no calibration_bands on the specialist, no
    // top-level objections key at all.
    stored = [
      {
        tenant_id: "tenant-old",
        computed_at: NOW,
        total_settled: 3,
        settled_joined: 3,
        specialists: [{ specialist: "gsc", overall: { won: 2, flat: 1, lost: 0, n: 3, brier: 0.1, calibrationNote: null }, by_family: {} }],
      },
    ];
    const back = await loadTeamScoreboard("tenant-old");
    expect(back).not.toBeNull();
    expect(back?.specialists[0]!.calibration_bands).toBeUndefined();
    expect(back?.objections).toBeUndefined();
  });

  it("round-trips calibration_bands and objections when a fresh recompute writes them", async () => {
    const withAccountability = snapshot({
      specialists: [
        {
          specialist: "gsc",
          overall: { won: 5, flat: 1, lost: 0, n: 6, brier: 0.1, calibrationNote: null },
          by_family: {},
          calibration_bands: [
            { band: "60-70", n: 0, won: 0, winRatePct: null },
            { band: "70-80", n: 0, won: 0, winRatePct: null },
            { band: "80-90", n: 6, won: 5, winRatePct: 83 },
            { band: "90+", n: 0, won: 0, winRatePct: null },
          ],
        },
      ],
      objections: [{ objectorLabel: "Visitor behavior", objected: 4, right: 2, wrong: 2 }],
    });
    await writeTeamScoreboard(withAccountability);
    const back = await loadTeamScoreboard("tenant-a");
    expect(back?.specialists[0]!.calibration_bands).toHaveLength(4);
    expect(back?.objections).toEqual([{ objectorLabel: "Visitor behavior", objected: 4, right: 2, wrong: 2 }]);
  });
});
