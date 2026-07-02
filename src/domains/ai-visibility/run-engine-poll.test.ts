import { describe, it, expect, vi } from "vitest";
import { runEnginePollForTenant, type RunEnginePollDeps } from "./run-engine-poll";
import { NIGHTLY_PROMPT_CAP } from "./engine-types";
import type { LibraryPrompt } from "@/domains/prompts/types";
import type { BeaconTenant } from "@/domains/tenants/types";
import type { PromptAnswerObservation } from "@/domains/prompt-answer-observations/types";
import type { EnginePromptRunResult } from "@/domains/serp/dataforseo-llm-mentions";

const TENANT_ID = "tenant-iranopedia";

const prompt = (n: number): LibraryPrompt => ({
  id: `prm-${n}`,
  prompt_text: `tracked question number ${n}`,
  topic: "iran",
  city: null,
  service_type: null,
  journey_stage: "awareness",
  source: "profound",
  is_active: true,
  created_at: "2026-06-01T00:00:00Z",
});

const TENANT = {
  id: TENANT_ID,
  slug: "iranopedia",
  business_name: "Iranopedia",
  domain: "iranopedia.com",
} as unknown as BeaconTenant;

const dfsResult = (engine: "gemini" | "claude", over: Partial<EnginePromptRunResult> = {}): EnginePromptRunResult => ({
  status: "dry_run",
  engine,
  model: "model-x",
  endpoint: "https://api.dataforseo.com/x",
  answers: [],
  costUsd: 0,
  detail: "dry-run - would spend ~$0.75",
  ...over,
});

function deps(over: Partial<RunEnginePollDeps> = {}): Partial<RunEnginePollDeps> {
  return {
    env: {} as NodeJS.ProcessEnv,
    now: () => new Date("2026-07-01T09:00:00Z"),
    loadPrompts: async () => Array.from({ length: 30 }, (_, i) => prompt(i)),
    loadTenant: async () => TENANT,
    hasRunForNight: async () => false,
    recordRun: vi.fn(async () => {}),
    writeObservations: vi.fn(async () => {}),
    appendRun: vi.fn(),
    writeGapSummary: vi.fn(async () => {}),
    openAiClient: null,
    perplexityClient: null,
    runDataForSeoEngine: vi.fn(async (_items, engine) => dfsResult(engine)),
    ...over,
  };
}

describe("runEnginePollForTenant - idempotency + caps", () => {
  it("already-ran guard: second run tonight makes ZERO engine calls", async () => {
    const openAiClient = vi.fn();
    const runDataForSeoEngine = vi.fn();
    const r = await runEnginePollForTenant(
      TENANT_ID,
      deps({
        hasRunForNight: async () => true,
        openAiClient,
        runDataForSeoEngine: runDataForSeoEngine as unknown as RunEnginePollDeps["runDataForSeoEngine"],
      }),
    );
    expect(r.status).toBe("already_ran");
    expect(openAiClient).not.toHaveBeenCalled();
    expect(runDataForSeoEngine).not.toHaveBeenCalled();
  });

  it("nightly prompt cap: 30 active prompts -> only the top 25 are polled", async () => {
    const openAiClient = vi.fn(async () => ({ answerText: "no links here", citedUrls: [], model: "gpt-test" }));
    const runDataForSeoEngine = vi.fn(async (items: Array<{ key: string }>, engine: "gemini" | "claude") => {
      expect(items).toHaveLength(NIGHTLY_PROMPT_CAP);
      return dfsResult(engine);
    });
    const r = await runEnginePollForTenant(TENANT_ID, deps({ openAiClient, runDataForSeoEngine }));
    expect(r.promptsRequested).toBe(NIGHTLY_PROMPT_CAP);
    expect(openAiClient).toHaveBeenCalledTimes(NIGHTLY_PROMPT_CAP);
    expect(runDataForSeoEngine).toHaveBeenCalledTimes(2); // gemini + claude
  });

  it("no active prompts -> honest no_prompts, nothing runs", async () => {
    const runDataForSeoEngine = vi.fn();
    const r = await runEnginePollForTenant(
      TENANT_ID,
      deps({ loadPrompts: async () => [], runDataForSeoEngine: runDataForSeoEngine as unknown as RunEnginePollDeps["runDataForSeoEngine"] }),
    );
    expect(r.status).toBe("no_prompts");
    expect(runDataForSeoEngine).not.toHaveBeenCalled();
  });
});

describe("runEnginePollForTenant - key-gated engines degrade honestly", () => {
  it("marks native engines skipped_no_key and reports which engines were actually checked", async () => {
    const r = await runEnginePollForTenant(TENANT_ID, deps());
    const byEngine = new Map(r.engines.map((e) => [e.engine, e]));
    expect(byEngine.get("chatgpt")!.status).toBe("skipped_no_key");
    expect(byEngine.get("perplexity")!.status).toBe("skipped_no_key");
    expect(byEngine.get("gemini")!.status).toBe("dry_run");
    expect(byEngine.get("claude")!.status).toBe("dry_run");
    expect(r.enginesChecked).toEqual([]); // nothing really answered tonight
    expect(r.observationsWritten).toBe(0);
    expect(r.status).toBe("ok");
  });
});

