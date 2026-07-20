/**
 * Architecture invariant — MT-2 Customer-facing business-config
 * tenant-aware resolution (2026-05-22).
 *
 * MT-1 made `business-config` tenant-keyed and added
 * `getBusinessConfigForCurrentTenant()` (the request-scoped entry) + a
 * DEPRECATED no-arg `getBusinessConfig()` overload (resolves
 * `BEACON_TENANT_ID`, kept so consumers stay green during the
 * migration). MT-2 migrates the customer-facing ENTRY files to resolve
 * config tenant-aware:
 *   - `getBusinessConfig(tenantId)` when tenantId is already in scope, OR
 *   - `await getBusinessConfigForCurrentTenant()` otherwise.
 *
 * This invariant pins, for the explicit allowlist of customer-facing
 * entry files (and ONLY those — deeper domain/lib helpers keep their
 * no-arg fallback until MT-3):
 *   1. NEGATIVE — no no-arg `getBusinessConfig()` call (comment-stripped
 *      active source; the deprecated overload still EXISTS for MT-3
 *      consumers, it's just forbidden in these customer entries).
 *   2. POSITIVE — each file references the tenant-aware form:
 *      `getBusinessConfigForCurrentTenant` OR `getBusinessConfig(<ident>)`.
 *   3. CARRY-FORWARD — rendered customer-surface components
 *      (`src/components/{today,recommendations,changes,prompts,local}/**`)
 *      reference neither `@/lib/business-config` nor
 *      `getBusinessConfigForCurrentTenant`; they receive config via props.
 *
 * Deliberately NOT enforced (per MT-2 scope):
 *   - NO global ban on no-arg `getBusinessConfig()` (MT-5 removes the
 *     deprecated overload entirely; MT-3 expands the allowlist to
 *     operator/diagnostic/settings + deep helpers first).
 *
 * Protects Customer 2: a regression that reintroduces a process-global /
 * env-default no-arg read into a customer-facing entry — bleeding one
 * tenant's config into another's surface — trips here.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");

// The customer-facing entry files migrated in MT-2 (today-data.ts was one
// of the original 8; deleted 2026-07-01, FINAL PREMIUM PLAN item 101).
// Surface collapse + dead-body removal (2026-07-20): src/app/(shell)/
// changes/[id]/page.tsx was collapsed to a resolve-and-redirect route and no
// longer resolves business config (the getBusinessConfig call lived in the
// deleted v2 brief body). It is therefore no longer a business-config
// customer surface and was removed from this allowlist.
const MIGRATED_ENTRY_FILES = [
  "src/domains/off-site-authority/load-snapshot.ts",
  "src/domains/today/visibility-read-model.ts",
  "src/app/(shell)/today-v2-data.ts",
  "src/app/(shell)/local/page.tsx",
  "src/lib/local-presence.ts",
];

// Rendered customer-surface component trees (config flows via props).
const CUSTOMER_COMPONENT_DIRS = [
  "today",
  "recommendations",
  "changes",
  "prompts",
  "local",
].map((d) => resolve(REPO_ROOT, "src", "components", d));

/**
 * Strip leading line comments FIRST, then block comments.
 *
 * Order matters: a line comment can legitimately contain a
 * block-open marker (e.g. a glob path like dot-data slash star
 * dot json). Block-stripping first would treat that stray opener as
 * a real comment start and eat code down to the next block-close
 * marker. Removing leading line-comment lines first eliminates the
 * phantom opener. Only lines that START with the line-comment marker
 * (after whitespace) are removed, so inline URLs inside block
 * comments are preserved.
 */
function stripComments(src: string): string {
  return src
    .replace(/^[ \t]*\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

function walkTsFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = resolve(dir, name);
    if (statSync(full).isDirectory()) out.push(...walkTsFiles(full));
    else if (name.endsWith(".ts") || name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

const NO_ARG_CALL = /getBusinessConfig\(\s*\)/;
// A call with a non-empty argument starting with an identifier char.
const TENANT_ARG_CALL = /getBusinessConfig\(\s*[A-Za-z_$]/;

describe("business-config-customer-surface-tenant-aware (MT-2)", () => {
  it("all 8 allowlisted entry files exist on disk", () => {
    for (const rel of MIGRATED_ENTRY_FILES) {
      expect(
        existsSync(resolve(REPO_ROOT, rel)),
        `expected migrated entry file to exist: ${rel}`,
      ).toBe(true);
    }
  });

  describe("each customer-facing entry uses tenant-aware resolution", () => {
    for (const rel of MIGRATED_ENTRY_FILES) {
      it(`${rel} — no no-arg getBusinessConfig() (comment-stripped)`, () => {
        const active = stripComments(
          readFileSync(resolve(REPO_ROOT, rel), "utf-8"),
        );
        expect(
          NO_ARG_CALL.test(active),
          `${rel} must not call no-arg getBusinessConfig() — use getBusinessConfig(tenantId) or getBusinessConfigForCurrentTenant().`,
        ).toBe(false);
      });

      it(`${rel} — references the tenant-aware form`, () => {
        const active = stripComments(
          readFileSync(resolve(REPO_ROOT, rel), "utf-8"),
        );
        const usesWrapper = active.includes("getBusinessConfigForCurrentTenant");
        const usesTenantArg = TENANT_ARG_CALL.test(active);
        expect(
          usesWrapper || usesTenantArg,
          `${rel} must reference getBusinessConfigForCurrentTenant() or getBusinessConfig(<tenantId>).`,
        ).toBe(true);
      });
    }
  });

  it("carry-forward: rendered customer-surface components do not reference business-config", () => {
    const offenders: string[] = [];
    for (const dir of CUSTOMER_COMPONENT_DIRS) {
      for (const file of walkTsFiles(dir)) {
        const src = readFileSync(file, "utf-8");
        if (
          src.includes("getBusinessConfigForCurrentTenant") ||
          /from\s+["']@\/lib\/business-config["']/.test(src)
        ) {
          offenders.push(file.replace(REPO_ROOT + "/", ""));
        }
      }
    }
    expect(
      offenders,
      `Rendered customer-surface components must receive config via props from loaders, never reference the business-config resolver:\n${offenders.map((f) => `  - ${f}`).join("\n")}`,
    ).toEqual([]);
  });

  it("does NOT globally ban no-arg getBusinessConfig (MT-3 deep helpers + MT-1 deprecated overload still rely on it)", () => {
    // Sanity: the deprecated overload is still declared in core. This
    // invariant intentionally scopes the ban to customer entries only.
    const core = readFileSync(
      resolve(REPO_ROOT, "src", "lib", "business-config.ts"),
      "utf-8",
    );
    expect(core.includes("@deprecated")).toBe(true);
    expect(
      /export function getBusinessConfig\(\):\s*BusinessConfig;/.test(core),
      "deprecated no-arg overload must remain until MT-5",
    ).toBe(true);
  });
});
