/**
 * B-15 (operator spec 2026-07-09) render pin - each "What to do next" card on
 * Today must deep-link to that exact CanonicalChange's detail on Changes, not
 * just the generic list. Changes opens the SAME row's detail (its own
 * selectedId affordance) when the URL carries ?focus=<id> (see the effect in
 * changes-list-client.tsx), so the href here must be `/changes?focus=<id>`,
 * not a bare `/changes`.
 *
 * Rendered for real via renderToStaticMarkup (repo convention, no jsdom) so
 * this pins the actual anchor href a click would follow, not just props.
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { OpportunitiesSection, opportunityHref } from "./page";
import type { TodayView } from "@/domains/changes/today-view";

function baseView(overrides: Partial<TodayView> = {}): TodayView {
  return {
    strategy: "balanced",
    planStatus: "none",
    headerSentence: "Choose a few changes to work on today.",
    attention: [],
    measuring: [],
    nextOpportunities: [],
    counts: { readyToday: 0, needsAttention: 0, measuring: 0, resultsAvailable: 0 },
    ...overrides,
  };
}

describe("opportunityHref", () => {
  it("builds a /changes?focus=<id> deep link, URL-encoding the id", () => {
    const id = "tenant-iranopedia::/persian-rugs::title";
    expect(opportunityHref(id)).toBe(`/changes?focus=${encodeURIComponent(id)}`);
    expect(opportunityHref(id)).toContain("/changes?focus=");
  });
});

describe("OpportunitiesSection - Today to Changes deep link (B-15)", () => {
  it("each move card links to its own change detail, never the bare /changes list", () => {
    const view = baseView({
      nextOpportunities: [
        {
          changeId: "tenant-iranopedia::/persian-rugs::title",
          pageLabel: "Persian Rugs",
          recommendation: "Rewrite the title to match search intent.",
          opportunityType: "title",
          estimatedEffortMinutes: 5,
          upside: null,
          evidenceStrength: "strong",
        },
        {
          changeId: "tenant-iranopedia::/farsi-numbers::answer_block",
          pageLabel: "Farsi Numbers",
          recommendation: "Add a direct answer block.",
          opportunityType: "answer_block",
          estimatedEffortMinutes: 10,
          upside: null,
          evidenceStrength: "directional",
        },
      ],
    });
    const html = renderToStaticMarkup(OpportunitiesSection({ today: view }));

    expect(html).toContain(
      `href="/changes?focus=${encodeURIComponent("tenant-iranopedia::/persian-rugs::title")}"`,
    );
    expect(html).toContain(
      `href="/changes?focus=${encodeURIComponent("tenant-iranopedia::/farsi-numbers::answer_block")}"`,
    );
    // Every per-card link carries a focus id - the generic "View all in Changes"
    // header link is the only href that may still point at the bare list.
    const cardHrefs = [...html.matchAll(/href="(\/changes[^"]*)"/g)].map((m) => m[1]);
    const bareListLinks = cardHrefs.filter((h) => h === "/changes");
    expect(bareListLinks).toHaveLength(1); // the "View all in Changes" header link only
  });

  it("renders nothing extra when there are no opportunities (still valid markup)", () => {
    const html = renderToStaticMarkup(OpportunitiesSection({ today: baseView() }));
    expect(html).toContain("What to do next");
    expect(html).not.toContain("focus=");
  });
});
