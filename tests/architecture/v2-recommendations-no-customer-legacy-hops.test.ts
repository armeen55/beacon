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

// Move 5 (2026-07-01): recommendations-v2-client.tsx was removed when
// /recommendations became a redirect to /worklist. The surviving v2 card
// and detail surfaces still carry the "no legacy hops" invariant below;
// the deleted client's four pins are dropped as an obsolete contract.
// (recommendations-v2-working-rail.tsx deleted 2026-07-02, UX5 legacy
// sweep — its host, the /recommendations?v2=1 layout, never shipped a
// live caller; its two pins below are dropped alongside it.)
const V2_CARD_SRC = stripComments(
  read("src/components/recommendations/v2/recommendation-v2-card.tsx"),
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
});
