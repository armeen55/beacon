import "server-only";

/**
 * Act 2 "Why this matters" — LLM progressive enhancement (Slice B,
 * 2026-06-16).
 *
 * The deterministic `composeWhyThisMatters()` (shipped in
 * `why-this-matters-narrative.ts`) is the INSTANT baseline that always
 * renders. This module SHARPENS that baseline with a live LLM call when —
 * and ONLY when — every safety gate passes. The detail page's Act 2 calls
 * this AFTER mount (read-only); on ANY problem it returns null and the
 * caller keeps the deterministic sentences.
 *
 * READ-ONLY: nothing here is published. The text never reaches Wix, the
 * draft, the safety validators, or the push path — so there is no
 * publish-safety concern, only HONESTY + WHITE-LABEL.
 *
 * FAIL-CLOSED EVERYWHERE. Any of: flag off, build phase, budget blocked,
 * missing key, network/timeout, parse failure, a sanitize rejection →
 * return null. We never throw to the caller and never leave the page in a
 * worse state than the deterministic baseline.
 *
 * Gates (in order, each short-circuits to null):
 *   1. `BEACON_LLM_WHY !== "1"`        — feature flag (default OFF). No
 *      budget touch, no network call.
 *   2. Next.js production-build phase  — never spend tokens at build time.
 *   3. `checkBudget()` blocked          — no call, no spend.
 *   4. `OPENAI_API_KEY` missing         — no call.
 *   5. Vitest guard                     — refuse to run without an injected
 *      fetchImpl (mirrors generateOpenAIBundle) so a test never hits the
 *      real network.
 *
 * The model + Authorization + cost pattern mirror
 * `providers/openai.ts::generateOpenAIBundle`.
 */

import {
  DEFAULT_OPENAI_MODEL,
  estimateCost,
} from "./providers/openai";
import { checkBudget, recordSpend } from "./adjudicator-budget";
import type { WhyThisMattersInput } from "./why-this-matters-narrative";
import type { EvidenceLine } from "@/domains/recommendation-intelligence/evidence-summary";

const OPENAI_CHAT_API = "https://api.openai.com/v1/chat/completions";

/** Short, hard ceiling — this is a post-mount enhancement, not a blocking
 *  render path. If the model takes longer than this we drop back to the
 *  deterministic baseline rather than make the operator wait. */
const DEFAULT_TIMEOUT_MS = 8_000;

/** Output bound. 2-3 short sentences need little headroom, but gpt-5-mini
 *  spends reasoning tokens against the same completion pool before emitting
 *  text, so leave room (mirrors the provider's reasoning-headroom note). */
const MAX_COMPLETION_TOKENS = 2_000;

/** Per-sentence + per-output shape caps (mirror the deterministic helper's
 *  scannable-brief intent). */
const MAX_SENTENCES = 3;
const MAX_SENTENCE_LEN = 200;

/**
 * Known answer-engine vendor / product names. If ANY appears in the
 * model's output we reject the whole thing — the app is strictly
 * white-label and says "AI assistants", never a vendor. Matched
 * case-insensitively as whole-ish word fragments. Kept deliberately broad;
 * a false-positive only costs us the (optional) LLM sharpening, never
 * correctness — we just fall back to the deterministic baseline.
 */
const ANSWER_ENGINE_VENDOR_PATTERNS: ReadonlyArray<RegExp> = [
  /\bprofound\b/i,
  /\bchat\s*gpt\b/i,
  /\bgpt-?\d/i,
  /\bopenai\b/i,
  /\bperplexity\b/i,
  /\bgemini\b/i,
  /\bbard\b/i,
  /\bclaude\b/i,
  /\banthropic\b/i,
  /\bcopilot\b/i,
  /\bbing\b/i,
  /\bgoogle\s+ai\s+overview/i,
  /\bsearchgpt\b/i,
  /\bllama\b/i,
  /\bmistral\b/i,
  /\bgrok\b/i,
];

const SYSTEM_PROMPT =
  "You are a senior SEO/AEO analyst writing one tight paragraph for a " +
  "non-technical business owner. Explain why THIS specific recommended " +
  "edit matters, in plain English, better and more specifically than a " +
  "generic SEO consultant. RULES: ground every claim ONLY in the signals " +
  "provided; NEVER state a number, percentage, or count that is not in the " +
  "signals; NEVER name an AI vendor or answer-engine product (say 'AI " +
  "assistants'); 2-3 sentences, no preamble, no bullet points, no markdown.";

