/**
 * learned-move-line.test.tsx (RANK-1, 2026-07-06) - render-shape test
 * (renderToStaticMarkup, repo convention, no jsdom) for the VISIBLE half of the
 * closed learning loop on a move card:
 *   - self-hides when there is no learned tag (fresh/undecided tenant, coin-flip);
 *   - renders the exact honest "I moved this up because ... won" line the prior
 *     produced (fed through the same tagFor the ranking uses), tokens only;
 *   - never leaks an em/en dash.
 *
 * The tag string is produced by the REAL prior (resolvePrior -> tagFor) so this
 * pins the rendered surface end-to-end, not a hand-written fixture.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { LearnedMoveLine } from "./learned-move-line";
import {
  computeDimPriors,
  resolvePrior,
  type SettledOutcome,
} from "@/domains/learning/experiment-prior";

const BANNED_DASH = /[‒–—―]/;

function won(actionType: string): SettledOutcome {
  return { verdict: "won", operatorVerdictOverride: null, dims: { actionType } };
}
function lost(actionType: string): SettledOutcome {
  return { verdict: "lost", operatorVerdictOverride: null, dims: { actionType } };
}

describe("LearnedMoveLine — the visible closed loop on a move card", () => {
  it("renders NOTHING when there is no learned tag (fresh/undecided tenant)", () => {
    expect(renderToStaticMarkup(<LearnedMoveLine tag={null} />)).toBe("");
    expect(renderToStaticMarkup(<LearnedMoveLine tag={undefined} />)).toBe("");
    expect(renderToStaticMarkup(<LearnedMoveLine tag="" />)).toBe("");
  });

  it("renders NOTHING for a coin-flip bucket (the prior nulls the tag, no hollow claim)", () => {
    // 2 won + 2 lost = winRate 0.5 → multiplier 1.0 → tagFor returns null.
    const table = computeDimPriors([won("answer_block"), won("answer_block"), lost("answer_block"), lost("answer_block")]);
    const prior = resolvePrior({ actionType: "answer_block" }, table);
    expect(prior.tag).toBeNull();
    expect(renderToStaticMarkup(<LearnedMoveLine tag={prior.tag} />)).toBe("");
  });

  it("renders the honest 'I moved this up because ... all N won' line from a decided win streak", () => {
    const table = computeDimPriors([won("answer_block"), won("answer_block"), won("answer_block")]);
    const prior = resolvePrior({ actionType: "answer_block" }, table);
    const html = renderToStaticMarkup(<LearnedMoveLine tag={prior.tag} />);
    expect(html).toContain('data-learned-move-line="true"');
    expect(html).toContain("I moved this up because your answer-block changes keep winning (all 3 won).");
    expect(html).not.toMatch(BANNED_DASH);
  });

  it("renders the honest 'I moved this down because ... have not been landing' line on a losing kind", () => {
    const table = computeDimPriors([lost("edit_page"), lost("edit_page"), lost("edit_page"), lost("edit_page")]);
    const prior = resolvePrior({ actionType: "edit_page" }, table);
    const html = renderToStaticMarkup(<LearnedMoveLine tag={prior.tag} />);
    expect(html).toContain("I moved this down because your title and wording tweaks have not been landing (0 of 4 won).");
    expect(html).not.toMatch(BANNED_DASH);
  });

  it("strips any em/en dash even if a tag were authored with one (belt-and-suspenders)", () => {
    const html = renderToStaticMarkup(<LearnedMoveLine tag={"I moved this up — your changes won."} />);
    expect(html).not.toMatch(BANNED_DASH);
  });
});
