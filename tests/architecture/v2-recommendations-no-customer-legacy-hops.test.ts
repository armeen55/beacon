/**
 * 2026-05-13 — UX follow-up. The /recommendations v2 surface must NOT
 * push customers into the legacy view through any default href.
 * Originally three customer-facing v2 links defaulted to `?legacy=1`:
 *   1. "See full list →" at the bottom of the Suggested stack.
 *   2. Every Working rail row's `<Link>` href.
 *   3. The Watchlist footer link.
 *
 * (1) and (2) shipped a fix earlier on 2026-05-13. (3) — the watchlist
 * footer — shipped a follow-up that REMOVED the link entirely; the
 * watchlist section still lives on the legacy route (?legacy=1) for
 * direct operator access, but no v2 surface advertises it. When a v2
 * watchlist surface lands later, this invariant should be revisited.
 *
 * Operator-locked: NO `?legacy=1` reference in any customer-facing v2
 * source after comment stripping. Zero exceptions.
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
const V2_DETAIL_ACTIONS_SRC = stripComments(
  read("src/app/(shell)/recommendations/[id]/recommendation-detail-actions.tsx"),
);
const V2_DETAIL_CLIENT_SRC = stripComments(
  read("src/app/(shell)/recommendations/[id]/recommendation-detail-client.tsx"),
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

  it("the v2 detail-actions surface does NOT contain any ?legacy=1 string literal", () => {
    // 2026-05-13 — the "Open legacy review →" CTA was removed.
    // detail-actions.tsx is the LAST place where a customer-facing
    // v2 detail surface could regress back to advertising the legacy
    // route; this pin locks that down.
    expect(V2_DETAIL_ACTIONS_SRC).not.toMatch(/\?legacy=1/);
    expect(V2_DETAIL_ACTIONS_SRC).not.toMatch(/data-recommendation-detail-cta="legacy-review"/);
    expect(V2_DETAIL_ACTIONS_SRC).not.toMatch(/Open legacy review/);
  });

  it("the v2 detail-client surface contains no ?legacy=1 string literal", () => {
    expect(V2_DETAIL_CLIENT_SRC).not.toMatch(/\?legacy=1/);
  });

  it("the v2 working rail default href is the v2 detail page", () => {
    // 2026-05-13 P0 follow-up — both the card and the working rail
    // now route through the centralized `buildRecommendationDetailHref`
    // helper (single canonical href builder for /recommendations/[id]),
    // which wraps `encodeRecommendationRouteId(row.id)` and the path
    // prefix. The invariant pins the import + the call shape.
    expect(V2_WORKING_RAIL_SRC).toMatch(
      /import\s+\{\s*buildRecommendationDetailHref\s*\}\s+from\s+['"]\.\/recommendation-route-id['"]/,
    );
    expect(V2_WORKING_RAIL_SRC).toMatch(
      /buildRecommendationDetailHref\(\s*row\s*\)/,
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

  it("the v2 client source contains ZERO ?legacy=1 references after comment stripping", () => {
    // No carve-outs. The customer-facing v2 surface advertises no
    // path into the legacy table. The legacy route itself
    // (/recommendations?legacy=1) still works for direct operator
    // access — this invariant is about what v2 LINKS to, not whether
    // the legacy route exists.
    const occurrences = (V2_CLIENT_SRC.match(/\?legacy=1/g) ?? []).length;
    expect(occurrences).toBe(0);
  });

  it("the v2 client no longer renders a watchlist footer CTA", () => {
    // Defense-in-depth: even if a future regression re-introduces the
    // string under a different shape, the data-attribute must not
    // come back without a matching v2 surface and a refactor of this
    // test.
    expect(V2_CLIENT_SRC).not.toMatch(
      /data-recommendations-v2-cta="watchlist"/,
    );
    expect(V2_CLIENT_SRC).not.toMatch(/#watchlist/);
  });
});
