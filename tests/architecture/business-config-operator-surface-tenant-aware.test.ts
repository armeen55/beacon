/**
 * Architecture invariant — MT-3A operator-surface business-config
 * tenant-aware resolution (2026-05-22).
 *
 * MT-1 made business-config tenant-keyed; MT-2 migrated the customer-
 * facing entry files. MT-3A migrates the OPERATOR-facing entry points
 * (settings + diagnostics pages/actions) off the deprecated no-arg
 * `getBusinessConfig()` onto tenant-aware resolution:
 *   - `getBusinessConfig(tenantId)` when tenantId is already in scope, OR
 *   - `await getBusinessConfigForCurrentTenant()` otherwise.
 *
 * This invariant pins, for the explicit allowlist of MT-3A operator
 * entry files (and ONLY those — deep domain/lib helpers + CLI/script
 * paths keep their no-arg fallback until MT-3B/MT-3C/MT-5):
 *   1. NEGATIVE — no no-arg `getBusinessConfig()` call (comment-stripped;
 *      `typeof getBusinessConfig` type usage is allowed — it's not a
 *      no-arg call).
 *   2. POSITIVE — each references `getBusinessConfigForCurrentTenant` OR
 *      `getBusinessConfig(<identifier>)`.
 *
 * Deliberately NOT enforced: a global no-arg ban (MT-5) — the deprecated
 * overload still exists for the un-migrated deep helpers + CLI paths.
 *
 * Protects Customer 2: a regression that reintroduces a process-global /
 * env-default no-arg read into an operator settings or diagnostics
 * surface — which could show one tenant's config to another operator
 * context — trips here.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");

// Operator entries that still consume business config. The Connectors page was
// removed from this list when its last config-backed (hidden Yelp) prop was
// deleted; a file that no longer reads config cannot regress to an ambient read.
const MIGRATED_OPERATOR_FILES = [
  "src/app/(shell)/settings/connectors/actions.ts",
  "src/app/(shell)/settings/config/actions.ts",
  "src/app/(shell)/settings/config/page.tsx",
  "src/app/(shell)/diagnostics/page.tsx",
  "src/app/(shell)/diagnostics/recommendation-triggers/page.tsx",
  "src/app/(shell)/diagnostics/recommendation-triggers/actions.ts",
  "src/app/(shell)/diagnostics/repeat-citation/page.tsx",
  "src/app/(shell)/diagnostics/indexability/page.tsx",
];

/** Line comments stripped FIRST, then block comments — survives a line
 *  comment that legitimately contains a block-open marker. */
function stripComments(src: string): string {
  return src
    .replace(/^[ \t]*\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

const NO_ARG_CALL = /getBusinessConfig\(\s*\)/;
const TENANT_ARG_CALL = /getBusinessConfig\(\s*[A-Za-z_$]/;

describe("business-config-operator-surface-tenant-aware (MT-3A)", () => {
  it("all allowlisted config-consuming operator entry files exist on disk", () => {
    for (const rel of MIGRATED_OPERATOR_FILES) {
      expect(
        existsSync(resolve(REPO_ROOT, rel)),
        `expected migrated operator entry file to exist: ${rel}`,
      ).toBe(true);
    }
  });

  describe("each operator entry uses tenant-aware resolution", () => {
    for (const rel of MIGRATED_OPERATOR_FILES) {
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

  it("does NOT globally ban no-arg getBusinessConfig (deep helpers + CLI paths still rely on it until MT-5)", () => {
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
