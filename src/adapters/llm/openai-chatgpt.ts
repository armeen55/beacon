/**
 * CX2.3 — OpenAI ChatGPT adapter.
 *
 * Calls the OpenAI Responses API (or Chat Completions with web search
 * tool) and extracts citations + brand mentions from the response.
 *
 * Model: configurable via OPENAI_MODEL env (default gpt-4o).
 * Requires web search / browsing to get citation URLs — without it
 * ChatGPT answers from training data only (no citations).
 *
 * Cost estimate: ~$0.01-0.03 per query depending on response length.
 */

import { createHash } from "node:crypto";
import type {
  PlatformAdapter,
  AdapterQueryOpts,
  AdapterResult,
} from "./types";
import type {
  NormalizedObservation,
  NormalizedCitation,
  NormalizedEntity,
} from "@/domains/prompts/contracts";
import { isMentioned, isOwnedUrl } from "@/domains/prompts/brand-resolver";

const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-4o";
const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";

function getApiKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY not set");
  return key;
}

function hashResponse(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

type ChatCompletionResponse = {
  choices: Array<{
    message: {
      content: string | null;
      annotations?: Array<{
        type: string;
        url?: string;
        title?: string;
      }>;
    };
  }>;
  usage?: { total_tokens: number };
};

function extractCitations(
  response: ChatCompletionResponse,
  tenantDomain: string,
): NormalizedCitation[] {
  const citations: NormalizedCitation[] = [];
  const seen = new Set<string>();

  // Extract from annotations (Responses API / web search tool)
  const annotations =
    response.choices?.[0]?.message?.annotations ?? [];
  for (const ann of annotations) {
    if (ann.type === "url_citation" && ann.url && !seen.has(ann.url)) {
      seen.add(ann.url);
      citations.push({
        url: ann.url,
        title: ann.title ?? null,
        position: citations.length + 1,
        is_owned: isOwnedUrl(ann.url, tenantDomain),
      });
    }
  }

  // Fallback: extract URLs from answer text if no annotations
  if (citations.length === 0) {
    const text = response.choices?.[0]?.message?.content ?? "";
    const urlPattern = /https?:\/\/[^\s\])>"]+/g;
    const matches = text.match(urlPattern) ?? [];
    for (const url of matches) {
      if (!seen.has(url)) {
        seen.add(url);
        citations.push({
          url,
          title: null,
          position: citations.length + 1,
          is_owned: isOwnedUrl(url, tenantDomain),
        });
      }
    }
  }

  return citations;
}

function extractEntities(
  text: string,
  brandAliases: string[],
  citations: NormalizedCitation[],
): NormalizedEntity[] {
  const entities: NormalizedEntity[] = [];
  const brandMentioned = isMentioned(text, brandAliases);

  if (brandMentioned) {
    entities.push({
      name: brandAliases[0] ?? "brand",
      type: "brand",
      mention_count: 1,
    });
  }

  // Extract competitor names from citation domains (non-owned, non-generic)
  const genericDomains = new Set([
    "wikipedia.org",
    "yelp.com",
    "google.com",
    "facebook.com",
    "bbb.org",
    "houzz.com",
    "angi.com",
    "homeadvisor.com",
    "thumbtack.com",
    "nextdoor.com",
    "buildzoom.com",
  ]);

  const competitorDomains = new Set<string>();
  for (const cit of citations) {
    if (cit.is_owned) continue;
    const domain = cit.url
      .replace(/^https?:\/\/(www\.)?/, "")
      .replace(/\/.*$/, "")
      .toLowerCase();
    if (!genericDomains.has(domain) && domain.length > 3) {
      competitorDomains.add(domain);
    }
  }

  for (const domain of competitorDomains) {
    entities.push({
      name: domain,
      type: "competitor",
      mention_count: 1,
    });
  }

  return entities;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export const openaiChatgptAdapter: PlatformAdapter = {
  platform: "chatgpt",

  estimateCostUsd(): number {
    return 0.02;
  },

  async query(opts: AdapterQueryOpts): Promise<AdapterResult> {
    const start = Date.now();
    const apiKey = getApiKey();

    const body = {
      model: OPENAI_MODEL,
      messages: [
        {
          role: "user" as const,
          content: opts.prompt,
        },
      ],
      // Enable web search for citation-bearing responses
      tools: [{ type: "web_search" as const }],
    };

    const response = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...(process.env.OPENAI_ORG_ID
          ? { "OpenAI-Organization": process.env.OPENAI_ORG_ID }
          : {}),
      },
      body: JSON.stringify(body),
      signal: opts.signal,
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => "");
      const retryable = response.status === 429 || response.status >= 500;
      throw Object.assign(
        new Error(
          `OpenAI API ${response.status}: ${errBody.slice(0, 200)}`,
        ),
        { code: `OPENAI_${response.status}`, retryable },
      );
    }

    const data = (await response.json()) as ChatCompletionResponse;
    const answerText = data.choices?.[0]?.message?.content ?? "";
    const latencyMs = Date.now() - start;

    const citations = extractCitations(data, opts.tenantDomain);
    const entities = extractEntities(
      answerText,
      opts.brandAliases,
      citations,
    );
    const brandMentioned = isMentioned(answerText, opts.brandAliases);
    const brandCited = citations.some((c) => c.is_owned);

    // Cost estimate from tokens (rough: $5/1M input + $15/1M output)
    const tokens = data.usage?.total_tokens ?? 1000;
    const costUsd = (tokens / 1_000_000) * 10; // blended average

    const observation: NormalizedObservation = {
      answer_text: answerText,
      citations,
      entities_mentioned: entities,
      brand_mentioned: brandMentioned,
      brand_cited: brandCited,
      raw_response_hash: hashResponse(JSON.stringify(data)),
    };

    return { observation, cost_usd: costUsd, latency_ms: latencyMs };
  },
};
