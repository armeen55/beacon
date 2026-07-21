/**
 * CONSTITUTION §10 — Claim provenance (honest trust labels).
 *
 * Consolidated from score-provenance-trust-labels + verdict-provenance-trust-labels.
 * Every surfaced number/verdict carries an honest trust label that tracks the
 * audit findings; a "small copy fix" cannot quietly upgrade `directional` to
 * `trustworthy` or invert the abstain rubric, and customer copy never leaks
 * raw Z-scores, Greek, SQL, or table names.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..", "..");
const read = (rel: string) => fs.readFileSync(path.resolve(ROOT, rel), "utf-8");

// ── Score provenance (Today KPIs) ───────────────────────────────────
const SCORE_SRC = read("src/domains/today/score-provenance.ts");
const WHY_SRC = read("src/components/today/why-this-number.tsx");

describe("score provenance — honest 3-level trust labels (T3.1)", () => {
  it("uses the canonical trustworthy/directional/unreliable vocabulary", () => {
    expect(SCORE_SRC).toMatch(/"trustworthy"/);
    expect(SCORE_SRC).toMatch(/"directional"/);
    expect(SCORE_SRC).toMatch(/"unreliable"/);
  });

  for (const [fn, level] of [
    ["buildOverallVisibilityProvenance", "directional"],
    ["buildPrimaryRateProvenance", "directional"],
    ["buildCompetitorLeaderboardProvenance", "directional"],
    ["buildShareCaptureProvenance", "unreliable"],
  ] as const) {
    it(`${fn} hardcodes trustLevel "${level}" (no env-gated upgrade)`, () => {
      const m = new RegExp(
        `function ${fn}[\\s\\S]+?return\\s*\\{[\\s\\S]+?\\};\\s*\\}`,
        "m",
      ).exec(SCORE_SRC);
      expect(m, `${fn} not found`).not.toBeNull();
      expect(m![0]).toMatch(new RegExp(`trustLevel:\\s*"${level}"`));
      expect(m![0]).not.toMatch(/trustLevel:\s*"trustworthy"/);
    });
  }

  it("'trustworthy' is reachable only for early/winning prompt categories", () => {
    const m = /function buildPromptCategoryProvenance[\s\S]+?return\s*\{[\s\S]+?\};\s*\}/m.exec(
      SCORE_SRC,
    );
    expect(m).not.toBeNull();
    expect(m![0]).toMatch(
      /category\s*===\s*"early"\s*\|\|\s*input\.category\s*===\s*"winning"/,
    );
  });

  it("WhyThisNumber renders 3 distinct badge labels + tones behind a disclosure", () => {
    expect(WHY_SRC).toMatch(/trustworthy:\s*"Trustworthy"/);
    expect(WHY_SRC).toMatch(/directional:\s*"Directional"/);
    expect(WHY_SRC).toMatch(/unreliable:\s*"Unreliable"/);
    expect(WHY_SRC).toMatch(/status-success/);
    expect(WHY_SRC).toMatch(/amber/);
    expect(WHY_SRC).toMatch(/status-danger/);
    expect(WHY_SRC).toMatch(/Why this number\?/);
    expect(WHY_SRC).toMatch(/<details[^>]*>[\s\S]+?<summary[\s\S]+?Operator detail/);
  });
});

// ── Verdict provenance (attribution) ────────────────────────────────
const VERDICT_SRC = read("src/domains/attribution/verdict-provenance.ts");

describe("verdict provenance — honest trust labels + abstain rubric (T3.2)", () => {
  it("uses the canonical trust vocabulary", () => {
    expect(VERDICT_SRC).toMatch(/"trustworthy"/);
    expect(VERDICT_SRC).toMatch(/"directional"/);
    expect(VERDICT_SRC).toMatch(/"unreliable"/);
  });

  it("the 5 abstain verdicts are trustworthy abstains", () => {
    const isAbstain = /function isAbstain[\s\S]+?return\s*\(([\s\S]+?)\);[\s\S]+?\}/m.exec(
      VERDICT_SRC,
    );
    expect(isAbstain).not.toBeNull();
    const map = /VERDICT_PLAIN_TRUSTWORTHY[\s\S]+?\}\s*;/.exec(VERDICT_SRC);
    expect(map).not.toBeNull();
    for (const v of [
      "not_enough_data",
      "too_early",
      "nothing_yet",
      "not_enough_native_baseline",
      "not_implemented",
    ]) {
      expect(isAbstain![1], `isAbstain missing ${v}`).toContain(`"${v}"`);
      expect(map![0]).toContain(v);
    }
    expect((map![0].match(/Trustworthy abstain/g) ?? []).length).toBeGreaterThanOrEqual(5);
  });

  it("helping/hurting default directional; sparse pre-window → unreliable; abstain → trustworthy", () => {
    expect(VERDICT_SRC).toMatch(/sparsePreWindow/);
    expect(VERDICT_SRC).toMatch(/preFullPollDays\s*<\s*5/);
    expect(VERDICT_SRC).toMatch(/if\s*\(sparsePreWindow\)\s*\{\s*[\s\S]+?trustLevel\s*=\s*"unreliable"/);
    expect(VERDICT_SRC).toMatch(/else\s*\{\s*[\s\S]+?trustLevel\s*=\s*"directional"/);
    expect(
      VERDICT_SRC,
    ).toMatch(/if\s*\(isAbstain\(input\.verdict\)\)\s*\{\s*[\s\S]+?trustLevel\s*=\s*"trustworthy"/);
  });

  it("the contaminated-dates list is the canonical 3 T2-audit dates", () => {
    const list = /CONTAMINATED_DATES\s*=\s*\[([\s\S]+?)\]/.exec(VERDICT_SRC);
    expect(list).not.toBeNull();
    expect(list![1]).toContain('"2026-04-23"');
    expect(list![1]).toContain('"2026-04-26"');
    expect(list![1]).toContain('"2026-05-06"');
  });

  it("customer copy never prints raw Z-score, Greek, or SQL table names", () => {
    const segs =
      VERDICT_SRC.match(
        /(?:caveats\.push|plainEnglish\s*=|VERDICT_LABEL_MAP|VERDICT_PLAIN_TRUSTWORTHY)[\s\S]+?[`"][\s\S]+?[`"]/g,
      ) ?? [];
    for (const seg of segs) {
      expect(seg).not.toMatch(/[Zz][ -]?score/);
      expect(seg).not.toContain("μ");
      expect(seg).not.toContain("σ");
      expect(seg).not.toMatch(/\bmu_pre\b|\bmu_post\b|\bsigma_pre\b|\bsigma_post\b/);
      expect(seg).not.toContain("daily_metric_snapshots");
      expect(seg).not.toContain("prompt_answer_observations");
    }
  });
});
