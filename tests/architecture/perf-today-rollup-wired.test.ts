/**
 * Perf bundle 3 (2026-05-12) — source-level guardrails.
 *
 * Pins the rollup wiring so a future edit can't accidentally drop a
 * `rollup` arg from one of the fan-out call sites and silently
 * regress /today back to ~947 ms warm.
 *
 *   • `today-data.ts` imports `buildObservationRollup` and builds it
 *     ONCE before the visibility-score fan-out.
 *   • Each of the 4 public visibility-score call sites in `today-data.ts`
 *     receives the rollup as a keyword argument.
 *   • `visibility-score.ts` exposes the optional `rollup?` arg on each
 *     of the 4 public functions.
 *   • The rollup module exists and exports the named builder + types.
 *   • The rollup module is server-pure: no Supabase, no fetch, no
 *     `server-only` (the latter would pin it to server contexts only,
 *     which is fine but not required — the function itself is pure).
 *
 * Source-level checks — they survive JSX refactors and don't need
 * Supabase credentials.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");

function read(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), "utf8");
}

function stripComments(src: string): string {
  return src.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("Per-request observation rollup: module surface", () => {
  const src = read("src/domains/today/observation-rollup.ts");

  it("exports buildObservationRollup builder", () => {
    expect(src).toMatch(
      /export\s+function\s+buildObservationRollup\s*\(\s*opts:\s*\{/,
    );
  });

  it("exports the public ObservationRollup type", () => {
    expect(src).toMatch(/export\s+type\s+ObservationRollup\b/);
  });

  it("exports slugifyEntity (single source of truth shared with visibility-score)", () => {
    expect(src).toMatch(/export\s+function\s+slugifyEntity\(/);
  });

  it("is pure — no Supabase / repository / fetch imports", () => {
    const stripped = stripComments(src);
    expect(stripped).not.toMatch(/from\s+["']@\/lib\/persistence\//);
    expect(stripped).not.toMatch(/getSupabaseAdmin/);
    expect(stripped).not.toMatch(/\bfetch\(/);
  });

  it("does not register a module-level cache", () => {
    const stripped = stripComments(src);
    // No top-level cache or Map/global storing rollups across requests.
    expect(stripped).not.toMatch(/^const\s+\w+\s*=\s*new Map\b/m);
    expect(stripped).not.toMatch(/\bcache\(/);
  });
});

describe("visibility-score: optional rollup fast path on 4 public functions", () => {
  const src = read("src/domains/product/visibility-score.ts");

  it("imports the ObservationRollup type", () => {
    expect(src).toMatch(
      /import\s+type\s+\{\s*ObservationRollup\s*\}\s+from\s+["']@\/domains\/today\/observation-rollup["']/,
    );
  });

  it("computeVisibilityTimeSeries accepts optional rollup", () => {
    expect(src).toMatch(
      /export\s+function\s+computeVisibilityTimeSeries\s*\([\s\S]*?rollup\?:\s*ObservationRollup/,
    );
  });

  it("computeVisibilityTimeSeriesByPlatform accepts optional rollup", () => {
    expect(src).toMatch(
      /export\s+function\s+computeVisibilityTimeSeriesByPlatform\s*\([\s\S]*?rollup\?:\s*ObservationRollup/,
    );
  });

  it("computeLeaderboard accepts optional rollup", () => {
    expect(src).toMatch(
      /export\s+function\s+computeLeaderboard\s*\([\s\S]*?rollup\?:\s*ObservationRollup/,
    );
  });

  it("computeCompetitorSeries accepts optional rollup AND propagates it to inner calls", () => {
    expect(src).toMatch(
      /export\s+function\s+computeCompetitorSeries\s*\([\s\S]*?rollup\?:\s*ObservationRollup/,
    );
    // The brand + competitor inner calls each forward `rollup: opts.rollup`.
    expect(src).toMatch(
      /computeCompetitorSeries[\s\S]*?const\s+brand\s*=[\s\S]*?rollup:\s*opts\.rollup/,
    );
    expect(src).toMatch(
      /computeCompetitorSeries[\s\S]*?competitors[\s\S]*?rollup:\s*opts\.rollup/,
    );
  });
});

describe("today-data: builds the rollup once and threads it through fan-out", () => {
  const src = read("src/app/(shell)/today-data.ts");

  it("imports buildObservationRollup", () => {
    expect(src).toMatch(
      /import\s+\{\s*buildObservationRollup\s*\}\s+from\s+["']@\/domains\/today\/observation-rollup["']/,
    );
  });

  it("builds the rollup exactly once per render", () => {
    // Single call site bound to a const. Negative pin: no duplicate
    // `buildObservationRollup(` later in the file.
    const matches = src.match(/buildObservationRollup\s*\(/g) ?? [];
    expect(matches.length).toBe(1);
    expect(src).toMatch(
      /const\s+observationRollup\s*=\s*buildObservationRollup\(/,
    );
  });

  it("computeVisibilityTimeSeries call site forwards the rollup", () => {
    expect(src).toMatch(
      /computeVisibilityTimeSeries\(\s*\{[\s\S]*?rollup:\s*observationRollup[\s\S]*?\}\s*\)/,
    );
  });

  it("computeVisibilityTimeSeriesByPlatform call site forwards the rollup", () => {
    expect(src).toMatch(
      /computeVisibilityTimeSeriesByPlatform\(\s*\{[\s\S]*?rollup:\s*observationRollup[\s\S]*?\}\s*\)/,
    );
  });

  it("computeLeaderboard call site forwards the rollup", () => {
    expect(src).toMatch(
      /computeLeaderboard\(\s*\{[\s\S]*?rollup:\s*observationRollup[\s\S]*?\}\s*\)/,
    );
  });

  it("computeCompetitorSeries call site forwards the rollup", () => {
    expect(src).toMatch(
      /computeCompetitorSeries\(\s*\{[\s\S]*?rollup:\s*observationRollup[\s\S]*?\}\s*\)/,
    );
  });
});

describe("Perf bundle 4 (2026-05-12) — additive rollup fields + 2 inline-loop migrations", () => {
  const rollupSrc = read("src/domains/today/observation-rollup.ts");
  const todayDataSrc = read("src/app/(shell)/today-data.ts");

  it("ObservationRollup exposes latestObservedAt: string | null", () => {
    expect(rollupSrc).toMatch(
      /latestObservedAt:\s*string\s*\|\s*null/,
    );
  });

  it("ObservationRollup exposes mentionCountsByOriginalName ReadonlyMap", () => {
    expect(rollupSrc).toMatch(
      /mentionCountsByOriginalName:\s*ReadonlyMap<string,\s*number>/,
    );
  });

  it("today-data.ts derives lastObservationAt from observationRollup.latestObservedAt", () => {
    expect(todayDataSrc).toMatch(
      /const\s+lastObservationAt\s*=\s*observationRollup\.latestObservedAt\s*;/,
    );
    // Negative pin: no leftover `.reduce<string | null>` over the
    // observation array for the freshness check.
    const stripped = stripComments(todayDataSrc);
    expect(stripped).not.toMatch(
      /promptAnswerObservations\.reduce<string\s*\|\s*null>/,
    );
  });

  it("today-data.ts derives scannerTopMentioned from observationRollup.mentionCountsByOriginalName", () => {
    expect(todayDataSrc).toMatch(
      /const\s+scannerTopMentioned\s*=\s*\[\s*\.\.\.observationRollup\.mentionCountsByOriginalName\.entries\(\)/,
    );
    // Negative pin: no leftover `for (const o of promptAnswerObservations)` loop
    // building a `scannerMentionCounts` Map inline.
    const stripped = stripComments(todayDataSrc);
    expect(stripped).not.toMatch(
      /for\s*\(\s*const\s+o\s+of\s+promptAnswerObservations\s*\)\s*\{[\s\S]*?scannerMentionCounts\.set/,
    );
  });

  it("rollup builder populates both new fields in the SAME observation walk (no extra loop)", () => {
    // The builder must contain exactly ONE outer observation loop.
    // Negative pin: no second top-level `for (let obsIndex` or
    // `for (const obs of opts.observations)` inside
    // `buildObservationRollup`. Comments stripped first.
    const stripped = stripComments(rollupSrc);
    const builderBody =
      stripped.match(
        /export\s+function\s+buildObservationRollup\([\s\S]*?\n\}\n/,
      )?.[0] ?? "";
    expect(builderBody).toContain("for (let obsIndex");
    const outerForLoops =
      builderBody.match(/^\s*for\s*\(\s*let\s+obsIndex/gm) ?? [];
    expect(outerForLoops.length).toBe(1);
  });
});
