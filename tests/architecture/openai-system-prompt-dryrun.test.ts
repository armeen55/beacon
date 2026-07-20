/**
 * LLM DryRun SYSTEM_PROMPT invariants (consolidated 2026-05-05 audits;
 * merged 2026-07-20 architecture-suite diet).
 *
 * Source-text invariants rather than runtime LLM checks: CI can't run a
 * paid OpenAI call to prove the model honors a rule, so we pin that the
 * rule TEXT is present (or, for the 3.5 negative case, ABSENT) in the
 * SYSTEM_PROMPT of `src/domains/recommendations/providers/openai.ts`.
 * The complementary runtime validator gate lives in the dryrun2
 * validator test.
 *
 * Subsumes (each pin preserved exactly once — the former per-file
 * "DryRun-N invariants remain in place" regression blocks were literal
 * re-assertions of pins already made below, so they are dropped, not
 * lost: removing any single pin still fails this build):
 *   • openai-system-prompt-dryrun2   (DryRun-2 — UUID / fabricated-numbers / structural abstention)
 *   • openai-system-prompt-dryrun3   (DryRun-3 — Rule 16.A hard contract + BAD/GOOD examples)
 *   • openai-system-prompt-dryrun3.5 (DryRun-3.5 — single-prompt CAUTION scope fix)
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

/** Extract the SYSTEM_PROMPT template-literal content. */
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

/**
 * Extract just the hard-abstain trigger list (the bullet items at the
 * top of Rule 16.A). The CAUTION block lives below it and is inspected
 * separately.
 */
function getHardAbstainTriggerBlock(): string {
  const startMatch = PROMPT.match(
    /Return an empty recommendations[\s\S]{0,40}array BEFORE writing any edits when ANY of these/,
  );
  expect(startMatch).not.toBeNull();
  const start = startMatch ? startMatch.index ?? -1 : -1;
  expect(start).toBeGreaterThan(0);
  const tail = PROMPT.slice(start);
  const endRel = tail.search(/\n\s*\n\s*\*\*/);
  expect(endRel).toBeGreaterThan(0);
  return tail.slice(0, endRel);
}

describe("DryRun-2 — no-UUID-in-why rule", () => {
  it("includes the explicit GOOD shape (snippet citation)", () => {
    expect(
      PROMPT.includes("best whole home remodel builders bay area"),
      "SYSTEM_PROMPT must include the GOOD snippet-citation example (DryRun-2 Rule B)",
    ).toBe(true);
  });
  it("includes the explicit BAD shape (raw UUID in why)", () => {
    expect(
      PROMPT.includes("7ee3216b-327c-4de9-8d5d-2f4c95a6d773"),
      "SYSTEM_PROMPT must include a BAD example showing a raw UUID in why (DryRun-2 Rule B)",
    ).toBe(true);
  });
  it("explicitly forbids UUIDs in why / expectedImpact / measurementPlan", () => {
    expect(
      PROMPT.includes("NEVER include raw prompt UUIDs"),
      "SYSTEM_PROMPT must forbid raw prompt UUIDs in operator-visible copy (DryRun-2 Rule B)",
    ).toBe(true);
    expect(
      PROMPT.match(/why[\s\S]*expectedImpact[\s\S]*measurementPlan/),
      "SYSTEM_PROMPT must list why, expectedImpact, AND measurementPlan (DryRun-2 Rule B)",
    ).not.toBeNull();
  });
  it("clarifies that evidence[].promptId is the canonical home for raw IDs", () => {
    expect(
      PROMPT.includes("evidence[].promptId"),
      "SYSTEM_PROMPT must direct raw IDs to evidence[].promptId (DryRun-2 Rule B)",
    ).toBe(true);
  });
});

