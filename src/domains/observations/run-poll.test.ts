import { describe, it, expect, vi } from "vitest";
import { runNativePoll } from "./run-poll";
import type { PerplexityPollResult } from "@/adapters/perplexity/poll";
import type { ObservationRun } from "./types";
import type { PromptAnswerObservation } from "@/domains/prompt-answer-observations/types";
import type { TrackedEntity } from "@/domains/tracked-entities/types";
import type { DailyMetricSnapshot } from "@/domains/daily-metric-snapshots/types";

function makeRun(overrides: Partial<ObservationRun> = {}): ObservationRun {
  return {
    run_id: "pollrun-test",
    run_type: "citation_sample_import",
    source: "perplexity-native-poll",
    status: "completed",
    started_at: "2026-04-24T10:00:00.000Z",
    completed_at: "2026-04-24T10:11:00.000Z",
    scope_label: "Native perplexity poll · 100/100 prompts",
    parser_version: "perplexity-native-v1",
    pages_scanned: 0,
    pages_changed: 0,
    pages_with_errors: 0,
    guardrail_alerts: 0,
    critical_count: 0,
    regression_count: 0,
    improvement_count: 0,
    tenant_id: "tenant-ritz-founder",
    ...overrides,
  };
}

function makeObs(id: string): PromptAnswerObservation {
  return {
    id,
    prompt_id: `p-${id}`,
    run_id: "pollrun-test",
    answer_hash: "abc123",
    position: null,
    tracked_brand_mentioned: true,
    tracked_brand_cited: true,
    citation_count: 2,
    owned_citation_count: 1,
    citation_domains: ["ritzbuilders.com"],
    citation_categories: {},
    mentions: ["Ritz Builders"],
    observed_at: "2026-04-24T10:00:00.000Z",
    platform: "perplexity",
    topic: "t",
    metadata: {},
    tenant_id: "tenant-ritz-founder",
  };
}

function makeAdapterResult(
  platform: string,
  obsCount: number,
  status: ObservationRun["status"] = "completed",
  errorCount = 0,
): PerplexityPollResult {
  const observations = Array.from({ length: obsCount }, (_, i) =>
    makeObs(`obs-${i}`),
  );
  const answerTexts: Record<string, string> = {};
  for (const o of observations) answerTexts[o.id] = "answer";
  return {
    observations,
    answerTexts,
    observationRun: makeRun({
      source: `${platform === "perplexity" ? "perplexity" : "openai"}-native-poll`,
      status,
    }),
    errorCount,
  };
}

function trackedEntities(): TrackedEntity[] {
  return [
    {
      id: "own-ritzbuilders-com",
      account_id: "ritz-builders",
      entity_type: "brand",
      name: "Ritz Builders",
      domain: "ritzbuilders.com",
      url: null,
      location_scope: null,
      service_scope: null,
      is_owned: true,
      is_active: true,
      metadata: {},
      created_at: "2026-01-01",
      updated_at: "2026-01-01",
    },
  ];
}

function mkSyncSpies() {
  return {
    syncObservationRuns: vi.fn(async () => undefined),
    syncPromptAnswerObservations: vi.fn(async () => undefined),
    syncAnswerTexts: vi.fn(async () => undefined),
    syncDailyMetricSnapshots: vi.fn(async () => undefined),
  };
}

