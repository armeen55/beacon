/**
 * Architecture invariant — Slice 4.5.B.α₀ recommendation-
 * intelligence no-queue-write (2026-05-19).
 *
 * The Recommendation Intelligence pipeline produces candidate
 * rows IN MEMORY ONLY. The customer-queue flip is deferred to
 * Slice 4.5.D. Until then:
 *
 *   • No file under `src/domains/recommendation-intelligence/**`
 *     may import `recommended-edits-persistence` (or any
 *     persisting helper from that module).
 *   • No file under that tree may call a Supabase write
 *     against `.from("recommended_edits")` —
 *     `.insert(` / `.upsert(` / `.update(` / `.delete(`.
 *   • The operator-only diagnostic page at
 *     `/diagnostics/recommendation-triggers/page.tsx` is also
 *     scanned (same contract: it must consume the loader's
 *     in-memory output, never persist).
 *
 * Defense-in-depth alongside `recommendation-trigger-predicates-
 * purity` (which forbids connector / LLM / Supabase entirely
 * inside predicates).
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

const FORBIDDEN_IMPORTS: ReadonlyArray<string> = [
  "@/domains/recommendations/recommended-edits-persistence",
  "recommended-edits-persistence",
  "runProviderAndPersist",
];

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

  it.each(FORBIDDEN_IMPORTS)(
    "no file under recommendation-intelligence imports `%s`",
    (token) => {
      const offenders: string[] = [];
      for (const file of files) {
        const active = stripComments(read(file));
        if (active.includes(token)) {
          offenders.push(file.replace(REPO_ROOT + "/", ""));
        }
      }
      expect(
        offenders,
        `Customer-queue write path is forbidden in recommendation-intelligence. Offenders: ${offenders.join(", ")}`,
      ).toEqual([]);
    },
  );

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
