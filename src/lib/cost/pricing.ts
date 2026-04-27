/**
 * Sprint 6A.3a (2026-04-26) — pricing table + cost estimator.
 *
 * Single source of truth for per-call cost estimation in the native
 * polling pipeline. Pure / no I/O / no network — composed by the poll
 * loop after each `client.sample()` returns.
 *
 * Pricing values are dated. When OpenAI / Perplexity update list prices,
 * bump the `verifiedAt` and the per-million / per-thousand numbers in
 * one place. Anything reading `estimatePromptCost` automatically picks
 * up the new rates.
 *
 * IMPORTANT: this helper produces ESTIMATES, not authoritative spend.
 * The provider's billing dashboard remains the source of truth for
 * absolute cost. Estimates target <5% drift from billed amounts under
 * normal operation. Conservative defaults (zero cost when usage is
 * missing) ensure a missing/changed response shape never crashes the
 * polling loop or undercounts in a way that bypasses the budget gate
 * (any unbookable call simply doesn't decrement the budget — operator
 * sees the same call on the OpenAI dashboard for reconciliation).
 */

export type PollProvider = "openai" | "perplexity";

/**
 * Per-million-token rates in USD. Verified against provider list pricing
 * 2026-04-26. Update both numbers and `verifiedAt` together when prices
 * change.
 */
export type ModelPricing = {
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  verifiedAt: string;
};

/**
 * Per-1k-call tool charges. OpenAI's `web_search_preview` is the only
 * one currently billed separately by usage; Perplexity sonar bundles
 * search into the per-token rate so there's no separate tool charge.
 */
export type ToolPricing = {
  webSearchUsdPerThousand: number;
  verifiedAt: string;
};

const OPENAI_MODEL_RATES: Record<string, ModelPricing> = {
  "gpt-4o": {
    inputUsdPerMillion: 2.5,
    outputUsdPerMillion: 10.0,
    verifiedAt: "2026-04-26",
  },
  "gpt-4o-2024-08-06": {
    inputUsdPerMillion: 2.5,
    outputUsdPerMillion: 10.0,
    verifiedAt: "2026-04-26",
  },
  "gpt-4o-mini": {
    inputUsdPerMillion: 0.15,
    outputUsdPerMillion: 0.6,
    verifiedAt: "2026-04-26",
  },
  "gpt-4.1": {
    inputUsdPerMillion: 2.0,
    outputUsdPerMillion: 8.0,
    verifiedAt: "2026-04-26",
  },
  "gpt-4.1-mini": {
    inputUsdPerMillion: 0.4,
    outputUsdPerMillion: 1.6,
    verifiedAt: "2026-04-26",
  },
  "gpt-5-mini": {
    inputUsdPerMillion: 0.25,
    outputUsdPerMillion: 2.0,
    verifiedAt: "2026-04-26",
  },
  "gpt-5-nano": {
    inputUsdPerMillion: 0.05,
    outputUsdPerMillion: 0.4,
    verifiedAt: "2026-04-26",
  },
};

const PERPLEXITY_MODEL_RATES: Record<string, ModelPricing> = {
  sonar: {
    inputUsdPerMillion: 1.0,
    outputUsdPerMillion: 1.0,
    verifiedAt: "2026-04-26",
  },
  "sonar-pro": {
    inputUsdPerMillion: 3.0,
    outputUsdPerMillion: 15.0,
    verifiedAt: "2026-04-26",
  },
};

/**
 * Fallback rates when the model id isn't in the table. Conservative —
 * uses the most expensive rate in the provider's family so a future
 * unknown model produces a HIGH cost estimate rather than a $0 free
 * pass. This keeps the budget gate honest when the table is stale.
 */
const OPENAI_FALLBACK: ModelPricing = OPENAI_MODEL_RATES["gpt-4o"];
const PERPLEXITY_FALLBACK: ModelPricing = PERPLEXITY_MODEL_RATES["sonar-pro"];

/**
 * OpenAI `web_search_preview` low-context default rate. Verified 2026-04-26.
 * High-context (`high` config) is $35/1k; we use the default-low rate.
 */
const OPENAI_WEB_SEARCH: ToolPricing = {
  webSearchUsdPerThousand: 30.0,
  verifiedAt: "2026-04-26",
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type EstimatePromptCostInput = {
  provider: PollProvider;
  /** Model id as returned by the provider (or the model passed to the
   *  client constructor). Falls back to provider's most-expensive model
   *  when unknown — see `OPENAI_FALLBACK` / `PERPLEXITY_FALLBACK`. */
  model: string;
  /** From provider response; 0 when absent. */
  inputTokens?: number;
  outputTokens?: number;
  /** OpenAI only. Counted from `output[].type === "web_search_call"` items. */
  webSearchCalls?: number;
};

export type EstimatePromptCostResult = {
  /** Total estimated cost in USD, rounded to 6 decimals. */
  totalUsd: number;
  /** Per-component breakdown for diagnostic logging. All rounded to 6. */
  breakdown: {
    inputUsd: number;
    outputUsd: number;
    webSearchUsd: number;
  };
  /** Whether the lookup hit the model table or fell back. Useful for
   *  surfacing "stale pricing table" warnings in cron logs. */
  modelMatched: boolean;
};

/**
 * Pure cost estimator. Returns `{ totalUsd: 0, ... }` when usage is
 * missing entirely (e.g., a legacy mock with no `usage` field) — that's
 * the conservative fallback documented in `types.ts`.
 */
export function estimatePromptCost(
  input: EstimatePromptCostInput,
): EstimatePromptCostResult {
  const inputTokens = input.inputTokens ?? 0;
  const outputTokens = input.outputTokens ?? 0;
  const webSearchCalls = input.webSearchCalls ?? 0;

  const rates = lookupModel(input.provider, input.model);
  const modelMatched = rates.matched;

  const inputUsd = round6(
    (inputTokens / 1_000_000) * rates.pricing.inputUsdPerMillion,
  );
  const outputUsd = round6(
    (outputTokens / 1_000_000) * rates.pricing.outputUsdPerMillion,
  );
  const webSearchUsd =
    input.provider === "openai" && webSearchCalls > 0
      ? round6(
          (webSearchCalls / 1_000) * OPENAI_WEB_SEARCH.webSearchUsdPerThousand,
        )
      : 0;

  return {
    totalUsd: round6(inputUsd + outputUsd + webSearchUsd),
    breakdown: { inputUsd, outputUsd, webSearchUsd },
    modelMatched,
  };
}

/**
 * Look up a model in the provider's rate table. Returns `{ matched: false,
 * pricing: <fallback> }` when the model id isn't found — the fallback is
 * intentionally conservative (most expensive in the family) so an unknown
 * model never produces a $0 cost.
 */
function lookupModel(
  provider: PollProvider,
  model: string,
): { matched: boolean; pricing: ModelPricing } {
  const table =
    provider === "openai" ? OPENAI_MODEL_RATES : PERPLEXITY_MODEL_RATES;
  const fallback =
    provider === "openai" ? OPENAI_FALLBACK : PERPLEXITY_FALLBACK;
  const direct = table[model];
  if (direct) return { matched: true, pricing: direct };
  // Try a normalized form: lowercase, strip date suffix (e.g.
  // "gpt-4o-2024-08-06" → "gpt-4o").
  const normalized = model.toLowerCase().replace(/-\d{4}-\d{2}-\d{2}$/, "");
  const normalizedHit = table[normalized];
  if (normalizedHit) return { matched: true, pricing: normalizedHit };
  return { matched: false, pricing: fallback };
}

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}
