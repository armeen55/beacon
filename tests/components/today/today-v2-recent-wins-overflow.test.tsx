/**
 * Today v2 — Recent Wins overflow defense (QA polish bundle, 2026-05-11).
 *
 * Pins the `min-w-0` overflow guard added in response to the full
 * v2 QA audit (P1-1). Without `min-w-0` on the article + list-item
 * + Link wrappers, a long unbroken `urlVerdictProof.pagePath`
 * inside the `truncate` <p> expands the CSS-Grid track past its
 * share and forces horizontal page scroll. The sibling
 * `today-v2-working.tsx` already had the correct shape (`flex-1
 * min-w-0 truncate`); this test guards the missing-half from
 * regressing on Recent Wins.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { TodayV2RecentWins } from "@/components/today/v2/today-v2-recent-wins";

describe("TodayV2RecentWins — overflow defense", () => {
  it("applies min-w-0 to the article + list item + Link wrappers when a urlVerdictProof row is present", () => {
    const html = renderToStaticMarkup(
      <TodayV2RecentWins
        measuredWins={[]}
        urlVerdictProof={{
          changeId: "cl-test-1",
          pagePath:
            "/services/whole-home-renovation-bay-area-luxury-modern-design-build",
          changeDate: "2026-05-04",
          platform: "perplexity",
          citationDeltaPct: 240,
          deltaLabel: "4×",
        }}
      />,
    );
    // Article carries min-w-0 (so the grid track can shrink).
    // The article tag is unique in the rendered output — assert
    // the data-attr is present AND a class containing min-w-0
    // exists on the same element, allowing either attr order.
    expect(html).toContain('data-today-v2-card="recent-wins"');
    expect(html).toMatch(/<article[^>]*\bmin-w-0\b[^>]*>/);
    // List item carries min-w-0 (so it doesn't widen the ul).
    expect(html).toMatch(/<li[^>]*\bmin-w-0\b[^>]*>/);
    expect(html).toContain('data-today-v2-win-row="true"');
    // The Link wrapping the truncated <p> carries min-w-0
    // (without this, block-level Link defaults to natural width).
    expect(html).toMatch(/<a[^>]*\bmin-w-0\b[^>]*>/);
    // The long path renders verbatim in the headline.
    expect(html).toContain(
      "/services/whole-home-renovation-bay-area-luxury-modern-design-build",
    );
  });

  it("preserves the truncate class on the headline so visual ellipsis still applies", () => {
    const html = renderToStaticMarkup(
      <TodayV2RecentWins
        measuredWins={[]}
        urlVerdictProof={{
          changeId: "cl-test-1",
          pagePath: "/long/path/that/should-truncate",
          changeDate: "2026-05-04",
          platform: "perplexity",
          citationDeltaPct: 100,
          deltaLabel: "2×",
        }}
      />,
    );
    expect(html).toMatch(/<p[^>]*class="[^"]*\btruncate\b/);
  });
});
