/**
 * today-while-away (P21, v1 238) - pins for the pure while-you-were-away selector:
 * the delta math, the self-hiding rules, the count-agreement contract, and Beacon voice.
 */
import { describe, expect, it } from "vitest";
import { buildWhileAwaySummary } from "./today-while-away";

const NOW = Date.parse("2026-07-10T12:00:00Z");
const AWAY = new Date(NOW - 3 * 24 * 60 * 60 * 1000).toISOString(); // 3 days ago
const RECENT = new Date(NOW - 60 * 60 * 1000).toISOString(); // 1 hour ago

describe("buildWhileAwaySummary", () => {
  it("assembles the full sentence with both lanes and the won click lift", () => {
    const s = buildWhileAwaySummary({
      then: { decided: 4, won: 2, toDo: 10 },
      seenAt: AWAY,
      now: { decided: 6, won: 3, toDo: 13 },
      newWonMonthlyClickLift: 38,
      nowMs: NOW,
    });
    expect(s).not.toBeNull();
    expect(s!.sentence).toBe(
      "While you were away: 2 changes finished measuring (1 won, up about 38 clicks a month), and 3 new opportunities appeared.",
    );
    expect(s!.finishedMeasuring).toBe(2);
    expect(s!.wonCount).toBe(1);
    expect(s!.newOpportunities).toBe(3);
  });

  it("owns a settled-but-none-won return plainly, no false celebration", () => {
    const s = buildWhileAwaySummary({
      then: { decided: 4, won: 2, toDo: 10 },
      seenAt: AWAY,
      now: { decided: 5, won: 2, toDo: 10 },
      newWonMonthlyClickLift: null,
      nowMs: NOW,
    });
    expect(s!.sentence).toBe("While you were away: 1 change finished measuring (none won this time).");
    expect(s!.wonCount).toBe(0);
  });

  it("shows only the opportunities lane when nothing settled", () => {
    const s = buildWhileAwaySummary({
      then: { decided: 4, won: 2, toDo: 10 },
      seenAt: AWAY,
      now: { decided: 4, won: 2, toDo: 12 },
      newWonMonthlyClickLift: null,
      nowMs: NOW,
    });
    expect(s!.sentence).toBe("While you were away: 2 new opportunities appeared.");
    expect(s!.finishedMeasuring).toBe(0);
  });

  it("drops the click-lift figure when no won change carries a measured lift", () => {
    const s = buildWhileAwaySummary({
      then: { decided: 4, won: 2, toDo: 10 },
      seenAt: AWAY,
      now: { decided: 6, won: 3, toDo: 10 },
      newWonMonthlyClickLift: null,
      nowMs: NOW,
    });
    expect(s!.sentence).toBe("While you were away: 2 changes finished measuring (1 won).");
  });

  it("singularizes one change / one opportunity / one click", () => {
    const s = buildWhileAwaySummary({
      then: { decided: 0, won: 0, toDo: 0 },
      seenAt: AWAY,
      now: { decided: 1, won: 1, toDo: 1 },
      newWonMonthlyClickLift: 1,
      nowMs: NOW,
    });
    expect(s!.sentence).toBe(
      "While you were away: 1 change finished measuring (1 won, up about 1 click a month), and 1 new opportunity appeared.",
    );
  });

  it("self-hides on a first-ever visit (no previous mark)", () => {
    expect(
      buildWhileAwaySummary({ then: null, seenAt: null, now: { decided: 6, won: 3, toDo: 13 }, nowMs: NOW }),
    ).toBeNull();
  });

  it("self-hides on a quick refresh (under the away threshold)", () => {
    expect(
      buildWhileAwaySummary({
        then: { decided: 4, won: 2, toDo: 10 },
        seenAt: RECENT,
        now: { decided: 6, won: 3, toDo: 13 },
        nowMs: NOW,
      }),
    ).toBeNull();
  });

  it("self-hides on a quiet return (nothing changed in either lane)", () => {
    expect(
      buildWhileAwaySummary({
        then: { decided: 6, won: 3, toDo: 13 },
        seenAt: AWAY,
        now: { decided: 6, won: 3, toDo: 13 },
        nowMs: NOW,
      }),
    ).toBeNull();
  });

  it("never reports negative news when a count goes down", () => {
    const s = buildWhileAwaySummary({
      then: { decided: 6, won: 3, toDo: 13 },
      seenAt: AWAY,
      now: { decided: 6, won: 3, toDo: 10 }, // opportunities dismissed
      nowMs: NOW,
    });
    // toDo fell to 10; the block must hide, never say "-3 opportunities".
    expect(s).toBeNull();
  });

  it("self-hides on an unparseable last-seen timestamp", () => {
    expect(
      buildWhileAwaySummary({
        then: { decided: 4, won: 2, toDo: 10 },
        seenAt: "not-a-date",
        now: { decided: 6, won: 3, toDo: 13 },
        nowMs: NOW,
      }),
    ).toBeNull();
  });

  it("never emits an em or en dash", () => {
    const s = buildWhileAwaySummary({
      then: { decided: 4, won: 2, toDo: 10 },
      seenAt: AWAY,
      now: { decided: 6, won: 3, toDo: 13 },
      newWonMonthlyClickLift: 38,
      nowMs: NOW,
    });
    expect(s!.sentence).not.toMatch(/[‒–—―]/);
  });

  it("shows the win clicks-a-month figure by default", () => {
    const s = buildWhileAwaySummary({
      then: { decided: 4, won: 2, toDo: 10 },
      seenAt: AWAY,
      now: { decided: 6, won: 3, toDo: 13 },
      newWonMonthlyClickLift: 38,
      nowMs: NOW,
    });
    expect(s!.sentence).toContain("up about 38 clicks a month");
  });

  it("drops the win figure (keeps 'N won') when the lead headline already owns it", () => {
    const s = buildWhileAwaySummary({
      then: { decided: 4, won: 2, toDo: 10 },
      seenAt: AWAY,
      now: { decided: 6, won: 3, toDo: 13 },
      newWonMonthlyClickLift: 38,
      suppressWinFigure: true,
      nowMs: NOW,
    });
    // No second win number for the same wins; still honestly reports "1 won".
    expect(s!.sentence).not.toContain("clicks a month");
    expect(s!.sentence).toContain("1 won");
  });
});
