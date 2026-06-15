/**
 * Metric-honesty contract tests (2026-06-14) for the /today dashboard.
 *
 * Pins two customer-trust fixes surfaced by the dashboard-honesty audit so
 * a future "make it pop" copy/style change can't quietly reintroduce them:
 *
 *   #356 — the share-capture banner is a COINCIDENCE test (its own
 *          provenance builder hardcodes trustLevel "unreliable"). It must
 *          NOT ship with confident green/success styling, and must carry a
 *          "directional, not proven" caveat.
 *
 *   #322 — the morning-brief freshness line must report the ACTUAL age of
 *          the latest reading. It must not claim "today" for data that is a
 *          day (or more) old, and must not present an OBSERVATION date as a
 *          "last updated" refresh event.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { VisibilityLeaderboard } from "./visibility-leaderboard";
import { MorningBrief } from "./morning-brief";
import type { EntityVisibility } from "@/domains/product/visibility-score";
import type {
  MorningBriefData,
  MorningBriefItem,
} from "@/domains/product/morning-brief";

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

function briefItem(): MorningBriefItem {
  return {
    id: "item-1",
    priority: "need",
    headline: "Do this thing",
    rationale: "Because reasons",
    contextLines: [],
    steps: ["step one"],
    pageUrl: null,
    pagePath: null,
    citationCount: 0,
    confidenceLabel: "high",
    aiContext: null,
    keyReason: null,
    monitorLine: null,
    recType: "strengthen",
  };
}

function briefData(over: Partial<MorningBriefData> = {}): MorningBriefData {
  return {
    // The freshness line only renders when there's at least one brief item
    // (the empty-state short-circuits before it), so seed one.
    items: [briefItem()],
    memoryInsights: [],
    competitorAlerts: [],
    competitorSummaries: [],
    trendPct: null,
    totalOwnedCitations: 0,
    latestDataDate: null,
    ...over,
  };
}

describe("#322 — morning-brief freshness reports the real reading age", () => {
  it("only says 'today' when the latest reading is genuinely from today", () => {
    const today = new Date().toISOString().slice(0, 10);
    const html = renderToStaticMarkup(
      <MorningBrief data={briefData({ latestDataDate: today })} />,
    );
    expect(html).toContain("Latest reading is from today");
    // The old hardcoded-success phrasing must be gone.
    expect(html).not.toContain("Data is current — last updated today");
  });

  it("does NOT claim 'today' for yesterday's reading", () => {
    const yesterday = new Date(Date.now() - 86_400_000)
      .toISOString()
      .slice(0, 10);
    const html = renderToStaticMarkup(
      <MorningBrief data={briefData({ latestDataDate: yesterday })} />,
    );
    expect(html).toContain("Latest reading is from yesterday");
    expect(html).not.toContain("Latest reading is from today");
    expect(html).not.toContain("last updated today");
  });
});
