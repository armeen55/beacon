import "server-only";

/**
 * Expert-rec-engine PHASE F (2026-06-16) — LLM EXPERT STRATEGIST pass.
 *
 * The directive's architecture principle, embodied literally:
 *   "No single LLM output should be trusted blindly. The LLM can reason,
 *    compare, classify, and draft, but DETERMINISTIC GATES decide whether a
 *    recommendation can be shown as high confidence, downgraded, or rejected."
 *
 * So this module splits the two responsibilities cleanly:
 *   • the LLM provides the REASONING (opportunity, why-now, best action,
 *     alternatives + why-not, expected outcome, risks) — the "better than a
 *     pro SEO" narrative the operator wants;
 *   • the DETERMINISTIC gate (`enforceExpertConfidence`, pure) sets the
 *     confidence + approve verdict and can REJECT — and the LLM CANNOT
 *     override it. The page-topic intent-fit gate (Slice 3) and the upstream
 *     safety gate are the authority.
 *
 * Reuses the Slice-B LLM seam verbatim (budget → provider → spend → sanitize →
 * fail-closed): `composeLlmWhyThisMatters`'s vendor + no-invented-numbers
 * firewall (`ANSWER_ENGINE_VENDOR_PATTERNS`, `extractNumberTokens`,
 * `serializeWhyInput`), `checkBudget`/`recordSpend`, `DEFAULT_OPENAI_MODEL`/
 * `estimateCost`. Same fail-closed posture: flag off / build phase / budget
 * blocked / no key / network error / parse failure / sanitize rejection → null,
 * and the deterministic Act-2 reasoning + intent-fit verdict stand alone.
 *
 * READ-ONLY: the strategist narrative is displayed as ANALYSIS, never as raw
 * evidence and never published. ON BY DEFAULT in production (2026-06-16) — no
 * feature flag to manage; an emergency kill-switch (`BEACON_LLM_STRATEGIST="0"`
 * / `BEACON_LLM_CRITIC="0"`) can disable without a redeploy. Independent of
 * `BEACON_LLM_WHY` (the separate Act-2 enhancement).
 *
 * Pinned by tests/domains/recommendations/llm-expert-strategist.test.ts.
 */

import { DEFAULT_OPENAI_MODEL, estimateCost } from "./providers/openai";
import { checkBudget, recordSpend } from "./adjudicator-budget";
import {
  ANSWER_ENGINE_VENDOR_PATTERNS,
  extractNumberTokens,
  serializeWhyInput,
} from "./llm-why-narrative";
import type { WhyThisMattersInput } from "./why-this-matters-narrative";
import type { PageTopicFit } from "./page-topic-fit";
// The deterministic verdict authority now lives in a PURE module so the
// generation-time QA path can share it. Re-exported here for back-compat.
import {
  enforceExpertConfidence,
  applyCriticToVerdict,
  type RiskLevel,
  type FinalConfidence,
  type ExpertVerdict,
  type CriticReview,
} from "./expert-verdict";
export {
  enforceExpertConfidence,
  applyCriticToVerdict,
  type RiskLevel,
  type FinalConfidence,
  type ExpertVerdict,
  type CriticReview,
};

const OPENAI_CHAT_API = "https://api.openai.com/v1/chat/completions";
const DEFAULT_TIMEOUT_MS = 12_000;
const MAX_COMPLETION_TOKENS = 3_000;
const MAX_FIELD_LEN = 320;
const MAX_LIST_ITEMS = 4;

/** The directive's PHASE-F "strategist pass" JSON contract. */
export type StrategistReasoning = {
  opportunitySummary: string;
  whyThisNow: string;
  bestAction: string;
  alternativesConsidered: string[];
  whyNotAlternatives: string[];
  expectedOutcome: string;
  riskLevel: RiskLevel;
  risks: string[];
};

