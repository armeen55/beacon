import "server-only";

/**
 * GPT-5-mini adjudicator — Phase v7 Commit 3 (2026-04-23).
 *
 * Layer 3 of the page-intent resolver pipeline. Runs ONLY on candidates
 * where deterministic layers are ambiguous, high-value, or would produce
 * a URL-less changelog entry on Accept. Uses OpenAI's Chat Completions
 * API with strict JSON schema (structured outputs) so URL + action +
 * motive enums are enforced at the decoder level — hallucination is
 * structurally impossible.
 *
 * Integration:
 *   - Caller passes an already-resolved candidate (Layer 1/2 output).
 *   - Adjudicator builds the evidence packet, hashes it, checks cache.
 *     Cache hit → return cached output with `source: "cache_hit"`.
 *   - Checks budget. If cap reached → return null with budget_blocked.
 *   - Calls OpenAI with strict JSON schema (enum-constrained targetUrl).
 *   - Stores output in cache, records spend, appends history.
 *   - Caller merges the LLM output back into the resolution (tier
 *     becomes "adjudicated"). If no output, resolution stays as
 *     Layer 1/2 output.
 */

import { log } from "@/lib/logger";
import type { ResolvedRecommendationCandidate } from "./resolved-types";
import type { AdjudicatorOutput } from "./adjudicator-schema";
import { buildAdjudicatorJsonSchema } from "./adjudicator-schema";
import {
  buildEvidencePacket,
  type EvidencePacket,
  type BuildEvidencePacketArgs,
} from "./evidence-packet";
import {
  hashEvidencePacket,
  readCacheEntry,
  writeCacheEntry,
} from "./adjudicator-cache";
import {
  checkBudget,
  recordSpend,
  getBudgetState,
} from "./adjudicator-budget";
import {
  appendHistory,
  summarizePacket,
  type AdjudicatorHistoryEntry,
} from "./adjudicator-history";

// ---------------------------------------------------------------------------
// Config — tuned for Ritz dogfood. Swap model string to bump quality.
// ---------------------------------------------------------------------------

const DEFAULT_MODEL = "gpt-5-mini";
/** Rough per-million rates (USD) for cost tracking. Verified 2026-04-23. */
const COST_PER_MILLION = {
  "gpt-5-mini": { input: 0.25, output: 2.0 },
  "gpt-5-nano": { input: 0.05, output: 0.4 },
  "gpt-5.4-mini": { input: 0.75, output: 4.5 },
} as const;

const OPENAI_CHAT_API = "https://api.openai.com/v1/chat/completions";

const SYSTEM_PROMPT = `
You are Beacon's recommendation adjudicator.

You review ONE recommendation at a time and decide the final operator-facing
action, the target URL, the motive, the specific edits, and the page brief.
You receive a structured evidence packet. You do NOT have web access. Do NOT
reason from outside knowledge — every claim must be grounded in the packet.

HARD RULES:

1. targetUrl MUST be one of the URLs listed in allowedTargetUrls. If no
   listed URL fits, return "needs_new_page". Never invent URLs.
2. finalAction MUST be from allowedActions.
3. primaryMotive MUST be from allowedMotives.
4. Do NOT claim guaranteed uplift, traffic, or rank improvements.
5. When uncertain, set needsHumanReview=true and choose "needs_review"
   as finalAction. It is better to escalate than to guess.
6. Accept the deterministic resolver's decision when its confidence is
   "high" — write the page brief, don't second-guess the action. You may
   override on "medium" or "low" confidence if the packet evidence
   disagrees.
7. When finalAction is "create_new_page", proposedSlug MUST be a URL-safe
   kebab-case path fragment (no leading slash). Set pageBrief.
8. When finalAction is "merge_or_dedupe", mergeWithUrls MUST list at
   least one URL beyond targetUrl, from allowedTargetUrls.
9. When finalAction is "needs_review" or "watch", set noActionReason.
   Otherwise leave noActionReason null.
10. suggestedEdits items must cite "why" grounded in the packet
    (a prompt id, an ownedUrlsCited entry, a competitor, or an
    answer excerpt). Prefer specific angles over generic advice.

OPERATOR-FACING COPY:
- operatorTitle: short imperative, ≤80 chars.
- why: 1-2 sentences that name the specific evidence that drove the
  recommendation.
- specificRecommendation: concrete action — one paragraph or a short
  bulleted list. Name descriptors, competitors, or prompt intents as
  they appear in the packet.
`;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type AdjudicateRecommendationArgs = Omit<
  BuildEvidencePacketArgs,
  "now"
