/**
 * refresh-tenant-profile — the nightly self-heal orchestrator (2026-07-06).
 *
 * Pins the orchestration contract: derive -> persist, returning the segment-
 * change decision for the caller to apply. The two collaborators are mocked so
 * this test asserts wiring only (no config disk, no substrate reads):
 *   - the happy path threads deriveTenantProfile's verdict into
 *     persistTenantProfile and surfaces changedFields + segment decision,
 *   - fail-soft: a derive error OR a persist error returns a no-op result and
 *     NEVER throws (a nightly run must not break),
 *   - empty-safe: a tenant with nothing derived returns ran:true, no changes.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("./tenant-profile", () => ({
  deriveTenantProfile: vi.fn(),
}));
vi.mock("./persist-tenant-profile", () => ({
  persistTenantProfile: vi.fn(),
}));

import { refreshTenantProfile } from "./refresh-tenant-profile";
import { deriveTenantProfile } from "./tenant-profile";
import { persistTenantProfile } from "./persist-tenant-profile";
import type { TenantProfile } from "./tenant-profile";
import type { PersistTenantProfileResult } from "./persist-tenant-profile";

const deriveMock = vi.mocked(deriveTenantProfile);
const persistMock = vi.mocked(persistTenantProfile);

function tenantProfile(over: Partial<TenantProfile> = {}): TenantProfile {
  return {
    industry: "",
    businessType: "other",
    services: [],
    serviceAreas: [],
    confidence: "low",
    evidence: [],
    suggestedSegment: null,
    ...over,
  };
}

function persistResult(
  over: Partial<PersistTenantProfileResult> = {},
): PersistTenantProfileResult {
  return {
    changedFields: [],
    businessType: undefined,
    segmentChanged: false,
    segment: null,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("refreshTenantProfile — happy path orchestration", () => {
  it("derives then persists, threading the verdict + returning the decision", async () => {
    const profile = tenantProfile({
      businessType: "local_service",
      suggestedSegment: "local_service",
    });
    deriveMock.mockResolvedValue(profile);
    persistMock.mockReturnValue(
      persistResult({
        changedFields: ["businessType", "locations"],
        businessType: "local_service",
        segmentChanged: true,
        segment: "local_service",
      }),
    );

    const result = await refreshTenantProfile({
      tenantId: "tenant-abc",
      currentSegment: "content_publisher",
    });

    expect(deriveMock).toHaveBeenCalledWith({ tenantId: "tenant-abc" });
    // The derived profile is threaded straight into persist, with the segment.
    expect(persistMock).toHaveBeenCalledWith({
      tenantId: "tenant-abc",
      profile,
      currentSegment: "content_publisher",
    });
    expect(result).toEqual({
      ran: true,
      businessType: "local_service",
      changedFields: ["businessType", "locations"],
      segmentChanged: true,
      segment: "local_service",
    });
  });

  it("empty-safe: nothing derived → ran:true, no changes, no segment move", async () => {
    deriveMock.mockResolvedValue(tenantProfile({ businessType: "other" }));
    persistMock.mockReturnValue(persistResult());

    const result = await refreshTenantProfile({ tenantId: "tenant-empty" });

    expect(result.ran).toBe(true);
    expect(result.businessType).toBe("other");
    expect(result.changedFields).toEqual([]);
    expect(result.segmentChanged).toBe(false);
    expect(result.segment).toBeNull();
  });
});

describe("refreshTenantProfile — fail-soft (never throws)", () => {
  it("a derive error → no-op result with detail, does not throw", async () => {
    deriveMock.mockRejectedValue(new Error("derive blew up"));

    const result = await refreshTenantProfile({ tenantId: "tenant-x" });

    expect(result.ran).toBe(false);
    expect(result.businessType).toBeNull();
    expect(result.changedFields).toEqual([]);
    expect(result.segmentChanged).toBe(false);
    expect(result.segment).toBeNull();
    expect(result.detail).toContain("derive blew up");
    // persist is never reached when derive fails.
    expect(persistMock).not.toHaveBeenCalled();
  });

  it("a persist error → no-op result with detail, does not throw", async () => {
    deriveMock.mockResolvedValue(tenantProfile({ businessType: "saas" }));
    persistMock.mockImplementation(() => {
      throw new Error("persist blew up");
    });

    const result = await refreshTenantProfile({ tenantId: "tenant-y" });

    expect(result.ran).toBe(false);
    expect(result.businessType).toBeNull();
    expect(result.detail).toContain("persist blew up");
  });

  it("a non-Error throw is stringified into detail, still no-op", async () => {
    deriveMock.mockRejectedValue("string failure");

    const result = await refreshTenantProfile({ tenantId: "tenant-z" });

    expect(result.ran).toBe(false);
    expect(result.detail).toBe("string failure");
  });
});