export type ExpertSynthesis = ExpertVerdict & {
  strategist: StrategistReasoning;
  /** The adversarial QA critic review, when BEACON_LLM_CRITIC ran + returned a
   *  clean result (the "Adversarial QA" panel). null/undefined otherwise. */
  criticReview?: CriticReview | null;
  model: string;
  costUsd: number;
};

// ─────────────────────────────────────────────────────────────────────
// Firewall — honesty + white-label + AI-claims-need-AI-evidence. Pure.
// ─────────────────────────────────────────────────────────────────────

// AI CITATION-BEHAVIOUR claims (paired AI token + citation/recommend verb).
// Generic "helps AI assistants read it" is allowed; "AI assistants cite X" is
// a factual claim that requires real answer-engine evidence.
const AI_CLAIM_PATTERNS: ReadonlyArray<RegExp> = [
  /\b(ai|assistant|assistants|answer engines?)\b[^.]{0,48}\b(cite|cites|cited|citing|recommend|recommends|recommended|recommending|mention|mentions|mentioned|answer|answers|answered)\b/i,
  /\b(cite|cites|cited|citing|recommend|recommends|recommended|mention|mentions|mentioned)\b[^.]{0,48}\b(ai|assistant|assistants|answer engines?)\b/i,
];

// Internal-identifier leaks (the model sometimes echoes a payload JSON key into
// prose, e.g. "shouldUseQueryForOptimization is true"). Reuses the shapes the
// copy-display-guard already detects: a multi-transition camelCase identifier
// or a 3+ segment snake_case identifier. Generic single-transition names
// (iPhone, eBay) are intentionally NOT matched.
const INTERNAL_IDENTIFIER_PATTERNS: ReadonlyArray<RegExp> = [
  /\b[a-z][a-z0-9]*[A-Z][a-z0-9]+[A-Z][a-zA-Z0-9]*\b/,
  /\b[a-z][a-z0-9]*(?:_[a-z0-9]+){2,}\b/,
];

export type StrategistSanitizeResult =
  | { ok: true; reasoning: StrategistReasoning }
  | { ok: false; reason: string };

export function sanitizeStrategistReasoning(
  r: StrategistReasoning,
  serializedInput: string,
  opts: { hasAeoEvidence: boolean },
): StrategistSanitizeResult {
  const strings = [
    r.opportunitySummary,
    r.whyThisNow,
    r.bestAction,
    r.expectedOutcome,
    ...r.alternativesConsidered,
    ...r.whyNotAlternatives,
    ...r.risks,
  ];
  for (const s of strings) {
    for (const p of ANSWER_ENGINE_VENDOR_PATTERNS) {
      if (p.test(s)) return { ok: false, reason: `vendor_name:${p.source}` };
    }
    for (const tok of extractNumberTokens(s)) {
      if (!serializedInput.includes(tok)) {
        return { ok: false, reason: `invented_number:${tok}` };
      }
    }
    for (const p of INTERNAL_IDENTIFIER_PATTERNS) {
      if (p.test(s)) return { ok: false, reason: "internal_identifier_leak" };
    }
    if (!opts.hasAeoEvidence) {
      for (const p of AI_CLAIM_PATTERNS) {
        if (p.test(s)) return { ok: false, reason: "ai_claim_without_ai_evidence" };
      }
    }
  }
  return { ok: true, reasoning: r };
}

// ─────────────────────────────────────────────────────────────────────
// JSON parse — fail-closed shape validation of the strategist contract.
// ─────────────────────────────────────────────────────────────────────

function asTrimmedString(v: unknown, max = MAX_FIELD_LEN): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (t.length === 0) return null;
  return t.length > max ? t.slice(0, max).trimEnd() : t;
}

function asStringList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => asTrimmedString(x))
    .filter((x): x is string => x != null)
    .slice(0, MAX_LIST_ITEMS);
}

