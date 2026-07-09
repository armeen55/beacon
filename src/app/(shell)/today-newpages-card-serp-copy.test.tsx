/**
 * today-newpages-card-serp-copy (issue #6) - the lab/vendor word "SERP" must never
 * reach the operator on the New Pages card. It leaked into the live-Google-check
 * BUTTON label, its title tooltip, the verdict block's "SERP: ..." domain line, and
 * the helper text. This pins the fix: we render the real card with renderToStaticMarkup
 * and assert the visible copy contains ZERO "SERP" (case-insensitive) and says "Google"
 * instead. Internal identifiers (serp state var, serp-actions import) are code, never
 * rendered, so they cannot trip this. Also guards against a banned dash sneaking in.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NewPageCard } from "./today-newpages-card";
import type { NewPageOpportunity } from "./today-newpages-data";

const BANNED_DASH = /[‒–—―]/; // figure, en, em, horizontal bar

/**
 * A card with a precomputed "Google checked" verdict (topDomains present) so the
 * verdict block AND the bottom action buttons both render - the two places "SERP"
 * used to appear.
 */
const OPPORTUNITY: NewPageOpportunity = {
  id: "np-serp-copy-test",
  topic: "Persian saffron rice",
  competitorCount: 4,
  topCompetitor: "example-competitor.com",
  whatWins: null,
  searchVolume: null,
  keywordMatch: null,
  // operator spec 2026-07-09 D-33: Rising/Seasonal/Stable replaced Hot/Warm/Emerging.
  signal: { kind: "stable", label: "Stable", evidence: null },
  score: 42,
  savedOpening: null,
  competitorDomains: ["a.com", "b.com"],
  preparedVerdict: {
    verdict: "build",
    confidence: "high",
    intent: "informational",
    contentDomainCount: 6,
    marketplaceUgcCount: 0,
    profoundOverlapCount: 0,
    ownAlreadyRanks: false,
    topDomains: ["site-one.com", "site-two.com", "site-three.com"],
    reason: "Content pages dominate; a strong page can win here.",
    generatedAt: "2026-07-06T00:00:00.000Z",
    costUsd: 0,
  },
  preparedBrief: null,
  briefQuality: null,
  openingQuality: null,
  aeoReceipt: null,
  fullPageDraft: null,
};

describe("NewPageCard - no 'SERP' in operator-facing copy (issue #6)", () => {
  const html = renderToStaticMarkup(
    <NewPageCard o={OPPORTUNITY} ownDomain="mine.com" />,
  );

  it("contains no 'SERP' string anywhere in the rendered markup (labels, buttons, titles)", () => {
    expect(/serp/i.test(html)).toBe(false);
  });

  it("labels the live-check button and tooltip with plain Google framing", () => {
    // This card carries a precomputed verdict, so the button reads the re-check label.
    expect(html).toContain("↻ Re-check Google");
    expect(html).toContain("Run a live Google check");
  });

  it("uses the plain 'Check live Google results' label when no verdict is prepared", () => {
    const unprepared = renderToStaticMarkup(
      <NewPageCard o={{ ...OPPORTUNITY, preparedVerdict: null }} ownDomain="mine.com" />,
    );
    expect(/serp/i.test(unprepared)).toBe(false);
    expect(unprepared).toContain("Check live Google results");
  });

  it("shows the top results line as 'Top Google results:' not 'SERP:'", () => {
    expect(html).toContain("Top Google results:");
    expect(html).toContain("site-one.com");
  });

  it("emits no banned dash", () => {
    expect(BANNED_DASH.test(html)).toBe(false);
  });
});
