import "server-only";

/**
 * run-topic-mentions (RANK-8, 2026-07-06) - the nightly scheduler for the
 * competitor-AI-visibility topic poll (runLlmMentions in
 * dataforseo-llm-mentions.ts). That producer was fully built but had ZERO
 * callers - no cron, no route, no operator click - so the "which domains does
 * AI cite for this topic" cache stayed empty forever. Five surfaces already
 * READ that cache at $0 (war-room AI band, team standup, coverage map,
 * sov-weekly, second-order-citations); none of them ever FILLED it. This wires
 * the fill on a sane cadence.
 *
 * TOPICS: the top demand-node labels from the tenant's OWN demand graph (by
 * fused demand weight), which is exactly the set of topics the competitor teams
 * actually fight over. Real tracked questions ride along when a demand node
 * carries them, so the poll asks the real question people ask AI rather than the
 * canned best-websites template whenever it can.
 *
 * CADENCE + COST: runLlmMentions keeps a 7-DAY per-(model, topic) cache, so
 * running this nightly means ~6 of 7 nights are a $0 cache hit; only a topic
 * that has aged out spends. We cap at MAX_TOPICS_PER_RUN (5, the module's own
 * hard ceiling), bounding worst-case spend to 5 x $0.03 = $0.15 per tenant on
 * the ~1-in-7 night a topic refreshes. Every rail is respected and NONE is
 * loosened:
 *   - configured check     -> DataForSEO unconfigured = no-op, $0.
 *   - DRY-RUN default ON   -> dry-run = no-op, $0 (the pin).
 *   - 7d cache first       -> fresh topics never re-spend.
 *   - GLOBAL breaker (N43) -> consulted on the paid path BEFORE the per-platform
 *                             cap, fail-closed, hermetic under vitest.
 *   - shared monthly cap   -> re-checked before EVERY call inside runLlmMentions,
 *                             fail-closed on unknown spend.
 *   - honest receipt       -> the caller logs what it polled, skipped, and spent.
 *
 * Never throws; every dependency is injectable so tests never spend a cent.
 */

import { log } from "@/lib/logger";
import { loadDemandGraphForTenant } from "@/domains/demand-graph/load-graph";
import { assertPaidCallAllowed } from "@/domains/safety/cost-breaker";
import {
  runLlmMentions,
  MAX_TOPICS_PER_RUN,
  LLM_MENTIONS_COST_USD,
  type LlmMentionsRunResult,
} from "@/domains/serp/dataforseo-llm-mentions";
import { isDataForSeoConfigured, isDryRun } from "@/domains/serp/dataforseo-serp";

/** How many demand nodes we consider before capping to MAX_TOPICS_PER_RUN - a
 *  small candidate pool keeps the pick deterministic and cheap. */
const TOPIC_CANDIDATES = 24;
/** A topic string shorter than this is noise (a stray token, not a real topic). */
const MIN_TOPIC_LEN = 3;

export type TopicMentionsRunStatus =
  | "disabled"
  | "dry_run"
  | "breaker_tripped"
  | "no_topics"
  | "cache_hit"
  | "capped"
  | "ok"
  | "error";

export type TopicMentionsRunResult = {
  tenantId: string;
  status: TopicMentionsRunStatus;
  /** Topics we chose to poll this night (already capped). */
  topics: string[];
  /** Records returned (fresh + cached), 0 on a no-op. */
  records: number;
  costUsd: number;
  detail: string;
};

export type RunTopicMentionsDeps = {
  env: NodeJS.ProcessEnv;
  now: () => Date;
  /** Top demand-node topics (label + optional real question) for the tenant. */
  loadTopics: (tenantId: string) => Promise<Array<{ topic: string; question: string | null }>>;
  /** The paid topic poll (full money gauntlet lives inside). */
  runMentions: (
    topics: string[],
    questionsByTopic: Record<string, string>,
    tenantId: string,
  ) => Promise<LlmMentionsRunResult>;
  /** N43 GLOBAL cost breaker. Returns tripped=true to hold the paid call.
   *  Hermetic no-op under vitest by default (never reads the operator's real
   *  ledger from a test); the real breaker in production. */
  globalBreaker: (env: NodeJS.ProcessEnv, now: Date, projectedCostUsd: number) => Promise<{ tripped: boolean; reason?: string }>;
};

function underVitest(): boolean {
  return process.env.VITEST === "true";
}

/** The default topic source: the tenant's own demand graph, top nodes by fused
 *  demand weight. A node's first real query rides along as the question so the
 *  poll asks what people actually ask AI when one is available. Fail-soft to
 *  [] (empty graph, read failure) - a no-topic night is an honest no-op. */
