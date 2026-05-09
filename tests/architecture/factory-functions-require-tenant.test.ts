/**
 * Architecture invariant — every Stage D2 factory function (or its
 * exported entry-point opts type) must accept a required `tenantId:
 * string` parameter and fail loud on missing.
 *
 * Stage D2 (2026-05-09) closed the 14 D-b factory paths:
 *   src/lib/import/engine.ts           (mapResultRow, mapChangeRow,
 *                                       mapOpportunityRow, mapCompetitorRow)
 *   src/domains/pages/extractor.ts     (extractPageSnapshot)
 *   src/domains/pages/discover.ts      (discoverPages — opts.tenantId)
 *   src/domains/pages/guardrails.ts    (classifyGuardrails)
 *   src/domains/scanning/detect-findings.ts
 *                                      (generateFindings — opts.tenantId)
 *   src/derivations/snapshot-builder.ts (buildDerivedSnapshots)
 *   src/domains/answer-intelligence/build-index.ts
 *                                      (buildAnswerIntelligenceIndex
 *                                       — opts.tenantId)
 *   src/domains/visibility-events/engine.ts
 *                                      (analyzeVisibilityEvent
 *                                       — opts.tenantId)
 *   src/adapters/profound/bridge.ts    (canonicalSnapshotsToResults,
 *                                       parseChangelogCSVToLegacy,
 *                                       writeLegacyBridge)
 *   src/adapters/profound/benchmark-adapter.ts
 *                                      (parseProfoundBenchmark)
 *   src/adapters/profound/execution-adapter.ts
 *                                      (parseProfoundExecutions)
 *   src/domains/attribution/change-outcome.ts
 *                                      (insightToOutcome)
 *
 * After D2, every one of these functions MUST take a tenantId
 * parameter (or opts.tenantId) and MUST validate it before use. This
 * test pins the contract via static source analysis.
 *
 * If a future PR removes a tenantId param or relaxes the
 * fail-loud guard, this test fails loud. Do not relax this — fix the
 * regression.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");

function readSrc(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), "utf-8");
}

/** Strip TS comments before scanning. */
function stripComments(src: string): string {
  return src
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

type FactoryContract = {
  /** Repo-relative source path. */
  file: string;
  /** Function name as exported (or internal helper called by exports). */
  fn: string;
  /** Whether tenantId is a positional param ("positional") or part of
   *  an opts object ("opts"). */
  shape: "positional" | "opts";
};

const D2_FACTORIES: ReadonlyArray<FactoryContract> = [
  // Positional `tenantId: string` parameter
  { file: "src/lib/import/engine.ts", fn: "mapResultRow", shape: "positional" },
  { file: "src/lib/import/engine.ts", fn: "mapChangeRow", shape: "positional" },
  { file: "src/lib/import/engine.ts", fn: "mapOpportunityRow", shape: "positional" },
  { file: "src/lib/import/engine.ts", fn: "mapCompetitorRow", shape: "positional" },
  { file: "src/domains/pages/extractor.ts", fn: "extractPageSnapshot", shape: "positional" },
  { file: "src/domains/pages/guardrails.ts", fn: "classifyGuardrails", shape: "positional" },
  { file: "src/derivations/snapshot-builder.ts", fn: "buildDerivedSnapshots", shape: "positional" },
  { file: "src/adapters/profound/bridge.ts", fn: "canonicalSnapshotsToResults", shape: "positional" },
  { file: "src/adapters/profound/bridge.ts", fn: "parseChangelogCSVToLegacy", shape: "positional" },
  { file: "src/adapters/profound/benchmark-adapter.ts", fn: "parseProfoundBenchmark", shape: "positional" },
  { file: "src/adapters/profound/execution-adapter.ts", fn: "parseProfoundExecutions", shape: "positional" },
  { file: "src/domains/attribution/change-outcome.ts", fn: "insightToOutcome", shape: "positional" },
  // Opts-object `opts.tenantId: string`
  { file: "src/domains/pages/discover.ts", fn: "discoverPages", shape: "opts" },
  { file: "src/domains/scanning/detect-findings.ts", fn: "generateFindings", shape: "opts" },
  { file: "src/domains/answer-intelligence/build-index.ts", fn: "buildAnswerIntelligenceIndex", shape: "opts" },
  { file: "src/domains/visibility-events/engine.ts", fn: "analyzeVisibilityEvent", shape: "opts" },
];

/** Locate the function declaration's parameter block (between paren depth
 *  0→1 → matching close). Returns null if not found. */
function extractFunctionParamBlock(src: string, fnName: string): string | null {
  const re = new RegExp(
    `(?:export\\s+)?(?:async\\s+)?function\\s+${fnName}\\s*\\(`,
  );
  const match = re.exec(src);
  if (!match) return null;
  let i = match.index + match[0].length;
  let depth = 1;
  const start = i;
  for (; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")") {
      depth--;
      if (depth === 0) return src.slice(start, i);
    }
  }
  return null;
}

