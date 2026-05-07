import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

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
import { deterministicProvider } from "./providers/deterministic";
import {
  editLifecycleStatus,
  mapSpecificEditToRow,
  markRecommendedEditsAccepted,
  markRecommendedEditsAsShipped,
  persistRecommendedEditsLocal,
  readRecommendedEditsLocal,
  runProviderAndPersist,
  type RecommendedEditRow,
} from "./recommended-edits-persistence";

// ---------------------------------------------------------------------------
// Sprint 6A.1 Phase 11 — persistence layer tests.
//
// Three sections:
//  1. mapSpecificEditToRow — pure mapping invariants.
//  2. runProviderAndPersist — orchestration: validation, mapping,
//     dry-run, idempotency, rejection handling.
//  3. Source-scan invariants — no app route imports the persistence
//     helper or the CLI; CLI module exists and contains the expected
//     hooks.
//
// Local file I/O + Supabase dual-write are mocked so tests stay
// hermetic (no .data writes, no network calls).
// ---------------------------------------------------------------------------

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
  // Typed signature so Phase 1 lifecycle tests can destructure
  // `mock.calls[i]` without `as unknown as ...` gymnastics.
  syncRecommendedEdits: vi.fn<
    (rows: unknown[], tenantId: string) => Promise<void>
  >(),
}));

vi.mock("@/lib/persistence/dual-write", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    syncRecommendedEdits: dualWriteMocks.syncRecommendedEdits,
  };
});

// Phase 7.7d (2026-04-25): runProviderAndPersist now resolves
// `currentTenantId()` and asserts `packet.tenantId === ctxTenantId`.
// Tests use TENANT = "tenant-test-acme"; mock the resolver to match so
// the existing happy-path tests keep working. Mismatch tests below set
// the mock to a different value to exercise the throw.
const tenantMocks = vi.hoisted(() => ({
  currentTenantId: vi.fn(async () => "tenant-test-acme"),
}));

vi.mock("@/lib/tenant-context", () => ({
  currentTenantId: tenantMocks.currentTenantId,
  currentTenantSlug: vi.fn(async () => "test-acme"),
}));

// ── Fixture builders ───────────────────────────────────────────────────────

const FROZEN_NOW = new Date("2026-04-24T12:00:00Z");
const TENANT = "tenant-test-acme";
const REC = "rec-2026-04-24-1";
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
    updated_at: "2026-04-24T00:00:00Z",
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
    observed_at: "2026-04-24T10:00:00Z",
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
    observations: [],
    ownedPageInventory: [makeInventoryEntry()],
    pageElementInventory: [
      makeElement({}),
      makeElement({
        element_type: "h2",
        element_key: "h2[0]:hash-h2a",
        element_text: "Treatment timeline",
        display_label: "H2",
      }),
    ],
    now: FROZEN_NOW,
  };
}

function buildPacket(
  overrides: Partial<BuildSpecificEditEvidencePacketArgs> = {},
): SpecificEditEvidencePacket {
  const built = buildSpecificEditEvidencePacket({ ...basePacketArgs(), ...overrides });
  // T4.1 (2026-05-06): seed one search query so the abstention contract
  // passes. These tests target persistence orchestration, not abstention.
  return {
    ...built,
    aiSearchSignal: {
      ...built.aiSearchSignal,
      topSearchQueries: [
        {
          query: "best teen braces",
          count: 3,
          promptIds: [built.affectedPrompts[0]?.promptId ?? "prompt-1"], platforms: ["chatgpt"],
        },
      ],
    },
  };
}

function validEditTitleFixture(packet: SpecificEditEvidencePacket): SpecificEdit {
  return {
    actionType: "edit_title",
    targetUrl: URL_BRACES,
    targetElement: {
      elementKey: "title[0]:hash-title",
      displayLabel: "Title tag",
      currentText: "Braces · Acme",
      proposedText: "Teen Braces · Acme",
    },
    why: "Title missing cluster keywords.",
    evidence: [
      { type: "prompt", promptId: packet.affectedPrompts[0].promptId },
      { type: "owned_page", url: URL_BRACES },
    ],
    expectedImpact: null,
    difficulty: "low",
    confidence: "medium",
    measurementPlan: null,
    risks: [],
    source: "deterministic",
    providerName: "deterministic",
    model: null,
    costUsd: null,
  };
}

// ── 1. mapSpecificEditToRow ───────────────────────────────────────────────