describe("runEnginePollForTenant - observations carry the right engine tags", () => {
  it("writes rows into the existing observation stores with per-engine platform + source", async () => {
    const written: PromptAnswerObservation[][] = [];
    const writeObservations = vi.fn(async (rows: PromptAnswerObservation[]) => {
      written.push(rows);
    });
    const appendRun = vi.fn();
    const summaries: Array<Parameters<RunEnginePollDeps["writeGapSummary"]>[0]> = [];
    const writeGapSummary: RunEnginePollDeps["writeGapSummary"] = async (s) => {
      summaries.push(s);
    };
    const recordedRuns: Array<Parameters<RunEnginePollDeps["recordRun"]>[0]> = [];
    const recordRun: RunEnginePollDeps["recordRun"] = async (row) => {
      recordedRuns.push(row);
    };

    // ChatGPT answers every question but never cites the tenant; Perplexity
    // cites the tenant's rug page on question 0 only.
    const openAiClient = vi.fn(async () => ({
      answerText: "Here are some carpet sites: https://www.jozan.net/guide",
      citedUrls: ["https://www.jozan.net/guide"],
      model: "gpt-4o-mini-search-preview",
    }));
    const perplexityClient = vi.fn(async (q: string) => ({
      answerText: q.includes("number 0")
        ? "Iranopedia has the best rug guide: https://www.iranopedia.com/persian-rugs"
        : "Nothing relevant found.",
      citedUrls: q.includes("number 0") ? ["https://www.iranopedia.com/persian-rugs"] : [],
      model: "sonar",
    }));

    const r = await runEnginePollForTenant(
      TENANT_ID,
      deps({
        loadPrompts: async () => [prompt(0), prompt(1)],
        openAiClient,
        perplexityClient,
        writeObservations,
        appendRun,
        writeGapSummary,
        recordRun,
      }),
    );

    expect(r.status).toBe("ok");
    const rows = written.flat();
    expect(rows).toHaveLength(4); // 2 prompts x 2 native engines

    const chatgptRow = rows.find((o) => o.platform === "chatgpt" && o.prompt_id === "prm-0")!;
    expect(chatgptRow.metadata.source).toBe("ai-engines-openai");
    expect(chatgptRow.tenant_id).toBe(TENANT_ID);
    expect(chatgptRow.tracked_brand_cited).toBe(false);
    expect(chatgptRow.citation_domains).toEqual(["jozan.net"]);

    const pplxRow = rows.find((o) => o.platform === "perplexity" && o.prompt_id === "prm-0")!;
    expect(pplxRow.metadata.source).toBe("ai-engines-perplexity");
    expect(pplxRow.tracked_brand_cited).toBe(true);
    expect(pplxRow.citation_rank).toBe(1);
    expect(pplxRow.owned_citation_count).toBe(1);
    // The brand name appears in the answer text -> mentioned.
    expect(pplxRow.tracked_brand_mentioned).toBe(true);

    // observation_runs rows per checked engine, with the engine source.
    const runSources = appendRun.mock.calls.map((c) => (c[0] as { source: string }).source).sort();
    expect(runSources).toEqual(["ai-engines-openai", "ai-engines-perplexity"]);

    // The diff: Perplexity cites you on question 0, ChatGPT does not -> a gap.
    expect(r.enginesChecked).toEqual(["chatgpt", "perplexity"]);
    expect(r.gaps).toBe(1);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]!.gaps[0]).toMatchObject({
      prompt_id: "prm-0",
      cited_engines: ["perplexity"],
      missing_engines: ["chatgpt"],
      owned_url: "https://www.iranopedia.com/persian-rugs",
    });

    // The per-night guard is stamped only after the real attempt.
    expect(recordedRuns).toHaveLength(1);
    expect(recordedRuns[0]).toMatchObject({ tenant_id: TENANT_ID, date: "2026-07-01", prompts: 2 });
  });

  it("DataForSEO answers become gemini/claude observations through the same path", async () => {
    const written: PromptAnswerObservation[][] = [];
    const writeObservations = vi.fn(async (rows: PromptAnswerObservation[]) => {
      written.push(rows);
    });
    const runDataForSeoEngine = vi.fn(async (items: Array<{ key: string; question: string }>, engine: "gemini" | "claude") =>
      dfsResult(engine, {
        status: "ok",
        answers: [
          {
            key: items[0]!.key,
            question: items[0]!.question,
            engine: engine === "gemini" ? ("gemini" as const) : ("claude" as const),
            model: "model-x",
            answerText: "See https://www.iranopedia.com/iran-carpets for details.",
            mentions: [{ domain: "iranopedia.com", count: 1 }],
            citedUrls: ["https://www.iranopedia.com/iran-carpets"],
            usedWebSearch: true,
            fetchedAt: "2026-07-01T09:00:00Z",
            evidenceRef: `dataforseo:ai_optimization/${engine}/llm_responses`,
          },
        ],
        costUsd: 0.03,
      }),
    );
    const r = await runEnginePollForTenant(
      TENANT_ID,
      deps({ loadPrompts: async () => [prompt(0)], writeObservations, runDataForSeoEngine }),
    );
    const rows = written.flat();
    expect(rows.map((o) => o.platform).sort()).toEqual(["claude", "gemini"]);
    expect(rows.every((o) => o.tracked_brand_cited === true)).toBe(true);
    expect(rows.find((o) => o.platform === "gemini")!.metadata.source).toBe("ai-engines-dataforseo-gemini");
    expect(rows.find((o) => o.platform === "claude")!.metadata.source).toBe("ai-engines-dataforseo-claude");
    expect(r.enginesChecked).toEqual(["gemini", "claude"]);
    expect(r.gaps).toBe(0); // both cite you - no gap
  });
});
