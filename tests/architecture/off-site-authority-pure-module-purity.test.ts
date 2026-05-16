/**
 * Architecture invariant — Section 7 C7a pure-module purity contract
 * (2026-05-16).
 *
 * Pins that the two pure off-site-authority modules
 * (`src/domains/off-site-authority/types.ts` and `compute-snapshot.ts`)
 * do NOT import any global / hybrid-scope helper:
 *   - getBusinessConfig
 *   - isPlaceholderConfig
 *   - readLocalReviews
 *   - getConnectorToken / getGoogleConnectorToken / getYelpConnectorToken
 *   - currentTenantId / currentTenantSlug
 *   - getRepository
 *
 * The contract is structural: all inputs flow in as arguments from the
 * loader. A future drive-by that adds any of these imports would
 * blur the tenant-scope boundary the loader carries.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");

const PURE_MODULES = [
  "src/domains/off-site-authority/types.ts",
  "src/domains/off-site-authority/compute-snapshot.ts",
] as const;

const FORBIDDEN_IDENTIFIERS = [
  "getBusinessConfig",
  "isPlaceholderConfig",
  "readLocalReviews",
  "getConnectorToken",
  "getGoogleConnectorToken",
  "getYelpConnectorToken",
  "currentTenantId",
  "currentTenantSlug",
  "getRepository",
] as const;

const FORBIDDEN_IMPORT_PATHS = [
  "@/lib/business-config",
  "@/lib/local-reviews-store",
  "@/lib/connector-store",
  "@/lib/tenant-context",
  "@/lib/persistence/repositories",
] as const;

function read(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), "utf-8");
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("Architecture — Section 7 C7a pure module purity", () => {
  for (const rel of PURE_MODULES) {
    const active = stripComments(read(rel));

    for (const id of FORBIDDEN_IDENTIFIERS) {
      it(`${rel}: does NOT reference identifier '${id}'`, () => {
        const re = new RegExp(`\\b${id}\\b`);
        expect(active).not.toMatch(re);
      });
    }

    for (const path of FORBIDDEN_IMPORT_PATHS) {
      it(`${rel}: does NOT import from '${path}'`, () => {
        const re = new RegExp(
          `from\\s*["']${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`,
        );
        expect(active).not.toMatch(re);
      });
    }
  }
});