describe("Phase 6A.1.11 — mapSpecificEditToRow", () => {
  it("maps a SpecificEdit into the snake_case recommended_edits row shape", () => {
    const packet = buildPacket();
    const edit = validEditTitleFixture(packet);
    const row = mapSpecificEditToRow({
      edit,
      recId: packet.recId,
      tenantId: packet.tenantId,
      evidenceHash: packet.evidenceHash,
      now: FROZEN_NOW,
    });
    expect(row.tenant_id).toBe(packet.tenantId);
    expect(row.rec_id).toBe(packet.recId);
    expect(row.action_type).toBe("edit_title");
    expect(row.target_url).toBe(URL_BRACES);
    expect(row.target_element_key).toBe("title[0]:hash-title");
    expect(row.display_label).toBe("Title tag");
    expect(row.current_text).toBe("Braces · Acme");
    expect(row.proposed_text).toBe("Teen Braces · Acme");
    expect(row.why).toBe(edit.why);
    expect(row.evidence).toEqual(edit.evidence);
    expect(row.difficulty).toBe("low");
    expect(row.confidence).toBe("medium");
    expect(row.risks).toEqual([]);
    expect(row.source).toBe("deterministic");
    expect(row.provider_name).toBe("deterministic");
    expect(row.evidence_hash).toBe(packet.evidenceHash);
    expect(row.model).toBeNull();
    expect(row.cost_usd).toBeNull();
    expect(row.created_at).toBe(FROZEN_NOW.toISOString());
    expect(row.updated_at).toBe(FROZEN_NOW.toISOString());
  });

  it("derives a deterministic id from rec_id + action_type + target_element_key", () => {
    const packet = buildPacket();
    const edit = validEditTitleFixture(packet);
    const row = mapSpecificEditToRow({
      edit,
      recId: packet.recId,
      tenantId: packet.tenantId,
      evidenceHash: packet.evidenceHash,
      now: FROZEN_NOW,
    });
    expect(row.id).toBe(
      `${packet.recId}__edit_title__title[0]:hash-title`,
    );
  });

  it("uses 'null' literal for target_element_key when targetElement is null (page-level actions)", () => {
    const packet = buildPacket();
    const edit: SpecificEdit = {
      actionType: "watch",
      targetUrl: URL_BRACES,
      targetElement: null,
      why: "watching",
      evidence: [],
      expectedImpact: null,
      difficulty: "low",
      confidence: "medium",
      measurementPlan: null,
      risks: [],
      source: "deterministic",
      providerName: "deterministic",
      model: null,
      costUsd: null,
    };
    const row = mapSpecificEditToRow({
      edit,
      recId: packet.recId,
      tenantId: packet.tenantId,
      evidenceHash: packet.evidenceHash,
      now: FROZEN_NOW,
    });
    expect(row.target_element_key).toBeNull();
    expect(row.id).toBe(`${packet.recId}__watch__null`);
  });

  it("is a pure function — same inputs produce identical rows", () => {
    const packet = buildPacket();
    const edit = validEditTitleFixture(packet);
    const a = mapSpecificEditToRow({
      edit,
      recId: packet.recId,
      tenantId: packet.tenantId,
      evidenceHash: packet.evidenceHash,
      now: FROZEN_NOW,
    });
    const b = mapSpecificEditToRow({
      edit,
      recId: packet.recId,
      tenantId: packet.tenantId,
      evidenceHash: packet.evidenceHash,
      now: FROZEN_NOW,
    });
    expect(a).toEqual(b);
  });

  it("output is JSON-serializable + round-trips losslessly", () => {
    const packet = buildPacket();
    const edit = validEditTitleFixture(packet);
    const row = mapSpecificEditToRow({
      edit,
      recId: packet.recId,
      tenantId: packet.tenantId,
      evidenceHash: packet.evidenceHash,
      now: FROZEN_NOW,
    });
    const parsed = JSON.parse(JSON.stringify(row)) as RecommendedEditRow;
    expect(parsed).toEqual(row);
  });
});

// ── 2. runProviderAndPersist ───────────────────────────────────────────────

