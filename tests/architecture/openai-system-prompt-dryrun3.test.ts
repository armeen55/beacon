/**
 * LLM-DryRun-3 (operator audit, 2026-05-05) — strict-abstention SYSTEM_PROMPT
 * invariants.
 *
 * Background: LLM-DryRun-2 closed the three DryRun-1 OUTPUT-level failure
 * modes (UUID leaks, fabricated numbers, placeholders) but surfaced a
 * BEHAVIOR gap — gpt-5-mini ignored Rule 16.A trigger 2 (`confidence === "low"`
 * AND brandAssertions empty) when the packet had strong `aiSearchSignal`
 * + `competitorPageBlueprints`. The model evidently treated those signals
 * as permission to generate.
 *
 * Operator decision (2026-05-05): GO with B — tighten Rule 16.A to a HARD
 * CONTRACT. The required wording is locked in the operator brief and must
 * appear lexically in `providers/openai.ts` SYSTEM_PROMPT. This file pins
 * that wording.
 *
 * If a future regression softens the language back to "should consider"
 * or removes the explicit "even if …" override, this test fails the build
 * before the next dry-run can run.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");
const OPENAI_PROVIDER_PATH = join(
  REPO_ROOT,
  "src/domains/recommendations/providers/openai.ts",
);
const SRC = readFileSync(OPENAI_PROVIDER_PATH, "utf-8");

/**
 * Extract the SYSTEM_PROMPT template-literal content. Anchors on
 * `const SYSTEM_PROMPT = \`` and the matching close `\`;`.
 */
function getSystemPrompt(): string {
  const start = SRC.indexOf("const SYSTEM_PROMPT = `");
  expect(start).toBeGreaterThan(0);
  const open = SRC.indexOf("`", start);
  expect(open).toBeGreaterThan(0);
  const close = SRC.indexOf("\n`;", open);
  expect(close).toBeGreaterThan(open);
  return SRC.slice(open + 1, close);
}

const PROMPT = getSystemPrompt();

describe("LLM-DryRun-3 — Rule 16.A is a HARD CONTRACT, not advisory", () => {
  it("declares low-confidence abstention as a HARD CONTRACT", () => {
    expect(
      PROMPT.includes("LOW-CONFIDENCE ABSTENTION IS A HARD CONTRACT"),
      "SYSTEM_PROMPT must declare 'LOW-CONFIDENCE ABSTENTION IS A HARD CONTRACT' " +
        "to upgrade Rule 16.A from advisory to mandatory (DryRun-3 brief)",
    ).toBe(true);
  });

  it("uses MUST language, not 'should consider' or 'try to'", () => {
    expect(
      PROMPT.includes("MUST return an empty recommendations array"),
      "SYSTEM_PROMPT must contain 'MUST return an empty recommendations array' " +
        "in the abstention rule. Soft language ('should', 'consider', 'try to') " +
        "is exactly what made gpt-5-mini ignore Rule 16.A in DryRun-2.",
    ).toBe(true);
  });

  it("explicitly overrides aiSearchSignal.topSearchQueries", () => {
    expect(
      PROMPT.includes("even if aiSearchSignal.topSearchQueries") ||
        PROMPT.includes("even if\n    aiSearchSignal.topSearchQueries") ||
        /even if[\s\S]{0,40}aiSearchSignal\.topSearchQueries/.test(PROMPT),
      "SYSTEM_PROMPT must explicitly say '...even if aiSearchSignal.topSearchQueries...' " +
        "are non-empty. DryRun-2 showed the model used a strong topSearchQueries as " +
        "permission to generate; the new wording must close that loophole.",
    ).toBe(true);
  });

  it("explicitly overrides competitorPageBlueprints", () => {
    expect(
      /even if[\s\S]{0,160}competitorPageBlueprints/.test(PROMPT),
      "SYSTEM_PROMPT must explicitly say '...even if ... competitorPageBlueprints...' " +
        "are non-empty. The model also used strong blueprints as permission to generate.",
    ).toBe(true);
  });

  it("explicitly overrides ownedPageCandidates and competitorAngles", () => {
    expect(
      PROMPT.includes("ownedPageCandidates"),
      "SYSTEM_PROMPT must include ownedPageCandidates in the override list " +
        "(operator brief specified four signals: topSearchQueries, " +
        "competitorPageBlueprints, ownedPageCandidates, competitorAngles)",
    ).toBe(true);
    expect(
      PROMPT.includes("competitorAngles"),
      "SYSTEM_PROMPT must include competitorAngles in the override list",
    ).toBe(true);
  });

  it("declares the low-confidence + no-brandAssertions hard contract by name", () => {
    expect(
      /confidence is low[\s\S]{0,60}brandAssertions is empty/i.test(PROMPT) ||
        /resolution\.confidence === "low"[\s\S]{0,60}brandAssertions/.test(PROMPT) ||
        /confidence === "low"[\s\S]{0,80}brandAssertions/.test(PROMPT),
      "SYSTEM_PROMPT must conjoin 'confidence is low' with 'brandAssertions is empty' " +
        "in the hard-contract block (DryRun-3 brief)",
    ).toBe(true);
  });

  it("retains the trigger list with operator-curated brandAssertions language", () => {
    expect(
      PROMPT.includes("operator-curated"),
      "SYSTEM_PROMPT trigger list must qualify brandAssertions as " +
        "'operator-curated' so the model understands these are not " +
        "auto-derived signals (DryRun-3 brief)",
    ).toBe(true);
  });

  it("declares 'safe-but-generic edits' explicitly as a failure mode", () => {
    expect(
      PROMPT.includes("safe-but-generic edits is a failure") ||
        PROMPT.includes("safe-but-generic edits") ||
        /safe-but-generic[\s\S]{0,30}failure/.test(PROMPT),
      "SYSTEM_PROMPT must call out 'safe-but-generic edits is a failure' so the " +
        "model understands that producing coherent-sounding output on a " +
        "thin packet is the failure mode, not the success mode (DryRun-3 brief)",
    ).toBe(true);
  });
});

