/**
 * Architecture invariant — LLM live-regeneration harness allowlist.
 *
 * Pinned after LLM-LiveRegen-2 + the test-isolation fix (2026-05-05).
 * The operator brief locks 13 safety properties for any "live regen
 * harness" before LR-3 ever runs. This file pins them lexically against
 * every script that matches the LR-N pattern.
 *
 * SCOPE — what counts as a "live regen harness"?
 *
 *   Filename pattern: `scripts/llm-live-regen-<digit>.ts` (no other
 *   suffix). That covers `llm-live-regen-1.ts`, `llm-live-regen-2.ts`,
 *   future `llm-live-regen-3.ts`, etc. EXCLUDED:
 *     - `llm-live-regen-2-discover.ts` (suffix `-discover.ts`) —
 *       read-only discovery script; doesn't call OpenAI; doesn't
 *       persist. Pinning it as "must use runProviderAndPersist"
 *       would be wrong. The discover scripts are a sibling tool.
 *     - Any future variant prefix (e.g. `llm-live-regen-multi.ts`)
 *       would also fall outside the digit-only pattern. If a future
 *       harness uses a different naming scheme it MUST be added to
 *       this allowlist explicitly OR justified in the docstring.
 *
 * OUT OF SCOPE BUT NOTED:
 *
 *   `scripts/build-edits-for-queue.ts` predates the LR-N audit cycle
 *   (Sprint 6A.1 Phase 14). It IS a persistence-capable script
 *   (--provider=openai --write goes through runProviderAndPersist),
 *   and it has its own --limit cap, but it does NOT carry the
 *   operator-locked safety properties (no $1 default budget, no
 *   tenant-lock literal, no low-conf-exclude pre-flight, --all flag
 *   IS broad regen). It's a developer convenience CLI, not the
 *   operator-audit live-regen path. Operator should NOT use it for
 *   live regeneration. It is intentionally OUT of this invariant.
 *
 *   `scripts/generate-specific-edits.ts` is deterministic-only (no
 *   LLM). Out of scope.
 *
 *   `scripts/llm-specific-edit-dryrun.ts` is dry-run only. Pinned by
 *   `tests/architecture/llm-dryrun-harness-no-persistence.test.ts`.
 *   Out of scope here.
 *
 * THE 13 PROPERTIES (operator brief, 2026-05-05):
 *
 *   1.  Tenant-locked to `tenant-ritz-founder` (or explicitly
 *       overridden by safe env var with mismatch abort).
 *   2.  Hard candidate-count cap.
 *   3.  Hard budget cap, default ≤ $1.
 *   4.  Uses `runProviderAndPersist` only for persistence.
 *   5.  Does not call direct Supabase write helpers.
 *   6.  Does not call `writeStore` directly for recommended edits.
 *   7.  Does not call `syncRecommendedEdits` directly.
 *   8.  Runs `validateSpecificEditBundle` or relies on
 *       `runProviderAndPersist`'s validator path.
 *   9.  Excludes low-confidence candidates by default.
 *   10. Excludes inventory-tier / weak-evidence candidates by default.
 *   11. Prints a pre-flight candidate list before calling OpenAI.
 *   12. Stops or fails loudly if budget/provider/key is missing.
 *   13. Does not include Apply-All-HIGH or broad queue regeneration
 *       behavior.
 *
 * The invariant strips block + line comments before identifier checks
 * so docstring mentions don't trip the negative invariants. (The same
 * trick the dry-run harness no-persistence test uses.)
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");
const SCRIPTS_DIR = join(REPO_ROOT, "scripts");

/**
 * Match `llm-live-regen-<digit(s)>.ts` exactly — no other suffix.
 * Examples:
 *   llm-live-regen-1.ts          ← match
 *   llm-live-regen-2.ts          ← match
 *   llm-live-regen-2-discover.ts ← NO match (extra suffix)
 *   llm-live-regen-multi.ts      ← NO match (non-digit)
 *   llm-live-regen-1-fast.ts     ← NO match (extra suffix)
 */
const LR_FILENAME_RE = /^llm-live-regen-\d+\.ts$/;

function discoverLiveRegenHarnesses(): string[] {
  return readdirSync(SCRIPTS_DIR)
    .filter((f) => LR_FILENAME_RE.test(f))
    .map((f) => join(SCRIPTS_DIR, f))
    .sort();
}

