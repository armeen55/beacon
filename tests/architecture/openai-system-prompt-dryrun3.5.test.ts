/**
 * LLM-DryRun-3.5 (operator audit, 2026-05-05) — single-prompt rule scope fix.
 *
 * Background: LLM-LiveRegen-1 surfaced that Rule 16.A trigger 1 was
 * over-broad. Bay Area teardown packet (medium confidence, 1 affected
 * prompt, brand-empty) abstained because the OLD rule said
 * `affectedPrompts.length === 1 AND brandAssertions empty → abstain`
 * regardless of confidence. DryRun-2 generated 3 ship-as-is edits on
 * the same packet — we lost a useful single-prompt MEDIUM-confidence
 * pattern.
 *
 * Operator decision (2026-05-05): drop the single-prompt-only hard
 * trigger. Keep:
 *   1. confidence === "low" AND brandAssertions empty (regardless
 *      of prompt count) → hard abstain
 *   2. competitorPageBlueprints + aiSearchSignal.topSearchQueries +
 *      brandAssertions all empty → hard abstain
 *   3. (NEW) Single-prompt is CAUTION: at medium/high confidence with
 *      strong aggregate signals, GENERATE while grounding every edit
 *      in topSearchQueries or competitorPageBlueprints. At LOW
 *      confidence, single-prompt still abstains (covered by trigger 1).
 *
 * This file pins:
 *   • The SINGLE-PROMPT CAUTION block exists.
 *   • A GOOD #2 example for medium-conf single-prompt is present
 *     (so the model has a positive worked example, not just BADs).
 *   • The old "single-prompt + brand-empty alone → abstain" wording
 *     is GONE from the hard-abstain trigger list.
 *   • DryRun-2 + DryRun-3 invariants still pass (we don't regress
 *     low-confidence abstention).
 *
 * NEGATIVE invariant: the HARD-ABSTAIN trigger list MUST NOT contain
 * a bullet that only requires `affectedPrompts.length === 1 AND
 * brandAssertions empty`. That would re-introduce the LiveRegen-1
 * over-broad abstention.
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
 * top of Rule 16.A). The CAUTION block lives below it and is
 * inspected separately.
 *
 * The literal phrase "Return an empty recommendations array BEFORE
 * writing any edits when ANY of these" wraps across a line break in
 * the source template literal (the prompt is indented so "Return an
 * empty recommendations\n    array BEFORE writing any edits..." is
 * the actual text). Use a regex with `[\s\S]` to span the break.
 */
function getHardAbstainTriggerBlock(): string {
  const startMatch = PROMPT.match(
    /Return an empty recommendations[\s\S]{0,40}array BEFORE writing any edits when ANY of these/,
  );
  expect(startMatch).not.toBeNull();
  const start = startMatch ? startMatch.index ?? -1 : -1;
  expect(start).toBeGreaterThan(0);
  // End at the closing of the bullet list — find the first blank line
  // followed by "**" (the next bold-header section).
  const tail = PROMPT.slice(start);
  const endRel = tail.search(/\n\s*\n\s*\*\*/);
  expect(endRel).toBeGreaterThan(0);
  return tail.slice(0, endRel);
}

describe("LLM-DryRun-3.5 — single-prompt is a CAUTION, not a hard-abstain trigger", () => {
  it("HARD trigger list no longer contains a single-prompt-only abstain bullet", () => {
    // The OLD wording was:
    //   • affectedPrompts.length === 1 AND no operator-curated
    //     brandAssertions (brandAssertions is empty).
    // This MUST NOT appear in the hard-abstain trigger block any more.
    // The CAUTION block below mentions the condition but as
    // "DO generate IF…" guidance, not as an abstain trigger.
    const triggerBlock = getHardAbstainTriggerBlock();

    // The single-prompt-only-as-abstain wording would be a bullet that
    // mentions `affectedPrompts.length === 1` followed within the
    // SAME bullet (no intervening blank/bullet boundary) by
    // `brandAssertions` and the abstain conjunction. Pin a regex
    // that would catch the old wording explicitly.
    const oldRule =
      /•\s*affectedPrompts\.length\s*===\s*1\s*AND\s*no operator-curated\s*\n?\s*brandAssertions/;
    expect(
      oldRule.test(triggerBlock),
      "Hard-abstain trigger block must NOT contain " +
        '"• affectedPrompts.length === 1 AND no operator-curated brandAssertions" — ' +
        "that was the over-broad LiveRegen-1 wording. Single-prompt is a " +
        "CAUTION below the trigger list, not an automatic abstain. " +
        "(DryRun-3.5 brief)\n\nTrigger block was:\n" +
        triggerBlock,
    ).toBe(false);
  });

  it("HARD trigger list keeps low-confidence + brand-empty as the primary abstain", () => {
    const triggerBlock = getHardAbstainTriggerBlock();
    expect(
      /resolution\.confidence === "low"[\s\S]{0,80}brandAssertions/.test(
        triggerBlock,
      ) ||
        /confidence === "low"[\s\S]{0,120}brandAssertions/.test(triggerBlock),
      "Hard-abstain trigger block must keep low-confidence + brand-empty " +
        "as a hard abstain trigger (this is the rule that fires correctly " +
        "on Los Altos / Menlo Park). DryRun-3.5 fixes single-prompt scope, " +
        "NOT low-confidence scope.",
    ).toBe(true);
  });

  it("HARD trigger list keeps the all-three-empty signal trigger", () => {
    const triggerBlock = getHardAbstainTriggerBlock();
    expect(
      /competitorPageBlueprints[\s\S]*?aiSearchSignal\.topSearchQueries[\s\S]*?brandAssertions[\s\S]*?(empty|ALL empty)/i.test(
        triggerBlock,
      ),
      "Hard-abstain trigger block must keep the 'no aggregate signal at " +
        "all' trigger. This catches packets with literally no evidence to " +
        "ground anything on.",
    ).toBe(true);
  });
});

