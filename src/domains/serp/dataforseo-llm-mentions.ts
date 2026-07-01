import "server-only";

import { log } from "@/lib/logger";
import { readStore, writeStore } from "@/lib/persistence/json-store";
import { currentTenantId } from "@/lib/tenant-context";
import { recordSpendSupabase, getTenantSpentThisMonthUsd } from "@/lib/cost/budget-ledger-supabase";
import { resolveAuthB64, isDataForSeoConfigured, isDryRun, monthlyCapUsd } from "./dataforseo-serp";

/**
 * dataforseo-llm-mentions (2026-07-01, R4 / item 82) - the owned AI-visibility
 * producer. Asks a real LLM (through DataForSEO's ai_optimization API, verified
 * live on this account) a natural question about a topic with web search FORCED
 * on, then extracts which DOMAINS the answer cites. This is the paid, owned
 * counterpart to Profound: "when an AI answers a question about my topic, whose
 * sites does it point people to?"
 *
 * Reuses the exact money gauntlet of dataforseo-keywords (configured -> cache ->
 * DRY-RUN default -> hard monthly cap fail-CLOSED -> fetch -> record spend ->
 * cache). Spend rides the SHARED "dataforseo-serp" ledger platform so ONE
 * monthly cap governs ALL DataForSEO calls. Every dependency is injectable so
 * tests never spend a cent.
 *
 * Endpoint reality (probed 2026-07-01): POST
 * https://api.dataforseo.com/v3/ai_optimization/chat_gpt/llm_responses/live
 * works on this account. A forced-web-search gpt-4o-mini call cost $0.0271;
 * without forcing search the model often answers from memory and returns zero
 * citations, so we always force. Override the endpoint with the env var
 * DATAFORSEO_LLM_MENTIONS_PATH (full URL, or a /v3/... path) if DataForSEO
 * moves it or we want a different engine (claude / gemini / perplexity).
 */

// Probe-measured: $0.0271 per forced-web-search gpt-4o-mini call. Round UP so
// the shared cap trips early, not late. The ledger records the API's real
// price field when present, so the ledger stays honest even if this drifts.
export const LLM_MENTIONS_COST_USD = 0.03;
const MENTIONS_STORE = "dataforseo-llm-mentions";
const MENTIONS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_ENDPOINT = "https://api.dataforseo.com/v3/ai_optimization/chat_gpt/llm_responses/live";
const DEFAULT_MODEL = "gpt-4o-mini"; // cheapest model with web_search support
const MAX_OUTPUT_TOKENS = 600;
/** Hard ceiling on topics per run - bounds worst-case spend to 5 x $0.03. */
const MAX_TOPICS_PER_RUN = 5;

export type LlmMention = {
  /** Bare hostname the answer cited, lowercased, "www." stripped. */
  domain: string;
  /** How many distinct URLs on that domain the answer cited. */
  count: number;
};

export type LlmMentionRecord = {
  topic: string;
  /** The natural question we asked the LLM. */
  question: string;
  mentions: LlmMention[];
  /** The exact model that answered (from the API response). */
  model: string;
  /** First slice of the answer text, kept as human-readable evidence. */
  answerExcerpt: string;
  /** True when the model actually ran a web search (citations are real). */
  usedWebSearch: boolean;
  source: "dataforseo";
  fetchedAt: string;
  evidenceRef: string;
};

export type LlmMentionsPlan = {
  endpoint: string;
  topics: string[];
  model: string;
  estCostPerTopicUsd: number;
  estCostUsd: number;
};

export type LlmMentionsRunStatus = "disabled" | "cache_hit" | "dry_run" | "capped" | "ok" | "error";
export type LlmMentionsRunResult = {
  status: LlmMentionsRunStatus;
  plan: LlmMentionsPlan;
  records: LlmMentionRecord[];
  costUsd: number;
  detail: string;
};

