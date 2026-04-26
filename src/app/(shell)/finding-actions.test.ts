import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Finding } from "@/domains/scanning/types";

// ---------------------------------------------------------------------------
// Mocks — must be set up before importing the module under test
// ---------------------------------------------------------------------------

// Mock "next/cache" (server action boundary)
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

// Phase 7.8d-1 (2026-04-26): readDotDataJson resolves the tenant slug
// for per-tenant stores; without this mock the resolver would call
// getTenant() and throw because `.data/tenants.json` isn't seeded in
// the unit-test environment.
vi.mock("@/lib/tenant-context", () => ({
  currentTenantId: vi.fn(async () => "tenant-ritz-founder"),
  currentTenantSlug: vi.fn(async () => "ritz-builders"),
}));

// Mock logger
vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

// Mock generateId / now
vi.mock("@/lib/actions", () => ({
  generateId: vi.fn((prefix: string) => `${prefix}-test123`),
  now: vi.fn(() => "2026-04-13T10:00:00.000Z"),
}));

// Findings store
const mockGetFindings = vi.fn<() => Finding[]>(() => []);
const mockUpdateFindingStatus = vi.fn(async () => ({}) as Finding);
vi.mock("@/domains/scanning/findings-store", () => ({
  getFindings: () => mockGetFindings(),
  updateFindingStatus: (...args: unknown[]) => (mockUpdateFindingStatus as Function)(...args),
}));

// Scan settings
vi.mock("@/domains/scanning/scan-settings", () => ({
  updateScanSettings: vi.fn(async () => {}),
}));

// writeStore
const mockWriteStore = vi.fn(async () => {});
vi.mock("@/lib/persistence/json-store", () => ({
  writeStore: (...args: unknown[]) => (mockWriteStore as Function)(...args),
  readStore: vi.fn(() => []),
}));

// Seed data — use a stable reference the hoisted factory can capture
vi.mock("@/lib/seed-data.server", () => {
  const arr: unknown[] = [];
  return { changelogEntries: arr };
});

// Now import the module under test
import {
  confirmFindingAsChange,
  resolveFinding,
} from "./finding-actions";
import { changelogEntries as mockChangelogEntries } from "@/lib/seed-data.server";

