/**
 * Architecture invariant — Slice 4.5.B.α₀ recommendation trigger
 * predicate purity (2026-05-19).
 *
 * Source-text scan over every `.ts` file under
 * `src/domains/recommendation-intelligence/triggers/`. Each
 * predicate MUST be a pure function over its inputs — no I/O,
 * no LLM call, no connector import, no Supabase mutation, no
 * Next.js cache layer, no module-level mutable state.
 *
 * Forbidden in active (comment-stripped) source:
 *   • runtime imports of paid-API / connector modules
 *     (`@/lib/connectors/ga4/*` / `gsc/*` / `callrail/*` /
 *      `google-reviews-sync` / `google-auth`)
 *   • Supabase admin / repository imports
 *   • `next/cache` runtime import
 *   • LLM provider imports (OpenAI, Anthropic) or env-flag check
 *     (`BEACON_LLM_PROVIDER`)
 *   • HTTP-client calls (`fetch(`)
 *   • dynamic-import sentinel for cache (` = await import("next/cache")` shape)
 *   • file-system reads (`readFileSync`, `readFile`, `fs.`)
 *
 * Predicates may import: types from `@/domains/pages/types` +
 * `@/domains/prompt-answer-observations/types` +
 * `@/lib/business-config` types (and the pure `getLocationRegex` /
 * `getServiceRegex` helpers which themselves take a passed-in
 * config), `./` siblings in the recommendation-intelligence
 * module tree. Defense-in-depth alongside
 * `recommendation-intelligence-no-queue-write`.
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const TRIGGERS_DIR = resolve(
  REPO_ROOT,
  "src",
  "domains",
  "recommendation-intelligence",
  "triggers",
);

function read(path: string): string {
  return readFileSync(path, "utf-8");
}
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function listTriggerFiles(): string[] {
  const out: string[] = [];
  for (const name of readdirSync(TRIGGERS_DIR)) {
    const full = resolve(TRIGGERS_DIR, name);
    if (statSync(full).isDirectory()) continue;
    if (name.endsWith(".test.ts")) continue;
    if (name.endsWith(".ts")) out.push(full);
  }
  return out.sort();
}

const FORBIDDEN: ReadonlyArray<{ phrase: string; rationale: string }> = [
  { phrase: "@/lib/connectors/", rationale: "Predicates must not import connectors." },
  { phrase: "@/lib/persistence/supabase", rationale: "Predicates must not read Supabase directly." },
  { phrase: "@/lib/persistence/repositories", rationale: "Predicates must not load via repositories." },
  { phrase: "next/cache", rationale: "Predicates are pure; caching happens at the loader boundary." },
  { phrase: "BEACON_LLM_PROVIDER", rationale: "No LLM-provider gates inside a predicate." },
  { phrase: "openaiProvider", rationale: "No OpenAI provider invocations." },
  { phrase: "OpenAI(", rationale: "No OpenAI client construction." },
  { phrase: "Anthropic(", rationale: "No Anthropic client construction." },
  { phrase: "fetch(", rationale: "No HTTP calls in a predicate." },
  { phrase: "readFileSync", rationale: "No file-system reads in a predicate." },
  { phrase: " fs.", rationale: "No fs.* calls in a predicate." },
  { phrase: "google-reviews-sync", rationale: "No connector import (defense in depth)." },
  { phrase: "google-auth", rationale: "No connector import (defense in depth)." },
];

describe("recommendation-trigger-predicates-purity", () => {
  const files = listTriggerFiles();

  it("trigger directory contains at least one predicate file", () => {
    expect(files.length).toBeGreaterThanOrEqual(1);
  });

  it.each(FORBIDDEN)(
    "no trigger predicate contains forbidden phrase: $phrase",
    ({ phrase, rationale }) => {
      const offenders: string[] = [];
      for (const file of files) {
        const active = stripComments(read(file));
        if (active.includes(phrase)) {
          offenders.push(file.replace(REPO_ROOT + "/", ""));
        }
      }
      expect(
        offenders,
        `${phrase} — ${rationale}. Offenders: ${offenders.join(", ")}`,
      ).toEqual([]);
    },
  );

  it("no predicate declares a `let` / `var` at module scope (no mutable module state)", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const active = stripComments(read(file));
      // Match `let` or `var` at the start of a line (after optional
      // `export `) — top-level mutable declarations only. `const`
      // is fine.
      const moduleScopeLetVar = /^(?:export\s+)?(?:let|var)\s+/m.test(active);
      if (moduleScopeLetVar) offenders.push(file.replace(REPO_ROOT + "/", ""));
    }
    expect(
      offenders,
      `Predicates must not hold module-scope mutable state. Offenders: ${offenders.join(", ")}`,
    ).toEqual([]);
  });
});
