import "server-only";

/**
 * Native OpenAI (ChatGPT) polling adapter.
 *
 * Thin wrapper around the generalized polling logic in
 * `src/adapters/perplexity/poll.ts`. Different platform label, different
 * QueryClient, different poll-source — everything else (observation shape,
 * alias-aware mention matching, idempotent IDs, observation_run emission) is
 * shared code, not duplicated.
 */

import { pollPerplexityForTenant } from "@/adapters/perplexity/poll";
import type {
  PerplexityPollOptions,
  PerplexityPollResult,
} from "@/adapters/perplexity/poll";
import { createOpenAIClient } from "@/lib/querying/openai-client";

export type OpenAIPollOptions = Omit<PerplexityPollOptions, "client"> & {
  client?: PerplexityPollOptions["client"];
};

export async function pollOpenAIForTenant(
  tenantId: string,
  opts: OpenAIPollOptions = {},
): Promise<PerplexityPollResult> {
  return pollPerplexityForTenant(tenantId, {
    ...opts,
    platform: "chatgpt",
    pollSource: "openai-native-poll",
    parserVersion: "openai-native-v1",
    client: opts.client ?? createOpenAIClient(),
  });
}