describe("LLM-DryRun-3 — Rule 16.A carries a concrete BAD/GOOD example", () => {
  it("includes a BAD example showing low-confidence packet generating edits", () => {
    expect(
      PROMPT.includes("BAD"),
      "SYSTEM_PROMPT must label a BAD example so the model can pattern-match " +
        "(DryRun-3 brief)",
    ).toBe(true);
    expect(
      /BAD[\s\S]{0,800}low[\s\S]{0,400}brandAssertions = \[\]/.test(PROMPT),
      "SYSTEM_PROMPT BAD example must show a low-confidence packet with empty " +
        "brandAssertions — the exact shape that DryRun-2 over-generated on",
    ).toBe(true);
  });

  it("includes a multi-prompt BAD example (DryRun-3.1 fix for Los Altos shape)", () => {
    // The first DryRun-3 attempt used only a 1-affected-prompt BAD
    // example. The model abstained on the 1-prompt Menlo Park packet
    // but STILL generated on the 3-prompt Los Altos packet (also
    // confidence-low, brand-empty). The fix: pin a multi-prompt BAD
    // example so the rule explicitly extends beyond single-prompt
    // packets.
    expect(
      /affectedPrompts\.length = 3/.test(PROMPT),
      "SYSTEM_PROMPT must include a multi-prompt BAD example (e.g. " +
        "affectedPrompts.length = 3) showing that the hard contract still " +
        "fires when multiple prompts are present (DryRun-3.1 brief — " +
        "needed to fix the Los Altos behavior gap)",
    ).toBe(true);
    expect(
      PROMPT.includes("Multiple prompts is NOT a") ||
        /multiple prompts is NOT a free pass/i.test(PROMPT),
      "SYSTEM_PROMPT must explicitly call out 'multiple prompts is NOT a " +
        "free pass' so the model can't infer that affectedPrompts.length > 1 " +
        "overrides the confidence-low rule",
    ).toBe(true);
  });

  it("declares the rule applies REGARDLESS of affectedPrompts.length", () => {
    expect(
      /REGARDLESS of how many affected[\s\S]{0,40}prompts/i.test(PROMPT) ||
        /regardless of[\s\S]{0,30}affectedPrompts\.length/i.test(PROMPT),
      "SYSTEM_PROMPT must explicitly say 'REGARDLESS of how many affected " +
        "prompts' so the model treats prompt-count as orthogonal to the " +
        "confidence gate",
    ).toBe(true);
  });

  it("includes a GOOD example with the empty recommendations array", () => {
    expect(
      PROMPT.includes("GOOD"),
      "SYSTEM_PROMPT must label a GOOD example so the model can pattern-match",
    ).toBe(true);
    expect(
      /GOOD[\s\S]{0,400}\{\s*"recommendations":\s*\[\]\s*\}/.test(PROMPT),
      'SYSTEM_PROMPT GOOD example must show the literal output { "recommendations": [] } ' +
        "so the model has zero ambiguity about what abstention looks like",
    ).toBe(true);
  });
});

describe("LLM-DryRun-3 — DryRun-2 invariants remain in place", () => {
  it("STRUCTURAL ABSTENTION header retained (no regression)", () => {
    expect(PROMPT.includes("STRUCTURAL ABSTENTION")).toBe(true);
  });
  it("legacy 'CORRECT answer for thin packets' framing retained", () => {
    expect(PROMPT.includes("CORRECT answer for thin packets")).toBe(true);
  });
  it("affectedPrompts.length === 1 trigger retained", () => {
    expect(PROMPT.match(/affectedPrompts\.length\s*===\s*1/)).not.toBeNull();
  });
  it("competitor/aiSignal/brandAssertion all-empty trigger retained", () => {
    expect(
      PROMPT.match(
        /competitorPageBlueprints[\s\S]*?aiSearchSignal\.topSearchQueries[\s\S]*?brandAssertions[\s\S]*?empty/,
      ),
    ).not.toBeNull();
  });
});
