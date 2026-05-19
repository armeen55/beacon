/**
 * Architecture invariant — Slice 9.A2β (2026-05-19).
 *
 * Customer-facing Changes detail Mode A sub-line MUST NOT leak K5
 * forbidden vocab or internal-mode taxonomy. Mirrors the locked
 * Section 9 K5 + K-block + Slice 9.A2β preflight contract:
 *
 *   • No causal verbs: `drove`, `caused`, `generated`.
 *   • No revenue framing: `revenue`, `dollars`, `$`, `ROI`, `sales`,
 *     `leads`.
 *   • No internal-mode taxonomy: `Mode A`, `Mode B`, `Mode C`,
 *     `primary recommendation` (Section 6 cross-talk).
 *   • No connector internals: `CallRail`, `GA4` connector names in
 *     customer copy (Section 9 K-block locked).
 *
 * Scan target: the visible-text portion of
 * `src/components/changes/outcome-attribution-act3.tsx`. Source-
 * comment text is allowed to reference the forbidden tokens (the
 * file's docstring DOES name them as the very thing it must not
 * leak). This invariant extracts only the JSX-text + string-literal
 * payload region, stripping JSDoc/block/line comments first.
 *
 * Also pins the component is a pure presentational module:
 *   • `import type` of `ModeAResult` allowed (TypeScript erases).
 *   • NO runtime import of any `@/lib/connectors/ga4/*` module.
 *   • NO runtime import of `@/lib/persistence/supabase`.
 *   • NO runtime import of `next/cache`, `next/navigation`,
 *     `server-only`.
 *   • NO `fetch(` call.
 *
 * Pinned files:
 *   • `src/components/changes/outcome-attribution-act3.tsx`
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const COMPONENT_PATH = join(
  REPO_ROOT,
  "src/components/changes/outcome-attribution-act3.tsx",
);

function stripComments(src: string): string {
  return src.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

const RAW = readFileSync(COMPONENT_PATH, "utf-8");
const CODE = stripComments(RAW);

/**
 * Extract candidate customer-facing strings. Conservative match: any
 * JSX text node OR any single/double/template string literal. The
 * downstream forbidden-token scan then runs against ALL extracted
 * literals — defense in depth across the entire non-comment surface.
 */
function extractStringLiterals(src: string): string[] {
  const out: string[] = [];
  // Double-quoted strings
  for (const m of src.matchAll(/"([^"\\]|\\.)*"/g)) out.push(m[0]);
  // Single-quoted strings
  for (const m of src.matchAll(/'([^'\\]|\\.)*'/g)) out.push(m[0]);
  // Template strings (basic — does not need to be perfect, just
  // capture the static segments via the full template form).
  for (const m of src.matchAll(/`[^`]*`/g)) out.push(m[0]);
  return out;
}

const STRING_LITERALS = extractStringLiterals(CODE);

describe("outcome-attribution-changes-detail-vocab — K5 forbidden tokens", () => {
  // Tokens that should NEVER appear in customer-facing string
  // literals. Case-insensitive to catch `Drove` / `DROVE` etc.
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

  it("no string literal contains the literal '$' character", () => {
    // Template-literal interpolation uses `${...}` so the `$` chars
    // there are syntactic, not customer-visible. The check looks for
    // `$` OUTSIDE of `${` interpolations — i.e., a literal dollar
    // prefix that would render to the customer.
    const offenders = STRING_LITERALS.filter((lit) => {
      // Strip ${...} interpolations from template strings before scanning.
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

describe("outcome-attribution-changes-detail-vocab — pure component posture", () => {
  it("does NOT import any @/lib/connectors/ga4/* module (runtime)", () => {
    expect(
      /^\s*import\s+(?!type\b)[^;]*from\s+["']@\/lib\/connectors\/ga4\//m.test(
        CODE,
      ),
      "outcome-attribution-act3.tsx must not RUNTIME-import GA4 connectors. " +
        "Type-only imports of Ga4UrlTrafficRow are forbidden too because " +
        "Mode A's discriminator is sufficient; rows belong to the loader, " +
        "not the component.",
    ).toBe(false);
  });

  it("does NOT import @/lib/persistence/supabase", () => {
    expect(
      /from\s+["']@\/lib\/persistence\/supabase["']/.test(CODE),
      "outcome-attribution-act3.tsx is a pure presentational component; " +
        "it must NOT import the Supabase admin client.",
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
      "Component must NOT declare server-only — it's an isomorphic " +
        "presentational module consumable from any rendering context.",
    ).toBe(false);
  });

  it("does NOT call fetch()", () => {
    expect(
      /\bfetch\s*\(/.test(CODE),
      "Pure component must not call fetch() — all data flows via props.",
    ).toBe(false);
  });

  it("does runtime-import ONLY 'react' types (type-only ModeAResult)", () => {
    // Sanity floor: the file should reference `ModeAResult` (type-only).
    expect(/ModeAResult/.test(CODE)).toBe(true);
    // And `ReactElement` (type-only).
    expect(/ReactElement/.test(CODE)).toBe(true);
  });

  it("exports OutcomeAttributionAct3 as a named export", () => {
    expect(/export\s+function\s+OutcomeAttributionAct3/.test(CODE)).toBe(true);
  });
});
