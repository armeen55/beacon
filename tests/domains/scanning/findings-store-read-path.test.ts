import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Phase C follow-up (2026-04-24) — findings-store write path read-fix.
 *
 * Prior bug: `updateFindingStatus(id, ...)` used `getFindings()` which
 * read from the in-memory module-level cache of `.data/scan-findings.json`.
 * On Vercel cold start this cache is empty (no disk). The find-by-id call
 * returned undefined, function returned null silently, operator's
 * Confirm/Dismiss click never persisted.
 *
 * Fix: read from `getRepository().getScanFindings()` (Supabase on hosted,
 * file on local dev). Mutate. Upsert via `syncScanFindings([finding])`.
 *
 * These tests pin the contract: repo is the source of truth for the
 * write path, not the stale module cache.
 */

import type { Finding } from "@/domains/scanning/types";

// Shared state — stubbed repository + sync sink
const REPO_FINDINGS: Finding[] = [];
let SYNC_CALLS: Finding[][] = [];

vi.mock("@/lib/persistence/repositories", () => ({
  getRepository: () => ({
    getScanFindings: async () => REPO_FINDINGS,
  }),
}));

vi.mock("@/lib/persistence/dual-write", () => ({
  syncScanFindings: vi.fn(async (findings: Finding[]) => {
    SYNC_CALLS.push([...findings]);
  }),
}));

vi.mock("@/lib/persistence/json-store", () => ({
  readStore: vi.fn(() => []),
  writeStore: vi.fn(async () => undefined),
}));

vi.mock("@/lib/logger", () => ({
  log: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

function mkFinding(overrides: Partial<Finding> & { id: string }): Finding {
  return {
    type: "faq_changed",
    url: "https://ritzbuilders.com/services",
    pagePath: "/services",
    status: "pending",
    severity: "medium",
    priority: "minor",
    priorityScore: 50,
    citationCount: 5,
    isHomepage: false,
    scanRunId: "run-1",
    detectedAt: "2026-04-22T18:21:08.931Z",
    resolvedAt: null,
    linkedChangeId: null,
    resolutionNote: null,
    suppressUntil: null,
    previousState: "10 Q&A blocks",
    currentState: "0 Q&A blocks",
    summary: "Q&A blocks disappeared from /services (was 10)",
    suggestedAction: "Verify removal was intentional",
    promotionStatus: "none",
    contradictsChangelog: false,
    tenant_id: "",
    ...overrides,
  };
}

describe("findings-store — updateFindingStatus reads from repository", () => {
  beforeEach(() => {
    REPO_FINDINGS.length = 0;
    SYNC_CALLS = [];
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("finds and mutates the target finding when it exists in Supabase (module cache was empty)", async () => {
    // Seed repo only — simulates Vercel cold-start: cache empty,
    // Supabase has the row.
    const target = mkFinding({ id: "f-1" });
    REPO_FINDINGS.push(
      mkFinding({ id: "f-0", url: "https://ritzbuilders.com/other" }),
      target,
      mkFinding({
        id: "f-2",
        url: "https://ritzbuilders.com/another",
      }),
    );

    const { updateFindingStatus } = await import(
      "@/domains/scanning/findings-store"
    );

    const result = await updateFindingStatus("f-1", "rejected", {
      resolutionNote: "false positive — visible FAQ still present",
    });

    expect(result).not.toBeNull();
    expect(result?.status).toBe("rejected");
    expect(result?.resolutionNote).toBe(
      "false positive — visible FAQ still present",
    );
    expect(result?.resolvedAt).toBeTruthy();

    // syncScanFindings should have been called with exactly the mutated finding
    expect(SYNC_CALLS.length).toBe(1);
    expect(SYNC_CALLS[0].length).toBe(1);
    expect(SYNC_CALLS[0][0].id).toBe("f-1");
    expect(SYNC_CALLS[0][0].status).toBe("rejected");
  });

  it("returns null when finding id doesn't exist — no silent success, no sync call", async () => {
    REPO_FINDINGS.push(mkFinding({ id: "f-exists" }));

    const { updateFindingStatus } = await import(
      "@/domains/scanning/findings-store"
    );

    const result = await updateFindingStatus("f-does-not-exist", "rejected");
    expect(result).toBeNull();
    expect(SYNC_CALLS.length).toBe(0);
  });

  it("Confirm flow (status=accepted + promotionStatus=changelog) mutates + syncs", async () => {
    REPO_FINDINGS.push(mkFinding({ id: "f-confirm" }));

    const { updateFindingStatus } = await import(
      "@/domains/scanning/findings-store"
    );

    const result = await updateFindingStatus("f-confirm", "accepted", {
      promotionStatus: "changelog",
      linkedChangeId: "cl-abc",
    });

    expect(result?.status).toBe("accepted");
    expect(result?.promotionStatus).toBe("changelog");
    expect(result?.linkedChangeId).toBe("cl-abc");
    expect(SYNC_CALLS.length).toBe(1);
    expect(SYNC_CALLS[0][0].id).toBe("f-confirm");
  });

  it("Dismiss flow (status=ignored) mutates + syncs", async () => {
    REPO_FINDINGS.push(mkFinding({ id: "f-dismiss" }));

    const { updateFindingStatus } = await import(
      "@/domains/scanning/findings-store"
    );

    const result = await updateFindingStatus("f-dismiss", "ignored", {
      resolutionNote: "operator dismissed from Today",
    });

    expect(result?.status).toBe("ignored");
    expect(result?.resolutionNote).toBe("operator dismissed from Today");
    expect(SYNC_CALLS.length).toBe(1);
    expect(SYNC_CALLS[0][0].status).toBe("ignored");
  });

  it("suppressDays computes suppressUntil for 'expected' status", async () => {
    REPO_FINDINGS.push(mkFinding({ id: "f-expected" }));

    const { updateFindingStatus } = await import(
      "@/domains/scanning/findings-store"
    );

    const before = Date.now();
    const result = await updateFindingStatus("f-expected", "expected", {
      suppressDays: 14,
    });
    const after = Date.now();

    expect(result?.status).toBe("expected");
    expect(result?.suppressUntil).toBeTruthy();
    const suppressMs = Date.parse(result!.suppressUntil!);
    const expectedMin = before + 14 * 86_400_000 - 1000;
    const expectedMax = after + 14 * 86_400_000 + 1000;
    expect(suppressMs).toBeGreaterThanOrEqual(expectedMin);
    expect(suppressMs).toBeLessThanOrEqual(expectedMax);
  });
});
