/**
 * Strict Structured-Outputs conversion sweep (Slice 3, 2026-07-23).
 *
 * The gateway converts every drafter Zod schema to a strict OpenAI JSON Schema
 * BEFORE any network call; an unsupported construct must fail closed. This pins
 * that EVERY top-level SCHEMA_BY_KIND entry converts cleanly and produces a
 * fully-strict schema (every object: additionalProperties:false + every property
 * required, recursively). Plus representative normalize round-trips prove the
 * provider-null inversion lets the ORIGINAL Zod schema parse again.
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";
import { strictJsonSchemaFor, normalizeStructuredValue } from "@/domains/decision/llm/gateway";
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

describe("normalizeStructuredValue — representative shape round-trips", () => {
  const RT = z.object({
    req: z.string(),
    opt: z.string().optional(), // optional-not-nullable: provider null stripped
    nul: z.number().nullable(), // genuinely nullable: null kept
    def: z.string().default("d"),
    arr: z.array(z.object({ x: z.number(), y: z.string().optional() })),
    nested: z.object({ a: z.string(), b: z.number().optional() }),
    en: z.enum(["a", "b"]),
  });

  it("strips optional-not-nullable nulls (incl. nested/array), keeps nullable nulls, then the ORIGINAL schema parses", () => {
    const providerShaped = {
      req: "r",
      opt: null,
      nul: null,
      def: "d",
      arr: [{ x: 1, y: null }],
      nested: { a: "a", b: null },
      en: "a",
    };
    const normalized = normalizeStructuredValue(providerShaped, RT) as Record<string, any>;
    expect("opt" in normalized).toBe(false); // optional-not-nullable stripped
    expect(normalized.nul).toBeNull(); // nullable kept
    expect("y" in normalized.arr[0]).toBe(false); // stripped inside array items
    expect("b" in normalized.nested).toBe(false); // stripped inside nested object
    expect(RT.safeParse(normalized).success).toBe(true); // original schema parses
  });
});
