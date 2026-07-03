import "server-only";

/**
 * SERP hypothesis (TASK 2 — resolve "SERP unknown" inside the Workbench).
 *
 * Generates a per-query, clearly-labeled SYNTHETIC hypothesis of which SERP
 * features (AI Overview / featured snippet / image pack / knowledge panel / PAA
 * / video / local / shopping) likely sit above the organic results for a locked
 * page's top queries, and whether a feature likely OWNS the clicks (so a title
 * rewrite would not recover them).
 *
 * HARD CONSTRAINTS (manual §4 SERP guard):
 *   • Workbench-only, operator-triggered. NEVER runs in the broad scan.
 *   • NO paid SERP API, NO live SERP fetch. This is the model's general
 *     knowledge of how Google SERPs typically look for such queries.
 *   • source is ALWAYS "synthetic"; serpStatus is "suspected" or "unknown",
 *     NEVER "observed" (we have no real SERP/Profound data here).
 *   • confidence is "low" by default, "medium" only for highly characteristic
 *     queries (e.g. a country flag → image pack). Never "high".
 *   • Fail-soft: any error / no key / bad output → null (caller stays "unknown").
 *   • No em dashes in any generated copy.
 */

import { log } from "@/lib/logger";
import { estimateCost, openAIChatCompletion, recordGatewaySpend } from "@/domains/llm/gateway";

const DEFAULT_MODEL = "gpt-5-mini";

export const SERP_FEATURES = [
  "ai_overview",
  "featured_snippet",
  "image_pack",
  "knowledge_panel",
  "people_also_ask",
  "video",
  "local_pack",
  "shopping",
  "top_stories",
  "none",
] as const;
export type SerpFeature = (typeof SERP_FEATURES)[number];

export type SerpQueryHypothesis = {
  query: string;
  likelyFeatures: SerpFeature[];
  /** A SERP feature likely owns the answer → a title rewrite won't recover clicks. */
  featureLikelyOwnsAnswer: boolean;
  clickLossCause: string;
  confidence: "low" | "medium";
  rationale: string;
  /** Concrete way the operator can VERIFY this (the synthetic is never the truth). */
  recommendedCheck: string;
};

export type SerpHypothesis = {
  /** ALWAYS synthetic — an LLM hypothesis, never observed fact. */
  source: "synthetic";
  /** "suspected" once we have a hypothesis; never "observed". */
  serpStatus: "suspected" | "unknown";
  /** True when ANY top query is likely feature-owned. */
  featureLikelyOwnsAnswer: boolean;
  summary: string;
  queries: SerpQueryHypothesis[];
  /** ISO stamp; the caller sets this (kept out of the pure parser). */
  generatedAt: string | null;
};

export type SerpHypothesisInput = {
  pagePath: string;
  pageType?: string | null;
  currentTitle?: string | null;
  currentMeta?: string | null;
  currentH1?: string | null;
  /** Top GSC queries for the page (already capped by the caller to 5). */
  queries: Array<{ query: string; position: number; impressions: number; ctr: number }>;
  /** Queries where the tenant's own pages compete (cannibalization), if known. */
  cannibalizingQueries?: string[];
};

/** Hard cap — the synthetic check costs one LLM call over at most this many queries. */
export const MAX_SERP_QUERIES = 5;

const SYSTEM_PROMPT = `
You are an SEO analyst forming a HYPOTHESIS about the Google search results page
(SERP) for a few queries. You CANNOT see the live SERP. Use only your general
knowledge of how Google results typically look for queries of each kind. Your
output is a labeled hypothesis to be verified, NEVER a statement of observed fact.

For EACH query decide:
- likely_features: which SERP features probably sit above or beside the organic
  results. Allowed: ai_overview, featured_snippet, image_pack, knowledge_panel,
  people_also_ask, video, local_pack, shopping, top_stories, none.
- feature_likely_owns_answer: true ONLY when a feature probably satisfies the
  searcher BEFORE they click an organic result (e.g. a flag/animal image query
  shows an image pack + knowledge panel; a definition query shows a featured
  snippet or AI Overview). If the query is a list / guide / commercial / nav
  intent that organic results still serve, set false.
- click_loss_cause: one short phrase for why CTR may be low (e.g. "image pack and
  knowledge panel answer the query above the organic link"), or "no obvious
  feature, likely a title or snippet issue" when none.
- confidence: "low" by default; "medium" only when the query is highly
  characteristic of a feature (a country/empire flag → image pack; "X meaning" ->
  featured snippet). Never higher than medium.
- rationale: one sentence, grounded in the query's intent.
- recommended_check: a concrete way the operator can verify on the live SERP
  (e.g. "Search the query in an incognito window; if an image pack or knowledge
  panel sits above the first organic link, the clicks are feature owned").

Then an overall:
- feature_likely_owns_answer: true if ANY query is likely feature owned.
- summary: one or two sentences, plain English.

HARD RULES:
- This is a HYPOTHESIS, not observed data. Do not claim certainty.
- Use ONLY the query text + intent. Do not invent metrics or cite data sources.
- Do NOT use em dashes anywhere in your output.
- Output ONE JSON object, no prose around it, with keys:
  queries (array of {query, likely_features (array of strings),
    feature_likely_owns_answer (boolean), click_loss_cause (string),
    confidence ("low"|"medium"), rationale (string), recommended_check (string)}),
  overall (object) with keys feature_likely_owns_answer (boolean), summary (string).
`;

const isFeature = (v: unknown): v is SerpFeature =>
  typeof v === "string" && (SERP_FEATURES as readonly string[]).includes(v);
const asStr = (v: unknown): string => (typeof v === "string" ? v.replace(/\s*[—–]\s*/g, ", ") : "");
const asConf = (v: unknown): "low" | "medium" => (v === "medium" ? "medium" : "low");

