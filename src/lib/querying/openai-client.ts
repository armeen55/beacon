import "server-only";

/**
 * OpenAI QueryClient — native polling for ChatGPT via the Responses API
 * with the built-in `web_search_preview` tool.
 *
 * Returns the same `{answer_text, citations, model}` shape every QueryClient
 * produces, so it slots into the existing native polling adapter without
 * special-casing.
 */

import type { QueryClient, CitationRef, QueryUsage } from "./types";

const OPENAI_RESPONSES_API = "https://api.openai.com/v1/responses";

function getApiKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error(
      "OPENAI_API_KEY not set. Add it to .env.local to enable native ChatGPT polling.",
    );
  }
  return key;
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * Responses API payload shapes we care about. Typed loosely — we only read
 * the fields we need and tolerate extras.
 */
type ResponsesApiOutputItem =
  | { type: "web_search_call"; [k: string]: unknown }
  | {
      type: "message";
      role?: string;
      content?: Array<{
        type: string;
        text?: string;
        annotations?: Array<{
          type: string;
          url?: string;
          title?: string | null;
          [k: string]: unknown;
        }>;
      }>;
      [k: string]: unknown;
    }
  | { type: string; [k: string]: unknown };

type ResponsesApiResponse = {
  id?: string;
  model?: string;
  output?: ResponsesApiOutputItem[];
  /**
   * Sprint 6A.3a (2026-04-26): Responses API usage object. Optional
   * because some response shapes / mock servers omit it; the parser
   * tolerates absence and emits `usage = undefined` on the result.
   */
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
};

/**
 * Extract answer text and citation refs from a Responses API response body.
 * Exported for unit testing — the network path is covered by integration at
 * the adapter/script level.
 *
 * Sprint 6A.3a (2026-04-26): also surfaces optional `usage` derived from
 * the Responses API `usage` object plus a count of `web_search_call`
 * items in `output[]`. When `data.usage` is missing entirely, `usage` on
 * the return is `undefined` (not a zero-filled object) — downstream
 * estimator treats absence as "don't track this call against the
 * budget." See `src/lib/cost/pricing.ts` for the conservative fallback.
 */
export function parseOpenAIResponse(
  data: ResponsesApiResponse,
  fallbackModel: string,
): {
  answer_text: string;
  citations: CitationRef[];
  model: string;
  usage?: QueryUsage;
} {
  const outputs = data.output ?? [];
  const message = outputs.find(
    (o): o is Extract<ResponsesApiOutputItem, { type: "message" }> =>
      o.type === "message",
  );
  const textBlock = message?.content?.find(
    (c) => c.type === "output_text" && typeof c.text === "string",
  );
  const answerText = textBlock?.text ?? "";

  const annotations = textBlock?.annotations ?? [];
  const urlCitations = annotations.filter(
    (a) => a.type === "url_citation" && typeof a.url === "string",
  );

  const citations: CitationRef[] = urlCitations.map((a, i) => ({
    url: a.url as string,
    domain: extractDomain(a.url as string),
    title: typeof a.title === "string" ? a.title : null,
    position: i + 1,
  }));

  // Web-search invocations: count `web_search_call` items in output[].
  // The Responses API emits one of these per tool invocation; the model
  // may invoke 0, 1, or several per prompt. Counting from `output[]`
  // matches what OpenAI bills the operator for.
  const webSearchCalls = outputs.filter(
    (o) => o.type === "web_search_call",
  ).length;

  const usage: QueryUsage | undefined = data.usage
    ? {
        inputTokens: data.usage.input_tokens ?? 0,
        outputTokens: data.usage.output_tokens ?? 0,
        webSearchCalls,
      }
    : undefined;

  return {
    answer_text: answerText,
    citations,
    model: data.model ?? fallbackModel,
    usage,
  };
}

export function createOpenAIClient(model = "gpt-4o"): QueryClient {
  return {
    platform: "chatgpt",
    model,

    async sample(prompt: string) {
      const apiKey = getApiKey();

      const response = await fetch(OPENAI_RESPONSES_API, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          input: prompt,
          tools: [{ type: "web_search_preview" }],
        }),
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(
          `OpenAI API error ${response.status}: ${body.slice(0, 200)}`,
        );
      }

      const data = (await response.json()) as ResponsesApiResponse;
      return parseOpenAIResponse(data, model);
    },
  };
}
