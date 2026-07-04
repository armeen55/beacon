/**
 * TodayWhileAwayCard (P21, v1 238) - render pins for the one honest catch-up block:
 * it quotes the assembled sentence, celebrates a win, points at the right surface, and
 * carries no em/en dash.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TodayWhileAwayCard } from "./today-while-away-card";

describe("TodayWhileAwayCard", () => {
  it("renders the sentence and links to Results when something finished measuring", () => {
    const html = renderToStaticMarkup(
      <TodayWhileAwayCard
        summary={{
          sentence:
            "While you were away: 2 changes finished measuring (1 won, up about 38 clicks a month), and 3 new opportunities appeared.",
          finishedMeasuring: 2,
          wonCount: 1,
          newOpportunities: 3,
        }}
        checkedLine="From your results and open changes, counted just now."
      />,
    );
    expect(html).toContain("While you were away: 2 changes finished measuring");
    expect(html).toContain("up about 38 clicks a month");
    expect(html).toContain("3 new opportunities appeared");
    expect(html).toContain('href="/results"');
    expect(html).toContain("See the results");
    expect(html).toContain("From your results and open changes, counted just now.");
  });

  it("points at the worklist when only new opportunities appeared", () => {
    const html = renderToStaticMarkup(
      <TodayWhileAwayCard
        summary={{
          sentence: "While you were away: 2 new opportunities appeared.",
          finishedMeasuring: 0,
          wonCount: 0,
          newOpportunities: 2,
        }}
      />,
    );
    expect(html).toContain('href="/worklist"');
    expect(html).toContain("See what is new");
  });

  it("never emits an em or en dash", () => {
    const html = renderToStaticMarkup(
      <TodayWhileAwayCard
        summary={{
          sentence: "While you were away: 1 change finished measuring (1 won).",
          finishedMeasuring: 1,
          wonCount: 1,
          newOpportunities: 0,
        }}
      />,
    );
    expect(html).not.toMatch(/[‒–—―]/);
  });
});
