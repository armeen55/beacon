/**
 * Architecture invariant — Slice 4.5.B.α₀ no-LLM-decides-existence
 * contract (2026-05-19).
 *
 * Every action type with `generatorActive: true` in the registry
 * MUST have a deterministic generator path. α₀ rule:
 *
 *   • `edit_title`, `add_h2_section`, `add_faq` — historically
 *     active; deterministic generator lives in
 *     `src/domains/recommendations/providers/deterministic.ts`.
 *     This invariant only checks the file exists and references
 *     each historically-active action type.
 *   • `edit_meta` — flipped in Slice 4.5.B.α₀. Satisfied by a
 *     trigger predicate under
 *     `src/domains/recommendation-intelligence/triggers/` whose
 *     emitted candidate carries `action_type: "edit_meta"`.
 *
 * The invariant intentionally does NOT require inactive new
 * types (`update_intro`, `add_h3_section`, `add_image_alt_text`)
 * to have predicates yet — those flip in later slices alongside
 * their paired predicates.
 *
 * Defense in depth: blocking a future PR that flips a flag without
 * shipping a paired generator (deterministic or trigger predicate
 * emitting that action_type).
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

import {
  ACTION_TYPES,
  ACTION_TYPE_REGISTRY,
  type ActionType,
} from "@/domains/recommendations/action-types";

const REPO_ROOT = resolve(__dirname, "..", "..");
const TRIGGERS_DIR = resolve(
  REPO_ROOT,
  "src",
  "domains",
  "recommendation-intelligence",
  "triggers",
);
const DETERMINISTIC_PROVIDER = resolve(
  REPO_ROOT,
  "src",
  "domains",
  "recommendations",
  "providers",
  "deterministic.ts",
);

/** Action types deemed historically active (covered by the existing
 *  deterministic provider). α₀ extends this set with `edit_meta`,
 *  which is satisfied by a trigger predicate instead. */
const HISTORICAL_DETERMINISTIC: ReadonlySet<ActionType> = new Set<ActionType>([
  "edit_title",
  "add_h2_section",
  "add_faq",
]);

function read(path: string): string {
  return readFileSync(path, "utf-8");
}

function predicateFiles(): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(TRIGGERS_DIR)) {
    const full = resolve(TRIGGERS_DIR, entry);
    if (statSync(full).isDirectory()) continue;
    if (entry.endsWith(".test.ts")) continue;
    if (!entry.endsWith(".ts")) continue;
    out.push(full);
  }
  return out;
}

/** Pull every action-type literal referenced by a predicate source
 *  file. Accepts both `action_type: "<value>"` (object literal) and
 *  `actionType = "<value>" as const` (variable binding) shapes. */
function extractActionTypeLiterals(src: string): Set<string> {
  const out = new Set<string>();
  const objectShape = /action_type:\s*["']([a-z0-9_]+)["']/g;
  const variableShape =
    /actionType\s*=\s*["']([a-z0-9_]+)["'](?:\s+as\s+const)?/g;
  let m: RegExpExecArray | null;
  while ((m = objectShape.exec(src)) != null) out.add(m[1]!);
  while ((m = variableShape.exec(src)) != null) out.add(m[1]!);
  return out;
}

describe("recommendation-intelligence-no-llm-decides", () => {
  const activeTypes: ActionType[] = ACTION_TYPES.filter(
    (t) => ACTION_TYPE_REGISTRY[t].generatorActive === true,
  );

  it("at least one action type is active", () => {
    expect(activeTypes.length).toBeGreaterThanOrEqual(1);
  });

  it("every historically deterministic action type is referenced in providers/deterministic.ts", () => {
    const src = read(DETERMINISTIC_PROVIDER);
    for (const t of HISTORICAL_DETERMINISTIC) {
      // The deterministic provider must reference each historical
      // active type somewhere in its source (generator names like
      // `generateEditTitle` / `generateAddH2Section` / `generateAddFaq`
      // imply the action types via naming convention; we relax to a
      // case-insensitive substring scan because the canonical names
      // there are camelCased, not snake_cased).
      const camel = t.replace(/_([a-z])/g, (_m, c) => c.toUpperCase());
      const ok = src.includes(t) || src.toLowerCase().includes(camel.toLowerCase());
      expect(ok, `deterministic provider must reference ${t}`).toBe(true);
    }
  });

  it("every active action type NOT in the historical deterministic set has a paired trigger predicate emitting it", () => {
    const predicateSources = predicateFiles().map(read);
    const emittedTypes = new Set<string>();
    for (const src of predicateSources) {
      for (const t of extractActionTypeLiterals(src)) emittedTypes.add(t);
    }
    const unpaired: string[] = [];
    for (const t of activeTypes) {
      if (HISTORICAL_DETERMINISTIC.has(t)) continue;
      if (!emittedTypes.has(t)) unpaired.push(t);
    }
    expect(
      unpaired,
      `Active action types without a paired trigger predicate: ${unpaired.join(", ")}`,
    ).toEqual([]);
  });
});