> & {
  /** Override model for testing. Defaults to gpt-5-mini. */
  model?: string;
  /** Override fetch implementation for testing. */
  fetchImpl?: typeof fetch;
  now?: Date;
};

export type AdjudicateResult =
  | { status: "ok"; output: AdjudicatorOutput; evidenceHash: string; source: "live_call" | "cache_hit"; costUsd: number }
  | { status: "skipped"; reason: string; evidenceHash: string }
  | { status: "error"; error: string; evidenceHash: string | null };

export async function adjudicateRecommendation(
  args: AdjudicateRecommendationArgs,
): Promise<AdjudicateResult> {
  const t0 = Date.now();
  const model = args.model ?? DEFAULT_MODEL;
  const now = args.now ?? new Date();

  // 1. Build packet.
  let packet: EvidencePacket;
  try {
    packet = buildEvidencePacket({ ...args, now });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error("adjudicator packet build failed", {
      stableKey: args.candidate.stableKey,
      error: msg,
    });
    return { status: "error", error: `packet: ${msg}`, evidenceHash: null };
  }
  const evidenceHash = hashEvidencePacket(packet);

  // 2. Cache hit?
  const cached = await readCacheEntry(evidenceHash);
  if (cached) {
    await appendHistory({
      timestamp: now.toISOString(),
      evidenceHash,
      stableKey: args.candidate.stableKey,
      model: cached.model,
      inputTokens: cached.inputTokens,
      outputTokens: cached.outputTokens,
      costUsd: 0,
      output: cached.output,
      packetSummary: summarizePacket(packet),
      source: "cache_hit",
    });
    log.info("adjudicator cache hit", {
      stableKey: args.candidate.stableKey,
      evidenceHash,
      durationMs: Date.now() - t0,
    });
    return {
      status: "ok",
      output: cached.output,
      evidenceHash,
      source: "cache_hit",
      costUsd: 0,
    };
  }

  // 3. Budget check (estimate upfront so we don't even call on hard-cap).
  const budget = await checkBudget({ now });
  if (!budget.allowed) {
    await appendHistory({
      timestamp: now.toISOString(),
      evidenceHash,
      stableKey: args.candidate.stableKey,
      model,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      output: null,
      packetSummary: summarizePacket(packet),
      source: "budget_blocked",
      errorMessage: budget.reason,
    });
    log.warn("adjudicator budget blocked", {
      stableKey: args.candidate.stableKey,
      reason: budget.reason,
    });
    return { status: "skipped", reason: budget.reason, evidenceHash };
  }

  // 4. Call OpenAI with strict JSON schema.
  const schema = buildAdjudicatorJsonSchema({
    allowedTargetUrls: packet.allowedTargetUrls,
  });
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      status: "error",
      error: "OPENAI_API_KEY not set",
      evidenceHash,
    };
  }

  const fetchImpl = args.fetchImpl ?? fetch;
  let rawResponse: Response;
  try {
    rawResponse = await fetchImpl(OPENAI_CHAT_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `Evidence packet:\n${JSON.stringify(packet, null, 2)}`,
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "adjudicator_output",
            strict: true,
            schema,
          },
        },
      }),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return await recordError(msg, args.candidate.stableKey, model, evidenceHash, now, packet);
  }

  if (!rawResponse.ok) {
    const body = await rawResponse.text().catch(() => "");
    const msg = `OpenAI ${rawResponse.status}: ${body.slice(0, 200)}`;
    return await recordError(msg, args.candidate.stableKey, model, evidenceHash, now, packet);
  }

  // 5. Parse + validate.
  type OpenAIChatResponse = {
    choices?: Array<{
      message?: {
        content?: string | null;
        refusal?: string | null;
      };
      finish_reason?: string;
    }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
    };
  };
  const data = (await rawResponse.json()) as OpenAIChatResponse;
  const choice = data.choices?.[0];
  const refusal = choice?.message?.refusal;
  if (refusal) {
    return await recordError(
      `model refused: ${refusal}`,
      args.candidate.stableKey,
      model,
      evidenceHash,
      now,
      packet,
    );
  }
  const content = choice?.message?.content;
  if (!content) {
    return await recordError(
      "empty content",
      args.candidate.stableKey,
      model,
      evidenceHash,
      now,
      packet,
    );
  }

  let output: AdjudicatorOutput;
  try {
    output = JSON.parse(content) as AdjudicatorOutput;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return await recordError(
      `parse failed: ${msg}`,
      args.candidate.stableKey,
      model,
      evidenceHash,
      now,
      packet,
    );
  }

  // 6. Compute cost + write cache + record spend + append history.
  const inputTokens = data.usage?.prompt_tokens ?? 0;
  const outputTokens = data.usage?.completion_tokens ?? 0;
  const costUsd = estimateCost(model, inputTokens, outputTokens);

  await writeCacheEntry({
    evidenceHash,
    stableKey: args.candidate.stableKey,
    model,
    output,
    inputTokens,
    outputTokens,
    costUsd,
    cachedAt: now.toISOString(),
  });
  await recordSpend(costUsd, { now });
  await appendHistory({
    timestamp: now.toISOString(),
    evidenceHash,
    stableKey: args.candidate.stableKey,
    model,
    inputTokens,
    outputTokens,
    costUsd,
    output,
    packetSummary: summarizePacket(packet),
    source: "live_call",
  });

  const state = await getBudgetState(now);
  log.info("adjudicator live call", {
    stableKey: args.candidate.stableKey,
    evidenceHash,
    inputTokens,
    outputTokens,
    costUsd,
    durationMs: Date.now() - t0,
    monthSpendUsd: state.spendUsd,
  });

  return { status: "ok", output, evidenceHash, source: "live_call", costUsd };
}