const HARNESSES = discoverLiveRegenHarnesses();

/**
 * Strip block + line comments so docstring mentions of forbidden APIs
 * (which document the contract) don't trip negative invariants.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("Architecture — LLM-LiveRegen harness allowlist", () => {
  it(`discovered at least one LR-N harness in scripts/`, () => {
    expect(
      HARNESSES.length,
      "Expected at least one `scripts/llm-live-regen-<digit>.ts` harness " +
        "to exist after LR-1 + LR-2 landed. If no permanent harness exists, " +
        "ship one before any future LR-N run; this invariant pins its " +
        "safety properties.",
    ).toBeGreaterThan(0);
  });

  it("expected harnesses are present (LR-1 + LR-2 baseline)", () => {
    const names = HARNESSES.map((p) => p.split("/").pop());
    expect(names).toContain("llm-live-regen-1.ts");
    expect(names).toContain("llm-live-regen-2.ts");
  });
});

for (const harnessPath of HARNESSES) {
  const filename = harnessPath.split("/").pop() ?? "(unknown)";
  const SRC_RAW = readFileSync(harnessPath, "utf-8");
  const SRC_CODE = stripComments(SRC_RAW);

  describe(`Architecture — ${filename} carries the 13 LR-N safety properties`, () => {
    // Property 1 — tenant-locked.
    it("1. is tenant-locked to tenant-ritz-founder (with mismatch abort)", () => {
      expect(
        /TENANT_ID\s*=\s*["']tenant-ritz-founder["']/.test(SRC_CODE) ||
          /tenant_id\s*=\s*["']tenant-ritz-founder["']/.test(SRC_CODE),
        `${filename} must declare a TENANT_ID literal bound to ` +
          `"tenant-ritz-founder" (the operator's only authorized live-regen ` +
          `tenant). If a future harness wants a different tenant via env ` +
          `override, add it to this invariant explicitly.`,
      ).toBe(true);

      expect(
        /tenant\s*mismatch/i.test(SRC_CODE) ||
          /currentTenantId.*\(.*!==/.test(SRC_CODE) ||
          /ctxTenantId\s*!==\s*TENANT_ID/.test(SRC_CODE),
        `${filename} must verify that the resolved currentTenantId() ` +
          `matches TENANT_ID and abort on mismatch (defense in depth).`,
      ).toBe(true);
    });

    // Property 2 — hard candidate-count cap.
    it("2. has a hard candidate-count cap (pinned slate, no auto-discovery)", () => {
      expect(
        /PINNED_CANDIDATES\s*[:=]/.test(SRC_CODE) ||
          /pinnedCandidates\s*[:=]/.test(SRC_CODE),
        `${filename} must declare a PINNED_CANDIDATES (or pinnedCandidates) ` +
          `array — the slate must be locked at file write time, NOT ` +
          `auto-discovered at run time. Auto-discovery is exactly how ` +
          `scope creeps to "all candidates" silently.`,
      ).toBe(true);
    });

    // Property 3 — hard budget cap, default ≤ $1.
    it("3. has a hard budget cap, default ≤ $1.00", () => {
      const match = SRC_CODE.match(/BUDGET_CAP_USD\s*=\s*([\d.]+)/);
      expect(
        match,
        `${filename} must declare a BUDGET_CAP_USD constant. The brief ` +
          `requires a hard cap with default ≤ $1.`,
      ).not.toBeNull();
      if (match) {
        const cap = parseFloat(match[1]);
        expect(
          cap,
          `${filename} BUDGET_CAP_USD = ${cap}, but the operator brief ` +
            `requires the default to be ≤ $1.00 for live regen safety.`,
        ).toBeLessThanOrEqual(1.0);
      }

      expect(
        /cumulative\s*\+/.test(SRC_CODE) || /cumulative.*BUDGET_CAP/.test(SRC_CODE),
        `${filename} must implement a cumulative pre-call budget gate ` +
          `("if cumulative + estimate > cap, abort BEFORE next call"). ` +
          `Otherwise the cap is post-hoc and a runaway loop overshoots.`,
      ).toBe(true);
    });

    // Property 4 — uses runProviderAndPersist only.
    it("4. imports + uses runProviderAndPersist for the persistence path", () => {
      expect(
        /import\s*\{[^}]*runProviderAndPersist[^}]*\}\s*from\s*["']@\/domains\/recommendations\/recommended-edits-persistence["']/.test(
          SRC_CODE,
        ),
        `${filename} must import runProviderAndPersist from ` +
          `@/domains/recommendations/recommended-edits-persistence. ` +
          `That's the ONE sanctioned persistence path.`,
      ).toBe(true);
      expect(
        /runProviderAndPersist\s*\(/.test(SRC_CODE),
        `${filename} must actually CALL runProviderAndPersist (not just ` +
          `import it).`,
      ).toBe(true);
    });

    // Property 5 — no direct Supabase write helpers.
    it("5. does NOT call direct Supabase write helpers", () => {
      const offenders: string[] = [];
      for (const fn of [
        "dualWriteUpsert",
        "dualWriteUpsertScoped",
        "dualWriteTruncate",
        "syncRecommendationResponses",
        "deleteRecommendationResponseByRecId",
      ]) {
        if (new RegExp(`\\b${fn}\\b`).test(SRC_CODE)) offenders.push(fn);
      }
      expect(
        offenders,
        `${filename} must NOT reference Supabase dual-write helpers. ` +
          `All persistence flows through runProviderAndPersist (which ` +
          `wraps the dual-write internally). Offenders: ${offenders.join(", ")}`,
      ).toEqual([]);
    });

    // Property 6 — no direct writeStore for recommended edits.
    it("6. does NOT call writeStore directly for recommended edits", () => {
      // writeStore("recommended-edits", …) and persistRecommendedEditsLocal
      // are both forbidden.
      const offenders: string[] = [];
      if (
        /writeStore\s*\(\s*["']recommended-edits["']/.test(SRC_CODE) ||
        /writeStore\s*\(\s*["']recommendation-responses["']/.test(SRC_CODE)
      ) {
        offenders.push("writeStore(<rec-store-name>, …)");
      }
      if (/\bpersistRecommendedEditsLocal\s*\(/.test(SRC_CODE)) {
        offenders.push("persistRecommendedEditsLocal(…)");
      }
      expect(
        offenders,
        `${filename} must NOT call writeStore or persistRecommendedEditsLocal ` +
          `against the rec store directly. Offenders: ${offenders.join(", ")}`,
      ).toEqual([]);
    });

    // Property 7 — no direct syncRecommendedEdits.
    it("7. does NOT call syncRecommendedEdits directly", () => {
      expect(
        /\bsyncRecommendedEdits\s*\(/.test(SRC_CODE),
        `${filename} must NOT call syncRecommendedEdits directly. ` +
          `runProviderAndPersist invokes it internally; bypassing that ` +
          `wrapper skips the validator + budget + history breadcrumbs.`,
      ).toBe(false);
    });

    // Property 8 — validator path.
    it("8. relies on runProviderAndPersist's validator path (or calls validateSpecificEditBundle)", () => {
      // runProviderAndPersist runs validateSpecificEditBundle internally.
      // Either the harness passes through it (positive marker:
      // runProviderAndPersist call), or it explicitly invokes the
      // validator. Both satisfy property 8.
      const usesPersistOrchestrator = /runProviderAndPersist\s*\(/.test(SRC_CODE);
      const callsValidatorDirectly = /validateSpecificEditBundle\s*\(/.test(SRC_CODE);
      expect(
        usesPersistOrchestrator || callsValidatorDirectly,
        `${filename} must either call runProviderAndPersist (which runs ` +
          `validateSpecificEditBundle internally) OR call ` +
          `validateSpecificEditBundle explicitly. Otherwise rejected ` +
          `edits could persist.`,
      ).toBe(true);
    });

    // Property 9 — excludes low-confidence by default.
    it("9. excludes low-confidence candidates by default (pre-flight)", () => {
      // Pre-flight check: assertion that resolves !== "low" or that
      // confidence === "medium" (or "high"). Either form satisfies the
      // operator's brief.
      expect(
        /confidence\s*!==\s*["']medium["']/.test(SRC_CODE) ||
          /confidence\s*!==\s*["']low["']/.test(SRC_CODE) ||
          /confidence\s*!==\s*["'](?:high|medium)["']/.test(SRC_CODE) ||
          /resolution\.confidence\s*!==\s*["']medium["']/.test(SRC_CODE) ||
          /["']low["'][\s\S]{0,80}ABORT/.test(SRC_CODE),
        `${filename} must include a pre-flight assertion that excludes ` +
          `low-confidence candidates. The shape may be ` +
          `\`if (c.resolution.confidence !== "medium") return ABORT\` or ` +
          `equivalent.`,
      ).toBe(true);
    });

    // Property 10 — excludes inventory-tier / weak by default.
    it("10. excludes inventory-tier / weak-evidence candidates by default", () => {
      expect(
        /tier\s*!==\s*["']observation["']/.test(SRC_CODE) ||
          /tier\s*!==\s*["']adjudicated["']/.test(SRC_CODE) ||
          /tier\s*!==\s*["'](?:observation|adjudicated)["']/.test(SRC_CODE) ||
          /["']inventory["'][\s\S]{0,80}ABORT/.test(SRC_CODE) ||
          /weak_evidence[\s\S]{0,80}(?:ABORT|excluded)/i.test(SRC_CODE),
        `${filename} must include a pre-flight assertion that excludes ` +
          `inventory-tier (or weak-evidence) candidates. The shape may be ` +
          `\`if (c.resolution.tier !== "observation") return ABORT\` or ` +
          `an explicit weak-evidence ABORT branch.`,
      ).toBe(true);
    });

    // Property 11 — prints pre-flight candidate list.
    it("11. prints a pre-flight candidate list before calling OpenAI", () => {
      expect(
        /PRE-FLIGHT/.test(SRC_CODE),
        `${filename} must print a "PRE-FLIGHT" header and the selected ` +
          `candidate list BEFORE calling openaiProvider.generate / ` +
          `runProviderAndPersist. The operator reads this output as the ` +
          `final go/no-go signal.`,
      ).toBe(true);
    });

    // Property 12 — stops/fails loudly on missing budget / provider / key.
    it("12. aborts loudly on missing OPENAI_API_KEY / provider / budget", () => {
      // API key check.
      expect(
        /OPENAI_API_KEY/.test(SRC_CODE) &&
          (/ABORT/.test(SRC_CODE) || /process\.exit\s*\(\s*1/.test(SRC_CODE) ||
            /return\s*\{[^}]*exitCode:\s*1/.test(SRC_CODE)),
        `${filename} must check for OPENAI_API_KEY and abort with a ` +
          `non-zero exit code when missing.`,
      ).toBe(true);

      // Budget pre-call abort.
      expect(
        /BUDGET_ABORT/.test(SRC_CODE) ||
          (/cumulative\s*\+\s*[A-Z_]+_USD?/.test(SRC_CODE) &&
            /BUDGET_CAP/.test(SRC_CODE)),
        `${filename} must include a budget pre-call abort branch (the ` +
          `cumulative+estimate > cap check that halts BEFORE the next ` +
          `provider call).`,
      ).toBe(true);
    });

    // Property 13 — no Apply-All-HIGH or broad regen.
    it("13. does NOT include Apply-All-HIGH or broad-regen behavior", () => {
      const offenders: string[] = [];

      // Apply-All-HIGH ban.
      if (/\bacceptAllHighConfidence\b/.test(SRC_CODE))
        offenders.push("acceptAllHighConfidence");
      if (/\bapplyAllHighConfidence\b/i.test(SRC_CODE))
        offenders.push("applyAllHighConfidence");

      // Broad-regen ban: no `--all` CLI flag, no looping over the
      // entire queue without a cap.
      if (/--all\b/.test(SRC_CODE)) offenders.push("--all CLI flag");
      if (/\bfor\s*\(.*of\s+candidates\s*\)/.test(SRC_CODE)) {
        // candidates loop. OK only if it's also gated by a count cap.
        // The PINNED_CANDIDATES + manual loop pattern is fine because
        // that's a fixed-length pinned slate. A raw `for (const c of
        // candidates)` is broad-regen-shaped — flag.
        offenders.push("for (const c of candidates) — broad regen shape");
      }
      if (/regenerateAllRecommendations/i.test(SRC_CODE))
        offenders.push("regenerateAllRecommendations");
      if (/runProviderAndPersist[\s\S]{0,200}\.queue\.map\b/.test(SRC_CODE))
        offenders.push("runProviderAndPersist over .queue.map (broad regen shape)");

      expect(
        offenders,
        `${filename} must NOT include Apply-All-HIGH or broad-queue-regen ` +
          `behavior. The harness must iterate over its PINNED_CANDIDATES ` +
          `array only — never the live queue. Offenders: ${offenders.join(", ")}`,
      ).toEqual([]);
    });
  });
}
