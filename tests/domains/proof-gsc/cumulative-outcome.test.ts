import { describe, expect, it } from "vitest";

import {
  computeCumulativeOutcome,
  type CumulativeOutcomeRow,
} from "@/domains/proof-gsc/cumulative-outcome";

/**
 * cumulative-outcome (FP8) - pins the ONE aggregation behind the cumulative outcome
 * strip on Today and Results: counts reuse the lifecycle band split, the monthly
 * click figure is the sum of won changes' MEASURED basis-window deltas (never
 * invented), the zero-verdict frame names the REAL earliest 28-day close date, and
 * money appears only when a won row already carries a computed dollar rate.
 */

const NOW = new Date("2026-07-02T12:00:00Z");

function wonRow(overrides: Partial<CumulativeOutcomeRow> & { id: string; path: string }): CumulativeOutcomeRow {
  return {
    shippedAt: "2026-05-20T00:00:00Z",
    verdict: "won",
    windows: [
      { day: 7, ran: true, controlsUsed: 3, adjustedLift: 20 },
      { day: 14, ran: true, controlsUsed: 3, adjustedLift: 41 },
      { day: 28, ran: true, controlsUsed: 3, adjustedLift: 84 },
    ],
    baseline: { impressions: 1200 },
    ...overrides,
  };
}

function measuringRow(overrides: Partial<CumulativeOutcomeRow> & { id: string; path: string }): CumulativeOutcomeRow {
  return {
    shippedAt: "2026-06-20T00:00:00Z",
    verdict: "measuring",
    windows: [
      { day: 7, ran: false },
      { day: 14, ran: false },
      { day: 28, ran: false },
    ],
    baseline: { impressions: 500 },
    ...overrides,
  };
}

describe("computeCumulativeOutcome - win with a measured monthly click lift", () => {
  it("sums each won change's own measured basis-window delta as a monthly rate", () => {
    const rows: CumulativeOutcomeRow[] = [
      // 84 extra clicks over the 28-day basis window -> 90 a month.
      wonRow({ id: "a", path: "/a" }),
      // A second win judged at its 28-day basis with +42 clicks -> 45 a month.
      wonRow({
        id: "b",
        path: "/b",
        windows: [
          { day: 7, ran: true, controlsUsed: 2, adjustedLift: 9 },
          { day: 14, ran: true, controlsUsed: 2, adjustedLift: 18 },
          { day: 28, ran: true, controlsUsed: 2, adjustedLift: 42 },
        ],
      }),
      measuringRow({ id: "c", path: "/c" }),
    ];
    const out = computeCumulativeOutcome(rows, NOW)!;
    expect(out.shipped).toBe(3);
    expect(out.won).toBe(2);
    expect(out.decided).toBe(2);
    expect(out.measuring).toBe(1);
    expect(out.winClicksPerMonth).toBe(135); // 90 + 45, measured deltas only
    expect(out.valueLine).toBe(
      "Together your 2 wins are adding about 135 extra clicks a month, measured against similar pages we did not change.",
    );
    expect(out.waitingLine).toBeNull();
  });

  it("uses singular phrasing for exactly one win", () => {
    const out = computeCumulativeOutcome([wonRow({ id: "a", path: "/a" })], NOW)!;
    expect(out.valueLine).toBe(
      "Your win is adding about 90 extra clicks a month, measured against similar pages we did not change.",
    );
  });

  it("never invents a click figure: a won row without a measured delta contributes 0", () => {
    const out = computeCumulativeOutcome(
      [
        wonRow({
          id: "a",
          path: "/a",
          windows: [{ day: 28, ran: true, controlsUsed: 3 }], // legacy row, no adjustedLift
        }),
      ],
      NOW,
    )!;
    expect(out.won).toBe(1);
    expect(out.winClicksPerMonth).toBe(0);
    expect(out.valueLine).toBeNull(); // no measured clicks sum -> no claim
  });
});

