/**
 * beacon-learned-tile.test.tsx (R23 P15) - render-shape test (renderToStaticMarkup,
 * repo convention, no jsdom). Pins: self-hide when the sentence is null, the
 * quoted learned line + receipt when it is present, tokens only, no dashes.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { BeaconLearnedTile } from "./beacon-learned-tile";
import { buildBeaconLearnedSummary } from "./beacon-learned-summary";
import type { SettledOutcome } from "@/domains/learning/experiment-prior";

const BANNED_DASH = /[\u2012\u2013\u2014\u2015]/;

function outcome(verdict: string, actionType: string): SettledOutcome {
  return { verdict, operatorVerdictOverride: null, dims: { actionType } };
}

describe("BeaconLearnedTile", () => {
  it("renders NOTHING when the summary self-hides (fresh tenant)", () => {
    const summary = buildBeaconLearnedSummary([outcome("won", "answer_block")]);
    const html = renderToStaticMarkup(<BeaconLearnedTile summary={summary} />);
    expect(html).toBe("");
  });

  it("renders the learned line + receipt on the quiet card, tokens only, no dashes", () => {
    const outcomes: SettledOutcome[] = [
      ...Array.from({ length: 4 }, () => outcome("won", "answer_block")),
      outcome("lost", "answer_block"),
      ...Array.from({ length: 3 }, () => outcome("lost", "edit_page")),
    ];
    const summary = buildBeaconLearnedSummary(outcomes);
    const html = renderToStaticMarkup(<BeaconLearnedTile summary={summary} />);
    expect(html).toContain('data-tile="beacon-learned"');
    expect(html).toContain('data-variant="quiet"');
    expect(html).toContain("What Beacon learned");
    expect(html).toContain("I&#x27;ve learned your answer-block changes win most often (4 of 5 measured)");
    expect(html).toContain("have not moved the needle (0 of 3)");
    expect(html).toContain("From 8 of your changes that have finished measuring.");
    expect(html).not.toMatch(BANNED_DASH);
  });
});
