/**
 * CONSTITUTION §7 — Connector + database honesty.
 *
 * Consolidated from dual-write-loud-fail, dual-write-onconflict, and
 * robots-state-supabase-mirror. Pins that persistence fails LOUD and
 * honest rather than silently completing:
 *   1. dual-write throws on persistent Supabase error regardless of
 *      DATA_SOURCE (Bug-1: silent-fail stamped polls "complete" with
 *      zero rows persisted). Both the per-chunk throw and outer re-throw.
 *   2. onConflict targets match the real Supabase unique indexes
 *      (tenant-scoped compound keys), so an Accept never throws
 *      "no unique constraint matching ON CONFLICT".
 *   3. robots-state is a per-tenant Supabase-mirrored singleton with a
 *      42P01 undefined-table soft-fail (honest null, deploy-before-migrate
 *      safe) — never the read-only-FS flat-path reader that returned null
 *      on Vercel.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const read = (rel: string) => readFileSync(resolve(REPO_ROOT, rel), "utf-8");
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const DUAL = read("src/lib/persistence/dual-write.ts");

function body(fnName: string): string {
  const start = DUAL.indexOf(`export async function ${fnName}`);
  expect(start, `${fnName} not found`).toBeGreaterThan(-1);
  const end = DUAL.indexOf("\n}\n", start);
  return DUAL.slice(start, end + 2);
}

describe("dual-write — loud-fail on persistent Supabase error (Bug-1)", () => {
  it("does NOT gate the throw on process.env.DATA_SOURCE", () => {
    expect(DUAL).not.toMatch(
      /if\s*\(\s*process\.env\.DATA_SOURCE\s*===\s*"supabase"\s*\)\s*\{[\s\S]*?throw/,
    );
  });
  it("retains the per-chunk throw AND the outer-catch re-throw", () => {
    expect(DUAL).toMatch(/throw new Error\(/);
    expect(DUAL).toMatch(
      /catch\s*\(\s*e\s*\)\s*\{[\s\S]*?console\.error[\s\S]*?throw\s+e\s*;/,
    );
  });
  it("keeps the Bug-1 rationale so the gate is not reintroduced", () => {
    expect(DUAL).toMatch(/Bug-1/);
    expect(DUAL).toMatch(/2026-05-04/);
  });
});

describe("dual-write — onConflict targets match real unique indexes", () => {
  it("syncRecommendationResponses → tenant_id,rec_id", () => {
    const b = body("syncRecommendationResponses");
    expect(b).toMatch(/dualWriteUpsert(?:Scoped)?\(\s*["']recommendation_responses["']/);
    expect(b).toMatch(/["']tenant_id,rec_id["']/);
  });
  it("syncRecommendedEdits → tenant_id,rec_id,action_type,target_element_key", () => {
    expect(body("syncRecommendedEdits")).toMatch(
      /["']tenant_id,rec_id,action_type,target_element_key["']/,
    );
  });
  it("syncUrlChangeOutcomes → change_id,url", () => {
    expect(body("syncUrlChangeOutcomes")).toMatch(/["']change_id,url["']/);
  });
  it("syncPageElementInventory → tenant_id,source_snapshot_id,element_key + dedup", () => {
    const b = body("syncPageElementInventory");
    expect(b).toMatch(/["']tenant_id,source_snapshot_id,element_key["']/);
    expect(b).toMatch(/dedupedByKey\s*=\s*new Map/);
  });
  // syncObservationRuns + syncChangelogEntries onConflict pins removed
  // 2026-07-22 (CORE 100K persistence collapse): both writers were dead and
  // were deleted from dual-write.ts. The remaining onConflict pins above keep
  // the "targets match real unique indexes" invariant real for every LIVE writer.
});

describe("robots-state — per-tenant Supabase mirror with honest soft-fail", () => {
  const ROBOTS = strip(read("src/domains/pages/robots-parser.ts"));
  const TYPES = strip(read("src/lib/persistence/repositories/types.ts"));
  const BACKEND = strip(read("src/lib/persistence/repositories/supabase-backend.ts"));

  it("read/write are async, tenant-scoped, and repository-routed", () => {
    expect(ROBOTS).toMatch(
      /export\s+async\s+function\s+readRobotsState\s*\(\s*opts\s*:\s*\{[\s\S]*?tenantId\s*:\s*string[\s\S]*?\}\s*\)\s*:\s*Promise<RobotsStateFile\s*\|\s*null>/,
    );
    expect(ROBOTS).toMatch(
      /export\s+async\s+function\s+writeRobotsState\s*\(\s*opts\s*:\s*\{[\s\S]*?tenantId\s*:\s*string[\s\S]*?state\s*:\s*RobotsStateFile[\s\S]*?\}\s*\)\s*:\s*Promise<void>/,
    );
    expect(ROBOTS).toMatch(/getRepository\s*\(\s*\)\.forTenant/);
    expect(ROBOTS).toMatch(/\.getRobotsState\s*\(/);
    expect(ROBOTS).toMatch(/\.setRobotsState\s*\(/);
  });
  it("TenantRepository declares getRobotsState + setRobotsState", () => {
    expect(TYPES).toMatch(/getRobotsState\s*\(\s*\)\s*:\s*Promise<RobotsStateFile\s*\|\s*null>/);
    expect(TYPES).toMatch(
      /setRobotsState\s*\(\s*state\s*:\s*RobotsStateFile\s*\)\s*:\s*Promise<void>/,
    );
  });
  it("supabase-backend soft-fails on 42P01 (deploy-before-migrate safe) + UPSERT on tenant_id", () => {
    expect(BACKEND).toMatch(/getRobotsState\s*:\s*async\s*\(\s*\)/);
    expect(BACKEND).toMatch(/42P01/);
    expect(BACKEND).toMatch(/setRobotsState\s*:\s*async/);
    expect(BACKEND).toMatch(/onConflict\s*:\s*["']tenant_id["']/);
  });
  it("robots-parser no longer reads the flat-path .data file directly", () => {
    const startIdx = ROBOTS.search(/export\s+async\s+function\s+readRobotsState\s*\(/);
    let i = startIdx,
      parenDepth = 0,
      braceDepth = 0,
      inBody = false,
      endIdx = -1;
    while (i < ROBOTS.length) {
      const ch = ROBOTS[i];
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
    const fnBody = ROBOTS.slice(startIdx, endIdx);
    expect(fnBody).not.toMatch(/readFileSync/);
    expect(fnBody).not.toMatch(/\bstatePath\s*\(/);
  });
});