// ---------------------------------------------------------------------------
// Test data factory
// ---------------------------------------------------------------------------

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    // Sprint 7 Phase 7.5b Commit 5 (2026-04-25) — confirmFindingAsChange
    // now reads via `getRepository().forTenant(tenantId).getScanFindings()`,
    // which strips rows whose tenant_id doesn't match. vitest.config.ts
    // sets `BEACON_TENANT_ID=tenant-ritz-founder` so the resolver returns
    // ritz; the fixture must match for the filter to keep it.
    tenant_id: "tenant-ritz-founder",
    id: "f-001",
    type: "h1_changed",
    url: "https://example.com/services/kitchen-remodel",
    pagePath: "/services/kitchen-remodel",
    detectedAt: "2026-04-12T08:00:00Z",
    scanRunId: "run-1",
    previousState: "Old Heading",
    currentState: "New Heading",
    severity: "medium",
    priority: "important",
    priorityScore: 50,
    summary: "H1 changed from Old Heading to New Heading",
    suggestedAction: "Review the heading change",
    status: "pending",
    resolvedAt: null,
    linkedChangeId: null,
    promotionStatus: "none",
    resolutionNote: null,
    suppressUntil: null,
    citationCount: 0,
    isHomepage: false,
    contradictsChangelog: false,
    // (tenant_id set above to "tenant-ritz-founder" — Sprint 7 Phase 7.5b/5)
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("confirmFindingAsChange", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockChangelogEntries.length = 0;
  });

  it("returns success:false when finding is not found", async () => {
    mockGetFindings.mockReturnValue([]);
    const result = await confirmFindingAsChange("nonexistent");
    expect(result).toEqual({ success: false });
  });

  it("returns success:true with a changeId for a valid finding", async () => {
    mockGetFindings.mockReturnValue([makeFinding()]);
    const result = await confirmFindingAsChange("f-001");
    expect(result.success).toBe(true);
    expect(result.changeId).toBe("cl-test123");
  });

  // -----------------------------------------------------------------------
  // signal_type mapping
  // -----------------------------------------------------------------------

  it.each([
    ["h1_changed", "content"],
    ["title_changed", "content"],
    ["meta_changed", "content"],
    ["content_changed", "content"],
    ["faq_changed", "faq"],
    ["schema_changed", "technical"],
    ["canonical_changed", "technical"],
    ["links_changed", "technical"],
    ["page_added", "page"],
    ["page_removed", "page"],
  ] as const)(
    "maps finding type %s to signal_type %s",
    async (findingType, expectedSignal) => {
      mockGetFindings.mockReturnValue([makeFinding({ type: findingType })]);
      await confirmFindingAsChange("f-001");

      // The changelog entry pushed into the array should have the right signal_type
      expect(mockChangelogEntries.length).toBe(1);
      const entry = mockChangelogEntries[0] as { signal_type: string };
      expect(entry.signal_type).toBe(expectedSignal);
    },
  );

  it("defaults to 'content' for unmapped finding types", async () => {
    // "new_guardrail" is not in the FINDING_TO_SIGNAL map
    mockGetFindings.mockReturnValue([
      makeFinding({ type: "new_guardrail" }),
    ]);
    await confirmFindingAsChange("f-001");

    const entry = mockChangelogEntries[0] as { signal_type: string };
    expect(entry.signal_type).toBe("content");
  });

  // -----------------------------------------------------------------------
  // asset_type inference from URL
  // -----------------------------------------------------------------------

  it.each([
    ["https://example.com/", "homepage"],
    ["https://example.com", "homepage"],
    ["https://example.com/services/kitchen-remodel", "service_page"],
    ["https://example.com/service/plumbing", "service_page"],
    ["https://example.com/locations/san-francisco", "city_page"],
    ["https://example.com/location/oakland", "city_page"],
    ["https://example.com/projects/modern-kitchen", "project_page"],
    ["https://example.com/project/bath-remodel", "project_page"],
    ["https://example.com/about", "service_page"], // fallback
  ])(
    "infers asset_type for URL %s as %s",
    async (url, expectedAssetType) => {
      mockGetFindings.mockReturnValue([makeFinding({ url })]);
      await confirmFindingAsChange("f-001");

      const entry = mockChangelogEntries[0] as { asset_type: string };
      expect(entry.asset_type).toBe(expectedAssetType);
    },
  );

  // -----------------------------------------------------------------------
  // source_system
  // -----------------------------------------------------------------------

  it("sets source_system to 'scan_detection'", async () => {
    mockGetFindings.mockReturnValue([makeFinding()]);
    await confirmFindingAsChange("f-001");

    const entry = mockChangelogEntries[0] as { source_system: string };
    expect(entry.source_system).toBe("scan_detection");
  });

  // -----------------------------------------------------------------------
  // Changelog entry shape
  // -----------------------------------------------------------------------

  it("creates a well-formed ChangelogEntry", async () => {
    const finding = makeFinding({
      previousState: "Old Title",
      currentState: "New Title",
      summary: "Title was changed",
      pagePath: "/services/kitchen-remodel",
      url: "https://example.com/services/kitchen-remodel",
    });
    mockGetFindings.mockReturnValue([finding]);
    await confirmFindingAsChange("f-001");

    expect(mockChangelogEntries.length).toBe(1);
    const entry = mockChangelogEntries[0] as Record<string, unknown>;
    expect(entry.id).toBe("cl-test123");
    // Phase 3.5I-trust (2026-04-22): changelog timestamp + created_at +
    // updated_at all use `finding.detectedAt` (when the page actually
    // changed per HTML diff), NOT `now()` (when the operator clicked
    // Confirm). Keeps /changes date-accurate for attribution. See
    // src/app/(shell)/finding-actions.ts:210.
    expect(entry.timestamp).toBe("2026-04-12T08:00:00Z");
    expect(entry.url).toBe("https://example.com/services/kitchen-remodel");
    expect(entry.asset_name).toBe("/services/kitchen-remodel");
    expect(entry.change_description).toBe("Title was changed");
    expect(entry.expected_impact_window).toBe("7-14 days");
    expect(entry.notes).toContain("Auto-detected by scan");
    expect(entry.notes).toContain('Previous: "Old Title"');
    expect(entry.notes).toContain('Current: "New Title"');
    expect(entry.created_at).toBe("2026-04-12T08:00:00Z");
    expect(entry.updated_at).toBe("2026-04-12T08:00:00Z");
  });

  // -----------------------------------------------------------------------
  // Persistence calls
  // -----------------------------------------------------------------------

  it("writes to the 'imported-changes' store", async () => {
    mockGetFindings.mockReturnValue([makeFinding()]);
    await confirmFindingAsChange("f-001");

    expect(mockWriteStore).toHaveBeenCalledWith(
      "imported-changes",
      expect.any(Array),
    );
  });

  it("calls updateFindingStatus twice — once to accept, once to link", async () => {
    mockGetFindings.mockReturnValue([makeFinding()]);
    await confirmFindingAsChange("f-001");

    expect(mockUpdateFindingStatus).toHaveBeenCalledTimes(2);

    // First call: accept + promote
    expect(mockUpdateFindingStatus).toHaveBeenNthCalledWith(
      1,
      "f-001",
      "accepted",
      { promotionStatus: "changelog" },
    );

    // Second call: link the changelog entry
    expect(mockUpdateFindingStatus).toHaveBeenNthCalledWith(
      2,
      "f-001",
      "accepted",
      { promotionStatus: "changelog", linkedChangeId: "cl-test123" },
    );
  });
});