describe("DryRun-2 — structural-abstention rule", () => {
  it("declares the abstain rule with explicit triggers", () => {
    expect(
      PROMPT.includes("STRUCTURAL ABSTENTION"),
      "SYSTEM_PROMPT must declare a STRUCTURAL ABSTENTION rule (DryRun-2 Rule D)",
    ).toBe(true);
    expect(
      PROMPT.match(/affectedPrompts\.length\s*===\s*1/),
      "Abstention rule must reference `affectedPrompts.length === 1` trigger (DryRun-2 Rule D)",
    ).not.toBeNull();
    expect(
      PROMPT.match(/resolution\.confidence\s*===\s*"low"/),
      "Abstention rule must reference `resolution.confidence === 'low'` trigger (DryRun-2 Rule D)",
    ).not.toBeNull();
    expect(
      PROMPT.match(
        /competitorPageBlueprints[\s\S]*?aiSearchSignal\.topSearchQueries[\s\S]*?brandAssertions[\s\S]*?empty/,
      ),
      "Abstention rule must reference the all-three-empty trigger (DryRun-2 Rule D)",
    ).not.toBeNull();
  });
  it("makes empty recommendations the explicit correct answer", () => {
    expect(
      PROMPT.includes("CORRECT answer for thin packets"),
      "SYSTEM_PROMPT must declare 'Empty recommendations [] is a CORRECT answer for thin packets' (DryRun-2 Rule D)",
    ).toBe(true);
  });
});

describe("DryRun-2 — no-fabricated-numbers rule", () => {
  it("declares the no-fabricated-numbers rule with concrete forbidden examples", () => {
    expect(
      PROMPT.includes("NO FABRICATED NUMBERS"),
      "SYSTEM_PROMPT must declare a NO FABRICATED NUMBERS rule (DryRun-2 Rule C)",
    ).toBe(true);
    expect(
      PROMPT.includes("12 to 18 months"),
      "SYSTEM_PROMPT must reference the DryRun-1 leak '12 to 18 months' (DryRun-2 Rule C)",
    ).toBe(true);
    expect(
      PROMPT.match(/per\s+square\s+foot/i),
      "SYSTEM_PROMPT must forbid per-square-foot cost claims (DryRun-2 Rule C)",
    ).not.toBeNull();
    expect(
      PROMPT.match(/Specific durations|months.*weeks.*days/i),
      "SYSTEM_PROMPT must forbid specific durations (DryRun-2 Rule C)",
    ).not.toBeNull();
  });
  it("requires brandAssertions VERBATIM authorization for any number", () => {
    expect(
      PROMPT.match(/brandAssertions[\s\S]*?verbatim/i),
      "SYSTEM_PROMPT must require any specific number present VERBATIM in brandAssertions (DryRun-2 Rule C)",
    ).not.toBeNull();
  });
  it("prescribes hedge wording when the operator hasn't authorized a number", () => {
    expect(
      PROMPT.match(/varies by site complexity/i),
      "SYSTEM_PROMPT must prescribe hedge wording 'varies by site complexity' (DryRun-2 Rule C)",
    ).not.toBeNull();
    expect(
      PROMPT.match(/permitting timelines vary by jurisdiction/i),
      "SYSTEM_PROMPT must prescribe hedge wording for permit-time claims (DryRun-2 Rule C)",
    ).not.toBeNull();
  });
});

