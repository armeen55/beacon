/**
 * Architecture invariant — no `tenant_id: ""` empty-string literals in
 * production source files outside the documented Stage D2/D3 backlog.
 *
 * Stage D1 (2026-05-09) removed the 11 D-a sites where the literal was
 * already coerced by `tenantizeRows` at sync time. The ratchet:
 *
 *   - Files NOT on `EXPECTED_REMAINING_FILES` MUST have zero
 *     `tenant_id: ""` (or `tenant_id: ''`) literals in non-comment code.
 *   - Files ON `EXPECTED_REMAINING_FILES` MUST currently have at least
 *     one such literal. This is a forward-only ratchet: when Stage D2
 *     (factory parameters) or Stage D3 (entry-point thread) removes
 *     all literals from a listed file, the entry must also be removed
 *     from `EXPECTED_REMAINING_FILES` — the test fails loud, prompting
 *     the cleanup.
 *
 * Excluded by design:
 *   - `*.test.ts` / `*.test.tsx` (tests legitimately use synthetic
 *     `tenant_id: ""` for fixture rows).
 *   - `tests/` and `scripts/` directories (different bundle scope).
 *   - JSDoc and line comments (stripped before scanning).
 *
 * If you intentionally introduce a new `tenant_id: ""` literal in
 * production source, that's a regression. Either resolve `tenantId`
 * in scope and stamp it directly, OR add the file to
 * `EXPECTED_REMAINING_FILES` with a comment naming the bundle that
 * will repair it.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, relative } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const SRC_DIR = join(REPO_ROOT, "src");

/**
 * Files known to still contain `tenant_id: ""` literals after Stage D1
 * (2026-05-09). Each entry is a repo-relative path. The list shrinks
 * as Stage D2 (factory signatures) and Stage D3 (entry-point threading)
 * land. NEVER add new entries — every new file must instead remove
 * the literal at construction time.
 *
 * Each entry is annotated with its target bundle:
 *   - D2 = factory function should take `tenantId` parameter
 *   - D3 = server action / entry point should resolve `currentTenantId`
 *          and thread it
 */
const EXPECTED_REMAINING_FILES: ReadonlyArray<{
  path: string;
  bundle: "D-e";
  reason: string;
}> = [
  // Stage D2 (2026-05-09) closed all 14 D-b factory paths. Stage D3
  // (2026-05-09, commit 6393845) closed the 4 D-c server-action paths.
  // Stage D1 (2026-05-09, commit b8f238f) closed the D-a coercion-drop
  // paths. Stage D is fully closed for D-a / D-b / D-c.
  //
  // The single remaining allow-list entry is D-e (defensive helper that
  // is correct as-is — production data path depends on the empty-string
  // input shape).
  {
    path: "src/domains/observations/observation-runs-merge.ts",
    bundle: "D-e",
    reason:
      "Empty tenant_id is intentional input to filterByTenantWithLegacyFounderFallback in src/lib/tenant-data.ts (line 104). The fallback resolver interprets untagged legacy scan-runs.json rows as belonging to the founder tenant. Stamping a real tenantId here would defeat the resolver — touch only as part of a deliberate legacy-untagged cleanup bundle.",
  },
];

const EXPECTED_PATHS: ReadonlySet<string> = new Set(
  EXPECTED_REMAINING_FILES.map((e) => e.path),
);

const LITERAL_RE = /tenant_id:\s*(?:""|'')/;

/** Strip TS comments. Line comments first, then block comments — same
 *  pattern as customer-nav-exposure.test.ts. */
function stripComments(src: string): string {
  return src
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

function listSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      listSourceFiles(full, out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (entry.name.endsWith(".test.ts")) continue;
    if (entry.name.endsWith(".test.tsx")) continue;
    if (entry.name.endsWith(".spec.ts")) continue;
    if (entry.name.endsWith(".spec.tsx")) continue;
    if (!/\.(ts|tsx)$/.test(entry.name)) continue;
    out.push(full);
  }
  return out;
}

