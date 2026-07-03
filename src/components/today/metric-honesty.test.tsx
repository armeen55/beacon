/**
 * Metric-honesty contract tests (2026-06-14) for the /today dashboard.
 *
 * Pins a customer-trust fix surfaced by the dashboard-honesty audit so
 * a future "make it pop" copy/style change can't quietly reintroduce it:
 *
 *   #356 — the share-capture banner is a COINCIDENCE test (its own
 *          provenance builder hardcodes trustLevel "unreliable"). It must
 *          NOT ship with confident green/success styling, and must carry a
 *          "directional, not proven" caveat.
 *
 * (The #322 morning-brief freshness pin was removed 2026-07-02, UX5 legacy
 * sweep — `src/components/today/morning-brief.tsx` had zero remaining
 * importers; the current /today freshness line ships from war-room-sections
 * and today-v2-data instead.)
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { VisibilityLeaderboard } from "./visibility-leaderboard";
import type { EntityVisibility } from "@/domains/product/visibility-score";

function entity(over: Partial<EntityVisibility> = {}): EntityVisibility {
  return {
    name: "Example",
    slug: "example",
    isOwned: false,
    rank: 1,
    score: 20,
    delta: 0,
    deltaWindowDays: 14,
    currentSampledDays: 14,
    previousSampledDays: 14,
    mentionCount: 100,
    ...over,
  };
}

/** Brand up >0.5pt while a competitor is down >0.5pt -> banner fires. */
function shareCaptureEntities(): EntityVisibility[] {
  return [
    entity({
      name: "You",
      slug: "you",
      isOwned: true,
      rank: 1,
      score: 30,
      delta: 2.0,
    }),
    entity({
      name: "Rival Co",
      slug: "rival",
      isOwned: false,
      rank: 2,
      score: 25,
      delta: -3.0,
    }),
  ];
}

describe("#356 — share-capture banner is not styled as a proven win", () => {
  it("fires the banner but with neutral styling + a 'directional, not proven' caveat", () => {
    const html = renderToStaticMarkup(
      <VisibilityLeaderboard entities={shareCaptureEntities()} />,
    );
    // The banner renders (the coincidence condition is met)...
    expect(html).toContain("Possible share shift");
    // ...but it must NOT use the old confident success-green framing.
    expect(html).not.toContain("Share capture:");
    expect(html).not.toMatch(/bg-status-success/);
    expect(html).not.toMatch(/font-semibold text-status-success/);
    // ...and it must carry the honest caveat.
    expect(html).toContain("Directional, not proven");
    expect(html).toContain("hasn");
  });
});

