/**
 * Today v2 hierarchy + legacy-cleanup guardrails (2026-05-12, two
 * passes).
 *
 * Pass 1 (chart hierarchy + rank copy) — pins:
 *   1. Visibility chart sits in the main Today v2 flow (with the
 *      hero), NOT inside the "Show full data" disclosure.
 *   2. The rank card's subtext makes the tracked-set framing
 *      explicit — never the misleading "of N ranked" form.
 *
 * Pass 2 (leaderboard promotion + disclosure cleanup) — pins:
 *   3. AI Visibility Leaderboard now lives in the main flow next
 *      to the chart, NOT inside the disclosure.
 *   4. Disclosure no longer carries duplicative sections:
 *        - "Wins to learn from" (ActionCard rendering of
 *           measuredWins) — duplicates TodayV2RecentWins above
 *           the fold.
 *        - PromptsTeaser — now handled by `/prompts?v2=1`.
 *        - ChangeReview (scan-diff confirm flow) — operator-only;
 *           reachable via `/today?legacy=1`.
 *   5. Leaderboard subcopy clarifies the tracked-set framing.
 *
 * Source-level guardrails so the contract holds even after JSX
 * refactors. Components that were removed from the v2 render path
 * STAY in the codebase because legacy `today-client.tsx` consumes
 * them — pinning the v2 render is enough.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");

function read(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), "utf8");
}

describe("Today v2 — visibility chart in main flow", () => {
  const client = read("src/app/(shell)/today-v2-client.tsx");

  it("renders the visibility chart in the main flow, marked as `visibility-trend`", () => {
    expect(client).toMatch(
      /data-today-v2-section="visibility-trend"[\s\S]*?<VisibilityScoreChart/,
    );
  });

  it("does NOT render the visibility chart inside the disclosure", () => {
    expect(client).not.toMatch(/data-today-v2-section="visibility-detail"/);
  });

  it("renders the chart exactly once (no duplicate in the disclosure)", () => {
    const matches = client.match(/<VisibilityScoreChart\s/g) ?? [];
    expect(matches.length).toBe(1);
  });
});

describe("Today v2 — leaderboard promoted into main flow", () => {
  const client = read("src/app/(shell)/today-v2-client.tsx");

  it("renders the leaderboard in the main flow, marked as `visibility-leaderboard`", () => {
    // The leaderboard `<section data-today-v2-section=...>` must
    // sit BEFORE the `<details data-today-v2-disclosure=...>`
    // block. We assert the leaderboard's section marker exists
    // AND that the section appears before the disclosure marker.
    expect(client).toMatch(
      /data-today-v2-section="visibility-leaderboard"[\s\S]*?<VisibilityLeaderboard/,
    );
    const leaderboardIdx = client.indexOf(
      'data-today-v2-section="visibility-leaderboard"',
    );
    const disclosureIdx = client.indexOf(
      'data-today-v2-disclosure="show-full-data"',
    );
    expect(leaderboardIdx).toBeGreaterThan(0);
    expect(disclosureIdx).toBeGreaterThan(0);
    expect(leaderboardIdx).toBeLessThan(disclosureIdx);
  });

  it("renders the leaderboard exactly once (no duplicate inside disclosure)", () => {
    const matches = client.match(/<VisibilityLeaderboard\s/g) ?? [];
    expect(matches.length).toBe(1);
  });
});

describe("Today v2 — disclosure cleanup (no duplicative sections)", () => {
  const client = read("src/app/(shell)/today-v2-client.tsx");

  it("does NOT render a 'Wins to learn from' ActionCard section", () => {
    // The full ActionCard rendering of `measuredWins` duplicated
    // TodayV2RecentWins above the fold and was removed.
    expect(client).not.toMatch(/data-today-v2-section="wins-detail"/);
    expect(client).not.toContain("Wins to learn from");
    expect(client).not.toMatch(/<ActionCard\s/);
  });

  it("does NOT render PromptsTeaser in the v2 tree", () => {
    // `/prompts?v2=1` now handles the prompts strategic surface
    // end-to-end. The Today disclosure teaser was redundant.
    expect(client).not.toMatch(/<PromptsTeaser\s/);
    // The TYPE import for PromptsTeaserSummary is allowed (props
    // type still carries it for caller signature stability).
  });

  it("does NOT render ChangeReview in the v2 tree", () => {
    // Scan-diff confirm/dismiss is an operator flow; lives in
    // legacy `/today?legacy=1`.
    expect(client).not.toMatch(/<ChangeReview\s/);
  });

  it("disclosure summary microcopy advertises only what's actually inside", () => {
    // Pre-cleanup: "leaderboard · descriptors · prompts · scan".
    // Post-cleanup: leaderboard is in main flow, prompts/scan
    // sections removed entirely — only descriptors remains.
    expect(client).not.toMatch(/leaderboard\s*·\s*descriptors/);
    expect(client).not.toMatch(/·\s*prompts\s*·\s*scan/);
    expect(client).toContain("descriptors AI used near you");
  });
});

describe("Today v2 — rank card subtext (AI Visibility Hero)", () => {
  const hero = read("src/components/today/ai-visibility-hero.tsx");

  it("rank subtext uses the tracked-set framing, never 'of N ranked'", () => {
    expect(hero).toContain("among tracked brands cited by AI");
  });

  it("rank subtext does NOT carry the misleading 'of N ranked' phrasing", () => {
    const stripped = hero
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    expect(stripped).not.toMatch(/`of\s+\$\{[^}]*\}\s+ranked`/);
    expect(stripped).not.toMatch(/['"]of\s+\d+\s+ranked['"]/);
  });
});

describe("Today v2 — leaderboard subcopy clarifies tracked-set framing", () => {
  const leaderboard = read("src/components/today/visibility-leaderboard.tsx");

  it("subcopy says 'brands you track', not the ambiguous 'tracked answers'", () => {
    // Pre-polish: "Who AI mentions most across tracked answers" —
    // ambiguous ("tracked" reading as adjective on "answers", not
    // on the set of brands). Post-polish: "Who AI mentions most
    // among the brands you track" — possessive frames the set as
    // the customer's tracked brands.
    expect(leaderboard).toContain(
      "Who AI mentions most among the brands you track",
    );
    expect(leaderboard).not.toContain(
      "Who AI mentions most across tracked answers",
    );
  });
});