export type LlmWhyResult = {
  sentences: string[];
  model: string;
  costUsd: number;
};

export type ComposeLlmWhyOptions = {
  /** Inject in tests to avoid real network. Required under Vitest. */
  fetchImpl?: typeof fetch;
  /** Frozen clock for deterministic budget month-keying in tests. */
  now?: Date;
  /** Override timeout. Defaults to DEFAULT_TIMEOUT_MS. */
  timeoutMs?: number;
  /** Override model. Defaults to DEFAULT_OPENAI_MODEL. */
  model?: string;
};

// ─────────────────────────────────────────────────────────────────────
// Input serialization — a compact, deterministic JSON the model grounds
// in AND the sanitizer checks numbers against. The SAME string is the
// no-invented-numbers reference, so it must contain every number the model
// is allowed to repeat.
// ─────────────────────────────────────────────────────────────────────

function evidenceLineToCompact(line: EvidenceLine): {
  label: string;
  value: string;
  detail?: string;
} {
  return {
    label: line.label,
    value: line.value,
    ...(line.detail ? { detail: line.detail } : {}),
  };
}

/** Build the user-prompt payload + return both the object and its
 *  serialized form (the serialized form is the number-grounding ledger). */
export function serializeWhyInput(input: WhyThisMattersInput): {
  payload: Record<string, unknown>;
  serialized: string;
} {
  const payload: Record<string, unknown> = {
    actionType: input.actionType,
    targetLabel: input.targetLabel,
    affectedPromptTexts: input.affectedPromptTexts,
    competitor: input.competitor
      ? {
          name: input.competitor.name,
          // Express the share as the same integer-percent string the
          // deterministic helper uses, so a model echoing "42%" finds it
          // in the ledger. Also include the raw fraction for grounding.
          primaryPct: input.competitor.primaryPct,
          primaryPercent: `${Math.round(input.competitor.primaryPct * 100)}%`,
        }
      : null,
    gscEvidence: input.gscEvidenceLines.map(evidenceLineToCompact),
    semrushEvidence: input.semrushEvidenceLines.map(evidenceLineToCompact),
    clarityEvidence: input.clarityEvidenceLines.map(evidenceLineToCompact),
    aeoEvidence: input.aeoEvidenceLines.map(evidenceLineToCompact),
    promptCount: input.promptCount,
    observationCount: input.observationCount,
    why: input.why ?? null,
  };
  return { payload, serialized: JSON.stringify(payload) };
}

// ─────────────────────────────────────────────────────────────────────
// Sanitize — the honesty + white-label firewall. Reject (→ null) on any
// violation; a rejection just means the deterministic baseline stands.
// ─────────────────────────────────────────────────────────────────────

/** Every number token (\d[\d.,%]*) in a string, normalized for matching:
 *  trailing punctuation that isn't part of the number is stripped so
 *  "1,800." matches "1,800". */
function extractNumberTokens(text: string): string[] {
  const matches = text.match(/\d[\d.,%]*/g) ?? [];
  return matches.map((m) => m.replace(/[.,]+$/, "")).filter((m) => m.length > 0);
}

export type SanitizeResult =
  | { ok: true; sentences: string[] }
  | { ok: false; reason: string };

/**
 * Validate model output against the contract:
 *   (a) NO answer-engine vendor name anywhere.
 *   (b) NO-INVENTED-NUMBERS: every number token in the output must appear
 *       as a substring of the serialized input ledger. A single
 *       hallucinated stat fails the WHOLE output.
 *   (c) split into sentences, trim, drop empties, cap at MAX_SENTENCES /
 *       MAX_SENTENCE_LEN. Empty after that → reject.
 *
 * Exported for unit tests.
 */
export function sanitizeLlmWhyOutput(
  raw: string,
  serializedInput: string,
): SanitizeResult {
  const text = raw.trim();
  if (text.length === 0) return { ok: false, reason: "empty_output" };

  // (a) vendor names.
  for (const pattern of ANSWER_ENGINE_VENDOR_PATTERNS) {
    if (pattern.test(text)) {
      return { ok: false, reason: `vendor_name:${pattern.source}` };
    }
  }

  // (b) no invented numbers — every output number must be in the ledger.
  for (const token of extractNumberTokens(text)) {
    if (!serializedInput.includes(token)) {
      return { ok: false, reason: `invented_number:${token}` };
    }
  }

  // (c) shape into sentences.
  const sentences = text
    // Split on sentence-ending punctuation followed by whitespace, keeping
    // the terminator with its sentence.
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .slice(0, MAX_SENTENCES)
    .map((s) => (s.length > MAX_SENTENCE_LEN ? s.slice(0, MAX_SENTENCE_LEN).trimEnd() : s));

  if (sentences.length === 0) return { ok: false, reason: "no_sentences" };
  return { ok: true, sentences };
}

