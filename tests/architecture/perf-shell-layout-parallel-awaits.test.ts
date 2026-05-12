/**
 * Perf bundle 6 (2026-05-12) — shell layout parallelization pin.
 *
 * The production audit found `src/app/(shell)/layout.tsx` had FIVE
 * sequential awaits that fire on every signed-in click:
 *   await ensureUrlChangeOutcomesSeeded();
 *   const pendingFindings = await getPendingFindings();
 *   const watching = await getWatchingUrlOutcomes();
 *   const isDemoMode = !(await hasActiveExperiment());
 *   const changelogEntries = await getChangelogEntries();
 * The first four are data-independent; only `getWatchingUrlOutcomes`
 * uses the seed populated by `ensureUrlChangeOutcomesSeeded`. The fix
 * collapses the four independent reads into a single `Promise.all`,
 * then awaits `getWatchingUrlOutcomes` after.
 *
 * This guardrail prevents a future edit from accidentally
 * re-serializing them. Source-level pins survive runtime refactors
 * and don't need build env.
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

describe("Shell layout: parallel awaits (perf bundle 6)", () => {
  const src = read("src/app/(shell)/layout.tsx");
  const stripped = stripComments(src);

  it("uses a single Promise.all over the 4 independent reads", () => {
    // The destructured shape pins all four functions appear inside the
    // same Promise.all array, in any order.
    expect(stripped).toMatch(/await\s+Promise\.all\(\s*\[/);
    // Each of the 4 independent calls must appear inside a Promise.all
    // arm. We use a single regex with `[\s\S]` to span the array body.
    const promiseAllBlock = stripped.match(
      /await\s+Promise\.all\(\s*\[([\s\S]*?)\]\s*\)/,
    );
    expect(promiseAllBlock).not.toBeNull();
    const body = promiseAllBlock![1];
    expect(body).toMatch(/ensureUrlChangeOutcomesSeeded\(\s*\)/);
    expect(body).toMatch(/getPendingFindings\(\s*\)/);
    expect(body).toMatch(/hasActiveExperiment\(\s*\)/);
    expect(body).toMatch(/getChangelogEntries\(\s*\)/);
  });

  it("getWatchingUrlOutcomes is awaited AFTER the Promise.all (data-dependent on the seed)", () => {
    const promiseAllIdx = stripped.indexOf("await Promise.all");
    const watchingIdx = stripped.indexOf("await getWatchingUrlOutcomes(");
    expect(promiseAllIdx).toBeGreaterThan(0);
    expect(watchingIdx).toBeGreaterThan(0);
    expect(watchingIdx).toBeGreaterThan(promiseAllIdx);
  });

  it("no leftover separate `await ensureUrlChangeOutcomesSeeded()` outside the Promise.all", () => {
    // Negative pin: only ONE call site total. Either inside Promise.all
    // (matches above) or as a separate await (would re-serialize).
    const matches =
      stripped.match(/ensureUrlChangeOutcomesSeeded\s*\(/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it("no leftover separate `await getPendingFindings()` / `getChangelogEntries()` / `hasActiveExperiment()` outside the Promise.all", () => {
    // Each of the 4 independent calls must appear EXACTLY ONCE in the
    // file (inside the Promise.all). Multiple call sites would mean a
    // re-serialization regression.
    for (const fn of [
      "getPendingFindings",
      "hasActiveExperiment",
      "getChangelogEntries",
    ]) {
      const matches = stripped.match(new RegExp(`\\b${fn}\\s*\\(`, "g")) ?? [];
      expect(matches.length, `${fn} call sites in layout.tsx`).toBe(1);
    }
  });

  it("layout still exports default async ShellLayout (signature unchanged)", () => {
    expect(stripped).toMatch(
      /export\s+default\s+async\s+function\s+ShellLayout\s*\(/,
    );
  });

  it("badge + palette construction inputs are wired from the awaited values", () => {
    // The 4 results flow into badges/palette. Pin the read sites so a
    // future edit can't drop one accidentally.
    expect(stripped).toMatch(/pendingFindings\.filter\(/);
    expect(stripped).toMatch(/watchingUrlOutcomes\.filter\(/);
    expect(stripped).toMatch(/!isDemoModeRaw/);
    expect(stripped).toMatch(/changelogEntries\.length/);
  });
});
