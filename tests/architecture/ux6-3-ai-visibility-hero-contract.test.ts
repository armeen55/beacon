/**
 * Architecture invariants — UX.6.3 AI Visibility hero promotion
 * (2026-05-08).
 *
 * Pins the contract for the hero card that promotes AI Visibility
 * into the heart of /today:
 *
 *   - NEW `src/components/today/ai-visibility-hero.tsx` exports
 *     `AIVisibilityHero` + `AIVisibilityHeroProps`.
 *   - The component is pure presentation (no fetch / mutations /
 *     useState / event handlers / paid-API imports).
 *   - The hero owns the executive copy ("AI Visibility" + "How often
 *     {brand} appears across tracked AI answers.") and renders four
 *     metric cards (score / rank / closest-challenger / sample) plus
 *     a per-platform footer.
 *   - `today-client.tsx` derives `aiVisibilityHeroProps` from the
 *     ALREADY-COMPUTED `visibilityData` + `enrichmentV2` inputs
 *     (no new I/O, no math change).
 *   - Source order on /today: AIVisibilityHero renders ABOVE
 *     VisibilityScoreChart and VisibilityLeaderboard inside the
 *     visibility-headline section.
 *   - Section order overall: CommandCenter → AIVisibilityHero →
 *     VisibilityScoreChart/Leaderboard → DoNext → LifecycleStrip →
 *     ImplementationQueue → ActionQueue → wins → MetricsDisclosure
 *     → ChangeReview.
 *   - Leaderboard heading renamed from "Visibility Score Rank" to
 *     "AI visibility leaderboard".
 *   - AreaChart hover row reserves fixed height (no layout shift /
 *     no checkbox-overlap on hover).
 *
 * Source-text invariants are the right shape here — the hero is a
 * client component with hooks; pinning the contract on copy + data
 * attributes + import paths is more robust than a brittle DOM probe.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");

const HERO_PATH = join(
  REPO_ROOT,
  "src/components/today/ai-visibility-hero.tsx",
);
const LEADERBOARD_PATH = join(
  REPO_ROOT,
  "src/components/today/visibility-leaderboard.tsx",
);
const AREA_CHART_PATH = join(
  REPO_ROOT,
  "src/components/viz/area-chart.tsx",
);

const HERO_SRC = readFileSync(HERO_PATH, "utf-8");
const LEADERBOARD_SRC = readFileSync(LEADERBOARD_PATH, "utf-8");
const AREA_CHART_SRC = readFileSync(AREA_CHART_PATH, "utf-8");

/** Strip block + line + JSX comments + import lines so JSDoc that
 *  references prior naming doesn't false-positive negative pins. */
function stripCommentsAndImports(src: string): string {
  return src
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "")
    .replace(/^\s*import\s+[^;]+;\s*$/gm, "")
    .replace(/^\s*import\s*\{[\s\S]*?\}\s*from\s*[^;]+;\s*$/gm, "");
}

// ---------------------------------------------------------------------------
// Hero file exists + correct exports
// ---------------------------------------------------------------------------

