/**
 * Architecture invariant — Slice 4.5.B.α₀ recommendation-
 * intelligence no-queue-write (2026-05-19); EVOLVED in
 * Slice 4.5.D.α₁b (2026-05-20).
 *
 * Original contract (4.5.B.α₀): the Recommendation Intelligence
 * pipeline produces candidate rows IN MEMORY ONLY. Customer-
 * queue flip deferred to Slice 4.5.D.
 *
 * α₁b evolution: the customer-queue flip lands as a SINGLE
 * allowlisted file —
 * `src/domains/recommendation-intelligence/promotion-writer.ts`
 * — which legitimately imports `recommended-edits-persistence`
 * to call `persistRecommendedEditsLocal` +
 * `syncRecommendedEdits`. Every OTHER file in the tree + the
 * operator-only diagnostic page STAYS write-forbidden.
 *
 * Current contract:
 *   • Only `promotion-writer.ts` may import
 *     `recommended-edits-persistence` (positive importer pin).
 *   • `runProviderAndPersist` STAYS GLOBALLY FORBIDDEN — the
 *     writer uses persistence helpers directly, NOT the LLM
 *     orchestrator path.
 *   • No file in scope may call a Supabase write against
 *     `.from("recommended_edits")` —
 *     `.insert(` / `.upsert(` / `.update(` / `.delete(`.
 *     (The writer uses `syncRecommendedEdits`, which uses
 *     a different code path via `dualWriteUpsertScoped`.)
 *   • The operator-only diagnostic page at
 *     `/diagnostics/recommendation-triggers/page.tsx` is
 *     scanned (same write-forbidden contract).
 *
 * Defense-in-depth alongside `recommendation-trigger-predicates-
 * purity`, `-no-llm-decides`, and the α₁a mapper-eligibility +
 * source-pin invariants.
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const INTEL_DIR = resolve(
  REPO_ROOT,
  "src",
  "domains",
  "recommendation-intelligence",
);
const DIAGNOSTIC_PAGE = resolve(
  REPO_ROOT,
  "src",
  "app",
  "(shell)",
  "diagnostics",
  "recommendation-triggers",
  "page.tsx",
);

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

function read(path: string): string {
  return readFileSync(path, "utf-8");
}
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** α₁b allowlist: the SINGLE file under
 *  src/domains/recommendation-intelligence/ permitted to import
 *  `recommended-edits-persistence`. Every other file in the tree
 *  + the diagnostic page STAYS write-forbidden. */
const ALLOWED_PERSISTENCE_IMPORT_FILES: ReadonlySet<string> = new Set([
  resolve(INTEL_DIR, "promotion-writer.ts"),
]);

/** Tokens that signal an import of `recommended-edits-persistence`
 *  (either alias `@/domains/recommendations/...` or the bare
 *  trailing path). Subject to allowlist. */
const PERSISTENCE_IMPORT_TOKENS: ReadonlyArray<string> = [
  "@/domains/recommendations/recommended-edits-persistence",
  "recommended-edits-persistence",
];

/** GLOBALLY FORBIDDEN. No file under the tree may import this
 *  LLM-orchestrator symbol, even the α₁b writer. */
const GLOBALLY_FORBIDDEN_TOKEN = "runProviderAndPersist";

/** Match any `.from("recommended_edits").<write>(` shape in
 *  comment-stripped source. Whitespace-tolerant. */
const RECOMMENDED_EDITS_WRITE = new RegExp(
  "\\.from\\(\\s*[\"']recommended_edits[\"']\\s*\\)" +
    "\\s*\\.(?:insert|upsert|update|delete)\\s*\\(",
  "u",
);

describe("recommendation-intelligence-no-queue-write", () => {
  const files = [...walk(INTEL_DIR), DIAGNOSTIC_PAGE];

  it("file set is non-empty", () => {
    expect(files.length).toBeGreaterThanOrEqual(2);
  });

  it.each(PERSISTENCE_IMPORT_TOKENS)(
    "no file under recommendation-intelligence imports `%s` except allowlisted",
    (token) => {
      const offenders: string[] = [];
      for (const file of files) {
        if (ALLOWED_PERSISTENCE_IMPORT_FILES.has(file)) continue;
        const active = stripComments(read(file));
        if (active.includes(token)) {
          offenders.push(file.replace(REPO_ROOT + "/", ""));
        }
      }
      expect(
        offenders,
        `Customer-queue persistence imports are forbidden outside the α₁b allowlist. Offenders: ${offenders.join(", ")}`,
      ).toEqual([]);
    },
  );

  it("`promotion-writer.ts` IS the single allowlisted importer of `recommended-edits-persistence`", () => {
    const writerPath = resolve(INTEL_DIR, "promotion-writer.ts");
    expect(
      files,
      "promotion-writer.ts must exist under src/domains/recommendation-intelligence/",
    ).toContain(writerPath);
    const active = stripComments(read(writerPath));
    expect(
      active.includes(
        "@/domains/recommendations/recommended-edits-persistence",
      ),
      "promotion-writer.ts must import `@/domains/recommendations/recommended-edits-persistence` — the α₁b customer-queue writer contract pins this positive importer.",
    ).toBe(true);
    expect(
      active.includes("persistRecommendedEditsLocal"),
      "promotion-writer.ts must call `persistRecommendedEditsLocal` (local fail-loud write).",
    ).toBe(true);
    expect(
      active.includes("syncRecommendedEdits"),
      "promotion-writer.ts must call `syncRecommendedEdits` (dual-write best-effort).",
    ).toBe(true);
  });

  it("no file under recommendation-intelligence imports `runProviderAndPersist` (globally forbidden)", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const active = stripComments(read(file));
      if (active.includes(GLOBALLY_FORBIDDEN_TOKEN)) {
        offenders.push(file.replace(REPO_ROOT + "/", ""));
      }
    }
    expect(
      offenders,
      `\`runProviderAndPersist\` is the LLM-orchestrator write path and STAYS globally forbidden — even the α₁b writer uses persistence helpers directly. Offenders: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("no file performs a Supabase write against `recommended_edits`", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const active = stripComments(read(file));
      if (RECOMMENDED_EDITS_WRITE.test(active)) {
        offenders.push(file.replace(REPO_ROOT + "/", ""));
      }
    }
    expect(
      offenders,
      `Recommendation-intelligence must not write to recommended_edits. Offenders: ${offenders.join(", ")}`,
    ).toEqual([]);
  });
});
