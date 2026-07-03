/**
 * CumulativeOutcomeStrip (FP8) - render pins for THE cumulative outcome strip shared
 * by Today and Results. Two states matter: wins exist (value asserted in measured
 * clicks, plus the clearly-labeled dollar estimate when one exists) and zero final
 * reads (the honest frame with the real first-verdict date, never a bare
 * "we don't know yet").
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CumulativeOutcomeStrip } from "./cumulative-outcome-strip";
import {
  computeCumulativeOutcome,
  type CumulativeOutcomeRow,
} from "@/domains/proof-gsc/cumulative-outcome";

const NOW = new Date("2026-07-02T12:00:00Z");

const WON: CumulativeOutcomeRow = {
  id: "won-1",
  path: "/best-persian-restaurants",
  shippedAt: "2026-05-20T00:00:00Z",
  verdict: "won",
  windows: [
    { day: 7, ran: true, controlsUsed: 3, adjustedLift: 20 },
    { day: 14, ran: true, controlsUsed: 3, adjustedLift: 41 },
    { day: 28, ran: true, controlsUsed: 3, adjustedLift: 84 },
  ],
  baseline: { impressions: 1200 },
  dollarValue: { usdPerMonth: 42 },
};

const MEASURING: CumulativeOutcomeRow = {
  id: "meas-1",
  path: "/persian-new-year",
  shippedAt: "2026-06-20T00:00:00Z",
  verdict: "measuring",
  windows: [
    { day: 7, ran: false },
    { day: 14, ran: false },
    { day: 28, ran: false },
  ],
  baseline: { impressions: 500 },
};

describe("CumulativeOutcomeStrip", () => {
  it("asserts the cumulative value when wins exist: counts, measured clicks, estimate", () => {
    const outcome = computeCumulativeOutcome(
      [WON, MEASURING, { ...MEASURING, id: "meas-2", path: "/persian-tea" }],
      NOW,
    );
    const html = renderToStaticMarkup(<CumulativeOutcomeStrip outcome={outcome} />);
    expect(html).toContain(
      "You have shipped 3 changes. 1 has a final read (1 win), and 2 are still measuring below.",
    );
    expect(html).toContain(
      "Your win is adding about 90 extra clicks a month, measured against similar pages we did not change.",
    );
    expect(html).toContain(
      "At your rate, that is about $42 a month. This is an estimate, your rate times the extra visits the win earned, not measured revenue.",
    );
  });

  it("renders the honest zero-verdict frame with the real first-verdict date", () => {
    const outcome = computeCumulativeOutcome(
      [MEASURING, { ...MEASURING, id: "meas-2", path: "/persian-tea", shippedAt: "2026-06-25T00:00:00Z" }],
      NOW,
    );
    const html = renderToStaticMarkup(<CumulativeOutcomeStrip outcome={outcome} />);
    expect(html).toContain("You have shipped 2 changes, all still measuring below.");
    expect(html).toContain(
      "No final verdicts yet. The first one lands around Jul 18 when the earliest 28-day window closes.",
    );
    expect(html).not.toContain("$"); // no GA4 value data -> no money, ever
  });

  it("omits the dollar line when no won change carries a dollar rate", () => {
    const outcome = computeCumulativeOutcome([{ ...WON, dollarValue: null }, MEASURING], NOW);
    const html = renderToStaticMarkup(<CumulativeOutcomeStrip outcome={outcome} />);
    expect(html).toContain("adding about 90 extra clicks a month");
    expect(html).not.toContain("$");
  });

  it("self-hides with no outcome", () => {
    expect(renderToStaticMarkup(<CumulativeOutcomeStrip outcome={null} />)).toBe("");
  });

  it("never emits an em or en dash", () => {
    const outcome = computeCumulativeOutcome([WON, MEASURING], NOW);
    const html = renderToStaticMarkup(<CumulativeOutcomeStrip outcome={outcome} />);
    expect(html).not.toMatch(/[–—]/);
  });
});
