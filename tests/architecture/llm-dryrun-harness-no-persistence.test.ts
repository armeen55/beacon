/**
 * Architecture invariant — the LLM specific-edit dry-run harness MUST
 * stay dry-run-only.
 *
 * Operator brief (LLM-DryRun-1, re-affirmed for LLM-DryRun-2,
 * 2026-05-05):
 *   "Calls openaiProvider.generate() ONLY. Never runProviderAndPersist.
 *    Never writeStore. Never syncRecommendedEdits. Never mutates the
 *    queue. Never touches Supabase outside the read path the queue
 *    loader already uses."
 *
 * This invariant pins the harness source against a blocklist of
 * persistence APIs. If a future edit accidentally imports one of
 * these, the test fails loudly — long before a paid OpenAI run can
 * leak generated copy into the live queue.
 *
 * Why a source-text test (not a runtime test): the harness is an
 * interactive script that requires OPENAI_API_KEY + a Supabase read
 * session. We can't safely run it in CI. A static import audit is the
 * right gate for "must not depend on these write paths" — it runs
 * deterministically, fails fast, and pins the contract regardless of
 * environment.
 *
 * The blocklist is the union of every recommendation-persistence
 * export in:
 *   - src/lib/persistence/dual-write.ts
 *   - src/domains/recommendations/recommended-edits-persistence.ts
 * that touches the recommended-edits / recommendation-responses
 * tables. Read-only helpers (`readRecommendedEditsLocal`,
 * `mapSpecificEditToRow`, types) are OUT of scope — the harness may
 * legitimately read or shape rows for the report.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");
const HARNESS_PATH = join(REPO_ROOT, "scripts/llm-specific-edit-dryrun.ts");
const HARNESS_SRC = readFileSync(HARNESS_PATH, "utf-8");

/**
 * Strip block + line comments before identifier checks so the
 * docstring's *mentions* of forbidden APIs (which are intentional —
 * they document the contract) don't trip the invariant.
 */
function stripComments(src: string): string {
  // Remove block comments first, then line comments.
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const HARNESS_CODE = stripComments(HARNESS_SRC);

/**
 * Persistence APIs the harness MUST NOT import or call. Pinned exactly
 * as exported by the source modules.
 */
const FORBIDDEN_IDENTIFIERS = [
  // From src/domains/recommendations/recommended-edits-persistence.ts
  "runProviderAndPersist",
  "persistRecommendedEditsLocal",
  "markRecommendedEditsAccepted",
  "markRecommendedEditsAsShipped",
  // From src/lib/persistence/dual-write.ts
  "syncRecommendedEdits",
  "syncRecommendationResponses",
  "deleteRecommendationResponseByRecId",
  "dualWriteUpsert",
  "dualWriteUpsertScoped",
  "dualWriteTruncate",
] as const;

describe("Architecture — LLM dry-run harness is persistence-free", () => {
  it("imports openaiProvider.generate (the dry-run-only path)", () => {
    expect(
      HARNESS_CODE.includes("openaiProvider"),
      "Harness must import openaiProvider — that's the only sanctioned path",
    ).toBe(true);
    // Cheap check that we're calling .generate, not .runProviderAndPersist
    // (the latter doesn't exist on the provider, but be explicit).
    expect(
      /openaiProvider\.generate\s*\(/.test(HARNESS_CODE),
      "Harness must call openaiProvider.generate(packet) — the bundle-only API",
    ).toBe(true);
  });

  it("does NOT import or call any recommendation-persistence API", () => {
    const offenders: string[] = [];
    for (const ident of FORBIDDEN_IDENTIFIERS) {
      // Word-boundary regex — avoids catching substrings like
      // `syncRecommendedEditsXxx` accidentally.
      const re = new RegExp(`\\b${ident}\\b`);
      if (re.test(HARNESS_CODE)) offenders.push(ident);
    }
    expect(
      offenders,
      `Harness must stay dry-run-only. The following persistence APIs were ` +
        `referenced in the harness source (excluding comments): ${offenders.join(", ")}. ` +
        `Operator brief: "Never runProviderAndPersist. Never writeStore. ` +
        `Never syncRecommendedEdits. Never mutates the queue."`,
    ).toEqual([]);
  });

  it("only writes to its own structured-report path under tmp/", () => {
    // Allow exactly one writeFileSync (the structured report) and pin
    // its target path to the canonical name (or to BEACON_DRYRUN_OUTPUT
    // override). If a future edit adds another write, this fails.
    const writeMatches = HARNESS_CODE.match(/writeFileSync\s*\(/g) ?? [];
    expect(
      writeMatches.length,
      `Harness has ${writeMatches.length} writeFileSync calls; expected ` +
        `exactly 1 (the structured-report path under tmp/). New writes ` +
        `must be reviewed — the harness must not persist anywhere except ` +
        `its own report file.`,
    ).toBe(1);

    expect(
      HARNESS_CODE.includes("RESULTS_OUTPUT_PATH"),
      "Harness must funnel its single write through the named " +
        "RESULTS_OUTPUT_PATH constant so reviewers can audit it",
    ).toBe(true);

    expect(
      HARNESS_CODE.includes("llm-specific-edit-dryrun-output.json") ||
        HARNESS_CODE.includes("BEACON_DRYRUN_OUTPUT"),
      "RESULTS_OUTPUT_PATH must default to the canonical " +
        "tmp/llm-specific-edit-dryrun-output.json file (or honor the " +
        "BEACON_DRYRUN_OUTPUT env override)",
    ).toBe(true);
  });

  it("declares its dry-run posture in the docstring", () => {
    const head = HARNESS_SRC.slice(0, 2000);
    expect(
      /dry-?run-only|persists nothing|NEVER persists/i.test(head),
      "Harness docstring must declare it is dry-run-only / persists nothing",
    ).toBe(true);
    expect(
      /Never runProviderAndPersist/i.test(head),
      "Harness docstring must explicitly call out that it never calls " +
        "runProviderAndPersist",
    ).toBe(true);
  });

  it("references the no-persistence invariant test from the docstring", () => {
    expect(
      HARNESS_SRC.includes(
        "tests/architecture/llm-dryrun-harness-no-persistence.test.ts",
      ),
      "Harness docstring should reference its pinning invariant so a " +
        "future reader sees where the contract is enforced",
    ).toBe(true);
  });
});
