import { describe, it, expect, vi } from "vitest";
import {
  runTopicMentionsForTenant,
  type RunTopicMentionsDeps,
} from "./run-topic-mentions";
import { MAX_TOPICS_PER_RUN, type LlmMentionsRunResult } from "@/domains/serp/dataforseo-llm-mentions";

// A configured, NOT-dry-run env: the only combination that ever reaches the paid
// path. Every other env combination must be a $0 no-op (the PIN).
const CONFIGURED_ENV = {
  BEACON_SERP_PROVIDER: "dataforseo",
  DATAFORSEO_AUTH_B64: "dGVzdDp0ZXN0",
  DATAFORSEO_DRY_RUN: "false",
  DATAFORSEO_MONTHLY_CAP_USD: "50",
} as unknown as NodeJS.ProcessEnv;

const DRY_RUN_ENV = {
  BEACON_SERP_PROVIDER: "dataforseo",
  DATAFORSEO_AUTH_B64: "dGVzdDp0ZXN0",
  // DATAFORSEO_DRY_RUN unset -> dry-run is the DEFAULT.
} as unknown as NodeJS.ProcessEnv;

const UNCONFIGURED_ENV = {} as unknown as NodeJS.ProcessEnv;

function mentionsResult(over: Partial<LlmMentionsRunResult> = {}): LlmMentionsRunResult {
  return {
    status: "ok",
    plan: { endpoint: "https://x", topics: ["nowruz"], model: "gpt-4o-mini", estCostPerTopicUsd: 0.03, estCostUsd: 0.03 },
    records: [
      {
        topic: "nowruz",
        question: "q",
        mentions: [{ domain: "iranopedia.com", count: 2 }],
        model: "gpt-4o-mini",
        answerExcerpt: "x",
        usedWebSearch: true,
        source: "dataforseo",
        fetchedAt: "2026-07-06T00:00:00Z",
        evidenceRef: "dataforseo:ai_optimization/llm_responses",
      },
    ],
    costUsd: 0.03,
    detail: "1 live",
    ...over,
  };
}

function deps(over: Partial<RunTopicMentionsDeps> = {}): Partial<RunTopicMentionsDeps> {
  return {
    env: CONFIGURED_ENV,
    now: () => new Date("2026-07-06T00:00:00Z"),
    loadTopics: async () => [
      { topic: "Nowruz", question: "when is persian new year" },
      { topic: "Persian rugs", question: null },
    ],
    runMentions: vi.fn(async () => mentionsResult()),
    globalBreaker: vi.fn(async () => ({ tripped: false })),
    ...over,
  };
}

describe("runTopicMentionsForTenant - the $0-when-inactive PIN", () => {
  it("is a no-op costing $0 when DataForSEO is UNCONFIGURED (never reads the graph, never polls)", async () => {
    const loadTopics = vi.fn(async () => [{ topic: "x", question: null }]);
    const runMentions = vi.fn(async () => mentionsResult());
    const globalBreaker = vi.fn(async () => ({ tripped: false }));
    const r = await runTopicMentionsForTenant("t", { env: UNCONFIGURED_ENV, loadTopics, runMentions, globalBreaker });
    expect(r.status).toBe("disabled");
    expect(r.costUsd).toBe(0);
    expect(r.records).toBe(0);
    expect(loadTopics).not.toHaveBeenCalled();
    expect(runMentions).not.toHaveBeenCalled();
    expect(globalBreaker).not.toHaveBeenCalled();
  });

  it("is a no-op costing $0 when DRY-RUN is on (the default) - graph untouched, poll not attempted", async () => {
    const loadTopics = vi.fn(async () => [{ topic: "x", question: null }]);
    const runMentions = vi.fn(async () => mentionsResult());
    const globalBreaker = vi.fn(async () => ({ tripped: false }));
    const r = await runTopicMentionsForTenant("t", { env: DRY_RUN_ENV, loadTopics, runMentions, globalBreaker });
    expect(r.status).toBe("dry_run");
    expect(r.costUsd).toBe(0);
    expect(loadTopics).not.toHaveBeenCalled();
    expect(runMentions).not.toHaveBeenCalled();
    expect(globalBreaker).not.toHaveBeenCalled();
  });
});

describe("runTopicMentionsForTenant - runs the poll when configured + stale + affordable", () => {
  it("polls the top demand topics and returns the fresh records + real cost", async () => {
    const runMentions: RunTopicMentionsDeps["runMentions"] = vi.fn(async () => mentionsResult({ costUsd: 0.06, records: mentionsResult().records }));
    const r = await runTopicMentionsForTenant("t", deps({ runMentions }));
    expect(r.status).toBe("ok");
    expect(r.costUsd).toBe(0.06);
    expect(r.records).toBe(1);
    expect(runMentions).toHaveBeenCalledTimes(1);
    // Topics chosen, real question passed through where present.
    const [topics, questionsByTopic] = (runMentions as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(topics).toEqual(["Nowruz", "Persian rugs"]);
    expect(questionsByTopic).toEqual({ Nowruz: "when is persian new year" });
  });

  it("caps the pick at MAX_TOPICS_PER_RUN even when many topics exist", async () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ topic: `topic ${i}`, question: null }));
    const runMentions: RunTopicMentionsDeps["runMentions"] = vi.fn(async () => mentionsResult());
    const r = await runTopicMentionsForTenant("t", deps({ loadTopics: async () => many, runMentions }));
    expect(r.topics.length).toBe(MAX_TOPICS_PER_RUN);
    const firstArg = (runMentions as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string[];
    expect(firstArg.length).toBe(MAX_TOPICS_PER_RUN);
  });

  it("drops sub-3-char noise topics and dedupes case-insensitively before polling", async () => {
    const runMentions: RunTopicMentionsDeps["runMentions"] = vi.fn(async () => mentionsResult());
    await runTopicMentionsForTenant("t", deps({
      loadTopics: async () => [
        { topic: "ab", question: null }, // too short
        { topic: "Nowruz", question: null },
        { topic: "nowruz", question: null }, // dup (case)
        { topic: "Saffron", question: null },
      ],
      runMentions,
    }));
    expect((runMentions as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toEqual(["Nowruz", "Saffron"]);
  });
});