describe("runNativePoll", () => {
  it("happy path: calls adapter, writes all 4 tables, returns completed summary", async () => {
    const sync = mkSyncSpies();
    const adapterSpy = vi.fn(async (platform: string, _tenantId: string) =>
      makeAdapterResult(platform, 100, "completed", 0),
    );
    const fakeSnapshots: DailyMetricSnapshot[] = [
      {
        id: "derived-2026-04-24-ritzbuilders-perplexity",
        date: "2026-04-24",
        scope_type: "entity",
        scope_id: "ritzbuilders",
        platform: "Perplexity",
        source_type: "derived",
        visibility_score: 50,
        mention_count: 50,
        citation_count: 50,
        share_of_voice: 10,
        avg_position: null,
        total_possible: 100,
        metadata: {},
        tenant_id: "tenant-ritz-founder",
      },
    ];

    const result = await runNativePoll(
      { tenantId: "tenant-ritz-founder", platform: "perplexity" },
      {
        runAdapter: adapterSpy,
        hasRecentCompletedRun: async () => false,
        ...sync,
        buildDailySnapshotsFromObservations: () => fakeSnapshots,
        getTrackedEntities: async () => trackedEntities(),
      },
    );

    expect(result.status).toBe("completed");
    expect(result.runId).toBe("pollrun-test");
    expect(result.platform).toBe("perplexity");
    expect(result.observationsWritten).toBe(100);
    expect(result.snapshotsWritten).toBe(1);
    expect(result.errorCount).toBe(0);
    expect(result.costEstimateUsd).toBeCloseTo(0.5, 4); // 100 × $0.005
    expect(result.completedAt).toBe("2026-04-24T10:11:00.000Z");

    expect(adapterSpy).toHaveBeenCalledWith("perplexity", "tenant-ritz-founder");
    expect(sync.syncObservationRuns).toHaveBeenCalledOnce();
    expect(sync.syncPromptAnswerObservations).toHaveBeenCalledOnce();
    expect(sync.syncAnswerTexts).toHaveBeenCalledOnce();
    expect(sync.syncDailyMetricSnapshots).toHaveBeenCalledOnce();
    expect(sync.syncDailyMetricSnapshots).toHaveBeenCalledWith(fakeSnapshots);
  });

  it("budget guard: skips the run when a recent completed run exists and force=false", async () => {
    const sync = mkSyncSpies();
    const adapterSpy = vi.fn();
    const hasRecent = vi.fn(async () => true);

    const result = await runNativePoll(
      { tenantId: "tenant-ritz-founder", platform: "openai" },
      {
        runAdapter: adapterSpy,
        hasRecentCompletedRun: hasRecent,
        ...sync,
      },
    );

    expect(result.status).toBe("skipped_already_ran_today");
    expect(result.runId).toBeNull();
    expect(result.observationsWritten).toBe(0);
    expect(result.snapshotsWritten).toBe(0);
    expect(result.costEstimateUsd).toBe(0);
    expect(result.note).toMatch(/last 20 hours/);

    // No API call. No DB writes. Completely inert.
    expect(adapterSpy).not.toHaveBeenCalled();
    expect(hasRecent).toHaveBeenCalledWith("openai-native-poll");
    expect(sync.syncObservationRuns).not.toHaveBeenCalled();
    expect(sync.syncPromptAnswerObservations).not.toHaveBeenCalled();
    expect(sync.syncAnswerTexts).not.toHaveBeenCalled();
    expect(sync.syncDailyMetricSnapshots).not.toHaveBeenCalled();
  });

  it("force=true bypasses the budget guard even when a recent run exists", async () => {
    const sync = mkSyncSpies();
    const adapterSpy = vi.fn(async (platform: string) =>
      makeAdapterResult(platform, 50, "completed", 0),
    );
    const hasRecent = vi.fn(async () => true); // recent run exists

    const result = await runNativePoll(
      {
        tenantId: "tenant-ritz-founder",
        platform: "openai",
        force: true,
      },
      {
        runAdapter: adapterSpy,
        hasRecentCompletedRun: hasRecent,
        ...sync,
        buildDailySnapshotsFromObservations: () => [],
        getTrackedEntities: async () => trackedEntities(),
      },
    );

    expect(result.status).toBe("completed");
    expect(result.observationsWritten).toBe(50);
    // force=true means we don't even query the guard
    expect(hasRecent).not.toHaveBeenCalled();
    expect(adapterSpy).toHaveBeenCalledOnce();
  });

  it("partial run status propagates into the summary", async () => {
    const sync = mkSyncSpies();
    const adapterSpy = vi.fn(async (platform: string) =>
      makeAdapterResult(platform, 97, "partial", 3),
    );

    const result = await runNativePoll(
      { tenantId: "tenant-ritz-founder", platform: "openai" },
      {
        runAdapter: adapterSpy,
        hasRecentCompletedRun: async () => false,
        ...sync,
        buildDailySnapshotsFromObservations: () => [],
        getTrackedEntities: async () => trackedEntities(),
      },
    );

    expect(result.status).toBe("partial");
    expect(result.observationsWritten).toBe(97);
    expect(result.errorCount).toBe(3);
    expect(result.costEstimateUsd).toBeCloseTo(97 * 0.012, 4);
  });

  it("cost estimate uses platform-specific rate", async () => {
    const sync = mkSyncSpies();

    const perpResult = await runNativePoll(
      { tenantId: "t", platform: "perplexity" },
      {
        runAdapter: async (p) => makeAdapterResult(p, 100),
        hasRecentCompletedRun: async () => false,
        ...sync,
        buildDailySnapshotsFromObservations: () => [],
        getTrackedEntities: async () => trackedEntities(),
      },
    );
    expect(perpResult.costEstimateUsd).toBeCloseTo(0.5, 4); // 100 × $0.005

    const openaiResult = await runNativePoll(
      { tenantId: "t", platform: "openai" },
      {
        runAdapter: async (p) => makeAdapterResult(p, 100),
        hasRecentCompletedRun: async () => false,
        ...sync,
        buildDailySnapshotsFromObservations: () => [],
        getTrackedEntities: async () => trackedEntities(),
      },
    );
    expect(openaiResult.costEstimateUsd).toBeCloseTo(1.2, 4); // 100 × $0.012
  });
});
