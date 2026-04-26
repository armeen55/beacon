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
  mapSpecificEditToRow,
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
  syncRecommendedEdits: vi.fn(async () => undefined),
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
  return buildSpecificEditEvidencePacket({ ...basePacketArgs(), ...overrides });
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
    const packet = buildPacket();
    const result = await runProviderAndPersist({
      provider: deterministicProvider,
      packet,
      dryRun: false,
      now: FROZEN_NOW,
    });
    expect(result.ok).toBe(true);
    expect(result.totalGenerated).toBeGreaterThan(0);
    expect(result.acceptedCount).toBe(result.totalGenerated);
    expect(result.rejectedCount).toBe(0);
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
    expect(src).toMatch(
      /["']rec_id,action_type,target_element_key["']/,
    );
  });
});
