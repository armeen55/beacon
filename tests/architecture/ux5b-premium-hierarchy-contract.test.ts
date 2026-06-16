/**
 * Architecture invariants — UX.5B premium hierarchy (2026-05-07).
 *
 * Pins the four UX.5B changes:
 *   1. /today visibility hero header rendered above the chart
 *   2. /recommendations top-pick row emphasis (chip + border)
 *   3. /recommendations needs-more-evidence microcopy
 *   4. /today Command Center empty-state cohesion (premium copy)
 *
 * Each pin is source-grep + a negative pin where appropriate. The
 * goal is a build-time guarantee that a future "small copy edit"
 * cannot quietly revert these to debug-feeling defaults.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");

const TODAY_CLIENT = join(REPO_ROOT, "src/app/(shell)/today-client.tsx");
const COMMAND_CENTER = join(
  REPO_ROOT,
  "src/components/today/command-center.tsx",
);

const TODAY_SRC = readFileSync(TODAY_CLIENT, "utf8");
// Surface collapse (2026-06-15): recommendations-client.tsx was deleted.
// UX.5B.2 (top-pick row emphasis) + UX.5B.3 (needs-more-evidence microcopy)
// pinned its copy; those blocks are skipped below (the V2 card owns those
// surfaces). Empty placeholder keeps the skipped blocks compiling.
const REC_SRC = "";
const CC_SRC = readFileSync(COMMAND_CENTER, "utf8");

describe("UX.5B.1 / UX.6.3 — /today visibility hero", () => {
  it("renders the AIVisibilityHero above the chart (UX.6.3 promotion)", () => {
    // UX.6.3 (2026-05-08) — promoted from a small header above the
    // chart to a full hero card that owns the section's executive
    // copy + 4-card metric strip + per-platform footer. The previous
    // marker `data-today-section="visibility-hero-header"` was dropped
    // when the hero subsumed the header. New marker:
    // `data-today-section="ai-visibility-hero"` (set inside the
    // AIVisibilityHero component).
    expect(TODAY_SRC).toMatch(/<AIVisibilityHero/);
    expect(TODAY_SRC).toMatch(/aiVisibilityHeroProps/);
    // Brand-name copy still appears via the hero component's dynamic
    // brandName prop (sourced from visibilityData.brandName).
    expect(TODAY_SRC).toMatch(/visibilityData\.brandName/);
  });

  it("hero renders BEFORE the visibility chart in source order", () => {
    const heroIdx = TODAY_SRC.indexOf("<AIVisibilityHero");
    const chartIdx = TODAY_SRC.indexOf("<VisibilityScoreChart");
    expect(heroIdx).toBeGreaterThan(-1);
    expect(chartIdx).toBeGreaterThan(-1);
    expect(heroIdx).toBeLessThan(chartIdx);
  });

  it("preserves the existing chart + leaderboard render (no backend change)", () => {
    expect(TODAY_SRC).toMatch(/<VisibilityScoreChart/);
    expect(TODAY_SRC).toMatch(/<VisibilityLeaderboard/);
  });
});

describe.skip("UX.5B.2 — /recommendations top-pick row emphasis (legacy recommendations-client removed 2026-06-15)", () => {
  it("exports/uses selectTopPickId helper with the same logic as the Executive Strip", () => {
    expect(REC_SRC).toMatch(/function selectTopPickId/);
    // Mirrors strip logic: filter terminal statuses + prefer non-needs_review.
    expect(REC_SRC).toMatch(/derivedConfidence !== "needs_review"/);
    // Sorts by rank ascending.
    expect(REC_SRC).toMatch(/\.sort\(\(a, b\) => a\.rank - b\.rank\)/);
  });

  it("ActionTable computes topPickId via useMemo", () => {
    expect(REC_SRC).toMatch(/topPickId\s*=\s*useMemo\(\(\)\s*=>\s*selectTopPickId\(rows\)/);
  });

  it("ActionTable threads isTopPick into each ActionRow", () => {
    expect(REC_SRC).toMatch(
      /<ActionRow[\s\S]{0,400}isTopPick=\{row\.id === topPickId\}/,
    );
  });

  it("ActionRow accepts isTopPick prop with a default of false", () => {
    expect(REC_SRC).toMatch(/isTopPick\s*=\s*false/);
    expect(REC_SRC).toMatch(/isTopPick\?:\s*boolean/);
  });

  it("Top-pick row gets a subtle accent on the <tr> + a data attr for tests", () => {
    expect(REC_SRC).toMatch(/data-rec-top-pick=\{isTopPick \? "true" : undefined\}/);
    expect(REC_SRC).toMatch(
      /isTopPick &&[\s\S]{0,200}border-l-accent-primary/,
    );
  });

  it("Top-pick row renders a 'Top pick' chip with operator-friendly tooltip", () => {
    expect(REC_SRC).toMatch(/data-rec-top-pick-chip="true"/);
    expect(REC_SRC).toMatch(/Top pick/);
    expect(REC_SRC).toMatch(
      /title="Beacon's top pick today[\s\S]{0,200}"/,
    );
  });

  it("Top-pick chip is conditional (only renders when isTopPick is true)", () => {
    // Pin: chip lives inside a `{isTopPick ? <span ...>Top pick</span> : null}`
    // ternary so non-top-pick rows render no extra DOM.
    expect(REC_SRC).toMatch(
      /\{isTopPick \?[\s\S]{0,800}data-rec-top-pick-chip[\s\S]{0,400}:\s*null\}/,
    );
  });
});

describe.skip("UX.5B.3 — /recommendations needs-more-evidence microcopy (legacy recommendations-client removed 2026-06-15)", () => {
  it("renders the watch-state microcopy on rows where derivedConfidence === 'needs_review'", () => {
    expect(REC_SRC).toMatch(
      /row\.derivedConfidence === "needs_review"[\s\S]{0,400}data-rec-needs-more-evidence-microcopy="true"/,
    );
    expect(REC_SRC).toMatch(
      /Worth a look — based on limited data so far\. Optional\./,
    );
  });

  it("microcopy is conditional (renders ': null' when not needs_review)", () => {
    // Negative pin — must NOT render the microcopy on rows whose
    // derivedConfidence is strong/moderate.
    const tern = REC_SRC.match(
      /row\.derivedConfidence === "needs_review" \?[\s\S]{0,800}: null/,
    );
    expect(tern).toBeTruthy();
  });
});

describe("UX.5B.4 — Command Center empty-state cohesion", () => {
  it("Brain readiness empty state uses 'Waiting for your next reading.'", () => {
    // Source-grep that the empty branch contains the premium copy.
    expect(CC_SRC).toMatch(
      /title="Brain readiness"[\s\S]{0,400}Waiting for your next reading\./,
    );
  });

  it("Latest reading empty state uses 'No reading yet.'", () => {
    expect(CC_SRC).toMatch(
      /title="Latest reading"[\s\S]{0,400}No reading yet\./,
    );
  });

  it("Top movement empty state uses 'Watching for movement.'", () => {
    expect(CC_SRC).toMatch(
      /title="Top movement"[\s\S]{0,400}Watching for movement\./,
    );
  });

  it("Next best action empty state uses 'No action queued yet.'", () => {
    expect(CC_SRC).toMatch(
      /title="Next best action"[\s\S]{0,400}No action queued yet\./,
    );
  });

  it("does NOT regress to debug-feeling blanks (e.g., 'undefined', 'null', '—')", () => {
    // Pin: each empty state has a real sentence, not just placeholder text.
    expect(CC_SRC).not.toMatch(/EmptyState>\s*undefined\s*</);
    expect(CC_SRC).not.toMatch(/EmptyState>\s*null\s*</);
    expect(CC_SRC).not.toMatch(/EmptyState>\s*—\s*</);
    expect(CC_SRC).not.toMatch(/EmptyState>\s*N\/A\s*</);
  });
});

describe("UX.5B — Ritz mature-render preserved", () => {
  // The visibility hero is gated by `visibilityData &&` so it never
  // renders for tenants without data; the Command Center early-return
  // contract is unchanged. Pin those guarantees.

  it("visibility hero render is still gated by visibilityData", () => {
    expect(TODAY_SRC).toMatch(/\{visibilityData && \(/);
  });

  it("Command Center still renders BEFORE Tier 0 alerts", () => {
    const ccIdx = TODAY_SRC.indexOf("<CommandCenter");
    const tier0Idx = TODAY_SRC.indexOf("Tier 0 — critical alerts");
    expect(ccIdx).toBeGreaterThan(-1);
    expect(tier0Idx).toBeGreaterThan(-1);
    expect(ccIdx).toBeLessThan(tier0Idx);
  });

  it("first-reading early return still wins for new tenants", () => {
    expect(TODAY_SRC).toMatch(
      /if \(firstReading\.isFirstReading\) \{[\s\S]{0,200}return <FirstReadingWaiting/,
    );
  });
});

describe("UX.5B — no scary/internal language regression", () => {
  it("UX.5B additions do not introduce internal jargon in rendered text", () => {
    // The premium copy strings should never reference cron / Supabase / GitHub.
    // Surface collapse (2026-06-15): the "Top pick" row emphasis +
    // "Worth a look — based on limited data so far. Optional." microcopy
    // lived in the deleted recommendations-client; the V2 card owns those
    // strings now. Dropped from this /today + command-center sweep.
    const newStrings = [
      "Waiting for your next reading.",
      "Watching for movement.",
      "No action queued yet.",
      "AI Visibility",
    ];
    // Each new string exists somewhere in the touched files.
    for (const s of newStrings) {
      const found =
        TODAY_SRC.includes(s) || REC_SRC.includes(s) || CC_SRC.includes(s);
      expect(found).toBe(true);
    }
  });

  it("does NOT call paid APIs / fetch from any of the touched files", () => {
    // The four edits are pure UI; no new backend calls.
    for (const src of [TODAY_SRC, REC_SRC, CC_SRC]) {
      expect(src).not.toMatch(/from\s+["']@\/adapters\/openai/);
      expect(src).not.toMatch(/from\s+["']@\/adapters\/perplexity/);
      // (We don't grep for runNativePoll here because today-data.ts
      // already imports observation paths via existing infra; the
      // separate per-file invariant tests cover that surface.)
    }
  });
});
