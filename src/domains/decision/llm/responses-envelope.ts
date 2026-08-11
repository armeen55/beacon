/**
 * llm/responses-envelope (Slice 3, 2026-07-23) - the PURE half of the canonical OpenAI Responses gateway: strict JSON Schema conversion, provider-value
 * normalization, and typed envelope classification. No I/O, no network, no server-only - the transport (gateway.ts) owns budget, breaker, and fetch and imports these helpers.
 *
 * STRICT SUBSET (OpenAI Structured Outputs, verified 2026-07-23): every object carries `additionalProperties: false` and lists EVERY property in `required`;
 * an OPTIONAL Zod property (no default, not nullable) becomes required + nullable in the PROVIDER schema, and `normalizeStructuredValue` strips the emitted
 * `null` back out so the caller's Zod safeParse of the ORIGINAL schema still succeeds. Genuinely nullable fields keep their nulls. A construct the strict
 * subset cannot express returns `{ unsupported }` so the transport fails closed BEFORE any network call - strictness is never weakened to force a schema through.
 */

import { z } from "zod";

/** JSON Schema types the strict subset can express. */
const SUPPORTED_TYPES = new Set(["string", "number", "integer", "boolean", "null", "array", "object"]);

/** Composition keywords outside the strict subset - their presence fails closed. */
const UNSUPPORTED_KEYWORDS = [
  "$ref",
  "$defs",
  "definitions",
  "oneOf",
  "allOf",
  "not",
  "if",
  "then",
  "else",
  "patternProperties",
  "dependentSchemas",
  "prefixItems",
  "additionalItems",
] as const;

class UnsupportedSchemaError extends Error {}

type JsonNode = Record<string, unknown>;

function makeNullable(node: JsonNode): JsonNode {
  if (Array.isArray(node.anyOf)) {
    const variants = node.anyOf as JsonNode[];
    if (variants.some((v) => v && v.type === "null")) return node;
    return { anyOf: [...variants, { type: "null" }] };
  }
  return { anyOf: [node, { type: "null" }] };
}

/**
 * Rebuild a raw JSON-Schema node as a clean strict-subset node, keeping only the keywords the strict subset guarantees (type/properties/required/
 * additionalProperties/items/anyOf/enum/const). Throws UnsupportedSchemaError on any construct outside the subset. `required` on the PARENT decides whether a child property is made nullable.
 */
function buildStrict(node: unknown): JsonNode {
  if (!node || typeof node !== "object" || Array.isArray(node)) {
    throw new UnsupportedSchemaError("non-object schema node");
  }
  const n = node as JsonNode;
  for (const kw of UNSUPPORTED_KEYWORDS) {
    if (kw in n) throw new UnsupportedSchemaError(kw);
  }

  if (Array.isArray(n.anyOf)) {
    return { anyOf: (n.anyOf as unknown[]).map((v) => buildStrict(v)) };
  }
  if (Array.isArray(n.enum)) {
    const out: JsonNode = { enum: n.enum };
    if (typeof n.type === "string") out.type = n.type;
    return out;
  }
  if ("const" in n) {
    const out: JsonNode = { const: n.const };
    if (typeof n.type === "string") out.type = n.type;
    return out;
  }

  const t = n.type;
  if (typeof t !== "string") throw new UnsupportedSchemaError("missing or non-scalar type");
  if (!SUPPORTED_TYPES.has(t)) throw new UnsupportedSchemaError(`type:${t}`);

  if (t === "object") {
    const props = (n.properties && typeof n.properties === "object" ? n.properties : {}) as JsonNode;
    // A record-style object (additionalProperties as a schema, no properties) cannot be expressed strictly.
    if (Object.keys(props).length === 0 && n.additionalProperties && typeof n.additionalProperties === "object") {
      throw new UnsupportedSchemaError("open record object");
    }
    const requiredSet = new Set(Array.isArray(n.required) ? (n.required as string[]) : []);
    const keys = Object.keys(props);
    const outProps: JsonNode = {};
    for (const key of keys) {
      let child = buildStrict(props[key]);
      if (!requiredSet.has(key)) child = makeNullable(child);
      outProps[key] = child;
    }
    return { type: "object", properties: outProps, required: keys, additionalProperties: false };
  }

  if (t === "array") {
    if (!n.items || typeof n.items !== "object" || Array.isArray(n.items)) {
      throw new UnsupportedSchemaError("array without a single item schema");
    }
    return { type: "array", items: buildStrict(n.items) };
  }

  return { type: t };
}

/**
 * Convert a Zod schema into a strict OpenAI Structured-Outputs JSON Schema, or report the exact construct that cannot be expressed. Deterministic and pure.
 */
export function strictJsonSchemaFor(
  schema: z.ZodTypeAny,
  name: string,
): { name: string; schema: Record<string, unknown> } | { unsupported: string } {
  let raw: unknown;
  try {
    // Output mode: `.default()` fields land in `required` with their real type; only truly-optional fields are excluded (and then made nullable below).
    raw = z.toJSONSchema(schema);
  } catch (e) {
    return { unsupported: e instanceof Error ? e.message.slice(0, 120) : "toJSONSchema failed" };
  }
  try {
    const strict = buildStrict(raw);
    if (strict.type !== "object") return { unsupported: "top-level schema must be an object" };
    return { name, schema: strict };
  } catch (e) {
    if (e instanceof UnsupportedSchemaError) return { unsupported: e.message };
    return { unsupported: e instanceof Error ? e.message.slice(0, 120) : "schema conversion failed" };
  }
}

// ── provider value normalization ─────────────────────────────────────────────

