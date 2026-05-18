/**
 * Architecture invariant — A.3.b2 (2026-05-17).
 *
 * The GSC URL Inspection client cache lives in Supabase, not on disk.
 *
 * Background: A.3.b1.alpha shipped a disk-backed cache at
 * `.data/tenants/{slug}/gsc-url-inspections.json`. On Vercel that
 * cache was inert — lambda FS read-only post-init, `.data/`
 * gitignored. Every page render of a future operator-diagnostic
 * surface would have re-hit the GSC URL Inspection API, burning
 * daily quota (2,000 calls/day/property) in minutes.
 *
 * A.3.b2 migrated the cache to Supabase. This invariant pins the
 * "no disk writes anywhere in the GSC client" contract so a future
 * drive-by edit can't silently reintroduce the broken disk path.
 *
 * Negative invariants (source must NOT contain):
 *   • writeFileSync, renameSync, mkdirSync, unlinkSync, readFileSync
 *   • node:fs / node:path imports
 *   • getDataDir
 *   • any `.data/tenants` substring
 *   • the legacy `gsc-url-inspections.json` filename
 *
 * Positive invariants (source MUST contain):
 *   • getSupabaseAdmin import from @/lib/persistence/supabase
 *   • gsc_url_inspections table reference
 *   • .upsert + .select chain on the table
 *
 * Mirrors `tests/architecture/connector-store-no-disk-write.test.ts`.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const CLIENT_PATH = join(
  resolve(__dirname, "../.."),
  "src/lib/connectors/gsc/client.ts",
);

function stripComments(src: string): string {
  return src
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

const CLIENT_CODE = stripComments(readFileSync(CLIENT_PATH, "utf-8"));

describe("gsc cache — no disk writes (post-A.3.b2)", () => {
  it("does NOT call writeFileSync", () => {
    expect(
      /\bwriteFileSync\s*\(/.test(CLIENT_CODE),
      "gsc/client.ts must not call writeFileSync — disk writes are inert " +
        "on Vercel. All cache persistence routes through Supabase.",
    ).toBe(false);
  });

  it("does NOT call renameSync", () => {
    expect(/\brenameSync\s*\(/.test(CLIENT_CODE)).toBe(false);
  });

  it("does NOT call mkdirSync", () => {
    expect(/\bmkdirSync\s*\(/.test(CLIENT_CODE)).toBe(false);
  });

  it("does NOT call unlinkSync", () => {
    expect(/\bunlinkSync\s*\(/.test(CLIENT_CODE)).toBe(false);
  });

  it("does NOT call readFileSync", () => {
    expect(/\breadFileSync\s*\(/.test(CLIENT_CODE)).toBe(false);
  });

  it("does NOT import node:fs", () => {
    expect(/from\s+["']node:fs["']/.test(CLIENT_CODE)).toBe(false);
  });

  it("does NOT import node:path", () => {
    expect(/from\s+["']node:path["']/.test(CLIENT_CODE)).toBe(false);
  });

  it("does NOT call getDataDir (disk-path helper retired)", () => {
    expect(
      /\bgetDataDir\s*\(/.test(CLIENT_CODE),
      "gsc/client.ts must not call getDataDir — the A.3.b1.alpha disk " +
        "cache path is RETIRED.",
    ).toBe(false);
  });

  it("does NOT reference any .data/tenants path", () => {
    expect(/\.data\/tenants/.test(CLIENT_CODE)).toBe(false);
  });

  it("does NOT reference the legacy gsc-url-inspections.json filename", () => {
    // The Supabase table is `gsc_url_inspections` (underscored). The
    // legacy disk filename was `gsc-url-inspections.json` (hyphened).
    // The hyphened+json form is the structural drift signal.
    expect(/gsc-url-inspections\.json/.test(CLIENT_CODE)).toBe(false);
  });
});

describe("gsc cache — Supabase routing (positive invariants)", () => {
  it("imports getSupabaseAdmin from @/lib/persistence/supabase", () => {
    expect(
      /from\s+["']@\/lib\/persistence\/supabase["']/.test(CLIENT_CODE) &&
        /\bgetSupabaseAdmin\b/.test(CLIENT_CODE),
    ).toBe(true);
  });

  it("references the gsc_url_inspections table", () => {
    expect(/gsc_url_inspections/.test(CLIENT_CODE)).toBe(true);
  });

  it("invokes both .select and .upsert against the cache table", () => {
    expect(/\.select\s*\(/.test(CLIENT_CODE)).toBe(true);
    expect(/\.upsert\s*\(/.test(CLIENT_CODE)).toBe(true);
  });
});
