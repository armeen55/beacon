/**
 * Architecture invariant — Phase A.1 Section 2.8 (2026-05-13).
 *
 * The honesty contract for citation-lifecycle thresholds:
 * the 6 / 18 / 37 day defaults are BORROWED from a published
 * Profound study of ~900 marketing pages. Until Phase A.2 (brain
 * activation, Section 3) replaces them with Beacon's own observed
 * medians, every customer-facing surface that consumes them must
 * be honest about the provenance — tooltip copy on Today's
 * lifecycle tile and Changes detail Act 3 stage copy both rely on
 * the BORROWED label staying intact.
 *
 * This test pins:
 *   1. The thresholds source file exists at the canonical path
 *      src/domains/citation-lifecycle/thresholds.ts.
 *   2. The "BORROWED DEFAULTS" block of text is present and
 *      attributes the numbers to Profound.
 *   3. The exact integer constants are 6 / 18 / 37 (D8 lock).
 *   4. The constant is exported via the canonical name
 *      T2C_THRESHOLDS so downstream consumers can be statically
 *      verified to read from this single source.
 *   5. The forward-reference to Phase A.2 brain replacement
 *      stays visible — so a future engineer cannot remove the
 *      "Beacon will replace" promise without tripping the build.
 *
 * If Phase A.2 ships and replaces the defaults with computed
 * tenant-specific values, this invariant should be UPDATED to
 * pin the new contract (with the Profound source kept as the
 * documented fallback when sample size is below the
 * threshold-replacement gate). The exception register lives in
 * docs/ARCHITECTURE_INVARIANTS_CATALOG.md per Section 12 N1.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const THRESHOLDS_PATH = resolve(
  __dirname,
  "..",
  "..",
  "src",
  "domains",
  "citation-lifecycle",
  "thresholds.ts",
);

const SRC = readFileSync(THRESHOLDS_PATH, "utf-8");

describe("Architecture — citation-lifecycle thresholds provenance (Phase A.1 §2.8)", () => {
  it("the thresholds source file exists at the canonical path", () => {
    // Reading at module load already proves existence; this
    // assertion documents the contract for human readers.
    expect(SRC.length).toBeGreaterThan(0);
  });

  it("declares the Profound source attribution explicitly", () => {
    // The provenance header must mention Profound by name. If a
    // future change paraphrases "an industry study" without
    // attribution, the customer-facing honesty contract drifts.
    expect(SRC).toMatch(/BORROWED DEFAULTS/);
    expect(SRC).toMatch(/Profound/);
  });

  it("flags the 6 / 18 / 37 day integers as the locked default rounding", () => {
    // D8 lock: integer rounding (50th / 75th / 90th percentile
    // rounded to integer days). Pinning the integers prevents a
    // silent revert to decimal values that would muddy the
    // customer copy.
    expect(SRC).toMatch(/6 \/ 18 \/ 37/);
  });

  it("promises Phase A.2 brain-driven replacement in the same block", () => {
    // The "Beacon will replace" promise is what makes the
    // BORROWED label honest. Removing the promise without
    // updating this test would let the defaults silently outlive
    // their stated lifetime.
    expect(SRC).toMatch(/replace/i);
    expect(SRC).toMatch(/Phase A\.2/);
  });

  it("exports T2C_THRESHOLDS with the canonical integer values", () => {
    // Allow flexible whitespace but pin the three numeric values
    // to their D8-locked integers. Downstream consumers
    // (lifecycle-stage.ts, surface copy) read from this single
    // export only.
    expect(SRC).toMatch(/export\s+const\s+T2C_THRESHOLDS\s*=/);
    expect(SRC).toMatch(/fast_days\s*:\s*6\b/);
    expect(SRC).toMatch(/median_days\s*:\s*18\b/);
    expect(SRC).toMatch(/late_days\s*:\s*37\b/);
  });

  it("locks the constant with `as const` so downstream readers see literal types", () => {
    // `as const` keeps `T2C_THRESHOLDS.fast_days` typed as the
    // literal `6` rather than `number`, which lets the lifecycle
    // stage derivation be type-checked against the exact values.
    expect(SRC).toMatch(/\}\s*as\s+const\s*;/);
  });

  it("pins its own architecture-invariant location in the source comment", () => {
    // The header references this test file by path. If the test
    // moves, the source comment must move with it — keeps the
    // honesty contract trail navigable from either direction.
    expect(SRC).toMatch(/thresholds-provenance\.test\.ts/);
  });
});