/**
 * Pure parser: narrow a raw model object into a labeled SerpHypothesis, keeping
 * only the queries that were asked. Returns null when nothing usable parsed.
 * generatedAt is left null (the caller stamps it). Always source:"synthetic".
 */
export function parseSerpHypothesis(
  raw: unknown,
  askedQueries: ReadonlyArray<string>,
): SerpHypothesis | null {
  if (raw == null || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const asked = new Set(askedQueries.map((q) => q.toLowerCase()));

  const rawQueries = Array.isArray(o.queries) ? o.queries : [];
  const queries: SerpQueryHypothesis[] = [];
  for (const rq of rawQueries) {
    if (rq == null || typeof rq !== "object") continue;
    const q = rq as Record<string, unknown>;
    const query = asStr(q.query);
    if (query.length === 0 || !asked.has(query.toLowerCase())) continue; // only asked queries
    const likelyFeatures = Array.isArray(q.likely_features)
      ? (q.likely_features.filter(isFeature) as SerpFeature[])
      : [];
    queries.push({
      query,
      likelyFeatures: likelyFeatures.length > 0 ? likelyFeatures : ["none"],
      featureLikelyOwnsAnswer: q.feature_likely_owns_answer === true,
      clickLossCause: asStr(q.click_loss_cause),
      confidence: asConf(q.confidence),
      rationale: asStr(q.rationale),
      recommendedCheck: asStr(q.recommended_check),
    });
  }
  if (queries.length === 0) return null;

  const overall = o.overall && typeof o.overall === "object" ? (o.overall as Record<string, unknown>) : {};
  const featureOwns =
    overall.feature_likely_owns_answer === true ||
    queries.some((q) => q.featureLikelyOwnsAnswer);

  return {
    source: "synthetic",
    serpStatus: "suspected", // a hypothesis exists now; never "observed"
    featureLikelyOwnsAnswer: featureOwns,
    summary: asStr(overall.summary) || "Synthetic SERP hypothesis from query intent.",
    queries,
    generatedAt: null,
  };
}

/**
 * Generate the synthetic SERP hypothesis for a page's top queries via the
 * analysis model. Operator-triggered only (the caller gates). Fail-soft → null.
 */
export async function generateSerpHypothesis(
  input: SerpHypothesisInput,
  deps?: { fetchImpl?: typeof fetch; model?: string; timeoutMs?: number },
): Promise<SerpHypothesis | null> {
  const queries = input.queries.slice(0, MAX_SERP_QUERIES);
  if (queries.length === 0) return null;

  if (process.env.VITEST === "true" && !deps?.fetchImpl) return null;
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey && !deps?.fetchImpl) {
    log.warn("[serp-hypothesis] no OPENAI_API_KEY; cannot resolve SERP", { page: input.pagePath });
    return null;
  }

  const model = deps?.model ?? DEFAULT_MODEL;
  const timeoutMs = deps?.timeoutMs ?? 60_000;

  const userPayload = {
    page: input.pagePath,
    page_type: input.pageType ?? null,
    current_title: input.currentTitle ?? null,
    current_meta: input.currentMeta ?? null,
    current_h1: input.currentH1 ?? null,
    cannibalizing_queries: input.cannibalizingQueries ?? [],
    queries: queries.map((q) => ({
      query: q.query,
      position: Math.round(q.position * 10) / 10,
      impressions: q.impressions,
      ctr: Math.round(q.ctr * 1000) / 1000,
    })),
  };

  const body = {
    model,
    reasoning_effort: "low",
    messages: [
      { role: "system", content: SYSTEM_PROMPT.trim() },
      { role: "user", content: JSON.stringify(userPayload, null, 2) },
    ],
    response_format: { type: "json_object" },
    max_completion_tokens: 4_000,
  };

  try {
    // R16: transport via the ONE gateway. This operator-triggered check
    // previously had NO monthly cap - gateway_check closes that hole, and the
    // real spend is recorded from usage tokens below. Fail-soft stays null.
    const outcome = await openAIChatCompletion({
      promptId: "page_surgeon.serp_hypothesis",
      promptVersion: 1,
      action: "serp-hypothesis",
      apiKey: apiKey ?? "test",
      body,
      timeoutMs,
      budget: { mode: "gateway_check", projectedCostUsd: 0.01 },
      fetchImpl: deps?.fetchImpl,
    });
    if (outcome.kind !== "response") {
      log.warn("[serp-hypothesis] gateway fallback", {
        page: input.pagePath,
        reason: outcome.kind === "blocked_budget" ? `budget: ${outcome.reason}` : outcome.reason,
      });
      return null;
    }
    const res = outcome.response;
    if (!res.ok) {
      log.warn("[serp-hypothesis] non-2xx", { status: res.status, page: input.pagePath });
      return null;
    }
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    await recordGatewaySpend(
      estimateCost(model, json.usage?.prompt_tokens ?? 0, json.usage?.completion_tokens ?? 0),
    );
    const choice = json.choices?.[0];
    if (choice?.finish_reason === "length" || !choice?.message?.content) {
      log.warn("[serp-hypothesis] truncated/empty", { page: input.pagePath, finish: choice?.finish_reason });
      return null;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(choice.message.content);
    } catch {
      log.warn("[serp-hypothesis] content not JSON", { page: input.pagePath });
      return null;
    }
    const hyp = parseSerpHypothesis(parsed, queries.map((q) => q.query));
    return hyp;
  } catch (e) {
    log.warn("[serp-hypothesis] threw", { page: input.pagePath, error: e instanceof Error ? e.message : String(e) });
    return null;
  }
}
