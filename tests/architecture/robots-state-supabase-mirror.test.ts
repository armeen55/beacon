/**
 * Architecture invariant — Phase A.3 post-A.3.5 second-stage
 * (2026-05-15).
 *
 * Robots-state is mirrored to Supabase (`public.robots_state`) as a
 * per-tenant singleton row, retiring the pre-A.3 flat-path
 * `.data/robots-state.json` reader that returned null on Vercel's
 * read-only lambda FS.
 *
 * This invariant pins, at the source-text level:
 *   1. `readRobotsState` and `writeRobotsState` in
 *      `src/domains/pages/robots-parser.ts` are async and take a
 *      `{ tenantId }` argument (no more sync flat-path readers).
 *   2. Both functions route through
 *      `getRepository().forTenant(...)` (the tenant-scoped
 *      Supabase-aware boundary), via dynamic import so the
 *      previous-A.3 dependency graph stays untouched at the
 *      module-top level (avoids circular import w/ the
 *      repository's own robots-state implementation).
 *   3. `TenantRepository` declares both `getRobotsState` and
 *      `setRobotsState` so backends implement them uniformly.
 *   4. `refreshRobotsState` takes `{ siteDomain, tenantId }` and
 *      awaits the (now-async) write — previous signature
 *      `(siteDomain: string)` is retired.
 *
 * Sequencing model A: the repository's getRobotsState
 * implementation MUST soft-fail to null on Postgres error code
 * 42P01 (undefined_table) so production code is safe to deploy
 * before the migration applies. Pinned by inspecting the
 * supabase-backend source for `42P01`.
 *
 * Retirement: refines when robots-state evolves a v2 schema (the
 * `schema_version` column gates that future work without
 * affecting this contract).
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");

function read(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), "utf-8");
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const ROBOTS_PARSER = stripComments(read("src/domains/pages/robots-parser.ts"));
const REPO_TYPES = stripComments(read("src/lib/persistence/repositories/types.ts"));
const SUPABASE_BACKEND = stripComments(
  read("src/lib/persistence/repositories/supabase-backend.ts"),
);

describe("Architecture — robots-state Supabase mirror (Phase A.3 post-A.3.5)", () => {
  it("readRobotsState is async + takes { tenantId } in robots-parser.ts", () => {
    // Multi-line type literal — non-greedy match across newlines.
    expect(ROBOTS_PARSER).toMatch(
      /export\s+async\s+function\s+readRobotsState\s*\(\s*opts\s*:\s*\{[\s\S]*?tenantId\s*:\s*string[\s\S]*?\}\s*\)\s*:\s*Promise<RobotsStateFile\s*\|\s*null>/,
    );
  });

  it("writeRobotsState is async + takes { tenantId, state } in robots-parser.ts", () => {
    expect(ROBOTS_PARSER).toMatch(
      /export\s+async\s+function\s+writeRobotsState\s*\(\s*opts\s*:\s*\{[\s\S]*?tenantId\s*:\s*string[\s\S]*?state\s*:\s*RobotsStateFile[\s\S]*?\}\s*\)\s*:\s*Promise<void>/,
    );
  });

  it("readRobotsState routes through the tenant repository (repo.getRobotsState)", () => {
    expect(ROBOTS_PARSER).toMatch(/getRepository\s*\(\s*\)\.forTenant/);
    expect(ROBOTS_PARSER).toMatch(/\.getRobotsState\s*\(/);
  });

  it("writeRobotsState routes through the tenant repository (repo.setRobotsState)", () => {
    expect(ROBOTS_PARSER).toMatch(/\.setRobotsState\s*\(/);
  });

  it("refreshRobotsState signature takes { siteDomain, tenantId } (retired the single-string param)", () => {
    expect(ROBOTS_PARSER).toMatch(
      /export\s+async\s+function\s+refreshRobotsState\s*\(\s*opts\s*:\s*\{[\s\S]*?siteDomain\s*:\s*string[\s\S]*?tenantId\s*:\s*string[\s\S]*?\}/,
    );
  });

  it("TenantRepository declares getRobotsState + setRobotsState", () => {
    expect(REPO_TYPES).toMatch(
      /getRobotsState\s*\(\s*\)\s*:\s*Promise<RobotsStateFile\s*\|\s*null>/,
    );
    expect(REPO_TYPES).toMatch(
      /setRobotsState\s*\(\s*state\s*:\s*RobotsStateFile\s*\)\s*:\s*Promise<void>/,
    );
  });

  it("supabase-backend implements getRobotsState with 42P01 undefined-table soft-fail (sequencing model A)", () => {
    // Locate the getRobotsState implementation and verify the
    // error-code soft-fail is in source.
    expect(SUPABASE_BACKEND).toMatch(/getRobotsState\s*:\s*async\s*\(\s*\)/);
    expect(SUPABASE_BACKEND).toMatch(/42P01/);
  });

  it("supabase-backend implements setRobotsState (UPSERT on tenant_id)", () => {
    expect(SUPABASE_BACKEND).toMatch(/setRobotsState\s*:\s*async/);
    expect(SUPABASE_BACKEND).toMatch(/onConflict\s*:\s*["']tenant_id["']/);
  });

  it("robots-parser.ts no longer reads .data/robots-state.json directly (flat-path retired)", () => {
    // The flat-path read used `readFileSync(statePath(), ...)` —
    // confirm no readFileSync call inside readRobotsState body.
    // Cheap structural check: the new async implementation does
    // not contain readFileSync within the readRobotsState block.
    // Locate the function body via brace tracking.
    const startIdx = ROBOTS_PARSER.search(
      /export\s+async\s+function\s+readRobotsState\s*\(/,
    );
    expect(startIdx).toBeGreaterThanOrEqual(0);
    let i = startIdx;
    let parenDepth = 0;
    let braceDepth = 0;
    let inBody = false;
    let endIdx = -1;
    while (i < ROBOTS_PARSER.length) {
      const ch = ROBOTS_PARSER[i];
      if (ch === "(") parenDepth++;
      else if (ch === ")") parenDepth--;
      else if (ch === "{") {
        if (!inBody && parenDepth === 0) inBody = true;
        braceDepth++;
      } else if (ch === "}") {
        braceDepth--;
        if (inBody && braceDepth === 0) {
          endIdx = i + 1;
          break;
        }
      }
      i++;
    }
    expect(endIdx).toBeGreaterThan(startIdx);
    const body = ROBOTS_PARSER.slice(startIdx, endIdx);
    expect(body, "readRobotsState body still uses readFileSync — flat-path not retired").not.toMatch(
      /readFileSync/,
    );
    expect(body, "readRobotsState body still calls statePath() — flat-path not retired").not.toMatch(
      /\bstatePath\s*\(/,
    );
  });
});
