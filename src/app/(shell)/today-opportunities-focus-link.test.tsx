/**
 * B-15 (operator spec 2026-07-09) render pin - the Today -> Changes deep link.
 *
 * Wave 3B (2026-07-10): the "What to do next" list on Today was subsumed by the ONE command.
 * The B-15 contract survives on the command's ship_move kind: its CTA must deep-link to that
 * exact CanonicalChange's detail on Changes (/changes?focus=<id>), not the bare list, so
 * clicking "See the change" opens the same row (changes-list-client.tsx reads ?focus).
 *
 * Rendered for real via renderToStaticMarkup (repo convention, no jsdom) so this pins the actual
 * anchor href a click would follow.
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { buildTodayCommand, changeFocusHref } from "@/domains/today/today-command";
import { TodayCommandCard } from "@/components/today/today-command-card";
import type { TodayOpportunity } from "@/domains/changes/today-view";

function opportunity(overrides: Partial<TodayOpportunity> = {}): TodayOpportunity {
  return {
    changeId: "tenant-iranopedia::/persian-rugs::title",
    pageLabel: "/persian-rugs",
    recommendation: "Rewrite the title to match search intent",
    opportunityType: "title",
    estimatedEffortMinutes: 5,
    upside: 40,
    evidenceStrength: "strong",
    ...overrides,
  };
}

describe("changeFocusHref", () => {
  it("builds a /changes?focus=<id> deep link, URL-encoding the id", () => {
    const id = "tenant-iranopedia::/persian-rugs::title";
    expect(changeFocusHref(id)).toBe(`/changes?focus=${encodeURIComponent(id)}`);
    expect(changeFocusHref(id)).toContain("/changes?focus=");
  });
});

describe("Today command ship_move - Today to Changes deep link (B-15)", () => {
  it("the ship_move CTA links to its own change detail, never the bare /changes list", () => {
    const command = buildTodayCommand({
      pipelineAlarms: [],
      smokeAlarm: null,
      scoreboardDeltaPct: 3,
      topOpportunity: opportunity(),
      firstReadOn: null,
      measuringCount: 0,
    });
    expect(command.kind).toBe("ship_move");
    expect(command.cta?.href).toBe(
      `/changes?focus=${encodeURIComponent("tenant-iranopedia::/persian-rugs::title")}`,
    );

    const html = renderToStaticMarkup(<TodayCommandCard command={command} />);
    expect(html).toContain(
      `href="/changes?focus=${encodeURIComponent("tenant-iranopedia::/persian-rugs::title")}"`,
    );
    // The one CTA carries the focus id; there is no bare /changes list link on the card.
    const changeHrefs = [...html.matchAll(/href="(\/changes[^"]*)"/g)].map((m) => m[1]);
    expect(changeHrefs).toEqual([
      `/changes?focus=${encodeURIComponent("tenant-iranopedia::/persian-rugs::title")}`,
    ]);
  });
});