describe("DryRun-3 — Rule 16.A is a HARD CONTRACT, not advisory", () => {
  it("declares low-confidence abstention as a HARD CONTRACT", () => {
    expect(
      PROMPT.includes("LOW-CONFIDENCE ABSTENTION IS A HARD CONTRACT"),
      "SYSTEM_PROMPT must declare 'LOW-CONFIDENCE ABSTENTION IS A HARD CONTRACT' (DryRun-3 brief)",
    ).toBe(true);
  });
  it("uses MUST language, not 'should consider' or 'try to'", () => {
    expect(
      PROMPT.includes("MUST return an empty recommendations array"),
      "SYSTEM_PROMPT must contain 'MUST return an empty recommendations array' (DryRun-3 brief)",
    ).toBe(true);
  });
  it("explicitly overrides aiSearchSignal.topSearchQueries", () => {
    expect(
      PROMPT.includes("even if aiSearchSignal.topSearchQueries") ||
        PROMPT.includes("even if\n    aiSearchSignal.topSearchQueries") ||
        /even if[\s\S]{0,40}aiSearchSignal\.topSearchQueries/.test(PROMPT),
      "SYSTEM_PROMPT must say '...even if aiSearchSignal.topSearchQueries...' are non-empty (DryRun-3 brief)",
    ).toBe(true);
  });
  it("explicitly overrides competitorPageBlueprints", () => {
    expect(
      /even if[\s\S]{0,160}competitorPageBlueprints/.test(PROMPT),
      "SYSTEM_PROMPT must say '...even if ... competitorPageBlueprints...' are non-empty (DryRun-3 brief)",
    ).toBe(true);
  });
  it("explicitly overrides ownedPageCandidates and competitorAngles", () => {
    expect(
      PROMPT.includes("ownedPageCandidates"),
      "SYSTEM_PROMPT must include ownedPageCandidates in the override list (DryRun-3 brief)",
    ).toBe(true);
    expect(
      PROMPT.includes("competitorAngles"),
      "SYSTEM_PROMPT must include competitorAngles in the override list (DryRun-3 brief)",
    ).toBe(true);
  });
  it("declares the low-confidence + no-brandAssertions hard contract by name", () => {
    expect(
      /confidence is low[\s\S]{0,60}brandAssertions is empty/i.test(PROMPT) ||
        /resolution\.confidence === "low"[\s\S]{0,60}brandAssertions/.test(PROMPT) ||
        /confidence === "low"[\s\S]{0,80}brandAssertions/.test(PROMPT),
      "SYSTEM_PROMPT must conjoin 'confidence is low' with 'brandAssertions is empty' (DryRun-3 brief)",
    ).toBe(true);
  });
  it("retains the trigger list with operator-curated brandAssertions language", () => {
    expect(
      PROMPT.includes("operator-curated"),
      "SYSTEM_PROMPT trigger list must qualify brandAssertions as 'operator-curated' (DryRun-3 brief)",
    ).toBe(true);
  });
  it("declares 'safe-but-generic edits' explicitly as a failure mode", () => {
    expect(
      PROMPT.includes("safe-but-generic edits is a failure") ||
        PROMPT.includes("safe-but-generic edits") ||
        /safe-but-generic[\s\S]{0,30}failure/.test(PROMPT),
      "SYSTEM_PROMPT must call out 'safe-but-generic edits is a failure' (DryRun-3 brief)",
    ).toBe(true);
  });
});

describe("DryRun-3 — Rule 16.A carries a concrete BAD/GOOD example", () => {
  it("includes a BAD example showing low-confidence packet generating edits", () => {
    expect(
      PROMPT.includes("BAD"),
      "SYSTEM_PROMPT must label a BAD example (DryRun-3 brief)",
    ).toBe(true);
    expect(
      /BAD[\s\S]{0,800}low[\s\S]{0,400}brandAssertions = \[\]/.test(PROMPT),
      "SYSTEM_PROMPT BAD example must show a low-confidence packet with empty brandAssertions (DryRun-3 brief)",
    ).toBe(true);
  });
  it("includes a multi-prompt BAD example (DryRun-3.1 fix for Los Altos shape)", () => {
    expect(
      /affectedPrompts\.length = 3/.test(PROMPT),
      "SYSTEM_PROMPT must include a multi-prompt BAD example (affectedPrompts.length = 3) (DryRun-3.1 brief)",
    ).toBe(true);
    expect(
      PROMPT.includes("Multiple prompts is NOT a") ||
        /multiple prompts is NOT a free pass/i.test(PROMPT),
      "SYSTEM_PROMPT must call out 'multiple prompts is NOT a free pass' (DryRun-3.1 brief)",
    ).toBe(true);
  });
  it("declares the rule applies REGARDLESS of affectedPrompts.length", () => {
    expect(
      /REGARDLESS of how many affected[\s\S]{0,40}prompts/i.test(PROMPT) ||
        /regardless of[\s\S]{0,30}affectedPrompts\.length/i.test(PROMPT),
      "SYSTEM_PROMPT must say 'REGARDLESS of how many affected prompts' (DryRun-3 brief)",
    ).toBe(true);
  });
  it("includes a GOOD example with the empty recommendations array", () => {
    expect(
      PROMPT.includes("GOOD"),
      "SYSTEM_PROMPT must label a GOOD example (DryRun-3 brief)",
    ).toBe(true);
    expect(
      /GOOD[\s\S]{0,400}\{\s*"recommendations":\s*\[\]\s*\}/.test(PROMPT),
      'SYSTEM_PROMPT GOOD example must show { "recommendations": [] } (DryRun-3 brief)',
    ).toBe(true);
  });
});

