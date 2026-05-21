/**
 * Architecture invariant — Slice 4.5.G-A (2026-05-21):
 * recommendation safety audit coverage contract.
 *
 * Pins THREE things:
 *
 *   1. All `SafetyViolationKind` values are exercised in
 *      `tests/domains/recommendation-intelligence/safety-audit.test.ts`
 *      (every locked violation kind has at least one positive case
 *      in the scanner unit-test file).
 *
 *   2. The architect-overclaim token list contains the 10
 *      operator-locked terms (per K3): architect-led, architect-
 *      designed, licensed, licensed architect, accredited,
 *      certified, endorsed, master craftsman, award-winning,
 *      top-rated.
 *
 *   3. The causal-language token list contains the 9 operator-
 *      locked terms: drove, caused, generated, revenue, roi,
 *      leads, sales, converted, produced.
 *
 *   4. The scanner scans `proposed_text` and `why` at minimum
 *      (substring scan on the source of the scanner file).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  ARCHITECT_OVERCLAIM_TOKENS,
  CAUSAL_LANGUAGE_TOKENS,
} from "@/domains/recommendation-intelligence/safety-audit";

const REPO_ROOT = resolve(__dirname, "..", "..");
const SCANNER_FILE = resolve(
  REPO_ROOT,
  "src",
  "domains",
  "recommendation-intelligence",
  "safety-audit.ts",
);
const SCANNER_TEST_FILE = resolve(
  REPO_ROOT,
  "tests",
  "domains",
  "recommendation-intelligence",
  "safety-audit.test.ts",
);

const ALL_VIOLATION_KINDS: ReadonlyArray<string> = [
  "placeholder",
  "competitor_name",
  "unsupported_claim",
  "architect_overclaim",
  "causal_language",
  "em_dash",
  "leading_superlative",
  "internal_token",
  "uuid_leak",
];

const LOCKED_ARCHITECT_OVERCLAIM_TOKENS: ReadonlyArray<string> = [
  "architect-led",
  "architect-designed",
  "licensed",
  "licensed architect",
  "accredited",
  "certified",
  "endorsed",
  "master craftsman",
  "award-winning",
  "top-rated",
];

const LOCKED_CAUSAL_LANGUAGE_TOKENS: ReadonlyArray<string> = [
  "drove",
  "caused",
  "generated",
  "revenue",
  "roi",
  "leads",
  "sales",
  "converted",
  "produced",
];

describe("recommendation-safety-audit-coverage", () => {
  describe("violation-kind coverage in the scanner test file", () => {
    const testSrc = readFileSync(SCANNER_TEST_FILE, "utf-8");

    for (const kind of ALL_VIOLATION_KINDS) {
      it(`scanner tests exercise SafetyViolationKind "${kind}"`, () => {
        // Each kind must appear in the test source either as a
        // literal string ("placeholder") or in a kind === ".." check.
        expect(
          testSrc.includes(`"${kind}"`) ||
            testSrc.includes(`'${kind}'`) ||
            testSrc.includes(`v.kind === "${kind}"`),
          `Scanner test file does not exercise kind: ${kind}`,
        ).toBe(true);
      });
    }
  });

  describe("locked architect-overclaim token list", () => {
    it("exports the 10 locked tokens (K3)", () => {
      expect(ARCHITECT_OVERCLAIM_TOKENS.length).toBe(10);
      for (const tok of LOCKED_ARCHITECT_OVERCLAIM_TOKENS) {
        expect(
          ARCHITECT_OVERCLAIM_TOKENS.includes(tok),
          `Missing locked architect-overclaim token: ${tok}`,
        ).toBe(true);
      }
    });

    it("does not contain extras beyond the locked 10", () => {
      const allowed = new Set<string>(LOCKED_ARCHITECT_OVERCLAIM_TOKENS);
      const extras = ARCHITECT_OVERCLAIM_TOKENS.filter(
        (t) => !allowed.has(t),
      );
      expect(
        extras,
        `Unexpected architect-overclaim tokens (must be locked set only): ${extras.join(", ")}`,
      ).toEqual([]);
    });
  });

  describe("locked causal-language token list", () => {
    it("exports the 9 locked tokens", () => {
      expect(CAUSAL_LANGUAGE_TOKENS.length).toBe(9);
      for (const tok of LOCKED_CAUSAL_LANGUAGE_TOKENS) {
        expect(
          CAUSAL_LANGUAGE_TOKENS.includes(tok),
          `Missing locked causal-language token: ${tok}`,
        ).toBe(true);
      }
    });

    it("does not contain extras beyond the locked 9", () => {
      const allowed = new Set<string>(LOCKED_CAUSAL_LANGUAGE_TOKENS);
      const extras = CAUSAL_LANGUAGE_TOKENS.filter((t) => !allowed.has(t));
      expect(
        extras,
        `Unexpected causal-language tokens (must be locked set only): ${extras.join(", ")}`,
      ).toEqual([]);
    });
  });

  describe("scanner field coverage", () => {
    const scannerSrc = readFileSync(SCANNER_FILE, "utf-8");

    it("scanner scans proposed_text", () => {
      expect(
        /scanField\([^)]*row\.proposed_text/.test(scannerSrc),
        "scanner must invoke scanField on row.proposed_text",
      ).toBe(true);
    });

    it("scanner scans why", () => {
      expect(
        /scanField\([^)]*row\.why/.test(scannerSrc),
        "scanner must invoke scanField on row.why",
      ).toBe(true);
    });
  });
});