// ---------------------------------------------------------------------------
// Selective firing rule — caller uses this to decide whether to adjudicate
// each candidate. Keeps cost bounded without removing the adjudicator's
// ability to fire on the cases where it's most useful.
// ---------------------------------------------------------------------------

export function shouldAdjudicate(
  candidate: ResolvedRecommendationCandidate,
  opts: { alreadyFiredCount: number; maxPerRequest: number },
): { fire: boolean; reason: string } {
  if (opts.alreadyFiredCount >= opts.maxPerRequest) {
    return { fire: false, reason: `max_per_request (${opts.maxPerRequest}) reached` };
  }
  const r = candidate.resolution;
  if (r.action === "needs_review") return { fire: true, reason: "needs_review" };
  if (r.action === "merge_or_dedupe") return { fire: true, reason: "merge_or_dedupe" };
  if (r.confidence === "low" && r.action !== "watch") {
    return { fire: true, reason: "low_confidence" };
  }
  // create_new_page where inventory matched partially — best "AI helps avoid
  // fake create" case.
  if (r.action === "create_new_page" && r.tier === "inventory") {
    return { fire: true, reason: "create_new_page_with_inventory_partial" };
  }
  // Accept would create a URL-less changelog entry.
  if (r.targetUrl === "needs_new_page" && r.action !== "watch") {
    return { fire: true, reason: "url_less_changelog_risk" };
  }
  return { fire: false, reason: "no_firing_rule_matched" };
}

// ---------------------------------------------------------------------------
// Merge LLM output back into a resolved candidate → upgraded resolution.
// ---------------------------------------------------------------------------

export function applyAdjudicationToResolution(
  candidate: ResolvedRecommendationCandidate,
  output: AdjudicatorOutput,
): ResolvedRecommendationCandidate {
  return {
    ...candidate,
    resolution: {
      ...candidate.resolution,
      action: output.finalAction,
      motive: output.primaryMotive,
      targetUrl: output.targetUrl,
      confidence: output.confidence,
      confidenceReason: output.confidenceReason,
      tier: "adjudicated",
      reasoning: output.why,
      cannibalization: output.mergeWithUrls,
      evidenceRefs: output.evidenceRefs.map((r) => {
        if (r.type === "prompt") return { type: "prompt", id: r.id };
        if (r.type === "url")
          return {
            type: "url",
            url: r.url,
            citationCount: 0,
            observationCount: 0,
          };
        return { type: "competitor", name: r.name, primaryShare: 0 };
      }),
    },
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function estimateCost(
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
  return Math.round(cost * 1_000_000) / 1_000_000;
}

async function recordError(
  message: string,
  stableKey: string,
  model: string,
  evidenceHash: string,
  now: Date,
  packet: EvidencePacket,
): Promise<AdjudicateResult> {
  const entry: AdjudicatorHistoryEntry = {
    timestamp: now.toISOString(),
    evidenceHash,
    stableKey,
    model,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    output: null,
    packetSummary: summarizePacket(packet),
    source: "error",
    errorMessage: message,
  };
  await appendHistory(entry);
  log.error("adjudicator error", { stableKey, evidenceHash, error: message });
  return { status: "error", error: message, evidenceHash };
}
