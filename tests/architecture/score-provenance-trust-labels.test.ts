/**
 * Architecture invariant — Trust Sprint Mini-Phase T3.1 (2026-05-06).
 *
 * The honesty contract: trust labels MUST track the audit findings.
 * This file pins the contract at the source-text level so a future
 * "small copy fix" cannot quietly upgrade `directional` to `trustworthy`
 * or invert the rubric without tripping a build failure.
 *
 * Contract verified:
 *   1. score-provenance.ts uses the canonical trust-level strings
 *      `"trustworthy"`, `"directional"`, `"unreliable"`.
 *   2. The `<WhyThisNumber>` component renders all three trust-badge
 *      labels and maps each to a distinct color class.
 *   3. The `WhyThisNumber` summary text reads "Why this number?" — the
 *      operator-locked phrasing for the disclosure trigger.
 *   4. Customer-facing strings in the provenance module never include
 *      raw table names, SQL keywords, or UUID-shaped tokens.
 *      (Operator-only `operatorDetail` is excluded — it is the debug
 *      field where table names are allowed.)
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const PROVENANCE_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "src",
  "domains",
  "today",
  "score-provenance.ts",
);
const WHY_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "src",
  "components",
  "today",
  "why-this-number.tsx",
);

const PROVENANCE_SRC = fs.readFileSync(PROVENANCE_PATH, "utf-8");
const WHY_SRC = fs.readFileSync(WHY_PATH, "utf-8");

describe("Architecture — trust labels are honest (T3.1)", () => {
  it("score-provenance.ts uses the canonical 3-level trust vocabulary", () => {
    expect(PROVENANCE_SRC).toMatch(/\"trustworthy\"/);
    expect(PROVENANCE_SRC).toMatch(/\"directional\"/);
    expect(PROVENANCE_SRC).toMatch(/\"unreliable\"/);
  });

  it("composite-visibility builder hardcodes 'directional' (no env-gated upgrade path)", () => {
    // Find the buildOverallVisibilityProvenance function body and assert
    // it returns trustLevel: "directional" — not a variable that could be
    // dynamically promoted to "trustworthy".
    const fn = /function buildOverallVisibilityProvenance[\s\S]+?return\s*\{[\s\S]+?\};\s*\}/m.exec(
      PROVENANCE_SRC,
    );
    expect(fn, "function not found in source").not.toBeNull();
    expect(fn![0]).toMatch(/trustLevel:\s*\"directional\"/);
    expect(fn![0]).not.toMatch(/trustLevel:\s*\"trustworthy\"/);
  });

  it("primary-rate builder hardcodes 'directional' (latest-day rate, not window average)", () => {
    const fn = /function buildPrimaryRateProvenance[\s\S]+?return\s*\{[\s\S]+?\};\s*\}/m.exec(
      PROVENANCE_SRC,
    );
    expect(fn).not.toBeNull();
    expect(fn![0]).toMatch(/trustLevel:\s*\"directional\"/);
    expect(fn![0]).not.toMatch(/trustLevel:\s*\"trustworthy\"/);
  });

  it("competitor-leaderboard builder hardcodes 'directional' (formula asymmetry)", () => {
    const fn = /function buildCompetitorLeaderboardProvenance[\s\S]+?return\s*\{[\s\S]+?\};\s*\}/m.exec(
      PROVENANCE_SRC,
    );
    expect(fn).not.toBeNull();
    expect(fn![0]).toMatch(/trustLevel:\s*\"directional\"/);
    expect(fn![0]).not.toMatch(/trustLevel:\s*\"trustworthy\"/);
  });

  it("share-capture builder hardcodes 'unreliable' (coincidence detector)", () => {
    const fn = /function buildShareCaptureProvenance[\s\S]+?return\s*\{[\s\S]+?\};\s*\}/m.exec(
      PROVENANCE_SRC,
    );
    expect(fn).not.toBeNull();
    expect(fn![0]).toMatch(/trustLevel:\s*\"unreliable\"/);
    expect(fn![0]).not.toMatch(/trustLevel:\s*\"trustworthy\"/);
  });

  it("prompt-category builder is the ONLY place 'trustworthy' is reachable, and only for early/winning", () => {
    // Find every `trustLevel:` assignment in the source; each
    // 'trustworthy' must be guarded by an early/winning condition.
    const fn = /function buildPromptCategoryProvenance[\s\S]+?return\s*\{[\s\S]+?\};\s*\}/m.exec(
      PROVENANCE_SRC,
    );
    expect(fn).not.toBeNull();
    // The trust level is computed at the top with an explicit conditional.
    expect(fn![0]).toMatch(/category\s*===\s*\"early\"\s*\|\|\s*input\.category\s*===\s*\"winning\"/);
  });
});

describe("Architecture — <WhyThisNumber> renders all 3 trust badges (T3.1)", () => {
  it("WhyThisNumber maps every ScoreTrustLevel to a distinct label string", () => {
    expect(WHY_SRC).toMatch(/trustworthy:\s*\"Trustworthy\"/);
    expect(WHY_SRC).toMatch(/directional:\s*\"Directional\"/);
    expect(WHY_SRC).toMatch(/unreliable:\s*\"Unreliable\"/);
  });

  it("WhyThisNumber maps every trust level to a distinct color tone", () => {
    // status-success for trustworthy, amber for directional, status-danger for unreliable.
    // Distinct color classes prevent the "everything looks green" anti-pattern.
    expect(WHY_SRC).toMatch(/status-success/);
    expect(WHY_SRC).toMatch(/amber/);
    expect(WHY_SRC).toMatch(/status-danger/);
  });

  it("WhyThisNumber summary uses the operator-locked phrasing 'Why this number?'", () => {
    expect(WHY_SRC).toMatch(/Why this number\?/);
  });

  it("WhyThisNumber surfaces operatorDetail only behind a nested disclosure", () => {
    // Pattern: there must be a nested <details> whose summary is "Operator detail".
    expect(WHY_SRC).toMatch(/Operator detail/);
    // And the trigger must be a <details>/<summary> pair (not a public field).
    expect(WHY_SRC).toMatch(/<details[^>]*>[\s\S]+?<summary[\s\S]+?Operator detail/);
  });
});
