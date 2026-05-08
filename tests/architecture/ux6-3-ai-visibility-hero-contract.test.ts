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
const TODAY_CLIENT_PATH = join(
  REPO_ROOT,
  "src/app/(shell)/today-client.tsx",
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
const TODAY_CLIENT_SRC = readFileSync(TODAY_CLIENT_PATH, "utf-8");
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
    expect(HERO_SRC).toMatch(
      /How often \{brandName\} appears across tracked AI answers\./,
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

  it("lead sentence template uses 'is #N across tracked AI answers' framing", () => {
    expect(HERO_SRC).toMatch(/is #\$\{rank\} across tracked AI answers\./);
    // First-reading fallback when rank is null.
    expect(HERO_SRC).toMatch(
      /is being tracked across AI answers\./,
    );
  });

  it("score metric subline uses 'pts vs previous Nd' shape", () => {
    expect(HERO_SRC).toMatch(/pts vs previous \$\{windowDays\}d/);
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
// today-client wiring: derives props + renders hero in correct source order
// ---------------------------------------------------------------------------

describe("UX.6.3 — today-client.tsx wires the hero correctly", () => {
  it("imports AIVisibilityHero from the hero module", () => {
    expect(TODAY_CLIENT_SRC).toMatch(
      /import\s+\{\s*AIVisibilityHero\s*\}\s+from\s+["']@\/components\/today\/ai-visibility-hero["']/,
    );
  });

  it("derives aiVisibilityHeroProps in a useMemo over visibilityData + enrichmentV2", () => {
    expect(TODAY_CLIENT_SRC).toMatch(
      /const\s+aiVisibilityHeroProps\s*=\s*useMemo\(/,
    );
    // Source-text proof that the memo's dep list includes both inputs
    // (so the hero re-binds when the chart window changes OR when
    // enrichmentV2 sparklines refresh).
    expect(TODAY_CLIENT_SRC).toMatch(
      /\}, \[visibilityData, visibilityWindow, enrichmentV2\]\)/,
    );
  });

  it("renders <AIVisibilityHero> inside the visibility-headline section, ABOVE chart + leaderboard", () => {
    const heroIdx = TODAY_CLIENT_SRC.indexOf("<AIVisibilityHero");
    const chartIdx = TODAY_CLIENT_SRC.indexOf("<VisibilityScoreChart");
    const leaderboardIdx = TODAY_CLIENT_SRC.indexOf(
      "<VisibilityLeaderboard",
    );
    expect(heroIdx).toBeGreaterThan(-1);
    expect(chartIdx).toBeGreaterThan(-1);
    expect(leaderboardIdx).toBeGreaterThan(-1);
    expect(heroIdx).toBeLessThan(chartIdx);
    expect(heroIdx).toBeLessThan(leaderboardIdx);
  });

  it("hero is gated by aiVisibilityHeroProps != null (no orphan render when first-reading)", () => {
    expect(TODAY_CLIENT_SRC).toMatch(
      /\{aiVisibilityHeroProps\s*&&\s*\(\s*\n?\s*<AIVisibilityHero/,
    );
  });

  it("preserves overall section order: CC → visibility-headline → DoNext → strip → impl → AQ → wins → metrics → ChangeReview", () => {
    const ccIdx = TODAY_CLIENT_SRC.indexOf("<CommandCenter");
    const visIdx = TODAY_CLIENT_SRC.indexOf(
      'data-today-section="visibility-headline"',
    );
    const doNextIdx = TODAY_CLIENT_SRC.indexOf("<TodayDoNextCard");
    const stripIdx = TODAY_CLIENT_SRC.indexOf("<TodayLifecycleStrip");
    const implIdx = TODAY_CLIENT_SRC.indexOf("<TodayImplementationQueue");
    const queueIdx = TODAY_CLIENT_SRC.indexOf("<TodayActionQueue");
    const winsIdx = TODAY_CLIENT_SRC.indexOf('data-today-section="wins"');
    const metricsIdx = TODAY_CLIENT_SRC.indexOf("<TodayMetricsDisclosure");
    const changeReviewIdx = TODAY_CLIENT_SRC.indexOf("<ChangeReview");
    expect(ccIdx).toBeGreaterThan(-1);
    expect(visIdx).toBeGreaterThan(ccIdx);
    expect(doNextIdx).toBeGreaterThan(visIdx);
    expect(stripIdx).toBeGreaterThan(doNextIdx);
    expect(implIdx).toBeGreaterThan(stripIdx);
    expect(queueIdx).toBeGreaterThan(implIdx);
    expect(winsIdx).toBeGreaterThan(queueIdx);
    expect(metricsIdx).toBeGreaterThan(winsIdx);
    expect(changeReviewIdx).toBeGreaterThan(metricsIdx);
  });

  it("hero derive helper does not introduce paid-API calls or unbounded reads", () => {
    // Capture the useMemo body specifically.
    const memo = TODAY_CLIENT_SRC.match(
      /const\s+aiVisibilityHeroProps\s*=\s*useMemo\([\s\S]*?\}, \[visibilityData, visibilityWindow, enrichmentV2\]\)/,
    );
    expect(memo).toBeTruthy();
    if (!memo) return;
    const body = memo[0];
    expect(body).not.toMatch(/\bfetch\(/);
    expect(body).not.toMatch(/from\s+["']@\/adapters\//);
    expect(body).not.toContain("runNativePoll");
    expect(body).not.toContain("runWebsiteScan");
    expect(body).not.toMatch(/\.upsert\(/);
    expect(body).not.toMatch(/\.insert\(/);
    expect(body).not.toMatch(/\.update\(/);
    expect(body).not.toMatch(/\.delete\(/);
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

  it("subtitle uses the new 'Who AI mentions most across tracked answers' copy", () => {
    expect(LEADERBOARD_SRC).toContain(
      "Who AI mentions most across tracked answers",
    );
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
