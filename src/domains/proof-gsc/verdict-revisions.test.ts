import { describe, expect, it } from "vitest";

import {
  appendVerdictRevision,
  buildVerdictRevisionLines,
  isDownwardRevision,
  type VerdictRevision,
} from "./verdict-revisions";

const NOW = new Date("2026-07-19T08:00:00.000Z");

describe("appendVerdictRevision (R14a - append once, never rewrite)", () => {
  it("the FIRST measurement is an announcement, not a revision", () => {
    expect(
      appendVerdictRevision({
        existing: null,
        previousVerdict: "measuring",
        previousMeasuredAt: null, // never measured before
        nextVerdict: "won",
        basisDay: 7,
        overrideApplied: false,
        now: NOW,
      }),
    ).toBeNull();
  });

  it("an unchanged verdict appends NOTHING (re-measure is a no-op)", () => {
    const existing: VerdictRevision[] = [
      { at: "2026-07-10T00:00:00.000Z", from: "won", to: "inconclusive", reason: "the 14-day read" },
    ];
    const next = appendVerdictRevision({
      existing,
      previousVerdict: "inconclusive",
      previousMeasuredAt: "2026-07-10T00:00:00.000Z",
      nextVerdict: "inconclusive",
      basisDay: 28,
      overrideApplied: false,
      now: NOW,
    });
    expect(next).toEqual(existing); // same entries, none added
  });

  it("a real flip appends exactly ONE entry and leaves past entries byte-identical", () => {
    const first: VerdictRevision = {
      at: "2026-07-10T00:00:00.000Z",
      from: "won",
      to: "inconclusive",
      reason: "the 14-day read",
    };
    const next = appendVerdictRevision({
      existing: [first],
      previousVerdict: "inconclusive",
      previousMeasuredAt: "2026-07-10T00:00:00.000Z",
      nextVerdict: "lost",
      basisDay: 28,
      overrideApplied: false,
      now: NOW,
    });
    expect(next).toHaveLength(2);
    expect(next![0]).toEqual(first); // never rewritten
    expect(next![1]).toEqual({
      at: NOW.toISOString(),
      from: "inconclusive",
      to: "lost",
      reason: "the 28-day read",
    });
  });

  it("measuring -> won on a RE-measurement is recorded (an upgrade is still a revision)", () => {
    const next = appendVerdictRevision({
      existing: undefined,
      previousVerdict: "measuring",
      previousMeasuredAt: "2026-07-05T00:00:00.000Z",
      nextVerdict: "won",
      basisDay: 7,
      overrideApplied: false,
      now: NOW,
    });
    expect(next).toEqual([
      { at: NOW.toISOString(), from: "measuring", to: "won", reason: "the 7-day read" },
    ]);
  });

  it("the operator override is named as the reason, not blamed on a read", () => {
    const next = appendVerdictRevision({
      existing: null,
      previousVerdict: "won",
      previousMeasuredAt: "2026-07-05T00:00:00.000Z",
      nextVerdict: "inconclusive",
      basisDay: 28,
      overrideApplied: true,
      now: NOW,
    });
    expect(next![0]!.reason).toBe("you set this result aside from learning");
  });

  it("calling the seam twice with the SAME stored state appends once, not twice (idempotent per change)", () => {
    const args = {
      existing: null,
      previousVerdict: "won" as const,
      previousMeasuredAt: "2026-07-05T00:00:00.000Z",
      nextVerdict: "inconclusive" as const,
      basisDay: 28,
      overrideApplied: false,
      now: NOW,
    };
    const first = appendVerdictRevision(args)!;
    // After persistence the stored verdict now matches, so the same computed
    // verdict appends nothing more - this is the append-once guarantee.
    const second = appendVerdictRevision({
      ...args,
      existing: first,
      previousVerdict: "inconclusive",
    });
    expect(second).toEqual(first);
  });
});

describe("isDownwardRevision (recap membership)", () => {
  it("a retracted win and a slide into hurting are downward", () => {
    expect(isDownwardRevision({ from: "won", to: "inconclusive" })).toBe(true);
    expect(isDownwardRevision({ from: "won", to: "lost" })).toBe(true);
    expect(isDownwardRevision({ from: "measuring", to: "lost" })).toBe(true);
  });
  it("upgrades and sideways moves are not", () => {
    expect(isDownwardRevision({ from: "measuring", to: "won" })).toBe(false);
    expect(isDownwardRevision({ from: "inconclusive", to: "measuring" })).toBe(false);
    expect(isDownwardRevision({ from: "lost", to: "inconclusive" })).toBe(false);
  });
});

describe("buildVerdictRevisionLines (the card copy)", () => {
  it("speaks the owned-plainly first-person sentence with real dates and no dashes", () => {
    const lines = buildVerdictRevisionLines([
      { at: "2026-07-19T08:00:00.000Z", from: "won", to: "inconclusive", reason: "the 28-day read" },
      { at: "2026-07-22T08:00:00.000Z", from: "inconclusive", to: "lost", reason: "the 28-day read" },
    ]);
    expect(lines[0]).toBe(
      "I first called this a win; the 28-day read on 2026-07-19 revised it to no clear effect.",
    );
    expect(lines[1]).toBe(
      "Then the 28-day read on 2026-07-22 revised it from no clear effect to hurting.",
    );
    for (const line of lines) expect(/[‒–—―]/.test(line)).toBe(false);
  });
});