describe("LLM-DryRun-3.5 — SINGLE-PROMPT CAUTION block teaches medium/high single-prompt is OK", () => {
  it("declares the SINGLE-PROMPT CAUTION block by name", () => {
    expect(
      /SINGLE-PROMPT CAUTION/i.test(PROMPT),
      "SYSTEM_PROMPT must declare a 'SINGLE-PROMPT CAUTION' block so the " +
        "model can pattern-match the new rule scope (DryRun-3.5 brief)",
    ).toBe(true);
    expect(
      /NOT a hard abstain/i.test(PROMPT),
      "SYSTEM_PROMPT must call out 'NOT a hard abstain' adjacent to the " +
        "SINGLE-PROMPT CAUTION block so the model never re-interprets the " +
        "caution as an abstain trigger",
    ).toBe(true);
  });

  it("permits generation on single-prompt + medium/high confidence with strong aggregates", () => {
    expect(
      /affectedPrompts\.length\s*===\s*1[\s\S]{0,120}confidence is "(medium|medium" or "high)"[\s\S]{0,120}DO generate/i.test(
        PROMPT,
      ) || /DO generate IF/.test(PROMPT),
      "SYSTEM_PROMPT must explicitly say 'DO generate IF…' for single-prompt " +
        "+ medium/high confidence packets so the model has affirmative " +
        "permission to act. The DryRun-3 hard-contract wording alone makes " +
        "the model overly cautious in its absence.",
    ).toBe(true);
  });

  it("requires every emitted edit to be grounded in topSearchQueries or blueprints", () => {
    expect(
      /grounded in[\s\S]{0,80}topSearchQueries[\s\S]{0,80}competitorPageBlueprints/i.test(
        PROMPT,
      ) ||
        /every emitted edit is[\s\S]{0,200}aiSearchSignal\.topSearchQueries/i.test(
          PROMPT,
        ),
      "SYSTEM_PROMPT must condition single-prompt generation on grounding " +
        "in topSearchQueries OR competitorPageBlueprints — keeps the LLM " +
        "from ad-libbing on intuition when there's only 1 prompt to lean on.",
    ).toBe(true);
  });

  it("includes GOOD #2 worked example for medium-conf single-prompt", () => {
    expect(
      PROMPT.includes("GOOD #2"),
      "SYSTEM_PROMPT must label a 'GOOD #2' example so the model sees a " +
        "positive worked example for medium-conf single-prompt generation",
    ).toBe(true);
    expect(
      /GOOD #2[\s\S]{0,400}confidence = "medium"[\s\S]{0,200}affectedPrompts\.length = 1[\s\S]{0,300}\["?recommendations"?:\s*\[/.test(
        PROMPT,
      ) ||
        /GOOD #2[\s\S]{0,500}affectedPrompts\.length = 1[\s\S]{0,400}grounded edits/.test(
          PROMPT,
        ),
      "GOOD #2 example must show resolution.confidence = 'medium' AND " +
        "affectedPrompts.length = 1 AND a non-empty recommendations array — " +
        "the exact shape Bay Area teardown should generate on under the " +
        "fixed rule.",
    ).toBe(true);
  });
});

describe("LLM-DryRun-3.5 — DryRun-2 + DryRun-3 invariants still hold", () => {
  it("STRUCTURAL ABSTENTION header retained", () => {
    expect(PROMPT.includes("STRUCTURAL ABSTENTION")).toBe(true);
  });
  it("HARD CONTRACT wording for low-confidence retained", () => {
    expect(PROMPT.includes("LOW-CONFIDENCE ABSTENTION IS A HARD CONTRACT")).toBe(
      true,
    );
  });
  it("MUST + even-if override wording retained", () => {
    expect(PROMPT.includes("MUST return an empty recommendations array")).toBe(
      true,
    );
    expect(/even if[\s\S]{0,40}aiSearchSignal\.topSearchQueries/.test(PROMPT)).toBe(
      true,
    );
  });
  it("multi-prompt BAD example (low conf, 3 prompts) retained — Los Altos shape", () => {
    expect(/affectedPrompts\.length = 3/.test(PROMPT)).toBe(true);
  });
  it("'CORRECT answer for thin packets' framing retained", () => {
    expect(PROMPT.includes("CORRECT answer for thin packets")).toBe(true);
  });
});
