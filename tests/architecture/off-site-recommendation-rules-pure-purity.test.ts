/**
 * Architecture invariant — Section 7 C7c pure-module purity contract
 * (2026-05-16).
 *
 * Pins that `src/domains/off-site-authority/recommendation-rules.ts`
 * stays as a strict pure-compute module:
 *
 *   1. No imports of global / hybrid-scope helpers:
 *        - getBusinessConfig
 *        - isPlaceholderConfig
 *        - readLocalReviews
 *        - getConnectorToken / getGoogleConnectorToken /
 *          getYelpConnectorToken
 *        - currentTenantId / currentTenantSlug
 *        - getRepository
 *   2. No imports of any connector module, persistence module,
 *      or HTTP client.
 *   3. No LLM-provider identifier in active source.
 *   4. No RUNTIME import from `action-types.ts` (TYPE-ONLY import of
 *      `ActionType` is allowed and required).
 *   5. Allowed imports only:
 *        - type-only `@/domains/recommendations/action-types` (for
 *          the `ActionType` type)
 *        - type-only `./types` (for OffSitePresenceChannel +
 *          OffSitePresenceSnapshot)
 *
 * Together these contracts keep the pure rules safely consumable by
 * the C7c server wrapper without any side-effect at module load.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const RULES = "src/domains/off-site-authority/recommendation-rules.ts";

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
  "OpenAI",
  "Anthropic",
  "BEACON_LLM_PROVIDER",
] as const;

const FORBIDDEN_IMPORT_PATHS = [
  "@/lib/business-config",
  "@/lib/local-reviews-store",
  "@/lib/connector-store",
  "@/lib/tenant-context",
  "@/lib/persistence/repositories",
  "@/lib/persistence/cold-store",
  "next/cache",
] as const;

function read(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), "utf-8");
}
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const ACTIVE = stripComments(read(RULES));

function extractImportLines(src: string): string[] {
  const out: string[] = [];
  const re = /^\s*import\b[\s\S]*?from\s+["']([^"']+)["'][;\s]*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    out.push(m[0]);
  }
  return out;
}

function extractImportPaths(src: string): string[] {
  const out: string[] = [];
  const re = /\bfrom\s+["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    out.push(m[1]);
  }
  return out;
}

describe("Architecture — Section 7 C7c rules module pure-purity", () => {
  for (const id of FORBIDDEN_IDENTIFIERS) {
    it(`recommendation-rules.ts: does NOT reference identifier '${id}'`, () => {
      const re = new RegExp(`\\b${id}\\b`);
      expect(ACTIVE).not.toMatch(re);
    });
  }

  for (const path of FORBIDDEN_IMPORT_PATHS) {
    it(`recommendation-rules.ts: does NOT import from '${path}'`, () => {
      const re = new RegExp(
        `from\\s*["']${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`,
      );
      expect(ACTIVE).not.toMatch(re);
    });
  }

  it("recommendation-rules.ts: every import is restricted to the allowed set", () => {
    const allowedExact = new Set([
      "./types",
      "@/domains/recommendations/action-types",
    ]);
    const paths = extractImportPaths(ACTIVE);
    expect(paths.length).toBeGreaterThan(0);
    for (const p of paths) {
      expect(
        allowedExact.has(p),
        `recommendation-rules.ts imports '${p}', which is not in the allowed set: ${[...allowedExact].join(", ")}`,
      ).toBe(true);
    }
  });

  it("recommendation-rules.ts: import from action-types is TYPE-ONLY (no runtime value)", () => {
    // Runtime imports look like `import { X } from "..."` (with X being
    // a value-name); type-only imports look like
    // `import type { X } from "..."` OR
    // `import { type X } from "..."`. We allow either form.
    const importLines = extractImportLines(ACTIVE).filter((line) =>
      /from\s*["']@\/domains\/recommendations\/action-types["']/.test(line),
    );
    expect(importLines.length).toBeGreaterThan(0);
    for (const line of importLines) {
      // Either the statement starts with `import type` (whole-line
      // type-only) OR every imported binding inside the braces is
      // prefixed with `type` (per-binding type-only).
      const isWholeLineTypeOnly = /^\s*import\s+type\b/.test(line);
      const braceMatch = line.match(/import\s+\{([^}]*)\}\s*from/);
      let allBindingsTypeOnly = false;
      if (braceMatch) {
        const bindings = braceMatch[1]
          .split(",")
          .map((b) => b.trim())
          .filter((b) => b.length > 0);
        allBindingsTypeOnly =
          bindings.length > 0 && bindings.every((b) => /^type\s+/.test(b));
      }
      expect(
        isWholeLineTypeOnly || allBindingsTypeOnly,
        `recommendation-rules.ts: import from action-types must be type-only.\nLine: ${line}`,
      ).toBe(true);
    }
  });

  it("recommendation-rules.ts: import from ./types is TYPE-ONLY (no runtime value)", () => {
    const importLines = extractImportLines(ACTIVE).filter((line) =>
      /from\s*["']\.\/types["']/.test(line),
    );
    expect(importLines.length).toBeGreaterThan(0);
    for (const line of importLines) {
      const isWholeLineTypeOnly = /^\s*import\s+type\b/.test(line);
      const braceMatch = line.match(/import\s+\{([^}]*)\}\s*from/);
      let allBindingsTypeOnly = false;
      if (braceMatch) {
        const bindings = braceMatch[1]
          .split(",")
          .map((b) => b.trim())
          .filter((b) => b.length > 0);
        allBindingsTypeOnly =
          bindings.length > 0 && bindings.every((b) => /^type\s+/.test(b));
      }
      expect(isWholeLineTypeOnly || allBindingsTypeOnly).toBe(true);
    }
  });
});
