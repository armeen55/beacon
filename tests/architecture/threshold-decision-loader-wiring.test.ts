/**
 * Architecture invariant — Phase A.2 Step 3c (2026-05-14).
 *
 * Loader-wiring pin for the per-tenant threshold decision —
 * INVERTED from the A.2.3b customer-invisibility contract. With
 * A.2.3c shipping the atomic customer-visible flip, the loader
 * MUST pass the resolved decision into both `deriveLifecycleStage`
 * and `renderLifecycleCopy`, and the Today tile MUST consume
 * pre-rendered strings rather than importing thresholds + the
 * locked tooltip constant directly.
 *
 * What this invariant locks at the source-text level:
 *   1. `load-lifecycle.ts` imports `computeTenantThresholds`,
 *      `ThresholdDecision`, and `TenantLifecycleRecord` from
 *      `@/domains/recommendations/cross-tenant-brain/compute-tenant-thresholds`.
 *   2. `load-lifecycle.ts` imports `buildTileStrings` from
 *      `./render-copy`.
 *   3. `resolveTenantThresholdsCached` is exported with the
 *      documented cache-key prefix `"tenant-thresholds:v1"`.
 *   4. `LifecycleForEdit` declares `threshold_decision: ThresholdDecision`.
 *   5. `LifecycleSummary` declares `threshold_decision: ThresholdDecision`
 *      AND `tile_strings: LifecycleTileStrings`.
 *   6. **Wired contract A**: `load-lifecycle.ts` passes the resolved
 *      `thresholdDecision.thresholds` (or an equivalent thresholds
 *      object derived from the decision) as the 2nd arg to every
 *      `deriveLifecycleStage` call site within this module — at
 *      least one such call must exist, and none may pass a single-
 *      argument form.
 *   7. **Wired contract B**: `load-lifecycle.ts` passes a
 *      `threshold_decision` field into every `renderLifecycleCopy`
 *      call site within this module.
 *   8. **Tile boundary**: `src/components/today/edit-lifecycle-tile.tsx`
 *      does NOT import `T2C_THRESHOLDS` from
 *      `@/domains/citation-lifecycle/thresholds` and does NOT import
 *      `BORROWED_BENCHMARK_TOOLTIP` from
 *      `@/domains/citation-lifecycle/render-copy`. The tile reads
 *      these via props (`stageLabels` / `tooltipBody` /
 *      `emptyStateBody`) only.
 *
 * Retirement: this invariant retires when Phase A.3 (indexability)
 * replaces the lifecycle-stage threshold scaffold OR when a future
 * phase replaces the tile component with a unified read model. Until
 * then, drift on any pin trips the build.
 *
 * Implementation note: pins operate on comment-stripped source so a
 * docstring mention of the forbidden import does not trip the test.
 * Call-shape inspection uses bracket-depth tracking rather than
 * exact whitespace so a formatting-only change doesn't trip.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const LOADER_PATH = resolve(
  REPO_ROOT,
  "src",
  "domains",
  "citation-lifecycle",
  "load-lifecycle.ts",
);
const TILE_PATH = resolve(
  REPO_ROOT,
  "src",
  "components",
  "today",
  "edit-lifecycle-tile.tsx",
);

const LOADER_SRC = readFileSync(LOADER_PATH, "utf-8");
const TILE_SRC = readFileSync(TILE_PATH, "utf-8");

// Strip block + line comments before scanning executable shapes.
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const LOADER_STRIPPED = stripComments(LOADER_SRC);
const TILE_STRIPPED = stripComments(TILE_SRC);

describe("Architecture — threshold-decision loader wiring (Phase A.2 §3.7)", () => {
  // ─────────────────────────────────────────────────────────────────
  // Pin 1: imports from cross-tenant-brain
  // ─────────────────────────────────────────────────────────────────

  it("loader imports computeTenantThresholds + ThresholdDecision + TenantLifecycleRecord from cross-tenant-brain", () => {
    expect(LOADER_SRC).toMatch(
      /from\s+["']@\/domains\/recommendations\/cross-tenant-brain\/compute-tenant-thresholds["']/,
    );
    expect(LOADER_SRC).toMatch(/\bcomputeTenantThresholds\b/);
    expect(LOADER_SRC).toMatch(/\bThresholdDecision\b/);
    expect(LOADER_SRC).toMatch(/\bTenantLifecycleRecord\b/);
  });

  // ─────────────────────────────────────────────────────────────────
  // Pin 2: loader imports buildTileStrings from render-copy
  // ─────────────────────────────────────────────────────────────────

  it("loader imports buildTileStrings from ./render-copy", () => {
    expect(LOADER_STRIPPED).toMatch(/\bbuildTileStrings\b/);
    expect(LOADER_STRIPPED).toMatch(
      /from\s+["']\.\/render-copy["']/,
    );
  });

  // ─────────────────────────────────────────────────────────────────
  // Pin 3: resolveTenantThresholdsCached export + cache-key prefix
  // ─────────────────────────────────────────────────────────────────

  it("loader exports resolveTenantThresholdsCached", () => {
    expect(LOADER_STRIPPED).toMatch(
      /export\s+async\s+function\s+resolveTenantThresholdsCached\s*\(/,
    );
  });

  it("loader uses cache-key prefix 'tenant-thresholds:v1'", () => {
    expect(LOADER_STRIPPED).toMatch(/["']tenant-thresholds:v1["']/);
  });

  // ─────────────────────────────────────────────────────────────────
  // Pin 4: LifecycleForEdit declares threshold_decision
  // ─────────────────────────────────────────────────────────────────

  it("LifecycleForEdit declares threshold_decision: ThresholdDecision", () => {
    const block = LOADER_SRC.match(
      /export\s+type\s+LifecycleForEdit\s*=\s*\{[\s\S]*?\};/,
    );
    expect(block, "LifecycleForEdit type block not found").toBeTruthy();
    expect(block![0]).toMatch(
      /threshold_decision\s*:\s*ThresholdDecision/,
    );
  });

  // ─────────────────────────────────────────────────────────────────
  // Pin 5: LifecycleSummary declares threshold_decision + tile_strings
  // ─────────────────────────────────────────────────────────────────

  it("LifecycleSummary declares threshold_decision: ThresholdDecision AND tile_strings: LifecycleTileStrings", () => {
    const block = LOADER_SRC.match(
      /export\s+type\s+LifecycleSummary\s*=\s*\{[\s\S]*?\};/,
    );
    expect(block, "LifecycleSummary type block not found").toBeTruthy();
    expect(block![0]).toMatch(
      /threshold_decision\s*:\s*ThresholdDecision/,
    );
    expect(block![0]).toMatch(
      /tile_strings\s*:\s*LifecycleTileStrings/,
    );
  });

  // ─────────────────────────────────────────────────────────────────
  // Pin 6: every deriveLifecycleStage call passes the per-tenant
  // thresholds as a 2nd argument (A.2.3c wired contract)
  // ─────────────────────────────────────────────────────────────────

  it("loader passes per-tenant thresholds into every deriveLifecycleStage call (A.2.3c wired contract)", () => {
    const callRe = /deriveLifecycleStage\s*\(/g;
    const callShapes: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = callRe.exec(LOADER_STRIPPED)) !== null) {
      const start = match.index + match[0].length;
      let depth = 1;
      let i = start;
      while (i < LOADER_STRIPPED.length && depth > 0) {
        const ch = LOADER_STRIPPED[i];
        if (ch === "(") depth++;
        else if (ch === ")") depth--;
        if (depth === 0) break;
        i++;
      }
      callShapes.push(LOADER_STRIPPED.slice(start, i));
    }
    // At least one call must exist (otherwise the loader can't be
    // driving the new wiring).
    expect(
      callShapes.length,
      "no deriveLifecycleStage calls found in loader — wiring missing",
    ).toBeGreaterThan(0);

    // Every call must carry exactly one top-level comma (i.e., a 2nd
    // argument) AND the source must reference `thresholdDecision`
    // somewhere in the call body. Architecture pins the wiring, not
    // a single identifier name — but `thresholdDecision` is the
    // canonical local in the loader and is documented as the
    // single source. Future refactors must keep the name or update
    // this invariant.
    for (const body of callShapes) {
      let braceDepth = 0;
      let parenDepth = 0;
      let topLevelCommas = 0;
      for (const ch of body) {
        if (ch === "{") braceDepth++;
        else if (ch === "}") braceDepth--;
        else if (ch === "(") parenDepth++;
        else if (ch === ")") parenDepth--;
        else if (ch === "," && braceDepth === 0 && parenDepth === 0) {
          topLevelCommas++;
        }
      }
      // Allow 1 (no trailing comma) or 2 (Prettier-formatted
      // trailing comma after the 2nd argument). Both indicate a
      // 2nd argument is present.
      expect(
        topLevelCommas,
        `deriveLifecycleStage call missing 2nd thresholds argument. Call body: ${body.trim()}`,
      ).toBeGreaterThanOrEqual(1);
      expect(
        body,
        `deriveLifecycleStage call does not reference thresholdDecision. Body: ${body.trim()}`,
      ).toMatch(/thresholdDecision/);
    }
  });

  // ─────────────────────────────────────────────────────────────────
  // Pin 7: every renderLifecycleCopy call passes threshold_decision
  // ─────────────────────────────────────────────────────────────────

  it("loader passes threshold_decision into every renderLifecycleCopy call (A.2.3c wired contract)", () => {
    const callRe = /renderLifecycleCopy\s*\(/g;
    const callShapes: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = callRe.exec(LOADER_STRIPPED)) !== null) {
      const start = match.index + match[0].length;
      let depth = 1;
      let i = start;
      while (i < LOADER_STRIPPED.length && depth > 0) {
        const ch = LOADER_STRIPPED[i];
        if (ch === "(") depth++;
        else if (ch === ")") depth--;
        if (depth === 0) break;
        i++;
      }
      callShapes.push(LOADER_STRIPPED.slice(start, i));
    }
    expect(
      callShapes.length,
      "no renderLifecycleCopy calls found in loader — wiring missing",
    ).toBeGreaterThan(0);
    for (const body of callShapes) {
      expect(
        body,
        `renderLifecycleCopy call missing threshold_decision field. Body: ${body.trim()}`,
      ).toMatch(/\bthreshold_decision\s*:/);
    }
  });

  // ─────────────────────────────────────────────────────────────────
  // Pin 8: tile component does NOT import T2C_THRESHOLDS or
  // BORROWED_BENCHMARK_TOOLTIP — strings flow in via props only.
  // ─────────────────────────────────────────────────────────────────

  it("edit-lifecycle-tile.tsx does NOT import T2C_THRESHOLDS from citation-lifecycle/thresholds", () => {
    // Match any import statement that pulls T2C_THRESHOLDS from the
    // thresholds module. Comment-stripped so a doc reference to the
    // historical Phase A.1 import does not trip the test.
    expect(TILE_STRIPPED).not.toMatch(/\bT2C_THRESHOLDS\b/);
    expect(TILE_STRIPPED).not.toMatch(
      /from\s+["']@\/domains\/citation-lifecycle\/thresholds["']/,
    );
  });

  it("edit-lifecycle-tile.tsx does NOT import BORROWED_BENCHMARK_TOOLTIP from citation-lifecycle/render-copy", () => {
    expect(TILE_STRIPPED).not.toMatch(/\bBORROWED_BENCHMARK_TOOLTIP\b/);
    // The tile may still import a TYPE (e.g., LifecycleStage) from
    // citation-lifecycle but MUST NOT name the constant. Type-only
    // imports are allowed.
  });
});
