/**
 * Perf bundle 5 (2026-05-12) — source-level pin for the discrepancy gate.
 *
 * The inline-body profiling pass measured `extractEntities +
 * detectDiscrepancies` at ~366 ms warm (~65% of /today's render time).
 * The discrepancy detector produces a single optional `nextCandidates`
 * entry that the downstream `find((m) => m != null)` selector discards
 * whenever an earlier (higher-priority) candidate is non-null. The
 * gate skips the expensive work whenever earlier candidates have
 * already produced a non-null entry — output is byte-identical
 * because the selector explicitly prefers the first non-null entry,
 * which still exists.
 *
 * These source-level checks survive JSX refactors and don't need
 * Supabase credentials. They pin:
 *   1. A `hasHigherPriorityNextMove` const is declared and read.
 *   2. The `extractEntities` + `detectDiscrepancies` call site is
 *      wrapped in an `if (!hasHigherPriorityNextMove)` block.
 *   3. The push of the discrepancy `nextCandidates` entry stays
 *      inside the same conditional.
 *   4. Both function names are NOT called at the module top-level
 *      outside the gate (negative pin against a future revert).
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

describe("Perf bundle 5 — discrepancy gate in today-data.ts", () => {
  const src = read("src/app/(shell)/today-data.ts");
  const stripped = stripComments(src);

  it("declares `hasHigherPriorityNextMove` from nextCandidates.some(...)", () => {
    expect(stripped).toMatch(
      /const\s+hasHigherPriorityNextMove\s*=\s*nextCandidates\.some\(\s*\(\s*candidate\s*\)\s*=>\s*candidate\s*!=\s*null\s*,?\s*\)\s*;/,
    );
  });

  it("calls extractEntities + detectDiscrepancies ONLY inside the gate", () => {
    // Each function appears exactly once in the function body — inside
    // a single `if (!hasHigherPriorityNextMove) { ... }` block.
    const extractMatches = stripped.match(/\bawait\s+extractEntities\(/g) ?? [];
    const detectMatches =
      stripped.match(/\bawait\s+detectDiscrepancies\(/g) ?? [];
    expect(extractMatches.length).toBe(1);
    expect(detectMatches.length).toBe(1);

    // The single call must be inside an `if (!hasHigherPriorityNextMove) {`
    // block. Pin the literal structure: the `if` opens, both calls run,
    // and the `notableDisc` push lives in the same block.
    expect(stripped).toMatch(
      /if\s*\(\s*!hasHigherPriorityNextMove\s*\)\s*\{[\s\S]*?const\s+entityIdx\s*=\s*await\s+extractEntities\(/,
    );
    expect(stripped).toMatch(
      /if\s*\(\s*!hasHigherPriorityNextMove\s*\)\s*\{[\s\S]*?const\s+discrepancyReport\s*=\s*await\s+detectDiscrepancies\(/,
    );
    expect(stripped).toMatch(
      /if\s*\(\s*!hasHigherPriorityNextMove\s*\)\s*\{[\s\S]*?const\s+notableDisc\s*=\s*discrepancyReport\.discrepancies\.filter/,
    );
    expect(stripped).toMatch(
      /if\s*\(\s*!hasHigherPriorityNextMove\s*\)\s*\{[\s\S]*?nextCandidates\.push\(\s*\{[\s\S]*?representation\s/,
    );
  });

  it("gate is positioned AFTER the 5 higher-priority candidate pushes", () => {
    // Locate offsets of: warning push, shipped push, new-issues push,
    // undecidedCount push, decayAlerts push, and the gate. The gate
    // must come after all 5 — otherwise the optimization is incorrect
    // (some earlier candidates wouldn't be available to short-circuit).
    const warningIdx = stripped.indexOf("Clear ${warningAlerts.length}");
    const shippedIdx = stripped.indexOf("Run ship verification");
    const newIssuesIdx = stripped.indexOf("Triage ${newIssues.length}");
    const reviewIdx = stripped.indexOf("Work the Review queue");
    const decayIdx = stripped.indexOf("page${decayAlerts.length");
    const gateIdx = stripped.indexOf("const hasHigherPriorityNextMove");
    expect(warningIdx).toBeGreaterThan(0);
    expect(shippedIdx).toBeGreaterThan(0);
    expect(newIssuesIdx).toBeGreaterThan(0);
    expect(reviewIdx).toBeGreaterThan(0);
    expect(decayIdx).toBeGreaterThan(0);
    expect(gateIdx).toBeGreaterThan(0);
    expect(gateIdx).toBeGreaterThan(warningIdx);
    expect(gateIdx).toBeGreaterThan(shippedIdx);
    expect(gateIdx).toBeGreaterThan(newIssuesIdx);
    expect(gateIdx).toBeGreaterThan(reviewIdx);
    expect(gateIdx).toBeGreaterThan(decayIdx);
  });

  it("today-summary still uses `find((m) => m != null)` (gate contract)", () => {
    // The gate's correctness depends on this exact selector. If
    // `today-summary.ts` ever changes how it picks among
    // `nextMoveCandidates`, the gate has to be re-evaluated. Pin the
    // selector here so a future edit forces this test back into view.
    const summarySrc = read("src/lib/today-summary.ts");
    expect(summarySrc).toMatch(
      /opts\.nextMoveCandidates\.find\(\s*\(\s*m\s*\)\s*=>\s*m\s*!=\s*null\s*\)/,
    );
  });
});