// ─────────────────────────────────────────────────────────────────────
// Response parsing — accept either plain text or a tiny
// `{"sentences":[...]}` / `{"text":"..."}` JSON; parse defensively.
// ─────────────────────────────────────────────────────────────────────

function extractRawText(content: string): string | null {
  const trimmed = content.trim();
  if (trimmed.length === 0) return null;
  // Try JSON first; fall back to treating the content as plain prose.
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (parsed && typeof parsed === "object") {
        const obj = parsed as Record<string, unknown>;
        if (Array.isArray(obj.sentences)) {
          const joined = obj.sentences
            .filter((s): s is string => typeof s === "string")
            .join(" ")
            .trim();
          return joined.length > 0 ? joined : null;
        }
        if (typeof obj.text === "string") {
          return obj.text.trim().length > 0 ? obj.text.trim() : null;
        }
      }
    } catch {
      // Not valid JSON — fall through to plain-text handling.
    }
  }
  return trimmed;
}

// ─────────────────────────────────────────────────────────────────────
// Main entry point
// ─────────────────────────────────────────────────────────────────────

export async function composeLlmWhyThisMatters(
  input: WhyThisMattersInput,
  opts: ComposeLlmWhyOptions = {},
): Promise<LlmWhyResult | null> {
  // ── 1. Feature flag (default OFF). No budget touch, no network call. ──
  if (process.env.BEACON_LLM_WHY !== "1") return null;

  // ── 2. Build-phase guard (mirror generateOpenAIBundle). ──────────────
  if (
    process.env.NEXT_PHASE === "phase-production-build" &&
    process.env.BEACON_LLM_BUILD_OK !== "1"
  ) {
    return null;
  }

  // ── Vitest guard — refuse a real network call inside test suites. ────
  if (process.env.VITEST === "true" && !opts.fetchImpl) {
    return null;
  }

  // ── 3. Budget. Blocked → no call, no spend. ──────────────────────────
  const now = opts.now ?? new Date();
  try {
    const budget = await checkBudget({ now });
    if (!budget.allowed) return null;
  } catch {
    // A budget read failure is fail-closed: skip the LLM, keep baseline.
    return null;
  }

  // ── 4. Required config. ──────────────────────────────────────────────
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;

  const model = opts.model ?? DEFAULT_OPENAI_MODEL;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = opts.fetchImpl ?? fetch;

  // ── 5. Build prompt. ─────────────────────────────────────────────────
  const { payload, serialized } = serializeWhyInput(input);
  const body = JSON.stringify({
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content:
          "Signals for this recommendation (ground ONLY in these):\n" +
          JSON.stringify(payload, null, 2),
      },
    ],
    max_completion_tokens: MAX_COMPLETION_TOKENS,
  });

  // ── 6. Network call (hard timeout → null). ───────────────────────────
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
    // Network error or timeout — keep the deterministic baseline.
    return null;
  }

  if (!response.ok) return null;

  type OpenAIChatResponse = {
    choices?: Array<{
      message?: { content?: string | null; refusal?: string | null };
    }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  let data: OpenAIChatResponse;
  try {
    data = (await response.json()) as OpenAIChatResponse;
  } catch {
    return null;
  }

  // ── 7. Spend is REAL once the call completed (mirror the gateway). ────
  const inputTokens = data.usage?.prompt_tokens ?? 0;
  const outputTokens = data.usage?.completion_tokens ?? 0;
  const costUsd = estimateCost(model, inputTokens, outputTokens);
  try {
    await recordSpend(costUsd, { now });
  } catch {
    // A spend-write failure must not surface as a thrown error; the call
    // already happened, but we still want to return the result if it's
    // clean. Swallow and continue.
  }

  const choice = data.choices?.[0];
  if (choice?.message?.refusal) return null;
  const content = choice?.message?.content;
  if (!content) return null;

  const rawText = extractRawText(content);
  if (rawText == null) return null;

  // ── 8. Sanitize (honesty + white-label firewall). ───────────────────
  const sanitized = sanitizeLlmWhyOutput(rawText, serialized);
  if (!sanitized.ok) return null;

  return { sentences: sanitized.sentences, model, costUsd };
}
