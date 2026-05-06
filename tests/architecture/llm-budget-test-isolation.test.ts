/**
 * Architecture invariant — tests writing to global persistence stores
 * MUST be hermetically isolated from the operator's real `.data/`.
 *
 * Background: LLM-LiveRegen-2 verification (2026-05-05) found that
 * `tests/domains/recommendations/adjudicate.test.ts:cleanupTestStores`
 * called `writeStore("llm-budget", [])` against the project's REAL
 * `.data/global/llm-budget.json`. Every `npm run test` between
 * LiveRegen-1 and LiveRegen-2 silently clobbered the operator's
 * monthly LLM budget ledger, undermining the live-regen budget
 * safety rail.
 *
 * The fix lives in the test files themselves (mkdtemp + chdir +
 * afterEach restore — the same pattern `src/adapters/perplexity/
 * poll.test.ts` uses for `cost-ledger.json`). This invariant pins
 * the contract forward: ANY test that writes a GLOBAL_STORES name
 * via `writeStore(...)` MUST be wrapped in a hermetic chdir, OR
 * stub the store module entirely via `vi.mock(...)`. A regression
 * fails this test loudly before another LR cycle can lose budget
 * accounting.
 *
 * Scope of "global stores" mirrors `src/lib/persistence/store-
 * classification.ts:GLOBAL_STORES`. The four stores most at risk:
 *   - llm-budget                  (paid LLM monthly cap)
 *   - adjudicator-cache           (LLM dedup cache)
 *   - adjudicator-history         (LLM call audit log)
 *   - llm-history-specific-edits  (Specific Edit LLM call audit log)
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");

/**
 * Global-store names that, if written by a test against the real cwd,
 * would clobber operator state outside the test's intended scope.
 */
const GLOBAL_STORE_NAMES = [
  "llm-budget",
  "adjudicator-cache",
  "adjudicator-history",
  "llm-history-specific-edits",
] as const;

/**
 * Walk a directory recursively for `*.test.ts` / `*.test.tsx` files.
 */
function walkTests(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      // Skip noisy / out-of-scope dirs.
      if (entry === "node_modules" || entry === ".next" || entry.startsWith("."))
        continue;
      walkTests(full, out);
    } else if (
      st.isFile() &&
      (full.endsWith(".test.ts") || full.endsWith(".test.tsx"))
    ) {
      out.push(full);
    }
  }
  return out;
}

const TEST_FILES = [
  ...walkTests(join(REPO_ROOT, "tests")),
  ...walkTests(join(REPO_ROOT, "src")),
];

/**
 * Detect whether a test source contains a hermetic isolation pattern
 * sufficient to keep `writeStore(...)` from touching the real
 * `<repo>/.data/`. We look for either:
 *   1. mkdtempSync / mkdtemp + process.chdir(...) — the chdir-to-
 *      tmpdir pattern used by perplexity poll tests + the new
 *      adjudicate fix.
 *   2. vi.mock("@/lib/persistence/json-store", ...) — the test stubs
 *      the module entirely, so its writeStore is a mock that doesn't
 *      hit disk.
 *   3. vi.mock("@/domains/recommendations/adjudicator-budget", ...)
 *      AND vi.mock("@/domains/recommendations/adjudicator-history", ...)
 *      etc. — module-level mocks for each persistence helper.
 */