type ZodDefLike = { type?: string; innerType?: z.ZodTypeAny; shape?: Record<string, z.ZodTypeAny>; element?: z.ZodTypeAny };

function defOf(schema: z.ZodTypeAny): ZodDefLike {
  // Zod 4 exposes the internal def under `.def` (with `._def` as a fallback).
  return ((schema as unknown as { def?: ZodDefLike; _def?: ZodDefLike }).def ??
    (schema as unknown as { _def?: ZodDefLike })._def ??
    {}) as ZodDefLike;
}

/** Peel wrapper types to the core, recording whether the chain is optional/nullable. */
function unwrap(schema: z.ZodTypeAny): { core: z.ZodTypeAny; optional: boolean; nullable: boolean } {
  let optional = false;
  let nullable = false;
  let cur: z.ZodTypeAny = schema;
  for (let i = 0; i < 24; i++) {
    const d = defOf(cur);
    const t = d.type;
    if (t === "optional") {
      optional = true;
      cur = d.innerType as z.ZodTypeAny;
    } else if (t === "nullable") {
      nullable = true;
      cur = d.innerType as z.ZodTypeAny;
    } else if ((t === "default" || t === "prefault" || t === "catch" || t === "readonly") && d.innerType) {
      cur = d.innerType;
    } else {
      break;
    }
    if (!cur) break;
  }
  return { core: cur, optional, nullable };
}

/**
 * Invert the strict-schema transform for the caller: deep-delete object properties whose value is `null` WHEN the corresponding Zod field is optional
 * and NOT nullable (so the caller's Zod safeParse of the ORIGINAL schema succeeds). Genuinely nullable fields keep their nulls. Pure - returns new containers, never mutates the input.
 */
export function normalizeStructuredValue(value: unknown, schema: z.ZodTypeAny): unknown {
  const { core } = unwrap(schema);
  const d = defOf(core);
  if (d.type === "object" && value && typeof value === "object" && !Array.isArray(value)) {
    const shape = d.shape ?? {};
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const field = shape[k];
      if (!field) {
        out[k] = v;
        continue;
      }
      const f = unwrap(field);
      if (v === null && f.optional && !f.nullable) continue; // drop optional-not-nullable null
      out[k] = normalizeStructuredValue(v, field);
    }
    return out;
  }
  if (d.type === "array" && Array.isArray(value) && d.element) {
    return value.map((item) => normalizeStructuredValue(item, d.element as z.ZodTypeAny));
  }
  return value;
}

// ── envelope classification ──────────────────────────────────────────────────

type EnvelopeClassification =
  | { kind: "text"; text: string }
  | { kind: "refusal" }
  | { kind: "incomplete"; reason: string }
  | { kind: "invalid"; reason: string };

/** Minimal shape we read off the provider envelope (everything else ignored). */
type ResponsesJson = {
  status?: unknown;
  output?: unknown;
  output_text?: unknown;
  incomplete_details?: { reason?: unknown } | null;
};

/**
 * Classify a parsed Responses envelope WITHOUT ever JSON.parsing prose:
 *  - a refusal content part anywhere -> refusal (the model declined);
 *  - status "incomplete" -> incomplete (never read partial text);
 *  - status "completed" -> the message item's `output_text` parts (or the
 *    top-level `output_text` convenience) as the structured text;
 *  - "failed"/unknown status or missing structured output -> invalid.
 */
export function classifyResponsesEnvelope(json: unknown): EnvelopeClassification {
  const j = (json && typeof json === "object" ? json : {}) as ResponsesJson;
  const status = typeof j.status === "string" ? j.status : null;
  const output = Array.isArray(j.output) ? (j.output as Array<Record<string, unknown>>) : [];

  const hasRefusal = output.some(
    (item) =>
      Array.isArray(item?.content) &&
      (item.content as Array<Record<string, unknown>>).some((part) => part?.type === "refusal"),
  );
  if (hasRefusal) return { kind: "refusal" };

  if (status === "incomplete") {
    const reason =
      j.incomplete_details && typeof j.incomplete_details.reason === "string"
        ? j.incomplete_details.reason
        : "incomplete";
    return { kind: "incomplete", reason };
  }

  if (status !== "completed") {
    return { kind: "invalid", reason: status === "failed" ? "failed_status" : `unexpected_status_${status ?? "missing"}` };
  }

  let text: string | null = null;
  for (const item of output) {
    if (item?.type === "message" && Array.isArray(item.content)) {
      const parts = (item.content as Array<Record<string, unknown>>)
        .filter((p) => p?.type === "output_text" && typeof p.text === "string")
        .map((p) => p.text as string);
      if (parts.length > 0) {
        text = parts.join("");
        break;
      }
    }
  }
  if (text === null && typeof j.output_text === "string" && j.output_text.length > 0) {
    text = j.output_text;
  }
  if (text === null || text.length === 0) return { kind: "invalid", reason: "no_structured_output" };
  return { kind: "text", text };
}

/** Pure provenance fields read off the envelope (cost is stamped by the transport). */
export function readProvenanceFields(json: unknown): {
  responseId: string | null;
  servedModel: string | null;
  status: string | null;
  createdAt: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
} {
  const j = (json && typeof json === "object" ? json : {}) as Record<string, unknown>;
  const usage = (j.usage && typeof j.usage === "object" ? j.usage : {}) as Record<string, unknown>;
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return {
    responseId: typeof j.id === "string" ? j.id : null,
    servedModel: typeof j.model === "string" ? j.model : null,
    status: typeof j.status === "string" ? j.status : null,
    createdAt: num(j.created_at),
    inputTokens: num(usage.input_tokens),
    outputTokens: num(usage.output_tokens),
  };
}
