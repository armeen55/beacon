/**
 * CONSTITUTION §11 — Fixture isolation.
 *
 * Consolidated from reset-test-tenant-contract + llm-budget-test-isolation.
 * Production data is never replaced by fixtures, and test writes never
 * clobber the operator's real state:
 *   1. reset-test-tenant can NEVER touch Ritz (case-insensitive guard runs
 *      first), deletes only the 3 allowlisted tables, defaults to dry-run,
 *      refuses paused/cancelled or high-observation tenants, and never
 *      touches auth.users or calls a paid API.
 *   2. Any test that writes a GLOBAL_STORES name via writeStore(...) must be
 *      hermetically isolated (mkdtemp+chdir OR vi.mock) so it cannot clobber
 *      the operator's real .data/ (the LLM-budget-clobber incident).
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");

// ── reset-test-tenant: production-data protection ───────────────────
const SCRIPT = join(REPO_ROOT, "scripts/reset-test-tenant.ts");
const SCRIPT_SRC = readFileSync(SCRIPT, "utf8");

describe("reset-test-tenant — production data protection", () => {
  it("exports the safety helpers and only runs main() when invoked directly", () => {
    expect(existsSync(SCRIPT)).toBe(true);
    expect(SCRIPT_SRC).toMatch(/export function isProtectedSlug/);
    expect(SCRIPT_SRC).toMatch(/export const RITZ_FORBIDDEN_PATTERNS/);
    expect(SCRIPT_SRC).toMatch(/export const ALLOWED_DELETE_TABLES/);
    expect(SCRIPT_SRC).toMatch(/require\.main\s*===\s*module/);
  });

  it("can NEVER touch Ritz — guard patterns present and checked before any DB call", () => {
    expect(SCRIPT_SRC).toMatch(/\/ritz\/i/);
    expect(SCRIPT_SRC).toMatch(/\/\^tenant-ritz-\//);
    const protectedIdx = SCRIPT_SRC.indexOf("if (isProtectedSlug(slug))");
    const adminIdx = SCRIPT_SRC.indexOf("await loadAdminClient()");
    const tenantsIdx = SCRIPT_SRC.indexOf('.from("tenants")');
    expect(protectedIdx).toBeGreaterThan(-1);
    expect(protectedIdx).toBeLessThan(adminIdx);
    expect(protectedIdx).toBeLessThan(tenantsIdx);
  });

  it("deletes only the 3 allowlisted tables; never observations/snapshots/recs/entities/auth", () => {
    expect(SCRIPT_SRC).toMatch(/"tracked_prompts"/);
    expect(SCRIPT_SRC).toMatch(/"tenant_members"/);
    expect(SCRIPT_SRC).toMatch(/"tenants"/);
    for (const t of [
      "prompt_answer_observations",
      "daily_metric_snapshots",
      "changelog_entries",
      "recommended_edits",
      "tracked_entities",
    ])
      expect(
        new RegExp(`\\.from\\("${t}"\\)[\\s\\S]{0,200}\\.delete\\(`).test(SCRIPT_SRC),
        t,
      ).toBe(false);
    expect(SCRIPT_SRC).not.toMatch(/auth\.admin\./);
    expect(SCRIPT_SRC).not.toMatch(/deleteUser/);
  });

  it("defaults to dry-run + guards on status and observation count", () => {
    const stripped = SCRIPT_SRC
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    const confirmIdx = stripped.indexOf("if (!confirm)");
    const deleteIdx = stripped.indexOf(".delete()");
    expect(confirmIdx).toBeGreaterThan(-1);
    expect(confirmIdx).toBeLessThan(deleteIdx);
    expect(SCRIPT_SRC).toMatch(/DRY RUN/);
    expect(SCRIPT_SRC).toMatch(/obsCountVal\s*>\s*MAX_OBSERVATIONS_FOR_RESET/);
    expect(SCRIPT_SRC).toMatch(/RESETTABLE_STATUSES\.has\(tenant\.status\)/);
  });

  it("never imports a paid-API adapter or calls fetch / paid runners", () => {
    expect(SCRIPT_SRC).not.toMatch(/from\s+["']@\/adapters\/openai/);
    expect(SCRIPT_SRC).not.toMatch(/from\s+["']openai["']/);
    expect(SCRIPT_SRC).not.toMatch(/\bfetch\(/);
    expect(SCRIPT_SRC).not.toContain("runNativePoll");
  });
});

// ── Hermetic test isolation for global stores ───────────────────────
const GLOBAL_STORE_NAMES = [
  "llm-budget",
  "adjudicator-cache",
  "adjudicator-history",
  "llm-history-specific-edits",
] as const;

function walkTests(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry === ".next" || entry.startsWith("."))
        continue;
      walkTests(full, out);
    } else if (full.endsWith(".test.ts") || full.endsWith(".test.tsx")) {
      out.push(full);
    }
  }
  return out;
}

const TEST_FILES = [
  ...walkTests(join(REPO_ROOT, "tests")),
  ...walkTests(join(REPO_ROOT, "src")),
];

function isHermeticallyIsolated(src: string): boolean {
  const hasMkdtempChdir =
    /mkdtemp(?:Sync)?\s*\(/.test(src) && /process\.chdir\s*\(/.test(src);
  const mocksJsonStore = /vi\.mock\(["']@\/lib\/persistence\/json-store["']/.test(src);
  const mocksAdjudicatorBudget =
    /vi\.mock\(["']@\/domains\/recommendations\/adjudicator-budget["']/.test(src);
  return hasMkdtempChdir || mocksJsonStore || mocksAdjudicatorBudget;
}

function findGlobalStoreWrites(src: string): string[] {
  const hits: string[] = [];
  for (const name of GLOBAL_STORE_NAMES) {
    if (new RegExp(`writeStore\\s*\\(\\s*["']${name}["']\\s*,`).test(src)) {
      hits.push(`writeStore("${name}", …)`);
      continue;
    }
    const loopCall = /writeStore\s*\(\s*[a-zA-Z_$][\w$]*\s*,/.test(src);
    if (loopCall && new RegExp(`["']${name}["']`).test(src))
      hits.push(`writeStore(<var>, …) with "${name}"`);
  }
  return [...new Set(hits)];
}

describe("tests writing global stores must be hermetically isolated", () => {
  it(`walked a non-trivial number of test files (${TEST_FILES.length})`, () => {
    expect(TEST_FILES.length).toBeGreaterThan(50);
  });

  for (const file of TEST_FILES) {
    const src = readFileSync(file, "utf-8");
    const writes = findGlobalStoreWrites(src);
    if (writes.length === 0) continue;
    const rel = file.slice(REPO_ROOT.length + 1);
    it(`${rel} is hermetically isolated (${writes.length} global-store write(s))`, () => {
      expect(
        isHermeticallyIsolated(src),
        `${rel} writes a global store (${writes.join(", ")}) without mkdtemp+chdir ` +
          `or vi.mock — it would clobber the operator's real .data/.`,
      ).toBe(true);
    });
  }
});
