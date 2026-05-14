/**
 * Architecture invariant — Phase A.2 Step 1 (2026-05-14).
 *
 * Provenance pin for the cross-tenant brain's env gates + trust
 * thresholds. Mirrors the Phase A.1 `thresholds-provenance` pattern.
 *
 * What this invariant locks at the source-text level:
 *   1. Canonical file paths for both new modules.
 *   2. Exact env-var names (the gate contract).
 *   3. Exact numeric / literal-string values for every constant.
 *   4. The "v1 trust thresholds, tunable" comment shape.
 *   5. Module purity — neither module imports from persistence,
 *      repository, citation-lifecycle, specific-edit-evidence, or
 *      any paid-API client.
 *   6. Config module reads `process.env` only inside functions, not
 *      at module top-level. Pinning this here prevents a future
 *      "small refactor" from freezing the env at module-load time
 *      (which would break the producer's runtime gating + the test
 *      suite's mid-test env flipping).
 *
 * Retirement: refines when threshold values are revisited
 * post-validation (no scheduled retirement; gates stay; numeric
 * values tunable per operator decision).
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const CONFIG_PATH = resolve(
  REPO_ROOT,
  "src",
  "domains",
  "recommendations",
  "cross-tenant-brain",
  "config.ts",
);
const THRESHOLDS_PATH = resolve(
  REPO_ROOT,
  "src",
  "domains",
  "recommendations",
  "cross-tenant-brain",
  "thresholds.ts",
);

const CONFIG_SRC = readFileSync(CONFIG_PATH, "utf-8");
const THRESHOLDS_SRC = readFileSync(THRESHOLDS_PATH, "utf-8");

// ─────────────────────────────────────────────────────────────────────
// Canonical file paths
// ─────────────────────────────────────────────────────────────────────

describe("Architecture — brain config + thresholds provenance (Phase A.2 §3.1 / 3.3)", () => {
  it("config.ts exists at the canonical path", () => {
    expect(CONFIG_SRC.length).toBeGreaterThan(0);
  });

  it("thresholds.ts exists at the canonical path", () => {
    expect(THRESHOLDS_SRC.length).toBeGreaterThan(0);
  });

  // ─────────────────────────────────────────────────────────────────
  // Env-var names (the producer/tile gate contract)
  // ─────────────────────────────────────────────────────────────────

  it("config.ts pins the exact producer env-var name BEACON_CROSS_TENANT_BRAIN", () => {
    expect(CONFIG_SRC).toMatch(/BEACON_CROSS_TENANT_BRAIN/);
  });

  it("config.ts pins the exact tile env-var name BEACON_BRAIN_LEARNED_TILE", () => {
    expect(CONFIG_SRC).toMatch(/BEACON_BRAIN_LEARNED_TILE/);
  });

  it("config.ts exports isCrossTenantProducerEnabled and isBrainLearnedTileEnabled", () => {
    expect(CONFIG_SRC).toMatch(
      /export\s+function\s+isCrossTenantProducerEnabled\s*\(/,
    );
    expect(CONFIG_SRC).toMatch(
      /export\s+function\s+isBrainLearnedTileEnabled\s*\(/,
    );
  });

  it("config.ts gates are strict-'1' (only the literal string '1' enables)", () => {
    // Both gates compare with the literal '1' string. A future
    // refactor that uses `?? false` or `Boolean(process.env.X)` would
    // silently accept truthy strings like 'true' / 'yes' and trip
    // this pin.
    const stripped = CONFIG_SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(
      /^\s*\/\/.*$/gm,
      "",
    );
    expect(stripped).toMatch(
      /process\.env\[\s*PRODUCER_ENV_VAR\s*\]\s*===\s*["']1["']/,
    );
    expect(stripped).toMatch(
      /process\.env\[\s*LEARNED_TILE_ENV_VAR\s*\]\s*===\s*["']1["']/,
    );
  });

  // ─────────────────────────────────────────────────────────────────
  // Read-at-call-time contract — no top-level frozen env constants
  // ─────────────────────────────────────────────────────────────────

  it("config.ts does NOT freeze the env at module-load time", () => {
    // Forbid top-level `const X = process.env.Y` patterns. The
    // module-level constants `PRODUCER_ENV_VAR` / `LEARNED_TILE_ENV_VAR`
    // are NAMES (string literals), not env READS — they're fine.
    // What we forbid: a literal `process.env` reference outside any
    // function body. Architecture invariant tooling-side: strip
    // comments first so the docstring text doesn't trip the regex.
    const stripped = CONFIG_SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(
      /^\s*\/\/.*$/gm,
      "",
    );
    // Every `process.env` reference must be inside a function body.
    // Scan: split on function declarations; the part BEFORE the
    // first `function` keyword must not contain `process.env`.
    const beforeFirstFn = stripped.split(/\bfunction\b/)[0];
    expect(
      beforeFirstFn,
      "config.ts has a top-level process.env read — this freezes the env at import time and breaks test mocking",
    ).not.toMatch(/process\.env\b/);
  });

  // ─────────────────────────────────────────────────────────────────
  // thresholds.ts — locked constant values + literal types
  // ─────────────────────────────────────────────────────────────────

  it('thresholds.ts pins BRAIN_SAMPLE_THRESHOLDS with llm_packet: 5, customer_tile: 10, threshold_replacement: 20', () => {
    expect(THRESHOLDS_SRC).toMatch(
      /export\s+const\s+BRAIN_SAMPLE_THRESHOLDS\s*=/,
    );
    expect(THRESHOLDS_SRC).toMatch(/llm_packet\s*:\s*5\b/);
    expect(THRESHOLDS_SRC).toMatch(/customer_tile\s*:\s*10\b/);
    expect(THRESHOLDS_SRC).toMatch(/threshold_replacement\s*:\s*20\b/);
  });

  it("thresholds.ts pins BRAIN_PACKET_CAP = 5", () => {
    expect(THRESHOLDS_SRC).toMatch(
      /export\s+const\s+BRAIN_PACKET_CAP\s*=\s*5\s+as\s+const/,
    );
  });

  it("thresholds.ts pins HELPING_RATE_FLOOR = 0.6", () => {
    expect(THRESHOLDS_SRC).toMatch(
      /export\s+const\s+HELPING_RATE_FLOOR\s*=\s*0\.6\s+as\s+const/,
    );
  });

  it('thresholds.ts pins HELPING_RATE_BAND = "within_median_days"', () => {
    expect(THRESHOLDS_SRC).toMatch(
      /export\s+const\s+HELPING_RATE_BAND\s*=\s*["']within_median_days["']\s+as\s+const/,
    );
  });

  it("BRAIN_SAMPLE_THRESHOLDS is locked with `as const`", () => {
    expect(THRESHOLDS_SRC).toMatch(/\}\s*as\s+const\s*;/);
  });

  it("thresholds.ts carries the 'v1 trust thresholds, tunable' header comment", () => {
    expect(THRESHOLDS_SRC).toMatch(/v1 trust thresholds, tunable/);
  });

  // ─────────────────────────────────────────────────────────────────
  // Module purity — no persistence / repository / lifecycle /
  // specific-edit-evidence / paid-API imports.
  // ─────────────────────────────────────────────────────────────────

  it("config.ts is pure (no persistence, repository, citation-lifecycle, specific-edit-evidence, or paid-API imports)", () => {
    expectPureModule("config.ts", CONFIG_SRC);
  });

  it("thresholds.ts is pure (no persistence, repository, citation-lifecycle, specific-edit-evidence, or paid-API imports)", () => {
    expectPureModule("thresholds.ts", THRESHOLDS_SRC);
  });

  // ─────────────────────────────────────────────────────────────────
  // Header docstrings reference E1 / E2 / E3 / E5 — keeps the source
  // pointed back at the operator-locked decisions.
  // ─────────────────────────────────────────────────────────────────

  it("config.ts header references the E1 two-flag rationale", () => {
    expect(CONFIG_SRC).toMatch(/E1/);
  });

  it("thresholds.ts header references the E2 + E3 + E5 locks", () => {
    expect(THRESHOLDS_SRC).toMatch(/E2/);
    expect(THRESHOLDS_SRC).toMatch(/E3/);
    expect(THRESHOLDS_SRC).toMatch(/E5/);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

const FORBIDDEN_IMPORT_PATTERNS: ReadonlyArray<RegExp> = [
  /from\s+["']@\/lib\/persistence/,
  /from\s+["']@\/lib\/persistence\/repositories/,
  /from\s+["']@\/domains\/citation-lifecycle/,
  /from\s+["']@\/domains\/recommendations\/specific-edit-evidence/,
  // Paid-API clients: OpenAI, Perplexity. (Profound is legacy +
  // import-side anyway.) Match the canonical client paths in src/.
  /from\s+["']@\/lib\/querying\/openai-client/,
  /from\s+["']@\/lib\/querying\/perplexity-client/,
  /from\s+["']@\/adapters\/openai/,
  /from\s+["']@\/adapters\/perplexity/,
];

function expectPureModule(basename: string, src: string): void {
  for (const pat of FORBIDDEN_IMPORT_PATTERNS) {
    expect(
      src,
      `${basename} must be pure — found forbidden import matching ${pat}`,
    ).not.toMatch(pat);
  }
}