describe("Phase 6A.1.11 — runProviderAndPersist (orchestration)", () => {
  beforeEach(() => {
    dotDataMocks.read.mockReset();
    dotDataMocks.write.mockReset();
    dualWriteMocks.syncRecommendedEdits.mockReset();
    dotDataMocks.read.mockReturnValue([]);
    dualWriteMocks.syncRecommendedEdits.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("maps deterministic provider output to rows and dual-writes when not in dry-run", async () => {
    // Sprint 6A.2g.C (2026-04-26) — the deterministic FAQ generator
    // emits proposedText that doesn't end in "?" (Phase 9 shape predates
    // Rule 13). Its FAQ rows now fail validation; non-FAQ rows still
    // pass and persist. The orchestration must report partial accept
    // and dual-write the accepted subset.
    const packet = buildPacket();
    const result = await runProviderAndPersist({
      provider: deterministicProvider,
      packet,
      dryRun: false,
      now: FROZEN_NOW,
    });
    expect(result.totalGenerated).toBeGreaterThan(0);
    expect(result.acceptedCount).toBeGreaterThan(0);
    expect(result.acceptedCount + result.rejectedCount).toBe(
      result.totalGenerated,
    );
    // result.ok is true only when zero rows reject; the FAQ gate forces
    // partial accept here. The accepted subset still persists.
    expect(result.persisted).toBe(true);
    expect(dualWriteMocks.syncRecommendedEdits).toHaveBeenCalledTimes(1);
    const persistedRows = (
      dualWriteMocks.syncRecommendedEdits.mock.calls[0] as unknown as [
        RecommendedEditRow[],
        string,
      ]
    )[0];
    expect(persistedRows.length).toBe(result.acceptedCount);
    for (const row of persistedRows) {
      expect(row.tenant_id).toBe(packet.tenantId);
      expect(row.rec_id).toBe(packet.recId);
      expect(row.evidence_hash).toBe(packet.evidenceHash);
    }
  });

  it("DRY-RUN: dual-write helper NOT called and writeDotDataJson NOT called", async () => {
    const packet = buildPacket();
    const result = await runProviderAndPersist({
      provider: deterministicProvider,
      packet,
      dryRun: true,
      now: FROZEN_NOW,
    });
    expect(result.persisted).toBe(false);
    expect(dotDataMocks.write).not.toHaveBeenCalled();
    expect(dualWriteMocks.syncRecommendedEdits).not.toHaveBeenCalled();
  });

  it("idempotent — repeated calls with same packet produce same row ids (replace-by-id semantics)", async () => {
    const packet = buildPacket();
    const r1 = await runProviderAndPersist({
      provider: deterministicProvider,
      packet,
      dryRun: false,
      now: FROZEN_NOW,
    });
    const r2 = await runProviderAndPersist({
      provider: deterministicProvider,
      packet,
      dryRun: false,
      now: FROZEN_NOW,
    });
    const ids1 = r1.acceptedRows.map((r) => r.id).sort();
    const ids2 = r2.acceptedRows.map((r) => r.id).sort();
    expect(ids1).toEqual(ids2);
  });

  it("rejects edits that fail validation (custom provider with bad targetUrl) — no persistence of bad rows", async () => {
    const packet = buildPacket();
    // Build a fake provider that injects a hallucinated targetUrl.
    const badProvider: SpecificEditProvider = {
      name: "deterministic",
      async generate(p): Promise<SpecificEditBundle> {
        const goodEdit = validEditTitleFixture(p);
        const badEdit: SpecificEdit = {
          ...goodEdit,
          targetUrl: "https://hallucinated.example/x",
        };
        return {
          schemaVersion: "specific-edit-bundle/v1",
          generatedAt: FROZEN_NOW.toISOString(),
          tenantId: p.tenantId,
          recId: p.recId,
          evidenceHash: p.evidenceHash,
          providerName: "deterministic",
          recommendations: [goodEdit, badEdit],
          totalCostUsd: 0,
        };
      },
    };
    const result = await runProviderAndPersist({
      provider: badProvider,
      packet,
      dryRun: false,
      now: FROZEN_NOW,
    });
    expect(result.totalGenerated).toBe(2);
    expect(result.acceptedCount).toBe(1);
    expect(result.rejectedCount).toBe(1);
    expect(result.ok).toBe(false);
    // Persistence still ran for the accepted row only.
    expect(dualWriteMocks.syncRecommendedEdits).toHaveBeenCalledTimes(1);
    const persistedRows = (
      dualWriteMocks.syncRecommendedEdits.mock.calls[0] as unknown as [
        RecommendedEditRow[],
        string,
      ]
    )[0];
    expect(persistedRows).toHaveLength(1);
    expect(persistedRows[0].target_url).toBe(URL_BRACES);
    // Rejection details surfaced (not silent success).
    expect(result.rejected).toHaveLength(1);
    const failed = result.rejected[0].result;
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.field).toBe("targetUrl");
  });

  it("aborts persistence entirely when bundle-level validation fails (tenantId mismatch)", async () => {
    const packet = buildPacket();
    const tamperedProvider: SpecificEditProvider = {
      name: "deterministic",
      async generate(p) {
        const inner = await deterministicProvider.generate(p);
        return { ...inner, tenantId: "tenant-other" };
      },
    };
    const result = await runProviderAndPersist({
      provider: tamperedProvider,
      packet,
      dryRun: false,
      now: FROZEN_NOW,
    });
    expect(result.ok).toBe(false);
    expect(result.bundleErrors.length).toBeGreaterThan(0);
    expect(result.bundleErrors[0].field).toBe("tenantId");
    expect(result.persisted).toBe(false);
    expect(dualWriteMocks.syncRecommendedEdits).not.toHaveBeenCalled();
    expect(dotDataMocks.write).not.toHaveBeenCalled();
  });

  it("persists nothing when there are zero accepted edits", async () => {
    const empty = buildPacket({
      ownedPageInventory: [],
      pageElementInventory: [],
      affectedPromptIds: [],
      promptOpportunities: [],
      trackedPrompts: [],
      primarySummaries: [],
      clusterLabel: null,
      clusterKind: null,
    });
    const result = await runProviderAndPersist({
      provider: deterministicProvider,
      packet: empty,
      dryRun: false,
      now: FROZEN_NOW,
    });
    expect(result.totalGenerated).toBe(0);
    expect(result.persisted).toBe(false);
    expect(dualWriteMocks.syncRecommendedEdits).not.toHaveBeenCalled();
  });

  it("threads tenant_id + evidence_hash + provider_name into every persisted row", async () => {
    const packet = buildPacket();
    await runProviderAndPersist({
      provider: deterministicProvider,
      packet,
      dryRun: false,
      now: FROZEN_NOW,
    });
    const persistedRows = (
      dualWriteMocks.syncRecommendedEdits.mock.calls[0] as unknown as [
        RecommendedEditRow[],
        string,
      ]
    )[0];
    for (const row of persistedRows) {
      expect(row.tenant_id).toBe(packet.tenantId);
      expect(row.evidence_hash).toBe(packet.evidenceHash);
      expect(row.provider_name).toBe("deterministic");
      expect(row.source).toBe("deterministic");
      expect(row.model).toBeNull();
      expect(row.cost_usd).toBeNull();
    }
  });

  it("file write is replace-by-id (preserves rows from other recs/runs)", async () => {
    const packet = buildPacket();
    // Pretend an existing row from a different rec is already on disk.
    const preexisting: RecommendedEditRow = {
      id: "rec-OTHER__edit_title__title[0]:other-hash",
      tenant_id: TENANT,
      rec_id: "rec-OTHER",
      action_type: "edit_title",
      target_url: "https://example.com/other",
      target_element_key: "title[0]:other-hash",
      display_label: "Title tag",
      current_text: "Old",
      proposed_text: "New",
      why: "x",
      evidence: [],
      expected_impact: null,
      difficulty: "low",
      confidence: "medium",
      measurement_plan: null,
      risks: [],
      source: "deterministic",
      provider_name: "deterministic",
      evidence_hash: "old-hash",
      model: null,
      cost_usd: null,
      created_at: "2026-04-23T00:00:00Z",
      updated_at: "2026-04-23T00:00:00Z",
    };
    dotDataMocks.read.mockReturnValueOnce([preexisting]);

    await runProviderAndPersist({
      provider: deterministicProvider,
      packet,
      dryRun: false,
      now: FROZEN_NOW,
    });

    expect(dotDataMocks.write).toHaveBeenCalledTimes(1);
    const writeCall = dotDataMocks.write.mock.calls[0] as unknown as [
      string,
      RecommendedEditRow[],
    ];
    const writtenName = writeCall[0];
    const writtenRows = writeCall[1];
    expect(writtenName).toBe("recommended-edits");
    // Pre-existing row for rec-OTHER is preserved.
    expect(
      writtenRows.find((r) => r.id === preexisting.id),
    ).toBeDefined();
    // New rec row(s) were appended/updated.
    expect(writtenRows.some((r) => r.rec_id === packet.recId)).toBe(true);
  });

  it("orchestration helper does not mutate the input packet", async () => {
    const packet = buildPacket();
    const before = JSON.stringify(packet);
    await runProviderAndPersist({
      provider: deterministicProvider,
      packet,
      dryRun: true,
      now: FROZEN_NOW,
    });
    expect(JSON.stringify(packet)).toBe(before);
  });
});

// ── Phase 7.7d — runProviderAndPersist tenant assertion ──────────────────

describe("Phase 7.7d — runProviderAndPersist tenant assertion", () => {
  beforeEach(() => {
    dotDataMocks.read.mockReset();
    dotDataMocks.write.mockReset();
    dualWriteMocks.syncRecommendedEdits.mockReset();
    dotDataMocks.read.mockReturnValue([]);
    dualWriteMocks.syncRecommendedEdits.mockResolvedValue(undefined);
    tenantMocks.currentTenantId.mockResolvedValue(TENANT);
  });

  afterEach(() => {
    tenantMocks.currentTenantId.mockResolvedValue(TENANT);
    vi.restoreAllMocks();
  });

  it("throws when packet.tenantId does not match the resolved context tenantId", async () => {
    // Simulate a packet built under tenant-A passed into a server
    // action that resolves to tenant-B (the leak vector).
    tenantMocks.currentTenantId.mockResolvedValue("tenant-WRONG");
    const packet = buildPacket();
    expect(packet.tenantId).toBe(TENANT); // sanity — packet stays as test fixture
    await expect(
      runProviderAndPersist({
        provider: deterministicProvider,
        packet,
        dryRun: false,
        now: FROZEN_NOW,
      }),
    ).rejects.toThrow(/tenant mismatch/);
    // Provider was not even called — the assertion fires at the
    // function boundary, before any side effects.
    expect(dualWriteMocks.syncRecommendedEdits).not.toHaveBeenCalled();
    expect(dotDataMocks.write).not.toHaveBeenCalled();
  });

  it("error message identifies both packet and context tenants", async () => {
    tenantMocks.currentTenantId.mockResolvedValue("tenant-other");
    const packet = buildPacket();
    await expect(
      runProviderAndPersist({
        provider: deterministicProvider,
        packet,
        dryRun: false,
        now: FROZEN_NOW,
      }),
    ).rejects.toThrow(/tenant-test-acme.*tenant-other/);
  });

  it("matching tenant: persists rows AND threads ctxTenantId into syncRecommendedEdits", async () => {
    tenantMocks.currentTenantId.mockResolvedValue(TENANT);
    const packet = buildPacket();
    const result = await runProviderAndPersist({
      provider: deterministicProvider,
      packet,
      dryRun: false,
      now: FROZEN_NOW,
    });
    expect(result.persisted).toBe(true);
    expect(dualWriteMocks.syncRecommendedEdits).toHaveBeenCalledTimes(1);
    // Phase 7.7d: helper now receives (rows, tenantId) — the second
    // argument MUST be the context tenant, not a stamped row value.
    const callArgs = dualWriteMocks.syncRecommendedEdits.mock
      .calls[0] as unknown as [RecommendedEditRow[], string];
    expect(callArgs[1]).toBe(TENANT);
    // And the rows themselves still carry the packet's tenant_id —
    // by Phase 7.7d the assertion guarantees they're the same value.
    for (const row of callArgs[0]) {
      expect(row.tenant_id).toBe(TENANT);
    }
  });

  it("dry-run still asserts tenant — fails fast even before validation runs", async () => {
    tenantMocks.currentTenantId.mockResolvedValue("tenant-other");
    const packet = buildPacket();
    await expect(
      runProviderAndPersist({
        provider: deterministicProvider,
        packet,
        dryRun: true,
        now: FROZEN_NOW,
      }),
    ).rejects.toThrow(/tenant mismatch/);
  });
});

// ── persistRecommendedEditsLocal direct call ──────────────────────────────

describe("Phase 6A.1.11 — persistRecommendedEditsLocal", () => {
  beforeEach(() => {
    dotDataMocks.read.mockReset();
    dotDataMocks.write.mockReset();
    dotDataMocks.read.mockReturnValue([]);
  });

  it("no-ops on empty input", () => {
    persistRecommendedEditsLocal([]);
    expect(dotDataMocks.write).not.toHaveBeenCalled();
  });

  it("readRecommendedEditsLocal returns [] when the file is missing", async () => {
    dotDataMocks.read.mockResolvedValueOnce(null);
    expect(await readRecommendedEditsLocal()).toEqual([]);
  });
});

// ── Lifecycle OS Phase 1 (2026-04-27) ────────────────────────────────────
//
// Tests for the per-edit `implementation_status` field + the
// `recommended` → `accepted` transition wired by acceptRecommendation.
// Match engine + verified_live transitions are Phase 2/3 — not tested
// here.
// ─────────────────────────────────────────────────────────────────────────

describe("Lifecycle OS Phase 1 — implementation_status defaults + helper", () => {
  it("mapSpecificEditToRow stamps implementation_status='recommended' + null live_* fields", () => {
    const packet = buildPacket();
    const edit = validEditTitleFixture(packet);
    const row = mapSpecificEditToRow({
      edit,
      recId: packet.recId,
      tenantId: packet.tenantId,
      evidenceHash: packet.evidenceHash,
      now: FROZEN_NOW,
    });
    expect(row.implementation_status).toBe("recommended");
    expect(row.live_at).toBeNull();
    expect(row.live_snapshot_id).toBeNull();
    expect(row.live_match_confidence).toBeNull();
    expect(row.live_match_kind).toBeNull();
    expect(row.live_element_key).toBeNull();
    expect(row.not_found_reason).toBeNull();
  });

  it("editLifecycleStatus normalizes legacy rows (undefined) to 'recommended'", () => {
    expect(editLifecycleStatus({ implementation_status: undefined })).toBe(
      "recommended",
    );
    expect(editLifecycleStatus({ implementation_status: "accepted" })).toBe(
      "accepted",
    );
    expect(
      editLifecycleStatus({ implementation_status: "verified_live" }),
    ).toBe("verified_live");
  });
});

describe("Lifecycle OS Phase 1 — markRecommendedEditsAccepted", () => {
  beforeEach(() => {
    dotDataMocks.read.mockReset();
    dotDataMocks.write.mockReset();
    dualWriteMocks.syncRecommendedEdits.mockReset();
    dualWriteMocks.syncRecommendedEdits.mockResolvedValue(undefined);
  });

  /**
   * Build a fixture row. Defaults to `implementation_status: "recommended"`
   * to mirror what mapSpecificEditToRow produces in production. Pass an
   * explicit status (incl. `undefined`) to simulate legacy / advanced
   * states.
   */
  function makeRow(
    id: string,
    statusOverride?: { status: RecommendedEditRow["implementation_status"] },
  ): RecommendedEditRow {
    const packet = buildPacket();
    const base = mapSpecificEditToRow({
      edit: validEditTitleFixture(packet),
      recId: packet.recId,
      tenantId: packet.tenantId,
      evidenceHash: packet.evidenceHash,
      now: FROZEN_NOW,
    });
    if (statusOverride === undefined) return { ...base, id };
    return { ...base, id, implementation_status: statusOverride.status };
  }

  it("flips matching rows from 'recommended' → 'accepted', writes file, dual-writes", async () => {
    const rows = [makeRow("e1"), makeRow("e2"), makeRow("e3")];
    dotDataMocks.read.mockResolvedValueOnce(rows);

    const result = await markRecommendedEditsAccepted({
      editIds: ["e1", "e3"],
      tenantId: TENANT,
      now: FROZEN_NOW,
    });

    expect(result).toEqual({ flipped: 2, skipped: 0 });

    // File write happened once with merged state.
    expect(dotDataMocks.write).toHaveBeenCalledTimes(1);
    const [, writtenRows] = dotDataMocks.write.mock.calls[0]!;
    const written = writtenRows as RecommendedEditRow[];
    expect(written.find((r) => r.id === "e1")?.implementation_status).toBe(
      "accepted",
    );
    expect(written.find((r) => r.id === "e2")?.implementation_status).toBe(
      "recommended",
    );
    expect(written.find((r) => r.id === "e3")?.implementation_status).toBe(
      "accepted",
    );

    // Dual-write got only the changed rows.
    expect(dualWriteMocks.syncRecommendedEdits).toHaveBeenCalledTimes(1);
    const [flippedRows, tenantArg] =
      dualWriteMocks.syncRecommendedEdits.mock.calls[0]!;
    expect(tenantArg).toBe(TENANT);
    const flipped = flippedRows as RecommendedEditRow[];
    expect(flipped.map((r) => r.id).sort()).toEqual(["e1", "e3"]);
    expect(flipped.every((r) => r.implementation_status === "accepted")).toBe(
      true,
    );
    expect(flipped.every((r) => r.updated_at === FROZEN_NOW.toISOString())).toBe(
      true,
    );
  });

  it("is idempotent — re-flipping already-accepted rows is a no-op", async () => {
    const rows = [
      makeRow("e1", { status: "accepted" }),
      makeRow("e2", { status: "accepted" }),
    ];
    dotDataMocks.read.mockResolvedValueOnce(rows);

    const result = await markRecommendedEditsAccepted({
      editIds: ["e1", "e2"],
      tenantId: TENANT,
      now: FROZEN_NOW,
    });

    expect(result).toEqual({ flipped: 0, skipped: 2 });
    expect(dotDataMocks.write).not.toHaveBeenCalled();
    expect(dualWriteMocks.syncRecommendedEdits).not.toHaveBeenCalled();
  });

  it("does NOT downgrade rows already in verified_live / dismissed (forward-only)", async () => {
    const rows = [
      makeRow("e1", { status: "verified_live" }),
      makeRow("e2", { status: "dismissed" }),
      makeRow("e3", { status: "needs_review" }),
    ];
    dotDataMocks.read.mockResolvedValueOnce(rows);

    const result = await markRecommendedEditsAccepted({
      editIds: ["e1", "e2", "e3"],
      tenantId: TENANT,
      now: FROZEN_NOW,
    });

    expect(result).toEqual({ flipped: 0, skipped: 3 });
    expect(dotDataMocks.write).not.toHaveBeenCalled();
    expect(dualWriteMocks.syncRecommendedEdits).not.toHaveBeenCalled();
  });

  it("treats legacy rows (implementation_status undefined) as 'recommended' and flips them", async () => {
    const rows = [makeRow("e1", { status: undefined })];
    dotDataMocks.read.mockResolvedValueOnce(rows);

    const result = await markRecommendedEditsAccepted({
      editIds: ["e1"],
      tenantId: TENANT,
      now: FROZEN_NOW,
    });

    expect(result.flipped).toBe(1);
    expect(dualWriteMocks.syncRecommendedEdits).toHaveBeenCalledTimes(1);
  });

  it("skips unknown ids silently without throwing", async () => {
    dotDataMocks.read.mockResolvedValueOnce([makeRow("e1")]);

    const result = await markRecommendedEditsAccepted({
      editIds: ["e1", "does-not-exist"],
      tenantId: TENANT,
      now: FROZEN_NOW,
    });

    expect(result).toEqual({ flipped: 1, skipped: 0 });
  });

  it("empty input is a no-op (no read, no write, no dual-write)", async () => {
    const result = await markRecommendedEditsAccepted({
      editIds: [],
      tenantId: TENANT,
      now: FROZEN_NOW,
    });

    expect(result).toEqual({ flipped: 0, skipped: 0 });
    expect(dotDataMocks.read).not.toHaveBeenCalled();
    expect(dotDataMocks.write).not.toHaveBeenCalled();
    expect(dualWriteMocks.syncRecommendedEdits).not.toHaveBeenCalled();
  });

  it("preserves all non-lifecycle fields on flipped rows", async () => {
    const original = makeRow("e1");
    dotDataMocks.read.mockResolvedValueOnce([original]);

    await markRecommendedEditsAccepted({
      editIds: ["e1"],
      tenantId: TENANT,
      now: FROZEN_NOW,
    });

    const [flippedRows] =
      dualWriteMocks.syncRecommendedEdits.mock.calls[0]!;
    const flipped = (flippedRows as RecommendedEditRow[])[0]!;
    expect(flipped.rec_id).toBe(original.rec_id);
    expect(flipped.target_url).toBe(original.target_url);
    expect(flipped.target_element_key).toBe(original.target_element_key);
    expect(flipped.proposed_text).toBe(original.proposed_text);
    expect(flipped.evidence).toEqual(original.evidence);
    expect(flipped.created_at).toBe(original.created_at);
    // Only these two changed:
    expect(flipped.implementation_status).toBe("accepted");
    expect(flipped.updated_at).toBe(FROZEN_NOW.toISOString());
  });

  it("survives a dual-write failure (file write still succeeds; warns)", async () => {
    const rows = [makeRow("e1")];
    dotDataMocks.read.mockResolvedValueOnce(rows);
    dualWriteMocks.syncRecommendedEdits.mockRejectedValueOnce(
      new Error("supabase unreachable"),
    );

    const result = await markRecommendedEditsAccepted({
      editIds: ["e1"],
      tenantId: TENANT,
      now: FROZEN_NOW,
    });

    expect(result.flipped).toBe(1);
    expect(dotDataMocks.write).toHaveBeenCalledTimes(1);
    expect(dualWriteMocks.syncRecommendedEdits).toHaveBeenCalledTimes(1);
  });
});

// ── W2 Step 2.4 — markRecommendedEditsAsShipped ────────────────────────────

describe("W2 Step 2.4 — markRecommendedEditsAsShipped", () => {
  beforeEach(() => {
    dotDataMocks.read.mockReset();
    dotDataMocks.write.mockReset();
    dualWriteMocks.syncRecommendedEdits.mockReset();
    dualWriteMocks.syncRecommendedEdits.mockResolvedValue(undefined);
  });

  function makeRow(
    id: string,
    statusOverride?: { status: RecommendedEditRow["implementation_status"] },
  ): RecommendedEditRow {
    const packet = buildPacket();
    const base = mapSpecificEditToRow({
      edit: validEditTitleFixture(packet),
      recId: packet.recId,
      tenantId: packet.tenantId,
      evidenceHash: packet.evidenceHash,
      now: FROZEN_NOW,
    });
    if (statusOverride === undefined) return { ...base, id };
    return { ...base, id, implementation_status: statusOverride.status };
  }

  it("flips 'recommended' → 'verified_live' with operator_override stamp", async () => {
    const rows = [makeRow("e1", { status: "recommended" })];
    dotDataMocks.read.mockResolvedValueOnce(rows);

    const result = await markRecommendedEditsAsShipped({
      editIds: ["e1"],
      tenantId: TENANT,
      now: FROZEN_NOW,
    });

    expect(result).toEqual({ flipped: 1, skipped: 0 });

    const [flippedRows] = dualWriteMocks.syncRecommendedEdits.mock.calls[0]!;
    const flipped = (flippedRows as RecommendedEditRow[])[0]!;
    expect(flipped.implementation_status).toBe("verified_live");
    expect(flipped.live_at).toBe(FROZEN_NOW.toISOString());
    expect(flipped.live_match_kind).toBe("operator_override");
    expect(flipped.live_match_confidence).toBe("high");
    expect(flipped.updated_at).toBe(FROZEN_NOW.toISOString());
  });

  it("flips 'accepted' → 'verified_live' (the canonical operator path)", async () => {
    const rows = [makeRow("e1", { status: "accepted" })];
    dotDataMocks.read.mockResolvedValueOnce(rows);

    const result = await markRecommendedEditsAsShipped({
      editIds: ["e1"],
      tenantId: TENANT,
      now: FROZEN_NOW,
    });

    expect(result).toEqual({ flipped: 1, skipped: 0 });
    const [flippedRows] = dualWriteMocks.syncRecommendedEdits.mock.calls[0]!;
    const flipped = (flippedRows as RecommendedEditRow[])[0]!;
    expect(flipped.implementation_status).toBe("verified_live");
    expect(flipped.live_match_kind).toBe("operator_override");
  });

  it("does NOT downgrade rows already past verified_live (forward-only)", async () => {
    const rows = [
      makeRow("e1", { status: "verified_live" }),
      makeRow("e2", { status: "verified_live_modified" }),
      makeRow("e3", { status: "partially_implemented" }),
      makeRow("e4", { status: "needs_review" }),
      makeRow("e5", { status: "wrong_page" }),
      makeRow("e6", { status: "not_found_after_7d" }),
      makeRow("e7", { status: "dismissed" }),
    ];
    dotDataMocks.read.mockResolvedValueOnce(rows);

    const result = await markRecommendedEditsAsShipped({
      editIds: ["e1", "e2", "e3", "e4", "e5", "e6", "e7"],
      tenantId: TENANT,
      now: FROZEN_NOW,
    });

    expect(result).toEqual({ flipped: 0, skipped: 7 });
    expect(dotDataMocks.write).not.toHaveBeenCalled();
    expect(dualWriteMocks.syncRecommendedEdits).not.toHaveBeenCalled();
  });

  it("treats legacy rows (implementation_status undefined) as 'recommended' and flips them", async () => {
    const rows = [makeRow("e1", { status: undefined })];
    dotDataMocks.read.mockResolvedValueOnce(rows);

    const result = await markRecommendedEditsAsShipped({
      editIds: ["e1"],
      tenantId: TENANT,
      now: FROZEN_NOW,
    });

    expect(result.flipped).toBe(1);
    const [flippedRows] = dualWriteMocks.syncRecommendedEdits.mock.calls[0]!;
    const flipped = (flippedRows as RecommendedEditRow[])[0]!;
    expect(flipped.implementation_status).toBe("verified_live");
  });

  it("skips unknown ids silently without throwing", async () => {
    dotDataMocks.read.mockResolvedValueOnce([
      makeRow("e1", { status: "accepted" }),
    ]);

    const result = await markRecommendedEditsAsShipped({
      editIds: ["e1", "does-not-exist"],
      tenantId: TENANT,
      now: FROZEN_NOW,
    });

    expect(result).toEqual({ flipped: 1, skipped: 0 });
  });

  it("empty input is a no-op (no read, no write, no dual-write)", async () => {
    const result = await markRecommendedEditsAsShipped({
      editIds: [],
      tenantId: TENANT,
      now: FROZEN_NOW,
    });

    expect(result).toEqual({ flipped: 0, skipped: 0 });
    expect(dotDataMocks.read).not.toHaveBeenCalled();
    expect(dotDataMocks.write).not.toHaveBeenCalled();
    expect(dualWriteMocks.syncRecommendedEdits).not.toHaveBeenCalled();
  });

  it("preserves all non-lifecycle fields on flipped rows", async () => {
    const original = makeRow("e1", { status: "accepted" });
    dotDataMocks.read.mockResolvedValueOnce([original]);

    await markRecommendedEditsAsShipped({
      editIds: ["e1"],
      tenantId: TENANT,
      now: FROZEN_NOW,
    });

    const [flippedRows] = dualWriteMocks.syncRecommendedEdits.mock.calls[0]!;
    const flipped = (flippedRows as RecommendedEditRow[])[0]!;
    expect(flipped.rec_id).toBe(original.rec_id);
    expect(flipped.target_url).toBe(original.target_url);
    expect(flipped.target_element_key).toBe(original.target_element_key);
    expect(flipped.proposed_text).toBe(original.proposed_text);
    expect(flipped.evidence).toEqual(original.evidence);
    expect(flipped.created_at).toBe(original.created_at);
    expect(flipped.confidence).toBe(original.confidence);
    expect(flipped.difficulty).toBe(original.difficulty);
  });

  it("is idempotent — re-shipping already-verified rows is a no-op", async () => {
    const rows = [makeRow("e1", { status: "verified_live" })];
    dotDataMocks.read.mockResolvedValueOnce(rows);

    const result = await markRecommendedEditsAsShipped({
      editIds: ["e1"],
      tenantId: TENANT,
      now: FROZEN_NOW,
    });

    expect(result).toEqual({ flipped: 0, skipped: 1 });
    expect(dotDataMocks.write).not.toHaveBeenCalled();
  });

  it("survives a dual-write failure (file write still succeeds)", async () => {
    const rows = [makeRow("e1", { status: "accepted" })];
    dotDataMocks.read.mockResolvedValueOnce(rows);
    dualWriteMocks.syncRecommendedEdits.mockRejectedValueOnce(
      new Error("supabase unreachable"),
    );

    const result = await markRecommendedEditsAsShipped({
      editIds: ["e1"],
      tenantId: TENANT,
      now: FROZEN_NOW,
    });

    expect(result.flipped).toBe(1);
    expect(dotDataMocks.write).toHaveBeenCalledTimes(1);
    expect(dualWriteMocks.syncRecommendedEdits).toHaveBeenCalledTimes(1);
  });

  it("only flips matching ids, leaves others untouched", async () => {
    const rows = [
      makeRow("e1", { status: "accepted" }),
      makeRow("e2", { status: "accepted" }),
      makeRow("e3", { status: "accepted" }),
    ];
    dotDataMocks.read.mockResolvedValueOnce(rows);

    const result = await markRecommendedEditsAsShipped({
      editIds: ["e1", "e3"],
      tenantId: TENANT,
      now: FROZEN_NOW,
    });

    expect(result).toEqual({ flipped: 2, skipped: 0 });

    const [, writtenRows] = dotDataMocks.write.mock.calls[0]!;
    const written = writtenRows as RecommendedEditRow[];
    expect(written.find((r) => r.id === "e1")?.implementation_status).toBe(
      "verified_live",
    );
    expect(written.find((r) => r.id === "e2")?.implementation_status).toBe(
      "accepted",
    );
    expect(written.find((r) => r.id === "e3")?.implementation_status).toBe(
      "verified_live",
    );
  });
});

// ── 3. Source-scan invariants ─────────────────────────────────────────────

function walkSync(dir: string, predicate: (p: string) => boolean): string[] {
  const out: string[] = [];
  const stack: string[] = [dir];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    let entries: string[] = [];
    try {
      entries = readdirSync(cur);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(cur, entry);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) stack.push(full);
      else if (st.isFile() && predicate(full)) out.push(full);
    }
  }
  return out;
}

