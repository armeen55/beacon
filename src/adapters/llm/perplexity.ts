/**
 * CX2.3 — Perplexity adapter.
 *
 * Calls the Perplexity API (sonar-pro model) which natively returns
 * citation URLs in its response structure. Perplexity is the cleanest
 * citation source — citations are first-class, not extracted from text.
 *
 * API: https://docs.perplexity.ai/reference/post_chat_completions
 * Cost estimate: ~$0.005-0.01 per query (cheaper than OpenAI).
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

const PERPLEXITY_API_URL =
  "https://api.perplexity.ai/chat/completions";
const PERPLEXITY_MODEL = "sonar-pro";

function getApiKey(): string {
  const key = process.env.PERPLEXITY_API_KEY;
  if (!key) throw new Error("PERPLEXITY_API_KEY not set");
  return key;
}

function hashResponse(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

// ---------------------------------------------------------------------------
// Response shape (Perplexity-specific)
// ---------------------------------------------------------------------------

type PerplexityResponse = {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
  citations?: string[]; // Perplexity returns citation URLs at top level
};

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export const perplexityAdapter: PlatformAdapter = {
  platform: "perplexity",

  estimateCostUsd(): number {
    return 0.005;
  },

  async query(opts: AdapterQueryOpts): Promise<AdapterResult> {
    const start = Date.now();
    const apiKey = getApiKey();

    const body = {
      model: PERPLEXITY_MODEL,
      messages: [
        {
          role: "user" as const,
          content: opts.prompt,
        },
      ],
    };

    const response = await fetch(PERPLEXITY_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: opts.signal,
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => "");
      const retryable = response.status === 429 || response.status >= 500;
      throw Object.assign(
        new Error(
          `Perplexity API ${response.status}: ${errBody.slice(0, 200)}`,
        ),
        { code: `PERPLEXITY_${response.status}`, retryable },
      );
    }

    const data = (await response.json()) as PerplexityResponse;
    const answerText = data.choices?.[0]?.message?.content ?? "";
    const latencyMs = Date.now() - start;

    // Perplexity returns citations as a top-level array of URLs.
    const rawCitations = data.citations ?? [];
    const citations: NormalizedCitation[] = rawCitations.map(
      (url, i) => ({
        url,
        title: null,
        position: i + 1,
        is_owned: isOwnedUrl(url, opts.tenantDomain),
      }),
    );

    const entities: NormalizedEntity[] = [];
    const brandMentioned = isMentioned(answerText, opts.brandAliases);
    const brandCited = citations.some((c) => c.is_owned);

    if (brandMentioned) {
      entities.push({
        name: opts.brandAliases[0] ?? "brand",
        type: "brand",
        mention_count: 1,
      });
    }

    // Extract competitor domains from non-owned, non-generic citations
    const genericDomains = new Set([
      "wikipedia.org",
      "yelp.com",
      "google.com",
      "reddit.com",
      "facebook.com",
      "bbb.org",
      "houzz.com",
      "angi.com",
      "homeadvisor.com",
      "thumbtack.com",
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
      entities.push({ name: domain, type: "competitor", mention_count: 1 });
    }

    const observation: NormalizedObservation = {
      answer_text: answerText,
      citations,
      entities_mentioned: entities,
      brand_mentioned: brandMentioned,
      brand_cited: brandCited,
      raw_response_hash: hashResponse(JSON.stringify(data)),
    };

    // Perplexity cost: ~$3/1M input + $15/1M output tokens (sonar-pro)
    // Rough estimate for a single query
    const costUsd = 0.005;

    return { observation, cost_usd: costUsd, latency_ms: latencyMs };
  },
};