function isHermeticallyIsolated(src: string): boolean {
  const hasMkdtempChdir =
    /mkdtemp(?:Sync)?\s*\(/.test(src) && /process\.chdir\s*\(/.test(src);
  const mocksJsonStore = /vi\.mock\(["']@\/lib\/persistence\/json-store["']/.test(
    src,
  );
  const mocksAdjudicatorBudget =
    /vi\.mock\(["']@\/domains\/recommendations\/adjudicator-budget["']/.test(
      src,
    );
  return hasMkdtempChdir || mocksJsonStore || mocksAdjudicatorBudget;
}

/**
 * Detect whether a test source actually writes to a global store. We
 * look for a `writeStore(` call followed (within ~120 chars, allowing
 * line wrapping) by a global store name as a string literal.
 */
function findGlobalStoreWrites(src: string): string[] {
  const hits: string[] = [];
  for (const name of GLOBAL_STORE_NAMES) {
    // Patterns:
    //   writeStore("llm-budget", ...)
    //   writeStore('llm-budget', ...)
    //   writeStore(s, [])  ← where s loops over a list that includes the name
    // The literal-call shape is the dangerous one. The s-loop shape is
    // also dangerous IF the loop list contains the store name as a
    // string literal IN THE SAME FILE.
    const literalCall = new RegExp(
      `writeStore\\s*\\(\\s*["']${name}["']\\s*,`,
    );
    if (literalCall.test(src)) {
      hits.push(`writeStore("${name}", …)`);
      continue;
    }
    // Loop-shape: `writeStore(s, …)` plus the store name appears as a
    // string literal somewhere else in the file. This is a heuristic;
    // tighten if false positives appear.
    const loopCall = /writeStore\s*\(\s*[a-zA-Z_$][\w$]*\s*,/.test(src);
    const nameLiteral = new RegExp(`["']${name}["']`);
    if (loopCall && nameLiteral.test(src)) {
      hits.push(
        `writeStore(<var>, …) with "${name}" in the source (loop over store list)`,
      );
    }
  }
  return [...new Set(hits)];
}

describe("Architecture — tests writing to global stores must be hermetically isolated", () => {
  it(`all ${TEST_FILES.length} test files compiled and read`, () => {
    expect(TEST_FILES.length).toBeGreaterThan(50);
  });

  for (const file of TEST_FILES) {
    const src = readFileSync(file, "utf-8");
    const writes = findGlobalStoreWrites(src);
    if (writes.length === 0) continue;

    const relPath = file.slice(REPO_ROOT.length + 1);
    it(`${relPath} is hermetically isolated (${writes.length} global-store write(s) detected)`, () => {
      expect(
        isHermeticallyIsolated(src),
        `${relPath} writes to a global persistence store ` +
          `(${writes.join(", ")}) but does NOT appear hermetically isolated. ` +
          `Add a beforeEach hook that mkdtemps a tmpdir and process.chdirs ` +
          `into it (mirror src/adapters/perplexity/poll.test.ts), or ` +
          `vi.mock("@/lib/persistence/json-store" or " ...adjudicator-budget") ` +
          `so writeStore never reaches the operator's real .data/.\n\n` +
          `LLM-LiveRegen-2 verification surfaced the original instance of ` +
          `this bug — adjudicate.test.ts clobbered .data/global/llm-budget.json ` +
          `between LiveRegen-1 and LiveRegen-2 and erased the LR-1 monthly ` +
          `spend. This invariant pins the fix forward.`,
      ).toBe(true);
    });
  }
});

describe("Architecture — the canonical hermetic pattern is reachable from the fixed file", () => {
  it("adjudicate.test.ts has the chdir-to-mkdtemp pattern", () => {
    const src = readFileSync(
      join(REPO_ROOT, "tests/domains/recommendations/adjudicate.test.ts"),
      "utf-8",
    );
    expect(/mkdtempSync\s*\(/.test(src)).toBe(true);
    expect(/process\.chdir\s*\(\s*workdir\s*\)/.test(src)).toBe(true);
    expect(/process\.chdir\s*\(\s*ORIGINAL_CWD\s*\)/.test(src)).toBe(true);
  });

  it("adjudicate-cache-only.test.ts has the chdir-to-mkdtemp pattern", () => {
    const src = readFileSync(
      join(REPO_ROOT, "tests/domains/recommendations/adjudicate-cache-only.test.ts"),
      "utf-8",
    );
    expect(/mkdtempSync\s*\(/.test(src)).toBe(true);
    expect(/process\.chdir\s*\(\s*workdir\s*\)/.test(src)).toBe(true);
    expect(/process\.chdir\s*\(\s*ORIGINAL_CWD\s*\)/.test(src)).toBe(true);
  });

  it("DATA_DIR is resolved LAZILY in adjudicate.test.ts cleanupTestStores (post-fix)", () => {
    const src = readFileSync(
      join(REPO_ROOT, "tests/domains/recommendations/adjudicate.test.ts"),
      "utf-8",
    );
    // Old shape was a top-level `const DATA_DIR = path.resolve(process.cwd(), ".data");`
    // captured at module import (before any chdir). The fixed shape uses
    // a function `dataDir()` that resolves `process.cwd()` per-call.
    expect(/function dataDir\(\)/.test(src)).toBe(true);
    expect(
      /const DATA_DIR\s*=\s*path\.resolve\(process\.cwd\(\)/.test(src),
      "Top-level DATA_DIR const captures the real cwd at import time, " +
        "BEFORE the file-level beforeEach can chdir into a tmpdir. The " +
        "post-fix shape uses a function so the lookup is lazy.",
    ).toBe(false);
  });
});
