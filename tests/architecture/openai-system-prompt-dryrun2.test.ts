/**
 * LLM-DryRun-2 (operator audit, 2026-05-05) — SYSTEM_PROMPT invariants.
 *
 * After DryRun-1 found three failure modes (UUID leaks in `why`,
 * fabricated specific timeline "12 to 18 months", and failure-to-abstain
 * on a thin packet), the SYSTEM_PROMPT in providers/openai.ts was
 * tightened with three new rules. These invariants pin the prompt
 * lexically — a future regression that removes a rule fails CI.
 *
 * Source-text invariant rather than runtime LLM check: we can't run a
 * paid OpenAI call in CI to prove the LLM honors the rule. Instead we
 * pin that the rule TEXT is present in the SYSTEM_PROMPT. The
 * complementary validator gate (specific-edit-validator.dryrun2.test.ts)
 * is the runtime safety net.
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
  // The close is the last `;` after a `\`` — we anchor on the first
  // `\n\`;` we find after the opener since the SYSTEM_PROMPT has no
  // nested template literals (every `\`` inside is content, not code).
  const close = SRC.indexOf("\n`;", open);
  expect(close).toBeGreaterThan(open);
  return SRC.slice(open + 1, close);
}

const PROMPT = getSystemPrompt();

describe("LLM-DryRun-2 — SYSTEM_PROMPT carries the no-UUID-in-why rule", () => {
  it("includes the explicit GOOD shape (snippet citation)", () => {
    expect(
      PROMPT.includes(
        "best whole home remodel builders bay area",
      ),
      "SYSTEM_PROMPT must include the GOOD example: \"the 'best whole home remodel builders bay area' prompt\" (DryRun-2 Rule B)",
    ).toBe(true);
  });

  it("includes the explicit BAD shape (raw UUID in why)", () => {
    expect(
      PROMPT.includes(
        "7ee3216b-327c-4de9-8d5d-2f4c95a6d773",
      ),
      "SYSTEM_PROMPT must include a BAD example showing a raw UUID in why so the LLM weights the structural example correctly (DryRun-2 Rule B)",
    ).toBe(true);
  });

  it("explicitly forbids UUIDs in why / expectedImpact / measurementPlan", () => {
    expect(
      PROMPT.includes("NEVER include raw prompt UUIDs"),
      "SYSTEM_PROMPT must explicitly forbid raw prompt UUIDs in operator-visible attribution copy (DryRun-2 Rule B)",
    ).toBe(true);
    expect(
      // [\s\S] is the cross-line equivalent of the /s (dotAll) flag,
      // which requires es2018+ in the tsconfig.
      PROMPT.match(/why[\s\S]*expectedImpact[\s\S]*measurementPlan/),
      "SYSTEM_PROMPT must list why, expectedImpact, AND measurementPlan as the affected fields (DryRun-2 Rule B)",
    ).not.toBeNull();
  });

  it("clarifies that evidence[].promptId is the canonical home for raw IDs", () => {
    expect(
      PROMPT.includes("evidence[].promptId"),
      "SYSTEM_PROMPT must direct the LLM to put raw IDs on evidence[].promptId (canonical), not in why text (DryRun-2 Rule B)",
    ).toBe(true);
  });
});

describe("LLM-DryRun-2 — SYSTEM_PROMPT carries the structural-abstention rule", () => {
  it("declares the abstain rule with explicit triggers", () => {
    expect(
      PROMPT.includes("STRUCTURAL ABSTENTION"),
      "SYSTEM_PROMPT must declare a STRUCTURAL ABSTENTION rule (DryRun-2 Rule D)",
    ).toBe(true);
    // The three trigger conditions the operator brief locked.
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

describe("LLM-DryRun-2 — SYSTEM_PROMPT carries the no-fabricated-numbers rule", () => {
  it("declares the no-fabricated-numbers rule with concrete forbidden examples", () => {
    expect(
      PROMPT.includes("NO FABRICATED NUMBERS"),
      "SYSTEM_PROMPT must declare a NO FABRICATED NUMBERS, TIMELINES, COSTS, GUARANTEES rule (DryRun-2 Rule C)",
    ).toBe(true);
    // Forbid the exact pattern that leaked in DryRun-1.
    expect(
      PROMPT.includes("12 to 18 months"),
      "SYSTEM_PROMPT must reference the DryRun-1 leak '12 to 18 months' as a forbidden example (DryRun-2 Rule C)",
    ).toBe(true);
    expect(
      PROMPT.match(/per\s+square\s+foot/i),
      "SYSTEM_PROMPT must forbid per-square-foot cost claims (DryRun-2 Rule C)",
    ).not.toBeNull();
    expect(
      PROMPT.match(/Specific durations|months.*weeks.*days/i),
      "SYSTEM_PROMPT must forbid specific durations (months/weeks/days) (DryRun-2 Rule C)",
    ).not.toBeNull();
  });

  it("requires brandAssertions VERBATIM authorization for any number", () => {
    expect(
      PROMPT.match(/brandAssertions[\s\S]*?verbatim/i),
      "SYSTEM_PROMPT must require that any specific number be present VERBATIM in brandAssertions (DryRun-2 Rule C)",
    ).not.toBeNull();
  });

  it("prescribes hedge wording when the operator hasn't authorized a number", () => {
    expect(
      PROMPT.match(/varies by site complexity/i),
      "SYSTEM_PROMPT must prescribe hedge wording 'varies by site complexity' as the alternative (DryRun-2 Rule C)",
    ).not.toBeNull();
    expect(
      PROMPT.match(/permitting timelines vary by jurisdiction/i),
      "SYSTEM_PROMPT must prescribe hedge wording 'permitting timelines vary by jurisdiction' as the alternative for permit-time claims (DryRun-2 Rule C)",
    ).not.toBeNull();
  });
});
