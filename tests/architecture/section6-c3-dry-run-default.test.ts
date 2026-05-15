/**
 * Architecture invariant — Section 6 C3 / operator-script safety
 * convention (2026-05-15).
 *
 * The Section 6 C3 backfill script
 * (`scripts/backfill-section6-primary-recommendation.ts`) MUST default
 * to dry-run mode and require an explicit `--commit` flag to write.
 * Lifts the Phase 2A operator-script convention
 * (`scripts/backfill-snapshot-extensions.ts`) to an architecture
 * invariant; protects future drive-by edits from flipping default-write
 * semantics.
 *
 * Coverage:
 *   1. parseArgs initializes commit to false BEFORE walking argv.
 *   2. parseArgs handles the literal `--commit` flag (the only path
 *      that flips commit to true).
 *   3. The script's runBackfill main body gates every write call site
 *      behind `args.commit` (no unconditional applyExistingUpdate or
 *      applyPromptUpserts invocation).
 *   4. The default C3Args has `commit: false`.
 *   5. Source contains the exact phrase "DRY-RUN" in the runtime mode
 *      label (helps operator confirm safety before commit).
 *
 * Retirement: permanent. Operator-script dry-run-default is a floor.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const SCRIPT_PATH = resolve(
  REPO_ROOT,
  "scripts/backfill-section6-primary-recommendation.ts",
);
const SCRIPT_SRC = readFileSync(SCRIPT_PATH, "utf-8");

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const ACTIVE_SRC = stripComments(SCRIPT_SRC);

describe("Architecture — Section 6 C3 backfill: dry-run default (operator safety)", () => {
  it("parseArgs initializes the partial state with commit: false", () => {
    // Look for the literal partial init inside parseArgs.
    expect(ACTIVE_SRC).toMatch(/commit:\s*false/);
  });

  it("parseArgs handles --commit as the explicit opt-in flag", () => {
    // Source must include the literal flag string + an assignment to
    // commit = true. Both must be inside parseArgs (the only place
    // commit is mutated).
    expect(ACTIVE_SRC).toMatch(/"--commit"/);
    expect(ACTIVE_SRC).toMatch(/out\.commit\s*=\s*true/);
  });

  it("runBackfill gates write call sites behind args.commit", () => {
    // The runBackfill body MUST contain the `if (!args.commit)` early
    // return BEFORE any write loop. Pin the literal guard.
    expect(ACTIVE_SRC).toMatch(/if\s*\(\s*!\s*args\.commit\s*\)/);

    // No write call (applyExistingUpdate / applyPromptUpserts) is
    // invoked OUTSIDE the commit-gated block. Concretely: every
    // `deps.applyExistingUpdate(` or `deps.applyPromptUpserts(`
    // call must appear AFTER the `if (!args.commit) { ... return }`
    // line in source order.
    const commitGuardIdx = ACTIVE_SRC.search(
      /if\s*\(\s*!\s*args\.commit\s*\)/,
    );
    expect(commitGuardIdx).toBeGreaterThanOrEqual(0);

    const writeCallSites = [
      ...ACTIVE_SRC.matchAll(/deps\.applyExistingUpdate\s*\(/g),
      ...ACTIVE_SRC.matchAll(/deps\.applyPromptUpserts\s*\(/g),
    ];
    expect(writeCallSites.length).toBeGreaterThan(0);
    for (const m of writeCallSites) {
      expect(
        m.index!,
        `write call at index ${m.index} must come AFTER the args.commit guard at index ${commitGuardIdx}`,
      ).toBeGreaterThan(commitGuardIdx);
    }
  });

  it("the dry-run early-return prints DRY-RUN complete before short-circuiting", () => {
    expect(ACTIVE_SRC).toMatch(/DRY-RUN\s+complete/);
    expect(ACTIVE_SRC).toMatch(/Pass\s+--commit\s+to\s+apply/);
  });

  it("the mode label literal includes both DRY-RUN and COMMIT", () => {
    expect(ACTIVE_SRC).toMatch(/"DRY-RUN"/);
    expect(ACTIVE_SRC).toMatch(/"COMMIT"/);
  });

  it("--tenant is required (no silent env-var fallback inside parseArgs)", () => {
    // The script's tenant safety surface; pinned alongside dry-run
    // because both protect against accidental cross-tenant writes.
    expect(ACTIVE_SRC).toMatch(/--tenant=<id>\s+is\s+required/);
  });
});