function normTopic(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/** The natural question we ask per topic. Asking for sources plus forcing web
 *  search is what makes the answer cite real domains instead of book titles. */
export function questionForTopic(topic: string): string {
  return `What are the best websites and resources to learn about ${topic}? Please cite sources.`;
}

function resolveEndpoint(env: NodeJS.ProcessEnv): string {
  const raw = (env.DATAFORSEO_LLM_MENTIONS_PATH ?? "").trim();
  if (!raw) return DEFAULT_ENDPOINT;
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://api.dataforseo.com/${raw.replace(/^\//, "")}`;
}

/** Build the planned call (endpoint + estimated cost) without performing it. */
export function planLlmMentionsCall(
  topics: string[],
  opts: { model?: string; env?: NodeJS.ProcessEnv } = {},
): LlmMentionsPlan {
  const cleaned = [...new Set(topics.map(normTopic).filter((t) => t.length >= 2))].slice(0, MAX_TOPICS_PER_RUN);
  return {
    endpoint: resolveEndpoint(opts.env ?? process.env),
    topics: cleaned,
    model: opts.model ?? DEFAULT_MODEL,
    estCostPerTopicUsd: LLM_MENTIONS_COST_USD,
    estCostUsd: Math.round(cleaned.length * LLM_MENTIONS_COST_USD * 1000) / 1000,
  };
}

type CacheRow = { key: string; record: LlmMentionRecord; fetchedAt: string };
const cacheKey = (model: string, topic: string): string => `${model}|${topic}`;

function domainOfUrl(raw: string): string | null {
  try {
    const host = new URL(raw).hostname.toLowerCase().replace(/^www\./, "");
    return host.includes(".") ? host : null;
  } catch {
    return null;
  }
}

/**
 * Parse one llm_responses body into {mentions, model, answerText, ...}. PURE.
 * Mentions come from (a) every URL in the answer text and (b) every citation
 * annotation, deduped by exact URL so a markdown link that is also annotated
 * counts once. Brands named without a URL are NOT counted - we only report
 * what we can verify, never a guessed brand match. Malformed body -> empty.
 */
export function parseLlmMentions(body: unknown): {
  mentions: LlmMention[];
  model: string | null;
  answerText: string;
  usedWebSearch: boolean;
  actualCostUsd: number | null;
} {
  const empty = { mentions: [], model: null, answerText: "", usedWebSearch: false, actualCostUsd: null };
  try {
    const top = body as { cost?: unknown; tasks?: Array<{ result?: Array<Record<string, unknown>> }> };
    const result = top?.tasks?.[0]?.result?.[0];
    if (!result) return empty;

    const model = typeof result.model_name === "string" ? result.model_name : null;
    const usedWebSearch = result.web_search === true;
    const actualCostUsd = typeof top.cost === "number" && Number.isFinite(top.cost) ? top.cost : null;

    // Collect the answer text and citation URLs from every message section.
    let answerText = "";
    const annotationUrls: string[] = [];
    const items = Array.isArray(result.items) ? (result.items as Array<Record<string, unknown>>) : [];
    for (const item of items) {
      const sections = Array.isArray(item.sections) ? (item.sections as Array<Record<string, unknown>>) : [];
      for (const section of sections) {
        if (typeof section.text === "string") answerText += (answerText ? "\n" : "") + section.text;
        const anns = Array.isArray(section.annotations) ? (section.annotations as Array<Record<string, unknown>>) : [];
        for (const ann of anns) {
          if (typeof ann.url === "string" && ann.url) annotationUrls.push(ann.url);
        }
      }
    }

    // URLs in the prose (markdown links etc.), then annotations not already in it.
    const textUrls = answerText.match(/https?:\/\/[^\s)"'\]<>]+/g) ?? [];
    const seen = new Set(textUrls);
    const urls = [...textUrls];
    for (const u of annotationUrls) {
      if (!seen.has(u)) {
        seen.add(u);
        urls.push(u);
      }
    }

    const counts = new Map<string, number>();
    for (const u of urls) {
      const domain = domainOfUrl(u);
      if (!domain) continue;
      counts.set(domain, (counts.get(domain) ?? 0) + 1);
    }
    const mentions = [...counts.entries()]
      .map(([domain, count]) => ({ domain, count }))
      .sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain));

    return { mentions, model, answerText, usedWebSearch, actualCostUsd };
  } catch {
    return empty; // malformed body -> empty (honest, never throws)
  }
}

/**
 * Read ALL fresh cached mention records (no call, NO spend) - deduped by topic
 * (newest wins), stale rows (>7d) dropped. Lets any surface show "who AI cites
 * for this topic" on render at $0. Fail-soft -> [].
 */
