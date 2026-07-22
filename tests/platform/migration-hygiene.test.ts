/**
 * PLATFORM — migration hygiene (Core 100K terminal suite).
 *
 * Replaces the 14 per-migration SQL-shape suites that used to live in
 * tests/migrations/. Those pinned the text of migrations that have already
 * run in production and can never regress; this file instead pins the rules
 * every FUTURE migration must follow:
 *
 *   1. Additive-safe: no destructive statements (DROP TABLE, TRUNCATE, or an
 *      unfiltered DELETE) outside an explicit transaction. Today the corpus
 *      contains none at all.
 *   2. No grants to the anon role. The only exception is the pg_dump baseline
 *      snapshot (2026-05-08_baseline_schema.sql), whose blanket grants are
 *      neutralized by deny-anon RLS policies; that file must keep enabling
 *      RLS on every table it creates.
 *   3. Every table created anywhere in migrations/ has ROW LEVEL SECURITY
 *      enabled somewhere in the corpus (same file or a follow-up migration).
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const MIGRATIONS_DIR = resolve(__dirname, "..", "..", "migrations");
const BASELINE = "2026-05-08_baseline_schema.sql";

const files = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort();

/** SQL with line comments and quoted string literals removed, so hygiene
 *  greps never trip on prose or example text. */
function effectiveSql(raw: string): string {
  return raw
    .replace(/--[^\n]*/g, "")
    .replace(/'(?:[^']|'')*'/g, "''");
}

const corpus = new Map<string, { raw: string; sql: string }>();
for (const f of files) {
  const raw = readFileSync(join(MIGRATIONS_DIR, f), "utf8");
  corpus.set(f, { raw, sql: effectiveSql(raw) });
}

/** Bare table name (schema + quotes stripped) from a regex capture. */
function tableName(capture: string): string {
  const last = capture.trim().replace(/"/g, "").split(".").pop() ?? "";
  return last.toLowerCase();
}

describe("migration corpus sanity", () => {
  it("the migrations directory is non-trivial and the baseline snapshot is present", () => {
    expect(files.length).toBeGreaterThan(50);
    expect(files).toContain(BASELINE);
  });
});

describe("rule 1 — additive-safe (destructive statements are transactional or absent)", () => {
  for (const [f, { sql }] of corpus) {
    it(`${f}: no un-transactioned DROP TABLE / TRUNCATE / unfiltered DELETE`, () => {
      const destructive: string[] = [];
      for (const m of sql.matchAll(/\b(drop\s+table|truncate)\b/gi) as Iterable<RegExpMatchArray>) {
        destructive.push(m[0]!);
      }
      for (const m of sql.matchAll(/\bdelete\s+from\s+([a-zA-Z0-9_."]+)([^;]*);/gi) as Iterable<RegExpMatchArray>) {
        if (!/\bwhere\b/i.test(m[2] ?? "")) destructive.push(`unfiltered DELETE FROM ${m[1]}`);
      }
      if (destructive.length > 0) {
        // A destructive statement is only acceptable inside an explicit
        // transaction so a mid-migration failure cannot strand half a wipe.
        expect(
          /^\s*begin\b/im.test(sql) && /\bcommit\b/i.test(sql),
          `${f} contains destructive statements (${destructive.join(", ")}) outside BEGIN/COMMIT`,
        ).toBe(true);
      }
    });
  }
});

describe("rule 2 — no grants to anon", () => {
  for (const [f, { sql }] of corpus) {
    if (f === BASELINE) continue;
    it(`${f}: never grants anything to the anon role`, () => {
      const grants = [...(sql.matchAll(/\bgrant\b[^;]*;/gi) as Iterable<RegExpMatchArray>)]
        .map((m) => m[0]!)
        .filter((stmt) => /\bto\b[^;]*\banon\b/i.test(stmt.replace(/"/g, "")));
      expect(grants, `${f} grants to anon: ${grants.join(" | ")}`).toEqual([]);
    });
  }

  it(`${BASELINE} (the pg_dump snapshot) enables RLS on every table it creates`, () => {
    const { sql } = corpus.get(BASELINE)!;
    const created = new Set<string>();
    for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?([a-zA-Z0-9_."]+)/gi) as Iterable<RegExpMatchArray>) {
      created.add(tableName(m[1]!));
    }
    const rls = new Set<string>();
    for (const m of sql.matchAll(/alter\s+table\s+(?:only\s+)?([a-zA-Z0-9_."]+)\s+enable\s+row\s+level\s+security/gi) as Iterable<RegExpMatchArray>) {
      rls.add(tableName(m[1]!));
    }
    const unprotected = [...created].filter((t) => !rls.has(t));
    expect(unprotected, `baseline tables without RLS: ${unprotected.join(", ")}`).toEqual([]);
  });
});

describe("rule 3 — every created table enables ROW LEVEL SECURITY somewhere in the corpus", () => {
  const createdBy = new Map<string, string>();
  const rlsEnabled = new Set<string>();
  for (const [f, { sql }] of corpus) {
    for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?([a-zA-Z0-9_."]+)/gi) as Iterable<RegExpMatchArray>) {
      const t = tableName(m[1]!);
      if (!createdBy.has(t)) createdBy.set(t, f);
    }
    for (const m of sql.matchAll(/alter\s+table\s+(?:only\s+)?([a-zA-Z0-9_."]+)\s+enable\s+row\s+level\s+security/gi) as Iterable<RegExpMatchArray>) {
      rlsEnabled.add(tableName(m[1]!));
    }
  }

  it("finds a meaningful number of created tables (the parser is not silently broken)", () => {
    expect(createdBy.size).toBeGreaterThan(50);
  });

  it("no table is left without RLS", () => {
    const missing = [...createdBy.entries()]
      .filter(([t]) => !rlsEnabled.has(t))
      .map(([t, f]) => `${t} (created in ${f})`);
    expect(missing, `tables without RLS anywhere in migrations/: ${missing.join(", ")}`).toEqual([]);
  });
});