export function parseStrategistJson(content: string): StrategistReasoning | null {
  let text = content.trim();
  if (text.length === 0) return null;
  // Strip a ```json … ``` fence if present.
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1]!.trim();
  // Narrow to the outermost object if the model added prose around it.
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace <= firstBrace) return null;
  text = text.slice(firstBrace, lastBrace + 1);

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null; // fail-closed on malformed JSON
  }
  if (parsed == null || typeof parsed !== "object") return null;
  const o = parsed as Record<string, unknown>;

  const opportunitySummary = asTrimmedString(o.opportunity_summary);
  const whyThisNow = asTrimmedString(o.why_this_now);
  const bestAction = asTrimmedString(o.best_action);
  const expectedOutcome = asTrimmedString(o.expected_outcome);
  const riskRaw = typeof o.risk_level === "string" ? o.risk_level.toLowerCase() : "";
  const riskLevel: RiskLevel =
    riskRaw === "low" || riskRaw === "medium" || riskRaw === "high"
      ? (riskRaw as RiskLevel)
      : "medium";

  // The four narrative anchors are required; lists may be empty.
  if (!opportunitySummary || !whyThisNow || !bestAction || !expectedOutcome) {
    return null;
  }

  return {
    opportunitySummary,
    whyThisNow,
    bestAction,
    alternativesConsidered: asStringList(o.alternatives_considered),
    whyNotAlternatives: asStringList(o.why_not_alternatives),
    expectedOutcome,
    riskLevel,
    risks: asStringList(o.risks),
  };
}

// ─────────────────────────────────────────────────────────────────────
// Prompt
// ─────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT =
  "You are a world-class SEO/AEO strategist reviewing ONE recommended edit " +
  "for a non-technical business owner. Reason better and more specifically " +
  "than a generic SEO consultant, but stay strictly grounded. RULES: ground " +
  "every claim ONLY in the provided signals; NEVER state a number/percentage/" +
  "count not present in the signals; NEVER name an AI vendor or answer-engine " +
  "product (say 'AI assistants'); do NOT claim anything about AI/answer-engine " +
  "citation behaviour unless answer-engine evidence is present in the signals; " +
  "do NOT invent historical or factual claims; write in plain business " +
  "English and NEVER mention internal field names, JSON keys, or camelCase/" +
  "snake_case identifiers (write 'this is the right page for the query', not " +
  "'shouldUseQueryForOptimization is true'). Respond with STRICT JSON ONLY " +
  "(no prose, no markdown fence) with EXACTLY these keys: opportunity_summary " +
  "(string), why_this_now (string), best_action (string), alternatives_" +
  "considered (string[]), why_not_alternatives (string[]), expected_outcome " +
  "(string), risk_level ('low'|'medium'|'high'), risks (string[]).";

export type ComposeExpertStrategyOptions = {
  fetchImpl?: typeof fetch;
  now?: Date;
  timeoutMs?: number;
  model?: string;
};

export type ExpertStrategyInput = {
  /** The shared evidence packet (same one the deterministic Act 2 uses). */
  why: WhyThisMattersInput;
  /** Page-topic intent-fit verdict (Slice 3), or null when not scored. */
  topicFit: PageTopicFit | null;
  /** Upstream deterministic safety-gate rejection. */
  deterministicReject?: boolean;
};

function hasCoreEvidenceOf(why: WhyThisMattersInput): boolean {
  return (
    why.gscEvidenceLines.length > 0 ||
    why.semrushEvidenceLines.length > 0 ||
    why.aeoEvidenceLines.length > 0 ||
    why.clarityEvidenceLines.length > 0 ||
    why.competitor != null
  );
}

/**
 * Run the expert strategist pass and combine it with the deterministic
 * verdict. Returns null (fail-closed) on flag-off / build / budget / no-key /
 * network / parse / sanitize failure — the caller keeps the deterministic
 * reasoning + intent-fit verdict.
 */
