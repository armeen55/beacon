/**
 * Sprint 7 Phase 7.5b Commit 5 (2026-04-25) — architectural invariant.
 * Sprint 7 Phase 7.5d/3 (2026-04-25) — extended to scripts/** + adapters/poll.
 *
 * Every read of a Tier A method (tables that carry a `tenant_id` column)
 * from any `src/app/(shell)/**` route OR `scripts/**` CLI MUST go through
 * `getRepository().forTenant(tenantId).getX()`. The unscoped form
 * `getRepository().getX()` is forbidden across both surfaces.
 *
 * Rationale: a missed `.forTenant(...)` is a silent unscoped read — it
 * returns rows from every tenant when there's more than one. The runtime
 * type segregation (TenantRepository as a separate interface) is deferred
 * until after every call site is converted; until then, this static scan
 * is the leak detector.
 *
 * Coverage:
 *   - Every TS / TSX file under `src/app/(shell)/**` (Phase 7.5b/5).
 *   - Every TS file under `scripts/**` (Phase 7.5d/3).
 *
 * 2026-06-15 PIVOT: the in-house native AEO polling engine
 * (`src/adapters/perplexity/poll.ts`, `src/adapters/openai/poll.ts`,
 * `src/domains/observations/run-poll.ts`, and the `scripts/poll-*.ts` CLIs)
 * was deleted — Profound is now the sole AEO source. The EXTRA_CLI_LIB_FILES
 * list below kept those two library entrypoints in scope; with the files gone
 * its `existsSync` filter drops them and the list is now empty. The shell +
 * scripts surfaces remain fully covered.
 *
 * The 15 Tier A method names are listed below; if a new Tier A method is
 * added (e.g., a future schema migration adds `tenant_id` to a previously
 * Tier C table), append it here.
 *
 * Out of scope (NOT scanned by this test, by design):
 *   - Module-level `const repo = getRepository();` patterns in
 *     `src/domains/**` stores — Phase 7.5c lifted those individually.
 *   - `src/lib/seed-data.server.ts` — deferred per directive (overlaps
 *     with Phase 7.8 .data partitioning).
 *   - `src/lib/data-adapters/profound-adapter.ts` — legacy import pipeline,
 *     documented partial fix.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const SHELL_ROOT = resolve(__dirname, "../../src/app/(shell)");
const SCRIPTS_ROOT = resolve(__dirname, "../../scripts");
const REPO_ROOT = resolve(__dirname, "../..");

// CLI-like library files outside `scripts/` that the Phase 7.5d directive
// listed for coverage. The two native-poll entrypoints that lived here
// (`adapters/perplexity/poll.ts`, `domains/observations/run-poll.ts`) were
// deleted in the 2026-06-15 AEO-engine pivot; the `existsSync` filter keeps
// this list honest (currently empty) and ready for any future CLI-lib file.
const EXTRA_CLI_LIB_FILES: string[] = (
  [] as string[]
).filter((p) => existsSync(p));

// 15 Tier A methods — must be filtered by tenant at the read boundary.
// Source: src/lib/persistence/repositories/types.ts → TenantRepository.
const TIER_A_METHODS = [
  "getPages",
  "getPageSnapshots",
  "getPageElementInventory",
  "getRecommendedEdits",
  "getRecommendationResponses",
  "getChangelogEntries",
  "getScanFindings",
  "getPendingScanFindings",
  "getGuardrailAlerts",
  "getObservationRuns",
  "getResults",
  "getImportRuns",
  "getDailyMetricSnapshots",
  "getPromptAnswerObservations",
  "getUrlChangeOutcomes",
] as const;

function* walkFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const s = statSync(path);
    if (s.isDirectory()) yield* walkFiles(path);
    else if (
      (entry.endsWith(".ts") || entry.endsWith(".tsx")) &&
      !entry.endsWith(".test.ts") &&
      !entry.endsWith(".test.tsx")
    ) {
      yield path;
    }
  }
}

function scanForUnscopedTierA(
  files: string[],
  method: string,
  pathLabelRoot: string,
  pathLabel: string,
): { file: string; line: number; text: string }[] {
  const violations: { file: string; line: number; text: string }[] = [];
  const re = new RegExp(`getRepository\\(\\)\\.${method}\\(`);
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    const lines = src.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) {
        violations.push({
          file: file.replace(pathLabelRoot, pathLabel),
          line: i + 1,
          text: lines[i].trim().slice(0, 120),
        });
      }
    }
  }
  return violations;
}

describe("Sprint 7 Phase 7.5b Commit 5 — no unscoped Tier A reads in shell", () => {
  const shellFiles = [...walkFiles(SHELL_ROOT)];

  it("collected at least 20 shell files (sanity check that the walk works)", () => {
    expect(shellFiles.length).toBeGreaterThan(20);
  });

  for (const method of TIER_A_METHODS) {
    it(`no shell file calls unscoped getRepository().${method}(`, () => {
      const violations = scanForUnscopedTierA(shellFiles, method, SHELL_ROOT, "(shell)");
      expect(
        violations,
        `Sprint 7 Phase 7.5b Commit 5 invariant: found unscoped getRepository().${method}( calls in shell files. Each must use .forTenant(tenantId) first.\n` +
          violations
            .map((v) => `  ${v.file}:${v.line}  ${v.text}`)
            .join("\n"),
      ).toEqual([]);
    });
  }
});

describe("Sprint 7 Phase 7.5d/3 — no unscoped Tier A reads in scripts", () => {
  const scriptFiles = [...walkFiles(SCRIPTS_ROOT), ...EXTRA_CLI_LIB_FILES];

  it("collected at least 5 script-like files (sanity check that the walk works)", () => {
    expect(scriptFiles.length).toBeGreaterThan(5);
  });

  for (const method of TIER_A_METHODS) {
    it(`no script-like file calls unscoped getRepository().${method}(`, () => {
      const violations = scanForUnscopedTierA(scriptFiles, method, REPO_ROOT, ".");
      expect(
        violations,
        `Sprint 7 Phase 7.5d/3 invariant: found unscoped getRepository().${method}( calls in scripts/** or CLI lib files. Each must use .forTenant(tenantId) first.\n` +
          violations
            .map((v) => `  ${v.file}:${v.line}  ${v.text}`)
            .join("\n"),
      ).toEqual([]);
    });
  }
});
