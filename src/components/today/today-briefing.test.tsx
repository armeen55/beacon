import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { TodayGoalPaceCard, StillArriving } from "./today-briefing";
import { readStillArriving } from "./today-still-arriving";

/** Strip tags so we can assert on the plain rendered copy an operator would read. */
function text(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&rarr;|→/g, "->")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Wave 3B (2026-07-10): the TodayLeadHeadlineCard and TodaySmokeAlarmCard render pins were
// removed with the cards themselves - both are now subsumed by the ONE Today command, pinned in
// today-command-card.test.tsx. Only the surviving slot-6 briefing cards are pinned here.

describe("TodayGoalPaceCard render", () => {
  it("renders the pace read, the ritual step, and a receipt line", () => {
    const markup = renderToStaticMarkup(
      <TodayGoalPaceCard
        pace={{
          paceClause: "You have shipped 3 of your 5 changes this week. Two left.",
          ritualClause: "Start your day: open the top change on /cities, ship it, then check yesterday's numbers. About 20 minutes.",
          href: "#daily-experiments",
          actionLabel: "Start with tonight's plan",
          progress: 0.6,
          onTrack: false,
        }}
        checkedLine="From your shipped-change ledger, counted just now."
      />,
    );
    const t = text(markup);
    expect(t).toContain("You have shipped 3 of your 5 changes this week. Two left.");
    expect(t).toContain("Start your day: open the top change on /cities");
    expect(t).toContain("About 20 minutes.");
    expect(t).toContain("From your shipped-change ledger, counted just now.");
    expect(markup).toContain('role="progressbar"');
    expect(markup).not.toMatch(/[‒–—―]/);
  });

  it("shows the On track pill when the goal is met", () => {
    const markup = renderToStaticMarkup(
      <TodayGoalPaceCard
        pace={{
          paceClause: "You have shipped 5 of your 5 changes this week. Goal met.",
          ritualClause: "Start your day: nothing is queued, so peek at the two changes still measuring, then pick tomorrow's move. About 20 minutes.",
          href: "/results",
          actionLabel: "See what is measuring",
          progress: 1,
          onTrack: true,
        }}
      />,
    );
    expect(text(markup)).toContain("On track");
  });
});

describe("StillArriving render", () => {
  it("renders a soft label for a not-yet-final number", () => {
    const markup = renderToStaticMarkup(<StillArriving read={readStillArriving("early_checkpoint", "2026-07-18")} />);
    expect(text(markup)).toBe("still measuring, final read around Jul 18");
  });

  it("renders nothing once the number is final", () => {
    const markup = renderToStaticMarkup(<StillArriving read={readStillArriving("mature_result")} />);
    expect(markup).toBe("");
  });
});