export async function composeExpertStrategy(
  input: ExpertStrategyInput,
  opts: ComposeExpertStrategyOptions = {},
): Promise<ExpertSynthesis | null> {
  // ON BY DEFAULT in production (2026-06-16) — the operator no longer manages a
  // feature flag for this. A single emergency kill-switch remains: set
  // BEACON_LLM_STRATEGIST="0" to disable without a redeploy. Absence = ON.
  if (process.env.BEACON_LLM_STRATEGIST === "0") return null;
  if (
    process.env.NEXT_PHASE === "phase-production-build" &&
    process.env.BEACON_LLM_BUILD_OK !== "1"
  ) {
    return null;
  }
  if (process.env.VITEST === "true" && !opts.fetchImpl) return null;

  const now = opts.now ?? new Date();
  try {
    const budget = await checkBudget({ now });
    if (!budget.allowed) return null;
  } catch {
    return null;
  }

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;

  const model = opts.model ?? DEFAULT_OPENAI_MODEL;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = opts.fetchImpl ?? fetch;

  const { payload, serialized } = serializeWhyInput(input.why);
  const userPayload = {
    ...payload,
    pageTopicFit: input.topicFit
      ? {
          intentClass: input.topicFit.intentClass,
          topicMatchScore: input.topicFit.topicMatchScore,
          intentMatchScore: input.topicFit.intentMatchScore,
          mismatchRisks: input.topicFit.mismatchRisks,
          shouldUseQueryForOptimization: input.topicFit.shouldUseQueryForOptimization,
        }
      : null,
  };

  const body = JSON.stringify({
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content:
          "Signals for this recommendation (ground ONLY in these):\n" +
          JSON.stringify(userPayload, null, 2),
      },
    ],
    max_completion_tokens: MAX_COMPLETION_TOKENS,
  });

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
    return null;
  }
  if (!response.ok) return null;

  type OpenAIChatResponse = {
    choices?: Array<{ message?: { content?: string | null; refusal?: string | null } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  let data: OpenAIChatResponse;
  try {
    data = (await response.json()) as OpenAIChatResponse;
  } catch {
    return null;
  }

  const inputTokens = data.usage?.prompt_tokens ?? 0;
  const outputTokens = data.usage?.completion_tokens ?? 0;
  const costUsd = estimateCost(model, inputTokens, outputTokens);
  try {
    await recordSpend(costUsd, { now });
  } catch {
    // spend-write failure must not throw; the call already happened
  }

  const choice = data.choices?.[0];
  if (choice?.message?.refusal) return null;
  const content = choice?.message?.content;
  if (!content) return null;

  const reasoning = parseStrategistJson(content);
  if (reasoning == null) return null;

  const sanitized = sanitizeStrategistReasoning(reasoning, serialized, {
    hasAeoEvidence: input.why.aeoEvidenceLines.length > 0,
  });
  if (!sanitized.ok) return null;

  let verdict = enforceExpertConfidence({
    deterministicReject: input.deterministicReject === true,
    shouldUseQueryForOptimization:
      input.topicFit?.shouldUseQueryForOptimization ?? null,
    hasCoreEvidence: hasCoreEvidenceOf(input.why),
    topicMatchScore: input.topicFit?.topicMatchScore ?? null,
    intentMatchScore: input.topicFit?.intentMatchScore ?? null,
  });

  // GQA-3 — adversarial LLM critic (flagged BEACON_LLM_CRITIC, default OFF).
  // A skeptical second pass that may LOWER or REJECT confidence;
  // `applyCriticToVerdict` clamps it LOWER-ONLY so it can never raise past the
  // deterministic ceiling or rescue a deterministic reject. Fail-closed: any
  // problem keeps the deterministic verdict unchanged.
  // The adversarial critic is ON BY DEFAULT too (kill-switch: BEACON_LLM_CRITIC
  // ="0"). It only runs when the deterministic verdict isn't already a reject
  // (nothing to review) and is clamped LOWER-ONLY by applyCriticToVerdict.
  let criticReview: CriticReview | null = null;
  if (
    process.env.BEACON_LLM_CRITIC !== "0" &&
    verdict.enforcedConfidence !== "rejected"
  ) {
    criticReview = await runCriticReview(
      { reasoning: sanitized.reasoning, serialized },
      { apiKey, model, timeoutMs, fetchImpl, now },
    );
    if (criticReview) verdict = applyCriticToVerdict(verdict, criticReview);
  }

  return {
    strategist: sanitized.reasoning,
    ...verdict,
    criticReview,
    model,
    costUsd,
  };
}

// ─────────────────────────────────────────────────────────────────────
// GQA-3 — adversarial critic pass. Separate OpenAI call; fail-closed → null
// (the deterministic verdict then stands unchanged).
// ─────────────────────────────────────────────────────────────────────

const CRITIC_SYSTEM_PROMPT =
  "You are a skeptical senior SEO/AEO QA reviewer doing an adversarial review " +
  "of a recommendation. You are given the recommendation's reasoning and the " +
  "grounding signals it must rest on. Find what could be WRONG: unsupported " +
  "claims, missing evidence, query/page intent mismatch, risky copy, risky " +
  "publishing changes, and factual risks. Decide the HIGHEST confidence this " +
  "recommendation should be allowed. You may ONLY approve, lower confidence, " +
  "ask for more evidence, or reject — NEVER raise confidence. Flag any number " +
  "not present in the signals and any AI/answer-engine citation claim made " +
  "without answer-engine evidence. Write in plain business English; NEVER " +
  "mention internal field names or camelCase/snake_case identifiers. Respond " +
  "with STRICT JSON ONLY (no prose, no markdown) with EXACTLY these keys: " +
  "critic_verdict ('approve'|'lower_confidence'|'needs_more_evidence'|'reject'), " +
  "confidence_ceiling ('high'|'medium'|'low'|'needs_more_evidence'|'rejected'), " +
  "unsupported_claims (string[]), evidence_gaps (string[]), " +
  "query_page_mismatch_risks (string[]), copy_risks (string[]), " +
  "publishing_risks (string[]), factual_risks (string[]), " +
  "what_would_make_this_high_confidence (string[]), human_review_note (string).";

/** Internal-identifier / vendor patterns that must not leak into the displayed
 *  critic strings (reuses the strategist firewall shapes). */
const CRITIC_LEAK_PATTERNS: ReadonlyArray<RegExp> = [
  ...ANSWER_ENGINE_VENDOR_PATTERNS,
  /\b[a-z][a-z0-9]*[A-Z][a-z0-9]+[A-Z][a-zA-Z0-9]*\b/,
  /\b[a-z][a-z0-9]*(?:_[a-z0-9]+){2,}\b/,
];

/** Filter a critic display list: drop any bullet that leaks a vendor name, an
 *  internal identifier, or a number not present in the grounding ledger. Keeps
 *  the rest (the aggregate review stays useful). Caps + trims. */
function filterSafeCriticStrings(
  raw: unknown,
  serializedInput: string,
  max = 5,
): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== "string") continue;
    const s = v.trim();
    if (s.length === 0) continue;
    if (CRITIC_LEAK_PATTERNS.some((p) => p.test(s))) continue;
    if (extractNumberTokens(s).some((tok) => !serializedInput.includes(tok))) continue;
    out.push(s.length > MAX_FIELD_LEN ? s.slice(0, MAX_FIELD_LEN).trimEnd() : s);
    if (out.length >= max) break;
  }
  return out;
}

