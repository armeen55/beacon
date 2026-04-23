import "server-only";

/**
 * OpenAI QueryClient — native polling for ChatGPT via the Responses API
 * with the built-in `web_search_preview` tool.
 *
 * Returns the same `{answer_text, citations, model}` shape every QueryClient
 * produces, so it slots into the existing native polling adapter without
 * special-casing.
 */

import type { QueryClient, CitationRef } from "./types";

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
};

/**
 * Extract answer text and citation refs from a Responses API response body.
 * Exported for unit testing — the network path is covered by integration at
 * the adapter/script level.
 */
export function parseOpenAIResponse(
  data: ResponsesApiResponse,
  fallbackModel: string,
): { answer_text: string; citations: CitationRef[]; model: string } {
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

  return {
    answer_text: answerText,
    citations,
    model: data.model ?? fallbackModel,
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
