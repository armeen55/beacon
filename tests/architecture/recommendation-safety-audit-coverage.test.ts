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
  auditRecommendedEditRow,
  type AuditableEditRow,
  type SafetyAuditContext,
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

  // -------------------------------------------------------------------------
  // Slice 4.5.G-B.4a — brand-support classification coverage
  // -------------------------------------------------------------------------

  describe("B.4a — claim-risk registry source presence", () => {
    const scannerSrc = readFileSync(SCANNER_FILE, "utf-8");

    it("scanner declares the global claim-risk registry + classifier", () => {
      expect(scannerSrc).toContain("CLAIM_RISK_BY_TOKEN");
      expect(scannerSrc).toContain("CLAIM_RISK_UNLOCK");
      expect(scannerSrc).toContain("classifyClaim");
    });

    it("scanner declares all 6 locked claim-risk categories", () => {
      for (const cat of [
        "professional_credential",
        "process",
        "ranking",
        "award",
        "guarantee_outcome",
        "superiority",
      ]) {
        expect(
          scannerSrc.includes(`"${cat}"`),
          `claim-risk category missing from scanner source: ${cat}`,
        ).toBe(true);
      }
    });
  });

  describe("B.4a — every architect token is classified (generic, behavioral)", () => {
    function ctx(
      overrides: Partial<SafetyAuditContext> = {},
    ): SafetyAuditContext {
      return {
        competitorNames: [],
        tenantId: "tenant-coverage",
        now: new Date("2026-05-22T00:00:00.000Z"),
        ...overrides,
      };
    }
    function rowWith(proposed: string): AuditableEditRow {
      return {
        rec_id: "rec-cov",
        target_url: null,
        proposed_text: proposed,
        why: "",
        display_label: null,
        expected_impact: null,
        measurement_plan: null,
      };
    }

    for (const tok of ARCHITECT_OVERCLAIM_TOKENS) {
      it(`architect token "${tok}" emits a classified violation (claim_risk_category + brand_supported defined)`, () => {
        const result = auditRecommendedEditRow(
          rowWith(`prefix ${tok} suffix`),
          ctx(),
        );
        const v = result.violations.find(
          (x) =>
            x.kind === "architect_overclaim" &&
            x.normalized_match === tok.toLowerCase(),
        );
        expect(v, `no architect_overclaim violation for "${tok}"`).toBeDefined();
        expect(v!.claim_risk_category).toBeTruthy();
        // With no assertions supplied → unsupported (safe default).
        expect(v!.brand_supported).toBe(false);
      });
    }

    it("supplying a matching phrase flips brand_supported to true (generic, no tenant-name logic)", () => {
      const result = auditRecommendedEditRow(
        rowWith("architect-led design-build"),
        ctx({
          brandAssertions: [
            { id: "x", phrase: "architect-led design-build", category: "process" },
          ],
        }),
      );
      const v = result.violations.find(
        (x) => x.normalized_match === "architect-led",
      )!;
      expect(v.brand_supported).toBe(true);
      // Violation NOT suppressed.
      expect(result.violations.length).toBeGreaterThan(0);
    });
  });

  describe("B.4a — scanner test file exercises brand-support behavior", () => {
    const testSrc = readFileSync(SCANNER_TEST_FILE, "utf-8");
    // Active (comment-stripped) source — the no-tenant-name pin checks
    // CODE only; an explanatory comment that mentions the production
    // tenant by name to document the synthetic-tenant convention is
    // allowed.
    const activeTestSrc = testSrc
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");

    it("exercises brand_supported true AND false + claim_risk_category + normalized_match", () => {
      expect(testSrc).toContain("brand_supported");
      expect(testSrc).toMatch(/brand_supported\)\.toBe\(true\)/);
      expect(testSrc).toMatch(/brand_supported\)\.toBe\(false\)/);
      expect(testSrc).toContain("claim_risk_category");
      expect(testSrc).toContain("normalized_match");
    });

    it("uses SYNTHETIC tenants in active code — no tenant-name-specific logic", () => {
      expect(activeTestSrc).not.toContain("Ritz Builders");
      expect(activeTestSrc).not.toContain("ritz-builders");
    });
  });
});