export function parseCriticJson(
  content: string,
  serializedInput = "",
): CriticReview | null {
  let text = content.trim();
  if (text.length === 0) return null;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1]!.trim();
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace <= firstBrace) return null;
  text = text.slice(firstBrace, lastBrace + 1);

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (parsed == null || typeof parsed !== "object") return null;
  const o = parsed as Record<string, unknown>;

  const verdictRaw =
    typeof o.critic_verdict === "string" ? o.critic_verdict.toLowerCase() : "";
  const criticVerdict: CriticReview["criticVerdict"] =
    verdictRaw === "lower_confidence" ||
    verdictRaw === "needs_more_evidence" ||
    verdictRaw === "reject"
      ? (verdictRaw as CriticReview["criticVerdict"])
      : "approve";

  const ceilRaw =
    typeof o.confidence_ceiling === "string" ? o.confidence_ceiling.toLowerCase() : "";
  const valid: ReadonlyArray<FinalConfidence> = [
    "high",
    "medium",
    "low",
    "needs_more_evidence",
    "rejected",
  ];
  const confidenceCeiling: FinalConfidence = (valid as string[]).includes(ceilRaw)
    ? (ceilRaw as FinalConfidence)
    : "medium";

  const humanReviewNote =
    typeof o.human_review_note === "string" && o.human_review_note.trim().length > 0 &&
    !CRITIC_LEAK_PATTERNS.some((p) => p.test(o.human_review_note as string))
      ? (o.human_review_note as string).trim().slice(0, MAX_FIELD_LEN)
      : "Reviewed against the supplied signals.";

  return {
    criticVerdict,
    confidenceCeiling,
    unsupportedClaims: filterSafeCriticStrings(o.unsupported_claims, serializedInput),
    evidenceGaps: filterSafeCriticStrings(o.evidence_gaps, serializedInput),
    queryPageMismatchRisks: filterSafeCriticStrings(o.query_page_mismatch_risks, serializedInput),
    copyRisks: filterSafeCriticStrings(o.copy_risks, serializedInput),
    publishingRisks: filterSafeCriticStrings(o.publishing_risks, serializedInput),
    factualRisks: filterSafeCriticStrings(o.factual_risks, serializedInput),
    whatWouldMakeThisHighConfidence: filterSafeCriticStrings(
      o.what_would_make_this_high_confidence,
      serializedInput,
    ),
    humanReviewNote,
  };
}

