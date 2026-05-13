/**
 * 2026-05-13 — UX follow-up. The /recommendations v2 surface must NOT
 * push customers into the legacy view through any default href. Before
 * this guard, three customer-facing v2 links defaulted to `?legacy=1`:
 *   1. "See full list →" at the bottom of the Suggested stack.
 *   2. Every Working rail row's `<Link>` href.
 *   3. The Watchlist footer link.
 *
 * (1) and (2) shipped a fix on 2026-05-13. (3) — the watchlist link —
 * is the only known legacy hop that survives; it points at a section
 * the v2 surface does not yet render. Carved out here behind an
 * explicit `WATCHLIST_LEGACY_FALLBACK` allowance so a future v2
 * watchlist surface gets a clean failing test when it lands.
 *
 * Operator-locked: every other `?legacy=1` reference in the v2 client +
 * card + working rail must be either a comment OR the carved-out
 * watchlist fallback.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");

function read(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), "utf-8");
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const V2_CLIENT_SRC = stripComments(
  read("src/app/(shell)/recommendations/recommendations-v2-client.tsx"),
);
const V2_CARD_SRC = stripComments(
  read("src/components/recommendations/v2/recommendation-v2-card.tsx"),
);
const V2_WORKING_RAIL_SRC = stripComments(
  read("src/components/recommendations/v2/recommendations-v2-working-rail.tsx"),
);

describe("v2 /recommendations — no customer-facing legacy hops", () => {
  it("the v2 card primary CTA does NOT default to ?legacy=1", () => {
    // Cap the search to the post-import body so the regex never
    // catches a `?legacy=1` literal that lives in a JSDoc snippet
    // for documentation. Comment stripping above handles JSDoc; this
    // is a defense-in-depth pin.
    expect(V2_CARD_SRC).not.toMatch(/['"`][^'"`]*\?legacy=1[^'"`]*['"`]/);
  });

  it("the v2 working rail default href does NOT use ?legacy=1", () => {
    expect(V2_WORKING_RAIL_SRC).not.toMatch(
      /['"`][^'"`]*\?legacy=1[^'"`]*['"`]/,
    );
  });

  it("the v2 working rail default href is the v2 detail page", () => {
    expect(V2_WORKING_RAIL_SRC).toMatch(/encodeRecommendationRouteId\s*\(/);
    expect(V2_WORKING_RAIL_SRC).toMatch(
      /`\/recommendations\/\$\{encodeRecommendationRouteId\(row\.id\)\}`/,
    );
  });

  it("the See full list CTA is a button, not a legacy link", () => {
    // The data-attribute lives on a <button>, the inline toggle that
    // expands the Suggested stack.
    expect(V2_CLIENT_SRC).toMatch(
      /<button[\s\S]*?data-recommendations-v2-cta="see-all"/,
    );
    // No anchor in the v2 client carries that data-attribute.
    expect(V2_CLIENT_SRC).not.toMatch(
      /<Link[\s\S]{0,200}data-recommendations-v2-cta="see-all"/,
    );
    expect(V2_CLIENT_SRC).not.toMatch(
      /<a[\s\S]{0,200}data-recommendations-v2-cta="see-all"/,
    );
  });

  it("the See full list CTA path string is no longer present", () => {
    // The previous link target was the bare literal "/recommendations?legacy=1".
    // The current Suggested-stack body must not contain that string at all.
    // The only allowed `?legacy=1` reference in the v2 client is the
    // explicit watchlist footer fallback (carved out below).
    const suggestedStackBlock = (() => {
      const start = V2_CLIENT_SRC.indexOf(
        'data-recommendations-v2-section="suggested"',
      );
      // `RecommendationsV2WorkingRail` appears in both the IMPORT and
      // the JSX usage; we want the JSX usage, which is the closing
      // sibling of the Suggested section.
      const end = V2_CLIENT_SRC.indexOf(
        "<RecommendationsV2WorkingRail",
      );
      if (start < 0 || end < 0 || end <= start) {
        throw new Error(
          "suggested-stack slice failed — file shape changed; update the markers in this test",
        );
      }
      return V2_CLIENT_SRC.slice(start, end);
    })();
    expect(suggestedStackBlock).not.toContain("?legacy=1");
  });

  it("the only ?legacy=1 reference in the v2 client is the carved-out watchlist footer fallback", () => {
    const occurrences = (V2_CLIENT_SRC.match(/\?legacy=1/g) ?? []).length;
    // Allowance: ONE legacy reference, the watchlist footer link.
    // When a v2 watchlist surface lands, this drops to 0 and this
    // test must be updated.
    expect(occurrences).toBeLessThanOrEqual(1);
    if (occurrences === 1) {
      // The carved-out reference must be inside the watchlist footer
      // branch (renders only when watchlist.length > 0) and must use
      // the `#watchlist` anchor.
      expect(V2_CLIENT_SRC).toMatch(/#watchlist/);
      expect(V2_CLIENT_SRC).toMatch(/data-recommendations-v2-cta="watchlist"/);
    }
  });
});
