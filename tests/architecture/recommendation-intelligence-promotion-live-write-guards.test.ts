/**
 * Architecture invariant — Slice 4.5.D.α₁c (2026-05-20):
 * operator-only live-write guard contract.
 *
 * Scoped to the single server action allowed to call
 * `promoteEligibleCandidates({ tenantId, dryRun: false })`:
 * `src/app/(shell)/diagnostics/recommendation-triggers/actions.ts`.
 *
 * 8 source-text pins on the action file + 1 global negative scan
 * proving the action file is the ONLY file under `src/app/**`
 * pairing `promoteEligibleCandidates` + `dryRun: false`. Defense-
 * in-depth alongside `recommendation-intelligence-no-queue-write`.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const ACTION_FILE = resolve(
  REPO_ROOT,
  "src",
  "app",
  "(shell)",
  "diagnostics",
  "recommendation-triggers",
  "actions.ts",
);
const APP_DIR = resolve(REPO_ROOT, "src", "app");

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function read(path: string): string {
  return readFileSync(path, "utf-8");
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
      continue;
    }
    if (entry.endsWith(".test.ts") || entry.endsWith(".test.tsx")) continue;
    if (!entry.endsWith(".ts") && !entry.endsWith(".tsx")) continue;
    out.push(full);
  }
  return out;
}

/** Whitespace-tolerant pair scan: `promoteEligibleCandidates(...)` arg
 *  list contains `dryRun: false`. */
const PROMOTE_DRYRUN_FALSE_PAIR = new RegExp(
  "promoteEligibleCandidates\\s*\\(" + // call site
    "[\\s\\S]*?" + // args (lazy)
    "dryRun\\s*:\\s*false",
  "u",
);

const RECOMMENDED_EDITS_WRITE = new RegExp(
  "\\.from\\(\\s*[\"']recommended_edits[\"']\\s*\\)" +
    "\\s*\\.(?:insert|upsert|update|delete)\\s*\\(",
  "u",
);

describe("recommendation-intelligence-promotion-live-write-guards", () => {
  it("action file exists at the expected path", () => {
    expect(
      existsSync(ACTION_FILE),
      `Expected operator-only live-write action at ${ACTION_FILE.replace(REPO_ROOT + "/", "")}`,
    ).toBe(true);
  });

  describe("source-text contract on actions.ts", () => {
    const active = stripComments(read(ACTION_FILE));

    it("operator gate: imports + references `isOperatorModeServer`", () => {
      expect(active).toContain("@/lib/operator-mode");
      expect(active).toContain("isOperatorModeServer");
    });

    it("env gate: imports + references `isPromotionLiveWriteEnabled`", () => {
      expect(active).toContain("@/lib/promotion-live-write");
      expect(active).toContain("isPromotionLiveWriteEnabled");
    });

    it("contains the uppercase confirmation phrase `\"PROMOTE\"`", () => {
      expect(active).toMatch(/['"]PROMOTE['"]/);
    });

    it("imports `promoteEligibleCandidates` from the α₁b writer", () => {
      expect(active).toContain(
        "@/domains/recommendation-intelligence/promotion-writer",
      );
      expect(active).toContain("promoteEligibleCandidates");
    });

    it("does NOT import `recommended-edits-persistence` directly", () => {
      expect(active).not.toContain("recommended-edits-persistence");
    });

    it("does NOT reference `runProviderAndPersist`", () => {
      expect(active).not.toContain("runProviderAndPersist");
    });

    it("does NOT contain a direct Supabase `recommended_edits` write shape", () => {
      expect(RECOMMENDED_EDITS_WRITE.test(active)).toBe(false);
    });

    it("calls `promoteEligibleCandidates` with `dryRun: false`", () => {
      expect(PROMOTE_DRYRUN_FALSE_PAIR.test(active)).toBe(true);
    });
  });

  it("actions.ts is the ONLY file under src/app/** that pairs `promoteEligibleCandidates` with `dryRun: false`", () => {
    const offenders: string[] = [];
    for (const file of walk(APP_DIR)) {
      if (file === ACTION_FILE) continue;
      const active = stripComments(read(file));
      if (PROMOTE_DRYRUN_FALSE_PAIR.test(active)) {
        offenders.push(file.replace(REPO_ROOT + "/", ""));
      }
    }
    expect(
      offenders,
      `Only the allowlisted operator-only action may call \`promoteEligibleCandidates({ ..., dryRun: false })\`. Offenders: ${offenders.join(", ")}`,
    ).toEqual([]);
  });
});
