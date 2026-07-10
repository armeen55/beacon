/**
 * CumulativeOutcomeStrip (FP8) - render pins for THE cumulative outcome strip shared
 * by Today and Results. Two states matter: wins exist (value asserted in measured
 * clicks, plus the clearly-labeled dollar estimate when one exists) and zero final
 * reads (the honest frame with the real first-verdict date, never a bare
 * "we don't know yet").
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CumulativeOutcomeStrip, latestMeasuredAt } from "./cumulative-outcome-strip";
import {
  computeCumulativeOutcome,
  type CumulativeOutcomeRow,
} from "@/domains/proof-gsc/cumulative-outcome";
import {
  buildWonDollarBreakdown,
  WON_DOLLAR_RULE_SENTENCE,
} from "@/domains/proof-gsc/won-dollar-rule";

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
  // THE ONE DOLLAR RULE (won-dollar-rule.ts): a dollar figure only counts when the
  // win has a ran GA4 traffic outcome with a positive control-adjusted rate.
  trafficOutcome: {
    ran: true,
    windowDays: 28,
    treated: { sessionsPre: 200 },
    adjustedSessionsPct: 0.2,
  },
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
      "You have shipped 3 changes. 1 has a 28-day read (1 win), and 2 are still measuring below.",
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
      "No settled reads yet. The first lands around Jul 18 when the earliest 28-day window closes. Longer confirmation reads come later.",
    );
    expect(html).not.toContain("$"); // no GA4 value data -> no money, ever
  });

  // E-39 review P1-1 (D6 pin): neither strip state may call a 28-day result final.
  it("E-39 review P1-1: never calls a 28-day result final in either strip state", () => {
    const wonOutcome = computeCumulativeOutcome(
      [WON, MEASURING, { ...MEASURING, id: "meas-2", path: "/persian-tea" }],
      NOW,
    );
    const zeroOutcome = computeCumulativeOutcome(
      [MEASURING, { ...MEASURING, id: "meas-2", path: "/persian-tea", shippedAt: "2026-06-25T00:00:00Z" }],
      NOW,
    );
    for (const outcome of [wonOutcome, zeroOutcome]) {
      const html = renderToStaticMarkup(<CumulativeOutcomeStrip outcome={outcome} />);
      expect(html).not.toMatch(/\bfinal\b/i);
    }
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

  // ── R14b see-the-math: the dollar figure opens into per-win rows + the rule ──

  it("opens the dollar line into the per-win rows and THE ONE DOLLAR RULE sentence", () => {
    const rows = [WON, MEASURING];
    const outcome = computeCumulativeOutcome(rows, NOW);
    const breakdown = buildWonDollarBreakdown(rows, NOW, []);
    expect(breakdown).toEqual([{ path: "/best-persian-restaurants", usdPerMonth: 42 }]);
    const html = renderToStaticMarkup(
      <CumulativeOutcomeStrip outcome={outcome} dollarBreakdown={breakdown} />,
    );
    expect(html).toContain("<details");
    expect(html).toContain("See the math.");
    expect(html).toContain("/best-persian-restaurants: about $42 a month");
    expect(html).toContain(WON_DOLLAR_RULE_SENTENCE);
  });

  it("a win row cites behavior corroboration in the expander, one line, only when present (N4)", () => {
    const corroborated = {
      ...WON,
      behaviorOutcome: { compositeVerdict: "better" },
    } as CumulativeOutcomeRow;
    const rows = [corroborated, MEASURING];
    const outcome = computeCumulativeOutcome(rows, NOW);
    const breakdown = buildWonDollarBreakdown(rows, NOW, []);
    const html = renderToStaticMarkup(
      <CumulativeOutcomeStrip outcome={outcome} dollarBreakdown={breakdown} />,
    );
    expect(html).toContain("Visitors also behaved better on this page after the change.");

    // Without corroboration the line is absent - never a filler sentence.
    const plain = buildWonDollarBreakdown([WON, MEASURING], NOW, []);
    const plainHtml = renderToStaticMarkup(
      <CumulativeOutcomeStrip outcome={computeCumulativeOutcome([WON, MEASURING], NOW)} dollarBreakdown={plain} />,
    );
    expect(plainHtml).not.toContain("Visitors also behaved better");
  });

  it("the breakdown rows always sum to the figure the strip shows", () => {
    const secondWin: CumulativeOutcomeRow = {
      ...WON,
      id: "won-2",
      path: "/persian-cats",
      dollarValue: { usdPerMonth: 18.5 },
    };
    const rows = [WON, secondWin, MEASURING];
    const outcome = computeCumulativeOutcome(rows, NOW);
    const breakdown = buildWonDollarBreakdown(rows, NOW, []);
    const sum = breakdown.reduce((s, w) => s + w.usdPerMonth, 0);
    expect(Math.round(sum * 100) / 100).toBe(outcome!.estimatedUsdPerMonth);
  });

  it("a dollar line without a breakdown renders flat (no expander), same as before", () => {
    const outcome = computeCumulativeOutcome([WON, MEASURING], NOW);
    const html = renderToStaticMarkup(<CumulativeOutcomeStrip outcome={outcome} />);
    expect(html).toContain("At your rate, that is about $42 a month.");
    expect(html).not.toContain("<details");
  });

  // ── R14b receipts: the strip carries its one-line receipt ──

  it("renders the one-line receipt when provided", () => {
    const outcome = computeCumulativeOutcome([WON, MEASURING], NOW);
    const html = renderToStaticMarkup(
      <CumulativeOutcomeStrip
        outcome={outcome}
        receiptLine="From your Search Console data, last measured 2 hours ago."
      />,
    );
    expect(html).toContain("data-receipt-line");
    expect(html).toContain("From your Search Console data, last measured 2 hours ago.");
  });

  it("latestMeasuredAt picks the newest valid stamp and ignores garbage", () => {
    expect(
      latestMeasuredAt([
        { ...WON, measuredAt: "2026-07-01T10:00:00Z" },
        { ...MEASURING, measuredAt: "2026-07-02T09:00:00Z" },
        { ...MEASURING, id: "m3", measuredAt: "garbage" },
      ]),
    ).toBe("2026-07-02T09:00:00Z");
    expect(latestMeasuredAt([WON])).toBeNull();
  });
});
