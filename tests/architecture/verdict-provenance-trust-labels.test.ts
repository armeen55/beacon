/**
 * Architecture invariant — Trust Sprint Mini-Phase T3.2 (2026-05-06).
 *
 * Pins the verdict-provenance trust-label honesty contract at the
 * source-text level so a future "small copy fix" cannot quietly upgrade
 * `directional` to `trustworthy` or invert the abstain rubric.
 *
 * Contract verified:
 *   1. verdict-provenance.ts uses the canonical trust-level strings.
 *   2. Abstains are unconditionally TRUSTWORTHY.
 *   3. helping/hurting on a clean window default to DIRECTIONAL (the
 *      builder's `if (hasContam || sparsePreWindow) → unreliable;
 *      else → directional` block).
 *   4. The contaminated-date helper exposes the operator-locked list.
 *   5. The `<WhyThisVerdict>` component renders all 3 trust-badge
 *      labels and uses the operator-locked phrasing "Why this verdict?".
 *   6. The customer summary line never prints raw Z-score / Greek
 *      notation / SQL / table names. (Operator-only `operatorDetail` is
 *      excluded — that field intentionally documents Z-score for debug.)
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
  "attribution",
  "verdict-provenance.ts",
);
const WHY_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "src",
  "components",
  "changes",
  "why-this-verdict.tsx",
);

const PROVENANCE_SRC = fs.readFileSync(PROVENANCE_PATH, "utf-8");
const WHY_SRC = fs.readFileSync(WHY_PATH, "utf-8");

describe("Architecture — verdict trust labels are honest (T3.2)", () => {
  it("verdict-provenance.ts uses the canonical 3-level trust vocabulary", () => {
    expect(PROVENANCE_SRC).toMatch(/\"trustworthy\"/);
    expect(PROVENANCE_SRC).toMatch(/\"directional\"/);
    expect(PROVENANCE_SRC).toMatch(/\"unreliable\"/);
  });

  it("isAbstain returns trustworthy for the 5 abstain verdicts", () => {
    // Pin the exact set so adding a new abstain verdict gets surfaced.
    const isAbstainFn =
      /function isAbstain[\s\S]+?return\s*\(([\s\S]+?)\);[\s\S]+?\}/m.exec(PROVENANCE_SRC);
    expect(isAbstainFn, "isAbstain function not found").not.toBeNull();
    const body = isAbstainFn![1];
    for (const verdict of [
      "not_enough_data",
      "too_early",
      "nothing_yet",
      "not_enough_native_baseline",
      "not_implemented",
    ]) {
      expect(body, `isAbstain missing ${verdict}`).toContain(`\"${verdict}\"`);
    }
  });

  it("helping/hurting trust default = directional; sparse pre-window → unreliable", () => {
    // T3.2 final rubric: sparse pre-window is the ONLY trigger for
    // unreliable on helping/hurting (contaminated dates surface a strong
    // caveat but stay directional because T2 cleaned the underlying data).
    // Pin individual assertions on the full source rather than carving a
    // sub-block — the if/else nesting makes regex extraction brittle.
    expect(PROVENANCE_SRC).toMatch(/sparsePreWindow/);
    expect(PROVENANCE_SRC).toMatch(/preFullPollDays\s*<\s*5/);
    expect(PROVENANCE_SRC).toMatch(/if\s*\(sparsePreWindow\)\s*\{\s*[\s\S]+?trustLevel\s*=\s*\"unreliable\"/);
    expect(PROVENANCE_SRC).toMatch(/else\s*\{\s*[\s\S]+?trustLevel\s*=\s*\"directional\"/);
    // And the abstain branch sets trustworthy.
    expect(PROVENANCE_SRC).toMatch(/if\s*\(isAbstain\(input\.verdict\)\)\s*\{\s*[\s\S]+?trustLevel\s*=\s*\"trustworthy\"/);
  });

  it("the 5 abstain verdicts have customer-safe plainEnglish copy that says 'trustworthy abstain'", () => {
    // Each entry of VERDICT_PLAIN_TRUSTWORTHY must include "Trustworthy abstain".
    const map = /VERDICT_PLAIN_TRUSTWORTHY[\s\S]+?\}\s*;/.exec(PROVENANCE_SRC);
    expect(map, "VERDICT_PLAIN_TRUSTWORTHY not found").not.toBeNull();
    for (const verdict of [
      "not_enough_data",
      "too_early",
      "nothing_yet",
      "not_enough_native_baseline",
      "not_implemented",
    ]) {
      expect(map![0]).toContain(verdict);
    }
    // Each line ends with a "Trustworthy abstain" prefix (case-sensitive).
    const trustworthyAbstainCount =
      (map![0].match(/Trustworthy abstain/g) ?? []).length;
    expect(trustworthyAbstainCount).toBeGreaterThanOrEqual(5);
  });

  it("the contaminated-dates list is the canonical 3 dates from the T2 audit", () => {
    const list = /CONTAMINATED_DATES\s*=\s*\[([\s\S]+?)\]/.exec(PROVENANCE_SRC);
    expect(list).not.toBeNull();
    expect(list![1]).toContain('"2026-04-23"');
    expect(list![1]).toContain('"2026-04-26"');
    expect(list![1]).toContain('"2026-05-06"');
  });

  it("the builder never prints raw Z-score, Greek, or SQL in customer copy", () => {
    // Locate every `caveats.push(...)` and `plainEnglish = ...` literal in
    // the source. None may contain "Z-score", "μ", "σ", "mu_pre", "sigma_pre",
    // raw table names, or SQL keywords.
    const literalSegments = PROVENANCE_SRC.match(
      /(?:caveats\.push|plainEnglish\s*=|VERDICT_LABEL_MAP|VERDICT_PLAIN_TRUSTWORTHY)[\s\S]+?[`"][\s\S]+?[`"]/g,
    ) ?? [];
    for (const seg of literalSegments) {
      // operatorDetail.push(...) is allowed to contain the debug variables.
      // We only check caveats / plainEnglish / customer labels here.
      expect(seg, `customer literal leaks Z-score: ${seg.slice(0, 80)}…`).not.toMatch(/[Zz][ -]?score/);
      expect(seg).not.toContain("μ");
      expect(seg).not.toContain("σ");
      expect(seg).not.toMatch(/\bmu_pre\b|\bmu_post\b|\bsigma_pre\b|\bsigma_post\b/);
      expect(seg).not.toContain("daily_metric_snapshots");
      expect(seg).not.toContain("prompt_answer_observations");
    }
  });
});

describe("Architecture — <WhyThisVerdict> renders honest trust badges (T3.2)", () => {
  it("WhyThisVerdict maps every VerdictTrustLevel to a distinct label string", () => {
    expect(WHY_SRC).toMatch(/trustworthy:\s*\"Trustworthy\"/);
    expect(WHY_SRC).toMatch(/directional:\s*\"Directional\"/);
    expect(WHY_SRC).toMatch(/unreliable:\s*\"Unreliable\"/);
  });

  it("WhyThisVerdict maps every trust level to a distinct color tone", () => {
    expect(WHY_SRC).toMatch(/status-success/);
    expect(WHY_SRC).toMatch(/amber/);
    expect(WHY_SRC).toMatch(/status-danger/);
  });

  it("WhyThisVerdict summary uses the operator-locked phrasing 'Why this verdict?'", () => {
    expect(WHY_SRC).toMatch(/Why this verdict\?/);
  });

  it("WhyThisVerdict surfaces operatorDetail only behind a nested disclosure", () => {
    expect(WHY_SRC).toMatch(/Operator detail/);
    expect(WHY_SRC).toMatch(/<details[^>]*>[\s\S]+?<summary[\s\S]+?Operator detail/);
  });

  it("WhyThisVerdict customer summary never prints Z-score / Greek directly (must be in operatorDetail)", () => {
    // Strip the JSX block that renders operatorDetail (the nested <details>).
    // What's left should not contain Z-score / Greek labels in customer copy.
    const sanitized = WHY_SRC.replace(/<details[\s\S]+?Operator detail[\s\S]+?<\/details>/g, "");
    // The component renders dynamic provenance content via {provenance.X} so
    // the source itself doesn't print the literal Z-score; this check just
    // pins that the component does NOT introduce any new Greek/Z literals.
    expect(sanitized).not.toMatch(/[Zz][ -]?score/);
    expect(sanitized).not.toContain("μ");
    expect(sanitized).not.toContain("σ");
  });
});
