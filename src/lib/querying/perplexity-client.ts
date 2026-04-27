import "server-only";

import type { QueryClient, CitationRef, QueryUsage } from "./types";

const PERPLEXITY_API_URL = "https://api.perplexity.ai/chat/completions";

function getApiKey(): string {
  const key = process.env.PERPLEXITY_API_KEY;
  if (!key) {
    throw new Error(
      "PERPLEXITY_API_KEY not set. Add it to .env.local to enable native querying.",
    );
  }
  return key;
}

type PerplexityMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type PerplexityResponse = {
  id: string;
  model: string;
  choices: Array<{
    message: { role: string; content: string };
    finish_reason: string;
  }>;
  citations?: string[];
  /**
   * Sprint 6A.3a (2026-04-26): Perplexity chat completions usage block.
   * Optional — same tolerance as the OpenAI parser. Sonar bundles search
   * cost into per-token pricing, so no separate web-search counter here.
   */
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function buildCitations(urls: string[] | undefined): CitationRef[] {
  if (!urls || urls.length === 0) return [];
  return urls.map((url, i) => ({
    url,
    domain: extractDomain(url),
    title: null,
    position: i + 1,
  }));
}

function extractEntities(text: string): string[] {
  const entities: string[] = [];
  const boldPattern = /\*\*([^*]+)\*\*/g;
  let match;
  while ((match = boldPattern.exec(text)) !== null) {
    const candidate = match[1].trim();
    if (candidate.length > 2 && candidate.length < 80) {
      entities.push(candidate);
    }
  }
  return [...new Set(entities)].slice(0, 50);
}

export function createPerplexityClient(
  model = "sonar",
): QueryClient {
  return {
    platform: "perplexity",
    model,

    async sample(prompt: string) {
      const apiKey = getApiKey();

      const messages: PerplexityMessage[] = [
        {
          role: "system",
          content:
            "You are a helpful assistant. Provide a thorough, factual answer with citations where relevant.",
        },
        { role: "user", content: prompt },
      ];

      const response = await fetch(PERPLEXITY_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: `sonar${model !== "sonar" ? `-${model}` : ""}`,
          messages,
          max_tokens: 2048,
        }),
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(
          `Perplexity API error ${response.status}: ${body.slice(0, 200)}`,
        );
      }

      const data = (await response.json()) as PerplexityResponse;
      const answerText =
        data.choices?.[0]?.message?.content ?? "";

      // Sprint 6A.3a — surface optional usage. Absent on legacy/mock
      // responses; downstream estimator treats absence as "don't book."
      const usage: QueryUsage | undefined = data.usage
        ? {
            inputTokens: data.usage.prompt_tokens ?? 0,
            outputTokens: data.usage.completion_tokens ?? 0,
            // Sonar bundles search cost into per-token pricing — no
            // separate web-search counter for Perplexity.
          }
        : undefined;

      return {
        answer_text: answerText,
        citations: buildCitations(data.citations),
        model: data.model || model,
        usage,
      };
    },
  };
}
