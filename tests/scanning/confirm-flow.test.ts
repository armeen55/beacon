/**
 * Phase 1 — Lock the working loop: confirm flow tests.
 *
 * Tests the transformation logic in confirmFindingAsChange and
 * the finding status update mechanics. Uses vi.mock for I/O-heavy
 * dependencies (json-store, dual-write, next/cache, seed-data).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Finding } from "@/domains/scanning/types";

// ── Hoisted values (available inside vi.mock factories) ──
const { mockStoreData, mockChangelogEntries, mockIdCounter } = vi.hoisted(() => ({
  mockStoreData: new Map<string, unknown[]>(),
  mockChangelogEntries: [] as unknown[],
  mockIdCounter: { value: 0 },
}));

// ── Mock modules ──

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/persistence/dual-write", () => ({
  syncChangelogEntries: vi.fn().mockResolvedValue(undefined),
  syncScanFindings: vi.fn().mockResolvedValue(undefined),
  isDualWriteEnabled: vi.fn().mockReturnValue(false),
}));

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/actions", () => ({
  generateId: (prefix: string) => `${prefix}-mock-${++mockIdCounter.value}`,
  now: () => "2026-04-14T10:00:00.000Z",
}));

vi.mock("@/lib/persistence/json-store", () => ({
  readStore: (name: string) => mockStoreData.get(name) ?? [],
  writeStore: vi.fn().mockImplementation(async (name: string, data: unknown[]) => {
    mockStoreData.set(name, data);
  }),
}));

vi.mock("@/lib/seed-data.server", () => ({
  changelogEntries: mockChangelogEntries,
}));

// ── Now import the functions under test ──
import { confirmFindingAsChange, resolveFinding } from "@/app/(shell)/finding-actions";
import { syncChangelogEntries } from "@/lib/persistence/dual-write";
import { writeStore } from "@/lib/persistence/json-store";

// ── Helpers ──

function makePendingFinding(overrides?: Partial<Finding>): Finding {
  return {
    id: "title_changed-https-ritzbuilders-com-services-custom-homes-scan-001",
    type: "title_changed",
    url: "https://ritzbuilders.com/services/custom-homes",
    pagePath: "/services/custom-homes",
    detectedAt: "2026-04-14T08:00:00.000Z",
    scanRunId: "scan-001",
    previousState: "Old Title",
    currentState: "New Title",
    severity: "medium",
    priority: "important",
    priorityScore: 45,
    summary: 'Title changed: "Old Title" → "New Title"',
    suggestedAction: "Review whether the new title is intentional",
    status: "pending",
    resolvedAt: null,
    linkedChangeId: null,
    promotionStatus: "none",
    resolutionNote: null,
    suppressUntil: null,
    citationCount: 0,
    isHomepage: false,
    contradictsChangelog: false,
    ...overrides,
  };
}

// ── Tests ──

describe("confirmFindingAsChange", () => {
  beforeEach(() => {
    mockIdCounter.value = 0;
    mockStoreData.clear();
    mockChangelogEntries.length = 0;
    vi.clearAllMocks();
  });

  it("returns success with a changeId", async () => {
    const finding = makePendingFinding();
    mockStoreData.set("scan-findings", [finding]);

    const result = await confirmFindingAsChange(finding.id);

    expect(result.success).toBe(true);
    expect(result.changeId).toBeTruthy();
    expect(result.changeId).toMatch(/^cl-/);
  });

  it("creates a changelog entry with correct signal_type mapping", async () => {
    const finding = makePendingFinding({ type: "title_changed" });
    mockStoreData.set("scan-findings", [finding]);

    await confirmFindingAsChange(finding.id);

    expect(mockChangelogEntries).toHaveLength(1);
    const entry = mockChangelogEntries[0] as Record<string, unknown>;
    expect(entry.signal_type).toBe("content"); // title_changed → content
    expect(entry.source_system).toBe("scan_detection");
  });

  it("creates a changelog entry with correct asset_type inference", async () => {
    // Service page URL
    const finding = makePendingFinding({
      url: "https://ritzbuilders.com/services/custom-homes",
    });
    mockStoreData.set("scan-findings", [finding]);
    await confirmFindingAsChange(finding.id);

    const entry = mockChangelogEntries[0] as Record<string, unknown>;
    expect(entry.asset_type).toBe("service_page");

    // Reset for homepage test
    mockChangelogEntries.length = 0;
    mockStoreData.clear();
    mockIdCounter.value = 0;

    const hpFinding = makePendingFinding({
      id: "title_changed-https-ritzbuilders-com-scan-002",
      url: "https://ritzbuilders.com/",
      pagePath: "/",
    });
    mockStoreData.set("scan-findings", [hpFinding]);
    await confirmFindingAsChange(hpFinding.id);

    const hpEntry = mockChangelogEntries[0] as Record<string, unknown>;
    expect(hpEntry.asset_type).toBe("homepage");
  });

  it("creates a changelog entry with correct content from finding", async () => {
    const finding = makePendingFinding({
      summary: 'Title changed: "Old" → "New"',
      previousState: "Old",
      currentState: "New",
    });
    mockStoreData.set("scan-findings", [finding]);

    await confirmFindingAsChange(finding.id);

    const entry = mockChangelogEntries[0] as Record<string, unknown>;
    expect(entry.change_description).toBe('Title changed: "Old" → "New"');
    expect((entry.notes as string)).toContain("Old");
    expect((entry.notes as string)).toContain("New");
    expect(entry.url).toBe(finding.url);
  });

  it("updates finding status to accepted with changelog promotion", async () => {
    const finding = makePendingFinding();
    mockStoreData.set("scan-findings", [finding]);

    await confirmFindingAsChange(finding.id);

    // After confirmation, the finding should be updated in the store
    const findings = mockStoreData.get("scan-findings") as Finding[];
    const updated = findings.find((f) => f.id === finding.id);
    expect(updated).toBeDefined();
    expect(updated!.status).toBe("accepted");
    expect(updated!.promotionStatus).toBe("changelog");
    expect(updated!.linkedChangeId).toBeTruthy();
    expect(updated!.resolvedAt).toBeTruthy();
  });

  it("calls syncChangelogEntries for dual-write", async () => {
    const finding = makePendingFinding();
    mockStoreData.set("scan-findings", [finding]);

    await confirmFindingAsChange(finding.id);

    expect(syncChangelogEntries).toHaveBeenCalledTimes(1);
    const syncArg = (syncChangelogEntries as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(syncArg).toHaveLength(1);
    expect(syncArg[0].source_system).toBe("scan_detection");
  });

  it("writes changelog to imported-changes store", async () => {
    const finding = makePendingFinding();
    mockStoreData.set("scan-findings", [finding]);

    await confirmFindingAsChange(finding.id);

    expect(writeStore).toHaveBeenCalledWith(
      "imported-changes",
      expect.arrayContaining([
        expect.objectContaining({ source_system: "scan_detection" }),
      ]),
    );
  });

  it("returns failure for non-existent finding", async () => {
    mockStoreData.set("scan-findings", []);

    const result = await confirmFindingAsChange("nonexistent-id");

    expect(result.success).toBe(false);
    expect(result.changeId).toBeUndefined();
  });

  it("maps faq_changed to faq signal type", async () => {
    const finding = makePendingFinding({
      id: "faq_changed-https-ritzbuilders-com-scan-003",
      type: "faq_changed",
      summary: "Q&A count changed: 6 → 3",
    });
    mockStoreData.set("scan-findings", [finding]);

    await confirmFindingAsChange(finding.id);

    const entry = mockChangelogEntries[0] as Record<string, unknown>;
    expect(entry.signal_type).toBe("faq");
  });

  it("maps schema_changed to technical signal type", async () => {
    const finding = makePendingFinding({
      id: "schema_changed-https-ritzbuilders-com-scan-004",
      type: "schema_changed",
      summary: "Schema types changed",
    });
    mockStoreData.set("scan-findings", [finding]);

    await confirmFindingAsChange(finding.id);

    const entry = mockChangelogEntries[0] as Record<string, unknown>;
    expect(entry.signal_type).toBe("technical");
  });
});

describe("resolveFinding", () => {
  beforeEach(() => {
    mockStoreData.clear();
    vi.clearAllMocks();
  });

  it("marks finding as rejected", async () => {
    const finding = makePendingFinding();
    mockStoreData.set("scan-findings", [finding]);

    const result = await resolveFinding(finding.id, "rejected");

    expect(result.success).toBe(true);
    expect(result.consequence).toContain("false positive");

    const findings = mockStoreData.get("scan-findings") as Finding[];
    const updated = findings.find((f) => f.id === finding.id);
    expect(updated!.status).toBe("rejected");
    expect(updated!.resolvedAt).toBeTruthy();
  });

  it("marks finding as ignored", async () => {
    const finding = makePendingFinding();
    mockStoreData.set("scan-findings", [finding]);

    const result = await resolveFinding(finding.id, "ignored");

    expect(result.success).toBe(true);
    const findings = mockStoreData.get("scan-findings") as Finding[];
    expect(findings.find((f) => f.id === finding.id)!.status).toBe("ignored");
  });

  it("marks finding as expected with suppression window", async () => {
    const finding = makePendingFinding();
    mockStoreData.set("scan-findings", [finding]);

    const result = await resolveFinding(finding.id, "expected", { suppressDays: 7 });

    expect(result.success).toBe(true);
    expect(result.consequence).toContain("7 days");

    const findings = mockStoreData.get("scan-findings") as Finding[];
    const updated = findings.find((f) => f.id === finding.id);
    expect(updated!.status).toBe("expected");
    expect(updated!.suppressUntil).toBeTruthy();
  });

  it("rejects invalid status", async () => {
    const finding = makePendingFinding();
    mockStoreData.set("scan-findings", [finding]);

    const result = await resolveFinding(finding.id, "invalid_status");

    expect(result.success).toBe(false);
  });
});
