/**
 * Recommendation Lifecycle OS — Phase 2 architecture invariant.
 *
 * The match engine is contractually pure: no I/O, no DB, no Supabase,
 * no `.data` reads, no repository imports, no server actions, no LLM
 * provider calls. This test walks `src/domains/recommendations/match-engine/`
 * (excluding `*.test.ts`) and fails on any forbidden import.
 *
 * Phase 3 will wire the engine into the scan dual-write block — the
 * RUNNER does the I/O. The engine itself stays pure forever.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const MATCH_ENGINE_DIR = resolve(
  __dirname,
  "../../src/domains/recommendations/match-engine",
);

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  const stack: string[] = [dir];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    let entries: string[] = [];
    try {
      entries = readdirSync(cur);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(cur, entry);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        stack.push(full);
      } else if (
        st.isFile() &&
        full.endsWith(".ts") &&
        !full.endsWith(".test.ts")
      ) {
        out.push(full);
      }
    }
  }
  return out;
}

const FORBIDDEN_IMPORT_PATTERNS: Array<{ name: string; regex: RegExp }> = [
  // Persistence layer
  { name: "readDotDataJson", regex: /\breadDotDataJson\b/ },
  { name: "writeDotDataJson", regex: /\bwriteDotDataJson\b/ },
  { name: "readStore", regex: /\breadStore\b/ },
  { name: "writeStore", regex: /\bwriteStore\b/ },
  // Dual-write / Supabase
  { name: "dualWrite (any)", regex: /\bdualWrite\w*\b/ },
  { name: "syncRecommendedEdits", regex: /\bsyncRecommendedEdits\b/ },
  { name: "syncChangelogEntries", regex: /\bsyncChangelogEntries\b/ },
  { name: "@supabase import", regex: /from\s+["']@supabase\// },
  { name: "supabase-js client", regex: /\bgetSupabaseAdmin\b/ },
  // Repositories
  { name: "getRepository", regex: /\bgetRepository\b/ },
  { name: "repo import", regex: /from\s+["'][^"']*\/repositories["']/ },
  // Server / Next runtime
  { name: '"server-only" import', regex: /from\s+["']server-only["']/ },
  { name: '"use server" directive', regex: /^["']use server["'];?$/m },
  { name: "next/cache import", regex: /from\s+["']next\/cache["']/ },
  // LLM providers
  { name: "openai import", regex: /from\s+["']openai["']/ },
  { name: "anthropic SDK import", regex: /from\s+["']@anthropic-ai\// },
  { name: "providers/* import", regex: /from\s+["'][^"']*\/providers\// },
  // Seed data + tenant runtime
  { name: "seed-data.server", regex: /from\s+["'][^"']*seed-data\.server/ },
  { name: "currentTenantId", regex: /\bcurrentTenantId\b/ },
  { name: "currentTenantSlug", regex: /\bcurrentTenantSlug\b/ },
  // Logger (optional in pure functions, but caller's job to log)
  { name: "logger import", regex: /from\s+["']@\/lib\/logger["']/ },
];

describe("Lifecycle OS Phase 2 — match-engine purity invariant", () => {
  const files = listSourceFiles(MATCH_ENGINE_DIR);

  it("discovers source files in match-engine/", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(FORBIDDEN_IMPORT_PATTERNS)(
    "no source file under match-engine/ uses $name",
    ({ regex }) => {
      const offenders: string[] = [];
      for (const file of files) {
        const src = readFileSync(file, "utf8");
        if (regex.test(src)) offenders.push(file);
      }
      expect(offenders).toEqual([]);
    },
  );

  it("only TYPE imports cross the recommended-edits-persistence boundary", () => {
    // The match engine MUST consume the `RecommendedEditRow` shape, but
    // it must do so as a TYPE-only import — never call any function
    // exported from the persistence module (those are write helpers
    // that touch the disk + Supabase).
    const offenders: { file: string; line: string }[] = [];
    const persistenceImportRegex =
      /^import\s+(?:type\s+)?(\{[^}]+\}|\*\s+as\s+\w+|\w+)\s+from\s+["'][^"']*recommended-edits-persistence["']/m;
    const persistenceFunctionNames = [
      "runProviderAndPersist",
      "mapSpecificEditToRow",
      "persistRecommendedEditsLocal",
      "readRecommendedEditsLocal",
      "markRecommendedEditsAccepted",
    ];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      const lines = src.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        if (!persistenceImportRegex.test(line)) continue;
        // Allow `import type` and `import { type Foo }` style only.
        const isTypeOnlyImport = /^import\s+type\s+/.test(line);
        if (isTypeOnlyImport) continue;
        // Inline type braces — disallow non-type identifiers.
        for (const fn of persistenceFunctionNames) {
          const tokenRegex = new RegExp(`\\b${fn}\\b`);
          if (tokenRegex.test(line)) {
            offenders.push({ file, line });
            break;
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
