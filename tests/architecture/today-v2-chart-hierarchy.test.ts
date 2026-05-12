/**
 * Today v2 chart hierarchy + rank copy guardrails (2026-05-12).
 *
 * Pin two operator-feedback fixes from the post-rollout polish
 * pass — both source-level so they catch regressions even if the
 * v2 client is refactored:
 *
 *   1. Visibility chart sits in the main Today v2 flow (with the
 *      hero), NOT buried inside the "Show full data" disclosure.
 *   2. The rank card's subtext makes the tracked-set framing
 *      explicit — never the misleading "of N ranked" form that
 *      reads as "the entire market has only N companies".
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");

function read(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), "utf8");
}

describe("Today v2 — visibility chart hierarchy", () => {
  const client = read("src/app/(shell)/today-v2-client.tsx");

  it("renders the visibility chart in the main flow, marked as `visibility-trend`", () => {
    expect(client).toMatch(
      /data-today-v2-section="visibility-trend"[\s\S]*?<VisibilityScoreChart/,
    );
  });

  it("does NOT render the visibility chart inside the disclosure", () => {
    // The disclosure used to carry a `visibility-detail` section
    // that paired the chart with the leaderboard. After the
    // hierarchy fix, the chart lives outside the disclosure.
    expect(client).not.toMatch(/data-today-v2-section="visibility-detail"/);
  });

  it("renders the chart exactly once (no duplicate in the disclosure)", () => {
    const matches = client.match(/<VisibilityScoreChart\s/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it("disclosure summary microcopy no longer advertises 'visibility chart'", () => {
    // Pre-fix the summary read "visibility chart · leaderboard · …"
    // — now the chart is above the disclosure, so the microcopy
    // should match what's actually inside.
    expect(client).not.toMatch(/visibility chart\s*·\s*leaderboard/);
  });

  it("leaderboard remains inside the disclosure (it's a per-competitor table, not a customer headline)", () => {
    expect(client).toMatch(
      /data-today-v2-disclosure="show-full-data"[\s\S]*?<VisibilityLeaderboard/,
    );
  });
});

describe("Today v2 — rank card subtext (AI Visibility Hero)", () => {
  const hero = read("src/components/today/ai-visibility-hero.tsx");

  it("rank subtext uses the tracked-set framing, never 'of N ranked'", () => {
    expect(hero).toContain("among tracked brands cited by AI");
  });

  it("rank subtext does NOT carry the misleading 'of N ranked' phrasing", () => {
    // Match either the rendered template literal or any plain
    // "of N ranked" form. Code comments mention the old wording
    // for context — strip JSX/JS comment lines before grepping.
    const stripped = hero
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    expect(stripped).not.toMatch(/`of\s+\$\{[^}]*\}\s+ranked`/);
    expect(stripped).not.toMatch(/['"]of\s+\d+\s+ranked['"]/);
  });
});