function fileContainsLiteral(absPath: string): boolean {
  const stripped = stripComments(readFileSync(absPath, "utf-8"));
  return LITERAL_RE.test(stripped);
}

const allFiles = listSourceFiles(SRC_DIR);
const filesWithLiteral = allFiles
  .filter(fileContainsLiteral)
  .map((p) => relative(REPO_ROOT, p))
  .sort();

describe("Architecture — no tenant_id empty-string literals in production source", () => {
  it("the scan walks at least 200 source files (sanity guard)", () => {
    expect(allFiles.length).toBeGreaterThanOrEqual(200);
  });

  it("every file with a `tenant_id: \"\"` literal is on EXPECTED_REMAINING_FILES", () => {
    const unexpected = filesWithLiteral.filter((p) => !EXPECTED_PATHS.has(p));
    expect(
      unexpected,
      `New \`tenant_id: ""\` literal(s) detected in production source. ` +
        `Either resolve tenantId at the call site and stamp it directly, ` +
        `or (if this is genuinely a new D2/D3 case) add the path to ` +
        `EXPECTED_REMAINING_FILES with a comment naming the repair bundle.\n` +
        `Unexpected file(s):\n  ${unexpected.join("\n  ")}`,
    ).toEqual([]);
  });

  it("every EXPECTED_REMAINING_FILES entry still has at least one literal (ratchet)", () => {
    // When Stage D2/D3 removes the last literal from a listed file, this
    // assertion fires — prompts the cleanup of the now-stale allow-list
    // entry. The list is forward-only; entries only ever get removed.
    const stale = EXPECTED_REMAINING_FILES.filter(
      (e) => !filesWithLiteral.includes(e.path),
    );
    expect(
      stale,
      `EXPECTED_REMAINING_FILES contains paths that no longer have any ` +
        `\`tenant_id: ""\` literal. Remove these entries from the list:\n` +
        `  ${stale.map((e) => `${e.path} (bundle ${e.bundle})`).join("\n  ")}`,
    ).toEqual([]);
  });

  it("the documented Stage D1 + D2 + D3 cleaned sites have ZERO literals (regression guard)", () => {
    // Files cleaned by Stage D1 (commit b8f238f), D2 (this commit),
    // and D3 (commit 6393845). If a future PR re-introduces a literal
    // in any of these, the test catches it loudly.
    const CLEANED_FILES = [
      // D1 — D-a coercion-drop
      "src/domains/changelog/actions.ts",
      "src/domains/attribution/candidate-actions.ts",
      "src/app/(shell)/finding-actions.ts",
      "src/lib/connectors/connector-review-import-run.ts",
      "src/lib/import/actions.ts",
      // D3 — D-c entry-point-resolved
      "src/domains/results/actions.ts",
      "src/domains/opportunity-candidates/actions.ts",
      "src/app/(shell)/recommendations/actions.ts",
      "src/app/(shell)/pages/verify-action.ts",
      // D2 — D-b factory parameter-required
      "src/lib/import/engine.ts",
      "src/domains/pages/extractor.ts",
      "src/domains/pages/discover.ts",
      "src/domains/pages/guardrails.ts",
      "src/domains/scanning/detect-findings.ts",
      "src/derivations/snapshot-builder.ts",
      "src/domains/answer-intelligence/build-index.ts",
      "src/domains/visibility-events/engine.ts",
      "src/adapters/profound/bridge.ts",
      "src/adapters/profound/benchmark-adapter.ts",
      "src/adapters/profound/execution-adapter.ts",
      "src/domains/attribution/change-outcome.ts",
      "src/domains/attribution/url-change-outcome.ts",
    ];
    const regressed = CLEANED_FILES.filter((p) =>
      filesWithLiteral.includes(p),
    );
    expect(
      regressed,
      `D1/D2/D3-cleaned files have re-introduced a \`tenant_id: ""\` literal. ` +
        `Either resolve tenantId in scope and stamp directly, or revert ` +
        `the regression. Regressed file(s):\n  ${regressed.join("\n  ")}`,
    ).toEqual([]);
  });
});
