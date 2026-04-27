/**
 * Sprint 6A.2c (2026-04-26) — runProviderAndPersist LLM integration tests.
 *
 * Pins the new behaviors layered onto the Phase 11 orchestration in
 * `recommended-edits-persistence.ts`:
 *
 *   - Provider resolution: explicit opts.provider wins; otherwise read
 *     `BEACON_LLM_PROVIDER` env via `resolveLLMProvider()` from 6A.2a
 *     (default = deterministic).
 *   - Tenant mismatch is the FIRST gate (before provider resolution +
 *     budget gate + provider call).
 *   - Pre-call budget gate fires for `provider.name === "openai"` only.
 *     Cap exceeded → no provider call; empty no-persist result;
 *     `budget_blocked` history entry.
 *   - OpenAI valid bundle persists rows + appends `live_call` history +
 *     calls `recordSpend`.
 *   - OpenAI empty bundle persists nothing + appends `empty_or_error`
 *     history (no recordSpend).
 *   - OpenAI provider throw is caught; treated as empty bundle; no
 *     persist; history entry written.
 *   - Dry-run with a valid OpenAI bundle still records spend + history
 *     (the network call DID happen) but skips persistence.
 *   - Deterministic provider never touches budget / history.
 *
 * NO real network calls. Provider is mocked (deterministic real;
 * openai mocked through DI / module substitution).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import type { TrackedPrompt } from "@/domains/tracked-prompts/types";
import type { PromptOpportunity } from "@/domains/prompts/opportunity-classify";
import type { PromptPrimarySummary } from "@/domains/prompts/competitor-primary";
import type { PageElementInventoryRow } from "@/domains/pages/extractors/persist";
import type { PageInventoryEntry } from "./page-inventory";
import {
  buildSpecificEditEvidencePacket,
  type BuildSpecificEditEvidencePacketArgs,
  type SpecificEditEvidencePacket,
} from "./specific-edit-evidence";
import type {
  SpecificEdit,
  SpecificEditBundle,
  SpecificEditProvider,
} from "./specific-edit-provider";

// ── Mocks ──────────────────────────────────────────────────────────────────

const dotDataMocks = vi.hoisted(() => ({
  read: vi.fn<(name: string) => unknown>(),
  write: vi.fn<(name: string, data: unknown) => void>(),
}));

vi.mock("@/lib/persistence/dotdata-json", () => ({
  readDotDataJson: dotDataMocks.read,
  writeDotDataJson: dotDataMocks.write,
}));

const dualWriteMocks = vi.hoisted(() => ({
  syncRecommendedEdits: vi.fn(async () => undefined),
}));

vi.mock("@/lib/persistence/dual-write", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    syncRecommendedEdits: dualWriteMocks.syncRecommendedEdits,
  };
});

const tenantMocks = vi.hoisted(() => ({
  currentTenantId: vi.fn(async () => "tenant-test-acme"),
}));

vi.mock("@/lib/tenant-context", () => ({
  currentTenantId: tenantMocks.currentTenantId,
  currentTenantSlug: vi.fn(async () => "test-acme"),
}));

const budgetMocks = vi.hoisted(() => ({
  checkBudget: vi.fn<
    (opts?: { now?: Date; projectedCostUsd?: number }) => Promise<
      | { allowed: true; remaining: number }
      | { allowed: false; reason: string }
    >
  >(),
  recordSpend: vi.fn<
    (cost: number, opts?: { now?: Date }) => Promise<void>
  >(),
  getBudgetState: vi.fn(),
}));

vi.mock("./adjudicator-budget", () => ({
  checkBudget: budgetMocks.checkBudget,
  recordSpend: budgetMocks.recordSpend,
  getBudgetState: budgetMocks.getBudgetState,
}));

const historyMocks = vi.hoisted(() => ({
  appendSpecificEditLLMHistory: vi.fn<
    (
      entry: import("./specific-edit-llm-history").SpecificEditLLMHistoryEntry,
    ) => Promise<void>
  >(),
}));

vi.mock("./specific-edit-llm-history", () => ({
  appendSpecificEditLLMHistory: historyMocks.appendSpecificEditLLMHistory,
}));

// Mock the openai provider so no real fetch is reachable. Hoisted so
// the mock factory can reference it before the test file's top-level
// statements execute.
const openaiProviderMock = vi.hoisted(() => ({
  name: "openai" as const,
  generate: vi.fn<(p: import("./specific-edit-evidence").SpecificEditEvidencePacket) => Promise<import("./specific-edit-provider").SpecificEditBundle>>(),
}));

vi.mock("./providers/openai", () => ({
  openaiProvider: openaiProviderMock,
}));

// Now import the system under test.
import {
  runProviderAndPersist,
  type RecommendedEditRow,
} from "./recommended-edits-persistence";
import { deterministicProvider } from "./providers/deterministic";

// ── Fixture builders ───────────────────────────────────────────────────────

const FROZEN_NOW = new Date("2026-04-26T12:00:00Z");
const TENANT = "tenant-test-acme";
const REC = "rec-2026-04-26-llm-1";
const URL_BRACES = "https://example.com/services/braces";

function makePrompt(id: string, text: string): TrackedPrompt {
  return {
    id,
    account_id: "acc",
    text,
    topic_id: null,
    location_scope: null,
    service_scope: null,
    intent_type: null,
    platforms: [],
    tags: [],
    is_active: true,
    created_at: "2026-04-01T00:00:00Z",
    updated_at: "2026-04-26T00:00:00Z",
  };
}

function makeOpportunity(promptId: string): PromptOpportunity {
  return {
    prompt_id: promptId,
    category: "outranked",
    tags: [],
    signalStrength: 70,
    reasoning: "n/a",
    evidence: {
      observationCount: 5,
      primaryCount: 0,
      citedCount: 1,
      mentionedCount: 1,
      absentCount: 4,
      avgCitationRank: null,
      dominantCompetitors: ["AcmeOrtho"],
      answerStructureDistribution: {},
      topDescriptors: [],
      byPlatform: [],
      lookbackDays: 7,
    },
  };
}

function makeSummary(promptId: string): PromptPrimarySummary {
  return {
    prompt_id: promptId,
    totalAnswers: 5,
    ritzPrimaryCount: 0,
    ritzPrimaryShare: 0,
    ritzState: "absent",
    primaryCompetitors: [
      { name: "AcmeOrtho", primaryCount: 3, totalAnswers: 5 },
    ],
    fragmented: false,
  };
}

function makeInventoryEntry(): PageInventoryEntry {
  return {
    url: URL_BRACES,
    title: "Braces · Acme",
    h1: "Braces",
    metaDescription: null,
    h2s: ["Treatment timeline"],
    routeType: "service",
    detectedGeo: null,
    detectedService: "braces",
  };
}

function makeElement(
  overrides: Partial<PageElementInventoryRow>,
): PageElementInventoryRow {
  return {
    id: "snap__key",
    tenant_id: TENANT,
    page_id: "pg-1",
    url: URL_BRACES,
    element_type: "title",
    element_key: "title[0]:hash-title",
    display_label: "Title tag",
    element_text: "Braces · Acme",
    element_metadata: {},
    extractor_version: 1,
    observed_at: "2026-04-26T10:00:00Z",
    source_snapshot_id: "snap",
    ...overrides,
  };
}

function basePacketArgs(): BuildSpecificEditEvidencePacketArgs {
  const promptId = "prompt-1";
  return {
    tenantId: TENANT,
    recId: REC,
    clusterLabel: "teen braces",
    clusterKind: "topic",
    affectedPromptIds: [promptId],
    promptOpportunities: [makeOpportunity(promptId)],
    trackedPrompts: [makePrompt(promptId, "What are the best teen braces?")],
    primarySummaries: [makeSummary(promptId)],
    singleTargetUrl: null,
    ownedPageInventory: [makeInventoryEntry()],
    pageElementInventory: [makeElement({})],
    now: FROZEN_NOW,
  };
}

function makePacket(): SpecificEditEvidencePacket {
  return buildSpecificEditEvidencePacket(basePacketArgs());
}

function makeValidEdit(packet: SpecificEditEvidencePacket): SpecificEdit {
  // Pair the first targetPageElement with an action type whose
  // elementTypeDomain includes that element's elementType. The packet's
  // allowedActionTypes order is determined by the builder, so we can't
  // assume index 0 matches the first element — search instead.
  const element = packet.targetPageElements[0];
  if (!element) {
    throw new Error("test fixture: packet has no target elements");
  }
  // Hardcoded mapping for the v1 active set. element_type "title" pairs
  // with edit_title; "h2" with add_h2_section; etc. We always have a
  // title element in the fixture.
  const actionType = packet.allowedActionTypes.find((t) =>
    t === "edit_title" && element.elementType === "title",
  );
  if (!actionType) {
    throw new Error(
      `test fixture: no valid actionType for element type "${element.elementType}". Allowed: ${packet.allowedActionTypes.join(", ")}`,
    );
  }
  const targetUrl = element.url;
  return {
    actionType,
    targetUrl,
    targetElement: {
      elementKey: element.elementKey,
      displayLabel: "Title",
      currentText: element.elementText,
      proposedText: "Braces · Acme · proposed",
    },
    why: "Cited prompt indicates city is missing in title",
    evidence: [
      { type: "prompt", promptId: "prompt-1" },
    ],
    expectedImpact: null,
    difficulty: "low",
    confidence: "medium",
    measurementPlan: null,
    risks: [],
    source: "openai",
    providerName: "openai",
    model: "gpt-5-mini",
    costUsd: 0.001,
  };
}

function bundleWith(
  packet: SpecificEditEvidencePacket,
  recs: SpecificEdit[],
  totalCostUsd: number,
): SpecificEditBundle {
  return {
    schemaVersion: "specific-edit-bundle/v1",
    generatedAt: FROZEN_NOW.toISOString(),
    tenantId: packet.tenantId,
    recId: packet.recId,
    evidenceHash: packet.evidenceHash,
    providerName: "openai",
    recommendations: recs,
    totalCostUsd,
  };
}

// ── Lifecycle ──────────────────────────────────────────────────────────────

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.BEACON_LLM_PROVIDER;
  delete process.env.OPENAI_API_KEY;

  dotDataMocks.read.mockReset();
  dotDataMocks.read.mockReturnValue(undefined);
  dotDataMocks.write.mockReset();
  dualWriteMocks.syncRecommendedEdits.mockReset();
  dualWriteMocks.syncRecommendedEdits.mockResolvedValue(undefined);
  tenantMocks.currentTenantId.mockReset();
  tenantMocks.currentTenantId.mockResolvedValue(TENANT);
  budgetMocks.checkBudget.mockReset();
  budgetMocks.checkBudget.mockResolvedValue({ allowed: true, remaining: 10 });
  budgetMocks.recordSpend.mockReset();
  budgetMocks.recordSpend.mockResolvedValue(undefined);
  historyMocks.appendSpecificEditLLMHistory.mockReset();
  historyMocks.appendSpecificEditLLMHistory.mockResolvedValue(undefined);
  openaiProviderMock.generate.mockReset();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

// ── Tenant mismatch is the first gate ──────────────────────────────────────

describe("runProviderAndPersist — tenant mismatch is the first gate", () => {
  it("throws before provider resolution / budget gate / provider call", async () => {
    // Resolver returns a DIFFERENT tenant than the packet's tenantId.
    tenantMocks.currentTenantId.mockResolvedValue("tenant-someone-else");
    process.env.BEACON_LLM_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "sk-test-fixture";
    const packet = makePacket();
    await expect(
      runProviderAndPersist({ packet, dryRun: true }),
    ).rejects.toThrow(/tenant mismatch/);
    // Provider never called. Budget never checked. History never written.
    expect(openaiProviderMock.generate).not.toHaveBeenCalled();
    expect(budgetMocks.checkBudget).not.toHaveBeenCalled();
    expect(historyMocks.appendSpecificEditLLMHistory).not.toHaveBeenCalled();
  });
});

// ── Provider resolution ────────────────────────────────────────────────────

describe("runProviderAndPersist — provider resolution", () => {
  it("default (no env) uses deterministic; never touches budget or history", async () => {
    const packet = makePacket();
    const result = await runProviderAndPersist({ packet, dryRun: true });
    // Deterministic provider runs; bundle's providerName is "deterministic".
    expect(result.bundle.providerName).toBe("deterministic");
    expect(openaiProviderMock.generate).not.toHaveBeenCalled();
    expect(budgetMocks.checkBudget).not.toHaveBeenCalled();
    expect(budgetMocks.recordSpend).not.toHaveBeenCalled();
    expect(historyMocks.appendSpecificEditLLMHistory).not.toHaveBeenCalled();
  });

  it("BEACON_LLM_PROVIDER=openai dispatches to the openai provider", async () => {
    process.env.BEACON_LLM_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "sk-test-fixture";
    const packet = makePacket();
    openaiProviderMock.generate.mockResolvedValue(bundleWith(packet, [], 0));
    await runProviderAndPersist({ packet, dryRun: true });
    expect(openaiProviderMock.generate).toHaveBeenCalledTimes(1);
  });

  it("explicit opts.provider wins over env", async () => {
    process.env.BEACON_LLM_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "sk-test-fixture";
    const packet = makePacket();
    const result = await runProviderAndPersist({
      provider: deterministicProvider,
      packet,
      dryRun: true,
    });
    expect(result.bundle.providerName).toBe("deterministic");
    expect(openaiProviderMock.generate).not.toHaveBeenCalled();
    expect(budgetMocks.checkBudget).not.toHaveBeenCalled();
  });

  it("invalid env throws fail-loud (config gate)", async () => {
    process.env.BEACON_LLM_PROVIDER = "totally-bogus";
    const packet = makePacket();
    await expect(
      runProviderAndPersist({ packet, dryRun: true }),
    ).rejects.toThrow(/invalid BEACON_LLM_PROVIDER/);
    expect(openaiProviderMock.generate).not.toHaveBeenCalled();
  });
});

// ── Budget gate ────────────────────────────────────────────────────────────

describe("runProviderAndPersist — budget gate (openai only)", () => {
  beforeEach(() => {
    process.env.BEACON_LLM_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "sk-test-fixture";
  });

  it("budget exceeded → no provider call; empty no-persist result; budget_blocked history", async () => {
    budgetMocks.checkBudget.mockResolvedValue({
      allowed: false,
      reason: "Monthly cap reached (10.00 / 10 USD this 2026-04).",
    });
    const packet = makePacket();
    const result = await runProviderAndPersist({ packet, dryRun: false });
    expect(openaiProviderMock.generate).not.toHaveBeenCalled();
    expect(budgetMocks.recordSpend).not.toHaveBeenCalled();
    expect(result.persisted).toBe(false);
    expect(result.acceptedRows).toEqual([]);
    expect(result.bundle.recommendations).toEqual([]);
    expect(historyMocks.appendSpecificEditLLMHistory).toHaveBeenCalledTimes(1);
    const entry = historyMocks.appendSpecificEditLLMHistory.mock.calls[0]?.[0];
    expect(entry).toMatchObject({
      status: "budget_blocked",
      providerName: "openai",
      tenantId: TENANT,
      recId: REC,
      costUsd: 0,
      acceptedCount: 0,
    });
  });

  it("budget allowed → provider IS called", async () => {
    const packet = makePacket();
    openaiProviderMock.generate.mockResolvedValue(bundleWith(packet, [], 0));
    await runProviderAndPersist({ packet, dryRun: true });
    expect(budgetMocks.checkBudget).toHaveBeenCalledTimes(1);
    expect(openaiProviderMock.generate).toHaveBeenCalledTimes(1);
  });

  it("deterministic provider does NOT consult the budget gate", async () => {
    delete process.env.BEACON_LLM_PROVIDER;
    delete process.env.OPENAI_API_KEY;
    const packet = makePacket();
    await runProviderAndPersist({ packet, dryRun: true });
    expect(budgetMocks.checkBudget).not.toHaveBeenCalled();
  });
});

// ── OpenAI live-call success path ──────────────────────────────────────────

describe("runProviderAndPersist — OpenAI live-call persistence", () => {
  beforeEach(() => {
    process.env.BEACON_LLM_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "sk-test-fixture";
  });

  it("valid OpenAI bundle persists rows, records spend, appends live_call history", async () => {
    const packet = makePacket();
    const edit = makeValidEdit(packet);
    openaiProviderMock.generate.mockResolvedValue(bundleWith(packet, [edit], 0.0025));

    const result = await runProviderAndPersist({ packet, dryRun: false });

    expect(result.persisted).toBe(true);
    expect(result.acceptedRows.length).toBe(1);
    expect(result.acceptedRows[0].source).toBe("openai");
    expect(result.acceptedRows[0].cost_usd).toBe(0.001);

    expect(dualWriteMocks.syncRecommendedEdits).toHaveBeenCalledTimes(1);
    expect(budgetMocks.recordSpend).toHaveBeenCalledTimes(1);
    expect(budgetMocks.recordSpend).toHaveBeenCalledWith(0.0025, expect.any(Object));

    expect(historyMocks.appendSpecificEditLLMHistory).toHaveBeenCalledTimes(1);
    const entry = historyMocks.appendSpecificEditLLMHistory.mock.calls[0]?.[0];
    expect(entry).toMatchObject({
      status: "live_call",
      providerName: "openai",
      tenantId: TENANT,
      recId: REC,
      costUsd: 0.0025,
      acceptedCount: 1,
      model: "gpt-5-mini",
    });
  });

  it("dry-run with valid bundle still records spend + history but skips persist", async () => {
    const packet = makePacket();
    const edit = makeValidEdit(packet);
    openaiProviderMock.generate.mockResolvedValue(bundleWith(packet, [edit], 0.0025));

    const result = await runProviderAndPersist({ packet, dryRun: true });

    expect(result.persisted).toBe(false);
    expect(dualWriteMocks.syncRecommendedEdits).not.toHaveBeenCalled();
    expect(budgetMocks.recordSpend).toHaveBeenCalledTimes(1);
    expect(historyMocks.appendSpecificEditLLMHistory).toHaveBeenCalledWith(
      expect.objectContaining({ status: "live_call" }),
    );
  });
});

// ── OpenAI failure modes ───────────────────────────────────────────────────

describe("runProviderAndPersist — OpenAI failure modes", () => {
  beforeEach(() => {
    process.env.BEACON_LLM_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "sk-test-fixture";
  });

  it("empty OpenAI bundle (cost=0, no recs) persists nothing; appends empty_or_error history", async () => {
    const packet = makePacket();
    openaiProviderMock.generate.mockResolvedValue(bundleWith(packet, [], 0));

    const result = await runProviderAndPersist({ packet, dryRun: false });

    expect(result.persisted).toBe(false);
    expect(result.acceptedRows).toEqual([]);
    expect(dualWriteMocks.syncRecommendedEdits).not.toHaveBeenCalled();
    expect(budgetMocks.recordSpend).not.toHaveBeenCalled();
    expect(historyMocks.appendSpecificEditLLMHistory).toHaveBeenCalledTimes(1);
    const entry = historyMocks.appendSpecificEditLLMHistory.mock.calls[0]?.[0];
    expect(entry).toMatchObject({
      status: "empty_or_error",
      providerName: "openai",
      tenantId: TENANT,
      costUsd: 0,
      acceptedCount: 0,
    });
  });

  it("provider throw is caught; treated as empty bundle; no persist; history written", async () => {
    const packet = makePacket();
    openaiProviderMock.generate.mockRejectedValue(new Error("network blew up"));

    const result = await runProviderAndPersist({ packet, dryRun: false });

    expect(result.persisted).toBe(false);
    expect(result.bundle.recommendations).toEqual([]);
    expect(dualWriteMocks.syncRecommendedEdits).not.toHaveBeenCalled();
    expect(budgetMocks.recordSpend).not.toHaveBeenCalled();
    // The catch-block writes one history entry; the post-call empty-bundle
    // branch may write a second. Either way, both should be empty_or_error
    // entries — pin that without overspecifying the count.
    expect(historyMocks.appendSpecificEditLLMHistory).toHaveBeenCalled();
    const calls = historyMocks.appendSpecificEditLLMHistory.mock.calls;
    for (const [entry] of calls) {
      expect((entry as { status: string }).status).toBe("empty_or_error");
    }
  });
});
