/**
 * Architecture invariant — no placeholder phrase can ever reach an
 * operator-visible recommendation.
 *
 * Operator M1 contract (2026-05-05, post-audit):
 *   "Active recommended_edits MUST NOT contain placeholder phrases.
 *    Deterministic generator source MUST NOT contain Draft answer."
 *
 * This test does NOT replace the runtime validator (validateSpecificEdit
 * + validateSpecificEditBundle). It pins:
 *   1. The deterministic generator source files do not contain the
 *      literal phrase "Draft answer" (or its operator-targeted siblings)
 *      — guarding against a future regression that re-introduces the
 *      pre-W3 "A: Draft answer (operator: rewrite). Anchor on: ..."
 *      output.
 *   2. The persisted .data/tenants slash-star/recommended-edits.json
 *      queue contains zero rows with implementation_status equal to
 *      "recommended" whose proposed_text or display_label matches a
 *      placeholder phrase. Dismissed historical rows are allowed
 *      (pre-W3 residue that the operator deliberately preserved for
 *      audit).
 *
 * If this test ever fails, the placeholder leak is back. Do not relax
 * it; fix the root cause.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

import {
  PLACEHOLDER_PATTERNS,
  detectPlaceholder,
} from "@/domains/recommendations/placeholder-detection";

const REPO_ROOT = resolve(__dirname, "../..");
const GENERATORS_DIR = join(
  REPO_ROOT,
  "src/domains/recommendations/providers/generators",
);
const TENANTS_DIR = join(REPO_ROOT, ".data/tenants");

describe("Architecture — no placeholder in deterministic generator source", () => {
  // The forbidden literals the operator named in M1. These are the
  // strings that, pre-W3, the FAQ generator composed verbatim. None of
  // them should appear in production-source generator code today.
  const FORBIDDEN_LITERALS = [
    "Draft answer",
    "operator: rewrite",
    "Anchor on:",
  ] as const;

  const generatorFiles = (() => {
    if (!existsSync(GENERATORS_DIR)) return [];
    return readdirSync(GENERATORS_DIR)
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
      .map((f) => join(GENERATORS_DIR, f));
  })();

  it("at least one production generator file is loaded for inspection", () => {
    // Defensive — if the directory moves and this test ends up scanning
    // 0 files, the assertion below would vacuously pass.
    expect(generatorFiles.length).toBeGreaterThan(0);
  });

  for (const file of generatorFiles) {
    const relative = file.slice(REPO_ROOT.length + 1);
    it(`${relative} contains no operator-visible placeholder literals`, () => {
      const src = readFileSync(file, "utf-8");
      for (const literal of FORBIDDEN_LITERALS) {
        // Scope the check to STRING LITERALS — a comment that says
        // "we used to emit 'Draft answer' but now abstain" is allowed
        // for context. The check fires only on `"Draft answer..."` /
        // `'Draft answer...'` / template-literal `\`Draft answer...\``.
        const inDoubleQuoted = new RegExp(
          `"[^"]*${literal}[^"]*"`,
          "i",
        );
        const inSingleQuoted = new RegExp(
          `'[^']*${literal}[^']*'`,
          "i",
        );
        const inTemplate = new RegExp(
          "`[^`]*" + literal + "[^`]*`",
          "i",
        );
        expect(
          inDoubleQuoted.test(src) ||
            inSingleQuoted.test(src) ||
            inTemplate.test(src),
          `${relative} contains a string literal matching forbidden phrase ${JSON.stringify(literal)}. ` +
            `If you're documenting the historical pattern, move it to a code comment (// or /* ... */).`,
        ).toBe(false);
      }
    });
  }

  it("PLACEHOLDER_PATTERNS list is non-empty (sanity guard)", () => {
    expect(PLACEHOLDER_PATTERNS.length).toBeGreaterThanOrEqual(8);
  });
});

describe("Architecture — production active recs queue has zero placeholder strings", () => {
  const tenantDirs = (() => {
    if (!existsSync(TENANTS_DIR)) return [];
    return readdirSync(TENANTS_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(TENANTS_DIR, entry.name));
  })();

  // If there are no tenant dirs (CI / fresh checkout), the test is a
  // no-op rather than a false negative.
  if (tenantDirs.length === 0) {
    it("no tenant directories present — skipping queue audit", () => {
      expect(tenantDirs.length).toBe(0);
    });
    return;
  }

  for (const tenantDir of tenantDirs) {
    const editsPath = join(tenantDir, "recommended-edits.json");
    if (!existsSync(editsPath)) continue;
    const tenantSlug = tenantDir.split("/").pop() ?? "(unknown)";

    it(`${tenantSlug} active recs contain zero placeholder phrases`, () => {
      let edits: Array<Record<string, unknown>> = [];
      try {
        edits = JSON.parse(readFileSync(editsPath, "utf-8"));
      } catch (err) {
        throw new Error(
          `Failed to parse ${editsPath}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      const violations: Array<{
        id: string;
        field: "proposed_text" | "display_label";
        patternId: string;
        snippet: string;
      }> = [];
      for (const edit of edits) {
        const status = edit.implementation_status as string | undefined;
        // Operator-locked: only `recommended` rows are operator-visible
        // as live recs. `dismissed` rows are historical/audit; we keep
        // them in the file for traceability. `accepted` / `verified_live`
        // rows have already been operator-confirmed; they shouldn't
        // contain placeholder copy either, but we focus the gate on
        // the queue surface that ships to operator screens TODAY.
        if (status !== "recommended") continue;

        for (const field of ["proposed_text", "display_label"] as const) {
          const text = edit[field];
          if (typeof text !== "string" || text.length === 0) continue;
          const hit = detectPlaceholder(text);
          if (hit.matched) {
            violations.push({
              id: String(edit.id ?? "(unknown)"),
              field,
              patternId: hit.patternId,
              snippet: text.slice(0, 120),
            });
          }
        }
      }
      expect(
        violations,
        `Found ${violations.length} active rec(s) with placeholder phrases. ` +
          `Dismissed rows are exempt; \`recommended\` rows must NEVER contain placeholder copy. ` +
          `Violations: ${JSON.stringify(violations, null, 2)}`,
      ).toEqual([]);
    });

    it(`${tenantSlug} accepted/verified recs also contain zero placeholder phrases`, () => {
      // Defense in depth: an accepted rec that quietly carries a
      // placeholder is worse than a recommended one (the operator
      // committed to it).
      let edits: Array<Record<string, unknown>> = [];
      try {
        edits = JSON.parse(readFileSync(editsPath, "utf-8"));
      } catch {
        return; // already caught above
      }
      const violations: Array<{ id: string; status: string; patternId: string }> = [];
      for (const edit of edits) {
        const status = edit.implementation_status as string | undefined;
        if (status !== "accepted" && status !== "verified_live") continue;
        for (const field of ["proposed_text", "display_label"] as const) {
          const text = edit[field];
          if (typeof text !== "string" || text.length === 0) continue;
          const hit = detectPlaceholder(text);
          if (hit.matched) {
            violations.push({
              id: String(edit.id ?? "(unknown)"),
              status,
              patternId: hit.patternId,
            });
          }
        }
      }
      expect(violations).toEqual([]);
    });
  }
});