// ---------------------------------------------------------------------------
// resolveFinding
// ---------------------------------------------------------------------------

describe("resolveFinding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns success:false for invalid status", async () => {
    const result = await resolveFinding("f-001", "bogus_status");
    expect(result.success).toBe(false);
    expect(mockUpdateFindingStatus).not.toHaveBeenCalled();
  });

  it.each(["pending", "accepted", "rejected", "ignored", "expected"] as const)(
    "accepts valid status '%s'",
    async (status) => {
      mockUpdateFindingStatus.mockResolvedValue(makeFinding({ status }));
      const result = await resolveFinding("f-001", status);
      expect(result.success).toBe(true);
    },
  );

  it("returns success:false when updateFindingStatus returns null", async () => {
    mockUpdateFindingStatus.mockResolvedValue(null as unknown as Finding);
    const result = await resolveFinding("f-001", "accepted");
    expect(result.success).toBe(false);
  });

  it("passes suppressDays when status is 'expected'", async () => {
    mockUpdateFindingStatus.mockResolvedValue(makeFinding());
    await resolveFinding("f-001", "expected", { suppressDays: 30 });
    expect(mockUpdateFindingStatus).toHaveBeenCalledWith(
      "f-001",
      "expected",
      { resolutionNote: null, suppressDays: 30 },
    );
  });

  it("defaults suppressDays to 14 for 'expected' when not specified", async () => {
    mockUpdateFindingStatus.mockResolvedValue(makeFinding());
    await resolveFinding("f-001", "expected");
    expect(mockUpdateFindingStatus).toHaveBeenCalledWith(
      "f-001",
      "expected",
      { resolutionNote: null, suppressDays: 14 },
    );
  });

  it("passes suppressDays 0 for non-expected statuses", async () => {
    mockUpdateFindingStatus.mockResolvedValue(makeFinding());
    await resolveFinding("f-001", "accepted");
    expect(mockUpdateFindingStatus).toHaveBeenCalledWith(
      "f-001",
      "accepted",
      { resolutionNote: null, suppressDays: 0 },
    );
  });

  it("returns correct consequence text for each status", async () => {
    mockUpdateFindingStatus.mockResolvedValue(makeFinding());

    const accepted = await resolveFinding("f-001", "accepted");
    expect(accepted.consequence).toContain("Marked as trusted");

    const expected = await resolveFinding("f-001", "expected");
    expect(expected.consequence).toContain("Suppressed for");

    const ignored = await resolveFinding("f-001", "ignored");
    expect(ignored.consequence).toContain("Dismissed");

    const rejected = await resolveFinding("f-001", "rejected");
    expect(rejected.consequence).toContain("false positive");
  });

  it("passes resolutionNote through to updateFindingStatus", async () => {
    mockUpdateFindingStatus.mockResolvedValue(makeFinding());
    await resolveFinding("f-001", "accepted", {
      resolutionNote: "Looks correct",
    });
    expect(mockUpdateFindingStatus).toHaveBeenCalledWith(
      "f-001",
      "accepted",
      { resolutionNote: "Looks correct", suppressDays: 0 },
    );
  });
});
