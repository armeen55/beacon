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
  | {
      type: "web_search_call";
      id?: string;
      status?: string;
      action?: {
        type?: string;
        query?: string;
        url?: string;
        [k: string]: unknown;
      };
      [k: string]: unknown;
    }
  | {
      type: "message";
      role?: string;
      finish_reason?: string;
      content?: Array<{
        type: string;
        text?: string;
        refusal?: string;
        annotations?: Array<{
          type: string;
          url?: string;
          title?: string | null;
          [k: string]: unknown;
        }>;
        [k: string]: unknown;
      }>;
      [k: string]: unknown;
    }
  | { type: string; [k: string]: unknown };

type ResponsesApiResponse = {
  id?: string;
  model?: string;
  output?: ResponsesApiOutputItem[];
  /**
   * Sprint 6A.2g.D (2026-04-26) — surfaced for max-extraction. Both top-
   * level fields are optional — older models / smaller mocks may omit
   * them and the parser tolerates absence.
   */
  system_fingerprint?: string | null;
  service_tier?: string | null;
  /**
   * Sprint 6A.2g.D — some Responses API surfaces emit `finish_reason` at
   * the top level alongside the message item. We accept both; the
   * parser checks the message item first, then falls back here.
   */
  finish_reason?: string;
  /**
   * Sprint 6A.3a (2026-04-26): Responses API usage object. Optional
   * because some response shapes / mock servers omit it; the parser
   * tolerates absence and emits `usage = undefined` on the result.
   *
   * Sprint 6A.2g.D (2026-04-26) — extended with reasoning + cached
   * token breakdowns. Both nested objects optional.
   */
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    input_tokens_details?: {
      cached_tokens?: number;
      [k: string]: unknown;
    };
    output_tokens_details?: {
      reasoning_tokens?: number;
      [k: string]: unknown;
    };
  };
};

/**
 * Sprint 6A.2g.D (2026-04-26) — cap on `providerRaw.toolCalls` items.
 * Operator-locked at 20 (Q2): every web_search_call beyond the 20th is
 * dropped and `truncated` flips to true. The extracted `webSearchQueries`
 * array carries the same data normalized at full length — this cap only
 * bounds the verbatim forensic blob.
 */
const MAX_PROVIDER_RAW_TOOL_CALLS = 20;

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
  const webSearchCallItems = outputs.filter(
    (o): o is Extract<ResponsesApiOutputItem, { type: "web_search_call" }> =>
      o.type === "web_search_call",
  );
  const webSearchCalls = webSearchCallItems.length;

  // Sprint 6A.2g.D (2026-04-26) — max-extraction. Pull every durable
  // signal the Responses API surfaces. Beacon paid for the call; we
  // store every useful field so downstream packet-builders + operator
  // forensics can reuse it without re-querying. Honest blind spots are
  // surfaced upstream (Perplexity Sonar) by leaving these undefined.
  const webSearchQueries: NonNullable<QueryUsage["webSearchQueries"]> =
    webSearchCallItems.map((item) => ({
      id: typeof item.id === "string" ? item.id : undefined,
      // Preserve verbatim — including "in_progress" — so the operator
      // can see when a tool call started but didn't complete.
      status: typeof item.status === "string" ? item.status : "unknown",
      actionType:
        typeof item.action?.type === "string" ? item.action.type : undefined,
      query:
        typeof item.action?.query === "string" ? item.action.query : undefined,
      url:
        typeof item.action?.url === "string" ? item.action.url : undefined,
    }));

  const openPageUrlSet = new Set<string>();
  const openPageUrls: string[] = [];
  for (const q of webSearchQueries) {
    if (
      q.actionType === "open_page" &&
      typeof q.url === "string" &&
      q.url.length > 0 &&
      !openPageUrlSet.has(q.url)
    ) {
      openPageUrlSet.add(q.url);
      openPageUrls.push(q.url);
    }
  }

  const messageFinishReason =
    typeof message?.finish_reason === "string"
      ? message.finish_reason
      : undefined;
  const topLevelFinishReason =
    typeof data.finish_reason === "string" ? data.finish_reason : undefined;
  const finishReason = messageFinishReason ?? topLevelFinishReason ?? null;

  // Refusal text lives on a content block with `type: "refusal"` OR a
  // `refusal` field on a content block. We accept either shape.
  let refusalText: string | null = null;
  if (message?.content) {
    for (const c of message.content) {
      if (typeof c.refusal === "string" && c.refusal.length > 0) {
        refusalText = c.refusal;
        break;
      }
      if (
        c.type === "refusal" &&
        typeof (c as { text?: string }).text === "string"
      ) {
        refusalText = (c as { text?: string }).text ?? null;
        break;
      }
    }
  }

  const reasoningTokens =
    typeof data.usage?.output_tokens_details?.reasoning_tokens === "number"
      ? data.usage.output_tokens_details.reasoning_tokens
      : 0;
  const cachedTokens =
    typeof data.usage?.input_tokens_details?.cached_tokens === "number"
      ? data.usage.input_tokens_details.cached_tokens
      : 0;

  const truncated = webSearchCallItems.length > MAX_PROVIDER_RAW_TOOL_CALLS;
  const providerRawToolCalls = truncated
    ? webSearchCallItems.slice(0, MAX_PROVIDER_RAW_TOOL_CALLS)
    : webSearchCallItems;

  const usage: QueryUsage | undefined = data.usage
    ? {
        inputTokens: data.usage.input_tokens ?? 0,
        outputTokens: data.usage.output_tokens ?? 0,
        webSearchCalls,
        webSearchQueries,
        openPageUrls,
        systemFingerprint:
          typeof data.system_fingerprint === "string"
            ? data.system_fingerprint
            : null,
        serviceTier:
          typeof data.service_tier === "string" ? data.service_tier : null,
        reasoningTokens,
        cachedTokens,
        refusalText,
        finishReason,
        providerRaw: {
          toolCalls: providerRawToolCalls,
          truncated,
          responseId: typeof data.id === "string" ? data.id : null,
        },
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
