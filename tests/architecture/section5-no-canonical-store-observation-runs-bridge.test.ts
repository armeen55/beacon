/**
 * Architecture invariant — Section 5 must not bridge `ProfoundImportRun`
 * reads through `@/storage/canonical-store` (2026-05-16, precursor
 * slice).
 *
 * Context: Section 5 (repeat-citation classifier) consumes
 * `ProfoundImportRun[]` as its locked G2 denominator source. The
 * structurally correct source is the new tenant-scoped repository
 * method:
 *
 *   getRepository().forTenant(tenantId).getProfoundImportRuns()
 *
 * The legacy reader `getObservationRuns` from
 * `@/storage/canonical-store` returns the same `ProfoundImportRun[]`
 * type BUT relies on a process-level mutable `_state` cache that
 * leaks across tenants under multi-tenant runtime (the canonical-
 * store caches the first request's tenant slug data and serves it
 * to subsequent requests of every other slug). Section 7's
 * multi-tenant prerequisite is parked; until it ships, the
 * canonical-store leak surface is documented + bounded but MUST
 * NOT be widened by new consumers.
 *
 * This invariant pins:
 *   1. NO file under `src/domains/citation-lifecycle/**` imports
 *      `getObservationRuns` (named OR namespace) from
 *      `@/storage/canonical-store`.
 *   2. Section 5's eventual `compute-repeat-citation.ts` /
 *      `load-repeat-citation.ts` MUST consume the repository
 *      method instead.
 *
 * Today (precursor slice landed; Section 5 files not yet created)
 * this invariant is GREEN by absence — zero matches expected. It
 * pre-ratchets so the next slice that introduces Section 5 cannot
 * accidentally adopt the canonical-store bridge.
 *
 * Retirement condition: this invariant is permanent. The structural
 * argument (tenant-scoped repo method beats process-cached global
 * reader) does not change when Section 7's multi-tenant prereq
 * ships. At most, the bridge ban broadens to additional domains
 * when their own compute layers land.
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const SCOPE_ROOT = "src/domains/citation-lifecycle";

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function walk(rootRel: string): string[] {
  const abs = resolve(REPO_ROOT, rootRel);
  let entries: string[];
  try {
    entries = readdirSync(abs);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const name of entries) {
    const childAbs = join(abs, name);
    const childRel = `${rootRel}/${name}`;
    const stat = statSync(childAbs);
    if (stat.isDirectory()) {
      out.push(...walk(childRel));
    } else if (
      stat.isFile() &&
      (name.endsWith(".ts") || name.endsWith(".tsx"))
    ) {
      out.push(childRel);
    }
  }
  return out;
}

describe("Architecture — Section 5 no canonical-store observation-runs bridge", () => {
  const files = walk(SCOPE_ROOT);

  it(`scope is non-empty (sanity — ${SCOPE_ROOT} resolves)`, () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const rel of files) {
    it(`${rel}: does NOT import getObservationRuns from @/storage/canonical-store`, () => {
      const src = stripComments(readFileSync(resolve(REPO_ROOT, rel), "utf-8"));
      // Forbidden patterns:
      //   import { getObservationRuns } from "@/storage/canonical-store"
      //   import { ..., getObservationRuns, ... } from "@/storage/canonical-store"
      //   import * as canonicalStore from "@/storage/canonical-store"
      //   const { getObservationRuns } = require("@/storage/canonical-store")
      // The scan is conservative: any active-source mention of the
      // import path `@/storage/canonical-store` is flagged. Pure
      // helpers in this domain have zero legitimate reason to import
      // from canonical-store; the loader uses `getRepository()`.
      const offendingImport = src.includes('"@/storage/canonical-store"') ||
        src.includes("'@/storage/canonical-store'");
      if (offendingImport) {
        throw new Error(
          `${rel}: imports from '@/storage/canonical-store' are forbidden in this scope.\n` +
            `Section 5 (repeat-citation) MUST consume ProfoundImportRun[] via\n` +
            `getRepository().forTenant(tenantId).getProfoundImportRuns() — NOT the\n` +
            `canonical-store bridge (process-cached, cross-tenant leak risk).`,
        );
      }
      expect(offendingImport).toBe(false);
    });
  }
});