describe("DryRun-3.5 — single-prompt is a CAUTION, not a hard-abstain trigger", () => {
  it("HARD trigger list no longer contains a single-prompt-only abstain bullet", () => {
    const triggerBlock = getHardAbstainTriggerBlock();
    const oldRule =
      /•\s*affectedPrompts\.length\s*===\s*1\s*AND\s*no operator-curated\s*\n?\s*brandAssertions/;
    expect(
      oldRule.test(triggerBlock),
      "Hard-abstain trigger block must NOT contain the over-broad LiveRegen-1 " +
        "single-prompt-only wording. Single-prompt is a CAUTION below the " +
        "trigger list, not an automatic abstain. (DryRun-3.5 brief)\n\n" +
        "Trigger block was:\n" +
        triggerBlock,
    ).toBe(false);
  });
  it("HARD trigger list keeps low-confidence + brand-empty as the primary abstain", () => {
    const triggerBlock = getHardAbstainTriggerBlock();
    expect(
      /resolution\.confidence === "low"[\s\S]{0,80}brandAssertions/.test(triggerBlock) ||
        /confidence === "low"[\s\S]{0,120}brandAssertions/.test(triggerBlock),
      "Hard-abstain trigger block must keep low-confidence + brand-empty (DryRun-3.5 brief)",
    ).toBe(true);
  });
  it("HARD trigger list keeps the all-three-empty signal trigger", () => {
    const triggerBlock = getHardAbstainTriggerBlock();
    expect(
      /competitorPageBlueprints[\s\S]*?aiSearchSignal\.topSearchQueries[\s\S]*?brandAssertions[\s\S]*?(empty|ALL empty)/i.test(
        triggerBlock,
      ),
      "Hard-abstain trigger block must keep the 'no aggregate signal at all' trigger (DryRun-3.5 brief)",
    ).toBe(true);
  });
});

describe("DryRun-3.5 — SINGLE-PROMPT CAUTION block teaches medium/high single-prompt is OK", () => {
  it("declares the SINGLE-PROMPT CAUTION block by name", () => {
    expect(
      /SINGLE-PROMPT CAUTION/i.test(PROMPT),
      "SYSTEM_PROMPT must declare a 'SINGLE-PROMPT CAUTION' block (DryRun-3.5 brief)",
    ).toBe(true);
    expect(
      /NOT a hard abstain/i.test(PROMPT),
      "SYSTEM_PROMPT must call out 'NOT a hard abstain' adjacent to the CAUTION block (DryRun-3.5 brief)",
    ).toBe(true);
  });
  it("permits generation on single-prompt + medium/high confidence with strong aggregates", () => {
    expect(
      /affectedPrompts\.length\s*===\s*1[\s\S]{0,120}confidence is "(medium|medium" or "high)"[\s\S]{0,120}DO generate/i.test(
        PROMPT,
      ) || /DO generate IF/.test(PROMPT),
      "SYSTEM_PROMPT must say 'DO generate IF…' for single-prompt medium/high packets (DryRun-3.5 brief)",
    ).toBe(true);
  });
  it("requires every emitted edit to be grounded in topSearchQueries or blueprints", () => {
    expect(
      /grounded in[\s\S]{0,80}topSearchQueries[\s\S]{0,80}competitorPageBlueprints/i.test(PROMPT) ||
        /every emitted edit is[\s\S]{0,200}aiSearchSignal\.topSearchQueries/i.test(PROMPT),
      "SYSTEM_PROMPT must condition single-prompt generation on grounding (DryRun-3.5 brief)",
    ).toBe(true);
  });
  it("includes GOOD #2 worked example for medium-conf single-prompt", () => {
    expect(
      PROMPT.includes("GOOD #2"),
      "SYSTEM_PROMPT must label a 'GOOD #2' example (DryRun-3.5 brief)",
    ).toBe(true);
    expect(
      /GOOD #2[\s\S]{0,400}confidence = "medium"[\s\S]{0,200}affectedPrompts\.length = 1[\s\S]{0,300}\["?recommendations"?:\s*\[/.test(
        PROMPT,
      ) ||
        /GOOD #2[\s\S]{0,500}affectedPrompts\.length = 1[\s\S]{0,400}grounded edits/.test(PROMPT),
      "GOOD #2 example must show medium confidence AND single prompt AND non-empty recommendations (DryRun-3.5 brief)",
    ).toBe(true);
  });
});