async function runCriticReview(
  args: { reasoning: StrategistReasoning; serialized: string },
  opts: { apiKey: string; model: string; timeoutMs: number; fetchImpl: typeof fetch; now: Date },
): Promise<CriticReview | null> {
  try {
    const budget = await checkBudget({ now: opts.now });
    if (!budget.allowed) return null;
  } catch {
    return null;
  }

  const body = JSON.stringify({
    model: opts.model,
    messages: [
      { role: "system", content: CRITIC_SYSTEM_PROMPT },
      {
        role: "user",
        content:
          "Grounding signals (the reasoning must rest ONLY on these):\n" +
          args.serialized +
          "\n\nThe recommendation reasoning to review:\n" +
          JSON.stringify(args.reasoning, null, 2),
      },
    ],
    max_completion_tokens: MAX_COMPLETION_TOKENS,
  });

  let response: Response;
  try {
    response = await opts.fetchImpl(OPENAI_CHAT_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        "Content-Type": "application/json",
      },
      body,
      signal: AbortSignal.timeout(opts.timeoutMs),
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;

  type OpenAIChatResponse = {
    choices?: Array<{ message?: { content?: string | null; refusal?: string | null } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  let data: OpenAIChatResponse;
  try {
    data = (await response.json()) as OpenAIChatResponse;
  } catch {
    return null;
  }

  const inputTokens = data.usage?.prompt_tokens ?? 0;
  const outputTokens = data.usage?.completion_tokens ?? 0;
  try {
    await recordSpend(estimateCost(opts.model, inputTokens, outputTokens), { now: opts.now });
  } catch {
    // spend-write failure must not throw
  }

  const choice = data.choices?.[0];
  if (choice?.message?.refusal) return null;
  const content = choice?.message?.content;
  if (!content) return null;
  return parseCriticJson(content, args.serialized);
}
