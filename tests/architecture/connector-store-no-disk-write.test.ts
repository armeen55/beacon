/**
 * Architecture invariant — connector-tokens-supabase-and-gsc-scope-split
 * (2026-05-16).
 *
 * Pins that `src/lib/connector-store.ts` no longer writes connector
 * tokens to disk. Replaces the prior file-backed store
 * (`.data/connector-tokens.json`) which crashed on Vercel:
 *   "ENOENT: no such file or directory,
 *    open '/var/task/.data/connector-tokens.json.tmp'"
 *
 * Negative invariants:
 *   • No `writeFileSync(` call site
 *   • No `renameSync(` call site
 *   • No `mkdirSync(` call site
 *   • No `unlinkSync(` call site
 *   • No `.data/connector-tokens` substring (in any form)
 *
 * Positive invariants:
 *   • Imports `getSupabaseAdmin` from `@/lib/persistence/supabase`.
 *   • Imports `currentTenantId` from `@/lib/tenant-context` for
 *     ambient-tenant resolution.
 *   • Active source references the `connector_tokens` table.
 *   • At least one Supabase write helper is invoked (.upsert or
 *     .delete on the table).
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const STORE_PATH = join(
  resolve(__dirname, "../.."),
  "src/lib/connector-store.ts",
);

function stripComments(src: string): string {
  return src
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

const STORE_CODE = stripComments(readFileSync(STORE_PATH, "utf-8"));

describe("connector-store — no disk writes", () => {
  it("does NOT call writeFileSync", () => {
    expect(
      /\bwriteFileSync\s*\(/.test(STORE_CODE),
      "connector-store.ts must not call writeFileSync — disk writes " +
        "are why the Vercel callback returned ENOENT. All persistence " +
        "must route through the Supabase admin client.",
    ).toBe(false);
  });

  it("does NOT call renameSync", () => {
    expect(/\brenameSync\s*\(/.test(STORE_CODE)).toBe(false);
  });

  it("does NOT call mkdirSync", () => {
    expect(/\bmkdirSync\s*\(/.test(STORE_CODE)).toBe(false);
  });

  it("does NOT call unlinkSync", () => {
    expect(/\bunlinkSync\s*\(/.test(STORE_CODE)).toBe(false);
  });

  it("does NOT reference the legacy .data/connector-tokens path", () => {
    expect(/\.data\/connector-tokens/.test(STORE_CODE)).toBe(false);
    expect(/connector-tokens\.json/.test(STORE_CODE)).toBe(false);
  });
});

describe("connector-store — Supabase routing", () => {
  it("imports getSupabaseAdmin from @/lib/persistence/supabase", () => {
    expect(
      /from\s+["']@\/lib\/persistence\/supabase["']/.test(STORE_CODE) &&
        /\bgetSupabaseAdmin\b/.test(STORE_CODE),
    ).toBe(true);
  });

  it("imports currentTenantId from @/lib/tenant-context", () => {
    expect(
      /from\s+["']@\/lib\/tenant-context["']/.test(STORE_CODE) &&
        /\bcurrentTenantId\b/.test(STORE_CODE),
    ).toBe(true);
  });

  it("references the connector_tokens table", () => {
    expect(/connector_tokens/.test(STORE_CODE)).toBe(true);
  });

  it("invokes Supabase upsert + delete helpers on the table", () => {
    expect(/\.upsert\s*\(/.test(STORE_CODE)).toBe(true);
    expect(/\.delete\s*\(/.test(STORE_CODE)).toBe(true);
  });
});
