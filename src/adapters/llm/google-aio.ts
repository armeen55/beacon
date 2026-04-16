/**
 * CX2.3 — Google AI Overviews adapter (via SerpAPI).
 *
 * Queries Google Search via SerpAPI and extracts the AI Overview panel
 * (if present) including its source citations. Falls back to organic
 * result citations when no AI Overview is shown.
 *
 * API: https://serpapi.com/search-api
 * Cost: ~$0.002 per search (SerpAPI pricing).
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

const SERPAPI_URL = "https://serpapi.com/search.json";

function getApiKey(): string {
  const key = process.env.SERPAPI_KEY;
  if (!key) throw new Error("SERPAPI_KEY not set");
  return key;
}

function hashResponse(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

// ---------------------------------------------------------------------------
// SerpAPI response parsing
// ---------------------------------------------------------------------------

type SerpApiResponse = {
  ai_overview?: {
    text?: string;
    text_with_references?: string;
    sources?: Array<{
      link?: string;
      title?: string;
      snippet?: string;
    }>;
  };
  organic_results?: Array<{
    link?: string;
    title?: string;
    snippet?: string;
    position?: number;
  }>;
  knowledge_graph?: {
    title?: string;
    description?: string;
    source?: { link?: string };
  };
};

function extractAioText(data: SerpApiResponse): string {
  // Prefer AI Overview text
  if (data.ai_overview?.text) return data.ai_overview.text;
  if (data.ai_overview?.text_with_references) {
    return data.ai_overview.text_with_references;
  }
  // Fallback: concatenate top 3 organic snippets
  const snippets = (data.organic_results ?? [])
    .slice(0, 3)
    .map((r) => r.snippet ?? "")
    .filter(Boolean);
  return snippets.join(" ");
}

function extractCitations(
  data: SerpApiResponse,
  tenantDomain: string,
): NormalizedCitation[] {
  const citations: NormalizedCitation[] = [];
  const seen = new Set<string>();

  // AI Overview sources (highest priority)
  for (const src of data.ai_overview?.sources ?? []) {
    if (src.link && !seen.has(src.link)) {
      seen.add(src.link);
      citations.push({
        url: src.link,
        title: src.title ?? null,
        position: citations.length + 1,
        is_owned: isOwnedUrl(src.link, tenantDomain),
      });
    }
  }

  // Organic results (if no AIO sources, or as supplemental)
  for (const result of data.organic_results ?? []) {
    if (result.link && !seen.has(result.link)) {
      seen.add(result.link);
      citations.push({
        url: result.link,
        title: result.title ?? null,
        position: result.position ?? citations.length + 1,
        is_owned: isOwnedUrl(result.link, tenantDomain),
      });
    }
  }

  // Knowledge graph link
  if (data.knowledge_graph?.source?.link) {
    const link = data.knowledge_graph.source.link;
    if (!seen.has(link)) {
      citations.push({
        url: link,
        title: data.knowledge_graph.title ?? null,
        position: null,
        is_owned: isOwnedUrl(link, tenantDomain),
      });
    }
  }

  return citations;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export const googleAioAdapter: PlatformAdapter = {
  platform: "google_aio",

  estimateCostUsd(): number {
    return 0.002;
  },

  async query(opts: AdapterQueryOpts): Promise<AdapterResult> {
    const start = Date.now();
    const apiKey = getApiKey();

    const params = new URLSearchParams({
      api_key: apiKey,
      q: opts.prompt,
      engine: "google",
      gl: "us",
      hl: "en",
      num: "10",
    });

    const response = await fetch(`${SERPAPI_URL}?${params.toString()}`, {
      method: "GET",
      signal: opts.signal,
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => "");
      const retryable = response.status === 429 || response.status >= 500;
      throw Object.assign(
        new Error(
          `SerpAPI ${response.status}: ${errBody.slice(0, 200)}`,
        ),
        { code: `SERPAPI_${response.status}`, retryable },
      );
    }

    const data = (await response.json()) as SerpApiResponse;
    const latencyMs = Date.now() - start;

    const answerText = extractAioText(data);
    const citations = extractCitations(data, opts.tenantDomain);

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

    // Extract competitor entities from non-owned citations
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
      "nextdoor.com",
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

    return { observation, cost_usd: 0.002, latency_ms: latencyMs };
  },
};