describe("UX.6.3 — AIVisibilityHero file exists and exports the public surface", () => {
  it("file exists at the expected path", () => {
    expect(existsSync(HERO_PATH)).toBe(true);
  });

  it("exports AIVisibilityHero component + AIVisibilityHeroProps type", () => {
    expect(HERO_SRC).toMatch(/export\s+function\s+AIVisibilityHero\s*\(/);
    expect(HERO_SRC).toMatch(/export\s+type\s+AIVisibilityHeroProps\s*=/);
  });
});

describe("UX.6.3 — hero is pure presentation (no client interactivity / no I/O)", () => {
  it("does NOT use client hooks for state / effects / transitions", () => {
    expect(HERO_SRC).not.toMatch(/\buseState\b/);
    expect(HERO_SRC).not.toMatch(/\buseEffect\b/);
    expect(HERO_SRC).not.toMatch(/\buseTransition\b/);
    expect(HERO_SRC).not.toMatch(/\buseReducer\b/);
  });

  it("does NOT register event handlers", () => {
    expect(HERO_SRC).not.toMatch(/onClick=/);
    expect(HERO_SRC).not.toMatch(/onSubmit=/);
    expect(HERO_SRC).not.toMatch(/onChange=/);
  });

  it("does NOT call fetch / paid APIs / runners", () => {
    expect(HERO_SRC).not.toMatch(/\bfetch\(/);
    expect(HERO_SRC).not.toMatch(/from\s+["']openai["']/);
    expect(HERO_SRC).not.toMatch(/from\s+["']@anthropic/);
    expect(HERO_SRC).not.toContain("runNativePoll");
    expect(HERO_SRC).not.toContain("runWebsiteScan");
    expect(HERO_SRC).not.toMatch(/from\s+["']@\/adapters\//);
  });

  it("does NOT mutate any persisted store", () => {
    expect(HERO_SRC).not.toMatch(/\.upsert\(/);
    expect(HERO_SRC).not.toMatch(/\.insert\(/);
    expect(HERO_SRC).not.toMatch(/\.update\(/);
    expect(HERO_SRC).not.toMatch(/\.delete\(/);
  });

  it("is not marked 'use client' (server-renderable, no hooks)", () => {
    expect(HERO_SRC).not.toMatch(/^"use client"/m);
  });
});

describe("UX.6.3 — hero owns the executive copy + 4 metric cards + footer", () => {
  it("renders the 'AI Visibility' executive header + brand-name copy template", () => {
    expect(HERO_SRC).toContain("AI Visibility");
    // Dynamic brand-name interpolation in the copy (not a hardcoded brand).
    // Bundle 2 hosted-verification fix (2026-05-11): the verb is a
    // `${verbAppears}` interpolation so "You" subjects pluralize correctly.
    // audit-4 (2026-06-22): the subline is now a template-literal inside a
    // conditional — `How often ${brandName} ${verbAppears} across tracked AI
    // answers ...` is the HAS-DATA branch; with no sampled data the hero shows
    // "AI answers Beacon has sampled for ${brandName}." instead of asserting
    // active tracking. Pin the has-data template shape (a plain-meaning
    // clarifier may follow "answers", e.g. "(higher is better; 20% to 40% is
    // typical)", so the trailing period is not anchored).
    expect(HERO_SRC).toMatch(
      /How often \$\{brandName\} \$\{verbAppears\} across tracked AI answers/,
    );
  });

  it("data attributes on the section + lead + 4 metric cards + platforms footer", () => {
    expect(HERO_SRC).toMatch(/data-today-section="ai-visibility-hero"/);
    expect(HERO_SRC).toMatch(/data-today-hero-lead="true"/);
    // The metric cards consume the dataAttr prop — pin both the
    // attribute usage at the render site AND the four canonical
    // values passed as props by the parent.
    expect(HERO_SRC).toMatch(/data-today-hero-metric=\{dataAttr\}/);
    expect(HERO_SRC).toMatch(/dataAttr="score"/);
    expect(HERO_SRC).toMatch(/dataAttr="rank"/);
    expect(HERO_SRC).toMatch(/dataAttr="closest-challenger"/);
    expect(HERO_SRC).toMatch(/dataAttr="sample"/);
    expect(HERO_SRC).toMatch(/data-today-hero-platforms="true"/);
    expect(HERO_SRC).toMatch(/data-today-hero-platform="chatgpt"/);
    expect(HERO_SRC).toMatch(/data-today-hero-platform="perplexity"/);
  });

  it("lead sentence template uses '<verb> #N across tracked AI answers' framing", () => {
    // Bundle 2 hosted-verification fix (2026-05-11): the verb is now
    // a `${verbIs}` interpolation so "You" subjects produce
    // "You are #N..." instead of "You is #N...". Source template
    // shape: `${brandName} ${verbIs} #${rank} across tracked AI
    // answers.` Match the new shape; pin the legacy literal as a
    // negative invariant so a future regression to "is #${rank}"
    // fails CI.
    expect(HERO_SRC).toMatch(
      /\$\{verbIs\} #\$\{rank\} across tracked AI answers\./,
    );
    expect(HERO_SRC).not.toMatch(/\bis #\$\{rank\}/);
    // First-reading fallback when rank is null.
    expect(HERO_SRC).toMatch(
      /\$\{verbIs\} being tracked across AI answers\./,
    );
    expect(HERO_SRC).not.toMatch(/\bis being tracked across AI answers/);
  });

  it("score metric subline uses 'pts in this window' shape (Phase 2B alignment)", () => {
    // Phase 2B follow-up (2026-05-13): delta semantic flipped from
    // "vs previous Nd" (leaderboard's prev-window delta) to "latest
    // minus earliest within this window" (matches the chart's
    // headline delta). The copy follows the math. Old text remains
    // banned as a regression pin.
    expect(HERO_SRC).toMatch(/pts in this window/);
    expect(HERO_SRC).not.toMatch(/pts vs previous \$\{windowDays\}d/);
  });

  it("delta=null path uses honest 'limited data' copy (not fabricated 0)", () => {
    expect(HERO_SRC).toMatch(/limited data/);
  });

  it("does not leak internal jargon in the rendered copy strings", () => {
    const code = stripCommentsAndImports(HERO_SRC);
    expect(code).not.toMatch(/\bcron\b/i);
    expect(code).not.toMatch(/\bSupabase\b/i);
    expect(code).not.toMatch(/\bSQL\b/);
    expect(code).not.toMatch(/\bUTC\b/);
    expect(code).not.toMatch(/\bRLS\b/);
    expect(code).not.toMatch(/\bschema\b/i);
    expect(code).not.toMatch(/\btenant_id\b/);
    expect(code).not.toMatch(/\bobservation_run\b/);
  });
});


// ---------------------------------------------------------------------------
// Leaderboard heading rename
// ---------------------------------------------------------------------------

describe("UX.6.3 — visibility leaderboard heading renamed", () => {
  it("renders 'AI visibility leaderboard' (NOT the old 'Visibility Score Rank')", () => {
    expect(LEADERBOARD_SRC).toContain("AI visibility leaderboard");
    // Negative pin: the old heading must be gone from runtime JSX.
    const code = stripCommentsAndImports(LEADERBOARD_SRC);
    expect(code).not.toContain("Visibility Score Rank");
    expect(code).not.toContain("Who gets mentioned most often in your topic");
  });

  it("subtitle clarifies the tracked-set framing (post-2026-05-12 polish)", () => {
    // QA polish (2026-05-12): subtitle moved from "Who AI mentions
    // most across tracked answers" (ambiguous — "tracked" reading
    // as adjective on "answers", not on the brand set) to the new
    // form "Who AI mentions most among the brands you track"
    // (possessive frames the set as the customer's tracked brands).
    expect(LEADERBOARD_SRC).toContain(
      "Who AI mentions most among the brands you track",
    );
    // Negative pin against the ambiguous pre-polish phrasing.
    const code = LEADERBOARD_SRC
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toContain("Who AI mentions most across tracked answers");
  });
});

// ---------------------------------------------------------------------------
// AreaChart hover layout-shift fix
// ---------------------------------------------------------------------------

describe("UX.6.3 — AreaChart hover row reserves fixed height (no checkbox jump)", () => {
  it("renders a stable hover row with min-h regardless of hoverIdx", () => {
    // The row must be present unconditionally with a min-height — the
    // CONTENT inside is conditional on `hoverIdx !== null`.
    expect(AREA_CHART_SRC).toMatch(
      /data-area-chart-hover-row="true"/,
    );
    expect(AREA_CHART_SRC).toMatch(/min-h-\[14px\]/);
  });

  it("the old conditionally-rendered tooltip shape is gone", () => {
    // Pre-fix: `{hoverIdx !== null && (<div className="mt-1 ...">...)`
    // — the WHOLE wrapper was conditional, so the tooltip's height
    // pushed the parent height up/down each hover. Pin its absence.
    expect(AREA_CHART_SRC).not.toMatch(
      /\{hoverIdx !== null &&\s*\(\s*\n?\s*<div className="mt-1 flex flex-wrap/,
    );
  });
});
