/**
 * Architecture invariant — Slice 4.5.E.α₀ (2026-05-21):
 * LLM-Assisted Drafting Gateway contract.
 *
 * Pins the source-text + behavioral surface of
 * `src/domains/recommendation-intelligence/llm-draft-gateway.ts`
 * — the pure module that wires `openaiProvider.generate()` through
 * the existing budget + validator gates and returns a discriminated-
 * union draft result.
 *
 * 10 pinned assertions:
 *   1. File exists at the expected path.
 *   2. Imports `openaiProvider` from the OpenAI provider module.
 *   3. Imports `checkBudget` + `recordSpend` from adjudicator-budget.
 *   4. Imports `validateSpecificEdit` from the validator.
 *   5. Does NOT import `recommended-edits-persistence`.
 *   6. Does NOT reference `persistRecommendedEditsLocal` /
 *      `syncRecommendedEdits` (carries the α₁b boundary forward).
 *   7. Does NOT reference `runProviderAndPersist` (the LLM-
 *      orchestrator persistence path stays globally forbidden).
 *   8. Does NOT contain a direct Supabase `recommended_edits`
 *      write shape.
 *   9. Does NOT call `fetch(` (provider delegates network I/O).
 *   10. Source contains both literal strings `"blocked_budget"`
 *       and `"validation_failed"` (regression guard on the result
 *       discriminator surface).
 *
 * Plus 1 behavioral pin: the gateway result's `status` field has
 * the exact 4-value union — drift would trip the test.
 *
 * Defense-in-depth alongside `recommendation-intelligence-no-queue-
 * write` (which separately scans the whole intel directory for the
 * same forbidden imports + Supabase write shapes; the gateway file
 * is auto-covered by that scan set).
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const GATEWAY_FILE = resolve(
  REPO_ROOT,
  "src",
  "domains",
  "recommendation-intelligence",
  "llm-draft-gateway.ts",
);

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function read(path: string): string {
  return readFileSync(path, "utf-8");
}

const RECOMMENDED_EDITS_WRITE = new RegExp(
  "\\.from\\(\\s*[\"']recommended_edits[\"']\\s*\\)" +
    "\\s*\\.(?:insert|upsert|update|delete)\\s*\\(",
  "u",
);

describe("recommendation-intelligence-llm-draft-gateway-contract", () => {
  it("gateway file exists at the expected path", () => {
    expect(
      existsSync(GATEWAY_FILE),
      `Expected gateway at ${GATEWAY_FILE.replace(REPO_ROOT + "/", "")}`,
    ).toBe(true);
  });

  describe("source-text contract on llm-draft-gateway.ts", () => {
    const active = stripComments(read(GATEWAY_FILE));

    it("imports `openaiProvider` from the OpenAI provider module", () => {
      expect(active).toContain(
        "@/domains/recommendations/providers/openai",
      );
      expect(active).toContain("openaiProvider");
    });

    it("imports `checkBudget` + `recordSpend` from adjudicator-budget", () => {
      expect(active).toContain(
        "@/domains/recommendations/adjudicator-budget",
      );
      expect(active).toContain("checkBudget");
      expect(active).toContain("recordSpend");
    });

    it("imports `validateSpecificEdit` from the validator", () => {
      expect(active).toContain(
        "@/domains/recommendations/specific-edit-validator",
      );
      expect(active).toContain("validateSpecificEdit");
    });

    it("does NOT import `recommended-edits-persistence`", () => {
      expect(active).not.toContain("recommended-edits-persistence");
    });

    it("does NOT reference `persistRecommendedEditsLocal` or `syncRecommendedEdits`", () => {
      expect(active).not.toContain("persistRecommendedEditsLocal");
      expect(active).not.toContain("syncRecommendedEdits");
    });

    it("does NOT reference `runProviderAndPersist`", () => {
      expect(active).not.toContain("runProviderAndPersist");
    });

    it("does NOT contain a direct Supabase `recommended_edits` write shape", () => {
      expect(RECOMMENDED_EDITS_WRITE.test(active)).toBe(false);
    });

    it("does NOT call `fetch(`", () => {
      expect(active).not.toMatch(/\bfetch\(/);
    });

    it("contains both literal strings `\"blocked_budget\"` and `\"validation_failed\"`", () => {
      expect(active).toMatch(/['"]blocked_budget['"]/);
      expect(active).toMatch(/['"]validation_failed['"]/);
    });

    it("contains the literal `\"drafted\"` and `\"abstained\"` status values", () => {
      expect(active).toMatch(/['"]drafted['"]/);
      expect(active).toMatch(/['"]abstained['"]/);
    });
  });

  it("result status union is exactly the locked 4-value set (behavioral pin)", () => {
    // Source-scan for `status:` literal values in the discriminator
    // union declaration. The 4 locked values: drafted · abstained ·
    // validation_failed · blocked_budget.
    const active = stripComments(read(GATEWAY_FILE));
    const statusLiterals = new Set<string>();
    const re = /status\s*:\s*"([a-z_]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(active)) !== null) {
      statusLiterals.add(m[1]!);
    }
    expect(
      [...statusLiterals].sort(),
      `Locked LlmDraftResult status union mismatch. Found: ${[...statusLiterals].sort().join(", ")}`,
    ).toEqual(["abstained", "blocked_budget", "drafted", "validation_failed"]);
  });
});
