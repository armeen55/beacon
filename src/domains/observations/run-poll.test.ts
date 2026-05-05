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
    // Sprint 6A.3c additive fields — tests in this file don't exercise
    // budget paths but the result type now requires them.
    cost: {
      totalUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      webSearchCalls: 0,
      promptsCompleted: obsCount,
      promptsSkippedBudget: 0,
      promptsDeduped: 0,
    },
    skipReason: null,
    budgetReason: null,
    // Step 1.5 (master plan) — reliability accumulators added to the
    // adapter result. Tests in this file don't exercise the retry path
    // but the type now requires the field.
    reliability: {
      retryCount: 0,
      failureCountsByKind: {
        transient_network: 0,
        timeout: 0,
        server_5xx: 0,
        rate_limit: 0,
        auth: 0,
        invalid_request: 0,
        parse_error: 0,
        unknown: 0,
      },
      dominantFailureType: null,
      estimatedUnconfirmedCostUsd: 0,
    },
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
    // Poll Integrity Hardening (2026-05-04): the orchestrator now
    // wraps each pipeline step with sub-status helpers + a
    // reconciliation step + a persistence-failure gate. Each test
    // stubs these so the existing tests keep passing without
    // hitting Supabase. The reconciliation stub returns ok:true with
    // expectedObsCount as the persisted count — that's the happy-path
    // shape every existing test expects.
    syncRawPollChunk: vi.fn(async () => undefined),
    stampRawPollChunkReconciliation: vi.fn(async () => undefined),
    reconcilePolledRun: vi.fn(
      async (args: {
        expectedObsCount: number;
        costUsd: number;
      }) => ({
        ok: true,
        persistedObsCount: args.expectedObsCount,
        expectedObsCount: args.expectedObsCount,
        costUsd: args.costUsd,
        reasons: [] as string[],
      }),
    ),
    markRunPersistenceFailed: vi.fn(async () => undefined),
    checkPersistenceGate: vi.fn(
      async (): Promise<{
        allow: boolean;
        reason: string;
        blockedByRunId: string | null;
      }> => ({
        allow: true,
        reason: "",
        blockedByRunId: null,
      }),
    ),
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
    // Non-chunked call: offset=0, limit=null in the summary
    expect(result.chunk).toEqual({
      offset: 0,
      limit: null,
      promptsPolled: 100,
    });

    // Adapter receives platform + tenantId + chunk window (both undefined here)
    expect(adapterSpy).toHaveBeenCalledWith(
      "perplexity",
      "tenant-ritz-founder",
      { offset: undefined, limit: undefined },
    );
    expect(sync.syncObservationRuns).toHaveBeenCalledOnce();
    expect(sync.syncPromptAnswerObservations).toHaveBeenCalledOnce();
    expect(sync.syncAnswerTexts).toHaveBeenCalledOnce();
    expect(sync.syncDailyMetricSnapshots).toHaveBeenCalledOnce();
    // Phase 7.7b Commit 4 (2026-04-25): syncDailyMetricSnapshots now requires tenantId.
    expect(sync.syncDailyMetricSnapshots).toHaveBeenCalledWith(
      fakeSnapshots,
      "tenant-ritz-founder",
    );
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

  // ── Phase 5 Step 1.5: chunked hosted polling (Hobby-tier 300s cap) ──

  it("chunk mode: does NOT call the 20-hour guard, uses 15-min retry dedupe instead", async () => {
    const sync = mkSyncSpies();
    const adapterSpy = vi.fn(async (platform: string) =>
      makeAdapterResult(platform, 25, "completed", 0),
    );
    const hasRecent = vi.fn(async () => true); // 20-hr guard says "recent"
    const hasRecentChunk = vi.fn(async () => false); // no recent chunk retry

    const result = await runNativePoll(
      {
        tenantId: "tenant-ritz-founder",
        platform: "perplexity",
        offset: 50,
        limit: 25,
      },
      {
        runAdapter: adapterSpy,
        hasRecentCompletedRun: hasRecent,
        hasRecentCompletedChunk: hasRecentChunk,
        ...sync,
        buildDailySnapshotsFromObservations: () => [],
        getTrackedEntities: async () => trackedEntities(),
        getObservationsForDay: async () => makeAdapterResult("perplexity", 25)
          .observations,
      },
    );

    expect(result.status).toBe("completed");
    expect(result.chunk).toEqual({
      offset: 50,
      limit: 25,
      promptsPolled: 25,
    });
    // Chunk mode does NOT consult the 20-hr guard
    expect(hasRecent).not.toHaveBeenCalled();
    // Chunk mode DOES consult the 15-min retry guard, with the chunk identity
    expect(hasRecentChunk).toHaveBeenCalledWith(
      "perplexity-native-poll",
      50,
      25,
    );
    expect(adapterSpy).toHaveBeenCalledWith(
      "perplexity",
      "tenant-ritz-founder",
      { offset: 50, limit: 25 },
    );
  });

  it("chunk mode: skips with 'skipped_chunk_recently_ran' if same chunk fired in last 15 minutes", async () => {
    const sync = mkSyncSpies();
    const adapterSpy = vi.fn();
    const hasRecentChunk = vi.fn(async () => true); // same chunk landed <15min ago

    const result = await runNativePoll(
      {
        tenantId: "tenant-ritz-founder",
        platform: "perplexity",
        offset: 25,
        limit: 25,
      },
      {
        runAdapter: adapterSpy,
        hasRecentCompletedChunk: hasRecentChunk,
        ...sync,
      },
    );

    expect(result.status).toBe("skipped_chunk_recently_ran");
    expect(result.runId).toBeNull();
    expect(result.observationsWritten).toBe(0);
    expect(result.snapshotsWritten).toBe(0);
    expect(result.note).toMatch(/15 minutes/);
    expect(hasRecentChunk).toHaveBeenCalledWith(
      "perplexity-native-poll",
      25,
      25,
    );
    expect(adapterSpy).not.toHaveBeenCalled();
    expect(sync.syncObservationRuns).not.toHaveBeenCalled();
  });

  it("chunk mode: force=true bypasses the 15-min retry dedupe", async () => {
    const sync = mkSyncSpies();
    const adapterSpy = vi.fn(async (platform: string) =>
      makeAdapterResult(platform, 25, "completed", 0),
    );
    const hasRecentChunk = vi.fn(async () => true);

    const result = await runNativePoll(
      {
        tenantId: "tenant-ritz-founder",
        platform: "perplexity",
        offset: 0,
        limit: 25,
        force: true,
      },
      {
        runAdapter: adapterSpy,
        hasRecentCompletedChunk: hasRecentChunk,
        ...sync,
        buildDailySnapshotsFromObservations: () => [],
        getTrackedEntities: async () => trackedEntities(),
        getObservationsForDay: async () => [],
      },
    );

    expect(result.status).toBe("completed");
    // force=true short-circuits BEFORE any guard is consulted
    expect(hasRecentChunk).not.toHaveBeenCalled();
    expect(adapterSpy).toHaveBeenCalledOnce();
  });

  it("chunk mode: derivation reads all today's observations (cumulative), not just this chunk's", async () => {
    const sync = mkSyncSpies();
    // This chunk's adapter yields 25 observations (chunk 3 of 4, say).
    const adapterResult = makeAdapterResult("perplexity", 25, "completed", 0);

    // Simulate that chunks 0, 1, and 2 have already landed 75 observations
    // earlier today. getObservationsForDay returns ALL 100 (75 prior + 25 just
    // synced): cumulative derivation input.
    const observationsAcrossAllChunks = Array.from({ length: 100 }, (_, i) =>
      makeObs(`obs-cumulative-${i}`),
    );

    let capturedBuildArgs: Parameters<typeof import("@/domains/daily-metric-snapshots/build-from-observations").buildDailySnapshotsFromObservations>[0] | null = null;
    const buildSnapsSpy: typeof import("@/domains/daily-metric-snapshots/build-from-observations").buildDailySnapshotsFromObservations =
      (args) => {
        capturedBuildArgs = args;
        return [];
      };

    const result = await runNativePoll(
      {
        tenantId: "tenant-ritz-founder",
        platform: "perplexity",
        offset: 75,
        limit: 25,
      },
      {
        runAdapter: async () => adapterResult,
        hasRecentCompletedRun: async () => false,
        ...sync,
        buildDailySnapshotsFromObservations: buildSnapsSpy,
        getTrackedEntities: async () => trackedEntities(),
        getObservationsForDay: async () => observationsAcrossAllChunks,
      },
    );

    // observationsWritten is this chunk's only (25)
    expect(result.observationsWritten).toBe(25);
    // But the snapshot builder received ALL 100 cumulative observations
    expect(capturedBuildArgs).not.toBeNull();
    expect(capturedBuildArgs!.observations).toHaveLength(100);
    expect(capturedBuildArgs!.date).toBe("2026-04-24");
    expect(capturedBuildArgs!.platform).toBe("Perplexity");
  });

  it("non-chunk call: derivation still uses THIS run's observations (back-compat)", async () => {
    const sync = mkSyncSpies();
    const adapterResult = makeAdapterResult("perplexity", 100, "completed", 0);

    const dayObsSpy = vi.fn(async () => [] as PromptAnswerObservation[]);
    let capturedBuildArgs: Parameters<typeof import("@/domains/daily-metric-snapshots/build-from-observations").buildDailySnapshotsFromObservations>[0] | null = null;
    const buildSnapsSpy: typeof import("@/domains/daily-metric-snapshots/build-from-observations").buildDailySnapshotsFromObservations =
      (args) => {
        capturedBuildArgs = args;
        return [];
      };

    await runNativePoll(
      { tenantId: "t", platform: "perplexity" }, // no offset, no limit
      {
        runAdapter: async () => adapterResult,
        hasRecentCompletedRun: async () => false,
        ...sync,
        buildDailySnapshotsFromObservations: buildSnapsSpy,
        getTrackedEntities: async () => trackedEntities(),
        getObservationsForDay: dayObsSpy,
      },
    );

    // Non-chunk path doesn't query getObservationsForDay at all.
    expect(dayObsSpy).not.toHaveBeenCalled();
    // Builder receives just this run's observations (100).
    expect(capturedBuildArgs).not.toBeNull();
    expect(capturedBuildArgs!.observations).toHaveLength(100);
  });

  it("chunk mode: getObservationsForDay receives the OBSERVATION-level platform label, not the NativePollPlatform enum (regression guard for the 2026-04-23 ChatGPT entity-zeroing bug)", async () => {
    const sync = mkSyncSpies();
    // Capture variable (not vi.fn) so we get a concrete typed reference,
    // avoiding TS strict-mode issues with vi.fn.mock.calls tuple inference.
    let capturedPlatform: string | null = null;
    const getDayObsCapture = async (args: {
      tenantId: string;
      platform: string;
      date: string;
    }): Promise<PromptAnswerObservation[]> => {
      capturedPlatform = args.platform;
      return [];
    };

    // OpenAI: NativePollPlatform "openai", observation-level label "chatgpt".
    // If the mapping regresses this will capture "openai" and the test fails.
    await runNativePoll(
      {
        tenantId: "tenant-ritz-founder",
        platform: "openai",
        offset: 0,
        limit: 5,
        force: true,
      },
      {
        runAdapter: async (p) => makeAdapterResult(p, 5, "completed", 0),
        hasRecentCompletedChunk: async () => false,
        ...sync,
        buildDailySnapshotsFromObservations: () => [],
        getTrackedEntities: async () => trackedEntities(),
        getObservationsForDay: getDayObsCapture,
      },
    );
    expect(capturedPlatform).toBe("chatgpt"); // ← NOT "openai"

    capturedPlatform = null;

    // Perplexity: both labels are "perplexity" so they match either way.
    await runNativePoll(
      {
        tenantId: "tenant-ritz-founder",
        platform: "perplexity",
        offset: 0,
        limit: 5,
        force: true,
      },
      {
        runAdapter: async (p) => makeAdapterResult(p, 5, "completed", 0),
        hasRecentCompletedChunk: async () => false,
        ...sync,
        buildDailySnapshotsFromObservations: () => [],
        getTrackedEntities: async () => trackedEntities(),
        getObservationsForDay: getDayObsCapture,
      },
    );
    expect(capturedPlatform).toBe("perplexity");
  });

  it("offset=0 alone is chunk mode (bypasses guard); limit=undefined means 'to the end'", async () => {
    const sync = mkSyncSpies();
    const adapterSpy = vi.fn(async (platform: string) =>
      makeAdapterResult(platform, 100, "completed", 0),
    );
    const hasRecent = vi.fn(async () => true);

    // offset=0, limit=undefined → chunk mode active (offset is defined)
    const result = await runNativePoll(
      { tenantId: "t", platform: "perplexity", offset: 0 },
      {
        runAdapter: adapterSpy,
        hasRecentCompletedRun: hasRecent,
        ...sync,
        buildDailySnapshotsFromObservations: () => [],
        getTrackedEntities: async () => trackedEntities(),
        getObservationsForDay: async () => [],
      },
    );

    expect(result.chunk).toEqual({
      offset: 0,
      limit: null,
      promptsPolled: 100,
    });
    expect(hasRecent).not.toHaveBeenCalled();
  });

  // ────────────────────────────────────────────────────────────────────
  // Poll Integrity Hardening (2026-05-04, post May 2-4 incident)
  // ────────────────────────────────────────────────────────────────────

  it("R1+R2: throws when reconcilePolledRun reports persistence mismatch + marks the run failed", async () => {
    const sync = mkSyncSpies();
    sync.reconcilePolledRun = vi.fn(async () => ({
      ok: false,
      persistedObsCount: 0,
      expectedObsCount: 100,
      costUsd: 0.6,
      reasons: [
        "Paid call cost $0.6 but ZERO observations persisted (silent-write-failure pattern)",
      ],
    }));
    const adapterSpy = vi.fn(async (platform: string, _tenantId: string) =>
      makeAdapterResult(platform, 100, "completed", 0),
    );
    await expect(
      runNativePoll(
        { tenantId: "tenant-ritz-founder", platform: "perplexity" },
        {
          runAdapter: adapterSpy,
          hasRecentCompletedRun: async () => false,
          ...sync,
          buildDailySnapshotsFromObservations: () => [],
          getTrackedEntities: async () => trackedEntities(),
        },
      ),
    ).rejects.toThrow(/PERSISTENCE RECONCILIATION FAILED/);
    // markRunPersistenceFailed must be called BEFORE the throw so the
    // run row reflects truth.
    expect(sync.markRunPersistenceFailed).toHaveBeenCalledTimes(1);
    expect(sync.stampRawPollChunkReconciliation).toHaveBeenCalled();
  });

  it("R3: writes raw chunk row BEFORE syncObs (preserves provider response on failure)", async () => {
    const sync = mkSyncSpies();
    const callOrder: string[] = [];
    sync.syncRawPollChunk = vi.fn(async () => {
      callOrder.push("raw");
      return undefined;
    });
    sync.syncPromptAnswerObservations = vi.fn(async () => {
      callOrder.push("obs");
      return undefined;
    });
    const adapterSpy = vi.fn(async (platform: string, _tenantId: string) =>
      makeAdapterResult(platform, 100, "completed", 0),
    );
    await runNativePoll(
      { tenantId: "tenant-ritz-founder", platform: "perplexity" },
      {
        runAdapter: adapterSpy,
        hasRecentCompletedRun: async () => false,
        ...sync,
        buildDailySnapshotsFromObservations: () => [],
        getTrackedEntities: async () => trackedEntities(),
      },
    );
    expect(callOrder.indexOf("raw")).toBeLessThan(callOrder.indexOf("obs"));
  });

  it("R3: stamps reconciliation as 'observation_upsert_threw' when syncObs throws", async () => {
    const sync = mkSyncSpies();
    sync.syncPromptAnswerObservations = vi.fn(async () => {
      throw new Error("PGRST204: column not in schema cache");
    });
    const adapterSpy = vi.fn(async (platform: string, _tenantId: string) =>
      makeAdapterResult(platform, 100, "completed", 0),
    );
    await expect(
      runNativePoll(
        { tenantId: "tenant-ritz-founder", platform: "perplexity" },
        {
          runAdapter: adapterSpy,
          hasRecentCompletedRun: async () => false,
          ...sync,
          buildDailySnapshotsFromObservations: () => [],
          getTrackedEntities: async () => trackedEntities(),
        },
      ),
    ).rejects.toThrow(/PGRST204/);
    // Raw chunk written first, then stamped with the failure reason.
    expect(sync.syncRawPollChunk).toHaveBeenCalled();
    expect(sync.stampRawPollChunkReconciliation).toHaveBeenCalledWith(
      expect.objectContaining({
        reconciliationStatus: "observation_upsert_threw",
        observationsPersistedCount: 0,
      }),
    );
    // Run row also marked failed.
    expect(sync.markRunPersistenceFailed).toHaveBeenCalled();
  });

  it("R6: gate blocks the next paid run when checkPersistenceGate returns allow:false", async () => {
    const sync = mkSyncSpies();
    sync.checkPersistenceGate = vi.fn(async () => ({
      allow: false,
      reason: "Last openai-native-poll run failed persistence",
      blockedByRunId: "r-bad-1",
    }));
    const adapterSpy = vi.fn(async (platform: string, _tenantId: string) =>
      makeAdapterResult(platform, 100, "completed", 0),
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
    // Gate-blocked: paid call NEVER happens.
    expect(adapterSpy).not.toHaveBeenCalled();
    expect(result.status).toBe("skipped_persistence_failure_gate");
    expect(result.observationsWritten).toBe(0);
    expect(result.note).toMatch(/failed persistence/);
  });

  it("R6: force=true bypasses the persistence gate (operator manual override)", async () => {
    const sync = mkSyncSpies();
    sync.checkPersistenceGate = vi.fn(async () => ({
      allow: false,
      reason: "blocked",
      blockedByRunId: "r-bad-1",
    }));
    const adapterSpy = vi.fn(async (platform: string, _tenantId: string) =>
      makeAdapterResult(platform, 100, "completed", 0),
    );
    const result = await runNativePoll(
      { tenantId: "tenant-ritz-founder", platform: "openai", force: true },
      {
        runAdapter: adapterSpy,
        hasRecentCompletedRun: async () => false,
        ...sync,
        buildDailySnapshotsFromObservations: () => [],
        getTrackedEntities: async () => trackedEntities(),
      },
    );
    // force=true bypasses the gate; adapter runs.
    expect(adapterSpy).toHaveBeenCalled();
    expect(result.status).toBe("completed");
  });

  it("R1+R2: success-path observationsWritten reflects DB truth (verdict.persistedObsCount), not provider claim", async () => {
    const sync = mkSyncSpies();
    // Adapter says 100 obs but reconciliation only verifies 80 persisted.
    // The summary should report 80 (DB truth).
    sync.reconcilePolledRun = vi.fn(async () => ({
      ok: true, // we treat as ok for this contract test (operator
      // could also configure stricter rules; here we test that
      // the field is sourced from verdict, not from result).
      persistedObsCount: 80,
      expectedObsCount: 100,
      costUsd: 0.6,
      reasons: [],
    }));
    const adapterSpy = vi.fn(async (platform: string, _tenantId: string) =>
      makeAdapterResult(platform, 100, "completed", 0),
    );
    const result = await runNativePoll(
      { tenantId: "tenant-ritz-founder", platform: "perplexity" },
      {
        runAdapter: adapterSpy,
        hasRecentCompletedRun: async () => false,
        ...sync,
        buildDailySnapshotsFromObservations: () => [],
        getTrackedEntities: async () => trackedEntities(),
      },
    );
    expect(result.observationsWritten).toBe(80);
    expect(result.chunk.promptsPolled).toBe(80);
  });
});
