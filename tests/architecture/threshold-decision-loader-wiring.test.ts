/**
 * Architecture invariant — Phase A.2 Step 3b (2026-05-14).
 *
 * Loader-wiring pin for the per-tenant threshold decision.
 *
 * What this invariant locks at the source-text level:
 *   1. `load-lifecycle.ts` imports `computeTenantThresholds`,
 *      `ThresholdDecision`, and `TenantLifecycleRecord` from
 *      `@/domains/recommendations/cross-tenant-brain/compute-tenant-thresholds`.
 *   2. `resolveTenantThresholdsCached` is exported with the
 *      documented cache-key prefix `"tenant-thresholds:v1"`.
 *   3. Both `LifecycleForEdit` and `LifecycleSummary` declare a
 *      `threshold_decision: ThresholdDecision` field.
 *   4. **Customer-invisibility pin** — `load-lifecycle.ts` does NOT
 *      pass any custom thresholds into `deriveLifecycleStage`
 *      (every call uses the no-2nd-arg form).
 *   5. **Customer-invisibility pin** — `load-lifecycle.ts` does NOT
 *      pass a `threshold_decision` field into any
 *      `renderLifecycleCopy` call site.
 *
 * Pins 4 + 5 are the load-bearing customer-invisibility contract
 * for A.2.3b. When A.2.3c lands (the atomic re-bucket + re-label
 * step), these pins retire and are replaced by their inverses
 * (loader MUST pass the decision through).
 *
 * Retirement: Refines when A.2.3c wires the decision into
 * `renderLifecycleCopy` and `deriveLifecycleStage` call sites
 * within `load-lifecycle.ts`. Catalog entry tracks the transition.
 *
 * Implementation note on regex brittleness: the operator-locked
 * pre-flight asked for non-brittle checks. The pins below operate
 * on the comment-stripped source and target the structural shape
 * of each call site rather than exact whitespace. A formatting-
 * only change (e.g., line-break style) does not trip the test.
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

const SRC = readFileSync(LOADER_PATH, "utf-8");

// Strip block + line comments for the "no-wired-yet" pins so a
// docstring mention like "A.2.3c will pass the decision into
// renderLifecycleCopy" doesn't trip the executable-source check.
const SRC_STRIPPED = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(
  /^\s*\/\/.*$/gm,
  "",
);

describe("Architecture — threshold-decision loader wiring (Phase A.2 §3.7)", () => {
  // ─────────────────────────────────────────────────────────────────
  // Pin 1: imports from cross-tenant-brain
  // ─────────────────────────────────────────────────────────────────

  it("imports computeTenantThresholds + ThresholdDecision + TenantLifecycleRecord from cross-tenant-brain", () => {
    expect(SRC).toMatch(
      /from\s+["']@\/domains\/recommendations\/cross-tenant-brain\/compute-tenant-thresholds["']/,
    );
    expect(SRC).toMatch(/\bcomputeTenantThresholds\b/);
    expect(SRC).toMatch(/\bThresholdDecision\b/);
    expect(SRC).toMatch(/\bTenantLifecycleRecord\b/);
  });

  // ─────────────────────────────────────────────────────────────────
  // Pin 2: resolveTenantThresholdsCached exported with the right
  // cache-key prefix
  // ─────────────────────────────────────────────────────────────────

  it("exports resolveTenantThresholdsCached", () => {
    expect(SRC_STRIPPED).toMatch(
      /export\s+async\s+function\s+resolveTenantThresholdsCached\s*\(/,
    );
  });

  it("uses cache-key prefix 'tenant-thresholds:v1'", () => {
    expect(SRC_STRIPPED).toMatch(/["']tenant-thresholds:v1["']/);
  });

  // ─────────────────────────────────────────────────────────────────
  // Pin 3: type declarations
  // ─────────────────────────────────────────────────────────────────

  it("LifecycleForEdit declares threshold_decision: ThresholdDecision", () => {
    // The type block looks like:
    //   export type LifecycleForEdit = {
    //     ...
    //     threshold_decision: ThresholdDecision;
    //   };
    // Match the type-block scope by anchoring on the type name.
    const typeBlockMatch = SRC.match(
      /export\s+type\s+LifecycleForEdit\s*=\s*\{[\s\S]*?\};/,
    );
    expect(typeBlockMatch, "LifecycleForEdit type block not found").toBeTruthy();
    expect(typeBlockMatch![0]).toMatch(
      /threshold_decision\s*:\s*ThresholdDecision/,
    );
  });

  it("LifecycleSummary declares threshold_decision: ThresholdDecision", () => {
    const typeBlockMatch = SRC.match(
      /export\s+type\s+LifecycleSummary\s*=\s*\{[\s\S]*?\};/,
    );
    expect(typeBlockMatch, "LifecycleSummary type block not found").toBeTruthy();
    expect(typeBlockMatch![0]).toMatch(
      /threshold_decision\s*:\s*ThresholdDecision/,
    );
  });

  // ─────────────────────────────────────────────────────────────────
  // Pin 4: customer-invisibility — deriveLifecycleStage calls in
  // load-lifecycle.ts MUST NOT pass a custom thresholds 2nd argument
  // in A.2.3b. (Retires in A.2.3c.)
  // ─────────────────────────────────────────────────────────────────

  it("loader does NOT pass custom thresholds into deriveLifecycleStage (A.2.3b customer-invisibility pin)", () => {
    // The legitimate call shape in A.2.3b:
    //   deriveLifecycleStage({
    //     first_citation_date_iso: ...,
    //     days_to_first_citation: ...,
    //     days_since_live: ...,
    //   })
    // The forbidden A.2.3c-only shape would be:
    //   deriveLifecycleStage({ ... }, thresholds)
    // We scan every call and assert the matching closing `)` is
    // preceded ONLY by the input object's `}` (single argument).
    //
    // Implementation: find each `deriveLifecycleStage(` call in the
    // comment-stripped source, then inspect the call shape by
    // counting bracket depth until the matching close.
    const callRe = /deriveLifecycleStage\s*\(/g;
    let match: RegExpExecArray | null;
    const callShapes: string[] = [];
    while ((match = callRe.exec(SRC_STRIPPED)) !== null) {
      const callBodyStart = match.index + match[0].length;
      // Find the matching closing paren by depth-tracking.
      let depth = 1;
      let i = callBodyStart;
      while (i < SRC_STRIPPED.length && depth > 0) {
        const ch = SRC_STRIPPED[i];
        if (ch === "(") depth++;
        else if (ch === ")") depth--;
        if (depth === 0) break;
        i++;
      }
      const body = SRC_STRIPPED.slice(callBodyStart, i);
      callShapes.push(body);
    }

    // Every call body should contain exactly one top-level
    // comma-separated argument (the input object). A 2nd argument
    // would introduce a top-level comma at brace-depth 0.
    for (const body of callShapes) {
      // Count top-level commas: those at brace/paren depth 0.
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
      expect(
        topLevelCommas,
        `deriveLifecycleStage call in load-lifecycle.ts has ${topLevelCommas} top-level commas — A.2.3b forbids a 2nd thresholds argument. Call body: ${body.trim()}`,
      ).toBe(0);
    }
  });

  // ─────────────────────────────────────────────────────────────────
  // Pin 5: customer-invisibility — renderLifecycleCopy calls in
  // load-lifecycle.ts MUST NOT pass a threshold_decision field.
  // (Retires in A.2.3c.)
  // ─────────────────────────────────────────────────────────────────

  it("loader does NOT pass threshold_decision into renderLifecycleCopy (A.2.3b customer-invisibility pin)", () => {
    // Find each `renderLifecycleCopy(` call body and inspect the
    // top-level input object keys. The forbidden A.2.3c-only key:
    // `threshold_decision:`. Other keys (stage, days_since_live,
    // etc.) are required and allowed.
    const callRe = /renderLifecycleCopy\s*\(/g;
    let match: RegExpExecArray | null;
    while ((match = callRe.exec(SRC_STRIPPED)) !== null) {
      const callBodyStart = match.index + match[0].length;
      let depth = 1;
      let i = callBodyStart;
      while (i < SRC_STRIPPED.length && depth > 0) {
        const ch = SRC_STRIPPED[i];
        if (ch === "(") depth++;
        else if (ch === ")") depth--;
        if (depth === 0) break;
        i++;
      }
      const body = SRC_STRIPPED.slice(callBodyStart, i);
      // The body is the input object; check for the forbidden key.
      expect(
        body,
        `renderLifecycleCopy call in load-lifecycle.ts passes a threshold_decision field — A.2.3b customer-invisibility pin forbids this. Call body: ${body.trim()}`,
      ).not.toMatch(/\bthreshold_decision\s*:/);
    }
  });
});
