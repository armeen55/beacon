/**
 * WhyNotOthers (R14a) - render pins for the quiet "Why not the others?" expander on
 * the daily card: the plan record's own frozen exclusions, plain sentences only,
 * capped at 8, self-hiding when the planner excluded nothing.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { WhyNotOthers } from "./daily-experiments-section";
import type { ExcludedPickRecord } from "@/domains/experiments/daily-plan-types";

describe("WhyNotOthers (R14a)", () => {
  it("self-hides when the planner excluded nothing (and on pre-R14a plans)", () => {
    expect(renderToStaticMarkup(<WhyNotOthers excluded={undefined} />)).toBe("");
    expect(renderToStaticMarkup(<WhyNotOthers excluded={[]} />)).toBe("");
  });

  it("renders the planner's own frozen sentence and the code translation, never a raw code", () => {
    const excluded: ExcludedPickRecord[] = [
      {
        url: "https://iranopedia.com/persian-cat",
        actionFamily: "meta",
        reason: "query_overlap_hold",
        plainReason:
          "I am holding this because it competes for the same searches as tonight's pick for /persian-cats.",
      },
      { url: "https://iranopedia.com/iran-flags", actionFamily: "meta", reason: "budget_full" },
    ];
    const html = renderToStaticMarkup(<WhyNotOthers excluded={excluded} />);
    expect(html).toContain("Why not the others?");
    expect(html).toContain(
      "I am holding this because it competes for the same searches as tonight&#x27;s pick for /persian-cats.",
    );
    expect(html).toContain("Tonight&#x27;s time budget was already full.");
    expect(html).not.toContain("query_overlap_hold");
    expect(html).not.toContain("budget_full");
    expect(html).not.toMatch(/[‒–—―]/);
  });

  it("caps the rendered list at 8", () => {
    const excluded: ExcludedPickRecord[] = Array.from({ length: 12 }, (_, i) => ({
      url: `https://iranopedia.com/p${i}`,
      reason: "over_max",
    }));
    const html = renderToStaticMarkup(<WhyNotOthers excluded={excluded} />);
    expect(html).toContain("/p7");
    expect(html).not.toContain("/p8");
  });
});