export async function readAllCachedLlmMentions(
  deps: { now?: () => Date; readCache?: () => Promise<CacheRow[]> } = {},
): Promise<LlmMentionRecord[]> {
  const nowMs = (deps.now ?? (() => new Date()))().getTime();
  let rows: CacheRow[];
  try {
    rows = await (deps.readCache ?? defaultDeps.readCache)();
  } catch {
    return [];
  }
  const byTopic = new Map<string, LlmMentionRecord>();
  for (const r of rows) {
    if (nowMs - Date.parse(r.fetchedAt) >= MENTIONS_TTL_MS) continue; // stale row
    const prev = byTopic.get(r.record.topic);
    if (!prev || Date.parse(r.record.fetchedAt) > Date.parse(prev.fetchedAt)) byTopic.set(r.record.topic, r.record);
  }
  return [...byTopic.values()];
}

export type LlmMentionsRunDeps = {
  env: NodeJS.ProcessEnv;
  now: () => Date;
  tenantId: () => Promise<string>;
  spentThisMonthUsd: (tenantId: string, now: Date) => Promise<number | null>;
  recordSpend: (tenantId: string, costUsd: number) => Promise<void>;
  readCache: () => Promise<CacheRow[]>;
  writeCache: (rows: CacheRow[]) => Promise<void>;
  fetchImpl: typeof fetch;
};

const defaultDeps: LlmMentionsRunDeps = {
  env: process.env,
  now: () => new Date(),
  tenantId: currentTenantId,
  // SHARED DataForSEO budget: cap + spend both ride the "dataforseo-serp"
  // platform so all DataForSEO calls draw from ONE monthly cap.
  spentThisMonthUsd: (t, now) => getTenantSpentThisMonthUsd(t, now, "dataforseo-serp"),
  recordSpend: (tenantId, costUsd) => recordSpendSupabase({ tenantId, platform: "dataforseo-serp", costUsd }),
  readCache: () => readStore<CacheRow>(MENTIONS_STORE, []),
  writeCache: (rows) => writeStore(MENTIONS_STORE, rows),
  fetchImpl: fetch,
};

/**
 * Ask the LLM which domains it cites for each topic, through the full safety
 * gauntlet. Never throws. Spends real money ONLY when configured + not dry-run
 * + under cap + cache miss, one bounded call per uncached topic. The cap is
 * re-checked before EVERY call so a multi-topic run can never blow past it.
 */