describe("computeCumulativeOutcome - honest zero-verdict frame", () => {
  it("names the REAL date the earliest still-measuring 28-day window closes", () => {
    const rows: CumulativeOutcomeRow[] = [
      measuringRow({ id: "a", path: "/a", shippedAt: "2026-06-20T00:00:00Z" }), // closes Jul 18
      measuringRow({ id: "b", path: "/b", shippedAt: "2026-06-25T00:00:00Z" }), // closes Jul 23
    ];
    const out = computeCumulativeOutcome(rows, NOW)!;
    expect(out.decided).toBe(0);
    expect(out.firstVerdictOn).toBe("2026-07-18");
    expect(out.waitingLine).toBe(
      "No final verdicts yet. The first one lands around Jul 18 when the earliest 28-day window closes.",
    );
    expect(out.valueLine).toBeNull();
    expect(out.dollarLine).toBeNull();
  });

  it("says it is waiting on Google's data when every 28-day close date already passed", () => {
    const rows: CumulativeOutcomeRow[] = [
      measuringRow({ id: "a", path: "/a", shippedAt: "2026-05-01T00:00:00Z" }), // closed May 29
    ];
    const out = computeCumulativeOutcome(rows, NOW)!;
    expect(out.firstVerdictOn).toBe("2026-05-29");
    expect(out.waitingLine).toBe(
      "No final verdicts yet. The earliest 28-day window has already closed, so the first one lands as soon as Google's data catches up.",
    );
  });

  it("drops the waiting frame once anything has a final read", () => {
    const rows: CumulativeOutcomeRow[] = [
      wonRow({ id: "a", path: "/a" }),
      measuringRow({ id: "b", path: "/b" }),
    ];
    expect(computeCumulativeOutcome(rows, NOW)!.waitingLine).toBeNull();
  });
});

describe("computeCumulativeOutcome - money is never faked", () => {
  it("omits the dollar line entirely when no won row carries a dollar rate (no GA4 value data)", () => {
    const out = computeCumulativeOutcome(
      [wonRow({ id: "a", path: "/a" }), wonRow({ id: "b", path: "/b", dollarValue: { usdPerMonth: null } })],
      NOW,
    )!;
    expect(out.estimatedUsdPerMonth).toBeNull();
    expect(out.dollarLine).toBeNull();
  });

  it("sums real per-win dollar rates and labels the line as an estimate with its basis", () => {
    const out = computeCumulativeOutcome(
      [
        wonRow({ id: "a", path: "/a", dollarValue: { usdPerMonth: 30 } }),
        wonRow({ id: "b", path: "/b", dollarValue: { usdPerMonth: 12.5 } }),
      ],
      NOW,
    )!;
    expect(out.estimatedUsdPerMonth).toBe(42.5);
    expect(out.dollarLine).toBe(
      "At your rate, that is about $43 a month. This is an estimate, your rate times the extra visits the wins earned, not measured revenue.",
    );
  });

  it("omits the dollar line when the summed rate is not positive", () => {
    const out = computeCumulativeOutcome(
      [wonRow({ id: "a", path: "/a", dollarValue: { usdPerMonth: -5 } })],
      NOW,
    )!;
    expect(out.dollarLine).toBeNull();
  });
});

describe("computeCumulativeOutcome - posture", () => {
  it("returns null for an empty ledger (the strip self-hides)", () => {
    expect(computeCumulativeOutcome([], NOW)).toBeNull();
  });

  it("keeps an early-read win out of the decided counts (band rule reuse)", () => {
    // Only the 7-day window ran: the lifecycle split classifies it as measuring,
    // so the strip can never celebrate a 7-day read as a final win.
    const out = computeCumulativeOutcome(
      [
        wonRow({
          id: "a",
          path: "/a",
          shippedAt: "2026-06-24T00:00:00Z",
          windows: [
            { day: 7, ran: true, controlsUsed: 3, adjustedLift: 30 },
            { day: 14, ran: false },
            { day: 28, ran: false },
          ],
        }),
      ],
      NOW,
    )!;
    expect(out.won).toBe(0);
    expect(out.measuring).toBe(1);
    expect(out.winClicksPerMonth).toBe(0);
    expect(out.waitingLine).toBe(
      "No final verdicts yet. The first one lands around Jul 22 when the earliest 28-day window closes.",
    );
  });

  it("never emits an em or en dash in any sentence", () => {
    const outs = [
      computeCumulativeOutcome([wonRow({ id: "a", path: "/a", dollarValue: { usdPerMonth: 30 } })], NOW)!,
      computeCumulativeOutcome([measuringRow({ id: "b", path: "/b" })], NOW)!,
    ];
    for (const out of outs) {
      for (const s of [out.valueLine, out.waitingLine, out.dollarLine]) {
        if (s != null) expect(s).not.toMatch(/[–—]/);
      }
    }
  });
});