async function loadTopicsFromDemandGraph(
  tenantId: string,
): Promise<Array<{ topic: string; question: string | null }>> {
  try {
    const { graph } = await loadDemandGraphForTenant(tenantId);
    const nodes = [...graph.demandNodes]
      .filter((n) => (n.label ?? "").trim().length >= MIN_TOPIC_LEN)
      .sort((a, b) => b.demandWeight - a.demandWeight)
      .slice(0, TOPIC_CANDIDATES);
    const out: Array<{ topic: string; question: string | null }> = [];
    const seen = new Set<string>();
    for (const n of nodes) {
      const topic = n.label.trim();
      const key = topic.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const question = (n.queries ?? []).map((q) => q.trim()).find((q) => q.length >= 8) ?? null;
      out.push({ topic, question });
    }
    return out;
  } catch (e) {
    log.warn("[topic-mentions] demand-graph topic load failed (fail-soft to no topics)", {
      tenantId,
      error: e instanceof Error ? e.message.slice(0, 160) : String(e),
    });
    return [];
  }
}

function defaultDeps(): RunTopicMentionsDeps {
  return {
    env: process.env,
    now: () => new Date(),
    loadTopics: loadTopicsFromDemandGraph,
    runMentions: (topics, questionsByTopic, tenantId) =>
      runLlmMentions(topics, { questionsByTopic }, { tenantId: async () => tenantId }),
    globalBreaker: async (env, now, projectedCostUsd) => {
      if (underVitest()) return { tripped: false };
      return assertPaidCallAllowed({ projectedCostUsd }, { env, now: () => now });
    },
  };
}

/**
 * Poll the tenant's top demand topics for who AI cites, refreshing the mention
 * cache on cadence. Never throws; every failure mode is a typed status.
 *
 * $0-when-inactive PIN: with DataForSEO unconfigured OR dry-run on (both the
 * defaults), this returns a typed no-op BEFORE the demand-graph read and BEFORE
 * any paid path is even reached - byte-identical behaviour to not calling it at
 * all, spending nothing.
 */
export async function runTopicMentionsForTenant(
  tenantId: string,
  depsOverride: Partial<RunTopicMentionsDeps> = {},
): Promise<TopicMentionsRunResult> {
  const deps = { ...defaultDeps(), ...depsOverride };
  const base = { tenantId, topics: [] as string[], records: 0, costUsd: 0 };

  // (1) $0-when-inactive PIN. Unconfigured or dry-run = a no-op that never even
  // reads the graph, so this phase is free and side-effect-free by default.
  if (!isDataForSeoConfigured(deps.env)) {
    return { ...base, status: "disabled", detail: "DataForSEO not configured" };
  }
  if (isDryRun(deps.env)) {
    return { ...base, status: "dry_run", detail: "dry-run default on, no spend" };
  }

  try {
    // (2) topics from the tenant's own demand graph, capped to the module ceiling.
    const candidates = await deps.loadTopics(tenantId);
    const picked: string[] = [];
    const questionsByTopic: Record<string, string> = {};
    const seen = new Set<string>();
    for (const c of candidates) {
      const topic = (c.topic ?? "").trim();
      const key = topic.toLowerCase();
      if (topic.length < MIN_TOPIC_LEN || seen.has(key)) continue;
      seen.add(key);
      picked.push(topic);
      if (c.question && c.question.trim().length >= 8) questionsByTopic[topic] = c.question.trim();
      if (picked.length >= MAX_TOPICS_PER_RUN) break;
    }
    if (picked.length === 0) {
      return { ...base, status: "no_topics", detail: "tenant has no demand-graph topics to poll" };
    }

    // (3) GLOBAL breaker (N43) - the OUTER guard OVER runLlmMentions's own shared
    // per-platform cap. Consulted on the paid path only (we are past the dry-run
    // gate). Projected at the worst case: every picked topic a cache miss. A trip
    // holds the paid call; the poll still returns whatever the 7d cache has for
    // free, so surfaces never go dark just because the ceiling was reached.
    const projected = Math.round(picked.length * LLM_MENTIONS_COST_USD * 1000) / 1000;
    const breaker = await deps
      .globalBreaker(deps.env, deps.now(), projected)
      .catch(() => ({ tripped: true, reason: "global spend breaker unavailable, failing closed" }));
    if (breaker.tripped) {
      log.warn("[topic-mentions] global cost breaker tripped, holding paid poll", {
        tenantId,
        detail: breaker.reason,
      });
      return {
        ...base,
        topics: picked,
        status: "breaker_tripped",
        detail: breaker.reason ?? "global monthly ceiling reached",
      };
    }

    // (4) the poll - runLlmMentions runs the FULL gauntlet inside (7d cache,
    // dry-run re-check, shared fail-closed cap re-checked before every call,
    // ledger). We never re-implement any of it.
    const result = await deps.runMentions(picked, questionsByTopic, tenantId);

    // Map the producer's status onto ours; fresh + cached records both count as
    // "populated the cache surfaces read".
    const status: TopicMentionsRunStatus =
      result.status === "ok"
        ? "ok"
        : result.status === "cache_hit"
          ? "cache_hit"
          : result.status === "capped"
            ? "capped"
            : result.status === "dry_run"
              ? "dry_run"
              : result.status === "disabled"
                ? "disabled"
                : "error";

    return {
      tenantId,
      topics: picked,
      status,
      records: result.records.length,
      costUsd: result.costUsd,
      detail: result.detail,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error("[topic-mentions] run failed", { tenantId, error: msg.slice(0, 240) });
    return { ...base, status: "error", detail: msg.slice(0, 240) };
  }
}