describe("runTopicMentionsForTenant - cache-fresh + cap are honored ($0 no spend)", () => {
  it("reports cache_hit and $0 when the producer served everything from cache", async () => {
    const runMentions = vi.fn(async () => mentionsResult({ status: "cache_hit", costUsd: 0, detail: "served from 7d cache" }));
    const r = await runTopicMentionsForTenant("t", deps({ runMentions }));
    expect(r.status).toBe("cache_hit");
    expect(r.costUsd).toBe(0);
    expect(r.records).toBe(1); // cached records still populate the surfaces
  });

  it("reports capped and $0 when the shared monthly cap was reached inside the producer", async () => {
    const runMentions = vi.fn(async () => mentionsResult({ status: "capped", costUsd: 0, records: [], detail: "cap reached" }));
    const r = await runTopicMentionsForTenant("t", deps({ runMentions }));
    expect(r.status).toBe("capped");
    expect(r.costUsd).toBe(0);
  });
});

describe("runTopicMentionsForTenant - the N43 global breaker governs the paid path", () => {
  it("holds the paid poll ($0, never calls runMentions) when the breaker trips", async () => {
    const runMentions = vi.fn(async () => mentionsResult());
    const globalBreaker: RunTopicMentionsDeps["globalBreaker"] = vi.fn(async () => ({ tripped: true, reason: "at ceiling" }));
    const r = await runTopicMentionsForTenant("t", deps({ runMentions, globalBreaker }));
    expect(r.status).toBe("breaker_tripped");
    expect(r.costUsd).toBe(0);
    expect(r.detail).toContain("ceiling");
    expect(runMentions).not.toHaveBeenCalled();
    expect(globalBreaker).toHaveBeenCalledTimes(1);
  });

  it("fails CLOSED (holds the call) when the breaker itself throws", async () => {
    const runMentions = vi.fn(async () => mentionsResult());
    const globalBreaker = vi.fn(async () => {
      throw new Error("ledger down");
    });
    const r = await runTopicMentionsForTenant("t", deps({ runMentions, globalBreaker }));
    expect(r.status).toBe("breaker_tripped");
    expect(runMentions).not.toHaveBeenCalled();
  });

  it("projects the WORST-CASE spend (every topic a miss) to the breaker", async () => {
    const globalBreaker: RunTopicMentionsDeps["globalBreaker"] = vi.fn(async () => ({ tripped: false }));
    await runTopicMentionsForTenant("t", deps({
      loadTopics: async () => [
        { topic: "one", question: null },
        { topic: "two", question: null },
        { topic: "three", question: null },
      ],
      globalBreaker,
    }));
    const projected = (globalBreaker as ReturnType<typeof vi.fn>).mock.calls[0]![2] as number;
    expect(projected).toBeCloseTo(0.09, 5); // 3 topics x $0.03
  });
});

describe("runTopicMentionsForTenant - honest no-op + fail-soft edges", () => {
  it("reports no_topics ($0) when the demand graph has no usable topics", async () => {
    const runMentions = vi.fn(async () => mentionsResult());
    const r = await runTopicMentionsForTenant("t", deps({ loadTopics: async () => [], runMentions }));
    expect(r.status).toBe("no_topics");
    expect(r.costUsd).toBe(0);
    expect(runMentions).not.toHaveBeenCalled();
  });

  it("never throws when topic loading throws - returns a typed error result", async () => {
    const r = await runTopicMentionsForTenant("t", deps({
      loadTopics: async () => {
        throw new Error("graph blew up");
      },
    }));
    expect(r.status).toBe("error");
    expect(r.costUsd).toBe(0);
  });

  it("never throws when the producer throws - returns a typed error result", async () => {
    const r = await runTopicMentionsForTenant("t", deps({
      runMentions: async () => {
        throw new Error("fetch exploded");
      },
    }));
    expect(r.status).toBe("error");
    expect(r.costUsd).toBe(0);
  });

  it("maps a producer 'disabled'/'error' status onto our result honestly", async () => {
    const rDisabled = await runTopicMentionsForTenant("t", deps({ runMentions: async () => mentionsResult({ status: "disabled", records: [], costUsd: 0 }) }));
    expect(rDisabled.status).toBe("disabled");
    const rErr = await runTopicMentionsForTenant("t", deps({ runMentions: async () => mentionsResult({ status: "error", records: [], costUsd: 0 }) }));
    expect(rErr.status).toBe("error");
  });
});