/** Locate the function's body (between matching `{` ... `}` after the
 *  signature). Handles return-type annotations of the form `): {...}` by
 *  walking past the type-literal braces before locking onto the body
 *  opening brace. */
function extractFunctionBody(src: string, fnName: string): string | null {
  const re = new RegExp(
    `(?:export\\s+)?(?:async\\s+)?function\\s+${fnName}\\s*\\(`,
  );
  const match = re.exec(src);
  if (!match) return null;
  let i = match.index + match[0].length;
  // Walk past params
  let depth = 1;
  for (; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")") {
      depth--;
      if (depth === 0) {
        i++;
        break;
      }
    }
  }
  // After `)`, the next char (skipping whitespace) is either `:` (return
  // type annotation) or `{` (body) or `=>` (not applicable here). If
  // it's `:`, walk past any type-literal braces before locking on the body.
  while (i < src.length && /\s/.test(src[i])) i++;
  if (src[i] === ":") {
    // Walk through return type. The type can contain `{...}` (object
    // literals), `<...>` (generics), `[]`, `|`, `&`, etc. We bail out
    // once we hit a `{` at depth 0 that's followed (after whitespace)
    // by something that isn't a type member.
    //
    // Pragmatic heuristic: walk past any `{...}` blocks that appear
    // BEFORE the function body. The body's opening `{` is the LAST `{`
    // that has a matching `}` ending at the SAME indentation as the
    // function declaration. Easier: keep eating `{...}` blocks while
    // they're in the type position (no statements between them).
    i++; // past `:`
    // Skip a single type-literal `{...}` block if present (covers both
    // single-line `): X { ... }` and multi-line `): { ... } { ... body`).
    while (i < src.length && /\s/.test(src[i])) i++;
    if (src[i] === "{") {
      // Walk past this brace block (return type literal).
      depth = 1;
      i++;
      for (; i < src.length; i++) {
        if (src[i] === "{") depth++;
        else if (src[i] === "}") {
          depth--;
          if (depth === 0) {
            i++;
            break;
          }
        }
      }
    }
  }
  // Walk to body open brace
  while (i < src.length && src[i] !== "{") i++;
  if (i >= src.length) return null;
  const bodyStart = i;
  depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(bodyStart, i + 1);
    }
  }
  return null;
}

describe("Architecture — D2 factories require tenantId in their signature", () => {
  for (const f of D2_FACTORIES) {
    it(`${f.file} :: ${f.fn} declares ${f.shape === "positional" ? "tenantId: string param" : "opts.tenantId: string"}`, () => {
      const src = stripComments(readSrc(f.file));
      const params = extractFunctionParamBlock(src, f.fn);
      expect(
        params,
        `${f.fn} not found in ${f.file}`,
      ).not.toBeNull();
      // Both shapes contain `tenantId: string` somewhere in the param
      // block — for positional it's a top-level param, for opts it's a
      // field of the opts object literal type.
      expect(
        /\btenantId:\s*string\b/.test(params!),
        `${f.fn} param block does not declare \`tenantId: string\`. ` +
          `Param block:\n${params}`,
      ).toBe(true);
    });
  }
});

describe("Architecture — D2 factories fail loud on missing tenantId", () => {
  for (const f of D2_FACTORIES) {
    it(`${f.file} :: ${f.fn} throws when tenantId is empty/missing`, () => {
      const src = stripComments(readSrc(f.file));
      const body = extractFunctionBody(src, f.fn);
      expect(
        body,
        `${f.fn} body not found in ${f.file}`,
      ).not.toBeNull();
      // Each factory's body must contain a fail-loud check on tenantId.
      // Allowed shapes:
      //   if (!tenantId) throw …
      //   if (!opts.tenantId) throw …
      //   if (tenantId === "") throw …
      const failsLoud =
        /if\s*\(\s*!\s*(?:opts\.)?tenantId\s*\)[\s\S]{0,200}throw/.test(body!) ||
        /if\s*\(\s*(?:opts\.)?tenantId\s*===\s*""\s*\)[\s\S]{0,200}throw/.test(
          body!,
        );
      expect(
        failsLoud,
        `${f.fn} body does not fail loud on missing/empty tenantId. ` +
          `Add a guard like \`if (!tenantId) throw new Error(...)\` at function entry. ` +
          `Body:\n${body!.slice(0, 500)}`,
      ).toBe(true);
    });
  }
});

describe("Architecture — D2 factories never emit `tenant_id: \"\"` literal", () => {
  for (const f of D2_FACTORIES) {
    it(`${f.file} :: ${f.fn} body has no \`tenant_id: ""\` literal`, () => {
      const src = stripComments(readSrc(f.file));
      const body = extractFunctionBody(src, f.fn);
      expect(body).not.toBeNull();
      expect(
        /tenant_id:\s*(?:""|'')/.test(body!),
        `${f.fn} body still contains a \`tenant_id: ""\` literal. ` +
          `Stamp the resolved tenantId directly.`,
      ).toBe(false);
    });
  }
});