describe("Phase 6A.1.11 — source-scan invariants", () => {
  it("no app route page.tsx or route.ts CALLS the persistence functions or the CLI", () => {
    // Phase 12 (2026-04-24): tightened from a blanket "no module
    // import" rule to a "no implementation call" rule. Type-only
    // imports of `RecommendedEditRow` from this module are legitimate
    // (the page surfaces the row shape on /recommendations); the
    // dangerous pattern is calling the WRITE-PATH helpers from a
    // render path.
    const appDir = resolve(__dirname, "../../app");
    const matches = walkSync(
      appDir,
      (p) => p.endsWith("/page.tsx") || p.endsWith("/route.ts"),
    );
    const offenders: string[] = [];
    for (const file of matches) {
      const src = readFileSync(file, "utf8");
      if (
        /\brunProviderAndPersist\b/.test(src) ||
        /\bmapSpecificEditToRow\b/.test(src) ||
        /\bpersistRecommendedEditsLocal\b/.test(src) ||
        /from\s+["'][^"']*generate-specific-edits/.test(src)
      ) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("CLI script exists and contains expected hooks", () => {
    const scriptPath = resolve(
      __dirname,
      "../../../scripts/generate-specific-edits.ts",
    );
    const src = readFileSync(scriptPath, "utf8");
    expect(src).toMatch(/runProviderAndPersist/);
    expect(src).toMatch(/deterministicProvider/);
    expect(src).toMatch(/--smoke/);
    expect(src).toMatch(/--packet=/);
    expect(src).toMatch(/--write/);
    // No LLM SDK imports.
    expect(src).not.toMatch(/from\s+["']openai["']/);
    expect(src).not.toMatch(/from\s+["']@anthropic-ai\/sdk["']/);
  });

  it("dual-write helper is registered with the right onConflict", () => {
    const dualWritePath = resolve(
      __dirname,
      "../../lib/persistence/dual-write.ts",
    );
    const src = readFileSync(dualWritePath, "utf8");
    // Phase 7.7d (2026-04-25): syncRecommendedEdits routes through STRICT
    // dualWriteUpsertScoped (not the unscoped dualWriteUpsert). Match
    // either form — both still hit `recommended_edits` with the same
    // compound onConflict key.
    expect(src).toMatch(
      /dualWriteUpsert(?:Scoped)?\(\s*["']recommended_edits["']/,
    );
    // Sprint 6A.2f follow-up (2026-04-26): the onConflict spec was
    // updated from `rec_id,action_type,target_element_key` to
    // `tenant_id,rec_id,action_type,target_element_key` to match the
    // production unique index `ux_re_tenant_rec_action_element` which
    // includes tenant_id as the leading column. The first-3-cols spec
    // had been silently wrong since the Phase 7.7d tenant-binding
    // migration; surfaced when the first live LLM `--write` against
    // Ritz threw "no unique or exclusion constraint matching the ON
    // CONFLICT specification".
    expect(src).toMatch(
      /["']tenant_id,rec_id,action_type,target_element_key["']/,
    );
  });
});
