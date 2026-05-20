/**
 * Architecture invariant — Section 9 Today tile (2026-05-19).
 *
 * Customer-facing Today tile `EditOutcomesTile` MUST NOT leak K5
 * forbidden vocab, internal-mode taxonomy, OR connector-internal
 * names. Mirrors the locked Section 9 K5 + Section 9.5 + Slice 9
 * Today tile preflight contract.
 *
 *   • No causal verbs: `drove`, `caused`, `generated`.
 *   • No revenue framing: `revenue`, `dollars`, `$`, `ROI`, `sales`,
 *     `leads`.
 *   • No internal-mode taxonomy: `Mode A`, `Mode B`, `Mode C`,
 *     `primary recommendation` (Section 6 cross-talk).
 *   • No connector-internal names: `Google Analytics`, `GA4`,
 *     `CallRail` (customer-facing surfaces never expose connector
 *     internals per Section 9 K5).
 *
 * Scan target: string literals inside
 * `src/components/today/edit-outcomes-tile.tsx`. The file's docstring
 * narrative DOES reference these tokens by name (that's the contract
 * it's documenting); the scan extracts only string-literal payload
 * region, stripping JSDoc/block/line comments first.
 *
 * Also pins the component is a pure presentational module:
 *   • Type-only import of `OutcomesSummary` allowed.
 *   • NO runtime import of any `@/lib/connectors/ga4/*` module.
 *   • NO runtime import of `@/lib/persistence/supabase`.
 *   • NO runtime import of `next/cache`, `next/navigation`.
 *   • NO `import "server-only";` declaration (isomorphic component).
 *   • NO `fetch(` call.
 *
 * Pinned file:
 *   • `src/components/today/edit-outcomes-tile.tsx`
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const COMPONENT_PATH = join(
  REPO_ROOT,
  "src/components/today/edit-outcomes-tile.tsx",
);

function stripComments(src: string): string {
  return src.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

const RAW = readFileSync(COMPONENT_PATH, "utf-8");
const CODE = stripComments(RAW);

/**
 * Extract candidate customer-facing string literals. Conservative
 * match: double-quoted, single-quoted, and (non-nested) template
 * literals. The downstream forbidden-token scan runs against ALL
 * extracted literals — defense in depth across the entire non-comment
 * surface.
 */
function extractStringLiterals(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/"([^"\\]|\\.)*"/g)) out.push(m[0]);
  for (const m of src.matchAll(/'([^'\\]|\\.)*'/g)) out.push(m[0]);
  for (const m of src.matchAll(/`[^`]*`/g)) out.push(m[0]);
  return out;
}

const STRING_LITERALS = extractStringLiterals(CODE);

describe("edit-outcomes-tile-vocab — K5 forbidden tokens + connector names", () => {
  const FORBIDDEN_TOKENS_CASE_INSENSITIVE = [
    "drove",
    "caused",
    "generated",
    "revenue",
    "dollars",
    "ROI",
    "sales",
    "leads",
    "Mode A",
    "Mode B",
    "Mode C",
    "primary recommendation",
    "Google Analytics",
    "GA4",
    "CallRail",
  ];

  for (const token of FORBIDDEN_TOKENS_CASE_INSENSITIVE) {
    it(`no string literal contains "${token}" (case-insensitive)`, () => {
      const lower = token.toLowerCase();
      const offenders = STRING_LITERALS.filter((lit) =>
        lit.toLowerCase().includes(lower),
      );
      expect(
        offenders,
        `Forbidden token "${token}" found in string literal(s):\n` +
          offenders.map((o) => `  - ${o}`).join("\n"),
      ).toEqual([]);
    });
  }

  it("no string literal contains the literal '$' character (outside template interpolations)", () => {
    const offenders = STRING_LITERALS.filter((lit) => {
      const withoutInterp = lit.replace(/\$\{[^}]*\}/g, "");
      return withoutInterp.includes("$");
    });
    expect(
      offenders,
      `Literal '$' found in:\n` +
        offenders.map((o) => `  - ${o}`).join("\n"),
    ).toEqual([]);
  });
});

describe("edit-outcomes-tile-vocab — pure component posture", () => {
  it("does NOT runtime-import any @/lib/connectors/ga4/* module", () => {
    expect(
      /^\s*import\s+(?!type\b)[^;]*from\s+["']@\/lib\/connectors\/ga4\//m.test(
        CODE,
      ),
      "edit-outcomes-tile.tsx must not RUNTIME-import GA4 connectors.",
    ).toBe(false);
  });

  it("does NOT import @/lib/persistence/supabase", () => {
    expect(
      /from\s+["']@\/lib\/persistence\/supabase["']/.test(CODE),
      "Component must not import the Supabase admin client.",
    ).toBe(false);
  });

  it("does NOT import next/cache or next/navigation", () => {
    expect(
      /from\s+["']next\/cache["']/.test(CODE),
      "Component must not import next/cache — caching belongs in the loader.",
    ).toBe(false);
    expect(
      /from\s+["']next\/navigation["']/.test(CODE),
      "Component must not import next/navigation — pure presentational.",
    ).toBe(false);
  });

  it("does NOT declare 'server-only'", () => {
    expect(
      /^import\s+["']server-only["']/m.test(RAW),
      "Component must NOT declare server-only — isomorphic presentational module.",
    ).toBe(false);
  });

  it("does NOT call fetch()", () => {
    expect(
      /\bfetch\s*\(/.test(CODE),
      "Pure component must not call fetch() — all data flows via props.",
    ).toBe(false);
  });

  it("type-only imports OutcomesSummary + ReactElement", () => {
    expect(/OutcomesSummary/.test(CODE)).toBe(true);
    expect(/ReactElement/.test(CODE)).toBe(true);
  });

  it("exports EditOutcomesTile as a named export", () => {
    expect(/export\s+function\s+EditOutcomesTile/.test(CODE)).toBe(true);
  });
});
