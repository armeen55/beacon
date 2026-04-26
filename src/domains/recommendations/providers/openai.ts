/**
 * Sprint 6A.2b (2026-04-26) — OpenAI SpecificEditProvider implementation.
 *
 * Real LLM call via raw `fetch` — mirrors the Phase v7 page-intent
 * adjudicator pattern at `src/domains/recommendations/adjudicate.ts` so
 * we don't add a new SDK dependency. Cost accounting + structured-output
 * JSON schema + safe error handling all reuse that proven shape.
 *
 * Hard rules (locked by tests):
 *   - `openaiProvider.generate(packet)` returns a `SpecificEditBundle`.
 *     During Vitest, calling without an explicit `fetchImpl` throws
 *     fail-loud — protects against accidental real network calls in
 *     test suites.
 *   - Missing `OPENAI_API_KEY` throws BEFORE any network code runs.
 *   - Vercel build (`VERCEL=1`) blocks the call unless explicitly
 *     unblocked via `BEACON_LLM_BUILD_OK=1`. Build-time LLM calls are
 *     never the right move.
 *   - Non-config failures (timeout, 5xx, malformed JSON, parse error,
 *     model refusal) return an EMPTY bundle. The deterministic provider
 *     keeps producing baseline output; we never throw mid-flow and
 *     break the pipeline.
 *   - JSON schema is strict-mode, decoder-enforced. `actionType` and
 *     `targetUrl` are enums drawn from the packet — URL hallucination
 *     is structurally impossible.
 *   - Provider stamps `source = "openai"`, `providerName = "openai"`,
 *     and `model` on every emitted edit.
 *   - `costUsd` per edit = total bundle cost / N edits (deterministic
 *     split, rounded to 6 decimal places). `totalCostUsd` carries the
 *     unrounded sum.
 *
 * 6A.2b is provider-only. NO `runProviderAndPersist` integration. NO
 * caller cascade. NO CLI flag yet. NO budget plumbing yet — the budget
 * gate lives one layer up in 6A.2c so the provider stays a pure
 * packet → bundle transform.
 */

import type {
  SpecificEdit,
  SpecificEditBundle,
  SpecificEditConfidence,
  SpecificEditDifficulty,
  SpecificEditEvidenceRef,
  SpecificEditProvider,
  SpecificEditTargetElement,
} from "../specific-edit-provider";
import { emptyBundleFor } from "../specific-edit-provider";
import type { SpecificEditEvidencePacket } from "../specific-edit-evidence";
import type { ActionType } from "../action-types";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Default model. Match the page-intent adjudicator so cost/quality
 * profiles stay aligned. Override via `options.model` in tests.
 */
export const DEFAULT_OPENAI_MODEL = "gpt-5-mini";

/** Per-million-token rates (USD). Verified against OpenAI pricing 2026-04-23. */
const COST_PER_MILLION = {
  "gpt-5-mini": { input: 0.25, output: 2.0 },
  "gpt-5-nano": { input: 0.05, output: 0.4 },
  "gpt-5.4-mini": { input: 0.75, output: 4.5 },
} as const;

const OPENAI_CHAT_API = "https://api.openai.com/v1/chat/completions";

/** Default request timeout (ms). */
const DEFAULT_TIMEOUT_MS = 30_000;

const SYSTEM_PROMPT = `
You are Beacon's Specific Edit Generator.

You receive ONE evidence packet describing a recommendation already
resolved to an action and a target URL. You produce a list of concrete
edits the operator can ship: title rewrites, new H2 sections, FAQ
additions, schema changes, etc. Every edit MUST be grounded in the
packet — no outside knowledge.

HARD RULES:

1. actionType MUST be one of allowedActionTypes (enum-enforced).
2. targetUrl MUST be one of allowedTargetUrls (enum-enforced).
3. evidence[] MUST cite at least one packet reference per edit.
4. Do NOT invent URLs, prompts, competitors, or page elements.
5. If you have no honest output for this packet, return an empty
   recommendations array. It is better to return [] than to invent.
6. When uncertain, set confidence="low". Operator review will catch
   low-confidence edits — DO NOT escalate confidence to make the row
   pass review.
7. proposedText / currentText must be plain strings or null. No
   markdown, no HTML — the persistence layer expects raw text.

OPERATOR-FACING COPY:
- why: 1-2 sentences. Name the specific evidence (prompt id, owned URL,
  competitor name) that drove this edit.
- expectedImpact: short concrete statement OR null when there is no
  honest signal to claim. NEVER promise traffic, ranks, or uplift.
- measurementPlan: how the operator will tell whether this edit moved
  visibility — short noun phrase or null.
- risks: array of strings. Empty array = no notable risks.

Output ONLY valid JSON matching the schema. No prose, no markdown
fences, no explanation.
`;

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export type GenerateOpenAIBundleOptions = {
  /** Override `fetch` for tests + any non-default callers. REQUIRED in
   *  vitest — see vitest-detection guard below. */
  fetchImpl?: typeof fetch;
  /** Override model. Defaults to DEFAULT_OPENAI_MODEL. */
  model?: string;
  /** Frozen `now` for deterministic timestamps in tests. */
  now?: Date;
  /** Override timeout. Defaults to DEFAULT_TIMEOUT_MS. */
  timeoutMs?: number;
};

