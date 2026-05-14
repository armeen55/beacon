/**
 * Architecture invariant — Phase A.2 Step 2 (2026-05-14).
 *
 * Provenance pin for the per-tenant benchmark compute. Mirrors the
 * Phase A.1 `thresholds-provenance` pattern.
 *
 * What this invariant locks at the source-text level:
 *   1. Canonical file path.
 *   2. `computeTenantThresholds` is the public entry point.
 *   3. Source references `BRAIN_SAMPLE_THRESHOLDS.threshold_replacement`
 *      rather than the literal `20`. A future refactor that hardcodes
 *      the gate would silently bypass the single-source-of-truth.
 *   4. Source references the locked percentile values 0.5, 0.75, 0.9
 *      (Section 2.8 mapping; matches the Profound paper's reported
 *      bands).
 *   5. The Profound fallback comes ONLY from
 *      `@/domains/citation-lifecycle/thresholds` (the canonical
 *      `T2C_THRESHOLDS` constant). No duplicate Profound values
 *      hardcoded here.
 *   6. Module purity — no repository / persistence / Supabase / paid-
 *      API imports; no env reads.
 *   7. Inclusion-rule rationale comment present (cited-edit
 *      subpopulation, right-censoring rationale).
 *   8. Source references the explicit exclusion of
 *      `live_not_yet_cited` and `stuck` stages.
 *
 * Retirement: refines when per-action-type compute lands (post-MVP)
 * or when the percentile choice is revisited. The decision rule's
 * structural shape and inclusion rule stay locked through that.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const COMPUTE_PATH = resolve(
  REPO_ROOT,
  "src",
  "domains",
  "recommendations",
  "cross-tenant-brain",
  "compute-tenant-thresholds.ts",
);

const SRC = readFileSync(COMPUTE_PATH, "utf-8");

// Comment-stripped source for the rules that must scan executable
// code only (the docstring legitimately references Profound /
// percentile values / the gate constant).
const SRC_STRIPPED = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(
  /^\s*\/\/.*$/gm,
  "",
);

describe("Architecture — brain compute-tenant-thresholds provenance (Phase A.2 §3.7 / E7)", () => {
  it("source file exists at the canonical path", () => {
    expect(SRC.length).toBeGreaterThan(0);
  });

  it("exports computeTenantThresholds as the public entry point", () => {
    expect(SRC).toMatch(
      /export\s+function\s+computeTenantThresholds\s*\(/,
    );
  });

  // ───────────────────────────────────────────────────────────────────
  // Gate constant reference — single source of truth
  // ───────────────────────────────────────────────────────────────────

  it("references BRAIN_SAMPLE_THRESHOLDS.threshold_replacement (no hardcoded 20 in the gate)", () => {
    expect(SRC_STRIPPED).toMatch(
      /BRAIN_SAMPLE_THRESHOLDS\.threshold_replacement/,
    );
  });

  it("imports BRAIN_SAMPLE_THRESHOLDS from cross-tenant-brain/thresholds", () => {
    expect(SRC).toMatch(
      /import\s+\{[^}]*\bBRAIN_SAMPLE_THRESHOLDS\b[^}]*\}\s+from\s+["']\.\/thresholds["']/,
    );
  });

  // ───────────────────────────────────────────────────────────────────
  // Locked percentile values
  // ───────────────────────────────────────────────────────────────────

  it("references the locked percentile values 0.5, 0.75, 0.9 in executable code", () => {
    expect(SRC_STRIPPED).toMatch(/\bfast\s*:\s*0\.5\b/);
    expect(SRC_STRIPPED).toMatch(/\bmedian\s*:\s*0\.75\b/);
    expect(SRC_STRIPPED).toMatch(/\blate\s*:\s*0\.9\b/);
  });

  // ───────────────────────────────────────────────────────────────────
  // Profound fallback — sourced only from citation-lifecycle
  // ───────────────────────────────────────────────────────────────────

  it("imports T2C_THRESHOLDS from citation-lifecycle (fallback default only)", () => {
    expect(SRC).toMatch(
      /import\s+\{[^}]*\bT2C_THRESHOLDS\b[^}]*\}\s+from\s+["']@\/domains\/citation-lifecycle\/thresholds["']/,
    );
  });

  it("does NOT hardcode the Profound numeric values 6 / 18 / 37 in executable code", () => {
    // The integers ARE allowed in docstrings (header references
    // the Profound mapping) but must never appear as locked
    // operational constants in the compute module body. Strip
    // comments and check the residue for standalone whole-word
    // occurrences of the three Profound integers.
    expect(SRC_STRIPPED).not.toMatch(/\b6\b/);
    expect(SRC_STRIPPED).not.toMatch(/\b18\b/);
    expect(SRC_STRIPPED).not.toMatch(/\b37\b/);
  });

  // ───────────────────────────────────────────────────────────────────
  // Module purity
  // ───────────────────────────────────────────────────────────────────

  it("is pure (no persistence, repository, Supabase, paid-API, or env reads)", () => {
    const FORBIDDEN: ReadonlyArray<RegExp> = [
      /from\s+["']@\/lib\/persistence/,
      /from\s+["']@\/lib\/persistence\/repositories/,
      /from\s+["']@\/lib\/supabase/,
      /from\s+["']@\/lib\/querying\/openai-client/,
      /from\s+["']@\/lib\/querying\/perplexity-client/,
      /from\s+["']@\/adapters\/openai/,
      /from\s+["']@\/adapters\/perplexity/,
      /from\s+["']@supabase\//,
      /from\s+["']openai["']/,
    ];
    for (const pat of FORBIDDEN) {
      expect(
        SRC,
        `compute-tenant-thresholds.ts must be pure — found forbidden import matching ${pat}`,
      ).not.toMatch(pat);
    }

    // No env reads anywhere in the source (including comments —
    // even mentioning `process.env.X` in a docstring is enough to
    // alert a future reader that env affects this module, which it
    // must not).
    expect(SRC).not.toMatch(/process\.env\b/);
  });

  // ───────────────────────────────────────────────────────────────────
  // Inclusion-rule rationale + exclusion references
  // ───────────────────────────────────────────────────────────────────

  it("carries an inclusion-rule rationale comment explaining the cited-only choice", () => {
    expect(SRC).toMatch(/cited-edit subpopulation/i);
    expect(SRC).toMatch(/right-censored/i);
  });

  it("source references the explicit exclusion of live_not_yet_cited and stuck stages", () => {
    expect(SRC).toMatch(/\blive_not_yet_cited\b/);
    expect(SRC).toMatch(/\bstuck\b/);
  });

  // ───────────────────────────────────────────────────────────────────
  // Decision-rule structural shape
  // ───────────────────────────────────────────────────────────────────

  it("returns the locked source enum values 'profound_default' and 'per_tenant'", () => {
    expect(SRC).toMatch(/["']profound_default["']/);
    expect(SRC).toMatch(/["']per_tenant["']/);
  });

  it("nearest-rank quantile uses the documented ceil(p * n) - 1 formula", () => {
    expect(SRC_STRIPPED).toMatch(/Math\.ceil\s*\(\s*p\s*\*\s*n\s*\)\s*-\s*1/);
  });
});