export async function runLlmMentions(
  topics: string[],
  opts: { model?: string } = {},
  depsOverride: Partial<LlmMentionsRunDeps> = {},
): Promise<LlmMentionsRunResult> {
  const deps = { ...defaultDeps, ...depsOverride };
  const plan = planLlmMentionsCall(topics, { model: opts.model, env: deps.env });
  if (plan.topics.length === 0) {
    return { status: "error", plan, records: [], costUsd: 0, detail: "no usable topics" };
  }
  if (!isDataForSeoConfigured(deps.env)) {
    return { status: "disabled", plan, records: [], costUsd: 0, detail: "DataForSEO not configured" };
  }

  const now = deps.now();
  const nowMs = now.getTime();

  // (2) cache - serve fresh topics without spending; only misses go further.
  const cachedRecords: LlmMentionRecord[] = [];
  let missTopics: string[] = plan.topics;
  try {
    const rows = await deps.readCache();
    const fresh = new Map<string, LlmMentionRecord>();
    for (const r of rows) {
      if (nowMs - Date.parse(r.fetchedAt) < MENTIONS_TTL_MS) fresh.set(r.key, r.record);
    }
    missTopics = [];
    for (const topic of plan.topics) {
      const hit = fresh.get(cacheKey(plan.model, topic));
      if (hit) cachedRecords.push(hit);
      else missTopics.push(topic);
    }
    if (missTopics.length === 0) {
      log.info("[dataforseo-llm-mentions] cache hit", { topics: plan.topics.length });
      return { status: "cache_hit", plan, records: cachedRecords, costUsd: 0, detail: "served from 7d cache" };
    }
  } catch {
    /* non-fatal - treat every topic as a miss */
  }

  // (3) DRY-RUN (default) - return the plan + any cached records, spend nothing.
  if (isDryRun(deps.env)) {
    const wouldSpend = Math.round(missTopics.length * plan.estCostPerTopicUsd * 1000) / 1000;
    log.info("[dataforseo-llm-mentions] DRY-RUN (no spend)", { misses: missTopics.length, estCostUsd: wouldSpend });
    return { status: "dry_run", plan, records: cachedRecords, costUsd: 0, detail: `dry-run - would spend ~$${wouldSpend}` };
  }

  // (4) hard monthly cap - FAIL-CLOSED.
  const tenantId = await deps.tenantId();
  const cap = monthlyCapUsd(deps.env);
  const spent = await deps.spentThisMonthUsd(tenantId, now).catch(() => null);
  if (spent === null) {
    log.warn("[dataforseo-llm-mentions] spend unknown - failing closed", { tenantId });
    return { status: "capped", plan, records: cachedRecords, costUsd: 0, detail: "monthly spend unknown - failing closed" };
  }

  // (5) the paid calls - one per uncached topic, cap re-checked before each.
  const liveRecords: LlmMentionRecord[] = [];
  const newRows: CacheRow[] = [];
  let costUsd = 0;
  let failures = 0;
  let cappedMidRun = false;
  const auth = resolveAuthB64(deps.env) ?? "";

  for (const topic of missTopics) {
    if (spent + costUsd + plan.estCostPerTopicUsd > cap) {
      cappedMidRun = true;
      log.warn("[dataforseo-llm-mentions] monthly cap reached - stopping", { tenantId, spent, costUsd, cap });
      break;
    }
    const question = questionForTopic(topic);
    try {
      const res = await deps.fetchImpl(plan.endpoint, {
        method: "POST",
        headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
        body: JSON.stringify([
          {
            user_prompt: question,
            model_name: plan.model,
            max_output_tokens: MAX_OUTPUT_TOKENS,
            web_search: true,
            force_web_search: true,
          },
        ]),
      });
      if (!res.ok) {
        failures += 1;
        log.warn("[dataforseo-llm-mentions] non-2xx", { topic, status: res.status });
        continue;
      }
      const body = await res.json();
      const parsed = parseLlmMentions(body);

      // Honest ledger: prefer the API's real price field over our estimate.
      const callCost = parsed.actualCostUsd ?? plan.estCostPerTopicUsd;
      if (callCost > 0) {
        costUsd += callCost;
        await deps.recordSpend(tenantId, callCost).catch((err) =>
          log.warn("[dataforseo-llm-mentions] durable spend write failed (non-fatal)", { error: String(err) }),
        );
      }

      if (!parsed.answerText) {
        failures += 1;
        log.warn("[dataforseo-llm-mentions] empty answer (task error?)", { topic });
        continue;
      }
      const record: LlmMentionRecord = {
        topic,
        question,
        mentions: parsed.mentions,
        model: parsed.model ?? plan.model,
        answerExcerpt: parsed.answerText.slice(0, 400),
        usedWebSearch: parsed.usedWebSearch,
        source: "dataforseo",
        fetchedAt: now.toISOString(),
        evidenceRef: "dataforseo:ai_optimization/llm_responses",
      };
      liveRecords.push(record);
      newRows.push({ key: cacheKey(plan.model, topic), record, fetchedAt: now.toISOString() });
    } catch (err) {
      failures += 1;
      log.warn("[dataforseo-llm-mentions] fetch threw (non-fatal)", {
        topic,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Cache what we got (replace same-key rows), even on a partial run.
  if (newRows.length > 0) {
    try {
      const replaced = new Set(newRows.map((r) => r.key));
      const rows = (await deps.readCache()).filter((r) => !replaced.has(r.key));
      await deps.writeCache([...rows, ...newRows]);
    } catch {
      /* non-fatal */
    }
  }

  const records = [...cachedRecords, ...liveRecords];
  log.info("[dataforseo-llm-mentions] LEDGER", {
    tenantId,
    endpoint: plan.endpoint,
    model: plan.model,
    requested: plan.topics.length,
    cached: cachedRecords.length,
    live: liveRecords.length,
    failures,
    costUsd: Math.round(costUsd * 10000) / 10000,
    cappedMidRun,
  });

  if (liveRecords.length > 0) {
    return { status: "ok", plan, records, costUsd, detail: `${liveRecords.length} live + ${cachedRecords.length} cached` };
  }
  if (cappedMidRun || spent + plan.estCostPerTopicUsd > cap) {
    return { status: "capped", plan, records, costUsd, detail: `cap reached (${spent.toFixed(3)}/${cap} USD this month)` };
  }
  return { status: "error", plan, records, costUsd, detail: "all live calls failed" };
}