/**
 * Wider entry point: same behavior as `openaiProvider.generate` but with
 * an explicit `options` arg for tests / CLI / 6A.2c integration.
 *
 * Returns an empty bundle (with `providerName: "openai"`) on any
 * non-config failure. Throws ONLY when:
 *   - vitest is running and no `fetchImpl` was supplied
 *   - `process.env.VERCEL === "1"` (without `BEACON_LLM_BUILD_OK=1`)
 *   - `OPENAI_API_KEY` is missing
 *
 * The narrow `SpecificEditProvider.generate(packet)` interface wraps
 * this with no options.
 */
export async function generateOpenAIBundle(
  packet: SpecificEditEvidencePacket,
  options: GenerateOpenAIBundleOptions = {},
): Promise<SpecificEditBundle> {
  // ── 0. Test-environment safety gate ─────────────────────────────────
  // Vitest sets VITEST=true by default. If we're in a test run AND no
  // fetchImpl was supplied, refuse — accidental network calls during
  // test suites are exactly what this guard prevents.
  if (process.env.VITEST === "true" && !options.fetchImpl) {
    throw new Error(
      "[openai-provider] fetchImpl is required during vitest runs. " +
        "Mock fetchImpl explicitly to avoid accidental real network calls.",
    );
  }

  // ── 0b. Build-environment safety gate ───────────────────────────────
  // Vercel build never has a legitimate reason to call the LLM. Throw
  // unless explicitly unblocked.
  if (
    process.env.VERCEL === "1" &&
    process.env.BEACON_LLM_BUILD_OK !== "1"
  ) {
    throw new Error(
      "[openai-provider] refusing to call OpenAI during Vercel build. " +
        "If this is intentional, set BEACON_LLM_BUILD_OK=1.",
    );
  }

  // ── 1. Required config ──────────────────────────────────────────────
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "[openai-provider] OPENAI_API_KEY is not set. Either set the env " +
        "var or use the deterministic provider via BEACON_LLM_PROVIDER unset.",
    );
  }

  const model = options.model ?? DEFAULT_OPENAI_MODEL;
  const now = options.now ?? new Date();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;

  // ── 2. Build request body with packet-derived strict schema ─────────
  const schema = buildOpenAISpecificEditSchema(packet);
  const body = JSON.stringify({
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT.trim() },
      {
        role: "user",
        content: `Evidence packet:\n${JSON.stringify(packet, null, 2)}`,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "specific_edit_bundle",
        strict: true,
        schema,
      },
    },
    max_completion_tokens: 4_000,
  });

  // ── 3. Network call ────────────────────────────────────────────────
  let response: Response;
  try {
    response = await fetchImpl(OPENAI_CHAT_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    // Timeout / network error / abort. Return empty bundle.
    return emptyBundleFor(packet, "openai", now);
  }

  if (!response.ok) {
    return emptyBundleFor(packet, "openai", now);
  }

  // ── 4. Parse ────────────────────────────────────────────────────────
  type OpenAIChatResponse = {
    choices?: Array<{
      message?: { content?: string | null; refusal?: string | null };
      finish_reason?: string;
    }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  let data: OpenAIChatResponse;
  try {
    data = (await response.json()) as OpenAIChatResponse;
  } catch {
    return emptyBundleFor(packet, "openai", now);
  }

  const choice = data.choices?.[0];
  if (choice?.message?.refusal) {
    return emptyBundleFor(packet, "openai", now);
  }
  const content = choice?.message?.content;
  if (!content) {
    return emptyBundleFor(packet, "openai", now);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return emptyBundleFor(packet, "openai", now);
  }

  const recommendations = extractRecommendations(parsed);
  if (!recommendations) {
    return emptyBundleFor(packet, "openai", now);
  }

  // ── 5. Cost computation ─────────────────────────────────────────────
  const inputTokens = data.usage?.prompt_tokens ?? 0;
  const outputTokens = data.usage?.completion_tokens ?? 0;
  const totalCostUsd = estimateCost(model, inputTokens, outputTokens);

  // Deterministic split: total / N, rounded to 6 decimal places. The
  // unrounded sum lives in `totalCostUsd`. Rejected/dedup edits in the
  // persistence layer don't refund — that's intentional; the call
  // already happened.
  const perEditCost =
    recommendations.length > 0
      ? round6(totalCostUsd / recommendations.length)
      : 0;

  // ── 6. Map to SpecificEdit shape with provider provenance ───────────
  const edits: SpecificEdit[] = recommendations.map((r) => ({
    actionType: r.actionType,
    targetUrl: r.targetUrl,
    targetElement: r.targetElement,
    why: r.why,
    evidence: r.evidence,
    expectedImpact: r.expectedImpact,
    difficulty: r.difficulty,
    confidence: r.confidence,
    measurementPlan: r.measurementPlan,
    risks: r.risks,
    source: "openai",
    providerName: "openai",
    model,
    costUsd: perEditCost,
  }));

  return {
    schemaVersion: "specific-edit-bundle/v1",
    generatedAt: now.toISOString(),
    tenantId: packet.tenantId,
    recId: packet.recId,
    evidenceHash: packet.evidenceHash,
    providerName: "openai",
    recommendations: edits,
    totalCostUsd,
  };
}

/**
 * The `SpecificEditProvider` contract. Calls into `generateOpenAIBundle`
 * with no options; the wider entry point exists for tests + 6A.2c.
 */
export const openaiProvider: SpecificEditProvider = {
  name: "openai",
  async generate(
    packet: SpecificEditEvidencePacket,
  ): Promise<SpecificEditBundle> {
    return generateOpenAIBundle(packet, {});
  },
};

// ---------------------------------------------------------------------------
// JSON schema builder — exported for tests
// ---------------------------------------------------------------------------

type JsonSchemaValue =
  | { type: "string"; enum?: string[]; maxLength?: number }
  | { type: "number"; minimum?: number; maximum?: number }
  | { type: "integer" }
  | { type: "boolean" }
  | { type: "null" }
  | { type: "array"; items: JsonSchemaValue; minItems?: number; maxItems?: number }
  | {
      type: "object";
      properties: Record<string, JsonSchemaValue>;
      required: string[];
      additionalProperties: false;
    }
  | { anyOf: JsonSchemaValue[] };

/**
 * Build the strict-mode JSON schema OpenAI uses to constrain the
 * provider response. `actionType` and `targetUrl` are enum-bound to
 * the packet — the decoder cannot generate values outside the
 * allowed sets.
 *
 * The schema mirrors the `SpecificEdit` shape minus provider-stamped
 * fields (`source`, `providerName`, `model`, `costUsd`) — we stamp
 * those after parsing.
 */
export function buildOpenAISpecificEditSchema(
  packet: SpecificEditEvidencePacket,
): JsonSchemaValue {
  const allowedTargetUrls: string[] = [...packet.allowedTargetUrls];
  // The packet may or may not include the sentinel; mirror what the
  // validator + persistence layer accept.
  if (!allowedTargetUrls.includes("needs_new_page")) {
    allowedTargetUrls.push("needs_new_page");
  }

  const evidenceRefSchema: JsonSchemaValue = {
    anyOf: [
      object({
        type: stringEnum(["prompt"]),
        promptId: { type: "string" },
      }),
      object({
        type: stringEnum(["element"]),
        elementKey: { type: "string" },
        url: { type: "string" },
      }),
      object({
        type: stringEnum(["owned_page"]),
        url: { type: "string" },
      }),
      object({
        type: stringEnum(["competitor"]),
        competitorName: { type: "string" },
      }),
      object({
        type: stringEnum(["prior_outcome"]),
        actionType: stringEnum(packet.allowedActionTypes),
      }),
    ],
  };

  const targetElementSchema: JsonSchemaValue = {
    anyOf: [
      { type: "null" },
      object({
        elementKey: { type: "string" },
        displayLabel: { type: "string" },
        currentText: { anyOf: [{ type: "string", maxLength: 4000 }, { type: "null" }] },
        proposedText: { anyOf: [{ type: "string", maxLength: 4000 }, { type: "null" }] },
      }),
    ],
  };

  const editSchema: JsonSchemaValue = object({
    actionType: stringEnum(packet.allowedActionTypes),
    targetUrl: stringEnum(allowedTargetUrls),
    targetElement: targetElementSchema,
    why: { type: "string", maxLength: 500 },
    evidence: {
      type: "array",
      items: evidenceRefSchema,
      minItems: 1,
      maxItems: 6,
    },
    expectedImpact: {
      anyOf: [{ type: "string", maxLength: 200 }, { type: "null" }],
    },
    difficulty: stringEnum(["low", "medium", "high"]),
    confidence: stringEnum(["low", "medium", "high"]),
    measurementPlan: {
      anyOf: [{ type: "string", maxLength: 300 }, { type: "null" }],
    },
    risks: {
      type: "array",
      items: { type: "string", maxLength: 200 },
      maxItems: 8,
    },
  });

  return object({
    recommendations: {
      type: "array",
      items: editSchema,
      maxItems: 20,
    },
  });
}

function object(properties: Record<string, JsonSchemaValue>): JsonSchemaValue {
  return {
    type: "object",
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

function stringEnum<T extends string>(values: readonly T[]): JsonSchemaValue {
  return { type: "string", enum: [...values] };
}

// ---------------------------------------------------------------------------
// Cost helpers — exported for tests
// ---------------------------------------------------------------------------

export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const rates =
    (COST_PER_MILLION as Record<string, { input: number; output: number }>)[
      model
    ] ?? COST_PER_MILLION["gpt-5-mini"];
  const cost =
    (inputTokens / 1_000_000) * rates.input +
    (outputTokens / 1_000_000) * rates.output;
  return round6(cost);
}

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

// ---------------------------------------------------------------------------
// Parse helpers
// ---------------------------------------------------------------------------

type ParsedEdit = {
  actionType: ActionType;
  targetUrl: string;
  targetElement: SpecificEditTargetElement | null;
  why: string;
  evidence: SpecificEditEvidenceRef[];
  expectedImpact: string | null;
  difficulty: SpecificEditDifficulty;
  confidence: SpecificEditConfidence;
  measurementPlan: string | null;
  risks: string[];
};

/**
 * Extract `recommendations[]` from the parsed model output. Returns
 * null if the structure is unrecognizable (caller returns empty bundle).
 *
 * This is a defensive untyped-input parser. The validator at
 * `specific-edit-validator.ts` is the authoritative semantic check —
 * this function only normalizes shape.
 */
function extractRecommendations(parsed: unknown): ParsedEdit[] | null {
  if (!parsed || typeof parsed !== "object") return null;
  const recs = (parsed as { recommendations?: unknown }).recommendations;
  if (!Array.isArray(recs)) return null;
  const out: ParsedEdit[] = [];
  for (const r of recs) {
    if (!r || typeof r !== "object") continue;
    const obj = r as Record<string, unknown>;
    const actionType = obj.actionType;
    const targetUrl = obj.targetUrl;
    const why = obj.why;
    const evidence = obj.evidence;
    const difficulty = obj.difficulty;
    const confidence = obj.confidence;
    const risks = obj.risks;
    if (
      typeof actionType !== "string" ||
      typeof targetUrl !== "string" ||
      typeof why !== "string" ||
      !Array.isArray(evidence) ||
      typeof difficulty !== "string" ||
      typeof confidence !== "string" ||
      !Array.isArray(risks)
    ) {
      // Skip this item; let the validator reject the bundle if it cares.
      continue;
    }
    out.push({
      actionType: actionType as ActionType,
      targetUrl,
      targetElement:
        (obj.targetElement as SpecificEditTargetElement | null) ?? null,
      why,
      evidence: evidence as SpecificEditEvidenceRef[],
      expectedImpact:
        (obj.expectedImpact as string | null | undefined) ?? null,
      difficulty: difficulty as SpecificEditDifficulty,
      confidence: confidence as SpecificEditConfidence,
      measurementPlan:
        (obj.measurementPlan as string | null | undefined) ?? null,
      risks: risks as string[],
    });
  }
  return out;
}
