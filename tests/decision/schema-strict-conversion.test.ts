/**
 * Strict Structured-Outputs conversion sweep (Slice 3, 2026-07-23).
 *
 * The gateway converts every drafter Zod schema to a strict OpenAI JSON Schema
 * BEFORE any network call; an unsupported construct must fail closed. This pins
 * that EVERY top-level SCHEMA_BY_KIND entry converts cleanly and produces a
 * fully-strict schema (every object: additionalProperties:false + every property
 * required, recursively).
 */

import { describe, it, expect } from "vitest";
import { strictJsonSchemaFor } from "@/domains/decision/llm/gateway";
import { SCHEMA_BY_KIND } from "@/domains/decision/llm/schemas";

/** Walk a converted node: every object is strict + fully-required, recursively. */
function assertFullyStrict(node: Record<string, unknown>, path: string): void {
  if (Array.isArray(node.anyOf)) {
    (node.anyOf as Record<string, unknown>[]).forEach((v, i) => assertFullyStrict(v, `${path}|${i}`));
    return;
  }
  if (node.type === "object") {
    expect(node.additionalProperties, `${path}: additionalProperties must be false`).toBe(false);
    const keys = Object.keys((node.properties ?? {}) as Record<string, unknown>);
    expect(new Set(node.required as string[]), `${path}: every property must be required`).toEqual(new Set(keys));
    for (const k of keys) assertFullyStrict((node.properties as Record<string, Record<string, unknown>>)[k]!, `${path}.${k}`);
  } else if (node.type === "array" && node.items && typeof node.items === "object") {
    assertFullyStrict(node.items as Record<string, unknown>, `${path}[]`);
  }
}

describe("strictJsonSchemaFor — every SCHEMA_BY_KIND entry", () => {
  for (const kind of Object.keys(SCHEMA_BY_KIND) as Array<keyof typeof SCHEMA_BY_KIND>) {
    it(`${kind}: converts with no unsupported construct and is fully strict`, () => {
      const out = strictJsonSchemaFor(SCHEMA_BY_KIND[kind], kind);
      expect("unsupported" in out, `${kind} returned unsupported: ${(out as { unsupported?: string }).unsupported}`).toBe(false);
      if ("unsupported" in out) return;
      expect((out.schema as { type?: string }).type).toBe("object");
      assertFullyStrict(out.schema as Record<string, unknown>, kind);
    });
  }
});
